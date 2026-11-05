/* Talks to the Google Apps Script backend (storage only — no compiling happens there).
 * If CONFIG.APPS_SCRIPT_URL is empty, a DEMO backend stored in this browser is used. */
(function () {
  const URL_ = (window.CONFIG && CONFIG.APPS_SCRIPT_URL || '').trim();

  async function post(payload, attempts) {
    attempts = attempts || 3;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
        const j = await r.json();
        if (j && j.busy) throw new Error('Server busy');
        return j;
      } catch (e) {
        lastErr = e;
        await new Promise(res => setTimeout(res, 800 * Math.pow(2, i) + Math.random() * 1500));
      }
    }
    return { ok: false, error: 'Network problem: ' + (lastErr && lastErr.message || 'no response'), offline: true };
  }
  function beacon(payload) {
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(URL_, new Blob([body], { type: 'text/plain;charset=utf-8' }))) return true;
    } catch (e) {}
    try { fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, keepalive: true }); return true; } catch (e) { return false; }
  }

  /* ------------------------- this computer's identity ------------------------- */
  /* A random ID kept in this browser (localStorage + cookie) and a fingerprint of the browser/screen.
     The backend refuses a login when the same computer was used by another student within a few hours. */
  const DKEY = 'cportal_device_id';
  function deviceId() {
    let id = null;
    try { id = localStorage.getItem(DKEY); } catch (e) {}
    if (!id) { const m = /(?:^|; )cportal_device_id=([^;]+)/.exec(document.cookie || ''); if (m) id = m[1]; }
    if (!id) id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    try { localStorage.setItem(DKEY, id); } catch (e) {}
    try { document.cookie = `${DKEY}=${id}; max-age=${60 * 60 * 24 * 400}; path=/; SameSite=Lax`; } catch (e) {}
    return id;
  }
  async function fingerprint() {
    let canvas = '';
    try { const c = document.createElement('canvas'); c.width = 220; c.height = 30; const g = c.getContext('2d'); g.textBaseline = 'top'; g.font = '16px Arial'; g.fillStyle = '#f60'; g.fillRect(0, 0, 100, 20); g.fillStyle = '#069'; g.fillText('C-portal \u263A 123', 2, 4); canvas = c.toDataURL(); } catch (e) {}
    const parts = [navigator.userAgent, navigator.platform, (navigator.languages || []).join(','), screen.width + 'x' + screen.height + 'x' + screen.colorDepth, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.hardwareConcurrency, navigator.deviceMemory, canvas].join('|');
    try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts)); return Array.from(new Uint8Array(b)).slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; }
  }
  window.Device = { id: deviceId, fingerprint };

  /* ------------------------- encrypted question text ------------------------- */
  function b64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function unlock(caseNo, keyB64) {
    const c = window.CASES[caseNo - 1]; if (!c || !c.enc) return true;
    if (c.s) return true;                                   /* already unlocked */
    const key = await crypto.subtle.importKey('raw', b64(keyB64), 'AES-GCM', false, ['decrypt']);
    const blob = b64(c.enc);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, key, blob.slice(12));
    const d = JSON.parse(new TextDecoder().decode(plain));
    c.s = d.s; c.q = d.q;
    const T = window.TESTS && window.TESTS[caseNo];
    if (T) {
      (d.qspec || []).forEach((x, i) => { if (T.questions[i]) T.questions[i].spec = x; });
      if (d.main) T.main = d.main;
      if (T.mainSpec) { T.mainSpec.input = d.mainInput; T.mainSpec.menu = d.mainMenu; }
    }
    return true;
  }
  window.Content = { unlock };

  /* ------------------------- DEMO backend ------------------------- */
  const DBKEY = 'cportal_demo_db_v2';
  function db() {
    let d; try { d = JSON.parse(localStorage.getItem(DBKEY) || 'null'); } catch (e) { d = null; }
    if (!d) {
      d = { teacherKey: 'teacher123', students: [], progress: {}, events: [], results: {} };
      d.devices = [];
      for (let i = 1; i <= 5; i++) d.students.push({ roll: i, userId: String(i), password: '', name: 'Demo Student ' + i, caseNo: i, locked: false, violations: 0, status: 'NOT STARTED', lastSaved: '', submittedAt: '', email: 'student' + i + '@example.edu' });
      save(d);
    }
    return d;
  }
  function save(d) { try { localStorage.setItem(DBKEY, JSON.stringify(d)); } catch (e) {} }
  function stu(d, token) { const id = String(token || '').replace(/^demo-token-/, ''); return d.students.find(s => s.userId === id); }
  const demo = {
    async call(p) { await new Promise(r => setTimeout(r, 150)); return this.handle(p); },
    handle(p) {
      const d = db();
      switch (p.action) {
        case 'login': {
          const s = d.students.find(x => x.userId.toLowerCase() === String(p.userId || '').trim().toLowerCase() && (x.password || String(x.roll)) === p.password);
          if (!s) return { ok: false, error: 'Invalid user ID or password' };
          const cutoff = Date.now() - 3 * 3600 * 1000;
          const others = [...new Set(d.devices.filter(v => v.deviceId === p.deviceId && v.userId !== s.userId && !v.status && v.time >= cutoff).map(v => v.userId))];
          if (p.deviceId && others.length) {
            d.devices.push({ deviceId: p.deviceId, userId: s.userId, time: Date.now(), status: 'BLOCKED' });
            d.events.push({ time: new Date().toISOString(), userId: s.userId, type: 'SHARED_DEVICE_BLOCKED', detail: 'Same computer used by: ' + others.join(', ') });
            others.forEach(o => d.events.push({ time: new Date().toISOString(), userId: o, type: 'SHARED_DEVICE_OTHER', detail: s.userId + ' tried to log in on the computer this student used' }));
            save(d); return { ok: false, blocked: true, error: 'This computer was used for another student\'s assignment in the last 3 hours. Each student must use their own computer. This attempt has been reported to your teacher.' };
          }
          if (p.deviceId) d.devices.push({ deviceId: p.deviceId, userId: s.userId, time: Date.now(), status: '' });
          save(d);
          return { ok: true, token: 'demo-token-' + s.userId, student: pub(s), mustChange: !s.password, progress: d.progress[s.userId] || null };
        }
        case 'load': { const s = stu(d, p.token); if (!s) return { ok: false, error: 'Session expired' }; return { ok: true, student: pub(s), mustChange: !s.password, progress: d.progress[s.userId] || null }; }
        case 'content': {
          const s = stu(d, p.token); if (!s) return { ok: false, error: 'Session expired' };
          if (s.locked) return { ok: false, error: 'Assignment locked' };
          return { ok: true, key: (window.CONFIG && CONFIG.DEMO_CONTENT_KEY) || '' };
        }
        case 'changePassword': {
          const s = stu(d, p.token); if (!s) return { ok: false, error: 'Session expired' };
          if ((s.password || String(s.roll)) !== p.oldPassword) return { ok: false, error: 'Current password is wrong' };
          if (String(p.newPassword || '').length < 6) return { ok: false, error: 'New password must have at least 6 characters' };
          if (String(p.newPassword) === String(s.roll)) return { ok: false, error: 'Do not use your roll number as the password' };
          s.password = p.newPassword; save(d); return { ok: true };
        }
        case 'teacherAllowDevice': {
          if (p.key !== d.teacherKey) return { ok: false, error: 'Wrong teacher key' };
          const devs = d.devices.filter(v => v.userId === p.userId && v.status === 'BLOCKED').map(v => v.deviceId);
          d.devices.forEach(v => { if (devs.includes(v.deviceId)) v.status = 'CLEARED'; });
          d.events.push({ time: new Date().toISOString(), userId: p.userId, type: 'DEVICE_ALLOWED_BY_TEACHER', detail: '' }); save(d); return { ok: true };
        }
        case 'teacherEmail': {
          if (p.key !== d.teacherKey) return { ok: false, error: 'Wrong teacher key' };
          d.faculty = (p.faculty || []).join(', ');
          const withMail = p.toStudents ? (p.rows || []).filter(r => (d.students.find(s => s.userId === String(r.UserID)) || {}).email) : [];
          save(d); return { ok: true, sentStudents: withMail.length, skipped: [], faculty: (p.faculty || []).length, demo: true };
        }
        case 'save': {
          const s = stu(d, p.token); if (!s) return { ok: false, error: 'Session expired' };
          if (s.status === 'FINAL') return { ok: false, error: 'Already finally submitted', student: pub(s) };
          d.progress[s.userId] = { codes: p.codes, results: p.results, updatedAt: p.updatedAt };
          s.lastSaved = new Date().toISOString();
          if (p.submit === 'final') { s.status = 'FINAL'; s.submittedAt = s.lastSaved; }
          else if (p.submit === 'auto') { s.status = 'AUTO-SUBMITTED'; s.submittedAt = s.lastSaved; }
          else if (s.status === 'NOT STARTED' || s.status === 'AUTO-SUBMITTED') s.status = 'IN PROGRESS';
          if (typeof p.violations === 'number') s.violations = Math.max(s.violations, p.violations);
          save(d); return { ok: true, student: pub(s), savedAt: s.lastSaved };
        }
        case 'violation': {
          const s = stu(d, p.token); if (!s) return { ok: false };
          s.violations = Math.max(s.violations + 1, p.count || 0);
          d.events.push({ time: new Date().toISOString(), userId: s.userId, type: p.type, detail: p.detail || '' });
          if (s.violations >= (CONFIG.VIOLATION_LIMIT || 3)) s.locked = true;
          save(d); return { ok: true, student: pub(s) };
        }
        case 'teacherList': {
          if (p.key !== d.teacherKey) return { ok: false, error: 'Wrong teacher key' };
          return { ok: true, students: d.students.map(s => Object.assign(pub(s), { defaultPassword: !s.password, progress: d.progress[s.userId] || null })), events: d.events, faculty: d.faculty || '', mailQuota: 100 };
        }
        case 'teacherResults': { if (p.key !== d.teacherKey) return { ok: false, error: 'Wrong teacher key' }; (p.rows || []).forEach(r => d.results[r.userId] = r); save(d); return { ok: true }; }
        case 'teacherUnlock': {
          if (p.key !== d.teacherKey) return { ok: false, error: 'Wrong teacher key' };
          const s = d.students.find(x => x.userId === p.userId); if (!s) return { ok: false, error: 'Unknown student' };
          s.locked = false; s.violations = 0; if (p.reopen && s.status === 'FINAL') s.status = 'IN PROGRESS';
          d.events.push({ time: new Date().toISOString(), userId: s.userId, type: p.reopen ? 'REOPENED_BY_TEACHER' : 'UNLOCKED_BY_TEACHER', detail: '' }); save(d); return { ok: true };
        }
      }
      return { ok: false, error: 'Unknown action' };
    },
    beacon(p) { this.handle(p); return true; }
  };
  function pub(s) { return { roll: s.roll, userId: s.userId, name: s.name, caseNo: s.caseNo, locked: !!s.locked, violations: s.violations, status: s.status, lastSaved: s.lastSaved, submittedAt: s.submittedAt, email: s.email || '' }; }

  window.API = URL_ ? { demo: false, call: (p) => post(p), beacon } : { demo: true, call: (p) => demo.call(p), beacon: (p) => demo.beacon(p) };
})();
