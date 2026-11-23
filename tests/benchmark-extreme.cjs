'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { parseArgs } = require('node:util');
const { gunzipSync } = require('node:zlib');
const { extremeCases, recoveryCases, extremeDraft } = require('./extreme-fixture.cjs');

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  root: { type: 'string', default: join(__dirname, '..') },
  timeout: { type: 'string', default: '20000' },
  child: { type: 'boolean' },
} });
const root = resolve(values.root);
const timeout = Number(values.timeout);
assert.ok(Number.isSafeInteger(timeout) && timeout > 0, '--timeout must be a positive integer in milliseconds');
const selected = positionals.length ? positionals : recoveryCases;
for (const name of selected) assert.ok(extremeCases.has(name), 'Unknown benchmark case: ' + name);

if (values.child) {
  for (const module of ['engine', 'planarity', 'solver-contact-repair', 'solver-obstacle-corridors', 'solver-coupled-repair',
    'solver-repair', 'solver-obstacles', 'puzzles', 'solver-search', 'solver-relaxation', 'solver-breakout', 'solver-tracks',
    'solver-regions', 'solver-geometry', 'exact-solver']) require(join(root, module + '.js'));
  const g = globalThis.Jiexian;
  const name = selected[0], draft = extremeDraft(g, name);
  const { puzzle } = globalThis.JiexianPuzzles.solveDraft(draft);
  assert.ok(puzzle);
  assert.ok(g.evaluate(puzzle, puzzle.points).count);
  const { prepareExact, solveExact } = globalThis.JiexianExact;
  const begin = performance.now();
  let result = globalThis.JiexianSolverSearch.search(puzzle, puzzle.initial, prepareExact);
  const fast = result.status;
  console.log(`geometry ${fast} ${(performance.now() - begin).toFixed(1)} ms`);
  if (fast === 'ready') {
    const vendor = join(root, 'vendor');
    const wasmBinary = gunzipSync(readFileSync(join(vendor, 'z3smt2w.wasm.gz')));
    const z3 = require(join(vendor, 'z3smt2w.js'))({ wasmBinary, noInitialRun: true });
    const ask = z3.cwrap('smt2Ask', 'string', ['number', 'string']);
    const context = z3.cwrap('smt2Init', 'number', [])();
    try {
      result = solveExact(puzzle, (command) => ask(context, command), result.problem, result.candidate);
    } finally {
      z3.cwrap('smt2Destroy', null, ['number'])(context);
    }
  }
  const elapsed = performance.now() - begin;
  if (result.status === 'solved') {
    const points = g.positions(puzzle, result.state);
    assert.ok(points.every(([x, y]) => x >= g.margin && x <= g.width - g.margin && y >= g.margin && y <= g.height - g.margin));
    assert.equal(g.evaluate(puzzle, points).count, 0);
    const replay = g.copy(puzzle.initial);
    for (const { index, value } of g.planTo(puzzle, puzzle.initial, result.state)) replay[index] = value;
    assert.deepEqual(replay, result.state);
    console.log(`solved ${elapsed.toFixed(1)} ms, length ${g.totalLength(puzzle, points).toFixed(2)}`);
  } else {
    console.log(`${result.status} ${elapsed.toFixed(1)} ms`);
    process.exitCode = 1;
  }
} else {
  let solved = 0;
  console.log(`Node ${process.version}, ${process.platform}/${process.arch}, ${timeout} ms per process`);
  for (const name of selected) {
    const run = spawnSync(process.execPath, [__filename, '--root', root, '--child', name], { encoding: 'utf8', timeout });
    if (run.error && run.error.code !== 'ETIMEDOUT') throw run.error;
    const stage = run.stdout.trim().replace(/\r?\n/g, ' | ');
    if (run.error) console.log(`${name}: timed out | ${stage}`);
    else {
      if (run.stderr) process.stderr.write(run.stderr);
      console.log(`${name}: ${stage}`);
      if (run.status === 0) solved++;
    }
  }
  console.log(`${solved}/${selected.length} solved`);
  if (solved !== selected.length) process.exitCode = 1;
}
