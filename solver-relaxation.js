(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const board = [[g.margin, g.width - g.margin], [g.margin, g.height - g.margin]];
  const angles = [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6, Math.PI / 2];
  const bandAngles = Array.from({ length: 16 }, (_, i) => i * Math.PI / 8);
  const neighborDirections = [0, Math.PI / 7, -Math.PI / 7].map((angle) => [Math.cos(angle), Math.sin(angle)]);

  function side(a, b, p, q, vertices) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const x = length ? dx / length : 1, y = length ? dy / length : 0;
    const left = (p[1] - a[1]) * x - (p[0] - a[0]) * y;
    const right = (q[1] - a[1]) * x - (q[0] - a[0]) * y;
    const sign = Math.min(left, right) >= -Math.max(left, right) ? 1 : -1;
    const first = sign * left <= sign * right;
    const gap = sign * (first ? left : right);
    if (gap >= .08) return null;
    const endpoint = first ? p : q;
    const t = length ? ((endpoint[0] - a[0]) * x + (endpoint[1] - a[1]) * y) / length : .5;
    const [i, j, k, l] = vertices;
    return { gap, normal: [-y * sign, x * sign],
      terms: [[i, t - 1], [j, -t], [first ? k : l, 1]] };
  }

  function residuals(records, points, add, limit = Infinity) {
    let cost = 0;
    const retain = (deficit, normal, terms) => {
      if (deficit <= 0) return;
      cost += deficit * deficit;
      add?.(deficit, normal, terms);
    };
    for (const { kind, vertices: [i, j, k, l], distance } of records) {
      const a = points[i], b = points[j];
      if (kind === 'short') {
        const x = a[0] - b[0], y = a[1] - b[1];
        if (x * x + y * y <= distance * distance) continue;
        const length = Math.hypot(x, y);
        retain(length - distance, [x / length, y / length], [[i, -1], [j, 1]]);
      } else if (kind === 'distance') {
        const x = a[0] - b[0], y = a[1] - b[1];
        const squared = x * x + y * y, reach = distance + .15;
        if (squared >= reach * reach) continue;
        const length = Math.sqrt(squared);
        retain(reach - length, length ? [x / length, y / length] : [1, 0], [[i, 1], [j, -1]]);
      } else if (kind === 'segment') {
        const p = points[k];
        const dx = b[0] - a[0], dy = b[1] - a[1], squared = dx * dx + dy * dy;
        const px = p[0] - a[0], py = p[1] - a[1];
        const t = squared ? g.clamp((px * dx + py * dy) / squared, 0, 1) : 0;
        const x = px - t * dx, y = py - t * dy;
        const gapSquared = x * x + y * y, reach = distance + .15;
        if (gapSquared >= reach * reach) continue;
        const length = Math.sqrt(gapSquared);
        let normal = length > 1e-10 ? [x / length, y / length] : [1, 0];
        // At distance zero a tangent step may leave the point on the segment.
        if (length <= 1e-10 && squared) {
          const inverseLength = (dx < 0 || dx === 0 && dy < 0 ? -1 : 1) / Math.sqrt(squared);
          normal = [-dy * inverseLength, dx * inverseLength];
        }
        retain(reach - length, normal, [[i, t - 1], [j, -t], [k, 1]]);
      } else {
        const c = points[k], d = points[l];
        const first = side(a, b, c, d, [i, j, k, l]);
        if (!first) continue;
        const second = side(c, d, a, b, [k, l, i, j]);
        if (!second) continue;
        const { gap, normal, terms } = first.gap >= second.gap ? first : second;
        retain(.08 - gap, normal, terms);
      }
      if (cost >= limit) break;
    }
    return cost;
  }

  function solvePositiveDefinite(lower, right, damping) {
    const n = right.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let value = lower[i][j] + (i === j ? damping : 0);
        for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
        lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j];
      }
      for (let j = 0; j < i; j++) right[i] -= lower[i][j] * right[j];
      right[i] /= lower[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) right[i] -= lower[j][i] * right[j];
      right[i] /= lower[i][i];
    }
    return right;
  }

  function rowProduct(first, second) {
    let a = 0, b = 0, sum = 0;
    while (a < first.length && b < second.length) {
      const [i, u] = first[a], [j, v] = second[b];
      if (i === j) sum += u * v;
      if (i <= j) a++;
      if (j <= i) b++;
    }
    return sum;
  }

  function solveBlock(controls, records, delta, damping) {
    if (records.length < controls.length) {
      // (JᵀJ + λI)⁻¹Jᵀ = Jᵀ(JJᵀ + λI)⁻¹. Factor in the smaller space.
      const gram = records.map(({ terms }, i) => Float64Array.from({ length: i + 1 }, (_, j) =>
        rowProduct(terms, records[j].terms)));
      const multipliers = solvePositiveDefinite(gram, Float64Array.from(records, ({ deficit }) => deficit), damping);
      records.forEach(({ terms }, row) => {
        for (const [i, value] of terms) delta[i] += value * multipliers[row];
      });
      return;
    }
    const matrix = controls.map((_, i) => new Float64Array(i + 1));
    const local = new Map(controls.map((i, column) => [i, column]));
    const right = new Float64Array(controls.length);
    for (const { deficit, terms } of records) {
      const columns = terms.map(([i, value]) => [local.get(i), value]);
      for (const [j, a] of columns) {
        right[j] += a * deficit;
        for (const [k, b] of columns) {
          if (k <= j) matrix[j][k] += a * b;
        }
      }
    }
    solvePositiveDefinite(matrix, right, damping);
    controls.forEach((i, column) => { delta[i] = right[column]; });
  }

  function dampedStep(rows, frozen, damping) {
    const active = [];
    for (const { deficit, terms } of rows) {
      const movable = terms.filter(([i, value]) => !frozen[i] && value !== 0);
      if (movable.length) active.push({ deficit, terms: movable, support: movable.map(([i]) => i) });
    }
    const delta = new Float64Array(frozen.length);
    // Rows in different components share no free coordinates, so the normal equations decouple.
    for (const { controls, records } of globalThis.JiexianSolverGeometry.components(active, frozen.length)) {
      solveBlock(controls, records, delta, damping);
    }
    return delta;
  }

  function improve(level, records, obstacles, start, iterations = 110) {
    const count = start.length, n = count * 2;
    const fixed = Uint8Array.from({ length: n }, (_, i) => Number(level.ownership[Math.floor(i / 2)] === -1));
    let points = [...start, ...obstacles];
    let damping = .2;
    for (let i = 0; i < iterations; i++) {
      const rows = [];
      const cost = residuals(records, points, (deficit, normal, terms) => {
        const row = terms.filter(([node]) => node < count).sort(([a], [b]) => a - b)
          .flatMap(([node, factor]) => normal.map((component, axis) => [node * 2 + axis, factor * component]));
        rows.push({ deficit, terms: row });
      });
      if (cost < 1 && !g.evaluate(level, points.slice(0, count)).count) return { points: points.slice(0, count), count: 0 };
      // Freeze directions pointing out of the board at its boundary.
      const frozen = fixed.slice();
      let delta = dampedStep(rows, frozen, damping);
      for (let pass = 0; pass < 3; pass++) {
        let blocked = false;
        for (let j = 0; j < n; j++) {
          const axis = j % 2, value = points[Math.floor(j / 2)][axis];
          const [lo, hi] = board[axis];
          if (delta[j] < -1e-10 && value === lo || delta[j] > 1e-10 && value === hi) {
            frozen[j] = 1;
            blocked = true;
          }
        }
        if (!blocked) break;
        delta = dampedStep(rows, frozen, damping);
      }
      const gain = Math.min(1, 42 / Math.max(1, ...delta.map(Math.abs)));
      const trial = [...points.slice(0, count).map((point, i) => fixed[i * 2] ? point : point.map((value, axis) =>
        g.clamp(value + gain * delta[i * 2 + axis], ...board[axis]))), ...obstacles];
      if (residuals(records, trial) < cost - 1e-8) {
        points = trial;
        damping = Math.max(1e-5, damping / 2);
      } else {
        damping *= 5;
        if (damping > 10000) break;
      }
    }
    const candidate = points.slice(0, count);
    return { points: candidate, count: g.evaluate(level, candidate).count };
  }

  function neighborSeeds(level, points, neighbors) {
    const severity = new Float64Array(points.length);
    g.evaluate(level, points, (nodes, kind) => {
      if (kind === 'node-edge') {
        severity[nodes[0]] += 2;
        severity[nodes[1]] += 2;
        severity[nodes[2]]++;
      } else if (kind === 'edge-obstacle' || kind === 'nodes') {
        for (const node of nodes) severity[node]++;
      }
    });
    const order = points.map((_, i) => i).filter((i) => severity[i]).sort((a, b) => severity[b] - severity[a]);
    const spacing = g.clearances(level).nodes;
    const seeds = [];
    for (const i of order) {
      const [x, y] = points[i];
      const nearest = neighbors[i].map((j) => ({ point: points[j], length: g.distance(points[i], points[j]) }))
        .sort((a, b) => a.length - b.length);
      for (const { point: [u, v], length } of nearest) {
        const step = Math.min(.68 * length, length - spacing);
        if (step <= 0) continue;
        const dx = (u - x) * step / length, dy = (v - y) * step / length;
        for (const [c, s] of neighborDirections) {
          const next = points.slice();
          next[i] = [g.clamp(x + c * dx - s * dy, ...board[0]), g.clamp(y + s * dx + c * dy, ...board[1])];
          seeds.push(next);
        }
      }
    }
    return seeds;
  }

  function orientDrawing(drawing, angle, reflect = false) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return drawing.map(([x, y]) => {
      const u = reflect ? -x : x;
      return [u * c - y * s, u * s + y * c];
    });
  }

  function drawingBounds(drawing) {
    return board.map((_, axis) => {
      const values = drawing.map((point) => point[axis]);
      return [Math.min(...values), Math.max(...values)];
    });
  }

  function fitDrawing(drawing, extent, bounds) {
    return drawing.map((point) => point.map((value, axis) => {
      const [a, b] = extent[axis], [lo, hi] = bounds[axis];
      if (a === b) return (lo + hi) / 2;
      return value === b ? hi : lo + (hi - lo) * (value - a) / (b - a);
    }));
  }

  function attachmentSide(a, b, [x, y]) {
    return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  }

  function sectionSeeds(level, points, section, links, axis, records, obstacles) {
    const indices = new Map(section.map((node, index) => [node, index]));
    const attachments = links.map((edge) => indices.get(edge.find((node) => indices.has(node))));
    if (attachments[0] === attachments[1]) return [];
    const outside = links.map((edge) => points[edge.find((node) => !indices.has(node))]);
    const edges = level.edges.filter((edge) => edge.every((node) => indices.has(node)))
      .map((edge) => edge.map((node) => indices.get(node)));
    // Give both attachment vertices a common outer side. The additional edge
    // guides drawing generation only and never enters the game's constraints.
    if (!edges.some((edge) => edge.every((i) => attachments.includes(i)))) edges.push(attachments);
    const drawings = globalThis.JiexianDrawing(section.length, edges) ?? [];
    const extent = drawingBounds(section.map((node) => points[node]));
    const { nodes, spacing, obstacleGap } = g.clearances(level);
    const padding = spacing + obstacleGap;
    const frames = [padding, padding + nodes].flatMap((extra) => [1, .68, 1.36].map((stretch) =>
      extent.map(([lo, hi], i) => {
        const middle = (lo + hi) / 2;
        const half = (hi - lo) / 2;
        const span = i === axis ? half + extra : half * stretch;
        return [Math.max(board[i][0], middle - span), Math.min(board[i][1], middle + span)];
      })));
    const ranked = [];
    for (const drawing of drawings) {
      const [a, b] = attachments.map((i) => drawing[i]);
      const sides = drawing.map((point) => attachmentSide(a, b, point));
      if (Math.min(...sides) < -1e-6 && Math.max(...sides) > 1e-6) continue;
      const inside = sides.findIndex((side) => Math.abs(side) > 1e-6);
      if (inside === -1) continue;
      for (let turn = 0; turn < 24; turn++) {
        for (const reflect of [false, true]) {
          const shape = orientDrawing(drawing, turn * (Math.PI / 12), reflect);
          const bounds = drawingBounds(shape);
          for (const frame of frames) {
            const placed = fitDrawing(shape, bounds, frame);
            const [u, v] = attachments.map((i) => placed[i]);
            const side = attachmentSide(u, v, placed[inside]);
            if (outside.some((point) => attachmentSide(u, v, point) * side >= 0)) continue;
            const trial = points.slice();
            section.forEach((node, i) => { trial[node] = placed[i]; });
            const limit = ranked[63]?.cost ?? Infinity;
            const cost = residuals(records, [...trial, ...obstacles], undefined, limit);
            if (cost >= limit) continue;
            ranked.push({ points: trial, cost });
            ranked.sort((first, last) => first.cost - last.cost);
            if (ranked.length > 64) ranked.pop();
          }
        }
      }
    }
    return ranked;
  }

  function repairSplit(level, problem, state) {
    const points = g.positions(level, state);
    let crossing;
    const { count } = g.evaluate(level, points, (nodes, kind) => { if (kind === 'crossing') crossing ??= nodes; });
    if (!crossing || count > 4) return null;
    const records = [...problem.parts, ...problem.retryParts].flatMap(({ records }) => records);
    const obstacles = problem.coordinates.slice(points.length);
    const seen = new Set();
    for (let axis = 0; axis < 2; axis++) {
      const sorted = points.map((_, i) => i).sort((a, b) => points[a][axis] - points[b][axis]);
      for (let cut = 4; cut <= sorted.length - 4; cut++) {
        const left = sorted.slice(0, cut), right = sorted.slice(cut).reverse();
        const section = [left, right].find((side) => crossing.every((node) => side.includes(node)));
        if (!section) continue;
        const members = new Set(section);
        const links = level.edges.filter(([a, b]) => members.has(a) !== members.has(b));
        if (links.length !== 2) continue;
        const key = [...members].sort((a, b) => a - b).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        for (const seed of sectionSeeds(level, points, section, links, axis, records, obstacles)) {
          const result = improve(level, records, obstacles, seed.points, 150);
          if (!result.count) return { status: 'solved',
            state: level.controls.map(({ members: [i] }) => result.points[i]), preserveRepair: true };
        }
        if (seen.size >= 3) return null;
      }
    }
    return null;
  }

  function seed(drawing, angle, reverse) {
    const rotated = orientDrawing(drawing, angle);
    const bounds = board.map(([lo, hi], axis) => {
      const width = hi - lo;
      const [start, end] = axis ? [.445, .995] : [.04, .91];
      return reverse ? [hi - width * end, hi - width * start] : [lo + width * start, lo + width * end];
    });
    return fitDrawing(rotated, drawingBounds(rotated), bounds);
  }

  function boundaryWindows(level) {
    const minimumSpan = 2 * g.clearances(level).nodes;
    const windows = [board];
    for (const [axis, [lo, hi]] of board.entries()) {
      const span = hi - lo;
      for (const direction of [-1, 1]) {
        const reach = ({ center, r }) => direction * center[axis] + r;
        const { center, r } = level.obstacles.reduce((a, b) => reach(a) >= reach(b) ? a : b);
        const cuts = [lo + .25 * span, lo + .5 * span, lo + .75 * span, center[axis], center[axis] - direction * .75 * r];
        for (const cut of new Set(cuts)) {
          const interval = direction < 0 ? [lo, cut] : [cut, hi];
          const width = interval[1] - interval[0];
          if (width < minimumSpan || width > .8 * span) continue;
          windows.push(axis === 0 ? [interval, board[1]] : [board[0], interval]);
        }
      }
    }
    return windows;
  }

  function boundarySeeds(level, drawings, records, obstacles) {
    // Invertible affine placement preserves crossings. Rank templates by clearance,
    // then restore every constraint during refinement and final validation.
    const distanceRecords = records.filter(({ kind }) => kind !== 'crossing');
    const windows = boundaryWindows(level);
    const starts = [];
    for (const drawing of drawings.slice(0, 5)) {
      const orientations = bandAngles.flatMap((angle) => [false, true].map((reflect) => {
        const points = orientDrawing(drawing, angle, reflect);
        return { points, extent: drawingBounds(points) };
      }));
      for (const window of windows) {
        const ranked = [];
        for (const { points, extent } of orientations) {
          const placed = fitDrawing(points, extent, window);
          const limit = ranked[3]?.cost ?? Infinity;
          const cost = residuals(distanceRecords, [...placed, ...obstacles], undefined, limit);
          if (cost >= limit) continue;
          ranked.push({ points: placed, cost });
          ranked.sort((a, b) => a.cost - b.cost);
          if (ranked.length > 4) ranked.pop();
        }
        starts.push(...ranked);
      }
    }
    return starts.sort((a, b) => a.cost - b.cost).slice(0, 32);
  }

  function interiorBands(level) {
    const { nodes, spacing, obstacleGap } = g.clearances(level);
    const bands = [];
    for (const [axis, [low, high]] of board.entries()) {
      const circles = [...level.obstacles].sort((a, b) => a.center[axis] - b.center[axis]);
      const upper = ({ center, r }) => center[axis] + r + spacing + obstacleGap;
      const lower = ({ center, r }) => center[axis] - r - spacing - obstacleGap;
      // Start from a straight strip between two banks. Wider seed frames also
      // reach the bays between circles, where the numerical repair can fan out.
      for (let i = 2; i <= circles.length - 2; i++) {
        const from = Math.max(low, ...circles.slice(0, i).map(upper));
        const to = Math.min(high, ...circles.slice(i).map(lower));
        if (to - from < .6 * nodes) continue;
        const mid = (from + to) / 2;
        for (const offset of [0, -.6, .6]) {
          const center = mid + offset * nodes;
          for (const width of [2.42, 3.03, 3.79, 4.67, 5.67, 7.18]) {
            const reach = width * nodes / 2;
            const strip = [Math.max(low, center - reach), Math.min(high, center + reach)];
            bands.push(axis === 0 ? [strip, board[1]] : [board[0], strip]);
          }
        }
      }
    }
    return bands;
  }

  function wallFrames(level) {
    const { nodes } = g.clearances(level);
    const frames = [];
    for (const [axis, [lo, hi]] of board.entries()) {
      const [start, end] = board[1 - axis];
      for (const span of [5, 6, 7, 8, 9, 10]) {
        const thickness = span * nodes;
        if (thickness > hi - lo) continue;
        for (const strip of [[lo, lo + thickness], [hi - thickness, hi]]) {
          const crossSections = [[start, end]];
          for (const trim of [.8 * nodes, 1.6 * nodes]) {
            crossSections.push([start + trim, end], [start, end - trim]);
          }
          for (const section of crossSections) frames.push(axis === 0 ? [strip, section] : [section, strip]);
        }
      }
    }
    return frames;
  }

  function bandSeeds(drawings, frames, records, obstacles, perDrawing = 8) {
    const starts = [];
    for (const drawing of drawings) {
      const ranked = [];
      for (const angle of bandAngles) {
        for (const reflected of [false, true]) {
          const shape = orientDrawing(drawing, angle, reflected);
          const extent = drawingBounds(shape);
          for (const frame of frames) {
            const points = fitDrawing(shape, extent, frame);
            const limit = ranked[perDrawing - 1]?.cost ?? Infinity;
            const cost = residuals(records, [...points, ...obstacles], undefined, limit);
            if (cost >= limit) continue;
            ranked.push({ points, cost });
            ranked.sort((a, b) => a.cost - b.cost);
            if (ranked.length > perDrawing) ranked.pop();
          }
        }
      }
      starts.push(...ranked);
    }
    return starts.sort((a, b) => a.cost - b.cost);
  }

  function polishBand(level, records, obstacles, points) {
    let best = points;
    polishLength(level, records, obstacles, points, (candidate) => { best = candidate; });
    return best;
  }

  function repairBandStarts(level, records, obstacles, starts) {
    for (const { points } of starts) {
      const result = improve(level, records, obstacles, points, 150);
      if (!result.count) return polishBand(level, records, obstacles, result.points);
    }
    return null;
  }

  function repairBand(level, drawings, frames, records, obstacles, rankingRecords = records) {
    if (!frames.length || !drawings?.length) return null;
    const starts = bandSeeds(drawings, frames, rankingRecords, obstacles).slice(0, 48);
    return repairBandStarts(level, records, obstacles, starts);
  }

  function growBand(level, records, centers, starts) {
    const count = level.points.length;
    // Make space for the planar drawing first. Then restore the original
    // circles in smaller steps so the nearest contacts can move together.
    const stages = [.65, .75, .85, .925, .975].map((ratio) => {
      const obstacles = level.obstacles.map((disk) => ({ ...disk, r: disk.r * ratio }));
      const resized = records.map((record) => {
        const disk = record.vertices.find((node) => node >= count);
        if (disk === undefined) return record;
        const i = disk - count;
        return { ...record, distance: record.distance - (level.obstacles[i].r - obstacles[i].r) };
      });
      return { level: { ...level, obstacles }, records: resized };
    });
    stages.push({ level, records });
    for (const start of starts) {
      let result = start;
      for (const stage of stages) {
        result = improve(stage.level, stage.records, centers, result.points, 80);
        if (result.count) break;
      }
      if (!result.count) return polishBand(level, records, centers, result.points);
    }
    return null;
  }

  function corridorEdges(level, crossings) {
    const count = level.points.length;
    const key = ([a, b]) => Math.min(a, b) * count + Math.max(a, b);
    const contacts = new Map();
    for (const { nodes } of crossings) {
      for (const edge of [nodes.slice(0, 2), nodes.slice(2)]) {
        const index = key(edge);
        contacts.set(index, (contacts.get(index) ?? 0) + 1);
      }
    }
    // Build the embedding in a reproducible order. If one wire accounts for
    // most crossings, let the other wires determine the traversal first.
    const last = [...contacts].filter(([, hits]) => hits >= 4 && hits * 4 >= crossings.length * 3)
      .sort(([a, hitsA], [b, hitsB]) => hitsB - hitsA || a - b)[0]?.[0];
    return level.edges.map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
      .sort((a, b) => Number(key(a) === last) - Number(key(b) === last) || key(a) - key(b));
  }

  function findCorridor(level, crossings) {
    const bands = interiorBands(level);
    if (!bands.length) return null;
    const edges = corridorEdges(level, crossings);
    const ordered = { ...level, edges };
    const drawings = globalThis.JiexianDrawing(level.points.length, edges);
    if (!drawings?.length) return null;
    const geometry = globalThis.JiexianSolverGeometry.analyze(ordered, { forLength: true });
    if (geometry.unsat) return null;
    const { part: { records }, coordinates } = geometry;
    const obstacles = coordinates.slice(level.points.length);
    const distanceRecords = records.filter(({ kind }) => kind !== 'crossing');
    const starts = bandSeeds(drawings, bands, distanceRecords, obstacles, 12).slice(0, 24);
    const points = repairBandStarts(ordered, records, obstacles, starts.slice(0, 6)) ??
      growBand(ordered, records, obstacles, starts);
    if (!points) return null;
    return { status: 'solved', state: level.controls.map(({ members: [i] }) => points[i]), preserveRepair: true };
  }

  function repair(level, problem, { starts = [], reembed = true, useBoundaryBands = false, restarts = 36, offer } = {}) {
    if (level.controls.length !== level.points.length || level.controls.some(({ kind }) => kind !== 'free')) return null;
    const records = [...problem.parts, ...problem.retryParts].flatMap(({ records }) => records);
    const obstacles = problem.coordinates.slice(level.points.length);
    const stateOf = (points) => level.controls.map(({ members: [i] }) => points[i]);
    function trySeed(start) {
      const outcome = improve(level, records, obstacles, start);
      if (outcome.count) offer?.(stateOf(outcome.points), outcome.count);
      return outcome;
    }
    let initial, partial;
    for (const state of new Set(starts)) {
      const start = g.positions(level, state);
      const result = trySeed(start);
      if (!result.count) return { status: 'solved', state: stateOf(result.points) };
      if (!initial) {
        initial = start;
        partial = result.points;
      }
    }
    let drawings;
    if (useBoundaryBands && level.obstacles.length) {
      drawings = globalThis.JiexianDrawing(level.points.length, level.edges);
      if (drawings?.length) {
        for (const { points } of boundarySeeds(level, drawings, records, obstacles)) {
          const result = trySeed(points);
          if (!result.count) return { status: 'solved', state: stateOf(result.points) };
        }
      }
    }
    if (initial && restarts) {
      const neighbors = level.points.map(() => []);
      for (const [a, b] of level.edges) {
        neighbors[a].push(b);
        neighbors[b].push(a);
      }
      // Try different directions at a stressed vertex using its incident edges.
      const seeds = [partial, initial].map((points) => neighborSeeds(level, points, neighbors));
      const rounds = Math.max(...seeds.map(({ length }) => length));
      let budget = restarts;
      for (let i = 0; budget && i < rounds; i++) {
        for (const nearby of seeds) {
          if (!nearby[i] || !budget) continue;
          budget--;
          const result = trySeed(nearby[i]);
          if (!result.count) return { status: 'solved', state: stateOf(result.points) };
        }
      }
    }
    if (!reembed) return null;
    drawings ??= globalThis.JiexianDrawing(level.points.length, level.edges);
    if (!drawings?.length) return null;
    const seeds = angles.flatMap((angle) => drawings.slice(0, 8).flatMap((drawing) =>
      [false, true].map((reverse) => seed(drawing, angle, reverse))));
    const ranked = seeds.map((points) => ({ points, cost: residuals(records, [...points, ...obstacles]) }))
      .sort((a, b) => a.cost - b.cost);
    for (const { points: start } of ranked.slice(0, 20)) {
      const result = trySeed(start);
      if (!result.count) return { status: 'solved', state: stateOf(result.points) };
    }
    return null;
  }

  function polishLength(level, records, obstacles, initial, offer) {
    let points = initial;
    let best = g.totalLength(level, points);
    for (const stride of [9, 4, 1.8, .75, .25, .08]) {
      for (let step = 0; step < 8; step++) {
        const gradient = points.map(() => [0, 0]);
        for (const [a, b] of level.edges) {
          const length = g.distance(points[a], points[b]);
          if (!length) continue;
          for (let axis = 0; axis < 2; axis++) {
            const force = (points[b][axis] - points[a][axis]) / length;
            gradient[a][axis] += force;
            gradient[b][axis] -= force;
          }
        }
        // Move all endpoints toward shorter edges, then repair the local contacts together.
        const trial = points.map((point, i) => level.ownership[i] === -1 ? point : point.map((value, axis) =>
          g.clamp(value + stride * gradient[i][axis], ...board[axis])));
        const candidate = improve(level, records, obstacles, trial, 14);
        if (candidate.count) break;
        const length = g.totalLength(level, candidate.points);
        if (length >= best - 1e-7) break;
        points = candidate.points;
        best = length;
        if (offer(points)) return true;
      }
    }
    return false;
  }

  function positionTemplates(level, drawings, records, obstacles) {
    const clearance = g.clearances(level).nodes;
    const obstacleRecords = records.filter(({ vertices }) => vertices.some((i) => i >= level.points.length));
    const placements = [];
    for (const drawing of drawings) {
      const length = g.totalLength(level, drawing);
      const rotations = [];
      for (const angle of bandAngles) {
        const rotated = orientDrawing(drawing, angle);
        const extent = drawingBounds(rotated);
        const [horizontal, vertical] = extent.map(([lo, hi], axis) => {
          const [wallLo, wallHi] = board[axis];
          const room = wallHi - wallLo - (hi - lo);
          if (room < 0) return [];
          const divisions = Math.min(32, Math.max(1, Math.ceil(room / clearance)));
          return Array.from({ length: divisions + 1 }, (_, i) => wallLo - lo + room * i / divisions);
        });
        let best = Infinity, points;
        for (const x of horizontal) {
          for (const y of vertical) {
            const trial = rotated.map(([u, v]) => [g.clamp(u + x, ...board[0]), g.clamp(v + y, ...board[1])]);
            const cost = residuals(obstacleRecords, [...trial, ...obstacles], undefined, best);
            if (cost >= best) continue;
            best = cost;
            points = trial;
          }
        }
        if (points) rotations.push({ points, cost: best });
      }
      const nearest = rotations.sort((a, b) => a.cost - b.cost).slice(0, 3);
      // Retain room for different templates and favor short placements with shallow contacts.
      for (const { points, cost } of nearest) placements.push({ points, estimate: length + 2 * Math.sqrt(cost) });
    }
    return placements.sort((a, b) => a.estimate - b.estimate).slice(0, 10);
  }

  function anchoredPlacements(level, drawings, records, obstacles, anchors) {
    const placements = [];
    const angles = bandAngles.flatMap((angle) => [angle, angle + Math.PI / 16]);
    for (const drawing of drawings) {
      const orientations = [];
      for (const reflect of [false, true]) {
        for (const angle of angles) {
          const rotated = orientDrawing(drawing, angle, reflect);
          // A single anchor determines translation. For multiple anchors, align
          // their centroids before restoring each individual anchor exactly.
          const shift = board.map((_, axis) => anchors.reduce((sum, i) =>
            sum + level.points[i][axis] - rotated[i][axis], 0) / anchors.length);
          const points = rotated.map((point, i) => level.ownership[i] === -1 ? level.points[i] :
            point.map((value, axis) => g.clamp(value + shift[axis], ...board[axis])));
          const estimate = g.totalLength(level, points) + 2 * Math.sqrt(residuals(records, [...points, ...obstacles]));
          orientations.push({ points, estimate });
        }
      }
      placements.push(...orientations.sort((a, b) => a.estimate - b.estimate).slice(0, 4));
    }
    return placements.sort((a, b) => a.estimate - b.estimate).slice(0, 12);
  }

  function supportsCompact(level) {
    return level.obstacles.length > 0 && level.controls.length > 0 && level.controls.every(({ kind }) => kind === 'free');
  }

  function compact(level, model, state, offer, seeds = []) {
    const { coordinates, part: { records } } = model;
    const obstacles = coordinates.slice(level.points.length);
    const anchors = level.points.flatMap((_, i) => level.ownership[i] === -1 ? [i] : []);
    let best = state && g.positions(level, state);
    let bestLength = best ? g.totalLength(level, best) : Infinity;
    function consider(points) {
      const length = g.totalLength(level, points);
      if (!Number.isFinite(length) || length >= bestLength - 1e-8 || g.evaluate(level, points).count) return false;
      best = points;
      bestLength = length;
      return offer(level.controls.map(({ members: [i] }) => points[i]));
    }
    const spacing = g.clearances(level).nodes;
    const targets = [2.12, 1.52, 1.15, 1.005].map((ratio) =>
      level.edges.map((vertices) => ({ vertices, kind: 'short', distance: spacing * ratio })));

    function shortenToCaps(boardLevel, constraints, circles, points, caps) {
      const moved = improve(boardLevel, [...constraints, ...caps], circles, points, 65);
      const checked = moved.count ? improve(boardLevel, constraints, circles, moved.points, 36) : moved;
      return checked.count ? null : checked.points;
    }

    function trySeed(start) {
      let points = start;
      for (const caps of targets) {
        const checked = shortenToCaps(level, records, obstacles, points, caps);
        if (!checked) continue;
        points = checked;
        if (consider(points)) return true;
      }
      return false;
    }

    if (best && trySeed(best)) return;
    const drawings = globalThis.JiexianDrawing(level.points.length, level.edges);
    const clear = anchors.length ? g.createLevel({ ...level, obstacles: [],
      controls: level.points.map((point, i) => g.free(i, point)) }) : { ...level, obstacles: [] };
    const internal = anchors.length ? globalThis.JiexianSolverGeometry.analyze(clear, { forLength: true }).part.records :
      records.filter(({ vertices }) => vertices.every((i) => i < level.points.length));
    // Pack the graph before placing it among the circles, so an obstacle
    // inside a cycle of the current layout cannot keep that cycle stretched.
    const starts = best ? [best] : [...new Set(seeds)].map((start) => g.positions(level, start));
    const compactFrame = [[240, 660], [90, 450]];
    function packTemplate(points) {
      for (const caps of targets) points = shortenToCaps(clear, internal, [], points, caps) ?? points;
      if (g.evaluate(clear, points).count) return null;
      polishLength(clear, internal, [], points, (shorter) => { points = shorter; });
      return points;
    }
    function tryPlacements(templates) {
      const placements = anchors.length ? anchoredPlacements(level, templates, records, obstacles, anchors) :
        positionTemplates(level, templates, records, obstacles);
      if (!best && placements.some(({ points }) => consider(points))) return true;
      return placements.some(({ points }) => consider(points) || trySeed(points));
    }
    const templates = [...(drawings?.slice(0, 5) ?? []), ...starts];
    const floating = templates.map((drawing) => packTemplate(fitDrawing(drawing, drawingBounds(drawing), compactFrame)))
      .filter(Boolean);
    if (tryPlacements(floating)) return;

    if (!best && !anchors.length) {
      const bands = interiorBands(level);
      const corridor = repairBand(level, drawings, bands, records, obstacles);
      if (corridor && consider(corridor)) return;
      if (!bands.length && level.obstacles.length >= 4) {
        // A longer layout can reach along an outside wall when the interior is crowded.
        const distanceRecords = records.filter(({ kind }) => kind !== 'crossing');
        const alongWall = repairBand(level, drawings, wallFrames(level), records, obstacles, distanceRecords);
        if (alongWall && consider(alongWall)) return;
      }
      // If the first aspect ratio jams, restore clearances before shortening.
      // Preserve the original drawing as one start and try wider and taller fits.
      const frames = [null, [[90, 810], [96, 444]], [compactFrame[0], board[1]], [[170, 730], board[1]]];
      const extraShapes = [...starts, ...(drawings?.slice(0, 2) ?? [])];
      for (const frame of frames) {
        for (const shape of frame ? extraShapes : starts) {
          const placed = frame ? fitDrawing(shape, drawingBounds(shape), frame) : shape;
          const legal = improve(clear, internal, [], placed, 80);
          if (legal.count) continue;
          const points = packTemplate(legal.points);
          if (points && tryPlacements([points])) return;
        }
      }
    }

    if (best && polishLength(level, records, obstacles, best, consider)) return;
    if (anchors.length) return;
    const polished = best;
    const bands = drawings?.length ? boundarySeeds(level, drawings, records, obstacles).slice(0, 10) : [];
    if (bands.some(({ points }) => trySeed(points))) return;
    if (best !== polished) polishLength(level, records, obstacles, best, consider);
  }

  function findCompact(level, ...seeds) {
    if (!supportsCompact(level)) return null;
    const model = globalThis.JiexianSolverGeometry.analyze(level, { forLength: true });
    if (model.unsat) return null;
    let result = null;
    compact(level, model, null, (state) => {
      result = { status: 'solved', state, preserveRepair: true };
      return true;
    }, seeds);
    return result;
  }

  globalThis.JiexianSolverRelaxation = { repair, repairSplit, findCorridor, compact, findCompact, supportsCompact };
})();
