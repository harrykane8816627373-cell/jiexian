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
    let pairCount = 0;
    let diskCount = 0;
    const controls = data.controls.map((control, i) => {
      control.members.forEach((node) => { ownership[node] = i; });
      const target = data.points[control.members[0]];
      if (control.kind === 'rotor') return { ...control, symbol: 'R' + (++diskCount), target: [0] };
      if (control.kind === 'rail') return { ...control, target: [trackPosition(target, control.a, control.b)] };
      if (control.kind === 'mirror') {
        const other = data.points[control.members[1]];
        return { ...control, symbol: String.fromCharCode(65 + pairCount++), sum: target.map((value, axis) => value + other[axis]), target };
      }
      return { ...control, target };
    });
    return { obstacles: [], ...data, controls, ownership, initial: controls.map(({ start }) => start), witness: controls.map(({ target }) => target) };
  }

  function trackPosition(point, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
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
    const nodeSpacing = spacing * (33 / 14);
    let count = 0;
    const markEdge = (i) => {
      badEdges.add(i);
      level.edges[i].forEach((n) => badNodes.add(n));
    };
    points.forEach((p, i) => {
      for (let j = 0; j < i; j++) {
        if (distance(p, points[j]) >= nodeSpacing) continue;
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
      if (distance(a, b) < nodeSpacing) badEdges.add(edge);
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

  const readableNodeGap = 60;
  const readableLineGap = 40;
  const readableHalfAngle = Math.sin(13 * Math.PI / 180);
  const offsetDirections = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function layoutPenalty(level, points) {
    let penalty = 0;
    let largest = 0;
    const addGap = (ratio) => {
      if (ratio >= 1) return;
      const cost = (1 - ratio) ** 2;
      penalty += cost;
      largest = Math.max(largest, cost);
    };
    const directions = points.map(() => []);
    points.forEach((point, i) => {
      for (let j = 0; j < i; j++) addGap(distance(point, points[j]) / readableNodeGap);
    });
    level.edges.forEach(([i, j]) => {
      const a = points[i];
      const b = points[j];
      points.forEach((point, k) => {
        if (k !== i && k !== j) addGap(distanceToSegment(point, a, b) / readableLineGap);
      });
      const length = distance(a, b);
      if (!length) return;
      const dx = (b[0] - a[0]) / length;
      const dy = (b[1] - a[1]) / length;
      directions[i].push([dx, dy]);
      directions[j].push([-dx, -dy]);
    });
    for (const rays of directions) {
      rays.forEach(([x, y], i) => {
        for (let j = 0; j < i; j++) {
          const [u, v] = rays[j];
          const halfSine = Math.min(1, Math.hypot(x - u, y - v) / 2);
          addGap(halfSine / readableHalfAngle);
        }
      });
    }
    return penalty + 3 * largest;
  }

  function nearbyValues(control, value, step) {
    if (control.kind === 'rotor' || control.kind === 'rail') {
      const scale = control.kind === 'rotor' ? 94 : distance(control.a, control.b);
      return [-1, 1].map((sign) => normalize(control, [value[0] + sign * step / scale]));
    }
    return offsetDirections.map(([x, y]) => normalize(control, [value[0] + x * step, value[1] + y * step]));
  }

  function spreadLayout(level, start, startPenalty) {
    const goal = copy(start);
    let penalty = startPenalty;
    for (const step of [64, 32, 16, 8]) {
      for (const [i, control] of level.controls.entries()) {
        if (penalty <= eps) return goal;
        let best = goal[i];
        for (const value of nearbyValues(control, best, step)) {
          goal[i] = value;
          const points = positions(level, goal);
          const cost = layoutPenalty(level, points);
          if (cost >= penalty - eps || evaluate(level, points).count) continue;
          best = value;
          penalty = cost;
        }
        goal[i] = best;
      }
    }
    return goal;
  }

  function keepPlayerPositions(level, state, goal) {
    const maximumPenalty = layoutPenalty(level, positions(level, goal)) + eps;
    for (const [i, control] of level.controls.entries()) {
      const from = goal[i];
      if (moveDistance(control, from, state[i]) < eps) continue;
      for (const fraction of [1, .5, .25]) {
        goal[i] = mixValue(control, from, state[i], fraction);
        const points = positions(level, goal);
        if (layoutPenalty(level, points) <= maximumPenalty && !evaluate(level, points).count) break;
        goal[i] = from;
      }
    }
  }

  function solve(level, state) {
    if (!level.witness) return [];
    const initial = positions(level, state);
    const initialPenalty = evaluate(level, initial).count ? Infinity : layoutPenalty(level, initial);
    if (initialPenalty <= eps) return [];
    const witnessPenalty = layoutPenalty(level, positions(level, level.witness));
    const start = initialPenalty <= witnessPenalty ? state : level.witness;
    const goal = spreadLayout(level, start, Math.min(initialPenalty, witnessPenalty));
    if (initialPenalty === Infinity) keepPlayerPositions(level, state, goal);
    const pending = level.controls.map((_, i) => i);
    const current = copy(state);
    const moves = [];
    while (pending.length) {
      let best;
      for (const i of pending) {
        const length = moveDistance(level.controls[i], current[i], goal[i]);
        if (length < eps) continue;
        const trial = [...current];
        trial[i] = goal[i];
        const remaining = evaluate(level, positions(level, trial)).count;
        if (!best || remaining < best.remaining || (remaining === best.remaining && length < best.length)) {
          best = { index: i, value: goal[i], length, remaining };
        }
      }
      if (!best) break;
      moves.push(best);
      current[best.index] = best.value;
      pending.splice(pending.indexOf(best.index), 1);
    }
    return moves;
  }

  globalThis.Jiexian = { width, height, radius, margin, clamp, copy, distance, distanceToSegment,
    positions, normalize, dragValue, evaluate, mixValue, moveDistance, solve, createLevel, cycle, free, mirror, rotor, rail,
    trackPosition, interpolate, layoutPenalty };
})();
