/* Web Worker: hosts Clang (WebAssembly) and runs one program at a time. */
importScripts('../clang/clang-wasm.global.js');
let compiler = null;
const BASE = new URL('../clang/', self.location.href).href;

async function ensure() {
  if (compiler) return compiler;
  compiler = await self.clangWasm.createCompiler('c', {
    baseUrl: BASE, std: 'gnu11',
    onProgress: (v) => self.postMessage({ type: 'progress', value: v })
  });
  return compiler;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try { await ensure(); self.postMessage({ type: 'ready' }); }
    catch (err) { self.postMessage({ type: 'init-error', message: String((err && err.message) || err) }); }
    return;
  }
  /* Interactive run: the program is re-run from the start with all lines typed so far (it is
     deterministic and the compiled program is cached, so this takes milliseconds). When it asks for
     more input than has been typed, it is stopped and the page shows an input line at that point. */
  if (m.type === 'interactive') {
    let result;
    const log = [];
    let idx = 0, need = false;
    const code = m.code + '\n#include <stdio.h>\n__attribute__((constructor)) static void __portal_unbuffered(void) { setvbuf(stdout, NULL, _IONBF, 0); }\n';
    try {
      const c = await ensure();
      const r = await c.run(code, '', {
        stdin: () => { if (idx < m.inputs.length) { const line = m.inputs[idx++]; log.push({ in: line }); return line; } need = true; throw new Error('PORTAL_NEED_INPUT'); },
        onOutput: (chunk) => { if (chunk) log.push({ out: chunk }); }
      });
      result = { status: 'done', log, errors: r.errors, exitCode: r.exitCode };
    } catch (err) {
      result = need ? { status: 'need', log, errors: [] } : { status: 'error', log, errors: [], runtimeError: String((err && err.message) || err) };
    }
    self.postMessage({ type: 'result', id: m.id, result });
    return;
  }
  if (m.type === 'run') {
    let result;
    try {
      const c = await ensure();
      const r = await c.run(m.code, m.input || '');
      result = { stdout: r.stdout, stderr: r.stderr, errors: r.errors, exitCode: r.exitCode, compileMs: r.compileMs, runMs: r.runMs };
    } catch (err) {
      result = { stdout: '', errors: [], runtimeError: String((err && err.message) || err), exitCode: null };
    }
    self.postMessage({ type: 'result', id: m.id, result });
  }
};
