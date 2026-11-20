(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const subtract = ([x, y], [a, b]) => [x - a, y - b];
  const dot = ([x, y], [a, b]) => x * a + y * b;
  const perpendicular = ([x, y]) => [-y, x];
  const unit = ([x, y]) => {
    const length = Math.hypot(x, y);
    return length > 1e-8 ? [x / length, y / length] : [1, 0];
  };

  function parameter(point, a, b) {
    const edge = subtract(b, a);
    const squared = dot(edge, edge);
    return squared ? g.clamp(dot(subtract(point, a), edge) / squared, 0, 1) : .5;
  }

  function contacts(level, points) {
    const found = [];
    g.evaluate(level, points, (nodes, kind, obstacle) => found.push({ nodes, kind, obstacle }));
    return found;
  }

  function controlMetrics(level, affected, neighboringWeight) {
    return level.controls.map((control, i) => {
      let scale = 1, railDirection;
      if (control.kind === 'rotor') {
        scale = Math.max(1, ...control.members.map((node) => g.distance(level.points[node], control.center)));
      } else if (control.kind === 'rail') {
        scale = Math.max(1, g.distance(control.a, control.b));
        railDirection = subtract(control.b, control.a).map((value) => value / scale);
      }
      const bound = (value) => g.normalize(control, (control.kind === 'rail' ? [value] : [value, value]));
      return { control, scale, railDirection, weight: affected.has(i) ? 1 : neighboringWeight,
        lower: control.kind === 'rotor' ? null : bound(-Infinity),
        upper: control.kind === 'rotor' ? null : bound(Infinity) };
    });
  }

  function adjust(level, state, points, metrics, terms, normal, deficit) {
    const gradients = new Map();
    for (const [node, coefficient] of terms) {
      const index = level.ownership[node];
      if (index < 0 || !coefficient) continue;
      const { control, scale, railDirection } = metrics[index];
      let term;
      if (control.kind === 'rail') {
        term = [coefficient * dot(normal, railDirection)];
      } else if (control.kind === 'rotor') {
        term = [coefficient * dot(normal, perpendicular(subtract(points[node], control.center))) / scale];
      } else {
        const sign = control.members[0] === node ? 1 : -1;
        term = normal.map((value) => coefficient * sign * value);
      }
      const existing = gradients.get(index);
      gradients.set(index, existing ? existing.map((value, axis) => value + term[axis]) : term);
    }
    let norm = 0, largest = 0;
    for (const [i, gradient] of gradients) {
      const { lower, upper, weight } = metrics[i];
      for (const [axis, value] of gradient.entries()) {
        if (lower && (value < 0 && state[i][axis] <= lower[axis] || value > 0 && state[i][axis] >= upper[axis])) {
          gradient[axis] = 0;
        }
      }
      const length = Math.hypot(...gradient);
      norm += weight * length * length;
      largest = Math.max(largest, weight * length);
    }
    if (norm < 1e-10) return false;
    // A trust region bounds a step when a rail or rotor is almost tangent to the correction.
    const step = Math.min(1.03 * (deficit + .25) / norm, 38 / largest);
    for (const [i, gradient] of gradients) {
      const { control, weight, scale } = metrics[i];
      state[i] = g.normalize(control, state[i].map((value, axis) => value + step * weight * gradient[axis] / scale));
      g.placeControl(level, control, state[i], points);
    }
    return true;
  }

  function separateCrossing(points, [i, j, k, l], move) {
    if (!g.segmentsCross(points[i], points[j], points[k], points[l])) return;
    const choices = [];
    for (const [a, b, c, d] of [[i, j, k, l], [k, l, i, j]]) {
      const normal = perpendicular(unit(subtract(points[b], points[a])));
      for (const sign of [1, -1]) {
        const direction = normal.map((value) => sign * value);
        const left = dot(subtract(points[c], points[a]), direction);
        const right = dot(subtract(points[d], points[a]), direction);
        const node = left < right ? c : d;
        const t = parameter(points[node], points[a], points[b]);
        choices.push({ terms: [[node, 1], [a, t - 1], [b, -t]], direction, deficit: -Math.min(left, right) });
      }
    }
    for (const { terms, direction, deficit } of choices.sort((a, b) => a.deficit - b.deficit)) {
      if (move(terms, direction, deficit + 2)) return;
    }
  }

  function resolve(level, points, clearance, { nodes: [i, j, k, l], kind, obstacle }, turn, move) {
    if (kind === 'crossing') {
      separateCrossing(points, [i, j, k, l], move);
      return;
    }
    const disk = level.obstacles[obstacle];
    const edge = kind === 'edge-obstacle' || kind === 'node-edge';
    const other = disk?.center ?? points[edge ? k : j];
    const t = edge ? parameter(other, points[i], points[j]) : 0;
    const from = edge ? g.interpolate(points[i], points[j], t) : points[i];
    const delta = subtract(from, other);
    const distance = Math.hypot(...delta);
    const required = disk ? disk.r + clearance.obstacleGap + (edge ? 0 : clearance.spacing) :
      edge ? clearance.nodeEdge : clearance.nodes;
    if (distance >= required) return;
    let normal = distance > 1e-8 ? unit(delta) : edge ? perpendicular(unit(subtract(points[j], points[i]))) : [1, 0];
    if (disk && turn) {
      const [x, y] = normal, c = Math.cos(turn), s = Math.sin(turn);
      normal = [c * x - s * y, s * x + c * y];
    }
    const terms = [[i, 1 - t]];
    if (edge) terms.push([j, t]);
    if (!disk) terms.push([edge ? k : j, -1]);
    move(terms, normal, required - distance);
  }

  function restoreUnneeded(level, current, state) {
    const moved = level.controls.map((control, i) => ({ i, distance: g.moveDistance(control, current[i], state[i]) }))
      .filter(({ distance }) => distance > 0).sort((a, b) => a.distance - b.distance);
    for (const { i } of moved) {
      const value = state[i];
      state[i] = current[i];
      if (g.evaluate(level, g.positions(level, state)).count) state[i] = value;
    }
  }

  function repair(level, current, { offer, initial } = {}) {
    if (!level.obstacles.length || !level.controls.length) return null;
    const original = g.positions(level, current);
    initial ??= contacts(level, original);
    if (initial.length > 24 || initial.filter(({ obstacle }) => obstacle !== undefined).length < 3 ||
        initial.some(({ nodes }) => nodes.every((node) => level.ownership[node] < 0))) return null;
    const affected = new Set(initial.flatMap(({ nodes }) => nodes.map((node) => level.ownership[node])));
    const clearance = g.clearances(level);
    const n = original.length, m = level.edges.length;
    const work = n * n + m * (n + m) + (n + m) * level.obstacles.length;
    const limit = g.clamp(Math.floor(270_000 / work), 28, 105);
    let fewest = initial.length;
    for (const [turn, neighboringWeight] of [[0, .15], [-.24, .4], [.24, .4], [-.62, .8], [.62, .8]]) {
      const metrics = controlMetrics(level, affected, neighboringWeight);
      const state = [...current];
      const points = [...original];
      const move = (terms, normal, deficit) => adjust(level, state, points, metrics, terms, normal, deficit);
      let pending = [...initial];
      for (let sweep = 0; sweep < limit && pending.length <= 48; sweep++) {
        if (sweep % 2) pending.reverse();
        for (const contact of pending) resolve(level, points, clearance, contact, turn * (1 - sweep / limit), move);
        pending = contacts(level, points);
        if (!pending.length) {
          restoreUnneeded(level, current, state);
          return { status: 'solved', state, preserveRepair: true };
        }
        if (pending.length < fewest) {
          fewest = pending.length;
          offer?.([...state], fewest);
        }
      }
    }
    return null;
  }

  globalThis.JiexianContactRepair = { repair };
})();
