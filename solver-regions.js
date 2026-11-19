(function () {
  'use strict';

  const P = 1n << 20n;
  const min = (a, b) => a < b ? a : b;
  const max = (a, b) => a > b ? a : b;
  const abs = (x) => x < 0n ? -x : x;
  const floor = (n, d) => n / d - (n % d < 0n ? 1n : 0n);
  const ceil = (n, d) => -floor(-n, d);
  const square = (x) => x * x;
  const vector = (a, b) => a.map((x, i) => x - b[i]);
  const dot = ([x, y], [u, v]) => x * u + y * v;
  const cross = ([x, y], [u, v]) => x * v - y * u;
  const norm = (v) => dot(v, v);
  const turn = (a, b, c) => cross(vector(b, a), vector(c, a));
  const pointBox = (point) => point.map((x) => [x, x]);
  const corners = ([[a, b], [c, d]]) => (a === b ? [a] : [a, b]).flatMap((x) =>
    (c === d ? [c] : [c, d]).map((y) => [x, y]));
  const minus = ([a, b], [c, d]) => [a - d, b - c];
  const negate = ([a, b]) => [-b, -a];
  const multiply = ([a, b], [c, d]) => {
    const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
    return [min(min(ac, ad), min(bc, bd)), max(max(ac, ad), max(bc, bd))];
  };
  const scaled = (a, range) => a < 0n ? [a * range[1], a * range[0]] : range.map((x) => a * x);
  const summation = ([a, b], [c, d]) => [a + c, b + d];
  const squared = ([a, b]) => a <= 0n && b >= 0n ? [0n, max(square(a), square(b))] :
    [min(square(a), square(b)), max(square(a), square(b))];
  const distanceRange = (a, b) => summation(...a.map((range, i) => squared(minus(range, b[i]))));

  function segmentNear(p, a, b, limit) {
    const ab = vector(b, a), ap = vector(p, a);
    const h = dot(ap, ab);
    if (h <= 0n) return norm(ap) < limit;
    const length = norm(ab);
    if (h >= length) return norm(vector(p, b)) < limit;
    return square(cross(ab, ap)) < limit * length;
  }

  function segmentClear(p, a, b, limit) {
    // (1-t)A + tB - P fills the convex hull of the two difference boxes.
    const vertices = [a, b].flatMap((box) => corners(box.map((range, i) => minus(range, p[i]))));
    vertices.sort(([x, y], [u, v]) => x < u || x === u && y < v ? -1 : x === u && y === v ? 0 : 1);
    const chain = (points) => {
      const chain = [];
      for (const point of points) {
        while (chain.length >= 2 && turn(chain.at(-2), chain.at(-1), point) <= 0n) chain.pop();
        chain.push(point);
      }
      return chain.slice(0, -1);
    };
    const hull = [...chain(vertices), ...chain(vertices.reverse())];
    const origin = [0n, 0n];
    if (hull.length > 2 && hull.every((a, i) => turn(a, hull[(i + 1) % hull.length], origin) >= 0n)) return false;
    return hull.every((a, i) => !segmentNear(origin, a, hull[(i + 1) % hull.length], limit));
  }

  function orientation(a, b, c) {
    const [x, y] = b.map((range, i) => minus(range, a[i]));
    const [u, v] = c.map((range, i) => minus(range, a[i]));
    return minus(multiply(x, v), multiply(y, u));
  }

  function side(a, b, c, d) {
    const [x, y] = orientation(a, b, c), [u, v] = orientation(a, b, d);
    if (x >= 0n && u >= 0n || y <= 0n && v <= 0n) return 1;
    if (x > 0n && v < 0n || u > 0n && y < 0n) return -1;
    return 0;
  }

  function classify(record, boxAt) {
    const [a, b, p, q] = record.vertices.map(boxAt);
    const { kind, limit, midpoint } = record;
    if (kind === 'distance') {
      const [lo, hi] = distanceRange(a, b);
      return lo >= limit ? 1 : hi < limit ? -1 : 0;
    }
    if (kind === 'crossing') {
      const left = side(a, b, p, q), right = side(p, q, a, b);
      return left === 1 || right === 1 ? 1 : left === -1 && right === -1 ? -1 : 0;
    }
    const hullBox = a.map(([lo, hi], i) => [min(lo, b[i][0]), max(hi, b[i][1])]);
    if (distanceRange(hullBox, p)[0] >= limit) return 1;
    // A reflection pair has the same segment midpoint in every permitted state.
    if (midpoint && distanceRange(p.map((range) => scaled(2n, range)), pointBox(midpoint))[1] < 4n * limit) return -1;
    // Obstruction is separately convex in A, B and P, so all corner triples certify failure.
    const first = corners(a), second = corners(b), tests = corners(p);
    if (tests.every((point) => first.every((u) => second.every((v) => segmentNear(point, u, v, limit))))) return -1;
    return segmentClear(p, a, b, limit) ? 1 : 0;
  }

  function rotations({ ranges: [[lo, hi]], chart }) {
    const cosine = (t) => (square(P) - square(t)) * P;
    const sine = (t) => 2n * square(P) * t;
    const denom = (t) => square(P) + square(t);
    const c = [floor(cosine(hi), denom(hi)), ceil(cosine(lo), denom(lo))];
    const s = [floor(sine(lo), denom(lo)), ceil(sine(hi), denom(hi))];
    return [[c, s], [negate(s), c], [negate(c), negate(s)], [s, negate(c)]][chart];
  }

  function factory(control, boxes, points, units, rail) {
    const [node, other] = control.members;
    if (control.kind === 'rotor') {
      const center = control.center.map(units);
      const offsets = control.members.map((id) => vector(points[id], center));
      return {
        roots: [0, 1, 2, 3].map((chart) => ({ chart, ranges: [[0n, P]] })),
        scale: P,
        speed: 4n * offsets.flat().map(abs).reduce(max),
        bounds: rotations,
        positions(cell) {
          const [c, s] = rotations(cell);
          return offsets.map(([x, y]) => [minus(scaled(x, c), scaled(y, s)), summation(scaled(x, s), scaled(y, c))]
            .map((range, axis) => [center[axis] + floor(range[0], P), center[axis] + ceil(range[1], P)]));
        },
        value([t], chart) {
          return [Math.atan2(Number(2n * P * t), Number(square(P) - square(t))) + chart * Math.PI / 2];
        },
      };
    }
    if (control.kind === 'rail') {
      const [[lo, d], [hi, e]] = rail;
      const a = control.a.map(units), delta = vector(control.b.map(units), a);
      return {
        roots: [{ ranges: [[floor(lo * P, d), ceil(hi * P, e)]] }],
        scale: P,
        speed: abs(delta[0]) + abs(delta[1]),
        bounds: ({ ranges }) => ranges,
        positions({ ranges: [t] }) {
          return [delta.map((value, i) => {
            const [lo, hi] = scaled(value, t);
            return [a[i] + floor(lo, P), a[i] + ceil(hi, P)];
          })];
        },
        allows({ ranges: [[t]] }) { return t * d >= lo * P && t * e <= hi * P; },
        value([t]) { return [Number(t) / Number(P)]; },
      };
    }
    const partner = other === undefined ? null : control.sum.map(units);
    const scale = units(1);
    const places = String(scale).length - 1;
    return {
      roots: [{ ranges: boxes[node] }],
      scale,
      speed: P,
      bounds: ({ ranges }) => ranges,
      positions({ ranges }) {
        return partner ? [ranges, ranges.map(([lo, hi], i) => [partner[i] - hi, partner[i] - lo])] : [ranges];
      },
      value(coordinates) { return coordinates.map((coordinate) => Number(`${coordinate}e-${places}`)); },
    };
  }

  function inspect(records, index, models, cells, owners, boxes, members) {
    const moved = models.map((model, i) => model.positions(cells[i]));
    const boxAt = (node) => index.has(owners[node]) ? moved[index.get(owners[node])][members[node]] : boxes[node];
    let undecided = null;
    for (const record of records) {
      const result = classify(record, boxAt);
      if (result < 0) return { result, record };
      if (!result && !undecided) undecided = record;
    }
    return { result: undecided ? 0 : 1, record: undecided };
  }

  const center = ([lo, hi]) => floor(lo + hi, 2n);
  const middle = (cell) => ({ ...cell, ranges: cell.ranges.map((range) => [center(range), center(range)]) });

  function split(models, cells, allowed) {
    let choice = null;
    for (const i of allowed) {
      cells[i].ranges.forEach(([lo, hi], dim) => {
        if (hi - lo <= 1n) return;
        const width = models[i].speed * (hi - lo);
        if (!choice || width > choice.width) choice = { i, dim, width };
      });
    }
    if (!choice) return null;
    const { i, dim } = choice;
    const range = cells[i].ranges[dim];
    const t = center(range);
    return [[range[0], t], [t, range[1]]].map((half) => cells.map((cell, j) => j === i ?
      { ...cell, ranges: cell.ranges.map((range, k) => k === dim ? half : range) } : cell));
  }

  function cover(models, root, classifyCells, relevant, limit, sample) {
    const pending = [root];
    const rest = [];
    let removed = false;
    while (pending.length && limit-- > 0) {
      const cells = pending.pop();
      const { result, record } = classifyCells(cells);
      if (result < 0) {
        removed = true;
        continue;
      }
      let focus = record;
      if (sample) {
        const candidate = cells.map(middle);
        if (models.every((model, i) => !model.allows || model.allows(candidate[i]))) {
          const point = result > 0 ? { result } : classifyCells(candidate);
          if (point.result > 0) return { candidate };
          if (point.result < 0) focus = point.record;
        }
      }
      const children = result === 0 ? split(models, cells, relevant(focus)) ??
        (focus === record ? null : split(models, cells, relevant(record))) : null;
      if (children) pending.push(...children);
      else rest.push(cells);
    }
    return { remaining: [...rest, ...pending], removed };
  }

  function jointRoots(domains) {
    return domains.reduce((choices, domain) => choices.flatMap((cells) => domain.map((cell) => [...cells, cell])), [[]]);
  }

  function mergeCells(cells) {
    let merged = cells;
    for (let axis = 0; axis < cells[0].ranges.length; axis++) {
      const strips = new Map();
      for (const cell of merged) {
        const key = `${cell.chart}:${cell.ranges.filter((_, i) => i !== axis).join('/')}`;
        if (!strips.has(key)) strips.set(key, []);
        strips.get(key).push(cell);
      }
      merged = [];
      for (const strip of strips.values()) {
        strip.sort((a, b) => a.ranges[axis][0] < b.ranges[axis][0] ? -1 : a.ranges[axis][0] > b.ranges[axis][0] ? 1 : 0);
        let current = strip[0];
        for (const cell of strip.slice(1)) {
          const [lo, hi] = cell.ranges[axis];
          const [start, end] = current.ranges[axis];
          if (lo <= end) {
            current = { ...current, ranges: current.ranges.map((range, i) => i === axis ? [start, max(end, hi)] : range) };
          } else {
            merged.push(current);
            current = cell;
          }
        }
        merged.push(current);
      }
    }
    return merged;
  }

  function tighten(level, parts, boxes, points, owners, units, railBounds) {
    if (!parts.length || !level.obstacles.length && !level.controls.some(({ kind }) => kind === 'mirror' || kind === 'rotor')) {
      return { parts, packed: new Map(), retry: [] };
    }
    const members = [];
    level.controls.forEach(({ members: nodes }) => nodes.forEach((node, i) => { members[node] = i; }));
    const packed = new Map(), pending = [], retry = [];
    const save = (part, models, candidate) => {
      candidate.forEach((cell, i) => packed.set(part.controls[i], models[i].value(cell.ranges.map(center), cell.chart)));
      retry.push(part);
    };
    const decorate = (record) => {
      const owner = owners[record.vertices[0]];
      const control = level.controls[owner];
      const midpoint = record.kind === 'segment' && control?.kind === 'mirror' && owners[record.vertices[1]] === owner ?
        control.sum.map(units) : null;
      const limit = record.distance === undefined ? 0n : square(units(record.distance));
      return { ...record, midpoint, limit };
    };
    const assess = (records, controls, models) => {
      const index = new Map(controls.map((id, i) => [id, i]));
      return (cells) => inspect(records, index, models, cells, owners, boxes, members);
    };
    function joint(records, controls, models, leaves, budget) {
      const options = leaves.reduce((n, options) => n * options.length, 1) <= 48 ? leaves : models.map(({ roots }) => roots);
      const first = jointRoots(options);
      const classify = assess(records, controls, models);
      const index = new Map(controls.map((id, i) => [id, i]));
      let undecided = false;
      for (const root of first) {
        const branch = cover(models, root, classify, ({ support }) => support.map((id) => index.get(id)),
          Math.max(1, Math.floor(budget / first.length)), true);
        if (branch.candidate) return { candidate: branch.candidate };
        undecided ||= branch.remaining.length > 0;
      }
      return { unsat: !undecided };
    }
    for (const part of parts) {
      const hasObstacle = part.records.some(({ vertices }) => vertices.some((node) => node >= level.points.length));
      const interesting = part.controls.some((i) => level.controls[i].kind !== 'rail' &&
        (hasObstacle || level.controls[i].kind !== 'free'));
      if (!interesting) { pending.push(part); continue; }
      const records = part.records.map(decorate);
      const models = part.controls.map((i) => factory(level.controls[i], boxes, points, units, railBounds[i]));
      const leaves = [], cuts = new Map(), contracted = new Set();
      let candidate;
      for (const [i, model] of models.entries()) {
        const id = part.controls[i];
        const unary = records.filter(({ support }) => support.length === 1 && support[0] === id);
        if (!unary.length) {
          leaves.push(model.roots);
          continue;
        }
        const classify = assess(unary, [id], [model]);
        const remaining = [];
        let removed = false;
        const single = part.controls.length === 1;
        for (const root of model.roots) {
          const branch = cover([model], [root], classify, () => [0], single ? 160 : 32, single);
          if (branch.candidate) { candidate = branch.candidate; break; }
          remaining.push(...branch.remaining.map(([cell]) => cell));
          removed ||= branch.removed;
        }
        if (candidate) break;
        if (!remaining.length) return null;
        const merged = mergeCells(remaining);
        leaves.push(merged);
        if (removed) contracted.add(id);
        // Limit the number of alternatives given to the algebraic solver.
        if (removed && merged.length <= 12) {
          cuts.set(id, { scale: model.scale, boxes: merged.map(model.bounds) });
        }
      }
      if (candidate) {
        save(part, models, candidate);
        continue;
      }
      if (part.controls.length >= 2 && part.controls.length <= 3) {
        const result = joint(records, part.controls, models, leaves, 640);
        if (result.unsat) return null;
        if (result.candidate) {
          save(part, models, result.candidate);
          continue;
        }
      } else if (contracted.size >= 2) {
        // Any solution of the full component must extend a solution of each selected two-control subproblem.
        const checked = new Set();
        for (const { support } of records) {
          if (support.length !== 2 || !support.every((id) => contracted.has(id))) continue;
          const [a, b] = support;
          const key = `${min(a, b)}:${max(a, b)}`;
          if (checked.has(key)) continue;
          checked.add(key);
          const pair = records.filter(({ support }) => support.every((id) => id === a || id === b));
          const indices = support.map((id) => part.controls.indexOf(id));
          if (joint(pair, support, indices.map((i) => models[i]), indices.map((i) => leaves[i]), 240).unsat) return null;
          if (checked.size >= 4) break;
        }
      }
      pending.push(cuts.size ? { ...part, cuts } : part);
    }
    return { parts: pending, packed, retry };
  }

  globalThis.JiexianSolverRegions = { tighten };
})();
