(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const board = [[g.margin, g.width - g.margin], [g.margin, g.height - g.margin]];
  const dot = ([x, y], [a, b]) => x * a + y * b;
  const subtract = ([x, y], [a, b]) => [x - a, y - b];
  const compare = (a, b) => a.count - b.count || a.motion - b.motion;

  function directions(a, b, disks, blockedBy) {
    const [x, y] = subtract(b, a);
    const angles = [Math.atan2(x, -y), ...Array.from({ length: 24 }, (_, i) => i * Math.PI / 24)];
    for (const [i, disk] of disks.entries()) {
      for (let j = 0; j < i; j++) {
        if (!blockedBy.has(i) && !blockedBy.has(j)) continue;
        const other = disks[j];
        const [dx, dy] = subtract(disk.center, other.center);
        const theta = Math.atan2(dy, dx);
        const reach = disk.reach + other.reach;
        const distance = Math.hypot(dx, dy);
        angles.push(theta, theta - .02, theta + .02);
        if (distance <= reach) continue;
        const spread = Math.acos(reach / distance);
        angles.push(theta - spread / 2, theta + spread / 2,
          theta - spread + Math.min(.004, spread / 2), theta + spread - Math.min(.004, spread / 2));
      }
    }
    return [...new Set(angles.map((angle) => ((angle % Math.PI) + Math.PI) % Math.PI))];
  }

  function onBoard(a, b, normal, h, minGap) {
    const along = [-normal[1], normal[0]];
    const origin = normal.map((value) => value * h);
    let lo = -Infinity, hi = Infinity;
    for (const [axis, [lower, upper]] of board.entries()) {
      const v = along[axis];
      if (Math.abs(v) < 1e-10) {
        if (origin[axis] < lower || origin[axis] > upper) return null;
        continue;
      }
      const u = (lower - origin[axis]) / v, w = (upper - origin[axis]) / v;
      lo = Math.max(lo, Math.min(u, w));
      hi = Math.min(hi, Math.max(u, w));
    }
    if (hi - lo < minGap) return null;
    const parameters = [a, b].map((point) => g.clamp(dot(point, along), lo, hi));
    if (Math.abs(parameters[0] - parameters[1]) < minGap) return null;
    return parameters.map((t) => origin.map((value, axis) => g.clamp(value + along[axis] * t, ...board[axis])));
  }

  function placements(level, current, base, [a, b], blockedBy, clearance, disks) {
    const candidates = [];
    const seen = new Set();
    for (const angle of directions(base[a], base[b], disks, blockedBy)) {
      const normal = [Math.cos(angle), Math.sin(angle)];
      const offsets = disks.flatMap(({ center, reach }) => {
        const h = dot(center, normal);
        return [h - reach, h + reach];
      }).sort((a, b) => a - b);
      const middles = offsets.slice(1).map((h, i) => (offsets[i] + h) / 2);
      for (const h of [...offsets, ...middles]) {
        const ends = onBoard(base[a], base[b], normal, h, clearance.nodes);
        if (!ends || disks.some(({ center, r }) => g.distanceToSegment(center, ...ends) < r + clearance.obstacleGap ||
            ends.some((point) => g.distance(center, point) < r + clearance.obstacleGap + clearance.spacing))) continue;
        const key = ends.flat().map((x) => Math.round(x / 2)).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const motion = g.distance(base[a], ends[0]) + g.distance(base[b], ends[1]);
        candidates.push({ ends, motion });
      }
    }
    const owners = [level.ownership[a], level.ownership[b]];
    // Test diverse nearby lines first. The full check covers all surrounding edges and mechanisms.
    return candidates.sort((a, b) => a.motion - b.motion).slice(0, 260).map(({ ends, motion }) => {
      const state = [...current];
      owners.forEach((i, end) => { state[i] = ends[end]; });
      return { state, owners, ends, motion, count: g.evaluate(level, g.positions(level, state)).count };
    }).sort(compare).slice(0, 9);
  }

  function repair(level, current, initial, offer) {
    if (level.obstacles.length < 2 || initial.length > 8 || initial.some(({ obstacle }) => obstacle === undefined)) return null;
    const blocked = new Map();
    for (const { kind, nodes, obstacle } of initial) {
      if (kind !== 'edge-obstacle' || nodes.some((node) => level.controls[level.ownership[node]]?.kind !== 'free')) continue;
      const key = nodes.join(',');
      if (!blocked.has(key)) blocked.set(key, { nodes, disks: new Set() });
      blocked.get(key).disks.add(obstacle);
    }
    if (!blocked.size || blocked.size > 3) return null;
    const clearance = g.clearances(level);
    const disks = level.obstacles.map((disk) => ({ ...disk, reach: disk.r + clearance.obstacleGap + .25 }));
    const base = g.positions(level, current);
    let beam = [{ state: current, motion: 0 }];
    const ready = [];
    for (const { nodes, disks: blockedBy } of blocked.values()) {
      const next = placements(level, current, base, nodes, blockedBy, clearance, disks);
      if (!next.length) continue;
      ready.push(...next);
      beam = beam.flatMap(({ state, motion }) => next.map((placement) => {
        const combined = [...state];
        placement.owners.forEach((i, end) => { combined[i] = placement.ends[end]; });
        const count = g.evaluate(level, g.positions(level, combined)).count;
        return { state: combined, count, motion: motion + placement.motion };
      })).sort(compare).slice(0, 9);
    }
    if (!ready.length) return null;
    const solved = beam.find(({ count }) => !count) ?? ready.find(({ count }) => !count);
    if (solved) return { status: 'solved', state: solved.state, preserveRepair: true };
    const seen = new Set();
    for (const { state, count } of [...beam, ...ready.sort(compare)]) {
      const key = state.flat().map((x) => Math.round(x / 2)).join(',');
      if (seen.has(key)) continue;
      if (seen.size >= 5) break;
      seen.add(key);
      offer?.(state, count);
      const result = globalThis.JiexianContactRepair.repair(level, state, { seeded: true, offer });
      if (result) return result;
    }
    return null;
  }

  globalThis.JiexianObstacleCorridors = { repair };
})();
