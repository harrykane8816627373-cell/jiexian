(function () {
  'use strict';

  const width = 900;
  const height = 540;
  const margin = 42;
  const radius = 14;
  const tau = Math.PI * 2;
  const eps = 1e-7;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const interpolate = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
  const turnDifference = (a, b) => ((b - a + Math.PI) % tau + tau) % tau - Math.PI;
  const polar = (center, r, angle) => [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
  const copy = (state) => state.map((value) => [...value]);
  const cycle = (n) => Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
  const free = (node, start) => ({ kind: 'free', members: [node], start });
  const mirror = (a, b, start) => ({ kind: 'mirror', members: [a, b], start });
  const rotor = (members, center, angle) => ({ kind: 'rotor', members, center, start: [angle] });
  const rail = (node, a, b, start) => ({ kind: 'rail', members: [node], a, b, start: [start] });
  const distanceToSegment = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared, 0, 1) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };

  function createLevel(data) {
    const ownership = data.points.map(() => -1);
    const controls = data.controls.map((control, i) => {
      control.members.forEach((node) => { ownership[node] = i; });
      const target = data.points[control.members[0]];
      if (control.kind === 'rotor') return { ...control, target: [0] };
      if (control.kind === 'rail') return { ...control, target: [distance(control.a, target) / distance(control.a, control.b)] };
      if (control.kind === 'mirror') {
        const other = data.points[control.members[1]];
        return { ...control, sum: target.map((value, axis) => value + other[axis]), target };
      }
      return { ...control, target };
    });
    return { obstacles: [], ...data, controls, ownership, initial: controls.map(({ start }) => start), witness: controls.map(({ target }) => target) };
  }

  function normalize(control, value) {
    if (control.kind === 'rotor') return [((value[0] % tau) + tau) % tau];
    if (control.kind === 'rail') return [clamp(value[0], 0, 1)];
    return value.map((coordinate, axis) => {
      const limit = axis === 0 ? width : height;
      const partner = control.sum?.[axis];
      if (partner === undefined) return clamp(coordinate, margin, limit - margin);
      return clamp(coordinate, Math.max(margin, partner - limit + margin), Math.min(limit - margin, partner - margin));
    });
  }

  function positions(level, state) {
    const result = [...level.points];
    level.controls.forEach((control, i) => {
      const [node, partner] = control.members;
      const value = state[i];
      switch (control.kind) {
        case 'rotor': {
          const [cx, cy] = control.center;
          const cos = Math.cos(value[0]);
          const sin = Math.sin(value[0]);
          for (const member of control.members) {
            const x = level.points[member][0] - cx;
            const y = level.points[member][1] - cy;
            result[member] = [cx + x * cos - y * sin, cy + x * sin + y * cos];
          }
          break;
        }
        case 'mirror':
          result[partner] = control.sum.map((sum, axis) => sum - value[axis]);
          result[node] = value;
          break;
        case 'rail':
          result[node] = interpolate(control.a, control.b, value[0]);
          break;
        default:
          result[node] = value;
      }
    });
    return result;
  }

  function dragValue(level, node, point, base, start) {
    const index = level.ownership[node];
    const control = level.controls[index];
    if (control.kind === 'rotor') {
      const [x, y] = control.center;
      return normalize(control, [base[0] + Math.atan2(point[1] - y, point[0] - x) - Math.atan2(start[1] - y, start[0] - x)]);
    }
    if (control.kind === 'rail') {
      const dx = control.b[0] - control.a[0];
      const dy = control.b[1] - control.a[1];
      return normalize(control, [base[0] + ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)]);
    }
    const direction = control.members[0] === node ? 1 : -1;
    return normalize(control, base.map((coordinate, axis) => coordinate + direction * (point[axis] - start[axis])));
  }

  function evaluate(level, points) {
    const badEdges = new Set();
    const badNodes = new Set();
    const badObstacles = new Set();
    const spacing = level.radius ?? radius;
    let count = 0;
    const markEdge = (i) => {
      badEdges.add(i);
      level.edges[i].forEach((n) => badNodes.add(n));
    };
    points.forEach((p, i) => {
      for (let j = 0; j < i; j++) {
        if (distance(p, points[j]) >= spacing * (33 / 14)) continue;
        badNodes.add(i);
        badNodes.add(j);
        count++;
      }
      level.obstacles.forEach(({ center, r }, j) => {
        if (distance(p, center) >= r + spacing + 4) return;
        badNodes.add(i);
        badObstacles.add(j);
        count++;
      });
    });
    level.edges.forEach(([i, j], edge) => {
      const a = points[i];
      const b = points[j];
      points.forEach((p, k) => {
        if (k === i || k === j || distanceToSegment(p, a, b) >= spacing * (19 / 14)) return;
        badNodes.add(k);
        markEdge(edge);
        count++;
      });
      level.obstacles.forEach(({ center, r }, k) => {
        if (distanceToSegment(center, a, b) >= r + 4) return;
        badObstacles.add(k);
        markEdge(edge);
        count++;
      });
      // Collinear overlap involves a nonincident node on an edge, covered above.
      for (let other = 0; other < edge; other++) {
        const [k, l] = level.edges[other];
        if (i === k || i === l || j === k || j === l) continue;
        const [c, d] = [points[k], points[l]];
        const [rx, ry] = [b[0] - a[0], b[1] - a[1]];
        const [sx, sy] = [d[0] - c[0], d[1] - c[1]];
        const [cx, cy] = [c[0] - a[0], c[1] - a[1]];
        const determinant = rx * sy - ry * sx;
        if (Math.abs(determinant) < eps) continue;
        const t = (cx * sy - cy * sx) / determinant;
        const u = (cx * ry - cy * rx) / determinant;
        if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) continue;
        markEdge(edge);
        markEdge(other);
        count++;
      }
    });
    return { count, badEdges, badNodes, badObstacles };
  }

  function mixValue(control, from, to, amount) {
    if (control.kind === 'rotor') return normalize(control, [from[0] + turnDifference(from[0], to[0]) * amount]);
    return interpolate(from, to, amount);
  }

  function moveDistance(control, a, b) {
    if (control.kind === 'rotor') return Math.abs(turnDifference(a[0], b[0])) * 94;
    if (control.kind === 'rail') return Math.abs(a[0] - b[0]) * distance(control.a, control.b);
    return distance(a, b);
  }

  function solve(level, state) {
    const score = (candidate) => evaluate(level, positions(level, candidate)).count;
    const initialScore = score(state);
    if (!initialScore) return [];
    const pending = level.controls.map((_, i) => i);
    // Start from a valid embedding. Keep as much of the player's layout as geometry allows.
    const goal = copy(level.witness);
    const nearest = [...pending].sort((a, b) =>
      moveDistance(level.controls[a], goal[a], state[a]) - moveDistance(level.controls[b], goal[b], state[b]));
    for (let pass = 0; pass < 2; pass++) {
      for (const i of nearest) {
        const previous = goal[i];
        for (const fraction of [1, 0.75, 0.5, 0.25, 0.125]) {
          goal[i] = mixValue(level.controls[i], previous, state[i], fraction);
          if (score(goal) === 0) break;
          goal[i] = previous;
        }
      }
    }
    const current = copy(state);
    const moves = [];
    let conflicts = initialScore;
    while (conflicts && pending.length) {
      let best;
      for (const i of pending) {
        const length = moveDistance(level.controls[i], current[i], goal[i]);
        if (length < eps) continue;
        const trial = [...current];
        trial[i] = goal[i];
        const remaining = score(trial);
        if (!best || remaining < best.remaining || (remaining === best.remaining && length < best.length)) {
          best = { index: i, value: goal[i], length, remaining };
        }
      }
      if (!best) break;
      moves.push(best);
      current[best.index] = best.value;
      pending.splice(pending.indexOf(best.index), 1);
      conflicts = best.remaining;
    }
    return moves;
  }

  globalThis.Jiexian = { width, height, radius, margin, clamp, copy, distance, distanceToSegment,
    positions, normalize, dragValue, evaluate, mixValue, moveDistance, solve, createLevel, cycle, free, mirror, rotor, rail };
})();
