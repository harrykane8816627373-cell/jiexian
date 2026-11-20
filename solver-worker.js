'use strict';

importScripts('./engine.js?v=13', './planarity.js?v=3', './solver-contact-repair.js?v=2', './solver-obstacle-corridors.js?v=1',
  './solver-coupled-repair.js?v=2', './solver-repair.js?v=2', './solver-obstacles.js?v=1', './puzzles.js?v=13',
  './solver-search.js?v=9', './solver-relaxation.js?v=6', './solver-breakout.js?v=2', './solver-tracks.js?v=1', './solver-regions.js?v=1',
  './solver-geometry.js?v=9', './exact-solver.js?v=11', './solver-length.js?v=4');

async function loadZ3() {
  const response = await fetch('./vendor/z3smt2w.wasm.gz');
  if (!response.ok) throw new Error('Z3 WebAssembly download failed');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const wasmBinary = new Uint8Array(await new Response(stream).arrayBuffer());
  importScripts('./vendor/z3smt2w.js');
  let module;
  await new Promise((resolve, reject) => {
    module = globalThis.Z3({ wasmBinary, noInitialRun: true, onRuntimeInitialized: resolve, onAbort: reject });
  });
  return {
    init: module.cwrap('smt2Init', 'number', []),
    ask: module.cwrap('smt2Ask', 'string', ['number', 'string']),
    destroy: module.cwrap('smt2Destroy', null, ['number']),
  };
}

self.onmessage = async ({ data: { puzzle, current, objective, previous } }) => {
  let z3, context;
  async function exactQuery() {
    if (context === undefined) {
      z3 = await loadZ3();
      context = z3.init();
    }
    return (command) => z3.ask(context, command);
  }
  let best;
  try {
    const { prepareExact, solveExact } = globalThis.JiexianExact;
    async function findWitness() {
      const fast = globalThis.JiexianSolverSearch.search(puzzle, current, prepareExact);
      return fast.status === 'ready' ? solveExact(puzzle, await exactQuery(), fast.problem, fast.candidate) : fast;
    }
    if (objective !== 'length') {
      self.postMessage(await findWitness());
      return;
    }
    const { start, refine, certify } = globalThis.JiexianSolverLength;
    const progress = (next) => {
      best = next;
      self.postMessage({ type: 'length-progress', ...next });
    };
    best = start(puzzle, [current, puzzle.witness, previous?.state], progress, previous?.lower);
    if (!best) {
      const result = await findWitness();
      if (result.status !== 'solved') {
        self.postMessage(result);
        return;
      }
      best = start(puzzle, [result.state], progress);
      if (!best) {
        self.postMessage({ status: 'precision' });
        return;
      }
    }
    if (best.status !== 'length-proven') {
      progress(best);
      best = refine(puzzle, best, progress);
    }
    if (best.status !== 'length-proven') {
      best = certify(puzzle, best, await exactQuery(), progress);
    }
    self.postMessage(best);
  } catch (error) {
    console.error('Custom puzzle search failed', error);
    self.postMessage(best ?? { status: 'unknown' });
  } finally {
    if (context !== undefined) z3.destroy(context);
  }
};
