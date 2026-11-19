(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const trackSolver = globalThis.JiexianSolverTracks;
  const regions = globalThis.JiexianSolverRegions;
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
        boxes[members[0]] = trackSolver.motionBox(linear[i]);
      } else if (kind === 'rotor') {
        const center = control.center.map(units);
        for (const member of members) {
          const r = trackSolver.ceilSqrt(norm(vector(points[member], center)));
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

  function solveTrackComponents(parts, rails, tracks, spacing, points, owners) {
    const packed = new Map(), unresolved = [], retryParts = [];
    const seen = new Set();
    function saveSlots(track, slots) {
      track.members.forEach((index, i) => packed.set(index, [trackSolver.approximateParameter(rails[index], slots[i])]));
    }
    for (const part of parts) {
      const byDirection = new Map();
      const involved = new Set(part.controls);
      for (const index of part.controls) {
        const track = rails[index]?.track;
        if (!track) continue;
        seen.add(track);
        if (!byDirection.has(track.orientation)) byDirection.set(track.orientation, new Set());
        byDirection.get(track.orientation).add(track);
      }
      const allParallel = byDirection.size === 1 && part.controls.every((index) =>
        rails[index] && rails[index].track.members.every((member) => involved.has(member)));
      const canUse = allParallel && part.records.every((record) => trackSolver.supports(record, rails, points, owners));
      let solved = false;
      for (const trackSet of byDirection.values()) {
        // Residual geometry can only add restrictions. A failed relaxed schedule still proves UNSAT.
        if (!canUse && trackSet.size < 2) continue;
        const chain = [...trackSet];
        const result = trackSolver.solveParallel(chain, spacing, canUse);
        if (result.status === 'unsat') return null;
        if (result.status === 'solved') {
          chain.forEach((track, i) => saveSlots(track, result.sequences[i]));
          solved = true;
        }
      }
      (solved ? retryParts : unresolved).push(part);
    }
    for (const track of tracks) {
      if (seen.has(track)) continue;
      const result = trackSolver.solveParallel([track], spacing, true);
      saveSlots(track, result.sequences?.[0] ?? track.relaxedSlots);
    }
    return { packed, retryParts, parts: unresolved };
  }

  function analyze(level) {
    const count = level.points.length;
    const clearance = g.clearances(level);
    const nodeLimits = level.obstacles.map(({ r }) => r + clearance.spacing + clearance.obstacleGap);
    const edgeLimits = level.obstacles.map(({ r }) => r + clearance.obstacleGap);
    const coordinates = [...level.points, ...level.obstacles.map(({ center }) => center)];
    const controlCoordinates = level.controls.flatMap(({ a, b, center, sum }) =>
      [...(a ?? []), ...(b ?? []), ...(center ?? []), ...(sum ?? [])]);
    const units = scaledDecimals([1, ...coordinates.flat(), ...controlCoordinates, ...nodeLimits, ...edgeLimits,
      g.margin, g.width - g.margin, g.height - g.margin, clearance.nodes, clearance.nodeEdge]);
    const points = coordinates.map((p) => p.map(units));
    const owners = points.map((_, i) => i < count ? level.ownership[i] : -1);
    const spacing = units(clearance.nodes);
    const tracksData = trackSolver.buildTracks(level, points, owners, units, spacing, nodeLimits, units(clearance.nodeEdge));
    if (!tracksData) return { unsat: true };
    const { rails, tracks } = tracksData;
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

    const parts = components(records, level.controls.length);
    const result = solveTrackComponents(parts, rails, tracks, spacing, points, owners);
    if (!result) return { unsat: true };
    const railBounds = rails.map((rail) => rail && trackSolver.parameterBounds(rail));
    const region = regions.tighten(level, result.parts, boxes, points, owners, units, railBounds);
    if (!region) return { unsat: true };
    for (const [index, value] of region.packed) result.packed.set(index, value);
    return { ...result, coordinates, railBounds, parts: region.parts, retryParts: [...result.retryParts, ...region.retry] };
  }

  globalThis.JiexianSolverGeometry = { analyze };
})();
