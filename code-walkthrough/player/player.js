/*
 * Code Walkthrough Player
 *
 * Plays a lesson made of independent steps. Every step is its own folder with:
 *   step.json       title, timing and optional overrides
 *   code.<ext>      the full code as it should look at the END of the step
 *   audio.mp3       narration (optional)
 *   subtitles.vtt   WebVTT captions (optional, also used for timing and browser voice)
 *   explainer.md    text for the explainer panel (optional)
 *
 * The player diffs each step's code against the previous step and "types" the
 * difference while the step plays. Because the editor state is a pure function
 * of (step, time), you can seek anywhere and swap any single file without
 * touching the others.
 *
 * Usage:
 *   CodePlayer.mount(document.getElementById('player'), 'lessons/clicker-button/');
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Diff and typing model
  // ---------------------------------------------------------------------------

  var DEL_COST = 0.2; // backspacing is 5x faster than typing

  function charCost(c) {
    return c === ' ' || c === '\t' ? 0.35 : 1; // indentation goes quickly
  }

  function normalizeCode(s) {
    s = (s || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    return s ? s + '\n' : '';
  }

  function splitLines(s) {
    return s.match(/[^\n]*\n|[^\n]+$/g) || [];
  }

  // Line based LCS diff, then refined to characters inside each changed hunk.
  function diff(a, b) {
    var A = splitLines(a), B = splitLines(b);
    var n = A.length, m = B.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var raw = [];
    function push(type, text) {
      var last = raw[raw.length - 1];
      if (last && last.type === type) last.text += text;
      else raw.push({ type: type, text: text });
    }
    i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
      else { push('ins', B[j]); j++; }
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('ins', B[j++]);

    // Refine "del followed by ins" so a changed word is not retyped as a whole line.
    var ops = [];
    function out(type, text) {
      if (!text) return;
      var last = ops[ops.length - 1];
      if (last && last.type === type) last.text += text;
      else ops.push({ type: type, text: text });
    }
    for (var k = 0; k < raw.length; k++) {
      var op = raw[k], next = raw[k + 1];
      if (op.type === 'del' && next && next.type === 'ins') {
        var d = op.text, s = next.text, p = 0, q = 0;
        var max = Math.min(d.length, s.length);
        while (p < max && d[p] === s[p]) p++;
        while (q < max - p && d[d.length - 1 - q] === s[s.length - 1 - q]) q++;
        out('eq', d.slice(0, p));
        out('del', d.slice(p, d.length - q));
        out('ins', s.slice(p, s.length - q));
        out('eq', d.slice(d.length - q));
        k++;
      } else {
        out(op.type, op.text);
      }
    }
    return ops;
  }

  function opsCost(ops) {
    var total = 0;
    ops.forEach(function (op) {
      if (op.type === 'del') total += op.text.length * DEL_COST;
      else if (op.type === 'ins') for (var i = 0; i < op.text.length; i++) total += charCost(op.text[i]);
    });
    return total;
  }

  // Text after spending `budget` typing units. Returns text, caret index and
  // the ranges inserted so far (used to highlight what this step added).
  function stateAt(ops, budget) {
    var text = '', caret = 0, stopped = false, ranges = [];
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.type === 'eq') { text += op.text; continue; }
      if (stopped) { if (op.type === 'del') text += op.text; continue; }
      if (op.type === 'del') {
        var cost = op.text.length * DEL_COST;
        if (budget >= cost) { budget -= cost; }
        else {
          var removed = Math.floor(budget / DEL_COST);
          text += op.text.slice(0, op.text.length - removed);
          stopped = true; budget = 0;
        }
        caret = text.length;
      } else {
        var k = 0;
        while (k < op.text.length && budget >= charCost(op.text[k])) { budget -= charCost(op.text[k]); k++; }
        if (k > 0) ranges.push([text.length, text.length + k]);
        text += op.text.slice(0, k);
        caret = text.length;
        if (k < op.text.length) stopped = true;
      }
    }
    return { text: text, caret: caret, ranges: ranges };
  }

  // ---------------------------------------------------------------------------
  // Small parsers
  // ---------------------------------------------------------------------------

  function parseTime(s) {
    var p = s.split(':').map(parseFloat);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }

  function parseVTT(src) {
    var cues = [];
    (src || '').replace(/\r/g, '').split(/\n{2,}/).forEach(function (block) {
      var lines = block.split('\n');
      var idx = -1;
      for (var i = 0; i < lines.length; i++) if (lines[i].indexOf('-->') >= 0) { idx = i; break; }
      if (idx < 0) return;
      var parts = lines[idx].split('-->');
      var raw = lines.slice(idx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (!raw) return;
      // [[shown|spoken]]: show the first part, speak the second (see tools/narrate.py)
      var override = /\[\[([^|\]]*)\|([^\]]*)\]\]/g;
      cues.push({
        start: parseTime(parts[0].trim()),
        end: parseTime(parts[1].trim().split(/\s+/)[0]),
        text: raw.replace(override, '$1'),
        spoken: raw.replace(override, '$2')
      });
    });
    return cues.sort(function (a, b) { return a.start - b.start; });
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inlineMd(s) {
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
        if (!/^(https?:|#|\.{0,2}\/|[\w-]+\.)/.test(href)) return label;
        return '<a href="' + href + '" target="_blank" rel="noopener">' + label + '</a>';
      });
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + esc(codes[+i]) + '</code>'; });
  }

  // Deliberately small Markdown renderer: headings, paragraphs, lists,
  // blockquotes, fenced code, inline code, bold, italic, links.
  function renderMarkdown(src) {
    var lines = (src || '').replace(/\r/g, '').split('\n');
    var html = [], para = [], list = null, i = 0;
    function flushPara() { if (para.length) { html.push('<p>' + inlineMd(para.join(' ')) + '</p>'); para = []; } }
    function flushList() { if (list) { html.push('<' + list.tag + '>' + list.items.map(function (it) { return '<li>' + inlineMd(it) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    while (i < lines.length) {
      var line = lines[i], m;
      if ((m = line.match(/^```(\w*)/))) {
        flushPara(); flushList();
        var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        html.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        i++; continue;
      }
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
        flushPara(); flushList();
        var level = Math.min(m[1].length + 1, 5);
        html.push('<h' + level + '>' + inlineMd(m[2]) + '</h' + level + '>');
      } else if ((m = line.match(/^\s*([-*]|\d+\.)\s+(.*)/))) {
        flushPara();
        var tag = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
        list.items.push(m[2]);
      } else if ((m = line.match(/^>\s?(.*)/))) {
        flushPara(); flushList();
        html.push('<blockquote>' + inlineMd(m[1]) + '</blockquote>');
      } else if (!line.trim()) {
        flushPara(); flushList();
      } else if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += ' ' + line.trim();
      } else {
        flushList(); para.push(line.trim());
      }
      i++;
    }
    flushPara(); flushList();
    return html.join('\n');
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function fetchText(url) {
    return fetch(url).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
  }

  function loadAudio(url) {
    return new Promise(function (resolve) {
      var a = new Audio(), done = false;
      function finish(ok) { if (done) return; done = true; resolve(ok ? a : null); }
      a.preload = 'auto';
      a.addEventListener('loadedmetadata', function () { finish(isFinite(a.duration) && a.duration > 0); });
      a.addEventListener('error', function () { finish(false); });
      setTimeout(function () { finish(isFinite(a.duration) && a.duration > 0); }, 10000);
      a.src = url;
    });
  }

  function join(base, file) {
    return base.replace(/\/?$/, '/') + file;
  }

  // ---------------------------------------------------------------------------
  // Lesson loading
  // ---------------------------------------------------------------------------

  var FILE_DEFAULTS = { code: 'code.txt', audio: null, subtitles: 'subtitles.vtt', explainer: 'explainer.md' };

  function loadLesson(base) {
    return fetch(join(base, 'lesson.json')).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + join(base, 'lesson.json') + ' (HTTP ' + r.status + ')');
      return r.json();
    }).then(function (lesson) {
      var files = Object.assign({}, FILE_DEFAULTS, lesson.files || {});
      var stepsDir = lesson.stepsDir || 'steps';
      return Promise.all(lesson.steps.map(function (id) {
        var dir = join(join(base, stepsDir), id);
        return fetch(join(dir, 'step.json'))
          .then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; })
          .then(function (meta) {
            var f = Object.assign({}, files, meta.files || {});
            return Promise.all([
              f.code ? fetchText(join(dir, f.code)) : null,
              f.subtitles ? fetchText(join(dir, f.subtitles)) : null,
              f.explainer ? fetchText(join(dir, f.explainer)) : null,
              f.audio ? loadAudio(join(dir, f.audio)) : null
            ]).then(function (res) {
              return {
                id: id, dir: dir, meta: meta, files: f,
                code: normalizeCode(res[0]),
                codeMissing: res[0] == null,
                cues: parseVTT(res[1]),
                explainer: res[2],
                audio: res[3]
              };
            });
          });
      })).then(function (steps) {
        var prev = normalizeCode(lesson.starterCode || '');
        var offset = 0;
        steps.forEach(function (s) {
          if (s.codeMissing) s.code = prev; // a step without code keeps the previous code
          s.prevCode = prev;
          s.ops = diff(prev, s.code);
          s.cost = opsCost(s.ops);
          var lastCue = s.cues.length ? s.cues[s.cues.length - 1].end : 0;
          // Typing window. Cue numbers (1-based, as in the .vtt file) are
          // preferred because they keep typing in sync when the narration is
          // regenerated and the timings change. Seconds still work.
          var typing = s.meta.typing || {};
          var fromCue = typing.fromCue && s.cues[Math.min(typing.fromCue, s.cues.length) - 1];
          var toCue = typing.toCue && s.cues[Math.min(typing.toCue, s.cues.length) - 1];
          var start = fromCue ? fromCue.start : typing.start != null ? typing.start : 1;
          var end;
          if (toCue) end = toCue.end;
          else if (typing.end != null) end = typing.end;
          else end = start + s.cost / (typing.cps || lesson.cps || 14);
          s.duration = (s.audio && s.audio.duration) || s.meta.duration || Math.max(lastCue + 0.8, end + 1.5, 3);
          s.typeStart = start;
          s.typeEnd = Math.max(start + 0.05, Math.min(end, s.duration));
          s.offset = offset;
          offset += s.duration;
          prev = s.code;
        });
        return { lesson: lesson, steps: steps, total: offset };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Editor adapters: CodeMirror 5 when present, plain textarea otherwise
  // ---------------------------------------------------------------------------

  function codeMirrorEditor(host, opts) {
    var cm = global.CodeMirror(host, {
      value: '',
      mode: opts.mode,
      lineNumbers: true,
      tabSize: opts.tabSize,
      indentUnit: opts.tabSize,
      lineWrapping: false,
      viewportMargin: Infinity
    });
    var caretMark = null, marks = [], listeners = [];
    var caretEl = document.createElement('span');
    caretEl.className = 'cp-caret';
    cm.on('changes', function (_, changes) {
      var user = changes.some(function (c) { return c.origin !== 'playback' && c.origin !== 'setValue'; });
      if (user) listeners.forEach(function (fn) { fn(); });
    });
    return {
      kind: 'codemirror',
      get: function () { return cm.getValue(); },
      apply: function (text) {
        var cur = cm.getValue();
        if (cur === text) return false;
        var p = 0, max = Math.min(cur.length, text.length), s = 0;
        while (p < max && cur[p] === text[p]) p++;
        while (s < max - p && cur[cur.length - 1 - s] === text[text.length - 1 - s]) s++;
        cm.replaceRange(text.slice(p, text.length - s), cm.posFromIndex(p), cm.posFromIndex(cur.length - s), 'playback');
        return true;
      },
      caret: function (index) {
        if (caretMark) { caretMark.clear(); caretMark = null; }
        if (index == null) return;
        var pos = cm.posFromIndex(index);
        caretMark = cm.setBookmark(pos, { widget: caretEl, insertLeft: true });
        cm.scrollIntoView(pos, 48);
      },
      highlight: function (ranges) {
        cm.operation(function () {
          marks.forEach(function (m) { m.clear(); });
          marks = (ranges || []).map(function (r) {
            return cm.markText(cm.posFromIndex(r[0]), cm.posFromIndex(r[1]), { className: 'cp-new' });
          });
        });
      },
      batch: function (fn) { cm.operation(fn); },
      onUserChange: function (fn) { listeners.push(fn); },
      refresh: function () { cm.refresh(); }
    };
  }

  function textareaEditor(host, opts) {
    var ta = document.createElement('textarea');
    ta.className = 'cp-textarea';
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Lesson code');
    ta.style.tabSize = opts.tabSize;
    host.appendChild(ta);
    var listeners = [];
    ta.addEventListener('input', function () { listeners.forEach(function (fn) { fn(); }); });
    return {
      kind: 'textarea',
      get: function () { return ta.value; },
      apply: function (text) {
        if (ta.value === text) return false;
        var top = ta.scrollTop;
        ta.value = text;
        ta.scrollTop = top;
        return true;
      },
      caret: function () {},
      highlight: function () {},
      batch: function (fn) { fn(); },
      onUserChange: function (fn) { listeners.push(fn); },
      refresh: function () {}
    };
  }

  // ---------------------------------------------------------------------------
  // Preview documents
  // ---------------------------------------------------------------------------

  function consoleDoc(code, colors) {
    var src = JSON.stringify(code).replace(/</g, '\\u003c');
    return '<!doctype html><meta charset="utf-8"><style>' +
      'body{margin:0;padding:12px 14px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:' + colors.bg + ';color:' + colors.fg + '}' +
      '.l{padding:3px 0;border-bottom:1px solid ' + colors.line + ';white-space:pre-wrap;word-break:break-word}' +
      '.e{color:' + colors.err + '}.m{color:' + colors.muted + ';border:0}' +
      '</style><div id="o"></div><script>(function(){var o=document.getElementById("o");' +
      'function f(x){if(typeof x==="string")return x;try{return JSON.stringify(x)}catch(e){return String(x)}}' +
      'function show(a,c){var d=document.createElement("div");d.className="l "+(c||"");d.textContent=[].map.call(a,f).join(" ");o.appendChild(d)}' +
      'console.log=console.info=function(){show(arguments)};console.warn=console.error=function(){show(arguments,"e")};' +
      'window.onerror=function(m){show([m],"e")};' +
      'try{(0,eval)(' + src + ')}catch(e){show([e.name+": "+e.message],"e")}' +
      'if(!o.children.length)show(["No console output yet."],"m")})();<\/script>';
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  var ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.4v14H6zM19 5.5v13L9.5 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5H18v14h-2.4zM5 5.5v13l9.5-6.5z"/></svg>'
  };

  var TEMPLATE =
    '<section class="cp-stage">' +
      '<header class="cp-stage-head">' +
        '<span class="cp-step-no"></span>' +
        '<span class="cp-step-title"></span>' +
        '<span class="cp-lang"></span>' +
      '</header>' +
      '<div class="cp-editor-wrap">' +
        '<div class="cp-editor"></div>' +
        '<div class="cp-edited" hidden>' +
          '<span>You changed the code. Press play to continue the lesson; the lesson code will replace your changes.</span>' +
          '<button type="button" class="cp-restore">Restore lesson code</button>' +
        '</div>' +
      '</div>' +
      '<div class="cp-caption" aria-live="polite"></div>' +
      '<div class="cp-controls">' +
        '<div class="cp-buttons">' +
          '<button type="button" class="cp-btn cp-prev" aria-label="Previous step">' + ICON.prev + '</button>' +
          '<button type="button" class="cp-btn cp-play" aria-label="Play">' + ICON.play + '</button>' +
          '<button type="button" class="cp-btn cp-next" aria-label="Next step">' + ICON.next + '</button>' +
        '</div>' +
        '<div class="cp-scrub">' +
          '<div class="cp-track"><div class="cp-fill"></div><div class="cp-markers"></div><div class="cp-head"></div></div>' +
          '<input type="range" class="cp-range" min="0" max="1" step="0.01" value="0" aria-label="Lesson position">' +
        '</div>' +
        '<span class="cp-time">0:00 / 0:00</span>' +
        '<div class="cp-options">' +
          '<label class="cp-select" title="Speed of audio, subtitles and timeline"><span class="cp-select-label">Playback</span>' +
            '<select class="cp-rate" aria-label="Playback speed">' +
              '<option value="0.75">0.75x</option><option value="1" selected>1x</option>' +
              '<option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option>' +
            '</select></label>' +
          '<label class="cp-select" title="Speed of the code typing only"><span class="cp-select-label">Typing</span>' +
            '<select class="cp-typespeed" aria-label="Code typing speed">' +
              '<option value="1" selected>1x</option><option value="2">2x</option><option value="instant">Instant</option>' +
            '</select></label>' +
          '<label class="cp-check" title="Stop at the end of every step; press play to continue">' +
            '<input type="checkbox" class="cp-autopause"><span>Pause after each step</span></label>' +
          '<button type="button" class="cp-toggle cp-cc" aria-pressed="true" title="Subtitles">CC</button>' +
          '<button type="button" class="cp-toggle cp-voice" aria-pressed="true" title="Read subtitles aloud with the browser voice when a step has no audio" hidden>Voice</button>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '<aside class="cp-side">' +
      '<div class="cp-tabs" role="tablist">' +
        '<button type="button" role="tab" class="cp-tab" data-tab="explainer" aria-selected="true">Explainer</button>' +
        '<button type="button" role="tab" class="cp-tab" data-tab="preview" aria-selected="false" hidden>Live preview</button>' +
      '</div>' +
      '<div class="cp-panel cp-panel-explainer" data-panel="explainer">' +
        '<ol class="cp-steps"></ol>' +
        '<article class="cp-md"></article>' +
        '<p class="cp-source"></p>' +
      '</div>' +
      '<div class="cp-panel cp-panel-preview" data-panel="preview" hidden>' +
        '<div class="cp-preview-bar"><span>Runs the code in the editor, including your own edits.</span>' +
        '<button type="button" class="cp-reload">Reload</button></div>' +
        '<iframe class="cp-frame" sandbox="allow-scripts allow-modals" title="Live preview"></iframe>' +
      '</div>' +
    '</aside>';

  function mount(root, base, options) {
    options = options || {};
    root.classList.add('cp');
    root.innerHTML = '<div class="cp-loading">Loading lesson&hellip;</div>';

    return loadLesson(base).then(function (data) {
      build(root, base, data, options);
    }).catch(function (err) {
      root.innerHTML = '<div class="cp-error"><strong>The lesson could not be loaded.</strong><br>' + esc(err.message) +
        '<br><span>If you opened the file directly from disk, serve the folder instead, for example with <code>python3 -m http.server</code>.</span></div>';
      throw err;
    });
  }

  function build(root, base, data, options) {
    var lesson = data.lesson, steps = data.steps, total = data.total;
    root.innerHTML = TEMPLATE;
    var $ = function (sel) { return root.querySelector(sel); };

    var el = {
      stepNo: $('.cp-step-no'), stepTitle: $('.cp-step-title'), lang: $('.cp-lang'),
      edited: $('.cp-edited'), restore: $('.cp-restore'), caption: $('.cp-caption'),
      prev: $('.cp-prev'), play: $('.cp-play'), next: $('.cp-next'),
      fill: $('.cp-fill'), head: $('.cp-head'), markers: $('.cp-markers'), range: $('.cp-range'),
      time: $('.cp-time'), rate: $('.cp-rate'), typeSpeed: $('.cp-typespeed'), autoPause: $('.cp-autopause'), cc: $('.cp-cc'), voice: $('.cp-voice'),
      tabs: root.querySelectorAll('.cp-tab'), panels: root.querySelectorAll('.cp-panel'),
      previewTab: $('.cp-tab[data-tab="preview"]'), steps: $('.cp-steps'), md: $('.cp-md'),
      source: $('.cp-source'), frame: $('.cp-frame'), reload: $('.cp-reload')
    };

    var mode = lesson.mode || null;
    var previewKind = lesson.preview || null; // "html" | "console" | null
    var hasCM = typeof global.CodeMirror === 'function';
    var editor = (hasCM ? codeMirrorEditor : textareaEditor)($('.cp-editor'), { mode: mode, tabSize: lesson.tabSize || 2 });
    el.lang.textContent = lesson.languageLabel || '';

    var state = {
      step: 0, t: 0, playing: false, rate: 1, typeSpeed: 1, autoPause: false, cc: true,
      voice: true, userEdited: false, spokenKey: null, speech: null, renderedStep: -1, lastTick: 0
    };

    // Restore the viewer's typing speed (or take it from mount options).
    var savedTypeSpeed = options.typingSpeed;
    if (savedTypeSpeed == null) {
      try { savedTypeSpeed = localStorage.getItem('codePlayer.typeSpeed'); } catch (e) { savedTypeSpeed = null; }
    }
    if (savedTypeSpeed === 'instant' || savedTypeSpeed === '2' || savedTypeSpeed === 2) {
      state.typeSpeed = savedTypeSpeed === 'instant' ? 'instant' : 2;
      el.typeSpeed.value = String(state.typeSpeed);
    }

    // Restore "pause after each step" (or take it from mount options).
    var savedAutoPause = options.pauseAfterStep;
    if (savedAutoPause == null) {
      try { savedAutoPause = localStorage.getItem('codePlayer.pauseAfterStep') === '1'; } catch (e) { savedAutoPause = false; }
    }
    state.autoPause = !!savedAutoPause;
    el.autoPause.checked = state.autoPause;

    var canSpeak = 'speechSynthesis' in global && steps.some(function (s) { return !s.audio && s.cues.length; });
    el.voice.hidden = !canSpeak;
    if (options.voice === false) { state.voice = false; el.voice.setAttribute('aria-pressed', 'false'); }

    // Step markers on the track and the step list in the explainer.
    el.range.max = String(total);
    steps.forEach(function (s, i) {
      if (i > 0) {
        var m = document.createElement('span');
        m.className = 'cp-marker';
        m.style.left = (s.offset / total * 100) + '%';
        el.markers.appendChild(m);
      }
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="cp-steps-title"></span><span class="cp-steps-time">' + fmt(s.offset) + '</span>';
      b.querySelector('.cp-steps-title').textContent = s.meta.title || s.id;
      b.addEventListener('click', function () { seekStep(i); });
      li.appendChild(b);
      el.steps.appendChild(li);
    });

    if (previewKind) {
      el.previewTab.hidden = false;
    } else {
      root.classList.add('cp-no-preview');
    }

    // --- time and playback -------------------------------------------------

    function cur() { return steps[state.step]; }

    function localTimeFromAudio() {
      var a = cur().audio;
      return a ? a.currentTime : state.t;
    }

    function stopAudio() {
      steps.forEach(function (s) { if (s.audio && !s.audio.paused) s.audio.pause(); });
    }

    function stopVoice() {
      state.speech = null;
      if (canSpeak) global.speechSynthesis.cancel();
      state.spokenKey = null;
    }

    function startStepMedia() {
      var a = cur().audio;
      if (a) {
        a.playbackRate = state.rate;
        try { a.currentTime = state.t; } catch (e) { /* not seekable yet */ }
        var p = a.play();
        if (p && p.catch) p.catch(function () { pause(); });
      }
    }

    function play() {
      if (state.userEdited) restore();
      if (state.t >= cur().duration - 0.05) {
        // At the end of a step (for example after an auto pause): continue
        // with the next one, or start over after the last step.
        state.step = state.step < steps.length - 1 ? state.step + 1 : 0;
        state.t = 0;
      }
      state.playing = true;
      state.lastTick = performance.now();
      state.spokenKey = null;
      startStepMedia();
      updatePlayButton();
    }

    function pause() {
      state.playing = false;
      stopAudio();
      stopVoice();
      updatePlayButton();
      render(true);
    }

    function updatePlayButton() {
      el.play.innerHTML = state.playing ? ICON.pause : ICON.play;
      el.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
      root.classList.toggle('cp-is-playing', state.playing);
    }

    function goTo(stepIndex, t) {
      var changed = stepIndex !== state.step;
      if (changed || state.playing) { stopAudio(); }
      stopVoice();
      state.step = stepIndex;
      state.t = Math.max(0, Math.min(t, steps[stepIndex].duration));
      var a = cur().audio;
      if (a) { try { a.currentTime = state.t; } catch (e) { /* ignore */ } }
      if (state.playing) startStepMedia();
      if (state.userEdited) clearEdited();
      render(true);
    }

    function seekGlobal(g) {
      g = Math.max(0, Math.min(g, total));
      for (var i = steps.length - 1; i >= 0; i--) {
        if (g >= steps[i].offset || i === 0) { goTo(i, g - steps[i].offset); return; }
      }
    }

    function seekStep(i) { goTo(i, 0); }

    function tick(now) {
      if (state.playing) {
        var s = cur();
        if (s.audio) {
          state.t = s.audio.currentTime;
          if (s.audio.ended) state.t = s.duration;
        } else {
          state.t += (now - state.lastTick) / 1000 * state.rate;
          // Wait for the browser voice to finish its sentence. The timeout is
          // a safety net for browsers that never fire the "end" event.
          var sp = state.speech;
          if (sp && sp.step === state.step && state.t >= sp.holdAt) {
            if (!sp.heldSince) sp.heldSince = now;
            var synth = global.speechSynthesis;
            var stillTalking = synth.speaking || synth.pending;
            if (stillTalking && now - sp.heldSince < sp.maxHold) state.t = sp.holdAt;
            else state.speech = null;
          }
        }
        state.lastTick = now;
        if (state.t >= s.duration - 0.01) {
          if (state.autoPause && state.step < steps.length - 1) {
            // Stay on the finished step so its code and explainer remain visible.
            state.t = s.duration;
            pause();
          } else if (state.step < steps.length - 1) {
            if (s.audio) s.audio.pause();
            state.step++;
            state.t = 0;
            state.spokenKey = null;
            startStepMedia();
          } else {
            state.t = s.duration;
            pause();
          }
        }
        render(false);
      }
      requestAnimationFrame(tick);
    }

    // --- rendering ----------------------------------------------------------

    // Typing speed is independent from playback speed: it only shortens the
    // typing window inside the step. "Instant" shows the step's code as soon
    // as the step starts.
    function codeState(s, t) {
      if (state.typeSpeed === 'instant') {
        var done = stateAt(s.ops, Infinity);
        done.typing = false;
        return done;
      }
      var end = s.typeStart + (s.typeEnd - s.typeStart) / state.typeSpeed;
      var progress = (t - s.typeStart) / (end - s.typeStart);
      var budget = progress <= 0 ? 0 : progress >= 1 ? Infinity : progress * s.cost;
      var st = stateAt(s.ops, budget);
      st.typing = t >= s.typeStart - 0.3 && t <= end + 0.8 && s.cost > 0;
      return st;
    }

    function setTypeSpeed(value) {
      state.typeSpeed = value === 'instant' ? 'instant' : (parseFloat(value) || 1);
      el.typeSpeed.value = String(state.typeSpeed);
      try { localStorage.setItem('codePlayer.typeSpeed', String(state.typeSpeed)); } catch (e) { /* storage unavailable */ }
      if (!state.userEdited) render(true);
    }

    function render(force) {
      var s = cur(), t = state.t;

      if (state.renderedStep !== state.step) renderStep();

      if (!state.userEdited) {
        var st = codeState(s, t);
        var changed = false;
        editor.batch(function () {
          changed = editor.apply(st.text);
          editor.highlight(st.ranges);
          editor.caret(st.typing && (state.playing || t > 0) ? st.caret : null);
        });
        if (changed || force) schedulePreview(state.playing ? 'throttle' : 'debounce');
      }

      // Captions
      var cue = null, cueIndex = -1;
      for (var i = 0; i < s.cues.length; i++) {
        if (t >= s.cues[i].start && t < s.cues[i].end) { cue = s.cues[i]; cueIndex = i; break; }
      }
      var text = state.cc && cue ? cue.text : '';
      if (el.caption.textContent !== text) el.caption.textContent = text;
      el.caption.classList.toggle('cp-caption-empty', !text);

      // Browser voice for steps without audio
      if (canSpeak && state.voice && state.playing && !s.audio && cue) {
        var key = state.step + ':' + cueIndex;
        if (key !== state.spokenKey) {
          state.spokenKey = key;
          if (t < cue.start + 0.5 * (cue.end - cue.start)) {
            var nextCue = s.cues[cueIndex + 1];
            // Hold just before the next cue, so that cue only starts (and is
            // spoken) once this sentence is finished.
            speak(cue.spoken, (nextCue ? nextCue.start : cue.end) - 0.02);
          }
        }
      }

      // Timeline
      var g = s.offset + t;
      var pct = total ? g / total * 100 : 0;
      el.fill.style.width = pct + '%';
      el.head.style.left = pct + '%';
      if (document.activeElement !== el.range) el.range.value = String(g);
      el.time.textContent = fmt(g) + ' / ' + fmt(total);
    }

    function renderStep() {
      var s = cur();
      state.renderedStep = state.step;
      el.stepNo.textContent = 'Step ' + (state.step + 1) + ' of ' + steps.length;
      el.stepTitle.textContent = s.meta.title || s.id;
      el.md.innerHTML = s.explainer ? renderMarkdown(s.explainer) : '<p class="cp-muted">This step has no explainer text.</p>';
      el.md.scrollTop = 0;
      el.source.textContent = s.dir.replace(/\/?$/, '/');
      var items = el.steps.children;
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('cp-current', i === state.step);
        items[i].classList.toggle('cp-done', i < state.step);
        var b = items[i].querySelector('button');
        if (i === state.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      }
    }

    // The browser voice speaks at its own pace, usually slower than the cue
    // timings. To keep subtitles and typing in sync, the timeline waits at
    // `holdAt` (the start of the next cue) until the sentence is finished.
    var speechId = 0;
    function speak(text, holdAt) {
      var id = ++speechId;
      var u = new SpeechSynthesisUtterance(text);
      u.rate = state.rate;
      if (lesson.lang) u.lang = lesson.lang;
      var done = function () {
        if (state.speech && state.speech.id === id) state.speech = null;
      };
      u.onend = done;
      u.onerror = done;
      state.speech = {
        id: id, step: state.step, holdAt: holdAt, heldSince: 0,
        maxHold: 2000 + text.length * 120 / state.rate // generous upper bound for one sentence
      };
      global.speechSynthesis.speak(u);
    }

    // --- user edits ---------------------------------------------------------

    function clearEdited() {
      state.userEdited = false;
      el.edited.hidden = true;
    }

    function restore() {
      clearEdited();
      render(true);
    }

    editor.onUserChange(function () {
      if (!state.userEdited) {
        state.userEdited = true;
        if (state.playing) pause();
        editor.highlight([]);
        editor.caret(null);
        el.edited.hidden = false;
      }
      schedulePreview('debounce');
    });

    // --- preview ------------------------------------------------------------

    var previewTimer = null, previewDirty = true;

    function previewVisible() {
      return previewKind && !$('.cp-panel-preview').hidden;
    }

    function schedulePreview(how) {
      if (!previewKind) return;
      previewDirty = true;
      if (!previewVisible()) return;
      if (how === 'throttle') {
        if (!previewTimer) previewTimer = setTimeout(updatePreview, 700);
      } else {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(updatePreview, 300);
      }
    }

    function themeColors() {
      var cs = getComputedStyle(root);
      function v(n, d) { return (cs.getPropertyValue(n) || '').trim() || d; }
      return { bg: v('--cp-surface', '#fff'), fg: v('--cp-fg', '#111'), line: v('--cp-line', '#ddd'), muted: v('--cp-muted', '#777'), err: v('--cp-danger', '#b42318') };
    }

    function updatePreview() {
      previewTimer = null;
      previewDirty = false;
      var code = editor.get();
      el.frame.srcdoc = previewKind === 'console' ? consoleDoc(code, themeColors()) : code;
    }

    el.reload.addEventListener('click', updatePreview);

    // --- controls -----------------------------------------------------------

    function showTab(name) {
      el.tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === name)); });
      el.panels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
      if (name === 'preview' && previewDirty) updatePreview();
    }

    el.tabs.forEach(function (t) { t.addEventListener('click', function () { showTab(t.dataset.tab); }); });
    el.play.addEventListener('click', function () { state.playing ? pause() : play(); });
    el.prev.addEventListener('click', function () {
      if (state.t > 2 || state.step === 0) goTo(state.step, 0); else goTo(state.step - 1, 0);
    });
    el.next.addEventListener('click', function () {
      if (state.step < steps.length - 1) goTo(state.step + 1, 0); else goTo(state.step, cur().duration);
    });
    el.range.addEventListener('input', function () { seekGlobal(parseFloat(el.range.value)); });
    el.restore.addEventListener('click', restore);
    el.rate.addEventListener('change', function () {
      state.rate = parseFloat(el.rate.value);
      steps.forEach(function (s) { if (s.audio) s.audio.playbackRate = state.rate; });
    });
    el.typeSpeed.addEventListener('change', function () { setTypeSpeed(el.typeSpeed.value); });
    el.autoPause.addEventListener('change', function () {
      state.autoPause = el.autoPause.checked;
      try { localStorage.setItem('codePlayer.pauseAfterStep', state.autoPause ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    });
    el.cc.addEventListener('click', function () {
      state.cc = !state.cc;
      el.cc.setAttribute('aria-pressed', String(state.cc));
      render(false);
    });
    el.voice.addEventListener('click', function () {
      state.voice = !state.voice;
      el.voice.setAttribute('aria-pressed', String(state.voice));
      if (!state.voice) stopVoice();
    });

    root.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select' || e.target.closest('.CodeMirror')) return;
      if (tag === 'button' && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); state.playing ? pause() : play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekGlobal(cur().offset + state.t + 5); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekGlobal(cur().offset + state.t - 5); }
    });
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');

    render(true);
    editor.refresh();
    requestAnimationFrame(tick);

    root.codePlayer = { play: play, pause: pause, seek: seekGlobal, step: seekStep, data: data };
  }

  global.CodePlayer = {
    mount: mount,
    // exposed for tests and tooling
    _internal: { diff: diff, opsCost: opsCost, stateAt: stateAt, parseVTT: parseVTT, renderMarkdown: renderMarkdown, normalizeCode: normalizeCode }
  };
})(typeof window !== 'undefined' ? window : globalThis);
