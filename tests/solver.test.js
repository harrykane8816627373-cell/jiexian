const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { gunzipSync } = require('node:zlib');
require('../engine.js');
require('../planarity.js');
require('../solver-obstacles.js');
require('../solver-repair.js');
require('../solver-coupled-repair.js');
require('../solver-contact-repair.js');
require('../solver-obstacle-corridors.js');
require('../puzzles.js');
require('../solver-search.js');
require('../solver-tracks.js');
require('../solver-regions.js');
require('../solver-geometry.js');
require('../exact-solver.js');
require('../solver-breakout.js');
require('../solver-relaxation.js');
require('../solver-length.js');

const g = globalThis.Jiexian;
const puzzles = globalThis.JiexianPuzzles;
const { prepareExact, solveExact } = globalThis.JiexianExact;
const optimalLength = globalThis.JiexianSolverLength;
const { repair } = globalThis.JiexianRepair;
const { repair: repairTogether } = globalThis.JiexianCoupledRepair;
const { screenshotDraft, coupledScreenshotDraft, mixedScreenshotDraft, contactScreenshotDraft, perturbedContactDraft, corridorScreenshotDraft } =
  require('./repair-fixture.cjs');
const { portraitDrafts } = require('./portrait-fixture.cjs');
const { rotorChord } = require('./orbit-fixture.cjs');
const { corridorLevel } = require('./clearance-fixture.cjs');
const { crossingScreenshotDraft, crossingAndClearanceScreenshotDraft } = require('./crossing-fixture.cjs');
const { obstacleClusterScreenshotDraft, maxObstacleClusterDrafts } = require('./obstacle-cluster-fixture.cjs');
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

test('total length can be shortened on a conflict-free board and replayed without spreading it', () => {
  const level = puzzles.authored({ points: [[100, 210], [300, 210], [500, 210], [700, 210]], edges: [[0, 1], [2, 3]] });
  const initial = level.initial;
  assert.equal(g.evaluate(level, level.points).count, 0);
  const result = optimalLength.start(level, [initial]);
  assert.equal(result.status, 'length-proven');
  assert.equal(result.lower, 66);
  assert.ok(result.length < 66.1);
  const replay = g.copy(initial);
  for (const { index, value } of g.planTo(level, initial, result.state)) replay[index] = value;
  assert.deepEqual(replay, result.state);
  assert.equal(g.evaluate(level, g.positions(level, replay)).count, 0);
  assert.equal(g.totalLength(level, g.positions(level, replay)), result.length);
});

test('a chain of connected fixed endpoints strengthens the total length lower bound', () => {
  const level = puzzles.authored({ points: [[100, 100], [400, 100], [250, 410]], edges: [[0, 2], [1, 2]], fixed: [0, 1] });
  const result = optimalLength.start(level, [level.initial]);
  assert.equal(result.lower, 300);
  assert.equal(result.status, 'length-proven');
  const points = g.positions(level, result.state);
  assert.deepEqual(points.slice(0, 2), level.points.slice(0, 2));
});

test('the full length model proves a bound that depends on a slider domain', () => {
  const level = puzzles.authored({ points: [[160, 200], [340, 200], [250, 410]], edges: [[0, 2], [1, 2]],
    fixed: [0, 1], groups: [{ kind: 'rail', members: [2], a: [250, 300], b: [250, 410] }] });
  const context = init();
  try {
    const query = (command) => ask(context, command);
    const { prepareLength, solveLengthBound } = globalThis.JiexianExact;
    const model = prepareLength(level);
    assert.equal(solveLengthBound(level, query, model, 269).status, 'unsat');
    const witness = solveLengthBound(level, query, model, 270);
    assert.equal(witness.status, 'sat');
    assert.ok(g.totalLength(level, g.positions(level, witness.state)) <= 270);
    const best = optimalLength.start(level, [level.initial]);
    assert.equal(best.status, 'length-best');
    assert.equal(best.lower, 180);
    const inconclusive = optimalLength.certify(level, best, (command) => command.startsWith('(check-sat') ? 'unknown' : '');
    assert.equal(inconclusive.status, 'length-best');
    assert.equal(inconclusive.lower, best.lower);
    const certified = optimalLength.certify(level, best, query);
    assert.equal(certified.status, 'length-proven');
    assert.ok(certified.lower <= 2 * Math.hypot(90, 100) && certified.upper - certified.lower <= .1);
  } finally {
    destroy(context);
  }
});

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
  for (const { index, value } of g.solve({ ...level, witness: result.state, preserveRepair: result.preserveRepair }, replay)) {
    replay[index] = value;
  }
  assert.equal(g.evaluate(level, g.positions(level, replay)).count, 0);
}

for (const draft of portraitDrafts()) {
  test(`the ${draft.points.length}-node portrait puzzle solves before Z3`, () => {
    const level = puzzles.authored(draft);
    const initial = g.copy(level.initial);
    assert.ok(g.evaluate(level, level.points).count > 0);
    const result = globalThis.JiexianSolverSearch.search(level, level.initial, prepareExact);
    checkSolution(level, result);
    assert.deepEqual(level.initial, initial);
    const points = g.positions(level, result.state);
    for (const i of draft.fixed) assert.deepEqual(points[i], draft.points[i]);
  });
}

test('node to edge clearance is 16 including exact tangency', () => {
  const level = (gap) => g.createLevel({ points: [[100, 200], [300, 200], [200, 200 + gap]],
    edges: [[0, 1]], controls: [] });
  const tangent = level(16), near = level(15.999);
  assert.equal(g.clearances(tangent).nodeEdge, 16);
  assert.equal(g.evaluate(tangent, tangent.points).count, 0);
  assert.equal(prepareExact(tangent).status, 'solved');
  assert.equal(g.evaluate(near, near.points).count, 1);
  assert.equal(prepareExact(near).status, 'unsat');
});

test('the screenshot with a single crossed edge pair has a fully checked solution', () => {
  const level = puzzles.authored(crossingScreenshotDraft());
  const faults = [];
  g.evaluate(level, level.points, (nodes, kind) => faults.push({ nodes, kind }));
  assert.deepEqual(faults, [{ nodes: [16, 18, 9, 13], kind: 'crossing' }]);
  const result = globalThis.JiexianSolverSearch.search(level, level.initial, prepareExact);
  checkSolution(level, result);
});

test('a crossing and a nearby node-edge conflict solve together before Z3', () => {
  const level = puzzles.authored(crossingAndClearanceScreenshotDraft());
  const faults = [];
  g.evaluate(level, level.points, (nodes, kind) => faults.push({ nodes, kind }));
  assert.deepEqual(faults, [
    { nodes: [9, 13, 16], kind: 'node-edge' },
    { nodes: [16, 18, 9, 13], kind: 'crossing' },
  ]);
  checkSolution(level, globalThis.JiexianSolverSearch.search(level, level.initial, prepareExact));
});

test('global reembedding accepts changes to the obstacle geometry and vertex order', () => {
  const draft = crossingAndClearanceScreenshotDraft();
  const n = draft.points.length;
  for (const shift of [-4, 2, 5]) {
    const level = puzzles.authored({
      points: [...draft.points].reverse(),
      edges: [...draft.edges].reverse().map(([a, b]) => [n - b - 1, n - a - 1]),
      obstacles: draft.obstacles.map(({ center: [x, y], r }) => ({ center: [x + shift, y - shift], r: r + shift / 2 })),
    });
    assert.ok(g.evaluate(level, level.points).count > 0);
    checkSolution(level, globalThis.JiexianSolverSearch.search(level, level.initial, prepareExact));
  }
});

test('blocked edges with shared endpoints on a six-circle board solve before Z3', () => {
  const draft = obstacleClusterScreenshotDraft();
  const level = puzzles.authored(draft);
  const kinds = [];
  g.evaluate(level, level.points, (_, kind) => kinds.push(kind));
  assert.equal(kinds.filter((kind) => kind === 'edge-obstacle').length, 6);
  assert.equal(kinds.filter((kind) => kind === 'node-edge').length, 2);
  for (const shift of [0, -2, 3]) {
    const changed = puzzles.authored({ ...draft, obstacles: draft.obstacles.map(({ center: [x, y], r }, i) => ({
      center: [x + (i % 2 ? shift : -shift), y - shift], r: r + shift / 2,
    })) });
    const result = globalThis.JiexianSolverSearch.search(changed, changed.initial, prepareExact);
    checkSolution(changed, result);
    const end = g.positions(changed, result.state);
    assert.deepEqual(end[6], draft.points[6]);
  }
});

test('a zero-distance obstacle on each horizontal edge admits a normal correction in separate blocks', () => {
  const level = puzzles.authored({
    points: [[120, 200], [400, 200], [500, 370], [780, 370], [50, 450]],
    edges: [[0, 1], [2, 3]], obstacles: [{ center: [260, 200], r: 60 }, { center: [640, 370], r: 60 }],
  });
  const problem = prepareExact(level);
  assert.equal(problem.status, 'ready');
  const result = globalThis.JiexianSolverRelaxation.repair(level, problem, { starts: [level.initial], reembed: false });
  checkSolution(level, result);
  assert.deepEqual(result.state[4], level.initial[4]);
});

test('both reconstructions with six maximum-radius disks solve before Z3', () => {
  const drafts = maxObstacleClusterDrafts();
  const mirrored = drafts.map((draft) => ({
    ...draft, points: draft.points.map(([x, y]) => [g.width - x, y]),
    obstacles: draft.obstacles.map(({ center: [x, y], r }) => ({ center: [g.width - x, y], r })),
  }));
  for (const draft of [...drafts, ...mirrored]) {
    const level = puzzles.authored(draft);
    assert.ok(g.evaluate(level, level.points).count >= 10);
    checkSolution(level, globalThis.JiexianSolverSearch.search(level, level.initial, prepareExact));
  }
});

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

test('one shared horizontal track packs both sides of an open exclusion without any SMT call', () => {
  const level = (end) => {
    const points = [[260, 270], [290, 270], [330, 270], [370, 270], [316, 270], [100, 435], [800, 435]];
    return g.createLevel({ points, edges: [[5, 6]], controls: points.slice(0, 4).map((_, i) =>
      i % 2 ? g.rail(i, [end, 270], [250, 270], .5) : g.rail(i, [250, 270], [end, 270], .5)) });
  };
  const puzzle = level(382);
  const proof = prepareExact(puzzle);
  checkSolution(puzzle, proof);
  assert.deepEqual(g.positions(puzzle, proof.state).slice(0, 4), [[250, 270], [283, 270], [349, 270], [382, 270]]);
  assert.equal(prepareExact(level(381.999)).status, 'unsat');
});

test('shared oblique tracks use exact squared capacity before any SMT call', () => {
  const track = (edge) => {
    const a = [100, 100], b = [100 + edge, 100 + edge];
    return g.createLevel({ points: [a, a, b], edges: [], controls: [g.rail(0, a, b, 0),
      g.rail(1, a, b, 0), g.rail(2, b, a, 0)] });
  };
  checkSolution(track(48), prepareExact(track(48)));
  assert.equal(prepareExact(track(46)).status, 'unsat');
});

function parallelTracks(counts, starts, ends, offset, radius = g.radius, diagonal = false) {
  const points = [], controls = [];
  for (let track = 0; track < counts.length; track++) {
    const line = 150 + track * offset;
    const from = [starts[track], line], to = [ends[track], line];
    if (diagonal) to[1] += ends[track] - starts[track];
    for (let i = 0; i < counts[track]; i++) {
      controls.push(track % 2 ? g.rail(points.length, to, from, .5) : g.rail(points.length, from, to, .5));
      points.push(from);
    }
  }
  return g.createLevel({ points, edges: [], obstacles: [], controls, radius });
}

test('coupled parallel tracks pack 18 sliders without nonlinear solving', () => {
  const level = parallelTracks([9, 9], [100, 100], [650, 650], 15);
  checkSolution(level, prepareExact(level));
});

test('two independently roomy tracks are jointly unsatisfiable because of forced neighboring nodes', () => {
  const level = parallelTracks([13, 4], [100, 100], [580, 580], 15);
  assert.ok(12 * 33 < 480);
  assert.ok(16 * Math.sqrt(33 ** 2 - 15 ** 2) < 480);
  assert.equal(prepareExact(level).status, 'unsat');
});

test('a constrained rail subset can disprove a larger mixed puzzle', () => {
  const rails = parallelTracks([13, 4], [100, 100], [580, 580], 15);
  const points = [...rails.points, [450, 345]];
  const controls = [...rails.controls, g.free(points.length - 1, points.at(-1))];
  const level = g.createLevel({ points, controls, edges: [[0, points.length - 1]] });
  assert.equal(prepareExact(level).status, 'unsat');
});

test('parallel oblique tracks use the same projected ordering in either endpoint direction', () => {
  const level = parallelTracks([4, 4], [100, 100], [350, 350], 20, g.radius, true);
  checkSolution(level, prepareExact(level));
});

test('integer ground truth matches scheduling for small overlapping tracks', () => {
  const radius = 10 * 14 / 33;
  for (let start = 102; start <= 109; start++) {
    for (let width = 16; width <= 25; width++) {
      const level = parallelTracks([2, 2], [100, start], [122, start + width], 6, radius);
      assert.equal(g.clearances(level).nodes, 10);
      const used = [];
      const exhaustive = (i) => {
        if (i === 4) return true;
        const [lo, hi] = i < 2 ? [100, 122] : [start, start + width];
        for (let x = lo; x <= hi; x++) {
          if (used.some((other, j) => Math.abs(x - other) < (i < 2 || j >= 2 ? 10 : 8))) continue;
          used.push(x);
          if (exhaustive(i + 1)) return true;
          used.pop();
        }
        return false;
      };
      // All branch gaps and interval endpoints are integers, so an earliest feasible schedule is integral.
      const result = prepareExact(level);
      assert.equal(result.status, exhaustive(0) ? 'solved' : 'unsat', `start=${start}, width=${width}`);
    }
  }
});

test('an irrational-width gap between the two certificates is retained for exact nonlinear solving', () => {
  const level = parallelTracks([2, 1], [100, 100], [164.031243, 164.031243], 8);
  const result = prepareExact(level);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.parts.map(({ controls }) => controls.length), [3]);
  const completed = exact(level);
  if (completed.status === 'solved') checkSolution(level, completed);
  else assert.equal(completed.status, 'precision');
});

test('off-axis obstacle roots can be enclosed without losing a possible rail solution', () => {
  const level = (start, end) => {
    const a = [start, 200], b = [end, 200];
    return g.createLevel({ points: [a, a], edges: [], obstacles: [{ center: [300, 222], r: 24 }],
      controls: [g.rail(0, a, b, 0), g.rail(1, a, b, 0)] });
  };
  const puzzle = level(260, 340);
  checkSolution(puzzle, prepareExact(puzzle));
  assert.equal(prepareExact(level(265, 335)).status, 'unsat');
});

test('a fixed anchor separates overlapping track domains before nonlinear partitioning', () => {
  const level = puzzles.authored({
    points: [[275, 200], [240, 200], [260, 200], [150, 250], [380, 250]],
    edges: [[0, 3], [1, 4]],
    fixed: [2, 3, 4],
    groups: [{ kind: 'rail', members: [0], a: [150, 200], b: [275, 200] },
      { kind: 'rail', members: [1], a: [240, 200], b: [380, 200] }],
    obstacles: [{ center: [190, 227], r: 24 }, { center: [330, 227], r: 24 }],
  });
  const problem = prepareExact(level);
  assert.equal(problem.status, 'ready');
  assert.deepEqual(problem.parts.map(({ controls }) => controls), [[0], [1]]);
  const result = exact(level);
  checkSolution(level, result);
  assert.ok(g.positions(level, result.state)[0][0] <= 227);
  assert.ok(g.positions(level, result.state)[1][0] >= 293);
});

test('a crossing inside one rigid rotor is an immediate contradiction', () => {
  const points = [[250, 150], [350, 250], [350, 150], [250, 250]];
  const level = g.createLevel({ points, edges: [[0, 1], [2, 3]], controls: [g.rotor([0, 1, 2, 3], [300, 200], 0)] });
  assert.equal(prepareExact(level).status, 'unsat');
});

test('a rigid chord is obstructed on its entire orbit just below tangency', () => {
  const blocked = rotorChord(g, 26, 1.999999);
  assert.equal(prepareExact(blocked).status, 'unsat');
  const tangent = rotorChord(g, 26, 2);
  assert.notEqual(prepareExact(tangent).status, 'unsat');
  assert.equal(g.evaluate(tangent, g.positions(tangent, [[Math.PI]])).count, 0);
  checkSolution(tangent, exact(tangent));
});

test('all rotations of a chord clear a disk tangent to its inner orbit', () => {
  const clear = rotorChord(g, 60, 32);
  assert.equal(prepareExact(clear).status, 'solved');
  assert.equal(globalThis.JiexianSolverGeometry.analyze(clear).retryParts.length, 0);
  const blockedAtStart = rotorChord(g, 60, 32.000001);
  assert.equal(g.evaluate(blockedAtStart, blockedAtStart.points).count, 1);
  const { parts, retryParts } = globalThis.JiexianSolverGeometry.analyze(blockedAtStart);
  assert.ok([...parts, ...retryParts].some(({ records }) => records.some(({ kind }) => kind === 'segment')));
  checkSolution(blockedAtStart, exact(blockedAtStart));
});

test('the Gram segment predicate handles both types of tangency and zero-length segments', () => {
  const level = g.createLevel({ points: [], edges: [], controls: [] });
  const cases = [
    [[-3, -4], [3, -4], 4, 'solved'],
    [[-3, -4], [3, -4], 4.000001, 'unsat'],
    [[-4, 0], [-6, 2], 4, 'solved'],
    [[-4, 0], [-6, 2], 4.000001, 'unsat'],
    [[4, 0], [4, 0], 4, 'solved'],
    [[4, 0], [4, 0], 4.000001, 'unsat'],
    [[1, 0], [10, 0], 3, 'unsat', [[0, 2], [1, 2]]],
  ];
  for (const [a, b, distance, expected, pairs = []] of cases) {
    const context = init();
    try {
      const records = pairs.map((vertices) => ({ kind: 'distance', vertices, distance, support: [] }));
      records.push({ kind: 'segment', vertices: [0, 1, 2], distance, support: [] });
      const part = { controls: [], records };
      const problem = { status: 'ready', coordinates: [a, b, [0, 0]],
        railBounds: [], parts: [part], retryParts: [], state: [] };
      assert.equal(solveExact(level, (command) => ask(context, command), problem).status, expected);
    } finally {
      destroy(context);
    }
  }
});

function coveredRotor(remove = -1) {
  const points = [[502, 270], [450, 370], [100, 475], [800, 475]];
  const centers = [[502, 270], [450, 322], [398, 270], [450, 218]];
  return g.createLevel({ points, edges: [[2, 3]], controls: [g.rotor([0, 1], [450, 270], 0)],
    obstacles: centers.filter((_, i) => i !== remove).map((center) => ({ center, r: 24 })) });
}

test('different obstacles can jointly cover an entire star-disk orbit', () => {
  assert.equal(prepareExact(coveredRotor()).status, 'unsat');
  for (let i = 0; i < 4; i++) {
    const open = coveredRotor(i);
    checkSolution(open, prepareExact(open));
  }
});

test('an obstacle at a mirror segment midpoint blocks the edge even though both endpoints are clear', () => {
  const points = [[330, 270], [570, 270]];
  const level = g.createLevel({ points, edges: [[0, 1]], controls: [g.mirror(0, 1, points[0])],
    obstacles: [{ center: [450, 270], r: 24 }] });
  const withoutEdge = { ...level, edges: [] };
  assert.equal(g.evaluate(withoutEdge, g.positions(withoutEdge, withoutEdge.initial)).count, 0);
  assert.equal(prepareExact(level).status, 'unsat');
});

test('all positions of an endpoint can lie in the shadow of an obstacle', () => {
  const points = [[100, 42], [815, 42], [858, 48]];
  const base = g.createLevel({ points, edges: [[0, 1]], controls: [g.mirror(1, 2, points[1])] });
  assert.equal(g.evaluate(base, g.positions(base, base.initial)).count, 0);
  const blocked = { ...base, obstacles: [{ center: [450, 48], r: 24 }] };
  assert.equal(prepareExact(blocked).status, 'unsat');
  const tangent = { ...base, obstacles: [{ center: [450, 70], r: 24 }] };
  assert.equal(g.evaluate(tangent, g.positions(tangent, tangent.initial)).count, 0);
  const result = exact(tangent);
  if (result.status === 'solved') checkSolution(tangent, result);
  else assert.equal(result.status, 'precision');
});

test('convex obstacle shadows can block a segment with two independently moving endpoints', () => {
  const points = [[98, 42], [42, 48], [798, 42], [858, 48]];
  const base = g.createLevel({ points, edges: [[0, 2]],
    controls: [g.mirror(0, 1, points[0]), g.mirror(2, 3, points[2])] });
  assert.equal(g.evaluate(base, g.positions(base, base.initial)).count, 0);
  const blocked = { ...base, obstacles: [{ center: [450, 50], r: 24 }] };
  assert.equal(prepareExact(blocked).status, 'unsat');
});

test('a circular obstacle makes two individually feasible mirror pairs incompatible', () => {
  const points = [[42, 42], [170, 42], [76, 42], [136, 42], [100, 430], [800, 430]];
  const base = g.createLevel({ points, edges: [[4, 5]],
    controls: [g.mirror(0, 1, points[0]), g.mirror(2, 3, points[2])] });
  assert.equal(g.evaluate(base, g.positions(base, base.initial)).count, 0);
  const obstacles = [{ center: [106, 42], r: 24 }];
  for (let remove = 0; remove < 2; remove++) {
    const remaining = points.filter((_, i) => i !== 2 * remove && i !== 2 * remove + 1);
    const solo = g.createLevel({ points: remaining, edges: [[2, 3]], obstacles, controls: [g.mirror(0, 1, remaining[0])] });
    checkSolution(solo, prepareExact(solo));
  }
  assert.equal(prepareExact({ ...base, obstacles }).status, 'unsat');
});

test('a contradictory pair suffices to reject a much larger obstacle component', () => {
  const points = [[42, 42], [170, 42], [76, 42], [136, 42], [100, 430], [800, 430],
    [100, 105], [220, 120], [340, 110], [500, 130], [620, 90], [760, 108], [270, 350], [650, 350]];
  const controls = [g.mirror(0, 1, points[0]), g.mirror(2, 3, points[2]),
    ...points.slice(6).map((p, i) => g.free(i + 6, p))];
  const level = g.createLevel({ points, edges: [[4, 5]], controls, obstacles: [{ center: [106, 42], r: 24 }] });
  assert.equal(prepareExact(level).status, 'unsat');
});

function diskBarrier() {
  return [[432, 95], [475, 225], [441, 357], [475, 460]].map(([x, y]) => ({
    center: [x, y], r: 72,
  }));
}

test('a meandering chain of disks separates connected rail domains', () => {
  const points = [[120, 125], [330, 275], [790, 125], [330, 390]];
  const controls = [g.rail(0, [120, 125], [240, 125], 0), g.free(1, points[1]),
    g.rail(2, [650, 125], [790, 125], 1), g.free(3, points[3])];
  const level = g.createLevel({ points, controls, obstacles: diskBarrier(), edges: [[0, 1], [1, 3], [2, 3]] });
  assert.deepEqual(prepareExact(level), { status: 'unsat', reason: 'obstacle-barrier' });
});

test('exactly tangent disks leave a legal edge through their point of contact', () => {
  const points = [[100, 176], [800, 176]];
  const obstacles = [100, 252, 404, 475].map((y) => ({ center: [450, y], r: 72 }));
  const level = g.createLevel({ points, edges: [[0, 1]], controls: [], obstacles });
  checkSolution(level, prepareExact(level));
  const overlapping = { ...level, obstacles: obstacles.map((disk) => ({ ...disk, r: disk.r + .000001 })) };
  assert.deepEqual(prepareExact(overlapping), { status: 'unsat', reason: 'obstacle-barrier' });
});

test('separated graph components can occupy opposite sides of a disk barrier', () => {
  const points = [[100, 100], [200, 280], [650, 140], [800, 300]];
  const level = g.createLevel({ points, edges: [[0, 1], [2, 3]], controls: [], obstacles: diskBarrier() });
  checkSolution(level, prepareExact(level));
});

test('remaining rotor chart boxes are passed as exact cuts to the full mixed solver', () => {
  const points = [[502, 270], [450, 370], [100, 475], [800, 475], [100, 110], [275, 115], [720, 190]];
  const controls = [g.rotor([0, 1], [450, 270], 0), ...points.slice(4).map((p, i) => g.free(i + 4, p))];
  const level = g.createLevel({ points, edges: [[2, 3]], controls, obstacles: [{ center: [502, 270], r: 24 }] });
  const problem = prepareExact(level);
  assert.equal(problem.status, 'ready');
  const cut = problem.parts[0].cuts.get(0);
  assert.ok(cut.boxes.length <= 12);
  assert.ok(cut.boxes.some((box) => box.some(([lo]) => lo < 0n)));
  checkSolution(level, exact(level));
});

function obstacleWall(columns, rows) {
  const points = [], edges = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const i = points.length;
      points.push([390 + (i % 6) * 43, 86 + Math.floor(i / 6) * 74]);
      if (x) edges.push([i - 1, i]);
      if (y) edges.push([i - columns, i]);
      if (x && y) edges.push([i - columns - 1, i]);
    }
  }
  const obstacles = [100, 214, 326, 438].map((y) => ({ center: [169 + (columns - 1) * 54, y], r: 84 }));
  return puzzles.authored({ points, edges, obstacles });
}

test('obstacle-only planar grid layouts fit on one side of a wall of disks at full game clearance', () => {
  for (const columns of [3, 5]) {
    const level = obstacleWall(columns, 4);
    assert.ok(g.evaluate(level, g.positions(level, level.initial)).count > 0);
    const state = puzzles.searchObstacles(level);
    checkSolution(level, { status: 'solved', state });
    const xs = g.positions(level, state).map(([x]) => x);
    const [wall] = level.obstacles[0].center;
    assert.ok(Math.max(...xs) < wall || Math.min(...xs) > wall);
    assert.equal(level.radius, g.radius);
  }
});

test('capsule slices translate an existing cycle without shrinking it or evicting the disk from its interior', () => {
  const points = [[158, 60], [858, 60], [858, 420], [158, 420]];
  const obstacles = [{ center: [186, 245], r: 35 }];
  const draft = { points, edges: [[0, 1], [1, 2], [2, 3], [3, 0]], obstacles };
  const level = puzzles.authored(draft);
  assert.equal(g.evaluate(level, points).count, 1);
  const state = puzzles.searchObstacles(level);
  checkSolution(level, { status: 'solved', state });
  const result = g.positions(level, state);
  const shift = result[0].map((coordinate, i) => coordinate - points[0][i]);
  assert.ok(result.every((p, i) => p.every((x, axis) => Math.abs(x - points[i][axis] - shift[axis]) < 1e-9)));
  const [x, y] = obstacles[0].center;
  assert.ok(result[0][0] < x && x < result[2][0] && result[0][1] < y && y < result[2][1]);
  assert.equal(puzzles.searchObstacles(puzzles.authored({ ...draft, fixed: [0] })), null);
});

test('translation slices preserve a singleton gap between two tangent capsule boundaries', () => {
  const points = [[320, 42], [320, 498]];
  const obstacles = [110, 280, 350, 550, 700, 790].map((x) => ({ center: [x, 270], r: 96 }));
  const level = puzzles.authored({ points, edges: [[0, 1]], obstacles });
  assert.ok(g.evaluate(level, points).count);
  const state = puzzles.searchObstacles(level);
  checkSolution(level, { status: 'solved', state });
  assert.deepEqual(g.positions(level, state), [[450, 42], [450, 498]]);
});

test('screenshot reconstruction uses two verified moves and keeps the other twelve vertices', () => {
  const level = puzzles.authored(screenshotDraft());
  const conflicts = [];
  const faults = g.evaluate(level, level.points, (nodes) => conflicts.push(nodes));
  assert.equal(faults.count, 2);
  assert.equal(conflicts.length, faults.count);
  assert.ok(conflicts.every((nodes) => nodes.includes(7)));
  const answer = repair(level, level.initial);
  assert.equal(answer?.status, 'solved');
  assert.equal(answer.preserveRepair, true);
  assert.equal(g.evaluate(level, g.positions(level, answer.state)).count, 0);
  const changed = answer.state.flatMap((value, i) => g.distance(value, level.initial[i]) ? [i + 1] : []);
  assert.deepEqual(changed, [2, 6]);
  const plan = g.solve({ ...level, witness: answer.state, preserveRepair: answer.preserveRepair }, level.initial);
  assert.deepEqual(plan.map(({ index }) => index + 1).sort((a, b) => a - b), changed);
  const replay = g.copy(level.initial);
  for (const { index, value } of plan) replay[index] = value;
  assert.equal(g.evaluate(level, g.positions(level, replay)).count, 0);
});

test('repairing the screenshot edge recruits a green vertex to clear the neighboring constraints', () => {
  const level = puzzles.authored(coupledScreenshotDraft());
  const initial = [];
  g.evaluate(level, level.points, (nodes, kind, obstacle) => initial.push([nodes, kind, obstacle]));
  assert.deepEqual(initial, [[[1, 4], 'edge-obstacle', 0]]);
  const answer = repairTogether(level, level.initial);
  checkSolution(level, answer);
  const plan = g.solve({ ...level, witness: answer.state, preserveRepair: answer.preserveRepair }, level.initial);
  assert.deepEqual(plan.map(({ index }) => index + 1).sort((a, b) => a - b), [2, 5, 14]);

  const withoutGreenMove = g.copy(answer.state);
  withoutGreenMove[13] = level.initial[13];
  assert.ok(g.evaluate(level, g.positions(level, withoutGreenMove)).count > 0);
});

test('joint obstacle repair solves 48 perturbations of the screenshot geometry', () => {
  const draft = coupledScreenshotDraft();
  for (let sample = 0; sample < 48; sample++) {
    const points = draft.points.map(([x, y], i) => [
      g.clamp(x + .64 * Math.sin(sample * 11 + i * 91), g.margin, g.width - g.margin),
      g.clamp(y + .64 * Math.cos(sample * 23 + i * 13), g.margin, g.height - g.margin),
    ]);
    const [{ center: [x, y], r }] = draft.obstacles;
    const obstacles = [{ center: [x + .65 * Math.sin(sample), y + .65 * Math.cos(sample)],
      r: r + .38 * Math.sin(sample * 31) }];
    const level = puzzles.authored({ ...draft, points, obstacles });
    const answer = repairTogether(level, level.initial);
    assert.equal(answer?.status, 'solved', `perturbation ${sample}`);
    assert.equal(g.evaluate(level, g.positions(level, answer.state)).count, 0);
  }
});

test('a mixed obstacle, crossing and node-edge conflict stays in fast joint repair', () => {
  const level = puzzles.authored(mixedScreenshotDraft());
  const kinds = [];
  g.evaluate(level, level.points, (_, kind) => kinds.push(kind));
  assert.deepEqual(kinds, ['edge-obstacle', 'node-edge', 'crossing']);
  const result = globalThis.JiexianSolverSearch.search(level, level.initial, () => assert.fail('unexpected exact phase'));
  checkSolution(level, result);
  assert.equal(result.preserveRepair, true);
});

test('the 27-node screenshot repairs six contacts at one disk before exact preprocessing', () => {
  const level = puzzles.authored(contactScreenshotDraft());
  const initial = [];
  g.evaluate(level, level.points, (nodes, kind, disk) => initial.push([kind, nodes.map((i) => i + 1), disk]));
  assert.deepEqual(initial, [
    ['node-obstacle', [18], 7], ['node-obstacle', [26], 7], ['edge-obstacle', [6, 18], 7],
    ['edge-obstacle', [6, 26], 7], ['edge-obstacle', [15, 18], 7], ['edge-obstacle', [26, 27], 7],
  ]);
  const result = globalThis.JiexianSolverSearch.search(level, level.initial, () => assert.fail('unexpected exact phase'));
  checkSolution(level, result);
  assert.equal(result.preserveRepair, true);
  assert.deepEqual(result.state[26], level.initial[26]);
});

test('contact repair solves 60 perturbed eight-disk layouts, including contacts on several disks', () => {
  let severalDisks = false;
  for (let sample = 0; sample < 60; sample++) {
    const level = puzzles.authored(perturbedContactDraft(sample, 3));
    severalDisks ||= g.evaluate(level, level.points).badObstacles.size > 1;
    const result = globalThis.JiexianContactRepair.repair(level, level.initial);
    assert.equal(result?.status, 'solved', `perturbation ${sample}`);
    assert.equal(g.evaluate(level, g.positions(level, result.state)).count, 0);
  }
  assert.ok(severalDisks);
});

test('a geometric sweep can finish the last conflict after contact repair stalls', () => {
  const level = puzzles.authored(perturbedContactDraft(2, 6));
  let unresolved = Infinity;
  const direct = globalThis.JiexianContactRepair.repair(level, level.initial, {
    offer: (_, count) => { unresolved = count; },
  });
  assert.equal(direct, null);
  assert.equal(unresolved, 1);
  checkSolution(level, globalThis.JiexianSolverSearch.search(level, level.initial, () => assert.fail('unexpected exact phase')));
});

test('two long edges blocked by separate disks are repaired with different line directions', () => {
  const level = puzzles.authored(corridorScreenshotDraft());
  const initial = [];
  g.evaluate(level, level.points, (nodes, kind, disk) => initial.push([kind, nodes.map((i) => i + 1), disk]));
  assert.deepEqual(initial, [['edge-obstacle', [3, 8], 0], ['edge-obstacle', [12, 13], 2]]);
  const result = globalThis.JiexianSolverSearch.search(level, level.initial, () => assert.fail('unexpected exact phase'));
  checkSolution(level, result);
  assert.equal(result.preserveRepair, true);
  assert.ok(result.state.every((point, i) => g.distance(point, level.initial[i]) < 100));
});

test('separate obstacle corridors survive 36 perturbations of the screenshot', () => {
  const draft = corridorScreenshotDraft();
  for (let sample = 0; sample < 36; sample++) {
    const points = draft.points.map((point, i) => point.map((value, axis) =>
      g.clamp(value + 3 * Math.sin(i * 13 + sample * 17 + axis * 7), g.margin, (axis ? g.height : g.width) - g.margin)));
    const obstacles = draft.obstacles.map(({ center, r }, i) => ({
      center: center.map((value, axis) => value + 1.8 * Math.sin(i * 37 + sample * 23 + axis * 5)),
      r: r + 1.5 * Math.cos(i * 13 + sample * 29),
    }));
    const level = puzzles.authored({ ...draft, points, obstacles });
    const result = globalThis.JiexianSolverSearch.search(level, level.initial, () => assert.fail(`exact phase for sample ${sample}`));
    assert.equal(result.status, 'solved');
    assert.equal(g.evaluate(level, g.positions(level, result.state)).count, 0);
  }
});

test('bounded exact work in one obstacle component cannot delay a contradiction in another', () => {
  const points = [[100, 100], [101, 101], [650, 130], [651, 131]];
  for (const end of [662, 699]) {
    const level = g.createLevel({
      points, edges: [], obstacles: [{ center: [450, 450], r: 24 }],
      controls: [g.rail(0, points[0], [110, 100], 0), g.rail(1, points[1], [145, 103], 0),
        g.rail(2, points[2], [663, 130], 0), g.rail(3, points[3], [end, 134], 0)],
    });
    const problem = prepareExact(level);
    assert.deepEqual(problem.parts.map(({ controls }) => controls.length), [2, 2]);
    let checks = 0, resets = 0;
    const bounded = [];
    const context = init();
    try {
      const result = solveExact(level, (command) => {
        if (command === '(set-option :rlimit 80000)') bounded.push(checks);
        if (command === '(reset)') resets++;
        if (command === '(check-sat-using qfnra-nlsat)' && checks++ === 0) return 'unknown';
        return ask(context, command);
      }, problem);
      assert.deepEqual(bounded, [0, 1]);
      if (end === 662) {
        assert.equal(result.status, 'unsat');
        assert.equal(resets, 1);
      } else {
        checkSolution(level, result);
        assert.ok(checks >= 3);
      }
    } finally {
      destroy(context);
    }
  }
});

test('contact corrections move mirror partners, rail sliders and rotor members through their controls', () => {
  const points = [[180, 190], [250, 190], [450, 190], [560, 350], [620, 305], [820, 450]];
  const center = [560, 305];
  const level = g.createLevel({
    points, edges: [],
    obstacles: [{ center: [180, 176], r: 24 }, { center: [438, 190], r: 24 }, { center: [545, 350], r: 24 }],
    controls: [g.mirror(0, 1, points[0]), g.rail(2, [330, 190], [600, 190], 120 / 270), g.rotor([3, 4], center, 0)],
  });
  assert.equal(g.evaluate(level, g.positions(level, level.initial)).count, 3);
  const result = globalThis.JiexianContactRepair.repair(level, level.initial);
  checkSolution(level, result);
  const moved = g.positions(level, result.state);
  assert.ok(result.state.every((value, i) => g.moveDistance(level.controls[i], value, level.initial[i]) > 0));
  assert.deepEqual(moved[0].map((value, i) => value + moved[1][i]), level.controls[0].sum);
  assert.equal(moved[2][1], 190);
  assert.ok(Math.abs(g.distance(moved[3], center) - g.distance(points[3], center)) < 1e-8);
  assert.ok(Math.abs(g.distance(moved[4], center) - g.distance(points[4], center)) < 1e-8);
  assert.deepEqual(moved[5], points[5]);
});

test('contracted rail bounds feed a narrow mixed puzzle back into the fast search', () => {
  const draft = railDraft(283.124, 349.126);
  draft.points.push([780, 80]);
  const level = puzzles.authored(draft);
  assert.equal(prepareExact(level).status, 'ready');
  assert.equal(puzzles.searchDraft(level), null);
  const result = globalThis.JiexianSolverSearch.search(level, level.initial, prepareExact);
  checkSolution(level, result);
  const [x] = g.positions(level, result.state)[0];
  assert.ok(x >= 316.124 && x <= 316.126);
});

test('the exact solver fixes a seeded rail conflict with the other control frozen', () => {
  const points = [[240, 270], [450, 270], [240, 270]];
  const level = g.createLevel({ points, edges: [], controls: [
    g.rail(0, [240, 270], [300, 270], 0), g.free(1, points[1]),
  ] });
  const problem = prepareExact(level);
  assert.equal(problem.status, 'ready');
  const context = init();
  const trace = [];
  try {
    const result = solveExact(level, (command) => {
      trace.push(command);
      return ask(context, command);
    }, problem, level.initial);
    checkSolution(level, result);
    assert.deepEqual(result.state[1], points[1]);
    assert.equal(result.preserveRepair, true);
    assert.equal(trace.filter((command) => command.startsWith('(set-option :rlimit 80000')).length, 1);
    assert.equal(trace.includes('(reset)'), false);
  } finally {
    destroy(context);
  }
});

test('an impossible frozen neighborhood falls through to a solution with both controls movable', () => {
  const points = [[240, 270], [300, 270], [240, 270], [700, 430], [740, 430]];
  const level = g.createLevel({ points, edges: [], obstacles: [{ center: [450, 450], r: 24 }], controls: [
    g.rail(0, [240, 270], [300, 270], 0), g.free(1, points[1]), g.free(3, points[3]), g.free(4, points[4]),
  ] });
  const problem = prepareExact(level);
  assert.equal(problem.status, 'ready');
  const context = init();
  const checks = [];
  try {
    const result = solveExact(level, (command) => {
      const response = ask(context, command);
      if (command === '(check-sat-using qfnra-nlsat)') checks.push(response.trim());
      return response;
    }, problem, level.initial);
    checkSolution(level, result);
    assert.equal(checks[0], 'unsat');
    assert.ok(checks.includes('sat'));
    assert.notDeepEqual(result.state[1], points[1]);
  } finally {
    destroy(context);
  }
});

test('one active control solves a very narrow obstacle corridor in a 26-node part', () => {
  const level = corridorLevel(g, { halfGap: .0001, shift: .45 });
  assert.equal(g.evaluate(level, level.points).count, 1);
  const problem = prepareExact(level);
  assert.equal(problem.parts[0].controls.length, 26);
  const context = init();
  let variables = 0, checks = 0;
  try {
    const result = solveExact(level, (command) => {
      variables += [...command.matchAll(/\(declare-const /g)].length;
      if (command === '(check-sat-using qfnra-nlsat)') checks++;
      return ask(context, command);
    }, problem, level.initial);
    checkSolution(level, result);
    assert.equal(variables, 2);
    assert.equal(checks, 1);
    assert.deepEqual(result.state.slice(1), level.initial.slice(1));
  } finally {
    destroy(context);
  }
});

for (const [rightShift, translation] of [[3, true], [9, false]]) {
  test(`two free endpoints ${translation ? 'translate together' : 'change the edge slope'} to fit a narrow corridor`, () => {
    const level = corridorLevel(g, { halfGap: .0001, shift: 3, rightShift });
    assert.equal(g.evaluate(level, level.points).count, 1);
    const problem = prepareExact(level);
    const context = init();
    let declarations = [];
    try {
      const result = solveExact(level, (command) => {
        if (command === '(reset)') declarations = [];
        for (const [, name] of command.matchAll(/\(declare-const (\w+) /g)) declarations.push(name);
        return ask(context, command);
      }, problem, level.initial);
      checkSolution(level, result);
      assert.deepEqual(declarations, translation ? ['shiftX', 'shiftY'] : ['y0', 'y1']);
      assert.deepEqual(result.state.slice(2), level.initial.slice(2));
      for (let i = 0; i < 2; i++) assert.ok(Math.abs(result.state[i][1] - level.initial[i][1]) > 2);
    } finally {
      destroy(context);
    }
  });
}

test('an edge through the disk center can move while a fixed point and rail stay in place', () => {
  const points = [[160, 270], [740, 270], [400, 90], [500, 90]];
  const level = g.createLevel({
    points, edges: [[0, 1], [2, 3]], obstacles: [{ center: [450, 270], r: 65 }],
    controls: [g.free(0, points[0]), g.free(1, points[1]), g.rail(2, points[2], [420, 90], .25)],
  });
  assert.equal(g.evaluate(level, g.positions(level, level.initial)).count, 1);
  const answer = repairTogether(level, level.initial);
  checkSolution(level, answer);
  assert.deepEqual(answer.state[2], level.initial[2]);
  assert.deepEqual(g.positions(level, answer.state)[3], points[3]);
  const anchored = g.createLevel({ ...level, controls: [level.controls[2]] });
  assert.equal(repairTogether(anchored, anchored.initial), null);
});

test('local repair can fix an incident obstacle conflict without moving anchors', () => {
  const level = puzzles.authored({
    points: [[100, 260], [700, 260], [730, 410]],
    fixed: [0, 2],
    edges: [[0, 1], [1, 2]],
    obstacles: [{ center: [390, 260], r: 50 }],
  });
  assert.equal(g.evaluate(level, g.positions(level, level.initial)).count, 1);
  checkSolution(level, repair(level, level.initial));
});

test('unrepaired restricted controls remain available for the complete solver', () => {
  const level = puzzles.authored({
    points: [[110, 160], [750, 400], [350, 310], [700, 310]],
    edges: [[0, 1], [2, 3]], fixed: [0, 2, 3], obstacles: [],
    groups: [{ kind: 'rail', members: [1], a: [750, 400], b: [840, 400] }],
  });
  assert.equal(repair(level, level.initial), null);
  assert.equal(exact(level).status, 'unsat');
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
