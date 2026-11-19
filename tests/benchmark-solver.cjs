const path = require('node:path');
const { readFileSync } = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const { gunzipSync } = require('node:zlib');

const repo = path.join(__dirname, '..');
for (const name of ['engine.js', 'planarity.js', 'solver-obstacles.js', 'puzzles.js', 'solver-tracks.js', 'solver-regions.js',
  'solver-geometry.js', 'exact-solver.js']) {
  require(path.join(repo, name));
}
const g = globalThis.Jiexian;
const puzzles = globalThis.JiexianPuzzles;
const current = globalThis.JiexianExact;
const sandbox = { Jiexian: g };
const parallel = process.argv.includes('--parallel');
const obstacles = process.argv.includes('--obstacles');
const obstacleOnly = process.argv.includes('--obstacle-only');
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const revision = obstacleOnly ? '2c36708' : obstacles ? '23ee6f1' : parallel ? '2c917c1' : '170852e';
const oldScript = (name) => execFileSync('git', ['show', `${revision}:${name}`], { cwd: repo, encoding: 'utf8' });
if (obstacleOnly) {
  for (const script of ['planarity.js', 'puzzles.js', 'solver-regions.js']) runInNewContext(oldScript(script), sandbox);
}
if (obstacles || obstacleOnly) runInNewContext(oldScript('solver-tracks.js'), sandbox);
if (parallel || obstacles || obstacleOnly) runInNewContext(oldScript('solver-geometry.js'), sandbox);
runInNewContext(oldScript('exact-solver.js'), sandbox);
const previous = sandbox.JiexianExact;

const z3 = require(path.join(repo, 'vendor/z3smt2w.js'))({
  wasmBinary: gunzipSync(readFileSync(path.join(repo, 'vendor/z3smt2w.wasm.gz'))), noInitialRun: true,
});
const init = z3.cwrap('smt2Init', 'number', []);
const ask = z3.cwrap('smt2Ask', 'string', ['number', 'string']);
const destroy = z3.cwrap('smt2Destroy', null, ['number']);

function run(solver, level) {
  let context, checks = 0;
  const start = performance.now();
  try {
    let problem;
    if (obstacleOnly) {
      const puzzles = solver === current ? globalThis.JiexianPuzzles : sandbox.JiexianPuzzles;
      if (puzzles.searchObstacles?.(level)) return { time: performance.now() - start, status: 'solved', checks };
      problem = solver.prepareExact(level);
      if (problem.status === 'ready' && puzzles.searchDraft(level)) {
        return { time: performance.now() - start, status: 'solved', checks };
      }
    }
    const result = solver.solveExact(level, (command) => {
      context ??= init();
      if (command === '(check-sat-using qfnra-nlsat)') checks++;
      return ask(context, command);
    }, problem);
    return { time: performance.now() - start, status: result.status, checks };
  } finally {
    if (context != null) destroy(context);
  }
}

function narrow() {
  return puzzles.authored({
    points: [[250, 270], [234, 270], [283.124, 270], [349.126, 270], [100, 435], [800, 435]],
    edges: [[4, 5]], fixed: [1, 2, 3, 4, 5], obstacles: [],
    groups: [{ kind: 'rail', members: [0], a: [250, 270], b: [350, 270] }],
  });
}

function packing(rows, perTrack) {
  const points = [], controls = [];
  for (let i = 0; i < rows; i++) {
    const x = i % 2 ? 600 : 90, y = 100 + Math.floor(i / 2) * 150;
    const a = rows === 1 ? [42, y] : [x, y];
    const b = rows === 1 ? [858, y] : [x + 180, y];
    for (let node = 0; node < perTrack; node++) {
      controls.push(g.rail(points.length, a, b, .5));
      points.push(g.interpolate(a, b, .5));
    }
    if (rows > 1) points.push([x + 90, y]);
  }
  points.push([100, 490], [800, 490]);
  return g.createLevel({ points, edges: [[points.length - 2, points.length - 1]], controls });
}

function contraction(rows, movingEdges = false) {
  const points = [], controls = [], obstacles = [], edges = [];
  for (let i = 0; i < rows; i++) {
    const y = 75 + 112 * i;
    controls.push(g.rail(points.length, [150, y], [275, y], 1),
      g.rail(points.length + 1, [240, y], [380, y], 0));
    points.push([275, y], [240, y], [260, y]);
    obstacles.push({ center: [190, y + 27], r: 24 }, { center: [330, y + 27], r: 24 });
    if (movingEdges) {
      const next = points.length;
      points.push([150, y + 50], [380, y + 50]);
      edges.push([next - 3, next], [next - 2, next + 1]);
    }
  }
  return g.createLevel({ points, edges, obstacles, controls });
}

function coupled() {
  return puzzles.authored({
    points: [[110, 160], [800, 400], [350, 310], [650, 310]],
    edges: [[0, 1], [2, 3]], fixed: [0, 2, 3],
    groups: [{ kind: 'rail', members: [1], a: [280, 400], b: [800, 400] }],
  });
}

function parallelPacking(counts, length, offset, diagonal = false) {
  const points = [], controls = [];
  counts.forEach((count, track) => {
    const a = [100, 150 + track * offset];
    const b = [100 + length, a[1] + (diagonal ? length : 0)];
    for (let i = 0; i < count; i++) {
      controls.push(g.rail(points.length, a, b, .5));
      points.push(g.interpolate(a, b, .5));
    }
  });
  points.push([100, 488], [800, 488]);
  return g.createLevel({ points, edges: [[points.length - 2, points.length - 1]], controls });
}

function starDisks(remove = -1) {
  const points = [[502, 270], [450, 370], [100, 475], [800, 475]];
  const centers = [[502, 270], [450, 322], [398, 270], [450, 218]];
  return g.createLevel({ points, edges: [[2, 3]], controls: [g.rotor([0, 1], [450, 270], 0)],
    obstacles: centers.filter((_, i) => i !== remove).map((center) => ({ center, r: 24 })) });
}

function shadow() {
  const points = [[100, 42], [815, 42], [858, 48]];
  return g.createLevel({ points, edges: [[0, 1]], controls: [g.mirror(1, 2, points[1])],
    obstacles: [{ center: [450, 48], r: 24 }] });
}

function blockedMirrors() {
  const points = [[42, 42], [170, 42], [76, 42], [136, 42], [100, 430], [800, 430],
    [100, 105], [220, 120], [340, 110], [500, 130], [620, 90], [760, 108], [270, 350], [650, 350]];
  const controls = [g.mirror(0, 1, points[0]), g.mirror(2, 3, points[2]),
    ...points.slice(6).map((p, i) => g.free(i + 6, p))];
  return g.createLevel({ points, edges: [[4, 5]], controls, obstacles: [{ center: [106, 42], r: 24 }] });
}

function obstacleWall(columns) {
  const points = [], edges = [];
  for (let y = 0; y < 4; y++) {
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

function interiorDisk() {
  return puzzles.authored({ points: [[158, 60], [858, 60], [858, 420], [158, 420]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 0]], obstacles: [{ center: [186, 245], r: 35 }] });
}

function report(level, solver, repetitions) {
  const results = Array.from({ length: repetitions }, () => run(solver, level)).sort((a, b) => a.time - b.time);
  const middle = results[Math.floor(results.length / 2)];
  return { ms: Number(middle.time.toFixed(2)), status: middle.status, checks: middle.checks };
}

const cases = obstacleOnly ? [
  ['12 free vertices and 23 edges beside four disks', obstacleWall(3), 1],
  ['20 free vertices and 43 edges beside four disks', obstacleWall(5), 1],
  ['cycle translated around an interior disk', interiorDisk(), 11],
] : obstacles ? [
  ['whole rotor orbit covered by four disks', starDisks(), 11],
  ['rotor finds remaining arc between three disks', starDisks(2), 11],
  ['mirror edge inside obstacle shadow', shadow(), 11],
  ['obstacle forces pair contradiction in a 20-variable component', blockedMirrors(), 7],
  ['one movable crossing', coupled(), 11],
] : parallel ? [
  ['18 sliders on two coupled parallel tracks', parallelPacking([9, 9], 550, 15), 1],
  ['17 sliders with too many forced same-track neighbors', parallelPacking([13, 4], 480, 15), 1],
  ['8 sliders on parallel oblique tracks', parallelPacking([4, 4], 250, 20, true), 3],
  ['one movable crossing', coupled(), 11],
] : [
  ['one 0.002-unit gap', narrow(), 11],
  ['4 pairs of contracted domains', contraction(4), 7],
  ['4 pairs with moving edges', contraction(4, true), 7],
  ['6 rails with 18 sliders', packing(6, 3), 5],
  ['32 sliders on one rail', packing(1, 32), 1],
  ['one movable crossing', coupled(), 11],
];
if (args.length >= 2) {
  const solver = args[1] === 'before' ? previous : current;
  run(solver, narrow());
  const [, level, repeats] = cases[Number(args[0])];
  console.log(JSON.stringify(report(level, solver, repeats)));
  process.exit(0);
}
for (const [index, [name, level]] of cases.entries()) {
  const problem = obstacleOnly ? null : current.prepareExact(level);
  const result = { name,
    variables: level.controls.map(({ kind }) => kind === 'rail' ? 1 : 2).reduce((a, b) => a + b, 0),
    components: problem ? problem.parts?.map(({ controls }) => controls.length) ?? [] : undefined };
  for (const tag of ['before', 'after']) {
    const suite = obstacleOnly ? ['--obstacle-only'] : obstacles ? ['--obstacles'] : parallel ? ['--parallel'] : [];
    const child = spawnSync(process.execPath, [__filename, String(index), tag, ...suite],
      { timeout: 7000, encoding: 'utf8' });
    result[tag] = child.error ? child.error.code : child.status === 0 ? JSON.parse(child.stdout) : child.stderr.trim();
  }
  console.log(JSON.stringify(result));
}
