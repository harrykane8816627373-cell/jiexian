'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { join, resolve } = require('node:path');
const { parseArgs } = require('node:util');
const { mixedScreenshotDraft } = require('./repair-fixture.cjs');
const { near24ScreenshotDraft, lengthScreenshotDraft, lengthScreenshotWrappedLayout } = require('./obstacle-cluster-fixture.cjs');
const { node19Draft, interruptedNode19Draft } = require('./node19-fixture.cjs');

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  root: { type: 'string', default: join(__dirname, '..') },
  runs: { type: 'string', default: '7' },
} });
const runs = Number(values.runs);
assert.ok(Number.isSafeInteger(runs) && runs > 0, '--runs must be a positive integer');
for (const name of ['engine', 'planarity', 'solver-contact-repair', 'solver-obstacle-corridors',
  'solver-coupled-repair', 'solver-repair', 'solver-obstacles', 'puzzles', 'solver-search', 'solver-relaxation',
  'solver-breakout', 'solver-tracks', 'solver-regions', 'solver-geometry', 'exact-solver', 'solver-length']) {
  require(join(resolve(values.root), name + '.js'));
}
const g = globalThis.Jiexian;
const lengthSolver = globalThis.JiexianSolverLength;
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
const cases = new Map([
  ['local-repair', mixedScreenshotDraft],
  ['boundary-band', near24ScreenshotDraft],
  ['open-corridor', openCorridor],
  ['interrupted-corridor', interruptedNode19Draft],
  ['shorten-loop', lengthScreenshotDraft],
]);

console.log(`Node ${process.version}, ${process.platform}/${process.arch}, 1 warm-up + ${runs} measured per case`);
for (const name of positionals.length ? positionals : cases.keys()) {
  assert.ok(cases.has(name), 'Unknown benchmark case: ' + name);
  const level = globalThis.JiexianPuzzles.authored(cases.get(name)());
  const wrapped = name === 'shorten-loop' ? lengthScreenshotWrappedLayout() : null;
  const start = wrapped || level.initial;
  const original = g.copy(start);
  const initialPoints = g.positions(level, start);
  const initialLength = g.totalLength(level, initialPoints);
  assert.equal(g.evaluate(level, initialPoints).count === 0, Boolean(wrapped));
  const samples = [];
  let reference, length;
  for (let run = 0; run <= runs; run++) {
    const begin = performance.now();
    const result = wrapped ? lengthSolver.refine(level, lengthSolver.start(level, [start])) :
      globalThis.JiexianSolverSearch.search(level, start, globalThis.JiexianExact.prepareExact);
    const elapsed = performance.now() - begin;
    if (run) samples.push(elapsed);

    if (wrapped) assert.ok(['length-best', 'length-proven'].includes(result.status));
    else assert.equal(result.status, 'solved', name + ' must solve before Z3');
    const points = g.positions(level, result.state);
    assert.ok(points.every((p) => p.every(Number.isFinite)));
    assert.equal(g.evaluate(level, points).count, 0);
    assert.deepEqual(start, original);
    if (!run) {
      const replay = g.copy(start);
      for (const { index, value } of g.planTo(level, start, result.state)) replay[index] = value;
      assert.deepEqual(replay, result.state);
    }
    length = g.totalLength(level, points);
    if (wrapped) assert.ok(length < initialLength && result.lower <= length && length <= result.upper);
    const digest = createHash('sha256').update(JSON.stringify(result.state)).digest('hex').slice(0, 16);
    reference ??= digest;
    assert.equal(digest, reference, name + ' changed across runs');
  }
  samples.sort((a, b) => a - b);
  const median = (samples[Math.floor((runs - 1) / 2)] + samples[Math.floor(runs / 2)]) / 2;
  console.log(`${name}: ${median.toFixed(2)} ms median, length ${length.toFixed(4)}, state ${reference}`);
}
