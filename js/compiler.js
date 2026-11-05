/* Runs the C compiler (Clang → WebAssembly) inside a Web Worker on THIS computer.
 * Nothing is sent to any server, so there is no shared compiler that can get busy.
 * Each run has a time limit; on timeout the worker is killed and restarted. */
(function () {
  class LocalCompiler {
    constructor() {
      this.worker = null; this.readyPromise = null; this.seq = 0;
      this.pending = new Map(); this.chain = Promise.resolve();
      this.onProgress = null; this.state = 'idle';
    }
    _spawn() {
      this.worker = new Worker('js/worker.js?v=mw3fjnkr');
      this.state = 'loading';
      this.readyPromise = new Promise((resolve, reject) => {
        this._readyResolve = resolve; this._readyReject = reject;
      });
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') { if (this.onProgress) this.onProgress(m.value); return; }
        if (m.type === 'ready') { this.state = 'ready'; this._readyResolve(); return; }
        if (m.type === 'init-error') { this.state = 'error'; this._readyReject(new Error(m.message)); return; }
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p.resolve(m.result); }
      };
      this.worker.onerror = (e) => {
        this.state = 'error';
        if (this._readyReject) this._readyReject(new Error(e.message || 'Compiler failed to load'));
      };
      this.worker.postMessage({ type: 'init' });
    }
    init() { if (!this.worker) this._spawn(); return this.readyPromise; }
    _restart() {
      try { this.worker.terminate(); } catch (e) {}
      for (const p of this.pending.values()) p.resolve({ timeout: true, errors: [], stdout: '', exitCode: null });
      this.pending.clear(); this.worker = null; this._spawn();
    }
    /* Interactive run with the lines typed so far (see worker.js). */
    runInteractive(code, inputs, timeoutMs) { return this._job({ type: 'interactive', code, inputs: inputs || [] }, timeoutMs); }
    _job(msg, timeoutMs) {
      const job = async () => {
        await this.init();
        const id = ++this.seq;
        return await new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (this.pending.has(id)) { this.pending.delete(id); resolve({ timeout: true, status: 'timeout', log: [], errors: [] }); this._restart(); }
          }, timeoutMs || (window.CONFIG && CONFIG.RUN_TIMEOUT_MS) || 10000);
          this.pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); } });
          this.worker.postMessage(Object.assign({ id }, msg));
        });
      };
      const p = this.chain.then(job, job);
      this.chain = p.catch(() => {});
      return p;
    }
    /* Runs are serialised: one at a time per browser tab. */
    run(code, input, timeoutMs) {
      const job = async () => {
        await this.init();
        const id = ++this.seq;
        return await new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              resolve({ timeout: true, errors: [], stdout: '', exitCode: null });
              this._restart();
            }
          }, timeoutMs || (window.CONFIG && CONFIG.RUN_TIMEOUT_MS) || 10000);
          this.pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); } });
          this.worker.postMessage({ type: 'run', id, code, input: input || '' });
        });
      };
      const p = this.chain.then(job, job);
      this.chain = p.catch(() => {});
      return p;
    }
  }
  window.LocalCompiler = LocalCompiler;
})();
