(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const low = g.margin;
  const high = [g.width - low, g.height - low];
  const circle = (point, radius) => ({ point, radius });
  const line = (a, b) => ({ point: a, direction: [b[0] - a[0], b[1] - a[1]] });

  function capsule(a, b, radius) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!length) return [circle(a, radius)];
    return [circle(a, radius), circle(b, radius), ...[-1, 1].map((side) => ({
      point: [a[0] - side * radius * dy / length, a[1] + side * radius * dx / length],
      direction: [dx, dy],
    }))];
  }

  function shadow(anchor, point, radius) {
    const dx = point[0] - anchor[0], dy = point[1] - anchor[1];
    const adjacent = Math.hypot(dx, dy);
    if (adjacent < radius) return [];
    const tangent = Math.sqrt((adjacent - radius) * (adjacent + radius));
    return [circle(point, radius), ...[-1, 1].map((side) => ({
      point: anchor,
      direction: [dx * tangent - side * dy * radius, dy * tangent + side * dx * radius],
    }))];
  }

  function constraints(level, points, node) {
    const { nodes, nodeEdge, spacing, obstacleGap } = g.clearances(level);
    const records = [];
    const add = (test, boundary) => records.push({ test, boundary });
    const disk = (point, radius) => add((p) => g.distance(p, point) < radius, [circle(point, radius)]);
    const nearestEdge = (a, b) => add((p) => g.distanceToSegment(p, a, b) < nodeEdge, capsule(a, b, nodeEdge));
    const edgeShadow = (anchor, point, radius, movingFirst) => add(
      (p) => (movingFirst ? g.distanceToSegment(point, p, anchor) : g.distanceToSegment(point, anchor, p)) < radius,
      shadow(anchor, point, radius)
    );

    points.forEach((p, i) => { if (i !== node) disk(p, nodes); });
    level.obstacles.forEach(({ center, r }) => disk(center, r + spacing + obstacleGap));
    const incident = [], fixed = [];
    for (const [a, b] of level.edges) {
      if (a === node || b === node) incident.push({ neighbor: a === node ? b : a, movingFirst: a === node });
      else {
        fixed.push([a, b]);
        nearestEdge(points[a], points[b]);
      }
    }
    for (const { neighbor, movingFirst } of incident) {
      const a = points[neighbor];
      points.forEach((p, i) => { if (i !== node && i !== neighbor) edgeShadow(a, p, nodeEdge, movingFirst); });
      level.obstacles.forEach(({ center, r }) => edgeShadow(a, center, r + obstacleGap, movingFirst));
      for (const [i, j] of fixed) {
        if (i === neighbor || j === neighbor) continue;
        const b = points[i], c = points[j];
        add((p) => g.segmentsCross(a, p, b, c), [line(a, b), line(a, c), line(b, c)]);
      }
    }
    return records;
  }

  function boundaryRoots(shape, x, axis) {
    const other = 1 - axis;
    const offset = x - shape.point[axis];
    if (shape.direction) {
      return shape.direction[axis] ? [shape.point[other] + offset * shape.direction[other] / shape.direction[axis]] : [];
    }
    const distance = Math.abs(offset);
    if (distance > shape.radius) return [];
    const reach = Math.sqrt((shape.radius - distance) * (shape.radius + distance));
    return [shape.point[other] - reach, shape.point[other] + reach];
  }

  function sweep(records, axis, x, current) {
    const other = 1 - axis;
    const at = (y) => axis === 0 ? [x, y] : [y, x];
    const ends = [low, high[other]];
    const events = [];
    records.forEach(({ boundary }, index) => {
      for (const shape of boundary) {
        for (const value of boundaryRoots(shape, x, axis)) {
          if (value > ends[0] && value < ends[1]) events.push({ value, index });
        }
      }
    });
    events.sort((a, b) => a.value - b.value);
    const choices = [];
    const retain = (y, count) => {
      const p = at(y);
      choices.push({ p, count, motion: g.distance(p, current) });
    };

    for (const bound of ends) {
      const p = at(bound);
      retain(bound, records.reduce((sum, { test }) => sum + Number(test(p)), 0));
    }
    let previous = ends[0];
    let next = events[0]?.value ?? ends[1];
    const interior = (a, b) => {
      const inset = Math.min(1e-4, (b - a) / 4);
      return g.clamp(current[other], a + inset, b - inset);
    };
    let y = interior(previous, next);
    const flags = records.map(({ test }) => Number(test(at(y))));
    let count = flags.reduce((a, b) => a + b, 0);
    retain(y, count);
    for (let i = 0; i < events.length;) {
      const value = events[i].value;
      const involved = new Set();
      do involved.add(events[i++].index);
      while (events[i]?.value === value);
      let atEvent = count;
      for (const index of involved) atEvent += Number(records[index].test(at(value))) - flags[index];
      retain(value, atEvent);
      previous = value;
      next = events[i]?.value ?? ends[1];
      y = interior(previous, next);
      for (const index of involved) {
        const flag = Number(records[index].test(at(y)));
        count += flag - flags[index];
        flags[index] = flag;
      }
      retain(y, count);
    }
    return choices;
  }

  function slices(records, axis, current) {
    const end = high[axis];
    const selected = [current[axis], low, end, (low + end) / 2];
    for (let i = 1; i < 10; i++) selected.push(low + (end - low) * i / 10);
    const landmarks = new Set();
    for (const { boundary } of records) {
      for (const shape of boundary) {
        if (shape.direction && shape.direction[axis]) continue;
        const center = shape.point[axis];
        if (shape.direction) landmarks.add(center);
        else {
          landmarks.add(center - shape.radius);
          landmarks.add(center + shape.radius);
        }
      }
    }
    const relevant = [...landmarks].filter((value) => value > low && value < end)
      .sort((a, b) => Math.abs(a - current[axis]) - Math.abs(b - current[axis]));
    selected.push(...relevant.slice(0, 8));
    return [...new Set(selected)].filter((value) => value >= low && value <= end);
  }

  function compare(a, b) {
    return a.count - b.count || a.motion - b.motion;
  }

  function placements(level, points, node, total, budget) {
    const records = constraints(level, points, node);
    const old = points[node];
    const stationary = total - records.reduce((sum, { test }) => sum + Number(test(old)), 0);
    const retained = [];
    for (const axis of [0, 1]) {
      for (const x of slices(records, axis, old)) {
        if (budget.remaining < records.length) break;
        budget.remaining -= records.length;
        const candidates = sweep(records, axis, x, old);
        candidates.sort(compare);
        for (const candidate of candidates.slice(0, 4)) {
          if (candidate.motion < 1e-7) continue;
          const count = stationary + records.reduce((sum, { test }) => sum + Number(test(candidate.p)), 0);
          if (count > total) continue;
          const placement = { ...candidate, count };
          if (!count && !g.evaluate(level, points.map((point, i) => i === node ? candidate.p : point)).count) return [placement];
          retained.push(placement);
        }
      }
    }
    const result = [], seen = new Set();
    for (const candidate of retained.sort(compare)) {
      const cell = candidate.p.map((coord) => Math.floor(coord / 18)).join(',');
      if (seen.has(cell)) continue;
      seen.add(cell);
      result.push(candidate);
      if (result.length === 7) break;
    }
    return result;
  }

  function inspect(level, state, motion = 0) {
    const points = g.positions(level, state);
    const counts = new Map();
    const { count } = g.evaluate(level, points, (nodes) => {
      for (const node of nodes) {
        if (level.controls[level.ownership[node]]?.kind === 'free') counts.set(node, (counts.get(node) ?? 0) + 1);
      }
    });
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([node]) => node);
    return { state, points, count, ranked, motion };
  }

  function repair(level, current) {
    const first = inspect(level, current);
    if (!first.count) return { status: 'solved', state: current };
    if (first.count > 12 || !first.ranked.length) return null;
    let beam = [first], scans = 0;
    const budget = { remaining: 85_000 };
    const visited = new Set();
    for (let depth = 0; depth < 3 && beam.length; depth++) {
      const next = [];
      for (const candidate of beam) {
        for (const node of candidate.ranked.slice(0, depth === 0 ? 3 : 2)) {
          if (scans++ >= 19) return null;
          for (const move of placements(level, candidate.points, node, candidate.count, budget)) {
            const index = level.ownership[node];
            const state = [...candidate.state];
            state[index] = move.p;
            const trial = inspect(level, state, candidate.motion + move.motion);
            if (!trial.count) return { status: 'solved', state, preserveRepair: true };
            const key = state.map((part) => part.map((coordinate) => Math.round(coordinate * 4)).join(',')).join('/');
            if (!visited.has(key)) {
              visited.add(key);
              next.push(trial);
            }
          }
        }
      }
      beam = next.sort(compare).slice(0, 4);
    }
    return null;
  }

  globalThis.JiexianRepair = { repair };
})();
