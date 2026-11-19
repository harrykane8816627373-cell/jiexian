'use strict';

importScripts('./engine.js?v=7', './planarity.js?v=3', './solver-obstacles.js?v=1', './puzzles.js?v=12', './solver-tracks.js?v=1',
  './solver-regions.js?v=1', './solver-geometry.js?v=3', './exact-solver.js?v=3');

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

self.onmessage = async ({ data: { puzzle, current } }) => {
  try {
    const puzzles = globalThis.JiexianPuzzles;
    const obstacleLayout = puzzles.searchObstacles(puzzle, current);
    if (obstacleLayout) {
      self.postMessage({ status: 'solved', state: obstacleLayout });
      return;
    }
    const { prepareExact, solveExact } = globalThis.JiexianExact;
    const problem = prepareExact(puzzle);
    if (problem.status === 'solved' || problem.status === 'unsat') {
      self.postMessage(problem);
      return;
    }
    const state = puzzles.searchDraft(puzzle, current);
    if (state) {
      self.postMessage({ status: 'solved', state });
      return;
    }
    if (problem.status !== 'ready') {
      self.postMessage(problem);
      return;
    }
    self.postMessage({ status: 'exact' });
    const z3 = await loadZ3();
    const context = z3.init();
    try {
      self.postMessage(solveExact(puzzle, (command) => z3.ask(context, command), problem));
    } finally {
      z3.destroy(context);
    }
  } catch (error) {
    console.error('Custom puzzle search failed', error);
    self.postMessage({ status: 'unknown' });
  }
};
