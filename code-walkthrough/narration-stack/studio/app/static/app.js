/* Narration Studio front end. No build step, no libraries. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ------------------------------------------------------------------ helpers

  function api(method, url, body) {
    var opts = { method: method, headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    return fetch(url, opts).then(function (r) {
      var ct = r.headers.get('Content-Type') || '';
      if (!r.ok) {
        return (ct.indexOf('json') >= 0 ? r.json() : r.text().then(function (t) { return { error: t }; }))
          .then(function (d) { throw new Error((d && d.error) || ('HTTP ' + r.status)); });
      }
      if (ct.indexOf('json') >= 0) return r.json();
      return r.blob();
    });
  }

  var toastTimer = null;
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 7000 : 3500);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function fmtTime(s) {
    if (s == null || !isFinite(s)) return '';
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }
  function fmtLen(s) {
    if (s == null) return '';
    s = Math.round(s);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtBytes(b) {
    if (!b) return '0 MB';
    if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' kB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var today = new Date();
    var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return 'Today ' + time;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ' ' + time;
  }

  // Two clicks to confirm destructive actions.
  function confirmClick(btn, label, action) {
    if (btn.dataset.armed === '1') {
      btn.dataset.armed = '';
      btn.classList.remove('confirm');
      btn.textContent = btn.dataset.label;
      action();
      return;
    }
    btn.dataset.label = btn.textContent;
    btn.dataset.armed = '1';
    btn.classList.add('confirm');
    btn.textContent = label;
    setTimeout(function () {
      if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.classList.remove('confirm'); btn.textContent = btn.dataset.label; }
    }, 3500);
  }

  var previewAudio = new Audio();
  function playBlob(blob) {
    if (previewAudio.src) URL.revokeObjectURL(previewAudio.src);
    previewAudio.src = URL.createObjectURL(blob);
    return previewAudio.play();
  }

  var ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    reroll: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 0 1 6.7 5h-2.4l3.3 4 3.3-4h-2.1A9 9 0 1 0 12 21v-2a7 7 0 1 1 0-14z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.2V20h2.8l9.5-9.5-2.8-2.8zM19.7 7.1a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0l-1.3 1.3 2.8 2.8z"/></svg>'
  };

  // ------------------------------------------------------------------ text splitting (mirrors core.py)

  var ABBR = ['bv', 'bijv', 'o.a', 'd.w.z', 'enz', 'nl', 'ca', 'vb', 'm.a.w', 'i.p.v', 't.o.v', 'z.g.a', 'evt', 'resp',
    'e.g', 'i.e', 'etc', 'vs', 'dr', 'mr', 'mrs', 'prof', 'nr', 'fig', 'ex'];

  function splitSentences(line) {
    var stash = [];
    var p = line.replace(/\[\[[^\]]*\]\]|`[^`]*`/g, function (m) { stash.push(m); return '\u0000' + (stash.length - 1) + '\u0000'; });
    var parts = [], start = 0, re = /[.!?…]+["'”’)]*\s+/g, m;
    while ((m = re.exec(p))) {
      var before = p.slice(start, m.index);
      var words = before.split(/\s/);
      var last = (words[words.length - 1] || '').toLowerCase().replace(/\.+$/, '');
      if (ABBR.indexOf(last) >= 0 || /^\d+$/.test(last)) continue;
      parts.push(p.slice(start, re.lastIndex).trim());
      start = re.lastIndex;
    }
    var rest = p.slice(start).trim();
    if (rest) parts.push(rest);
    return parts.filter(Boolean).map(function (s) { return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return stash[+i]; }); });
  }

  function splitText(text, mode) {
    var cues = [];
    (text || '').split('\n').forEach(function (line) {
      line = line.split(/\s+/).join(' ').trim();
      if (!line) return;
      cues.push.apply(cues, mode === 'sentence' ? splitSentences(line) : [line]);
    });
    return cues;
  }

  function spokenPreview(cue) {
    return cue.replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$2');
  }

  // ------------------------------------------------------------------ state

  var S = {
    engines: [],
    settings: { last: {} },
    lessons: [],
    lessonsMounted: false,
    source: 'text',
    split: 'sentence',
    job: null,
    pollTimer: null,
    waveFor: null,
    peaks: null,
    stopAt: null
  };

  // ------------------------------------------------------------------ tabs

  function showView(name) {
    $$('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === name)); });
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== name; });
    try { history.replaceState(null, '', name === 'narrate' ? location.pathname : '#' + name); } catch (e) { /* ignore */ }
    if (name === 'voices') loadVoices();
    if (name === 'piper') loadPiper(true);
    if (name === 'library') loadLibrary();
    if (name === 'settings') loadSettingsView();
    if (name === 'narrate') drawWave();
  }
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.view); }); });

  // ------------------------------------------------------------------ status

  function refreshStatus() {
    return api('GET', '/api/status').then(function (st) {
      var html = st.engines.map(function (e) {
        var cls = !e.status.online ? 'off' : e.status.ready ? 'ok' : 'warn';
        return '<span class="chip ' + cls + '" title="' + esc(e.status.message) + '">' + esc(e.name) + '</span>';
      }).join('');
      if (st.queue > 0) html += '<span class="chip warn">' + st.queue + ' waiting</span>';
      $('#status').innerHTML = html;
      S.status = st;
      return st;
    }).catch(function () {
      $('#status').innerHTML = '<span class="chip off">Studio not reachable</span>';
    });
  }

  // ------------------------------------------------------------------ engines, voices, params

  function currentEngine() {
    var id = $('#engine').value;
    return S.engines.filter(function (e) { return e.id === id; })[0];
  }

  function loadEngines() {
    return api('GET', '/api/engines').then(function (d) {
      S.engines = d.engines;
      var sel = $('#engine'), keep = sel.value || S.settings.last.engine;
      sel.innerHTML = S.engines.map(function (e) {
        var suffix = !e.status.online ? ' (offline)' : '';
        return '<option value="' + esc(e.id) + '">' + esc(e.name + suffix) + '</option>';
      }).join('');
      if (keep && S.engines.some(function (e) { return e.id === keep; })) sel.value = keep;
      else {
        var ready = S.engines.filter(function (e) { return e.status.ready; })[0];
        if (ready) sel.value = ready.id;
      }
      renderEngine();
    });
  }

  function renderEngine(keepVoice) {
    var e = currentEngine();
    if (!e) return;
    $('#engine-desc').textContent = e.description + '. ' + e.status.message + '.';
    var vs = $('#voice'), want = keepVoice || vs.value || (S.settings.last.engine === e.id ? S.settings.last.voice : null);
    vs.innerHTML = e.voices.map(function (v) {
      return '<option value="' + esc(v.id) + '">' + esc(v.name) + (v.language ? '  ·  ' + esc(v.language) : '') + '</option>';
    }).join('');
    if (want && e.voices.some(function (v) { return v.id === want; })) vs.value = want;
    var hint = $('#voice-hint');
    if (!e.status.online) { hint.textContent = e.name + ' is not reachable. ' + e.status.message + '.'; hint.hidden = false; }
    else if (!e.voices.length) {
      hint.textContent = e.canClone ? 'No voices yet. Clone your voice under Voices.' : (e.id === 'piper' ? 'No voices yet. Download one under Piper voices.' : 'This model has no voices configured.');
      hint.hidden = false;
    } else hint.hidden = true;

    var saved = (S.settings.last.params || {})[e.id] || {};
    $('#params').innerHTML = e.params.map(function (p) {
      var v = saved[p.key] != null ? saved[p.key] : p.default;
      return '<div class="param"><label for="p-' + p.key + '">' + esc(p.label) + '</label>' +
        '<output id="o-' + p.key + '">' + Number(v).toFixed(2) + '</output>' +
        '<input type="range" id="p-' + p.key + '" data-key="' + p.key + '" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" value="' + v + '">' +
        '<p class="hint">' + esc(p.help || '') + '</p></div>';
    }).join('');
    $$('#params input').forEach(function (inp) {
      inp.addEventListener('input', function () { $('#o-' + inp.dataset.key).textContent = Number(inp.value).toFixed(2); });
    });
  }

  function currentParams() {
    var out = {};
    $$('#params input').forEach(function (inp) { out[inp.dataset.key] = parseFloat(inp.value); });
    return out;
  }

  $('#engine').addEventListener('change', function () { renderEngine(); });

  // ------------------------------------------------------------------ script

  function updateCount() {
    var n = splitText($('#text').value, S.split).length;
    $('#cue-count').textContent = n + (n === 1 ? ' subtitle' : ' subtitles');
  }
  $('#text').addEventListener('input', updateCount);

  function setSplit(mode) {
    S.split = mode;
    $$('#split-seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.split === mode)); });
    updateCount();
  }
  $$('#split-seg button').forEach(function (b) { b.addEventListener('click', function () { setSplit(b.dataset.split); }); });

  function setSource(src) {
    S.source = src;
    $$('#source-seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.source === src)); });
    $('#lesson-pick').hidden = src !== 'lesson';
  }
  $$('#source-seg button').forEach(function (b) { b.addEventListener('click', function () { setSource(b.dataset.source); }); });

  function fillLessonSelects(lessonSel, stepSel, lessonId, stepId) {
    lessonSel.innerHTML = S.lessons.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.title) + '</option>'; }).join('');
    if (lessonId) lessonSel.value = lessonId;
    var fillSteps = function (sid) {
      var l = S.lessons.filter(function (x) { return x.id === lessonSel.value; })[0];
      stepSel.innerHTML = (l ? l.steps : []).map(function (s, i) {
        return '<option value="' + esc(s.id) + '">' + (i + 1) + '. ' + esc(s.title) + (s.hasAudio ? ' (has audio)' : '') + '</option>';
      }).join('');
      if (sid) stepSel.value = sid;
    };
    fillSteps(stepId);
    lessonSel.onchange = function () { fillSteps(); };
  }

  function loadLessons() {
    return api('GET', '/api/lessons').then(function (d) {
      S.lessons = d.lessons;
      S.lessonsMounted = d.mounted && d.lessons.length > 0;
      $('#source-lesson-btn').hidden = !S.lessonsMounted;
      if (S.lessonsMounted) fillLessonSelects($('#lesson-select'), $('#step-select'));
    }).catch(function () { /* lessons are optional */ });
  }

  $('#lesson-load').addEventListener('click', function () {
    var lesson = $('#lesson-select').value, step = $('#step-select').value;
    if (!lesson || !step) return;
    api('GET', '/api/lesson-step?lesson=' + encodeURIComponent(lesson) + '&step=' + encodeURIComponent(step)).then(function (d) {
      $('#text').value = d.text;
      $('#out-name').value = d.lesson + ', ' + d.step;
      setSplit('line');
      S.loadedSource = { lesson: lesson, step: step };
      if (!d.text) toast('This step has no subtitles yet. Type the narration, one subtitle per line.');
      else toast('Loaded ' + d.text.split('\n').length + ' subtitles. Each line stays one subtitle.');
    }).catch(function (e) { toast(e.message, true); });
  });

  // ------------------------------------------------------------------ preview, generate

  $('#preview-btn').addEventListener('click', function () {
    var e = currentEngine(), voice = $('#voice').value;
    var first = splitText($('#text').value, S.split)[0] || 'Hallo, dit is een korte test van deze stem.';
    if (!e || !voice) { toast('Choose a model and a voice first', true); return; }
    var btn = this;
    btn.disabled = true;
    api('POST', '/api/preview', { engine: e.id, voice: voice, params: currentParams(), text: first })
      .then(playBlob)
      .catch(function (err) { toast(err.message, true); })
      .then(function () { btn.disabled = false; });
  });

  $('#generate').addEventListener('click', function () {
    var e = currentEngine();
    if (!e) return;
    var payload = {
      id: S.job ? S.job.id : undefined,
      engine: e.id,
      voice: $('#voice').value,
      params: currentParams(),
      split: S.split,
      text: $('#text').value,
      name: $('#out-name').value,
      timing: { leadIn: +$('#t-lead').value || 0, gap: +$('#t-gap').value || 0, tail: +$('#t-tail').value || 0 },
      source: S.source === 'lesson' && S.loadedSource ? S.loadedSource : (S.job && S.job.source) || null
    };
    var btn = this;
    btn.disabled = true;
    api('POST', '/api/jobs', payload).then(function (job) {
      S.settings.last = { engine: payload.engine, voice: payload.voice, split: payload.split, timing: payload.timing,
        params: Object.assign({}, S.settings.last.params || {}, (function () { var o = {}; o[payload.engine] = payload.params; return o; })()) };
      setJob(job);
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) { toast(err.message, true); }).then(function () { btn.disabled = false; });
  });

  $('#new-btn').addEventListener('click', function () {
    S.job = null;
    S.loadedSource = null;
    $('#out-name').value = '';
    $('#text').value = '';
    $('#result').hidden = true;
    $('#generate').textContent = 'Generate';
    updateCount();
    $('#text').focus();
  });

  // ------------------------------------------------------------------ job rendering and polling

  function setJob(job) {
    S.job = job;
    $('#generate').textContent = 'Update';
    renderJob();
    poll();
  }

  function poll() {
    clearTimeout(S.pollTimer);
    if (!S.job || (S.job.state !== 'queued' && S.job.state !== 'running')) return;
    S.pollTimer = setTimeout(function () {
      api('GET', '/api/jobs/' + S.job.id).then(function (job) {
        var was = S.job.state;
        S.job = job;
        renderJob();
        if (job.state === 'done' && was !== 'done') { toast('Ready: ' + fmtLen(job.result.duration) + ' of audio'); refreshStatus(); }
        if (job.state === 'error' && was !== 'error') toast(job.error, true);
        poll();
      }).catch(function () { poll(); });
    }, 700);
  }

  function renderJob() {
    var j = S.job;
    if (!j) { $('#result').hidden = true; return; }
    $('#result').hidden = false;
    $('#r-name').textContent = j.name;
    var pill = $('#r-state');
    var label = { queued: 'Waiting', running: 'Generating', done: 'Ready', error: 'Failed' }[j.state] || j.state;
    pill.textContent = label;
    pill.className = 'pill ' + j.state;

    var busy = j.state === 'queued' || j.state === 'running';
    var prog = $('#r-progress');
    prog.hidden = !busy;
    if (busy && j.progress) prog.firstElementChild.style.width = (j.progress.total ? j.progress.done / j.progress.total * 100 : 0) + '%';
    $('#r-error').hidden = j.state !== 'error';
    $('#r-error').textContent = j.error || '';

    var v = encodeURIComponent(j.updated || '');
    $('#dl-mp3').href = '/files/' + j.id + '/audio.mp3?download=1&v=' + v;
    $('#dl-vtt').href = '/files/' + j.id + '/subtitles.vtt?download=1&v=' + v;
    $('.result-actions').hidden = !j.result;

    var player = $('#player');
    if (j.result && j.state === 'done') {
      var src = '/files/' + j.id + '/audio.mp3?v=' + v;
      if (player.dataset.src !== src) { player.dataset.src = src; player.src = src; }
      player.hidden = false;
      if (S.waveFor !== src) loadWave(src);
    } else if (!j.result) {
      player.hidden = true;
      $('#wave-wrap').hidden = true;
    }

    // Save to lesson
    var save = $('#save-lesson');
    save.hidden = !(S.lessonsMounted && j.state === 'done');
    if (!save.hidden && save.dataset.for !== j.id) {
      save.dataset.for = j.id;
      var src2 = j.source || j.savedTo || {};
      fillLessonSelects($('#save-lesson-select'), $('#save-step-select'), src2.lesson, src2.step);
      $('#save-lesson-msg').textContent = j.savedTo ? 'Last saved ' + fmtDate(j.savedTo.at) : '';
    }

    renderLines();
  }

  function renderLines() {
    var j = S.job, ol = $('#lines');
    var busy = j.state === 'queued' || j.state === 'running';
    var current = j.progress && j.progress.current;
    if (ol.querySelector('input')) return; // do not clobber an edit in progress
    ol.innerHTML = j.lines.map(function (l, i) {
      var text = l.shown != null ? l.shown : l.cue.replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$1');
      var take = l.variant ? '<span class="variant">take ' + (l.variant + 1) + '</span>' : '';
      return '<li data-i="' + i + '" class="' + (busy && current === i ? 'busy' : '') + '">' +
        '<span class="t">' + (l.start != null ? fmtTime(l.start) : '') + '</span>' +
        '<span class="txt" title="' + esc(spokenPreview(l.cue)) + '">' + esc(text) + take + '</span>' +
        '<span class="tools">' +
        '<button type="button" class="btn small icon-btn" data-act="play" aria-label="Play line ' + (i + 1) + '"' + (l.start == null || busy ? ' disabled' : '') + '>' + ICON.play + '</button>' +
        '<button type="button" class="btn small icon-btn" data-act="reroll" aria-label="Generate line ' + (i + 1) + ' again" title="Generate this sentence again"' + (busy ? ' disabled' : '') + '>' + ICON.reroll + '</button>' +
        '<button type="button" class="btn small icon-btn" data-act="edit" aria-label="Edit line ' + (i + 1) + '" title="Edit this sentence"' + (busy ? ' disabled' : '') + '>' + ICON.edit + '</button>' +
        '</span></li>';
    }).join('');
    highlightLine();
  }

  $('#lines').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn || !S.job) return;
    var li = btn.closest('li'), i = +li.dataset.i, line = S.job.lines[i];
    if (btn.dataset.act === 'play') playRange(line.start, line.end);
    if (btn.dataset.act === 'reroll') {
      api('POST', '/api/outputs/' + S.job.id + '/lines/' + i, {}).then(setJob).catch(function (e) { toast(e.message, true); });
    }
    if (btn.dataset.act === 'edit') {
      var txt = li.querySelector('.txt');
      txt.innerHTML = '<input type="text" aria-label="Line ' + (i + 1) + '">';
      var inp = txt.querySelector('input');
      inp.value = line.cue;
      inp.focus();
      var done = false;
      var finish = function (save) {
        if (done) return;
        done = true;
        var val = inp.value.trim();
        txt.innerHTML = '';
        if (save && val && val !== line.cue) {
          api('POST', '/api/outputs/' + S.job.id + '/lines/' + i, { text: val }).then(function (job) {
            setJob(job);
            $('#text').value = job.text;
            setSplit('line');
          }).catch(function (e) { toast(e.message, true); renderLines(); });
        } else renderLines();
      };
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') finish(false);
      });
      inp.addEventListener('blur', function () { finish(true); });
    }
  });

  function playRange(start, end) {
    var p = $('#player');
    p.currentTime = Math.max(0, start - 0.05);
    S.stopAt = end + 0.1;
    p.play();
  }

  $('#save-lesson-btn').addEventListener('click', function () {
    var lesson = $('#save-lesson-select').value, step = $('#save-step-select').value;
    if (!lesson || !step || !S.job) return;
    api('POST', '/api/outputs/' + S.job.id + '/save-to-lesson', { lesson: lesson, step: step }).then(function (r) {
      $('#save-lesson-msg').textContent = 'Saved to ' + r.path;
      toast(r.warning ? 'Saved. ' + r.warning : 'Saved audio.mp3 and subtitles to ' + r.path, !!r.warning);
      loadLessons();
      api('GET', '/api/jobs/' + S.job.id).then(function (j) { S.job = j; });
    }).catch(function (e) { toast(e.message, true); });
  });

  // ------------------------------------------------------------------ waveform

  var actx = null;
  function loadWave(src) {
    S.waveFor = src;
    fetch(src).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      return new Promise(function (res, rej) { actx.decodeAudioData(buf, res, rej); });
    }).then(function (audio) {
      if (S.waveFor !== src) return;
      var data = audio.getChannelData(0), buckets = 1200, size = Math.floor(data.length / buckets) || 1, peaks = new Float32Array(buckets);
      for (var b = 0; b < buckets; b++) {
        var max = 0;
        for (var k = b * size, end = Math.min(data.length, k + size); k < end; k += 4) { var v = Math.abs(data[k]); if (v > max) max = v; }
        peaks[b] = max;
      }
      var top = 0;
      for (var q = 0; q < buckets; q++) if (peaks[q] > top) top = peaks[q];
      S.peaks = { values: peaks, top: top || 1, duration: audio.duration };
      $('#wave-wrap').hidden = false;
      drawWave();
    }).catch(function () { $('#wave-wrap').hidden = true; });
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function drawWave() {
    var c = $('#wave');
    if (!S.peaks || !S.job || $('#wave-wrap').hidden || !c.offsetWidth) return;
    var dpr = window.devicePixelRatio || 1, w = c.offsetWidth, h = c.offsetHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var dur = S.peaks.duration, x = function (t) { return t / dur * w; };
    var p = $('#player'), now = p.currentTime || 0;

    // One region per subtitle, numbered.
    g.font = '600 11px ' + cssVar('--mono');
    g.textBaseline = 'top';
    S.job.lines.forEach(function (l, i) {
      if (l.start == null) return;
      g.fillStyle = cssVar(i % 2 ? '--region-b' : '--region-a');
      g.fillRect(x(l.start), 0, Math.max(1, x(l.end) - x(l.start)), h);
      g.fillStyle = cssVar('--muted');
      if (x(l.end) - x(l.start) > 16) g.fillText(String(i + 1), x(l.start) + 4, 5);
    });

    // Bars
    var vals = S.peaks.values, n = vals.length, bar = 2, gapPx = 1, count = Math.floor(w / (bar + gapPx));
    var mid = h / 2 + 6, amp = (h - 26) / 2;
    for (var b = 0; b < count; b++) {
      var i0 = Math.floor(b / count * n), i1 = Math.floor((b + 1) / count * n), m = 0;
      for (var k = i0; k < Math.max(i1, i0 + 1); k++) if (vals[k] > m) m = vals[k];
      var bh = Math.max(1, m / S.peaks.top * amp);
      var bx = b * (bar + gapPx);
      g.fillStyle = cssVar(bx <= x(now) ? '--wave-active' : '--wave');
      g.fillRect(bx, mid - bh, bar, bh * 2);
    }
    // Playhead
    g.fillStyle = cssVar('--fg');
    g.fillRect(Math.round(x(now)), 0, 1.5, h);
  }

  $('#wave').addEventListener('click', function (e) {
    if (!S.peaks) return;
    var r = this.getBoundingClientRect();
    var p = $('#player');
    p.currentTime = (e.clientX - r.left) / r.width * S.peaks.duration;
    S.stopAt = null;
    drawWave();
    highlightLine();
  });

  function highlightLine() {
    if (!S.job) return;
    var t = $('#player').currentTime || 0;
    $$('#lines li').forEach(function (li) {
      var l = S.job.lines[+li.dataset.i];
      li.classList.toggle('current', l.start != null && t >= l.start && t < l.end + 0.2 && !$('#player').paused);
    });
  }

  (function loop() {
    var p = $('#player');
    if (!p.paused) {
      if (S.stopAt != null && p.currentTime >= S.stopAt) { p.pause(); S.stopAt = null; }
      drawWave();
      highlightLine();
    }
    requestAnimationFrame(loop);
  })();
  $('#player').addEventListener('pause', function () { drawWave(); highlightLine(); });
  $('#player').addEventListener('seeked', drawWave);
  window.addEventListener('resize', drawWave);

  // ------------------------------------------------------------------ voices (cloning)

  var rec = { stream: null, recorder: null, chunks: [], blob: null, started: 0, timer: null, analyser: null };

  function loadVoices() {
    return api('GET', '/api/voices').then(function (d) {
      var st = d.status;
      var cs = $('#clone-status');
      if (!st) cs.textContent = 'Chatterbox is not configured in this stack.';
      else if (!st.online) cs.textContent = 'Chatterbox is not reachable: ' + st.message + '. Start the chatterbox container first.';
      else if (!st.ready) cs.textContent = 'Chatterbox is still starting (' + st.message + '). The first start downloads the model, which can take a few minutes.';
      else cs.textContent = 'Your recording is uploaded to Chatterbox, which uses it as the reference for this voice.';
      var langSel = $('#clone-lang'), keep = langSel.value || 'nl';
      var langs = d.languages || {};
      langSel.innerHTML = Object.keys(langs).sort(function (a, b) { return langs[a].localeCompare(langs[b]); }).map(function (code) {
        return '<option value="' + esc(code) + '">' + esc(langs[code]) + ' (' + esc(code) + ')</option>';
      }).join('');
      langSel.value = langs[keep] ? keep : (langs.nl ? 'nl' : langSel.value);

      var ul = $('#voice-list');
      if (!d.voices.length) { ul.innerHTML = '<li class="empty">No cloned voices yet.</li>'; return; }
      ul.innerHTML = d.voices.map(function (v) {
        return '<li data-name="' + esc(v.name) + '"><span class="vname">' + esc(v.name) + '</span>' +
          '<span class="vmeta">' + esc((langs[v.language] || v.language || '') + (v.uploaded ? ' · added ' + fmtDate(v.uploaded) : '')) + '</span>' +
          '<span class="tools">' +
          '<button type="button" class="btn small" data-act="sample">Recording</button>' +
          '<button type="button" class="btn small" data-act="test">Test</button>' +
          '<button type="button" class="btn small" data-act="use">Use</button>' +
          '<button type="button" class="btn small danger" data-act="delete">Delete</button></span></li>';
      }).join('');
    }).catch(function (e) { $('#clone-status').textContent = e.message; });
  }

  $('#voice-list').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var name = btn.closest('li').dataset.name;
    if (btn.dataset.act === 'sample') api('GET', '/api/voices/' + encodeURIComponent(name) + '/sample').then(playBlob).catch(function (e) { toast(e.message, true); });
    if (btn.dataset.act === 'test') {
      btn.disabled = true;
      api('POST', '/api/preview', { engine: 'chatterbox', voice: name, text: $('#test-text').value, params: (S.settings.last.params || {}).chatterbox || {} })
        .then(playBlob).catch(function (e) { toast(e.message, true); }).then(function () { btn.disabled = false; });
    }
    if (btn.dataset.act === 'use') useVoice('chatterbox', name);
    if (btn.dataset.act === 'delete') confirmClick(btn, 'Confirm delete', function () {
      api('DELETE', '/api/voices/' + encodeURIComponent(name)).then(function () { toast('Deleted ' + name); loadVoices(); loadEngines(); })
        .catch(function (e) { toast(e.message, true); });
    });
  });

  function useVoice(engineId, voice) {
    loadEngines().then(function () {
      $('#engine').value = engineId;
      renderEngine(voice);
      showView('narrate');
    });
  }

  function setClip(blob, label) {
    rec.blob = blob;
    var a = $('#clip-audio');
    if (a.src) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(blob);
    $('#clip-preview').hidden = false;
    $('#clip-info').textContent = label;
    a.onloadedmetadata = function () {
      if (isFinite(a.duration)) $('#clip-info').textContent = label + ' · ' + a.duration.toFixed(1) + ' s' + (a.duration < 8 ? '. Shorter than 10 seconds usually sounds less like you.' : '');
    };
    updateCloneBtn();
  }

  function updateCloneBtn() {
    $('#clone-btn').disabled = !(rec.blob && $('#clone-name').value.trim());
  }
  $('#clone-name').addEventListener('input', updateCloneBtn);

  $('#clone-file').addEventListener('change', function () {
    var f = this.files[0];
    if (f) setClip(f, f.name);
  });

  var canRecord = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder;
  if (!canRecord) {
    $('#rec-btn').disabled = true;
    $('#rec-hint').textContent = window.isSecureContext
      ? 'This browser cannot record audio. Upload a recording instead.'
      : 'Browsers only allow the microphone on HTTPS or localhost. Open the studio through your HTTPS reverse proxy to record here, or upload a recording.';
  }

  function stopRecording() {
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  }

  $('#rec-btn').addEventListener('click', function () {
    if (rec.recorder && rec.recorder.state === 'recording') { stopRecording(); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } }).then(function (stream) {
      rec.stream = stream;
      rec.chunks = [];
      var mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0];
      rec.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.recorder.ondataavailable = function (e) { if (e.data.size) rec.chunks.push(e.data); };
      rec.recorder.onstop = function () {
        clearInterval(rec.timer);
        stream.getTracks().forEach(function (t) { t.stop(); });
        $('#rec-btn').classList.remove('on');
        $('#rec-label').textContent = 'Record again';
        var type = rec.recorder.mimeType || 'audio/webm';
        var ext = type.indexOf('ogg') >= 0 ? 'ogg' : type.indexOf('mp4') >= 0 ? 'm4a' : 'webm';
        var blob = new Blob(rec.chunks, { type: type });
        blob.name = 'recording.' + ext;
        setClip(blob, 'Your recording');
      };
      // Level meter
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var srcNode = actx.createMediaStreamSource(stream);
      rec.analyser = actx.createAnalyser();
      rec.analyser.fftSize = 1024;
      srcNode.connect(rec.analyser);
      rec.started = Date.now();
      rec.recorder.start(250);
      $('#rec-btn').classList.add('on');
      $('#rec-label').textContent = 'Stop';
      rec.timer = setInterval(function () {
        var s = (Date.now() - rec.started) / 1000;
        $('#rec-time').textContent = Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
        drawMeter();
        if (s >= 40) stopRecording();
      }, 50);
    }).catch(function (e) { toast('Could not use the microphone: ' + e.message, true); });
  });

  function drawMeter() {
    var c = $('#meter'), g = c.getContext('2d'), buf = new Uint8Array(rec.analyser.fftSize);
    rec.analyser.getByteTimeDomainData(buf);
    var peak = 0;
    for (var i = 0; i < buf.length; i++) { var v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v; }
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = cssVar('--line');
    g.fillRect(0, 10, c.width, 8);
    g.fillStyle = cssVar(peak > 0.95 ? '--danger' : peak > 0.7 ? '--warn' : '--ok');
    g.fillRect(0, 10, Math.min(1, peak) * c.width, 8);
  }

  $('#clone-btn').addEventListener('click', function () {
    var fd = new FormData();
    fd.append('name', $('#clone-name').value.trim());
    fd.append('language', $('#clone-lang').value);
    fd.append('trim', $('#clone-trim').checked ? '1' : '0');
    fd.append('file', rec.blob, rec.blob.name || 'recording.webm');
    var btn = this;
    btn.disabled = true;
    $('#clone-msg').textContent = 'Uploading and preparing the recording…';
    api('POST', '/api/voices', fd).then(function (r) {
      $('#clone-msg').textContent = 'Added ' + r.name + ' (' + r.duration + ' s of speech).' + (r.note ? ' ' + r.note : '') + ' Press Test to hear it.';
      toast('Voice ' + r.name + ' added');
      loadVoices();
      loadEngines();
    }).catch(function (e) { $('#clone-msg').textContent = e.message; toast(e.message, true); })
      .then(function () { updateCloneBtn(); });
  });

  // ------------------------------------------------------------------ Piper

  var piperCatalog = null, piperPoll = null;

  function loadPiper(withCatalog) {
    api('GET', '/api/piper/voices').then(function (d) {
      var ul = $('#piper-installed');
      ul.innerHTML = d.voices.length ? d.voices.map(function (v) {
        return '<li data-id="' + esc(v.id) + '"><span class="vname">' + esc(v.name) + '</span>' +
          '<span class="vmeta">' + esc(v.language) + ' · ' + fmtBytes(v.size) + (v.speakers > 1 ? ' · ' + v.speakers + ' speakers' : '') + '</span>' +
          '<span class="tools"><button type="button" class="btn small" data-act="test">Test</button>' +
          '<button type="button" class="btn small" data-act="use">Use</button>' +
          '<button type="button" class="btn small danger" data-act="remove">Remove</button></span></li>';
      }).join('') : '<li class="empty">' + esc(d.status.online ? 'No Piper voices installed. Download one below.' : d.status.message) + '</li>';
      var running = Object.keys(d.installs || {}).some(function (k) { return d.installs[k].state === 'running'; });
      if (piperCatalog) {
        piperCatalog.forEach(function (v) {
          v.install = (d.installs || {})[v.id] || null;
          v.installed = d.voices.some(function (x) { return x.id === v.id; });
        });
        renderCatalog();
      }
      clearTimeout(piperPoll);
      if (running) piperPoll = setTimeout(function () { loadPiper(false); }, 800);
      else loadEngines();
    }).catch(function (e) { toast(e.message, true); });

    if (withCatalog && !piperCatalog) {
      api('GET', '/api/piper/catalog').then(function (d) {
        piperCatalog = d.voices;
        var fams = {};
        piperCatalog.forEach(function (v) { var f = v.language.split('_')[0]; fams[f] = fams[f] || (v.languageName || f).split(' / ')[0]; });
        var sel = $('#piper-lang');
        sel.innerHTML = '<option value="">All languages</option>' + Object.keys(fams).sort(function (a, b) { return fams[a].localeCompare(fams[b]); })
          .map(function (f) { return '<option value="' + f + '">' + esc(fams[f]) + '</option>'; }).join('');
        sel.value = fams.nl ? 'nl' : '';
        $('#piper-catalog-msg').textContent = piperCatalog.length + ' voices in the Piper catalog. Medium quality is a good balance of size and sound; listen to samples on the Piper website.';
        renderCatalog();
      }).catch(function (e) { $('#piper-catalog-msg').textContent = 'Could not load the voice list: ' + e.message; });
    }
  }

  function renderCatalog() {
    if (!piperCatalog) return;
    var fam = $('#piper-lang').value, q = $('#piper-search').value.trim().toLowerCase();
    var rows = piperCatalog.filter(function (v) {
      return (!fam || v.language.split('_')[0] === fam) && (!q || (v.id + ' ' + v.languageName).toLowerCase().indexOf(q) >= 0);
    });
    $('#piper-catalog').innerHTML = rows.map(function (v) {
      var action;
      if (v.install && v.install.state === 'running') action = '<span class="bar"><i style="width:' + Math.round(v.install.progress * 100) + '%"></i></span>' + Math.round(v.install.progress * 100) + '%';
      else if (v.installed) action = '<span class="hint">Installed</span>';
      else action = '<button type="button" class="btn small" data-install="' + esc(v.id) + '">Download</button>' +
        (v.install && v.install.state === 'error' ? '<span class="sub">' + esc(v.install.error) + '</span>' : '');
      return '<tr><td>' + esc(v.name) + '<span class="sub">' + esc(v.id) + '</span></td><td>' + esc(v.languageName || v.language) + '</td>' +
        '<td>' + esc(v.quality || '') + (v.speakers > 1 ? '<span class="sub">' + v.speakers + ' speakers</span>' : '') + '</td>' +
        '<td class="num">' + fmtBytes(v.size) + '</td><td class="act">' + action + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="hint">No voices match.</td></tr>';
  }
  $('#piper-lang').addEventListener('change', renderCatalog);
  $('#piper-search').addEventListener('input', renderCatalog);
  $('#piper-catalog').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-install]');
    if (!btn) return;
    btn.disabled = true;
    api('POST', '/api/piper/voices/' + encodeURIComponent(btn.dataset.install)).then(function () { loadPiper(false); })
      .catch(function (e) { toast(e.message, true); btn.disabled = false; });
  });
  $('#piper-installed').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.closest('li').dataset.id;
    if (btn.dataset.act === 'use') useVoice('piper', id);
    if (btn.dataset.act === 'test') {
      api('POST', '/api/preview', { engine: 'piper', voice: id, text: $('#test-text').value, params: {} })
        .then(playBlob).catch(function (e) { toast(e.message, true); });
    }
    if (btn.dataset.act === 'remove') confirmClick(btn, 'Confirm remove', function () {
      api('DELETE', '/api/piper/voices/' + encodeURIComponent(id)).then(function () { loadPiper(false); }).catch(function (e) { toast(e.message, true); });
    });
  });

  // ------------------------------------------------------------------ library

  function loadLibrary() {
    api('GET', '/api/outputs').then(function (d) {
      var rows = d.outputs;
      $('#lib-count').textContent = rows.length ? rows.length + (rows.length === 1 ? ' output' : ' outputs') : '';
      $('#lib-empty').hidden = rows.length > 0;
      var engineName = function (id) { var e = S.engines.filter(function (x) { return x.id === id; })[0]; return e ? e.name : id; };
      $('#library').innerHTML = rows.map(function (o) {
        var state = o.state === 'done' ? '' : '<span class="pill ' + o.state + '">' + esc(o.state) + '</span> ';
        var saved = o.savedTo ? '<span class="sub">Saved to ' + esc(o.savedTo.lesson + ' / ' + o.savedTo.step) + '</span>' : '';
        return '<tr data-id="' + esc(o.id) + '"><td>' + state + esc(o.name) + saved + '</td>' +
          '<td>' + esc(o.voice) + '<span class="sub">' + esc(engineName(o.engine)) + '</span></td>' +
          '<td class="num">' + fmtLen(o.duration) + '<span class="sub">' + o.lines + ' lines</span></td>' +
          '<td>' + esc(fmtDate(o.updated)) + '</td>' +
          '<td class="act"><button type="button" class="btn small" data-act="open">Open</button>' +
          (o.duration ? '<a class="btn small" href="/files/' + esc(o.id) + '/audio.mp3?download=1">MP3</a>' +
            '<a class="btn small" href="/files/' + esc(o.id) + '/subtitles.vtt?download=1">VTT</a>' : '') +
          '<button type="button" class="btn small danger" data-act="delete">Delete</button></td></tr>';
      }).join('');
    }).catch(function (e) { toast(e.message, true); });
  }

  $('#library').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var id = btn.closest('tr').dataset.id;
    if (btn.dataset.act === 'open') openOutput(id);
    if (btn.dataset.act === 'delete') confirmClick(btn, 'Confirm delete', function () {
      api('DELETE', '/api/outputs/' + id).then(function () {
        if (S.job && S.job.id === id) $('#new-btn').click();
        loadLibrary();
      }).catch(function (e) { toast(e.message, true); });
    });
  });

  function openOutput(id) {
    api('GET', '/api/jobs/' + id).then(function (job) {
      $('#out-name').value = job.name;
      $('#text').value = job.text;
      setSplit(job.split || 'sentence');
      if (job.timing) { $('#t-lead').value = job.timing.leadIn; $('#t-gap').value = job.timing.gap; $('#t-tail').value = job.timing.tail; }
      S.loadedSource = job.source || null;
      setSource(job.source && S.lessonsMounted ? 'lesson' : 'text');
      if (job.source && S.lessonsMounted) fillLessonSelects($('#lesson-select'), $('#step-select'), job.source.lesson, job.source.step);
      $('#engine').value = job.engine;
      var saved = S.settings.last.params || {};
      saved[job.engine] = job.params || {};
      S.settings.last.params = saved;
      renderEngine(job.voice);
      setJob(job);
      showView('narrate');
    }).catch(function (e) { toast(e.message, true); });
  }

  // ------------------------------------------------------------------ settings

  function loadSettingsView() {
    api('GET', '/api/settings').then(function (s) { $('#lexicon').value = s.lexicon || ''; });
    refreshStatus().then(function (st) {
      if (!st) return;
      $('#cache-stat').textContent = st.cache.files + ' clips, ' + fmtBytes(st.cache.bytes);
      $('#conn').innerHTML = st.engines.map(function (e) {
        return '<dt>' + esc(e.name) + '</dt><dd>' + esc(e.status.message) + '</dd>';
      }).join('') + '<dt>Lessons</dt><dd>' + (st.lessons ? 'Mounted' : 'Not mounted') + '</dd>';
    });
  }
  $('#lexicon-save').addEventListener('click', function () {
    api('PUT', '/api/settings', { lexicon: $('#lexicon').value }).then(function () {
      $('#lexicon-msg').textContent = 'Saved. New generations use it; press Update on an output to apply it there.';
    }).catch(function (e) { toast(e.message, true); });
  });
  $('#cache-clear').addEventListener('click', function () {
    var btn = this;
    confirmClick(btn, 'Confirm clear', function () {
      api('DELETE', '/api/cache').then(function (st) { $('#cache-stat').textContent = st.files + ' clips, ' + fmtBytes(st.bytes); toast('Cache cleared'); });
    });
  });

  // ------------------------------------------------------------------ start

  api('GET', '/api/settings').then(function (s) {
    S.settings = s;
    S.settings.last = s.last || {};
    var last = S.settings.last;
    if (last.split) setSplit(last.split);
    if (last.timing) { $('#t-lead').value = last.timing.leadIn; $('#t-gap').value = last.timing.gap; $('#t-tail').value = last.timing.tail; }
  }).catch(function () { /* defaults */ }).then(function () {
    return Promise.all([loadEngines(), loadLessons(), refreshStatus()]);
  }).then(function () {
    var view = location.hash.slice(1);
    if (['voices', 'piper', 'library', 'settings'].indexOf(view) >= 0) showView(view);
  });
  setInterval(refreshStatus, 15000);
  updateCount();
})();
