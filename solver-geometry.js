(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const min = (a, b) => a < b ? a : b;
  const max = (a, b) => a > b ? a : b;
  const square = (x) => x * x;
  const vector = (a, b) => a.map((x, i) => x - b[i]);
  const dot = ([x, y], [u, v]) => x * u + y * v;
  const cross = ([x, y], [u, v]) => x * v - y * u;
  const norm = (v) => dot(v, v);
  const opposite = (a, b) => a < 0n && b > 0n || a > 0n && b < 0n;

  function scaledDecimals(values) {
    // Interpret the same shortest decimals used by the exact SMT model.
    const entries = [...new Set(values)].map((value) => {
      const [mantissa, exponent = '0'] = String(value).split('e');
      const [whole, fraction = ''] = mantissa.split('.');
      return [value, BigInt(whole + fraction), fraction.length - Number(exponent)];
    });
    const places = Math.max(6, ...entries.map((entry) => entry[2]));
    const integers = new Map(entries.map(([value, digits, fraction]) =>
      [value, digits * 10n ** BigInt(places - fraction)]));
    return (value) => integers.get(value);
  }

  function ceilSqrt(value) {
    if (value < 2n) return value;
    let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
    while (true) {
      const next = (root + value / root) / 2n;
      if (next >= root) return square(root) === value ? root : root + 1n;
      root = next;
    }
  }

  const boxUnion = (a, b) => a.map(([lo, hi], axis) => [min(lo, b[axis][0]), max(hi, b[axis][1])]);
  const pointBox = (p) => p.map((x) => [x, x]);
  const axisGaps = (a, b) => a.map(([lo, hi], axis) => max(0n, max(lo - b[axis][1], b[axis][0] - hi)));

  function motionBoxes(level, points, linear, units) {
    const margin = units(g.margin);
    const board = [[margin, units(g.width - g.margin)], [margin, units(g.height - g.margin)]];
    const boxes = points.map(pointBox);
    level.controls.forEach((control, i) => {
      const { kind, members } = control;
      if (kind === 'rail') {
        const { a, b, track } = linear[i];
        const box = boxUnion(pointBox(a), pointBox(b));
        if (track.bounds) box[track.axis] = track.bounds;
        boxes[members[0]] = box;
      } else if (kind === 'rotor') {
        const center = control.center.map(units);
        for (const member of members) {
          const r = ceilSqrt(norm(vector(points[member], center)));
          boxes[member] = center.map((x) => [x - r, x + r]);
        }
      } else {
        const bounds = kind === 'free' ? board : control.sum.map((sum, axis) => {
          const s = units(sum);
          const [lo, hi] = board[axis];
          return [max(lo, s - hi), min(hi, s - lo)];
        });
        for (const member of members) boxes[member] = bounds;
      }
    });
    return boxes;
  }

  function constantClear(kind, vertices, distance) {
    const [a, b, p, q] = vertices;
    if (kind === 'distance') return norm(vector(a, b)) >= square(distance);
    const ab = vector(b, a);
    const ap = vector(p, a);
    if (kind === 'crossing') {
      const pq = vector(q, p);
      return !opposite(cross(ab, ap), cross(ab, vector(q, a))) ||
        !opposite(cross(pq, vector(a, p)), cross(pq, vector(b, p)));
    }
    const projection = dot(ap, ab);
    if (projection <= 0n) return norm(ap) >= square(distance);
    const length = norm(ab);
    if (projection >= length) return norm(vector(p, b)) >= square(distance);
    return square(cross(ab, ap)) >= square(distance) * length;
  }

  function sharedTracks(rails, spacing) {
    const tracks = new Map();
    rails.forEach((rail, index) => {
      if (!rail) return;
      const { a, b } = rail;
      const key = [String(a), String(b)].sort().join('/');
      if (!tracks.has(key)) {
        const axis = a[0] === b[0] ? 1 : a[1] === b[1] ? 0 : -1;
        tracks.set(key, { axis, a, b, members: [] });
      }
      rail.track = tracks.get(key);
      rail.track.members.push(index);
    });
    for (const track of tracks.values()) {
      const { a, b, members } = track;
      if (norm(vector(a, b)) < square(BigInt(members.length - 1) * spacing)) return null;
    }
    return tracks;
  }

  function leftmostPacking(start, end, blocks, count, spacing) {
    blocks.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    let available = start;
    let obstacle = 0;
    const placement = [];
    for (let i = 0; i < count; i++) {
      // The intervals are open. A shared endpoint may be the only valid placement.
      while (obstacle < blocks.length && blocks[obstacle][0] < available) {
        available = max(available, blocks[obstacle++][1]);
      }
      if (available > end) return null;
      placement.push(available);
      available += spacing;
    }
    return placement;
  }

  function constrainTrack(track, stationary, segments, points, spacing) {
    const { axis, a, b, members } = track;
    if (axis < 0) return true;
    const line = a[1 - axis];
    const relaxed = [], tightened = [];
    let irrational = false;
    function addExclusion(lo, hi, d, offset) {
      const squaredReach = square(d) - square(offset);
      if (squaredReach <= 0n) return;
      const upper = ceilSqrt(squaredReach);
      const exact = square(upper) === squaredReach;
      const lower = exact ? upper : upper - 1n;
      relaxed.push([lo - lower, hi + lower]);
      tightened.push([lo - upper, hi + upper]);
      irrational ||= !exact;
    }
    for (const [i, gap] of stationary) {
      const p = points[i];
      addExclusion(p[axis], p[axis], gap, p[1 - axis] - line);
    }
    for (const [i, j, gap] of segments) {
      const p = points[i], q = points[j];
      if (p[1 - axis] === q[1 - axis]) {
        addExclusion(min(p[axis], q[axis]), max(p[axis], q[axis]), gap, p[1 - axis] - line);
      }
    }
    const start = min(a[axis], b[axis]), end = max(a[axis], b[axis]);
    const placement = leftmostPacking(start, end, relaxed, members.length, spacing);
    if (!placement) return false;
    const [back] = leftmostPacking(-end, -start, relaxed.map(([lo, hi]) => [-hi, -lo]), members.length, spacing);
    track.bounds = [placement[0], -back];
    track.relaxed = placement;
    track.placement = irrational ? leftmostPacking(start, end, tightened, members.length, spacing) : placement;
    return true;
  }

  function railFraction(coordinate, axis, rail) {
    const delta = rail.b[axis] - rail.a[axis];
    if (!delta) return [0n, 1n];
    const numerator = coordinate - rail.a[axis];
    return delta < 0n ? [-numerator, -delta] : [numerator, delta];
  }

  function approximateFraction(numerator, denominator) {
    if (!numerator) return 0;
    const places = 24 + String(denominator).length - String(numerator).length;
    const digits = numerator * 10n ** BigInt(places) / denominator;
    return Number(`${digits}e-${places}`);
  }

  function components(records, count) {
    const parent = Array.from({ length: count }, (_, i) => i);
    const root = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    for (const { support: [a, ...rest] } of records) {
      for (const b of rest) parent[root(b)] = root(a);
    }
    const groups = new Map();
    for (const record of records) {
      const i = root(record.support[0]);
      if (!groups.has(i)) groups.set(i, { controls: new Set(), records: [] });
      const part = groups.get(i);
      record.support.forEach((index) => part.controls.add(index));
      part.records.push(record);
    }
    return [...groups.values()].map(({ controls, records }) => ({ controls: [...controls], records }))
      .sort((a, b) => a.controls.length - b.controls.length || a.records.length - b.records.length);
  }

  function analyze(level) {
    const count = level.points.length;
    const clearance = g.clearances(level);
    const nodeLimits = level.obstacles.map(({ r }) => r + clearance.spacing + clearance.obstacleGap);
    const edgeLimits = level.obstacles.map(({ r }) => r + clearance.obstacleGap);
    const coordinates = [...level.points, ...level.obstacles.map(({ center }) => center)];
    const controlCoordinates = level.controls.flatMap(({ a, b, center, sum }) =>
      [...(a ?? []), ...(b ?? []), ...(center ?? []), ...(sum ?? [])]);
    const units = scaledDecimals([...coordinates.flat(), ...controlCoordinates, ...nodeLimits, ...edgeLimits,
      g.margin, g.width - g.margin, g.height - g.margin, clearance.nodes, clearance.nodeEdge]);
    const points = coordinates.map((p) => p.map(units));
    const owners = points.map((_, i) => i < count ? level.ownership[i] : -1);
    const rails = level.controls.map(({ kind, a, b }) => kind === 'rail' ? { a: a.map(units), b: b.map(units) } : null);
    const spacing = units(clearance.nodes);
    const tracks = sharedTracks(rails, spacing);
    if (!tracks) return { unsat: true };
    if (tracks.size) {
      const stationary = owners.flatMap((owner, i) => owner === -1 ? [[i, i < count ? spacing : units(nodeLimits[i - count])]] : []);
      const segments = level.edges.filter(([i, j]) => owners[i] === -1 && owners[j] === -1)
        .map(([i, j]) => [i, j, units(clearance.nodeEdge)]);
      for (const track of tracks.values()) {
        if (!constrainTrack(track, stationary, segments, points, spacing)) return { unsat: true };
      }
    }
    const boxes = motionBoxes(level, points, rails, units);
    if (boxes.some((box) => box.some(([lo, hi]) => lo > hi))) return { unsat: true };
    const edgeBoxes = level.edges.map(([a, b]) => boxUnion(boxes[a], boxes[b]));
    const records = [];
    let unsat = false;
    function include(kind, vertices, lhs, rhs, distance) {
      const gaps = axisGaps(lhs, rhs);
      const d = distance === undefined ? 0n : units(distance);
      if (kind === 'crossing' ? gaps.some((gap) => gap > 0n) : norm(gaps) >= square(d)) return;
      const support = [...new Set(vertices.map((i) => owners[i]).filter((i) => i !== -1))];
      const rigid = support.length === 1 && level.controls[support[0]].kind === 'rotor' &&
        vertices.every((i) => owners[i] === support[0]);
      if (!support.length || rigid) {
        if (!constantClear(kind, vertices.map((i) => points[i]), d)) unsat = true;
        return;
      }
      records.push({ kind, vertices, distance, support });
    }
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < i; j++) include('distance', [i, j], boxes[i], boxes[j], clearance.nodes);
      nodeLimits.forEach((d, j) => include('distance', [i, count + j], boxes[i], boxes[count + j], d));
    }
    level.edges.forEach(([a, b], i) => {
      for (let j = 0; j < count; j++) {
        if (j !== a && j !== b) include('segment', [a, b, j], boxes[j], edgeBoxes[i], clearance.nodeEdge);
      }
      edgeLimits.forEach((d, j) => include('segment', [a, b, count + j], boxes[count + j], edgeBoxes[i], d));
      for (let j = 0; j < i; j++) {
        const [c, d] = level.edges[j];
        if (a !== c && a !== d && b !== c && b !== d) include('crossing', [a, b, c, d], edgeBoxes[i], edgeBoxes[j]);
      }
    });
    if (unsat) return { unsat };

    const coupled = new Set();
    const involved = new Set();
    for (const { kind, vertices, support } of records) {
      const [i, j] = vertices;
      const track = rails[support[0]]?.track;
      for (const index of support) {
        if (rails[index]) involved.add(rails[index].track);
      }
      const sameTrack = track && support.every((index) => rails[index]?.track === track);
      if (kind === 'distance' && sameTrack && support.length === 2) continue;
      if (sameTrack && track.axis >= 0 && (kind === 'distance' && (owners[i] === -1 || owners[j] === -1) ||
        kind === 'segment' && owners[i] === -1 && owners[j] === -1 &&
        points[i][1 - track.axis] === points[j][1 - track.axis])) continue;
      for (const index of support) {
        if (rails[index]) coupled.add(rails[index].track);
      }
    }

    const packed = new Map();
    for (const track of tracks.values()) {
      if (coupled.has(track)) continue;
      const { axis, members } = track;
      const placement = track.placement ?? (!involved.has(track) ? track.relaxed : null);
      if (axis >= 0 && !placement) continue;
      const extent = members.length - 1;
      members.forEach((index, i) => {
        const rail = rails[index];
        const forward = rail.a.every((value, axis) => value === track.a[axis]);
        const [numerator, denominator] = axis >= 0 ? railFraction(placement[i], axis, rail) :
          [BigInt(forward ? i : extent - i), BigInt(extent || 1)];
        packed.set(index, [approximateFraction(numerator, denominator)]);
      });
    }
    const railBounds = rails.map((rail) => {
      if (!rail?.track.bounds) return null;
      const { axis, bounds } = rail.track;
      const ordered = rail.a[axis] <= rail.b[axis] ? bounds : [...bounds].reverse();
      return ordered.map((coordinate) => railFraction(coordinate, axis, rail));
    });
    const remaining = records.filter(({ support }) => !support.every((i) => packed.has(i)));
    return { coordinates, packed, railBounds, parts: components(remaining, level.controls.length),
      packingParts: packed.size ? components(records.filter(({ support }) => support.every((i) => packed.has(i))),
        level.controls.length) : [] };
  }

  globalThis.JiexianSolverGeometry = { analyze };
})();
