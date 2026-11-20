(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const directions = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
  const signs = [[-1], [1]];
  const strides = [.3, 1.8, 6, 20, 54, 126];
  const restartBudget = 3_000_000;
  const restarts = 8;
  const square = (x) => x * x;
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const opposite = (a, b) => a > 0 && b < 0 || a < 0 && b > 0;
  // This floating-point score guides search. The game engine verifies the resulting layout.
  const separation = (squared, limit) => squared < limit * limit ? Math.max(0, limit - Math.sqrt(squared)) : 0;
  const cost = (depth) => depth * (depth + 2);

  function depth({ kind, vertices: [i, j, k, l], distance }, points) {
    const a = points[i], b = points[j];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const edgeLength = dx * dx + dy * dy;
    if (kind === 'distance') return separation(edgeLength, distance);
    const c = points[k];
    if (kind === 'segment') {
      const x = c[0] - a[0], y = c[1] - a[1];
      const t = edgeLength ? g.clamp((x * dx + y * dy) / edgeLength, 0, 1) : 0;
      return separation(square(x - dx * t) + square(y - dy * t), distance);
    }
    const d = points[l];
    const p = side(a, b, c), q = side(a, b, d);
    if (!opposite(p, q)) return 0;
    const r = side(c, d, a), s = side(c, d, b);
    if (!opposite(r, s)) return 0;
    return 2 + Math.min(Math.min(Math.abs(p), Math.abs(q)) / Math.sqrt(edgeLength),
      Math.min(Math.abs(r), Math.abs(s)) / g.distance(c, d));
  }

  function move(level, index, pose, scale, search) {
    const { state, points, violations, depths, weights } = pose;
    const { records, incident, unit, random, budget, normalize } = search;
    const control = level.controls[index];
    const value = state[index], affected = incident[index];
    const options = value.length === 1 ? signs : directions;
    let bestCost = affected.reduce((sum, i) => sum + weights[i] * cost(depths[i]), 0);
    let best, update;
    const values = new Float64Array(affected.length);
    for (const size of strides) {
      const stride = size * scale * unit[index] * (.65 + random() * .7);
      for (const direction of options) {
        const trial = normalize(index, value.map((x, axis) => x + stride * direction[axis]));
        if (trial.every((x, axis) => x === value[axis])) continue;
        g.placeControl(level, control, trial, points);
        let score = 0;
        for (let j = 0; j < affected.length; j++) {
          const i = affected[j];
          values[j] = depth(records[i], points);
          score += weights[i] * cost(values[j]);
        }
        budget.remaining -= affected.length;
        if (score >= bestCost - 1e-7) continue;
        bestCost = score;
        best = trial;
        update = values.slice();
      }
    }
    if (best) {
      state[index] = best;
      for (const [j, i] of affected.entries()) {
        depths[i] = update[j];
        if (update[j]) violations.add(i);
        else violations.delete(i);
      }
    }
    g.placeControl(level, control, state[index], points);
    return best !== undefined;
  }

  function repair(level, problem, current, candidate, fewest, offer) {
    if (fewest > 8) return null;
    const records = [...problem.parts, ...problem.retryParts].flatMap(({ records }) => records);
    if (!records.length) return null;
    const incident = level.controls.map(() => []);
    for (const [i, { support }] of records.entries()) for (const index of support) incident[index].push(i);
    const unit = level.controls.map((control) => control.kind === 'rail' ? 1 / g.distance(control.a, control.b) :
      control.kind === 'rotor' ? 1 / Math.max(1, ...control.members.map((i) => g.distance(level.points[i], control.center))) : 1);
    const usable = level.controls.map((_, i) => i).filter((i) => incident[i].length);
    const bounds = problem.railBounds.map((range) => {
      const pair = range?.map(([n, d]) => Number(n) / Number(d));
      return pair?.every(Number.isFinite) ? pair : null;
    });
    const normalize = (i, value) => bounds[i] ? [g.clamp(value[0], ...bounds[i])] : g.normalize(level.controls[i], value);
    let seed = level.points.length + 0x2e4b9d35;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = (values) => values[Math.floor(random() * values.length)];
    const budget = { remaining: restartBudget * restarts };
    // Alternate the node-to-edge clearance used for scoring to explore a
    // different neighborhood. Witnesses always use the engine clearance.
    const guidanceClearance = (level.radius ?? g.radius) * (19 / 14);
    const wider = records.map((record) => record.kind === 'segment' && record.vertices[2] < level.points.length ?
      { ...record, distance: guidanceClearance } : record);
    let bestEstimate = fewest;
    for (let restart = 0; restart < restarts && budget.remaining > 0; restart++) {
      const activeRecords = restart % 4 >= 2 ? wider : records;
      const search = { records: activeRecords, incident, unit, random, budget, normalize };
      const start = restart % 2 ? current : candidate;
      const state = start.map((value, i) => normalize(i, restart < 4 ? value :
        value.map((x) => x + (random() - .5) * 12 * unit[i])));
      const points = [...g.positions(level, state), ...problem.coordinates.slice(level.points.length)];
      const weights = records.map(() => 1);
      const depths = activeRecords.map((record) => depth(record, points));
      const violations = new Set(depths.flatMap((value, i) => value ? [i] : []));
      const pose = { state, points, depths, weights, violations };
      const stop = Math.max(0, budget.remaining - restartBudget);
      for (let step = 0; step < 2000 && budget.remaining > stop && violations.size; step++) {
        const index = random() < .12 ? pick(usable) : pick(records[pick([...violations])].support);
        const scale = 1 + Math.min(4, Math.sqrt(violations.size));
        if (!move(level, index, pose, scale, search) && step % 4 === 0) {
          // Increase the cost of conflicts that survive a local minimum.
          for (const i of violations) weights[i]++;
        }
        if (violations.size && violations.size < bestEstimate) {
          bestEstimate = violations.size;
          offer([...state], g.evaluate(level, points.slice(0, level.points.length)).count);
        }
      }
      if (!violations.size && !g.evaluate(level, points.slice(0, level.points.length)).count) {
        return { status: 'solved', state, preserveRepair: true };
      }
    }
    return null;
  }

  globalThis.JiexianSolverBreakout = { repair };
})();
