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
 * difference while the step plays. A step with "transition": "morph" instead
 * moves the matching tokens from their old place to their new place, like a
 * slide morph, which also works between two languages (C# to JavaScript).
 * Because the editor state is a pure function of (step, time), you can seek
 * anywhere and swap any single file without touching the others.
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
  // Morph transition
  // ---------------------------------------------------------------------------

  var MORPH_SECONDS = 2; // default morph length when the step gives no end
  var FADE_SECONDS = 1.2; // default length of a "fade" (a morph without moving tokens)

  // Words, numbers, strings, comments and single punctuation characters.
  var TOKEN_RE = /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`[^`]*`?|\/\/.*|[A-Za-z_$][\w$]*|\d[\w.]*|\S/g;

  function visualColumns(line, tabSize) {
    var cols = [], col = 0;
    for (var i = 0; i < line.length; i++) {
      cols.push(col);
      col += line[i] === '\t' ? tabSize - col % tabSize : 1;
    }
    cols.push(col);
    return cols;
  }

  // Tokens with their position on the character grid. Uses the CodeMirror
  // mode for syntax colors when it is loaded, plain regex tokens otherwise.
  function tokenize(code, modeSpec, tabSize) {
    var CM = global.CodeMirror, mode = null, state = null, out = [], offset = 0;
    if (CM && CM.getMode && CM.StringStream && modeSpec) {
      mode = CM.getMode({ indentUnit: tabSize, tabSize: tabSize }, modeSpec);
      if (mode.name === 'null') mode = null;
      else state = CM.startState(mode);
    }
    var lines = code.replace(/\n$/, '').split('\n');
    lines.forEach(function (line, li) {
      var cols = visualColumns(line, tabSize);
      function push(text, style, ch) {
        style = (style || '').replace(/(^|\s)line-\S+/g, '').trim();
        out.push({
          text: text, line: li, col: cols[ch], index: offset + ch,
          cls: style ? style.split(/\s+/).map(function (c) { return 'cm-' + c; }).join(' ') : ''
        });
      }
      function split(text, style, ch) {
        var m;
        TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(text))) push(m[0], style, ch + m.index);
      }
      if (!mode) split(line, null, 0);
      else {
        if (!line && mode.blankLine) mode.blankLine(state);
        var stream = new CM.StringStream(line, tabSize, {
          lookAhead: function (n) { return lines[li + n]; },
          baseToken: function () {}
        });
        while (!stream.eol()) {
          var style = mode.token(stream, state);
          if (stream.pos <= stream.start) stream.next(); // guard against a mode that does not advance
          var text = stream.current(), lead = text.match(/^\s*/)[0].length;
          // Styled tokens (strings, comments) stay whole; the rest is split
          // so punctuation and words can match on their own.
          if (!style) split(text, null, stream.start);
          else if (/\S/.test(text)) push(text.trim(), style, stream.start + lead);
          stream.start = stream.pos;
        }
      }
      offset += line.length + 1;
    });
    return out;
  }

  // For every token in B, the index of the matching token in A, or -1.
  // An LCS keeps the order; leftover words that moved (a line moved up) are
  // paired with the nearest token with the same text.
  function matchTokens(A, B) {
    var n = A.length, m = B.length, i, j;
    var pair = new Int32Array(m).fill(-1), usedA = new Uint8Array(n);
    if (n * m <= 4e6) {
      var dp = [];
      for (i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
      for (i = n - 1; i >= 0; i--) {
        for (j = m - 1; j >= 0; j--) {
          dp[i][j] = A[i].text === B[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      i = 0; j = 0;
      while (i < n && j < m) {
        if (A[i].text === B[j].text) { pair[j] = i; usedA[i] = 1; i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
      }
    }
    for (j = 0; j < m; j++) {
      if (pair[j] >= 0 || !/\w/.test(B[j].text)) continue;
      var best = -1, bestDist = Infinity;
      for (i = 0; i < n; i++) {
        if (usedA[i] || A[i].text !== B[j].text) continue;
        var dist = Math.abs(A[i].line - B[j].line) * 1000 + Math.abs(A[i].col - B[j].col);
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      if (best >= 0) { pair[j] = best; usedA[best] = 1; }
    }
    return pair;
  }

  // Items are { a, b } (moves), { b } (fades in) or { a } (fades out).
  // `added` holds the text ranges of the new tokens, highlighted afterwards.
  // Without `match` nothing moves: the old code fades out, the new code in.
  function buildMorph(from, to, fromMode, toMode, tabSize, match) {
    var A = tokenize(from, fromMode, tabSize), B = tokenize(to, toMode, tabSize);
    var pair = match ? matchTokens(A, B) : new Int32Array(B.length).fill(-1), usedA = new Uint8Array(A.length);
    var items = [], added = [];
    B.forEach(function (b, j) {
      if (pair[j] >= 0) { usedA[pair[j]] = 1; items.push({ a: A[pair[j]], b: b }); }
      else {
        items.push({ b: b });
        if (match) added.push([b.index, b.index + b.text.length]);
      }
    });
    A.forEach(function (a, i) { if (!usedA[i]) items.push({ a: a }); });
    return { items: items, added: added };
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function phase(p, from, to) { return clamp01((p - from) / (to - from)); }
  function easeInOut(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

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
      // Multilingual lessons list their languages; file names with {lang}
      // then load once per language. A lesson without languages has a single
      // track with the key ''.
      var languages = lesson.languages && lesson.languages.length ? lesson.languages : null;
      var trackLangs = languages || [''];
      var texts = {}, audios = {};
      function text(url) { return texts[url] || (texts[url] = fetchText(url)); }
      function audio(url) { return audios[url] || (audios[url] = loadAudio(url)); }
      function named(file, lang) { return lang ? file.replace(/\{lang\}/g, lang) : file; }
      return Promise.all(lesson.steps.map(function (id) {
        var dir = join(join(base, stepsDir), id);
        return fetch(join(dir, 'step.json'))
          .then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; })
          .then(function (meta) {
            var f = Object.assign({}, files, meta.files || {});
            return Promise.all([f.code ? fetchText(join(dir, f.code)) : null].concat(trackLangs.map(function (lang) {
              return Promise.all([
                f.subtitles ? text(join(dir, named(f.subtitles, lang))) : null,
                f.explainer ? text(join(dir, named(f.explainer, lang))) : null,
                f.audio ? audio(join(dir, named(f.audio, lang))) : null
              ]).then(function (r) {
                return { lang: lang, cues: parseVTT(r[0]), explainer: r[1], audio: r[2], found: r[0] != null || r[2] != null };
              });
            }))).then(function (res) {
              var tracks = {};
              res.slice(1).forEach(function (tr) { tracks[tr.lang] = tr; });
              return {
                id: id, dir: dir, meta: meta, files: f,
                code: normalizeCode(res[0]),
                codeMissing: res[0] == null,
                tracks: tracks
              };
            });
          });
      })).then(function (steps) {
        var prev = normalizeCode(lesson.starterCode || '');
        var tabSize = lesson.tabSize || 2;
        // Editor mode, header label and preview kind. A step can override
        // them; otherwise it keeps what the previous step used.
        var prevView = { mode: lesson.mode || null, label: lesson.languageLabel || '', preview: lesson.preview || null };
        var prevChapter = null;
        steps.forEach(function (s) {
          if (s.codeMissing) s.code = prev; // a step without code keeps the previous code
          var m = s.meta;
          s.view = {
            mode: 'mode' in m ? m.mode : prevView.mode,
            label: 'languageLabel' in m ? m.languageLabel : prevView.label,
            preview: 'preview' in m ? m.preview : prevView.preview
          };
          s.chapter = 'chapter' in m ? m.chapter : prevChapter;
          s.chapterKey = s.chapter ? JSON.stringify(s.chapter) : '';
          prevChapter = s.chapter;
          s.prevView = prevView;
          s.prevCode = prev;
          s.ops = diff(prev, s.code);
          s.cost = opsCost(s.ops);
          var transition = m.transition || lesson.transition;
          if (transition === 'morph' || transition === 'fade') {
            s.morph = buildMorph(prev, s.code, prevView.mode, s.view.mode, tabSize, transition === 'morph');
          }
          trackLangs.forEach(function (lang) {
            var tr = s.tracks[lang], cues = tr.cues;
            var lastCue = cues.length ? cues[cues.length - 1].end : 0;
            // Typing window. Cue numbers (1-based, as in the .vtt file) are
            // preferred because they keep typing in sync when the narration is
            // regenerated and the timings change. Seconds still work. A
            // translation split into different cues can override it with
            // "typing": { ..., "en": { "fromCue": 2 } }.
            var typing = Object.assign({}, m.typing, lang && m.typing && m.typing[lang]);
            var fromCue = typing.fromCue && cues[Math.min(typing.fromCue, cues.length) - 1];
            var toCue = typing.toCue && cues[Math.min(typing.toCue, cues.length) - 1];
            var start = fromCue ? fromCue.start : typing.start != null ? typing.start : 1;
            var end;
            if (toCue) end = toCue.end;
            else if (typing.end != null) end = typing.end;
            else if (s.morph) end = start + (transition === 'fade' ? FADE_SECONDS : MORPH_SECONDS);
            else end = start + s.cost / (typing.cps || lesson.cps || 14);
            tr.duration = (tr.audio && tr.audio.duration) || m.duration || Math.max(lastCue + 0.8, end + 1.5, 3);
            tr.typeStart = start;
            tr.typeEnd = Math.max(start + 0.05, Math.min(end, tr.duration));
          });
          prev = s.code;
          prevView = s.view;
        });
        var data = {
          lesson: lesson, steps: steps, total: 0,
          languages: languages, defaultLanguage: languages ? lesson.defaultLanguage || languages[0] : ''
        };
        useLanguage(data, data.defaultLanguage);
        return data;
      });
    });
  }

  // The track of a step in `lang`, or the default language's track when the
  // step has no subtitles or audio in that language yet.
  function trackFor(data, s, lang) {
    var tr = s.tracks[lang];
    return tr && tr.found ? tr : s.tracks[data.defaultLanguage];
  }

  // Point every step at its track in the audio language and rebuild the timeline.
  function useLanguage(data, lang) {
    var offset = 0;
    data.steps.forEach(function (s) {
      var tr = trackFor(data, s, lang);
      s.track = tr;
      s.cues = tr.cues;
      s.audio = tr.audio;
      s.duration = tr.duration;
      s.typeStart = tr.typeStart;
      s.typeEnd = tr.typeEnd;
      s.offset = offset;
      offset += s.duration;
    });
    data.total = offset;
  }

  // Step titles and chapters can be a string or { "nl": "...", "en": "..." }.
  function localized(value, lang, fallback) {
    if (!value || typeof value !== 'object') return value;
    return value[lang] || value[fallback] || value[Object.keys(value)[0]];
  }

  function languageName(code) {
    try {
      var name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      return name.charAt(0).toUpperCase() + name.slice(1);
    } catch (e) {
      return code;
    }
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
      refresh: function () { cm.refresh(); },
      setMode: function (mode) { cm.setOption('mode', mode); },
      // Top left of the first character and the character grid, relative to `box`.
      geometry: function (box) {
        var r = box.getBoundingClientRect();
        return {
          x: cm.charCoords({ line: 0, ch: 0 }, 'window').left - r.left,
          y: cm.heightAtLine(0, 'window') - r.top,
          cw: cm.defaultCharWidth(),
          lh: cm.defaultTextHeight()
        };
      }
    };
  }

  function textareaEditor(host, opts) {
    var ta = document.createElement('textarea');
    ta.className = 'cp-textarea';
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Lesson code');
    ta.style.tabSize = opts.tabSize;
    host.appendChild(ta);
    var listeners = [], measure = document.createElement('canvas').getContext('2d');
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
      refresh: function () {},
      setMode: function () {},
      geometry: function (box) {
        var cs = getComputedStyle(ta), r = ta.getBoundingClientRect(), b = box.getBoundingClientRect();
        measure.font = cs.fontSize + ' ' + cs.fontFamily;
        return {
          x: r.left - b.left + ta.clientLeft + parseFloat(cs.paddingLeft) - ta.scrollLeft,
          y: r.top - b.top + ta.clientTop + parseFloat(cs.paddingTop) - ta.scrollTop,
          cw: measure.measureText('0000000000').width / 10,
          lh: parseFloat(cs.lineHeight)
        };
      }
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
      'function f(x){if(typeof x==="string")return x;if(x===null||typeof x!=="object")return String(x);try{return JSON.stringify(x)}catch(e){return String(x)}}' +
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
          '<label class="cp-select" title="Speed of the code typing and morphs only"><span class="cp-select-label">Typing</span>' +
            '<select class="cp-typespeed" aria-label="Code typing speed">' +
              '<option value="1" selected>1x</option><option value="2">2x</option><option value="instant">Instant</option>' +
            '</select></label>' +
          '<label class="cp-check" title="Stop at the end of every step; press play to continue">' +
            '<input type="checkbox" class="cp-autopause"><span>Pause after each step</span></label>' +
          '<label class="cp-select" title="Language of the narration" hidden><span class="cp-select-label">Audio</span>' +
            '<select class="cp-audiolang" aria-label="Audio language"></select></label>' +
          '<label class="cp-select" title="Language of the subtitles and the explainer" hidden><span class="cp-select-label">Subtitles</span>' +
            '<select class="cp-sublang" aria-label="Subtitle language"></select></label>' +
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
    var lesson = data.lesson, steps = data.steps;
    root.innerHTML = TEMPLATE;
    var $ = function (sel) { return root.querySelector(sel); };

    var el = {
      stepNo: $('.cp-step-no'), stepTitle: $('.cp-step-title'), lang: $('.cp-lang'),
      edited: $('.cp-edited'), restore: $('.cp-restore'), caption: $('.cp-caption'),
      prev: $('.cp-prev'), play: $('.cp-play'), next: $('.cp-next'),
      fill: $('.cp-fill'), head: $('.cp-head'), markers: $('.cp-markers'), range: $('.cp-range'),
      time: $('.cp-time'), rate: $('.cp-rate'), typeSpeed: $('.cp-typespeed'), autoPause: $('.cp-autopause'), cc: $('.cp-cc'), voice: $('.cp-voice'),
      audioLang: $('.cp-audiolang'), subLang: $('.cp-sublang'),
      tabs: root.querySelectorAll('.cp-tab'), panels: root.querySelectorAll('.cp-panel'),
      previewTab: $('.cp-tab[data-tab="preview"]'), steps: $('.cp-steps'), md: $('.cp-md'),
      source: $('.cp-source'), frame: $('.cp-frame'), reload: $('.cp-reload')
    };

    var previewKind; // "html" | "console" | null, set per step by applyView
    var shownView = { mode: undefined, label: undefined };
    var hasCM = typeof global.CodeMirror === 'function';
    var editor = (hasCM ? codeMirrorEditor : textareaEditor)($('.cp-editor'), { mode: steps[0].view.mode, tabSize: lesson.tabSize || 2 });

    // Morph overlay: token spans on top of the editor while a morph plays.
    var wrap = $('.cp-editor-wrap');
    var morphEl = document.createElement('div');
    morphEl.className = 'cp-morph';
    morphEl.hidden = true;
    morphEl.setAttribute('aria-hidden', 'true');
    wrap.appendChild(morphEl);
    var morphStep = null, morphSpans = [];
    var reduceMotion = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;

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

    // Languages: the audio language picks each step's audio, cues and timing;
    // the subtitle language picks the captions, the explainer and the titles.
    // The choice comes from the mount options, then what this viewer chose
    // before, then the browser language, then the lesson default.
    var languages = data.languages;
    if (languages) {
      var stored = function (key) { try { return localStorage.getItem(key); } catch (e) { return null; } };
      var known = function (lang) { return lang && languages.indexOf(lang) >= 0 ? lang : null; };
      var browserLangs = (global.navigator && (navigator.languages || [navigator.language])) || [];
      var fromBrowser = null;
      browserLangs.some(function (l) {
        l = String(l).toLowerCase();
        fromBrowser = languages.filter(function (x) { return x.toLowerCase() === l; })[0] ||
          languages.filter(function (x) { return x.toLowerCase().split('-')[0] === l.split('-')[0]; })[0] || null;
        return fromBrowser;
      });
      state.audioLang = known(options.language) || known(stored('codePlayer.audioLanguage')) || fromBrowser || data.defaultLanguage;
      var wantedSub = options.subtitleLanguage || stored('codePlayer.subtitleLanguage');
      state.subLang = wantedSub === 'off' ? 'off' : known(wantedSub) || state.audioLang;
      state.cc = state.subLang !== 'off';
      languages.forEach(function (lang) {
        [el.audioLang, el.subLang].forEach(function (select) {
          var o = document.createElement('option');
          o.value = lang;
          o.textContent = languageName(lang);
          select.appendChild(o);
        });
      });
      var off = document.createElement('option');
      off.value = 'off';
      off.textContent = 'Off';
      el.subLang.appendChild(off);
      el.audioLang.value = state.audioLang;
      el.subLang.value = state.subLang;
      el.audioLang.parentNode.hidden = false;
      el.subLang.parentNode.hidden = false;
      el.cc.hidden = true; // "Off" in the subtitle menu replaces it
      if (state.audioLang !== data.defaultLanguage) useLanguage(data, state.audioLang);
    } else {
      state.audioLang = state.subLang = '';
    }
    var total = data.total;
    function textLang() { return state.subLang === 'off' ? state.audioLang : state.subLang; }

    var canSpeak = false;
    function updateVoice() {
      canSpeak = 'speechSynthesis' in global && steps.some(function (s) { return !s.audio && s.cues.length; });
      el.voice.hidden = !canSpeak;
    }
    updateVoice();
    if (options.voice === false) { state.voice = false; el.voice.setAttribute('aria-pressed', 'false'); }

    // The step list in the explainer. Steps with a "chapter" are grouped
    // under a chapter heading; only the current chapter shows its steps.
    var stepItems = [], chapterItems = [];
    function listButton(onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="cp-steps-title"></span><span class="cp-steps-time"></span>';
      b.addEventListener('click', onClick);
      return b;
    }
    steps.forEach(function (s, i) {
      var newChapter = s.chapter && (i === 0 || s.chapterKey !== steps[i - 1].chapterKey);
      if (newChapter) chapterItems.push({ first: i, li: document.createElement('li') });
      s.chapterIndex = chapterItems.length - 1;
      if (newChapter) {
        var head = chapterItems[s.chapterIndex].li;
        head.className = 'cp-chapter';
        head.appendChild(listButton(function () { seekStep(i); }));
        el.steps.appendChild(head);
      }
      var li = document.createElement('li');
      var b = listButton(function () { seekStep(i); });
      b.dataset.n = String(i + 1);
      li.appendChild(b);
      el.steps.appendChild(li);
      stepItems.push(li);
    });

    // Step markers on the track and the start times in the step list. They
    // depend on the audio language, because every language has its own timing.
    function layoutTimeline() {
      total = data.total;
      el.range.max = String(total);
      el.markers.textContent = '';
      steps.forEach(function (s, i) {
        if (i > 0) {
          var m = document.createElement('span');
          m.className = s.chapterIndex !== steps[i - 1].chapterIndex ? 'cp-marker cp-marker-chapter' : 'cp-marker';
          m.style.left = (s.offset / total * 100) + '%';
          el.markers.appendChild(m);
        }
        stepItems[i].querySelector('.cp-steps-time').textContent = fmt(s.offset);
      });
      chapterItems.forEach(function (c) {
        c.li.querySelector('.cp-steps-time').textContent = fmt(steps[c.first].offset);
      });
    }
    layoutTimeline();

    // Step and chapter titles in the subtitle language.
    function labelSteps() {
      var lang = textLang();
      steps.forEach(function (s, i) {
        stepItems[i].querySelector('.cp-steps-title').textContent = localized(s.meta.title, lang, data.defaultLanguage) || s.id;
      });
      chapterItems.forEach(function (c) {
        c.li.querySelector('.cp-steps-title').textContent = localized(steps[c.first].chapter, lang, data.defaultLanguage);
      });
    }
    labelSteps();

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
    // typing (or morph) window inside the step. "Instant" shows the step's
    // code as soon as the step starts.
    function codeState(s, t) {
      var end = s.typeStart + (s.typeEnd - s.typeStart) / (state.typeSpeed === 'instant' ? Infinity : state.typeSpeed);
      var progress = state.typeSpeed === 'instant' ? 1 : (t - s.typeStart) / (end - s.typeStart);
      if (s.morph) {
        // The editor holds the old code for the first half and the new code
        // for the second half; the overlay shows the movement in between.
        var p = clamp01(progress), before = p < 0.5;
        return {
          text: before ? s.prevCode : s.code, caret: 0, typing: false,
          ranges: p >= 1 ? s.morph.added : [],
          morph: p > 0 && p < 1 ? p : null,
          view: before ? s.prevView : s.view
        };
      }
      var budget = progress <= 0 ? 0 : progress >= 1 ? Infinity : progress * s.cost;
      var st = stateAt(s.ops, budget);
      st.typing = state.typeSpeed !== 'instant' && t >= s.typeStart - 0.3 && t <= end + 0.8 && s.cost > 0;
      st.view = s.view;
      return st;
    }

    // Editor mode, language label and preview kind for what the editor shows.
    // During a morph between two languages the label reads "C# → JavaScript".
    function applyView(view, morphing) {
      var label = view.label;
      if (morphing && morphing.prevView.label !== morphing.view.label) {
        label = morphing.prevView.label + ' → ' + morphing.view.label;
      }
      if (label !== shownView.label) { shownView.label = label; el.lang.textContent = label; }
      if (view.mode !== shownView.mode) { shownView.mode = view.mode; editor.setMode(view.mode); }
      if (view.preview !== previewKind) {
        previewKind = view.preview;
        el.previewTab.hidden = !previewKind;
        root.classList.toggle('cp-no-preview', !previewKind);
        if (!previewKind && !$('.cp-panel-preview').hidden) showTab('explainer');
        schedulePreview('debounce');
      }
    }

    function renderMorph(s, p) {
      var on = p != null;
      if (morphEl.hidden === on) {
        morphEl.hidden = !on;
        root.classList.toggle('cp-morphing', on);
      }
      if (!on) return;
      if (morphStep !== s) {
        morphStep = s;
        morphEl.textContent = '';
        morphSpans = s.morph.items.map(function (it) {
          return {
            a: it.a, b: it.b,
            elA: it.a ? tokenSpan(it.a) : null,
            // A moved token that changes color crossfades to a second span.
            elB: it.b && (!it.a || it.a.cls !== it.b.cls) ? tokenSpan(it.b) : null
          };
        });
      }
      var g = editor.geometry(wrap);
      morphEl.style.lineHeight = g.lh + 'px';
      function place(node, col, line, opacity) {
        node.style.transform = 'translate(' + (g.x + col * g.cw) + 'px,' + (g.y + line * g.lh) + 'px)';
        node.style.opacity = String(opacity);
      }
      // Choreography: removed tokens fade out, matching tokens travel, new
      // tokens fade in. With reduced motion everything crossfades in place.
      var still = reduceMotion && reduceMotion.matches;
      var fadeOut = still ? 1 - phase(p, 0, 0.5) : 1 - phase(p, 0, 0.3);
      var fadeIn = still ? phase(p, 0.5, 1) : phase(p, 0.7, 1);
      var k = still ? (p < 0.5 ? 0 : 1) : easeInOut(phase(p, 0.15, 0.85));
      var swap = still ? fadeIn : phase(p, 0.3, 0.7);
      morphSpans.forEach(function (m) {
        if (m.a && m.b) {
          var col = m.a.col + (m.b.col - m.a.col) * k, line = m.a.line + (m.b.line - m.a.line) * k;
          if (m.elB) {
            place(m.elA, col, line, still ? (p < 0.5 ? fadeOut : 0) : 1 - swap);
            place(m.elB, col, line, swap);
          } else {
            var stays = m.a.col === m.b.col && m.a.line === m.b.line;
            place(m.elA, col, line, !still || stays ? 1 : p < 0.5 ? fadeOut : fadeIn);
          }
        } else if (m.a) {
          place(m.elA, m.a.col, m.a.line, fadeOut);
        } else {
          place(m.elB, m.b.col, m.b.line, fadeIn);
        }
      });
    }

    function tokenSpan(tok) {
      var span = document.createElement('span');
      span.textContent = tok.text;
      if (tok.cls) span.className = tok.cls;
      morphEl.appendChild(span);
      return span;
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
          applyView(st.view, st.morph != null ? s : null);
          changed = editor.apply(st.text);
          editor.highlight(st.ranges);
          editor.caret(st.typing && (state.playing || t > 0) ? st.caret : null);
        });
        renderMorph(s, st.morph);
        if (changed || force) schedulePreview(state.playing ? 'throttle' : 'debounce');
      }

      // Captions
      var cue = null, cueIndex = -1;
      for (var i = 0; i < s.cues.length; i++) {
        if (t >= s.cues[i].start && t < s.cues[i].end) { cue = s.cues[i]; cueIndex = i; break; }
      }
      var text = state.cc && cue ? captionText(s, cueIndex, cue) : '';
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
      var lang = textLang();
      el.stepNo.textContent = 'Step ' + (state.step + 1) + ' of ' + steps.length;
      el.stepTitle.textContent = localized(s.meta.title, lang, data.defaultLanguage) || s.id;
      // The explainer follows the subtitle language, falling back to the default language.
      var own = s.tracks[lang], explainer = own && own.explainer != null ? own.explainer : s.tracks[data.defaultLanguage].explainer;
      el.md.innerHTML = explainer ? renderMarkdown(explainer) : '<p class="cp-muted">This step has no explainer text.</p>';
      el.md.scrollTop = 0;
      el.source.textContent = s.dir.replace(/\/?$/, '/');
      stepItems.forEach(function (li, i) {
        li.classList.toggle('cp-current', i === state.step);
        li.classList.toggle('cp-done', i < state.step);
        li.hidden = chapterItems.length > 0 && steps[i].chapterIndex !== s.chapterIndex;
        var b = li.firstChild;
        if (i === state.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
      chapterItems.forEach(function (c, ci) {
        c.li.classList.toggle('cp-current', ci === s.chapterIndex);
        c.li.classList.toggle('cp-done', ci < s.chapterIndex);
        c.li.firstChild.setAttribute('aria-expanded', String(ci === s.chapterIndex));
      });
    }

    // Subtitles in another language than the audio: translations are made cue
    // by cue, so cue i of the subtitle language is shown with the timing of
    // cue i of the audio. If the cue counts differ, the audio's own cues are shown.
    function captionText(s, index, cue) {
      if (!languages || state.subLang === s.track.lang) return cue.text;
      var sub = trackFor(data, s, state.subLang);
      return sub !== s.track && sub.cues.length === s.cues.length ? sub.cues[index].text : cue.text;
    }

    // Speech language for the browser voice: the lesson's "lang" (for example
    // nl-BE) when it belongs to that language, otherwise the language code.
    function speechLang(lang) {
      if (lesson.lang && (!lang || lesson.lang.toLowerCase().split('-')[0] === lang.toLowerCase().split('-')[0])) return lesson.lang;
      return lang || '';
    }

    // The browser voice speaks at its own pace, usually slower than the cue
    // timings. To keep subtitles and typing in sync, the timeline waits at
    // `holdAt` (the start of the next cue) until the sentence is finished.
    var speechId = 0;
    function speak(text, holdAt) {
      var id = ++speechId;
      var u = new SpeechSynthesisUtterance(text);
      u.rate = state.rate;
      var lang = speechLang(cur().track.lang);
      if (lang) u.lang = lang;
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
        renderMorph(null, null);
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

    // Switching the audio language changes every step's timing, so the
    // position is kept as the same fraction of the current step.
    el.audioLang.addEventListener('change', function () {
      var wasPlaying = state.playing, fraction = cur().duration ? state.t / cur().duration : 0;
      if (wasPlaying) { stopAudio(); stopVoice(); }
      state.audioLang = el.audioLang.value;
      try { localStorage.setItem('codePlayer.audioLanguage', state.audioLang); } catch (e) { /* storage unavailable */ }
      useLanguage(data, state.audioLang);
      layoutTimeline();
      updateVoice();
      state.t = fraction * cur().duration;
      var a = cur().audio;
      if (a) { try { a.currentTime = state.t; } catch (e) { /* not seekable yet */ } }
      if (wasPlaying) { state.lastTick = performance.now(); startStepMedia(); }
      state.renderedStep = -1;
      render(true);
    });
    el.subLang.addEventListener('change', function () {
      state.subLang = el.subLang.value;
      state.cc = state.subLang !== 'off';
      try { localStorage.setItem('codePlayer.subtitleLanguage', state.subLang); } catch (e) { /* storage unavailable */ }
      labelSteps();
      state.renderedStep = -1;
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

    // Keep a paused morph lined up with the editor when the layout changes.
    function onResize() {
      if (!root.isConnected) { global.removeEventListener('resize', onResize); return; }
      if (!morphEl.hidden) render(false);
    }
    global.addEventListener('resize', onResize);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { editor.refresh(); if (!morphEl.hidden) render(false); });
    }

    render(true);
    editor.refresh();
    requestAnimationFrame(tick);

    root.codePlayer = { play: play, pause: pause, seek: seekGlobal, step: seekStep, data: data };
  }

  global.CodePlayer = {
    mount: mount,
    // exposed for tests and tooling
    _internal: { diff: diff, opsCost: opsCost, stateAt: stateAt, parseVTT: parseVTT, renderMarkdown: renderMarkdown, normalizeCode: normalizeCode, tokenize: tokenize, buildMorph: buildMorph, loadLesson: loadLesson, useLanguage: useLanguage, trackFor: trackFor }
  };
})(typeof window !== 'undefined' ? window : globalThis);
