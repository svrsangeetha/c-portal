(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let key = '', students = [], events = [], results = {}, mains = {}, facultySaved = '', mailQuota = null;   // results[userId] = [res q1..q5]
  const compiler = new LocalCompiler();
  if (API.demo) $('demoBanner').classList.remove('hidden');

  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2800); }
  function modal(title, html, actions) {
    $('mTitle').textContent = title; $('mBody').innerHTML = html; const a = $('mActions'); a.innerHTML = '';
    return new Promise(res => {
      (actions || [{ label: 'Close', cls: 'primary', value: true }]).forEach(b => {
        const el = document.createElement('button'); el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
        el.onclick = () => { $('modal').classList.add('hidden'); res(b.value); }; a.appendChild(el);
      });
      $('modal').classList.remove('hidden');
    });
  }
  /* shared-computer alerts still open (after the last time the teacher allowed this student) */
  function deviceAlerts(userId) {
    const ev = events.filter(e => String(e.userId).toLowerCase() === String(userId).toLowerCase());
    let lastAllow = 0; ev.forEach(e => { if (e.type === 'DEVICE_ALLOWED_BY_TEACHER') lastAllow = Math.max(lastAllow, new Date(e.time).getTime()); });
    return ev.filter(e => /^SHARED_DEVICE_/.test(e.type) && new Date(e.time).getTime() > lastAllow);
  }

  $('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault(); key = $('tKey').value; $('keyMsg').textContent = 'Loading…';
    if (await load()) { $('keyForm').classList.add('hidden'); $('report').classList.remove('hidden'); $('tWho').textContent = 'Teacher'; compiler.init().catch(() => {}); }
  });
  async function load() {
    const r = await API.call({ action: 'teacherList', key });
    if (!r.ok) { $('keyMsg').textContent = r.error || 'Failed'; return false; }
    students = r.students.sort((a, b) => (a.roll || 0) - (b.roll || 0)); events = r.events || [];
    facultySaved = r.faculty || ''; mailQuota = r.mailQuota;
    render(); return true;
  }
  $('reloadBtn').onclick = async () => { await load(); toast('Submissions reloaded'); };

  function levelCell(res) {
    if (!res) return '<span class="lv l0">·</span>';
    if (res.noTests) return '<span class="muted">n/a</span>';
    return `<span class="lv l${res.level}">${res.level || '–'}</span>`;
  }
  function ticks(res) {
    if (!res || res.noTests || !res.attempted) return '<span class="tk muted">· · ·</span>';
    const t = res.tests.length ? res.tests : [{}, {}, {}];
    return '<span class="tk">' + t.map(x => x.pass ? '<span class="p">✓</span>' : '<span class="f">✗</span>').join('') + '</span>';
  }
  function render() {
    const evald = Object.keys(results).length;
    $('repMeta').textContent = `${students.length} students · ${students.filter(s => s.status === 'FINAL').length} final submissions · ${students.filter(s => s.locked).length} locked · ${evald ? evald + ' evaluated' : 'not evaluated yet — click “Evaluate all”'}`;
    let h = '<thead><tr><th>Roll</th><th class="l">Name</th><th>Case</th><th>Status</th><th>Warnings</th>';
    for (let q = 1; q <= 5; q++) h += `<th class="qgrp">Q${q} tests</th><th>Level</th>`;
    h += '<th class="qgrp">Passed</th><th>Avg level</th><th title="Level of the student own main(): outputs and code checks">main()</th><th>Last saved</th><th></th></tr></thead><tbody>';
    students.forEach((s, i) => {
      const R = results[s.userId];
      h += `<tr><td>${esc(s.roll)}</td><td class="l"><a href="#" data-d="${i}">${esc(s.name)}</a><div class="muted small">${esc(s.userId)}</div></td><td>${esc(s.caseNo)}</td><td>${esc(s.status)}</td>
        <td class="lockcell">${esc(s.violations)}${(() => { const al = deviceAlerts(s.userId); if (!al.length) return ''; const blocked = al.some(e => e.type === 'SHARED_DEVICE_BLOCKED'); return ` <span class="lv l1" title="${esc(al.map(e => e.detail).join(' | '))}">⚠ shared PC</span>` + (blocked ? ` <button class="btn" data-a="${esc(s.userId)}" title="Allow this student to log in on that computer">Allow</button>` : ''); })()}${s.defaultPassword ? ' <span class="lv l0" title="Still using the default password (roll number)">pw</span>' : ''}${s.locked ? ` <span class="lv l1">LOCKED</span> <button class="btn" data-u="${esc(s.userId)}">Unlock</button>` : ''}${s.status === 'FINAL' ? ` <button class="btn" data-r="${esc(s.userId)}" title="Allow editing again">Reopen</button>` : ''}</td>`;
      for (let q = 0; q < 5; q++) h += `<td class="qgrp">${ticks(R && R[q])}</td><td>${levelCell(R && R[q])}</td>`;
      const sum = summary(R);
      h += `<td class="qgrp">${R ? sum.passed + '/' + sum.total : ''}</td><td>${R && sum.avg !== '' ? sum.avg : ''}</td><td class="small">${(() => { const M = mains[s.userId]; if (!M) return ''; if (M.noTests) return '<span class="muted">n/a</span>'; return `<span class="lv l${M.level}" title="${esc(mainSummary(M))}">${M.level || '–'}</span> <span class="muted">${M.attempted ? M.passed + '/' + M.total : ''}</span>`; })()}</td><td class="small">${s.lastSaved ? new Date(s.lastSaved).toLocaleString() : '—'}</td><td><a href="#" data-d="${i}">details</a></td></tr>`;
    });
    $('repTable').innerHTML = h + '</tbody>';
    $('repTable').querySelectorAll('[data-d]').forEach(a => a.onclick = (e) => { e.preventDefault(); details(students[a.dataset.d]); });
    $('repTable').querySelectorAll('[data-u]').forEach(b => b.onclick = () => unlock(b.dataset.u, false));
    $('repTable').querySelectorAll('[data-r]').forEach(b => b.onclick = () => unlock(b.dataset.r, true));
    $('repTable').querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const r = await API.call({ action: 'teacherAllowDevice', key, userId: b.dataset.a });
      if (r.ok) { toast('Student can log in again'); await load(); } else toast(r.error || 'Failed');
    });
  }
  function mainSummary(M) {
    if (!M || !M.attempted) return 'not written';
    const miss = M.code.items.filter(x => !x.ok).map(x => x.label);
    return `Level ${M.level}, outputs ${M.passed}/${M.total}${miss.length ? ', missing: ' + miss.join('; ') : ''}`;
  }
  function summary(R) {
    if (!R) return { passed: 0, total: 0, avg: '' };
    let p = 0, t = 0, ls = 0, n = 0;
    R.forEach(r => { if (!r || r.noTests) return; p += r.passed; t += r.total; ls += r.level; n++; });
    return { passed: p, total: t, avg: n ? (ls / n).toFixed(2) : '' };
  }
  async function unlock(userId, reopen) {
    const r = await API.call({ action: 'teacherUnlock', key, userId, reopen });
    if (r.ok) { toast(reopen ? 'Reopened for editing' : 'Unlocked'); await load(); } else toast(r.error || 'Failed');
  }

  /* Re-run every student's code here, in the teacher's browser (student-side results are not trusted). */
  $('evalBtn').onclick = async () => {
    $('evalBtn').disabled = true; $('prog').classList.remove('hidden');
    try { await compiler.init(); } catch (e) { toast('Compiler failed to load: ' + e.message); $('evalBtn').disabled = false; return; }
    const todo = students.filter(s => s.progress && s.progress.codes);
    let done = 0; const totalQ = todo.length * 5;
    for (const s of todo) {
      const program = String(s.progress.codes[0] || ''), out = [];
      for (let q = 0; q < 5; q++) {
        $('progText').textContent = `Evaluating ${s.name} (roll ${s.roll}) — Q${q + 1}`;
        out.push(await Grader.evaluate(compiler, s.caseNo, q, program));
        done++; $('progBar').style.width = (100 * done / totalQ) + '%';
      }
      $('progText').textContent = `Evaluating ${s.name} (roll ${s.roll}) — main()`;
      results[s.userId] = out; mains[s.userId] = await Grader.evaluateMain(compiler, s.caseNo, program); render();
    }
    $('progText').textContent = `Done — ${todo.length} students evaluated`;
    $('evalBtn').disabled = false; $('saveBtn').disabled = false; $('csvBtn').disabled = false; $('mailBtn').disabled = false;
  };

  function rowsForSheet() {
    return students.filter(s => results[s.userId]).map(s => {
      const R = results[s.userId], o = { UserID: s.userId, RollNo: s.roll, Name: s.name, CaseNo: s.caseNo };
      const notes = [];
      R.forEach((r, q) => {
        const n = q + 1;
        for (let t = 0; t < 3; t++) o[`Q${n}_T${t + 1}`] = (!r || r.noTests) ? 'n/a' : !r.attempted ? '-' : (r.tests[t] && r.tests[t].pass ? 'PASS' : 'FAIL');
        o[`Q${n}_Level`] = (!r || r.noTests) ? 'n/a' : (r.level || 'NA');
        if (r && r.attempted && r.static && r.static.notes.length) notes.push(`Q${n}: ` + r.static.notes.join('; '));
        if (r && r.compileErrors) notes.push(`Q${n}: compile error`);
      });
      const sm = summary(R);
      o.TestsPassed = `${sm.passed}/${sm.total}`; o.AverageLevel = sm.avg; o.Violations = s.violations; o.Status = s.status;
      const M = mains[s.userId];
      if (M && !M.noTests) { o.Main_Level = M.attempted ? M.level : 'NA'; o.Main_Outputs = M.attempted ? `${M.passed}/${M.total}` : '-'; notes.unshift('main(): ' + mainSummary(M)); }
      o.Remarks = notes.join(' | '); o.EvaluatedAt = new Date().toISOString();
      return o;
    });
  }
  $('saveBtn').onclick = async () => {
    $('saveBtn').disabled = true; const r = await API.call({ action: 'teacherResults', key, rows: rowsForSheet() });
    $('saveBtn').disabled = false; toast(r.ok ? 'Results written to the “Results” sheet' : (r.error || 'Failed'));
  };
  function toCsv(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    return [cols.join(',')].concat(rows.map(r => cols.map(c => `"${String(r[c] == null ? '' : r[c]).replace(/"/g, '""')}"`).join(','))).join('\r\n');
  }
  $('csvBtn').onclick = () => {
    const rows = rowsForSheet(); if (!rows.length) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' })); a.download = 'assignment-report.csv'; a.click();
  };

  /* E-mail: each student gets their own result; co-faculty / supporting faculty get the class summary + CSV. */
  $('mailBtn').onclick = async () => {
    const rows = rowsForSheet(); if (!rows.length) { toast('Evaluate first'); return; }
    const withMail = students.filter(s => results[s.userId] && /@/.test(s.email || '')).length;
    const ok = await modal('Email results', `
      <div class="pwform">
        <label><span><input type="checkbox" id="mStu" checked> Send each student their own result</span></label>
        <div class="muted small">${withMail} of ${rows.length} evaluated students have an e-mail address in the <b>Email</b> column of the Students sheet${withMail < rows.length ? ' — the others are skipped' : ''}.</div>
        <label>Co-faculty / supporting faculty e-mails (comma separated) — they receive the class summary with the CSV report
          <textarea id="mFac" rows="3" style="font:14px var(--sans);padding:8px;border:1px solid var(--line);border-radius:8px">${esc(facultySaved)}</textarea></label>
        <label>Note to include in the e-mails (optional)<input id="mNote" placeholder="e.g. Contact me before Friday for any doubts"></label>
        <div class="muted small">${mailQuota != null ? 'Google allows ' + mailQuota + ' more e-mails from your account today.' : ''}</div>
      </div>`, [{ label: 'Cancel', value: false }, { label: 'Send e-mails', cls: 'primary', value: true }]);
    if (!ok) return;
    const faculty = $('mFac').value.split(/[,;\s]+/).map(x => x.trim()).filter(x => /@/.test(x));
    const toStudents = $('mStu').checked, note = $('mNote').value.trim();
    if (!toStudents && !faculty.length) { toast('Nothing to send'); return; }
    $('mailBtn').disabled = true; $('mailBtn').textContent = 'Sending…';
    const r = await API.call({ action: 'teacherEmail', key, rows, faculty, toStudents, note, csv: toCsv(rows), title: (window.CONFIG && CONFIG.ASSIGNMENT_TITLE) || 'C Programming Assignment' });
    $('mailBtn').disabled = false; $('mailBtn').textContent = 'Email results';
    if (!r.ok) { modal('E-mail not sent', `<p class="bad">${esc(r.error || 'Failed')}</p>`); return; }
    facultySaved = faculty.join(', ');
    modal('E-mails sent', `<p>${r.sentStudents} student e-mail(s) sent${r.faculty ? ' and the class summary sent to ' + r.faculty + ' faculty member(s)' : ''}.${r.demo ? ' <i>(Demo mode — nothing was actually sent.)</i>' : ''}</p>${r.skipped && r.skipped.length ? '<p class="muted small">Skipped (no e-mail address): ' + esc(r.skipped.join(', ')) + '</p>' : ''}`);
  };
  $('printBtn').onclick = () => window.print();

  function details(s) {
    const R = results[s.userId], spec = window.TESTS[s.caseNo], ct = window.CASES[s.caseNo - 1];
    let h = `<p class="muted">Case Study ${s.caseNo}: ${esc(ct ? ct.t : '')} · Status ${esc(s.status)} · Warnings ${esc(s.violations)}</p>`;
    const ev = events.filter(e => e.userId === s.userId);
    if (ev.length) h += `<details><summary>${ev.length} recorded event(s)</summary><ul class="small">${ev.map(e => `<li>${esc(new Date(e.time).toLocaleString())} — ${esc(e.type)} ${esc(e.detail || '')}</li>`).join('')}</ul></details>`;
    for (let q = 0; q < 5; q++) {
      const r = R && R[q];
      h += `<div class="qdetail"><b>Q${q + 1}</b> ${spec ? '<code>' + esc(spec.questions[q].sig) + '</code>' : ''} ${r ? levelCell(r) : ''}`;
      if (r && r.attempted) {
        h += '<ul class="small">' + r.tests.map((t, k) => `<li>${t.pass ? '✓' : '✗'} Test ${k + 1}: ${esc(t.name)}${t.reason && !t.pass ? ' — ' + esc(t.reason) : ''}</li>`).join('') + '</ul>';
        if (r.static.notes.length) h += `<div class="small warn">Code checks: ${esc(r.static.notes.join(' · '))}</div>`;
        if (r.compileErrors) h += `<pre>${esc(r.compileErrors)}</pre>`;
      } else if (r) h += ' <span class="muted small">not attempted</span>';
      h += '</div>';
    }
    const program = s.progress && s.progress.codes ? s.progress.codes[0] : '';
    const M = mains[s.userId];
    if (M && !M.noTests) {
      h += `<div class="qdetail"><b>main()</b> ${M.attempted ? `<span class="lv l${M.level}">${M.level}</span> outputs correct ${M.passed}/${M.total}` : '<span class="muted">not written</span>'}`;
      if (M.attempted) {
        h += '<ul class="small">' + M.scenarios.map((sc, i) => `<li>Check ${i + 1} ${sc.visible ? '(sample)' : '(hidden)'}${sc.status !== 'ok' ? ' — ' + esc(sc.status) : ''}: ${sc.checks.map(c => (c.pass ? '✓' : '✗') + ' opt ' + c.opt).join(', ')}</li>`).join('') + '</ul>';
        h += '<div class="small">Code checks: ' + M.code.items.map(x => (x.ok ? '✓ ' : '✗ ') + esc(x.label)).join(' · ') + '</div>';
      }
      h += '</div>';
    }
    h += `<div class="qdetail"><b>Full program</b><pre style="max-height:520px">${esc(program || '(nothing saved yet)')}</pre></div>`;
    modal(`${s.name} (${s.userId}) — Roll ${s.roll}`, h);
  }
})();
