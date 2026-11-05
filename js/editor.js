/* Plain code editor: line numbers, Tab = 4 spaces, auto-indent.
 * Copy, cut, paste, drag-and-drop and any multi-character insertion are blocked —
 * students must type every character. */
(function () {
  function CodeEditor(container, opts) {
    opts = opts || {};
    container.classList.add('ce');
    container.innerHTML = '<div class="ce-gutter"></div><textarea class="ce-text" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" wrap="off"></textarea>';
    const ta = container.querySelector('textarea'), gut = container.querySelector('.ce-gutter');
    let last = '', internal = false, readOnly = false, hl = null;
    const onBlocked = opts.onBlocked || function () {};
    const onChange = opts.onChange || function () {};

    function lines() {
      const n = ta.value.split('\n').length; let h = '';
      for (let i = 1; i <= n; i++) h += (hl && i >= hl[0] && i <= hl[1]) ? `<span class="act">${i}</span>\n` : i + '\n';
      gut.innerHTML = h; gut.scrollTop = ta.scrollTop;
    }
    function lineHeight() { return parseFloat(getComputedStyle(ta).lineHeight) || 21.7; }
    /* put line k (1-based) near the top of the editor and the cursor at its start */
    function scrollToLine(k) {
      const ls = ta.value.split('\n'); k = Math.max(1, Math.min(k, ls.length));
      const pos = ls.slice(0, k - 1).join('\n').length + (k > 1 ? 1 : 0);
      ta.selectionStart = ta.selectionEnd = pos;
      try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
      const top = Math.max(0, (k - 2) * lineHeight());
      ta.scrollTop = top; gut.scrollTop = ta.scrollTop;
      requestAnimationFrame(() => { ta.scrollTop = top; gut.scrollTop = ta.scrollTop; });
    }
    function setValue(v) { internal = true; ta.value = v || ''; last = ta.value; internal = false; lines(); }
    function insert(text) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      internal = true;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + text.length;
      last = ta.value; internal = false; lines(); onChange(ta.value);
    }
    const block = (why) => (e) => { e.preventDefault(); e.stopPropagation(); onBlocked(why); return false; };
    ['copy', 'cut', 'paste', 'drop', 'dragstart', 'dragover'].forEach(ev => ta.addEventListener(ev, block(ev)));
    ta.addEventListener('contextmenu', block('right-click'));
    ta.addEventListener('beforeinput', (e) => {
      if (readOnly) { e.preventDefault(); return; }
      const t = e.inputType || '';
      if (/^insertFrom(Paste|Drop|Yank|PasteAsQuotation)/.test(t) || t === 'insertReplacementText' || t === 'insertFromPasteAsQuotation') { e.preventDefault(); onBlocked('paste'); return; }
      if (t === 'insertText' && e.data && e.data.length > 2) { e.preventDefault(); onBlocked('bulk-insert'); }
    });
    ta.addEventListener('input', () => {
      if (internal) return;
      const grown = ta.value.length - last.length;
      if (grown > 2) {               /* something inserted many characters at once (paste via other route, autofill…) */
        internal = true; const pos = Math.max(0, ta.selectionStart - grown); ta.value = last; ta.selectionStart = ta.selectionEnd = pos; internal = false;
        onBlocked('bulk-insert'); return;
      }
      last = ta.value; lines(); onChange(ta.value);
    });
    ta.addEventListener('keydown', (e) => {
      if (readOnly) { if (!e.ctrlKey && !/^(Arrow|Page|Home|End)/.test(e.key)) e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'insert'].includes(k)) { e.preventDefault(); onBlocked('clipboard-key'); return; }
      if (e.shiftKey && k === 'insert') { e.preventDefault(); onBlocked('clipboard-key'); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          const s = ta.selectionStart, ls = ta.value.lastIndexOf('\n', s - 1) + 1;
          const m = /^ {1,4}/.exec(ta.value.slice(ls));
          if (m) { internal = true; ta.value = ta.value.slice(0, ls) + ta.value.slice(ls + m[0].length); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - m[0].length); last = ta.value; internal = false; lines(); onChange(ta.value); }
        } else insert('    ');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const s = ta.selectionStart, ls = ta.value.lastIndexOf('\n', s - 1) + 1, line = ta.value.slice(ls, s);
        let ind = (/^\s*/.exec(line) || [''])[0];
        if (/\{\s*$/.test(line)) ind += '    ';
        insert('\n' + ind);
        return;
      }
      if (e.key === '}') {
        const s = ta.selectionStart, ls = ta.value.lastIndexOf('\n', s - 1) + 1, before = ta.value.slice(ls, s);
        if (/^ {4,}$/.test(before)) { e.preventDefault(); internal = true; ta.value = ta.value.slice(0, s - 4) + '}' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s - 3; last = ta.value; internal = false; lines(); onChange(ta.value); }
      }
    });
    ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
    lines();
    return {
      get value() { return ta.value; },
      setValue, focus: () => ta.focus(),
      setHighlight(from, to) { hl = from ? [from, to] : null; lines(); },
      scrollToLine,
      setReadOnly(v) { readOnly = !!v; ta.classList.toggle('ro', readOnly); },
      el: ta
    };
  }
  window.CodeEditor = CodeEditor;
})();
