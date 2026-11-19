const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { gunzipSync } = require('node:zlib');
require('../engine.js');
require('../planarity.js');
require('../puzzles.js');
require('../exact-solver.js');

const g = globalThis.Jiexian;
const puzzles = globalThis.JiexianPuzzles;
const { solveExact } = globalThis.JiexianExact;
const wasmBinary = gunzipSync(readFileSync(join(__dirname, '../vendor/z3smt2w.wasm.gz')));
const z3 = require('../vendor/z3smt2w.js')({ wasmBinary, noInitialRun: true });
const init = z3.cwrap('smt2Init', 'number', []);
const ask = z3.cwrap('smt2Ask', 'string', ['number', 'string']);
const destroy = z3.cwrap('smt2Destroy', null, ['number']);

function exact(level) {
  const context = init();
  try {
    return solveExact(level, (command) => ask(context, command));
  } finally {
    destroy(context);
  }
}

function railDraft(left, right) {
  return {
    points: [[250, 270], [234, 270], [left, 270], [right, 270], [100, 435], [800, 435]],
    edges: [[4, 5]],
    fixed: [1, 2, 3, 4, 5],
    groups: [{ kind: 'rail', members: [0], a: [250, 270], b: [350, 270] }],
    obstacles: [],
  };
}

function checkSolution(level, result) {
  assert.equal(result.status, 'solved');
  assert.equal(g.evaluate(level, g.positions(level, result.state)).count, 0);
  const replay = g.copy(level.initial);
  for (const { index, value } of g.solve({ ...level, witness: result.state }, replay)) replay[index] = value;
  assert.equal(g.evaluate(level, g.positions(level, replay)).count, 0);
}

test('global search finds a 0.002-unit rail interval missed by the local search', () => {
  const level = puzzles.solveDraft(railDraft(283.124, 349.126)).puzzle;
  assert.equal(level.witness, null);
  assert.equal(puzzles.searchDraft(level), null);
  const result = exact(level);
  checkSolution(level, result);
  const [x] = g.positions(level, result.state)[0];
  assert.ok(x >= 316.124 && x <= 316.126);
});

test('closed distance constraints allow an isolated solution and reject overlapping exclusions', () => {
  const tangent = puzzles.authored(railDraft(283, 349));
  const result = exact(tangent);
  checkSolution(tangent, result);
  assert.equal(g.positions(tangent, result.state)[0][0], 316);
  assert.equal(exact(puzzles.authored(railDraft(283, 348.9))).status, 'unsat');
});

test('small rail instances agree with exhaustive enumeration of their feasible integer positions', () => {
  for (let left = 279; left <= 287; left += 2) {
    for (let right = 345; right <= 351; right += 2) {
      const level = puzzles.authored(railDraft(left, right));
      // All exclusion interval endpoints are integers. Any nonempty closed gap contains one.
      const hasSolution = Array.from({ length: 101 }, (_, i) => [i / 100]).some((value) =>
        !g.evaluate(level, g.positions(level, [value])).count);
      assert.equal(exact(level).status, hasSolution ? 'solved' : 'unsat', `anchors at ${left}, ${right}`);
    }
  }
});

test('fixed crossings, node-to-edge collisions and segment-to-obstacle collisions are unsatisfiable', () => {
  const fixedLevel = (points, edges, obstacles = []) => g.createLevel({ points, edges, obstacles, controls: [] });
  const crossed = fixedLevel([[100, 100], [800, 400], [800, 100], [100, 400]], [[0, 1], [2, 3]]);
  const blocked = fixedLevel([[100, 100], [800, 100], [450, 105]], [[0, 1]]);
  const obstacle = fixedLevel([[100, 100], [800, 100]], [[0, 1]], [{ center: [450, 100], r: 30 }]);
  const tangent = fixedLevel([[100, 100], [800, 100]], [[0, 1]], [{ center: [450, 134], r: 30 }]);
  for (const level of [crossed, blocked, obstacle]) assert.equal(exact(level).status, 'unsat');
  checkSolution(tangent, exact(tangent));
});

test('nonplanar constrained drafts are rejected before launching the search', () => {
  const points = [[100, 100], [250, 100], [400, 100], [100, 350], [250, 350], [400, 350]];
  const edges = [0, 1, 2].flatMap((i) => [3, 4, 5].map((j) => [i, j]));
  const result = puzzles.solveDraft({ points, edges, fixed: [0] });
  assert.match(result.reason, /不是平面图/);
  assert.equal(result.puzzle, undefined);
});

test('moving a rail endpoint can remove a strict crossing between two edges', () => {
  const draft = {
    points: [[110, 160], [800, 400], [350, 310], [650, 310]],
    edges: [[0, 1], [2, 3]],
    fixed: [0, 2, 3],
    groups: [{ kind: 'rail', members: [1], a: [280, 400], b: [800, 400] }],
  };
  const level = puzzles.authored(draft);
  assert.equal(g.evaluate(level, g.positions(level, level.initial)).count, 1);
  checkSolution(level, exact(level));
});

test('one witness respects fixed points, mirrors, rotors, independent shared rails and obstacles', () => {
  const draft = railDraft(283.124, 349.126);
  draft.points.push([720, 270], [700, 150], [650, 215], [600, 365], [820, 445], [490, 90]);
  draft.groups[0] = { kind: 'rail', members: [0, 6], a: [250, 270], b: [800, 270] };
  draft.groups.push({ kind: 'rotor', members: [7, 8], center: [650, 150] },
    { kind: 'mirror', members: [9, 10] });
  draft.obstacles.push({ center: [600, 270], r: 35 }, { center: [715, 150], r: 24 });
  const level = puzzles.authored(draft);
  const result = exact(level);
  checkSolution(level, result);
  const points = g.positions(level, result.state);
  for (const i of draft.fixed) assert.deepEqual(points[i], draft.points[i]);
  assert.notEqual(points[0][0], points[6][0]);
  assert.equal(points[0][1], 270);
  assert.equal(points[6][1], 270);
  assert.notDeepEqual(points[7], draft.points[7]);
  assert.ok(Math.abs(g.distance(points[7], points[8]) - g.distance(draft.points[7], draft.points[8])) < 1e-8);
  for (let axis = 0; axis < 2; axis++) {
    assert.equal(points[9][axis] + points[10][axis], draft.points[9][axis] + draft.points[10][axis]);
  }
});

test('forwarding a sub-epsilon coordinate change reaches the certified playable layout', () => {
  const points = [[100, 100], [133, 100]];
  const level = g.createLevel({ points, edges: [[0, 1]], controls: [g.free(1, [133 - 1e-9, 100])] });
  assert.equal(g.evaluate(level, g.positions(level, level.initial)).count, 1);
  checkSolution(level, { status: 'solved', state: level.witness });
});
