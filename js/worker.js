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
