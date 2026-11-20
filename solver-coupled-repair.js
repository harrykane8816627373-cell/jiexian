(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const slack = .1;
  const axes = [[1, 0], [0, 1]];
  const turns = [0, 1, -1, 4, -4, 12, -12, 36, -36, 90, -90, 180].map((angle) => angle * Math.PI / 180);
  const mixedTurns = [0, 1, -1, 4, -4, 12, -12, 36, -36, 180].map((angle) => angle * Math.PI / 180);
  const dot = ([x, y], [a, b]) => x * a + y * b;
  const subtract = ([x, y], [a, b]) => [x - a, y - b];
  const negate = ([x, y]) => [-x, -y];

  function closest(p, a, b) {
    const ab = subtract(b, a);
    const length = dot(ab, ab);
    return length ? g.interpolate(a, b, g.clamp(dot(subtract(p, a), ab) / length, 0, 1)) : a;
  }

  function direction(a, b, fallback = axes[0]) {
    const [x, y] = subtract(a, b);
    const length = Math.hypot(x, y);
    return length > 1e-8 ? [x / length, y / length] : fallback;
  }

  function rotate([x, y], theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return [c * x - s * y, s * x + c * y];
  }
  const perpendicular = (a, b) => {
    const [x, y] = direction(b, a);
    return [-y, x];
  };

  function conflicts(level, points) {
    const found = [];
    g.evaluate(level, points, (nodes, kind, obstacle) => found.push({ nodes, kind, obstacle }));
    return found;
  }

  function separatingNormal(a, b, c, d) {
    const pairs = [[a, closest(a, c, d)], [b, closest(b, c, d)], [closest(c, a, b), c], [closest(d, a, b), d]];
    const [left, right] = pairs.reduce((best, pair) => g.distance(...pair) < g.distance(...best) ? pair : best);
    return direction(left, right, perpendicular(c, d));
  }

  function crossingNormal(points, [i, j, k, l]) {
    const [a, b, c, d] = [i, j, k, l].map((node) => points[node]);
    const normals = [separatingNormal(a, b, c, d), perpendicular(a, b), perpendicular(c, d)];
    const gap = (normal) => Math.min(dot(a, normal), dot(b, normal)) - Math.max(dot(c, normal), dot(d, normal));
    return [...normals, ...normals.map(negate)].sort((a, b) => gap(b) - gap(a))[0];
  }

  function initialNormals(points, initial) {
    const crossings = initial.filter(({ kind }) => kind === 'crossing');
    const byConflict = new Map(crossings.map((entry) => [entry, crossingNormal(points, entry.nodes)]));
    const sameEdge = (a, b, c, d) => a === c && b === d || a === d && b === c;
    for (const entry of initial) {
      if (entry.kind !== 'node-edge') continue;
      const [i, j, node] = entry.nodes;
      // A node close to a crossing should clear its edge on the same side as its incident segment.
      for (const cross of crossings) {
        const [a, b, c, d] = cross.nodes;
        if (sameEdge(i, j, a, b) && (node === c || node === d)) byConflict.set(entry, negate(byConflict.get(cross)));
        if (sameEdge(i, j, c, d) && (node === a || node === b)) byConflict.set(entry, byConflict.get(cross));
        if (byConflict.has(entry)) break;
      }
    }
    return byConflict;
  }

  function inequalities(level, base, weights, clearance) {
    const rows = [];
    let possible = true;
    function add(terms, minimum) {
      const active = [];
      let length = 0;
      for (const [index, axis] of terms) {
        const weight = weights[index];
        if (!weight) minimum -= dot(base[index], axis);
        else {
          length += weight * dot(axis, axis);
          active.push({ index, axis, weighted: axis.map((a) => weight * a) });
        }
      }
      if (length) rows.push({ active, minimum, length, correction: 0 });
      else if (minimum > 0) possible = false;
    }

    for (const [index, weight] of weights.entries()) {
      if (!weight) continue;
      for (const [axis, upper] of [g.width - g.margin, g.height - g.margin].entries()) {
        add([[index, axes[axis]]], g.margin);
        add([[index, negate(axes[axis])]], -upper);
      }
    }
    const apart = (a, b, normal, gap) => add([[a, normal], [b, negate(normal)]], gap);
    function separate({ nodes: [i, j, k, l], kind, obstacle }, theta, preferred, reverse) {
      const orient = (normal) => reverse ? negate(preferred ?? normal) : preferred ?? normal;
      if (kind === 'nodes') {
        apart(i, j, orient(direction(base[i], base[j])), clearance.nodes + slack);
      } else if (kind === 'node-edge') {
        const normal = orient(direction(base[k], closest(base[k], base[i], base[j]), perpendicular(base[i], base[j])));
        apart(k, i, normal, clearance.nodeEdge + slack);
        apart(k, j, normal, clearance.nodeEdge + slack);
      } else if (kind === 'crossing') {
        const normal = orient(separatingNormal(base[i], base[j], base[k], base[l]));
        for (const a of [i, j]) for (const b of [k, l]) apart(a, b, normal, slack);
      } else {
        const { center, r } = level.obstacles[obstacle];
        const edge = kind === 'edge-obstacle';
        const point = edge ? closest(center, base[i], base[j]) : base[i];
        // If the center is on the edge, its perpendicular still gives a side to try.
        const fallback = edge ? perpendicular(base[i], base[j]) : axes[0];
        const normal = rotate(direction(point, center, fallback), theta);
        const gap = r + clearance.obstacleGap + (edge ? 0 : clearance.spacing);
        const threshold = dot(center, normal) + gap + slack;
        add([[i, normal]], threshold);
        if (edge) add([[j, normal]], threshold);
      }
    }
    return { rows, separate, possible: () => possible };
  }

  function project(points, rows) {
    // Dual coordinate updates project the original drawing towards the intersection of the half-planes.
    for (let pass = 0; pass < 96; pass++) {
      let largest = 0;
      for (const row of rows) {
        const { active, minimum, length, correction } = row;
        const actual = active.reduce((sum, { index, axis }) => sum + dot(points[index], axis), 0);
        row.correction = Math.max(0, correction + (minimum - actual) / length);
        const step = row.correction - correction;
        largest = Math.max(largest, Math.abs(step));
        if (!step) continue;
        for (const { index, weighted } of active) {
          points[index][0] += step * weighted[0];
          points[index][1] += step * weighted[1];
        }
      }
      if (largest < 1e-5) break;
    }
  }

  function attempt(level, current, original, initial, weights, clearance, theta, normals, reverse, offer) {
    const model = inequalities(level, original, weights, clearance);
    const seen = new Set();
    const points = g.copy(original);
    let pending = initial;
    for (let round = 0; round < 12; round++) {
      let added = false;
      for (const conflict of pending) {
        const { kind, nodes, obstacle } = conflict;
        const key = `${kind}:${nodes.join(',')}:${obstacle ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        model.separate(conflict, round ? 0 : theta, normals?.get(conflict), !round && reverse);
        added = true;
      }
      if (!added || !model.possible() || model.rows.length > 360) return null;
      project(points, model.rows);
      if (points.some((point) => point.some((value) => !Number.isFinite(value)))) return null;
      const state = level.controls.map((control, i) => control.kind === 'free' ?
        g.normalize(control, points[control.members[0]]) : current[i]);
      pending = conflicts(level, g.positions(level, state));
      if (!pending.length) return { status: 'solved', state, preserveRepair: true };
      offer?.(state, pending.length);
    }
    return null;
  }

  function repair(level, current, { mixed = false, offer } = {}) {
    if (!level.obstacles.length && !mixed) return null;
    const original = g.positions(level, current);
    const initial = conflicts(level, original);
    const onlyDisks = initial.every(({ kind }) => kind.endsWith('-obstacle'));
    if (!initial.length || (mixed ? onlyDisks || initial.length > 12 : !onlyDisks || initial.length > 6)) return null;
    const affected = new Set(initial.flatMap(({ nodes }) => nodes));
    const weights = original.map((_, i) => {
      if (level.controls[level.ownership[i]]?.kind !== 'free') return 0;
      return affected.has(i) ? 1 : .25;
    });
    if (initial.some(({ nodes }) => nodes.every((i) => !weights[i]))) return null;
    const clearance = g.clearances(level);
    const normals = mixed ? initialNormals(original, initial) : null;
    const angles = !mixed ? turns : initial.some(({ kind }) => kind.endsWith('-obstacle')) ? mixedTurns : [0];
    for (const theta of angles) {
      for (const reverse of mixed ? [false, true] : [false]) {
        const result = attempt(level, current, original, initial, weights, clearance, theta, normals, reverse, offer);
        if (result) return result;
      }
    }
    return null;
  }

  globalThis.JiexianCoupledRepair = { repair };
})();
