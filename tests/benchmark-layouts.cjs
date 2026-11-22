'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { join, resolve } = require('node:path');
const { parseArgs } = require('node:util');
const { readFileSync } = require('node:fs');
const { gunzipSync } = require('node:zlib');
const { mixedScreenshotDraft } = require('./repair-fixture.cjs');
const { near24ScreenshotDraft, lengthScreenshotDraft, lengthScreenshotWrappedLayout } = require('./obstacle-cluster-fixture.cjs');
const { node19Draft, interruptedNode19Draft } = require('./node19-fixture.cjs');
const { rotorChord } = require('./orbit-fixture.cjs');

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  root: { type: 'string', default: join(__dirname, '..') },
  runs: { type: 'string', default: '7' },
  extended: { type: 'boolean' },
} });
const runs = Number(values.runs);
assert.ok(Number.isSafeInteger(runs) && runs > 0, '--runs must be a positive integer');
for (const name of ['engine', 'planarity', 'solver-contact-repair', 'solver-obstacle-corridors',
  'solver-coupled-repair', 'solver-repair', 'solver-obstacles', 'puzzles', 'solver-search', 'solver-relaxation',
  'solver-breakout', 'solver-tracks', 'solver-regions', 'solver-geometry', 'exact-solver', 'solver-length']) {
  require(join(resolve(values.root), name + '.js'));
}
const g = globalThis.Jiexian;
const puzzles = globalThis.JiexianPuzzles;
const exact = globalThis.JiexianExact;
const lengthSolver = globalThis.JiexianSolverLength;
const search = (level, state) => globalThis.JiexianSolverSearch.search(level, state, exact.prepareExact);
function openCorridor() {
  const draft = node19Draft();
  draft.points[18] = [440.59, 281.46];
  draft.edges.push([11, 18]);
  // Fixed permutation of the entry order, identical for every implementation.
  let seed = 2026;
  for (let i = draft.edges.length - 1; i > 0; i--) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const j = Math.floor((seed / 2 ** 32) * (i + 1));
    [draft.edges[i], draft.edges[j]] = [draft.edges[j], draft.edges[i]];
  }
  return draft;
}
const drafts = [
  ['local-repair', mixedScreenshotDraft],
  ['boundary-band', near24ScreenshotDraft],
  ['open-corridor', openCorridor],
  ['interrupted-corridor', interruptedNode19Draft],
  ['shorten-loop', lengthScreenshotDraft],
];
const cases = new Map(drafts.map(([name, draft]) => [name, () => {
  const level = puzzles.authored(draft());
  if (name === 'shorten-loop') {
    return { level, state: lengthScreenshotWrappedLayout(), solve: shorten, length: true };
  }
  return { level, solve: search, status: 'solved' };
}]));

function shorten(level, state) {
  return lengthSolver.refine(level, lengthSolver.start(level, [state]));
}

let z3;
function exactSolve(level, state) {
  const model = exact.prepareExact(level, state);
  if (model.status !== 'ready') return model;
  const context = z3.init();
  try {
    return exact.solveExact(level, (command) => z3.ask(context, command), model, state);
  } finally {
    z3.destroy(context);
  }
}

if (values.extended) {
  const vendor = join(resolve(values.root), 'vendor');
  const wasmBinary = gunzipSync(readFileSync(join(vendor, 'z3smt2w.wasm.gz')));
  const module = require(join(vendor, 'z3smt2w.js'))({ wasmBinary, noInitialRun: true });
  z3 = {
    init: module.cwrap('smt2Init', 'number', []),
    ask: module.cwrap('smt2Ask', 'string', ['number', 'string']),
    destroy: module.cwrap('smt2Destroy', null, ['number']),
  };
  for (const mode of Object.keys(puzzles.modes)) {
    for (const [i, [rank, size]] of [['easy', 4], ['medium', 12], ['hard', 24], ['hard', 36]].entries()) {
      cases.set(`replay-${mode}-${size}`, () => ({
        level: puzzles.generate(2026 + i, rank, size, mode),
        status: 'solved',
        solve(level, start) {
          const state = g.copy(start);
          for (const move of g.solve(level, start)) state[move.index] = move.value;
          return { status: 'solved', state };
        },
      }));
    }
    cases.set(`length-${mode}`, () => {
      const level = puzzles.generate(1776, 'medium', 12, mode);
      return { level, state: level.witness, length: true, solve: shorten };
    });
  }
  for (const [name, draft] of drafts.slice(1, -1)) {
    cases.set(`reflected-${name}`, () => {
      const original = draft();
      const reflect = ([x, y]) => [g.width - x, y];
      const level = puzzles.authored({ ...original, edges: original.edges.slice().reverse(),
        points: original.points.map(reflect), obstacles: original.obstacles.map(({ center, r }) => ({ center: reflect(center), r })) });
      return { level, solve: search, status: 'solved' };
    });
  }
  for (const [name, offset, status] of [['tangent-rotor', 2, 'solved'], ['blocked-rotor', 1.999999, 'unsat']]) {
    cases.set(name, () => ({ level: rotorChord(g, 26, offset), solve: exactSolve, status }));
  }
  cases.set('fixed-crossing', () => ({ status: 'unsat', solve: exactSolve,
    level: puzzles.authored({ points: [[100, 100], [400, 400], [100, 400], [400, 100]],
      edges: [[0, 1], [2, 3]], fixed: [0, 1, 2, 3] }) }));
}

console.log(`Node ${process.version}, ${process.platform}/${process.arch}, 1 warm-up + ${runs} measured per case`);
for (const name of positionals.length ? positionals : cases.keys()) {
  assert.ok(cases.has(name), 'Unknown benchmark case: ' + name);
  const { level, state, solve, length: optimizeLength, status } = cases.get(name)();
  assert.ok(level, name + ' could not be constructed');
  const start = state ?? level.initial;
  const original = g.copy(start);
  const initialPoints = g.positions(level, start);
  const initialLength = g.totalLength(level, initialPoints);
  assert.equal(g.evaluate(level, initialPoints).count === 0, Boolean(optimizeLength));
  const samples = [];
  let reference, length;
  for (let run = 0; run <= runs; run++) {
    const begin = performance.now();
    const result = solve(level, start);
    const elapsed = performance.now() - begin;
    if (run) samples.push(elapsed);

    if (optimizeLength) assert.ok(['length-best', 'length-proven'].includes(result.status));
    else assert.equal(result.status, status, name + ' returned an unexpected status');
    assert.deepEqual(start, original);
    if (result.status === 'unsat') continue;
    const points = g.positions(level, result.state);
    assert.ok(points.every((p) => p.every(Number.isFinite)));
    assert.equal(g.evaluate(level, points).count, 0);
    if (!run) {
      const replay = g.copy(start);
      for (const { index, value } of g.planTo(level, start, result.state)) replay[index] = value;
      assert.deepEqual(replay, result.state);
    }
    length = g.totalLength(level, points);
    if (optimizeLength) assert.ok(length <= initialLength && result.lower <= length && length <= result.upper);
    if (name === 'shorten-loop') assert.ok(length < initialLength);
    const outcome = [result.status, result.state, result.lower, result.upper, result.preserveRepair];
    const digest = createHash('sha256').update(JSON.stringify(outcome)).digest('hex').slice(0, 16);
    reference ??= digest;
    assert.equal(digest, reference, name + ' changed across runs');
  }
  samples.sort((a, b) => a - b);
  const median = (samples[Math.floor((runs - 1) / 2)] + samples[Math.floor(runs / 2)]) / 2;
  const detail = status === 'unsat' ? 'unsat' : `length ${length.toFixed(4)}, result ${reference}`;
  console.log(`${name}: ${median.toFixed(3)} ms median, ${detail}`);
}
