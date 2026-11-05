(function () {
  'use strict';
  const C = window.CONFIG, LIMIT = C.VIOLATION_LIMIT || 3;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SKEY = 'cportal_session';

  let session = null;      // {token, student}
  let state = null;        // {codes[5], results[5], updatedAt}
  let examActive = false, closing = false, dirty = false, current = 0, editor = null;
  let violations = 0, lastViolationAt = 0, saveTimer = null, saving = false, autoSubmitted = false;
  const compiler = new LocalCompiler();

  /* ------------------------------------------------ helpers */
  function show(view) { ['view-login', 'view-dash', 'view-exam'].forEach(v => $(v).classList.toggle('hidden', v !== view)); }
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms || 2600); }
  function modal(title, html, actions) {
    $('mTitle').textContent = title; $('mBody').innerHTML = html; const a = $('mActions'); a.innerHTML = '';
    return new Promise(res => {
      (actions || [{ label: 'OK', cls: 'primary', value: true }]).forEach(b => {
        const el = document.createElement('button'); el.className = 'btn ' + (b.cls || 'ghost'); el.textContent = b.label;
        el.onclick = () => { $('modal').classList.add('hidden'); res(b.value); }; a.appendChild(el);
      });
      $('modal').classList.remove('hidden');
      const first = $('mBody').querySelector('input'); if (first) setTimeout(() => first.focus(), 50);
    });
  }
  const caseNo = () => session.student.caseNo;
  const caseText = () => window.CASES[caseNo() - 1];
  const spec = () => window.TESTS[caseNo()];
  const localKey = () => `cportal_work2_${session.student.userId}_${caseNo()}`;   /* v2: ignore backups made before the hint-only main() */
  function starterProgram() { return Grader.template(caseNo()); }

  /* ------------------------------------------------ login */
  $('portalTitle').textContent = C.PORTAL_TITLE; $('collegeName').textContent = C.COLLEGE_NAME; $('tbTitle').textContent = C.PORTAL_TITLE;
  document.title = C.PORTAL_TITLE;
  if (API.demo) $('demoBanner').classList.remove('hidden');

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('loginBtn').disabled = true; $('loginMsg').textContent = 'Checking…';
    const typedPw = $('loginPw').value;
    const r = await API.call({ action: 'login', userId: $('loginId').value.trim(), password: typedPw, deviceId: Device.id(), fp: await Device.fingerprint() });
    $('loginBtn').disabled = false;
    if (!r.ok) {
      if (r.blocked) {
        $('loginId').value = ''; $('loginPw').value = ''; $('loginMsg').textContent = '';
        await modal('⚠ Not allowed on this computer', `<p class="bad"><b>${esc(r.error)}</b></p><p>The portal has been closed. If you changed your seat for a genuine reason, ask your teacher to allow it.</p>`, [{ label: 'Close', cls: 'danger', value: true }]);
        return;
      }
      $('loginMsg').textContent = r.error || 'Login failed'; return;
    }
    session = { token: r.token, student: r.student };
    try { sessionStorage.setItem(SKEY, JSON.stringify(session)); } catch (e2) {}
    mergeProgress(r.progress);
    $('loginPw').value = ''; $('loginMsg').textContent = '';
    if (r.mustChange) { const changed = await changePassword(true, typedPw); if (!changed) { logout(); return; } }
    enterDashboard();
  });
  function logout() { try { sessionStorage.removeItem(SKEY); } catch (e) {} session = null; show('view-login'); }
  $('logoutBtn').onclick = logout;
  $('pwBtn').onclick = () => changePassword(false);

  /* Change password. forced = first login (default password = roll number); cannot be skipped. */
  async function changePassword(forced, knownOld) {
    let msg = '';
    for (;;) {
      const ok = await modal(forced ? 'Set your own password' : 'Change password',
        `${forced ? '<p>You logged in with the default password (your roll number). Choose your own password before continuing.</p>' : ''}
         <div class="pwform">${knownOld ? '' : '<label>Current password<input type="password" id="pwOld" autocomplete="off"></label>'}
         <label>New password (at least 6 characters)<input type="password" id="pwNew" autocomplete="off"></label>
         <label>Type the new password again<input type="password" id="pwNew2" autocomplete="off"></label>
         <p class="msg" id="pwMsg">${esc(msg)}</p></div>`,
        forced ? [{ label: 'Log out', value: false }, { label: 'Save password', cls: 'primary', value: true }]
               : [{ label: 'Cancel', value: false }, { label: 'Save password', cls: 'primary', value: true }]);
      if (!ok) return false;
      const oldPw = knownOld != null ? knownOld : $('pwOld').value, n1 = $('pwNew').value, n2 = $('pwNew2').value;
      if (n1 !== n2) { msg = 'The two new passwords do not match'; continue; }
      if (n1.length < 6) { msg = 'Use at least 6 characters'; continue; }
      const r = await API.call({ action: 'changePassword', token: session.token, oldPassword: oldPw, newPassword: n1 });
      if (r.ok) { toast('Password changed'); return true; }
      msg = r.error || 'Could not change the password';
      if (/expired/i.test(msg)) { logout(); return false; }
    }
  }

  function mergeProgress(server) {
    let local = null; try { local = JSON.parse(localStorage.getItem(localKey()) || 'null'); } catch (e) {}
    const pick = (local && (!server || (local.updatedAt || 0) > (server.updatedAt || 0))) ? local : server;
    /* one full program per case study, stored in codes[0] (older function-only saves start again from the template) */
    /* the program template is built only when the assignment starts (the question text is unlocked then) */
    const prog = (pick && pick.codes && pick.codes[0] && /\bmain\s*\(/.test(pick.codes[0])) ? pick.codes[0] : '';
    const fresh = prog !== (pick && pick.codes && pick.codes[0]);
    state = { codes: [prog, '', '', '', ''], results: ((!fresh && pick && pick.results) || []).concat([null, null, null, null, null, null]).slice(0, 6), updatedAt: fresh ? 0 : ((pick && pick.updatedAt) || 0) };
    if (local && server && (local.updatedAt || 0) > (server.updatedAt || 0)) dirty = true;   /* push newer local work to server */
    violations = session.student.violations || 0;
  }

  /* ------------------------------------------------ dashboard */
  function enterDashboard() {
    show('view-dash'); $('whoName').textContent = `${session.student.name} · Roll No ${session.student.roll}`; $('welcomeName').textContent = session.student.name;
    $('welcomeRoll').textContent = session.student.roll; $('welcomeName2').textContent = session.student.name; $('welcomeCase').textContent = `${caseNo()} — ${caseText() ? caseText().t : ''}`;
    goHome();
    compiler.onProgress = (v) => { $('compilerStatus').textContent = `Downloading the C compiler to this computer… ${Math.round(v * 100)}% (first time only)`; };
    compiler.init().then(() => { $('compilerStatus').textContent = '✓ C compiler ready on this computer'; $('compilerStatus').classList.add('ok'); })
      .catch(err => { $('compilerStatus').textContent = 'Compiler could not load: ' + err.message + ' — use Chrome or Edge and reload.'; $('compilerStatus').classList.add('bad'); });
  }
  function crumbs(items) { $('crumbs').innerHTML = items.map((it, i) => it.fn ? `<a href="#" data-i="${i}">${esc(it.label)}</a>` : `<span>${esc(it.label)}</span>`).join(' › '); $('crumbs').querySelectorAll('a').forEach(a => a.onclick = (e) => { e.preventDefault(); items[a.dataset.i].fn(); }); }
  function goHome() { ['labHome', 'assignHome'].forEach(i => $(i).classList.add('hidden')); $('dashHome').classList.remove('hidden'); crumbs([{ label: 'Home' }]); }
  $('openLabPanel').onclick = () => {
    $('dashHome').classList.add('hidden'); $('assignHome').classList.add('hidden'); $('labHome').classList.remove('hidden'); $('weekPrograms').classList.add('hidden');
    crumbs([{ label: 'Home', fn: goHome }, { label: 'Lab panel' }]);
    $('weekList').innerHTML = C.LAB_WEEKS.map((w, i) => `<button class="week-card" data-i="${i}"><div class="wk">W${w.week}</div><div><strong>${esc(w.title)}</strong><div class="muted small">${w.programs.length ? w.programs.length + ' programs' : 'Programs will be published soon'}</div></div></button>`).join('');
    $('weekList').querySelectorAll('.week-card').forEach(b => b.onclick = () => {
      const w = C.LAB_WEEKS[b.dataset.i];
      crumbs([{ label: 'Home', fn: goHome }, { label: 'Lab panel', fn: $('openLabPanel').onclick }, { label: w.title }]);
      $('weekPrograms').classList.remove('hidden');
      $('weekPrograms').innerHTML = `<div class="card"><h3>${esc(w.title)} — programs</h3>${w.programs.length ? '<ol>' + w.programs.map(p => `<li>${esc(p.title)}</li>`).join('') + '</ol>' : '<p class="muted">No programs have been published for this week yet.</p>'}</div>`;
    });
  };
  $('openAssignPanel').onclick = async () => {
    const r = await API.call({ action: 'load', token: session.token });
    if (r.ok) session.student = r.student; else if (/expired/i.test(r.error || '')) { toast(r.error); show('view-login'); return; }
    $('dashHome').classList.add('hidden'); $('labHome').classList.add('hidden'); $('assignHome').classList.remove('hidden');
    crumbs([{ label: 'Home', fn: goHome }, { label: 'Assignment panel' }]);
    const t = caseText(), s = session.student;
    $('assignEyebrow').textContent = `Case Study ${caseNo()} · Roll No ${s.roll}`;
    $('assignTitle').textContent = t.t;
    $('assignScenario').innerHTML = '🔒 <b>The case study, the five questions and the main() instructions are shown only after you start the assignment in full screen.</b> Copying, screenshots and switching windows are blocked or recorded there.';
    $('assignQs').innerHTML = '';
    $('assignEval').innerHTML = generalRulesHtml();
    const st = s.locked ? 'LOCKED' : s.status;
    $('assignStatus').textContent = st; $('assignStatus').className = 'status-pill ' + st.toLowerCase().replace(/\W+/g, '-');
    $('assignMeta').textContent = `5 questions × 2 marks · ${spec() ? 'auto-evaluated with 3 test cases each' : 'test cases will be added soon'}${s.lastSaved ? ' · last saved ' + new Date(s.lastSaved).toLocaleString() : ''}`;
    $('startBtn').disabled = s.locked || s.status === 'FINAL';
    $('startBtn').textContent = s.status === 'FINAL' ? 'Submitted' : s.locked ? 'Locked — contact your teacher' : (state.updatedAt ? 'Resume assignment' : 'Open assignment');
  };

  /* ------------------------------------------------ start exam */
  $('startBtn').onclick = async () => {
    const ok = await modal('Before you start', `${generalRulesHtml()}<ul class="rules">
      <li>The assignment opens in <b>full screen</b>. Leaving full screen, switching windows/tabs or pressing screenshot keys is recorded.</li>
      <li>After <b>${LIMIT}</b> such warnings the assignment is <b>locked</b> and only your teacher can unlock it.</li>
      <li>Copy, paste and drag-drop are disabled — <b>type your code</b>.</li>
      <li>Your work is saved automatically. Use <b>Save &amp; close</b> to stop; you can resume later. Closing the window also submits what you have.</li>
      <li>You get one complete C program: the structures and a menu-driven <code>main()</code> are already written. Complete the <b>five functions</b>. You may change <code>main()</code> to try your functions. No file handling.</li></ul>`,
      [{ label: 'Cancel', value: false }, { label: 'I agree — start in full screen', cls: 'primary', value: true }]);
    if (!ok) return;
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { toast('Full screen is required. Please allow it.'); return; }
    /* unlock the question text only now, inside full screen */
    const r = await API.call({ action: 'content', token: session.token });
    let ok2 = false;
    if (r.ok && r.key) { try { ok2 = await Content.unlock(caseNo(), r.key); } catch (e) { ok2 = false; } }
    if (!ok2) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      await modal('Cannot open the assignment', `<p class="bad">${esc(r.error || 'The questions could not be unlocked. Please tell your teacher (CONTENT_KEY is not set correctly).')}</p>`);
      return;
    }
    if (!state.codes[0]) { state.codes[0] = starterProgram(); }
    startExam();
  };

  function startExam() {
    examActive = true; closing = false; autoSubmitted = false; show('view-exam');
    $('exTitle').textContent = `Case Study ${caseNo()}: ${caseText().t}`; $('exWho').textContent = ` — ${session.student.name} · Roll ${session.student.roll}`;
    if (!editor) editor = CodeEditor($('editor'), {
      onChange: (v) => { state.codes[0] = v; state.updatedAt = Date.now(); dirty = true; saveLocal(); setSave('Unsaved changes'); markSection(); },
      onBlocked: (why) => toast(why === 'right-click' ? 'Right-click is disabled' : 'Copy / paste is disabled — please type the code')
    });
    editor.setValue(state.codes[0]);
    updateViol(); renderNav(); openQ(0);
    scheduleSave();
    if (dirty) saveNow();
  }
  function renderNav() {
    $('qnav').innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const r = state.results[i]; let badge = '<span class="qb">—</span>';
      if (r && r.total) badge = `<span class="qb ${r.passed === r.total ? 'g' : r.passed ? 'a' : 'r'}">${r.passed}/${r.total}</span>`;
      return `<button class="qbtn ${i === current ? 'on' : ''}" data-i="${i}"><span>${i < 5 ? 'Q' + (i + 1) : 'main()'}</span>${badge}</button>`;
    }).join('') + '<div class="qnav-foot muted small">Q1–Q5: 2 marks each</div>';
    $('qnav').querySelectorAll('.qbtn').forEach(b => b.onclick = () => openQ(+b.dataset.i));
  }
  function openQ(i) {
    current = i; renderNav();
    const s = spec(), t = caseText();
    if (i === 5) {
      $('qtext').innerHTML = `<div class="qhead"><span class="eyebrow">main() — write it yourself</span></div>` + (s && s.mainSpec ? mainSpecHtml(s.mainSpec, true) : '<p class="muted">The main() check for this case study will be published soon.</p>');
      const b = $('qtext').querySelector('#useSample'); if (b) b.onclick = () => { $('stdin').value = s.mainSpec.scenarios[0].input; toast('Sample input placed in the Input box — click Run program'); };
      $('edLabel').innerHTML = 'One program for the whole assignment <span class="muted small">— the Q1–Q5 and main() buttons only move to that part of it (marked in blue)</span>';
      $('runBtn').textContent = 'Run main() check';
      jumpTo('main');
      renderResult(state.results[5]);
      return;
    }
    let html = `<details class="small casebox"${i === 0 ? ' open' : ''}><summary><b>Case study ${caseNo()}: ${esc(t.t)}</b></summary><p>${esc(t.s || '')}</p></details>
      <div class="qhead"><span class="eyebrow">Question ${i + 1} · 2 marks</span></div><p class="qdoc">${esc(t.q[i])}</p>`;
    if (s) {
      const q = s.questions[i];
      html += `<div class="spec"><div class="spec-label">Complete this function in your program</div><code class="sig">${esc(q.sig)}</code><p>${esc(q.spec)}</p></div>`;
    } else html += `<div class="spec"><p class="muted">Test cases for this case study will be published soon. You can write, run and save your program now.</p></div>`;
    $('qtext').innerHTML = html;
    $('edLabel').innerHTML = 'One program for the whole assignment <span class="muted small">— the Q1–Q5 and main() buttons only move to that part of it (marked in blue)</span>';
    $('runBtn').textContent = `Run tests for Q${i + 1}`;
    if (s) jumpTo(s.questions[i].fn);
    renderResult(state.results[i]);
  }

  /* the part of the program that belongs to the selected question: from its '/* ===== Qn' comment to the closing brace */
  let currentFn = null;
  function sectionOf(fn) {
    const lines = editor.el.value.split('\n');
    const k = lines.findIndex(l => new RegExp('\\b' + fn + '\\s*\\(').test(l) && !/^\s*(\/\*|\*)/.test(l) && !/;\s*$/.test(l));
    if (k < 0) return null;
    let start = k;
    for (let j = k - 1; j >= 0 && j >= k - 12; j--) { if (/^\/\* =+ /.test(lines[j])) { start = j; break; } }
    let depth = 0, seen = false, end = k;
    for (let j = k; j < lines.length; j++) {
      const t = lines[j].replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
      for (const ch of t) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
      if (seen && depth <= 0) { end = j; break; }
      end = j;
    }
    return { start: start + 1, sig: k + 1, end: end + 1 };
  }
  function markSection() {
    if (!currentFn) { editor.setHighlight(null); return; }
    const r = sectionOf(currentFn); if (r) editor.setHighlight(r.start, r.end); else editor.setHighlight(null);
  }
  function jumpTo(fn) {
    currentFn = fn; markSection();
    const r = sectionOf(fn); if (r) editor.scrollToLine(r.start);
  }

  /* ------------------------------------------------ run the student's own program */
  /* Interactive console, like a lab terminal: the program prints its prompts and an input line appears
     wherever scanf() waits. (Behind the scenes the program is re-run with the lines typed so far.)
     Anything typed in the Input box beforehand is fed in first. */
  let term = null;
  $('runProgBtn').onclick = async () => {
    const pre = $('stdin').value.replace(/\r/g, '');
    const lines = pre.trim() ? pre.split('\n').map(l => l + '\n') : [];
    term = { code: state.codes[0], inputs: lines, busy: false };
    $('console').innerHTML = '<div class="muted">Compiling and running your program on this computer…</div>';
    await termStep();
  };
  async function termStep() {
    if (!term || term.busy) return;
    term.busy = true; $('runProgBtn').disabled = true;
    let r;
    try { r = await compiler.runInteractive(term.code, term.inputs); }
    catch (e) { r = { status: 'error', log: [], errors: [], runtimeError: e.message }; }
    term.busy = false; $('runProgBtn').disabled = false;
    renderTerm(r);
  }
  function renderTerm(r) {
    const el = $('console');
    const errs = (r.errors || []).filter(l => !/^Error: process exited/.test(l));
    if (errs.length) { el.innerHTML = `<div class="bad"><b>Compilation errors</b></div><pre class="err">${esc(errs.join('\n'))}</pre>`; term = null; return; }
    let body = '';
    (r.log || []).forEach(x => { body += x.out !== undefined ? esc(x.out) : `<span class="tin">${esc(x.in)}</span>`; });
    let tail = '';
    if (r.status === 'need') tail = '<input class="termin" id="termIn" autocomplete="off" spellcheck="false">';
    else if (r.status === 'timeout') tail = '\n<span class="bad">— stopped after the time limit (infinite loop?) —</span>';
    else if (r.status === 'error') tail = `\n<span class="bad">— runtime error: ${esc(r.runtimeError || '')} —</span>`;
    else tail = `\n<span class="muted">— program finished${r.exitCode ? ' (exit code ' + r.exitCode + ')' : ''} —</span>`;
    el.innerHTML = `<div class="muted small">Program console${r.status === 'need' ? ' — type the input and press Enter' : ''}</div><pre class="out term">${body}${tail}</pre>`;
    el.scrollTop = el.scrollHeight;
    const inp = $('termIn');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); term.inputs.push(inp.value + '\n'); inp.disabled = true; termStep(); }
      });
    }
    if (r.status !== 'need') term = null;
  }

  /* ------------------------------------------------ run tests */
  $('runBtn').onclick = async () => {
    if (!spec()) { toast('Tests for this case study are not published yet'); return; }
    $('runBtn').disabled = true; const qi = current;
    $('console').innerHTML = '<div class="muted">Compiling on this computer…</div>';
    try {
      const step = (m) => { $('console').innerHTML = `<div class="muted">${esc(m)}</div>`; };
      const res = qi === 5 ? await Grader.evaluateMain(compiler, caseNo(), state.codes[0], step) : await Grader.evaluate(compiler, caseNo(), qi, state.codes[0], step);
      state.results[qi] = res; state.updatedAt = Date.now(); dirty = true; saveLocal();
      if (qi === current) renderResult(res); renderNav(); saveNow();
    } catch (e) { $('console').innerHTML = `<div class="bad">Could not run: ${esc(e.message)}</div>`; }
    $('runBtn').disabled = false;
  };
  function renderResult(r) {
    const el = $('console');
    if (!r) { el.innerHTML = '<div class="muted">Results of the test cases will appear here.</div>'; return; }
    if (r.main || current === 5) { el.innerHTML = mainResultHtml(r); return; }
    if (!r.tests) { el.innerHTML = `<div class="muted">Last run: passed ${r.passed || 0}/${r.total || 0}. Click “Run tests” to see the details again.</div>`; return; }
    if (!r.attempted) { el.innerHTML = '<div class="muted">This function is still empty — write its code in the program first.</div>'; return; }
    let h = '';
    if (r.compileErrors) h += `<div class="bad"><b>Compilation errors</b></div><pre class="err">${esc(r.compileErrors)}</pre>`;
    h += '<div class="tests">' + r.tests.map((t, k) => `<div class="tcase ${t.pass ? 'pass' : 'fail'}"><div><b>${t.pass ? '✓' : '✗'} Test ${k + 1}</b> ${t.visible ? '(sample)' : '(hidden)'} — ${esc(t.name)}${t.reason && !t.pass ? ` <span class="muted">· ${esc(t.reason)}</span>` : ''}</div>${t.visible && !t.pass && t.got !== undefined ? `<div class="io"><div><span class="muted">Expected</span><pre>${esc(t.expected)}</pre></div><div><span class="muted">Your output</span><pre>${esc(t.got) || '(nothing)'}</pre></div></div>` : ''}</div>`).join('') + '</div>';
    h += `<div class="summary">Passed ${r.passed}/${r.total}${r.static.notes.length ? ' · <span class="warn">' + esc(r.static.notes.join(' · ')) + '</span>' : ''}</div>`;
    el.innerHTML = h;
  }

  /* ------------------------------------------------ evaluation rules shown to the student */
  function mainSpecHtml(ms, compact) {
    let h = `<p>${compact ? '' : 'You write the complete <code>main()</code>. '}The portal runs your <b>whole program</b> twice, typing the input <b>in exactly this order</b>:</p>
      <ol class="small">${ms.input.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <table class="mtable"><tr><th>Option</th><th>Input after the option</th><th>What your program must do and print</th></tr>
      ${ms.menu.map(m => `<tr><td>${m.o}</td><td><code>${esc(m.in)}</code></td><td>${esc(m.out)}</td></tr>`).join('')}
      <tr><td>0</td><td>—</td><td>exit the menu loop and end the program</td></tr></table>
      <p class="small"><b>Output check:</b> the correct numbers must appear in your output in the order of the options. Messages and wording are your choice; print amounts with 2 decimals (<code>%.2f</code>).
      <b>Code check:</b> menu loop · switch with default · malloc/calloc · NULL check · scanf · members through <code>-&gt;</code> · all five functions called · free().</p>
      <details class="small"><summary>Sample input used for check 1 (check 2 uses different, hidden data)</summary><pre class="sample">${esc(ms.scenarios[0].input)}</pre>${compact ? '<button class="btn small" id="useSample">Put this sample in the Input box</button>' : ''}</details>`;
    return h;
  }
  function generalRulesHtml() {
    return `<div class="small"><b>How your work is evaluated</b>
      <ul class="rules"><li><b>Q1–Q5</b> (five functions, 2 marks each): each is run with 3 test cases (1 sample shown, 2 hidden). Level 3 = all pass and the rules are followed (loops, members through pointers <code>-&gt;</code>, no global variables, no file handling); 2 = some pass or a rule is missed; 1 = none pass or it does not compile.</li>
      <li><b>main()</b>: you write it completely. Your whole program is run with a given input order; the correct numbers must appear in your output, and the code is checked for a menu loop, switch with default, malloc + NULL check, scanf, <code>-&gt;</code>, calls to all five functions and free(). The exact input order and menu are shown on the <b>main()</b> tab inside the assignment.</li></ul></div>`;
  }
  function evaluationHtml() {
    const s = spec();
    if (!s) return '<h4>How your work is evaluated</h4><p class="muted small">The evaluation details for this case study will be published soon.</p>';
    return `<h4>How your work is evaluated</h4>
      <p><b>Q1–Q5 (the five functions, 2 marks each):</b> each function is run with <b>3 test cases</b> (1 sample shown to you, 2 hidden) using the portal's own <code>main()</code>.
      Level <b>3</b> = all 3 pass and the rules are followed (loops, structure members through pointers <code>-&gt;</code>, no global variables, no file handling);
      <b>2</b> = some pass or a rule is not followed; <b>1</b> = no test passes or the program does not compile.</p>
      <p><b>main():</b></p>${s.mainSpec ? mainSpecHtml(s.mainSpec, false) : ''}
      <p class="small">main() level: <b>3</b> = all outputs correct and at most one code check missing; <b>2</b> = at least half of the outputs correct; <b>1</b> = fewer than half, the program crashes, or it does not compile.</p>`;
  }
  function mainResultHtml(r) {
    if (!r.scenarios) return `<div class="muted">Last main() check: ${r.passed || 0}/${r.total || 0} outputs correct. Click “Run main() check” to see the details again.</div>`;
    if (!r.attempted) return '<div class="muted">main() is still empty — write it following the steps in the comments.</div>';
    let h = '';
    r.scenarios.forEach((sc, i) => {
      h += `<div class="tcase ${sc.checks.every(c => c.pass) ? 'pass' : 'fail'}"><div><b>Check ${i + 1}</b> ${sc.visible ? '(sample input)' : '(hidden input)'}${sc.status !== 'ok' ? ` <span class="bad">· ${esc(sc.status)}</span>` : ''}</div>`;
      if (sc.errors) h += `<pre class="err">${esc(sc.errors)}</pre>`;
      h += '<div class="small">' + sc.checks.map(c => `<span class="${c.pass ? 'okc' : 'badc'}">${c.pass ? '✓' : '✗'} option ${c.opt}${c.expected !== undefined ? ': ' + esc(c.expected) : ''}</span>`).join(' &nbsp; ') + '</div>';
      if (sc.visible && sc.output !== undefined && !sc.checks.every(c => c.pass)) h += `<details class="small"><summary>Your output for the sample input</summary><pre class="out">${esc(sc.output) || '(no output)'}</pre></details>`;
      h += '</div>';
    });
    const miss = r.code.items.filter(x => !x.ok).map(x => x.label);
    h += `<div class="summary">Outputs correct ${r.passed}/${r.total}${miss.length ? ' · <span class="warn">Code check missing: ' + esc(miss.join(' · ')) + '</span>' : ' · code checks ✓'}</div>`;
    return h;
  }

  /* ------------------------------------------------ saving */
  function saveLocal() { try { localStorage.setItem(localKey(), JSON.stringify(state)); } catch (e) {} }
  function setSave(t, cls) { const e = $('saveState'); e.textContent = t; e.className = 'save-state ' + (cls || ''); }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { if (examActive && dirty) await saveNow(); if (examActive) scheduleSave(); }, (C.AUTOSAVE_SECONDS || 30) * 1000 + Math.random() * 10000);
  }
  function payload(submit) { return { action: 'save', token: session.token, codes: state.codes, results: state.results.map(slim), updatedAt: state.updatedAt || Date.now(), violations, submit: submit || '' }; }
  function slim(r) { return r ? { passed: r.passed, total: r.total, level: r.level, compiled: r.compiled, t: r.tests ? r.tests.map(t => t.pass ? 1 : 0) : (r.t || []), at: r.at } : null; }
  async function saveNow(submit) {
    if (saving && !submit) return; saving = true; setSave('Saving…');
    const r = await API.call(payload(submit));
    saving = false;
    if (r.ok) { dirty = false; session.student = r.student; setSave('Saved ' + new Date().toLocaleTimeString(), 'ok'); checkLocked(); }
    else if (r.offline) setSave('Saved on this computer — will retry', 'warn');
    else { setSave(r.error || 'Save failed', 'bad'); if (/expired/i.test(r.error || '')) relogin(); if (r.student) { session.student = r.student; checkLocked(); } }
    return r;
  }
  async function relogin() { await modal('Session expired', 'Your work is safe on this computer. Please log in again to continue.'); leaveExam(true); show('view-login'); }

  /* ------------------------------------------------ close / submit */
  $('closeExamBtn').onclick = async () => {
    const ok = await modal('Save & close', 'Your work will be saved and submitted as it is now. You can open the assignment again later and continue.', [{ label: 'Cancel', value: false }, { label: 'Save & close', cls: 'primary', value: true }]);
    if (!ok) return;
    closing = true; const r = await saveNow('auto'); autoSubmitted = true;
    if (!r.ok && !r.offline) toast(r.error || 'Could not save');
    leaveExam(); $('openAssignPanel').onclick();
  };
  $('finalBtn').onclick = async () => {
    const att = state.results.filter(Boolean).length;
    const ok = await modal('Final submit', `After the final submission you <b>cannot edit</b> your answers again. You have run tests for ${att} of 5 questions. Submit now?`, [{ label: 'Cancel', value: false }, { label: 'Submit finally', cls: 'danger', value: true }]);
    if (!ok) return;
    closing = true; const r = await saveNow('final');
    if (!r.ok) { closing = false; toast(r.offline ? 'No connection — try again in a moment' : (r.error || 'Submit failed')); return; }
    autoSubmitted = true; leaveExam();
    await modal('Submitted', 'Your assignment has been submitted. You may log out.'); $('openAssignPanel').onclick();
  };
  function leaveExam(silent) {
    examActive = false; clearTimeout(saveTimer); $('shield').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    show('view-dash'); closing = false;
  }
  /* Window closed / tab closed / browser closed → send the work in the background (beacon). */
  function autoSubmitOnExit() {
    if (!examActive || autoSubmitted || !session) return;
    autoSubmitted = true; saveLocal();
    API.beacon(payload('auto'));
  }
  window.addEventListener('pagehide', autoSubmitOnExit);
  window.addEventListener('beforeunload', autoSubmitOnExit);

  /* ------------------------------------------------ lockdown */
  function updateViol() { const b = $('violBadge'); b.textContent = `Warnings ${violations}/${LIMIT}`; b.classList.toggle('hot', violations > 0); }
  function shield(on, title, msg, btn) {
    $('shield').classList.toggle('hidden', !on);
    if (on) { $('shieldTitle').textContent = title || 'Assignment hidden'; $('shieldMsg').textContent = msg || ''; $('shieldBtn').classList.toggle('hidden', !btn); }
  }
  async function violation(type, detail) {
    if (!examActive || closing) return;
    const now = Date.now(); if (now - lastViolationAt < 2500) return; lastViolationAt = now;
    violations++; updateViol();
    API.call({ action: 'violation', token: session.token, type, detail: detail || '', count: violations }).then(r => { if (r && r.student) { session.student = r.student; checkLocked(); } });
    if (violations >= LIMIT) { await lockNow(); return; }
    toast(`Warning ${violations} of ${LIMIT}: ${type.replace(/-/g, ' ')} is not allowed`, 4000);
  }
  async function lockNow() {
    closing = true; await saveNow('auto'); autoSubmitted = true; leaveExam();
    await modal('Assignment locked', `You left the assignment window ${LIMIT} times. Your work has been saved and submitted. Contact your teacher to unlock it.`);
    $('openAssignPanel').onclick();
  }
  function checkLocked() { if (examActive && session.student.locked && !closing) lockNow(); }

  document.addEventListener('visibilitychange', () => { if (document.hidden && examActive) { shield(true); violation('tab-switch', 'page hidden'); } });
  window.addEventListener('blur', () => { if (!examActive || closing) return; shield(true, 'Assignment hidden', 'You left the assignment window. Click below to continue.', true); violation('window-switch', 'window lost focus'); });
  window.addEventListener('focus', () => { if (examActive && document.fullscreenElement) setTimeout(() => shield(false), 150); });
  document.addEventListener('fullscreenchange', () => {
    if (!examActive || closing) return;
    if (!document.fullscreenElement) { shield(true, 'Full screen required', 'You left full screen. Click the button to return and continue.', true); violation('exit-fullscreen'); }
    else shield(false);
  });
  $('shieldBtn').onclick = async () => { try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); shield(false); editor && editor.focus(); } catch (e) { toast('Please allow full screen'); } };

  /* keys: screenshots, dev tools, print, save, view-source */
  let metaTimer = null;
  document.addEventListener('keydown', (e) => {
    if (!examActive) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'meta' || k === 'os' || e.metaKey) { shield(true, 'Assignment hidden', 'Release the Windows key to continue.', false); clearTimeout(metaTimer); metaTimer = setTimeout(() => { if (document.hasFocus() && document.fullscreenElement) shield(false); }, 1500); }
    if (k === 'printscreen') { e.preventDefault(); screenshotAttempt(); return; }
    if (k === 'f12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c', 'k', 's'].includes(k)) || (e.ctrlKey && ['u', 'p', 's', 'o', 'f', 'g', 'h', 'j', 'd', 'n', 't', 'w', 'r'].includes(k)) || k === 'f5' || (e.altKey && k === 'arrowleft')) {
      e.preventDefault(); e.stopPropagation(); toast('This key is disabled during the assignment');
    }
  }, true);
  document.addEventListener('keyup', (e) => {
    if (!examActive) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'printscreen') screenshotAttempt();
    if (k === 'meta' || k === 'os') setTimeout(() => { if (document.hasFocus() && document.fullscreenElement) shield(false); }, 400);
  }, true);
  function screenshotAttempt() {
    shield(true, 'Screenshots are not allowed', 'This attempt has been recorded.', false);
    try { navigator.clipboard && navigator.clipboard.writeText('Screenshots are not allowed during the assignment').catch(() => {}); } catch (e) {}
    violation('screenshot-key');
    setTimeout(() => { if (document.fullscreenElement && document.hasFocus()) shield(false); }, 1800);
  }
  ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'drop', 'selectstart'].forEach(ev => document.addEventListener(ev, (e) => {
    if (!examActive) return;
    if (ev === 'selectstart' && e.target && e.target.closest && e.target.closest('textarea, input')) return;
    e.preventDefault();
  }, true));

  /* ------------------------------------------------ resume session after reload */
  (async function boot() {
    let s = null; try { s = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) {}
    if (!s) { show('view-login'); return; }
    session = s; const r = await API.call({ action: 'load', token: s.token });
    if (!r.ok) { show('view-login'); return; }
    session.student = r.student; mergeProgress(r.progress);
    if (r.mustChange) { const changed = await changePassword(false); if (!changed) { logout(); return; } }
    enterDashboard();
  })();
})();
