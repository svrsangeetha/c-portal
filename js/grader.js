/* Auto-evaluation of a FULL student program (includes + structures + functions + main).
 * For each test the student's main() is renamed and the portal's test main() is added, so the
 * student's own functions are called with known data. Hidden expected outputs are SHA-256 hashes.
 * If the whole program does not compile, the required function is extracted and tested alone
 * (so one broken question does not zero the others) — but it can then reach at most level 2. */
(function () {
  const enc = new TextEncoder();
  const STD_INCLUDES = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <ctype.h>\n';
  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function normalize(out) { return String(out || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim(); }
  function stripComments(code) { return String(code || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '); }
  function wrap(text, width) {
    const out = []; let line = '';
    text.split(/\s+/).forEach(w => { if ((line + ' ' + w).trim().length > width) { out.push(line.trim()); line = w; } else line += ' ' + w; });
    if (line.trim()) out.push(line.trim()); return out;
  }

  /* ---------- program template shown in the editor ---------- */
  function template(caseNo) {
    const spec = window.TESTS && window.TESTS[caseNo], ct = window.CASES[caseNo - 1];
    if (!spec) {
      return `${STD_INCLUDES}\n/* Case Study ${caseNo}: ${ct ? ct.t : ''}\n   Declare the structures, write the five functions and a menu-driven main(). */\n\n\nint main(void)\n{\n    \n    return 0;\n}\n`;
    }
    const header = spec.header.replace(/^#include.*\n/gm, '').trim();
    let t = `${STD_INCLUDES}\n/* ================= Structures (given - do not change) ================= */\n${header}\n\n`;
    spec.questions.forEach((q, i) => {
      t += `/* ================= Q${i + 1} (2 marks) =================\n` + wrap(q.spec, 88).map(l => '   ' + l).join('\n') + ' */\n';
      t += `${q.sig}\n{\n    /* write your code here */\n\n}\n\n`;
    });
    t += `/* ================= main() - write it yourself =================\n   Follow the steps in the comments. Write all the code: variables, malloc, reading\n   the data, the menu and the calls to your five functions. (The portal uses its own\n   main() when it runs the test cases, so test cases do not depend on your main().) */\n${spec.main}\n`;
    return t;
  }

  /* ---------- locating functions ---------- */
  /* All top-level function definitions: [{name, text, body}] (comments removed). */
  function listFunctions(code) {
    const c = stripComments(code), out = [];
    let depth = 0, segStart = 0;
    for (let i = 0; i < c.length; i++) {
      const ch = c[i];
      if (depth === 0 && (ch === ';' || ch === '}')) { segStart = i + 1; continue; }
      if (ch === '{') {
        if (depth === 0) {
          const head = c.slice(segStart, i);
          const m = /([A-Za-z_]\w*)\s*\([^;{}]*\)\s*$/.exec(head);
          let j = i + 1, d = 1;
          while (j < c.length && d) { if (c[j] === '{') d++; else if (c[j] === '}') d--; j++; }
          if (m && !/^\s*(if|for|while|switch)\b/.test(m[1])) {
            const lines = head.split('\n'); const pre = lines.filter(l => !/^\s*#/.test(l)).join('\n');
            out.push({ name: m[1], text: (pre.trim() + ' ' + c.slice(i, j)).trim(), body: c.slice(i + 1, j - 1) });
          }
          segStart = j; i = j - 1; continue;
        }
        depth++;
      } else if (ch === '}') depth--;
    }
    return out;
  }
  function findFunction(code, fn) { return listFunctions(code).find(f => f.name === fn) || null; }
  /* helper functions = everything except main() and the five required functions */
  function helperFunctions(code, spec) {
    const req = spec ? spec.questions.map(q => q.fn) : [];
    return listFunctions(code).filter(f => f.name !== 'main' && !req.includes(f.name));
  }
  /* helpers called (directly or indirectly) from a function body */
  function calledHelpers(code, spec, body) {
    const helpers = helperFunctions(code, spec), used = [], seen = new Set();
    let frontier = [body];
    while (frontier.length) {
      const b = frontier.pop();
      helpers.forEach(h => { if (!seen.has(h.name) && new RegExp('\\b' + h.name + '\\s*\\(').test(b)) { seen.add(h.name); used.push(h); frontier.push(h.body); } });
    }
    return used;
  }
  function isAttempted(code, q) { const f = findFunction(code, q.fn); return !!(f && f.body.replace(/\s+/g, '').length); }

  function globalVars(code) {
    const c = stripComments(code).replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
    let depth = 0, cur = '', found = [];
    for (const ch of c) {
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { depth--; if (depth === 0) cur = ''; continue; }
      if (depth !== 0) continue;
      if (ch === ';') {
        const s = cur.split('\n').filter(l => !/^\s*#/.test(l)).join(' ').trim();
        if (s && !/\(/.test(s) && !/^(typedef|enum|union|extern)\b/.test(s) && !/^struct\s+\w+\s*$/.test(s)) found.push(s.split(/[\s=\[]+/).filter(Boolean).slice(-1)[0]);
        cur = ''; continue;
      }
      cur += ch;
    }
    return found;
  }
  function staticCheck(code, q, spec) {
    const notes = [], c = stripComments(code), f = findFunction(code, q.fn);
    const scope = f ? f.body + '\n' + calledHelpers(code, spec, f.body).map(h => h.body).join('\n') : '';
    if (!f) notes.push(`Function ${q.fn}() not found with the required signature`);
    if (/\b(FILE|fopen|fprintf|fscanf|fclose|fread|fwrite)\b/.test(c)) notes.push('File handling is not allowed');
    if (/\b(qsort|bsearch|strstr)\s*\(/.test(c)) notes.push('qsort / bsearch / strstr are not allowed');
    const g = globalVars(code); if (g.length) notes.push('Global variable(s) used: ' + g.join(', '));
    if (f && f.body.trim()) {
      if (q.needLoop !== false && !/\b(for|while)\b/.test(scope)) notes.push('No loop used');
      const requirePtr = !(window.CONFIG && CONFIG.REQUIRE_POINTER_ACCESS === false);
      if (requirePtr && q.needPtr !== false && !/->|\*\s*\(/.test(scope)) notes.push('Structure members not accessed through pointers (use -> or pointer arithmetic, not only a[i].member)');
    }
    return { ok: notes.length === 0, notes };
  }
  function levelFor(attempted, compiled, passed, total, st) {
    if (!attempted) return 0;
    if (!compiled || passed === 0) return 1;
    if (passed === total && st.ok) return 3;
    return 2;
  }

  /* ---------- building test programs ---------- */
  function fullProgram(program, test) {
    return `${STD_INCLUDES}#define main student_main_not_used\n#line 1 "program.c"\n${program}\n#undef main\n#line 1 "test.c"\n${test.main}\n`;
  }
  function isolatedProgram(spec, qi, program, test) {
    const q = spec.questions[qi], parts = helperFunctions(program, spec).map(h => h.text);
    (q.uses || []).forEach(u => { const f = findFunction(program, spec.questions[u].fn); if (f) parts.push(f.text); });
    const f = findFunction(program, q.fn); if (f) parts.push(f.text);
    return `${STD_INCLUDES}${spec.header}\n${parts.join('\n')}\n#line 1 "test.c"\n${test.main}\n`;
  }
  function cleanErrors(errs) {
    return (errs || []).filter(l => !/^Error: process exited/.test(l) && !/warning:/.test(l)).join('\n');
  }

  /* Run the student's own program with keyboard input (Run program button). */
  async function runProgram(compiler, program, input) {
    const r = await compiler.run(program, input || '', window.CONFIG && CONFIG.RUN_TIMEOUT_MS);
    return r;
  }

  /* Evaluate one question of a full program. */
  async function evaluate(compiler, caseNo, qi, program, onStep) {
    const spec = window.TESTS && window.TESTS[caseNo];
    const res = { q: qi + 1, attempted: false, compiled: false, isolated: false, compileErrors: '', tests: [], passed: 0, total: 0, static: { ok: false, notes: [] }, level: 0, at: Date.now() };
    if (!spec) { res.noTests = true; return res; }
    const q = spec.questions[qi];
    program = String(program || '');
    res.total = q.tests.length;
    res.attempted = isAttempted(program, q);
    res.static = staticCheck(program, q, spec);
    if (!res.attempted) return res;
    let mode = 'full';
    for (let t = 0; t < q.tests.length; t++) {
      const test = q.tests[t];
      if (onStep) onStep(`Running test ${t + 1} of ${q.tests.length}…`);
      let r = await compiler.run(mode === 'full' ? fullProgram(program, test) : isolatedProgram(spec, qi, program, test), '', window.CONFIG && CONFIG.RUN_TIMEOUT_MS);
      if (mode === 'full' && r.errors && r.errors.length) {
        res.compileErrors = cleanErrors(r.errors);
        r = await compiler.run(isolatedProgram(spec, qi, program, test), '', window.CONFIG && CONFIG.RUN_TIMEOUT_MS);
        if (r.errors && r.errors.length) {
          res.tests = q.tests.map(tt => ({ name: tt.name, visible: !!tt.visible, pass: false, reason: 'Compilation error' }));
          res.passed = 0; break;
        }
        mode = 'isolated'; res.isolated = true;
        res.static.ok = false; res.static.notes.push('The full program has compilation errors (this function was tested on its own)');
      }
      res.compiled = true;
      const got = normalize(r.stdout);
      const h = await sha256(`${caseNo}|${qi + 1}|${t + 1}|${got}`);
      const entry = { name: test.name, visible: !!test.visible, pass: false };
      if (r.timeout) entry.reason = 'Time limit exceeded (infinite loop?)';
      else if (r.runtimeError || (r.exitCode !== 0 && r.exitCode !== null)) entry.reason = 'Runtime error (crash / invalid pointer)';
      else { entry.pass = (h === test.hash); if (!entry.pass) entry.reason = 'Wrong output'; }
      if (test.visible) { entry.expected = test.expected; entry.got = got; }
      res.tests.push(entry);
      if (entry.pass) res.passed++;
    }
    res.level = levelFor(res.attempted, res.compiled, res.passed, res.total, res.static);
    return res;
  }
  /* ---------- main() evaluation ----------
     1) code checks (reading the code)   2) run checks: the student's whole program is run with the
     scenario input; the expected numbers must appear in the output in order (wording is free). */
  function mainCodeChecks(program, spec) {
    const m = findFunction(program || '', 'main');
    if (!m) return { written: false, items: [], notes: ['main() is missing'] };
    const b = m.body;
    const written = b.replace(/\s+/g, '').replace(/return0;$/, '').length > 0;
    const calls = spec ? spec.questions.filter(q => new RegExp('\\b' + q.fn + '\\s*\\(').test(b)).length : 0;
    const total = spec ? spec.questions.length : 5;
    const items = [
      { label: 'Menu loop (do-while / while / for)', ok: /\b(do|while|for)\b/.test(b) },
      { label: 'switch with a default case', ok: /\bswitch\s*\(/.test(b) && /\bdefault\s*:/.test(b) },
      { label: 'Memory allocated with malloc() / calloc()', ok: /\b(malloc|calloc|realloc)\s*\(/.test(b) },
      { label: 'Allocation checked for NULL', ok: /==\s*NULL|NULL\s*==|!\s*[A-Za-z_]\w*\s*\)/.test(b) },
      { label: 'Input read with scanf()', ok: /\bscanf\s*\(/.test(b) },
      { label: 'Members accessed through pointers (->)', ok: /->/.test(b) },
      { label: `All ${total} functions called (${calls}/${total})`, ok: calls === total },
      { label: 'Memory released with free()', ok: /\bfree\s*\(/.test(b) }
    ];
    return { written, items, notes: items.filter(i => !i.ok).map(i => i.label) };
  }
  function numTokens(text) {
    return (String(text || '').match(/-?\d+(?:\.\d+)?/g) || []).map(t => { const v = parseFloat(t); return Number.isInteger(v) ? String(v) : v.toFixed(2); });
  }
  async function evaluateMain(compiler, caseNo, program, onStep) {
    const spec = window.TESTS && window.TESTS[caseNo];
    const res = { main: true, attempted: false, code: null, scenarios: [], passed: 0, total: 0, level: 0, at: Date.now() };
    if (!spec || !spec.mainSpec) { res.noTests = true; return res; }
    res.code = mainCodeChecks(program, spec);
    res.attempted = res.code.written;
    spec.mainSpec.scenarios.forEach(sc => res.total += sc.checks.length);
    if (!res.attempted) return res;
    let anyRan = false;
    for (let si = 0; si < spec.mainSpec.scenarios.length; si++) {
      const sc = spec.mainSpec.scenarios[si];
      if (onStep) onStep(`Running your program with input ${si + 1} of ${spec.mainSpec.scenarios.length}…`);
      const r = await compiler.run(STD_INCLUDES + '#line 1 "program.c"\n' + program, sc.input, window.CONFIG && CONFIG.RUN_TIMEOUT_MS);
      const out = { visible: sc.visible, status: 'ok', checks: [] };
      if (r.errors && r.errors.length) { out.status = 'Compilation errors'; out.errors = r.errors.filter(l => !/warning:|^Error: process exited/.test(l)).join('\n'); }
      else if (r.timeout) out.status = 'Did not finish — check that you read the input in the given order and exit on 0';
      else if (r.runtimeError || (r.exitCode !== 0 && r.exitCode !== null)) out.status = 'Program crashed (runtime error / invalid pointer)';
      const toks = out.status === 'ok' ? numTokens(r.stdout) : [];
      if (out.status === 'ok') anyRan = true;
      if (sc.visible) { out.input = sc.input; out.output = String(r.stdout || '').slice(0, 4000); }
      let pos = 0;
      for (let li = 0; li < sc.checks.length; li++) {
        const ck = sc.checks[li], n = ck.expected ? ck.expected.length : ck.n;
        let j = pos, ok = out.status === 'ok';
        for (let ti = 0; ok && ti < n; ti++) {
          let found = -1;
          for (let k = j; k < toks.length; k++) {
            const hit = ck.expected ? toks[k] === ck.expected[ti] : (await sha256(`${caseNo}|M|${si}|${li}|${ti}|${toks[k]}`)) === ck.hashes[ti];
            if (hit) { found = k; break; }
          }
          if (found < 0) ok = false; else j = found + 1;
        }
        if (ok) pos = j;
        out.checks.push({ opt: ck.opt, pass: ok, expected: ck.expected ? (ck.show || ck.expected.join(' ')) : undefined });
        if (ok) res.passed++;
        if (!ck.weak) { res.strongTotal = (res.strongTotal || 0) + 1; if (ok) res.strongPassed = (res.strongPassed || 0) + 1; }
      }
      res.scenarios.push(out);
    }
    const codeIssues = res.code.notes.length;
    /* Level 2 needs at least half of the DISTINCTIVE outputs (checks containing an amount, an id or a
       number of 10 or more), so that a program that only prints a menu cannot pass by chance. */
    const sp = res.strongTotal ? (res.strongPassed || 0) : res.passed, st = res.strongTotal || res.total;
    if (!anyRan || sp * 2 < st) res.level = 1;                          /* poor */
    else if (res.passed === res.total && codeIssues <= 1) res.level = 3; /* all outputs correct, code rules followed */
    else res.level = 2;
    return res;
  }
  window.Grader = { evaluateMain, mainCodeChecks, evaluate, runProgram, template, findFunction, listFunctions, staticCheck, isAttempted, normalize, sha256, levelFor, fullProgram, isolatedProgram, STD_INCLUDES };
})();
