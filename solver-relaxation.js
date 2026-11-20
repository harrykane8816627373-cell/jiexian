(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const difference = ([x, y], [u, v]) => [x - u, y - v];
  const dot = ([x, y], [u, v]) => x * u + y * v;
  const board = [[g.margin, g.width - g.margin], [g.margin, g.height - g.margin]];
  const angles = [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6, Math.PI / 2];

  function direction(a, b) {
    const delta = difference(a, b);
    const length = Math.hypot(...delta);
    return { length, unit: length ? delta.map((x) => x / length) : [1, 0] };
  }

  function side(a, b, p, q, vertices) {
    const { length, unit: along } = direction(b, a);
    const normal = [-along[1], along[0]];
    const ap = difference(p, a), aq = difference(q, a);
    const left = dot(ap, normal), right = dot(aq, normal);
    const sign = Math.min(left, right) >= -Math.max(left, right) ? 1 : -1;
    const first = sign * left <= sign * right;
    const t = length ? dot(first ? ap : aq, along) / length : .5;
    const [i, j, k, l] = vertices;
    return { gap: sign * (first ? left : right), normal: normal.map((value) => sign * value),
      terms: [[i, t - 1], [j, -t], [first ? k : l, 1]] };
  }

  function residuals(records, points, add) {
    let cost = 0;
    const retain = (deficit, normal, terms) => {
      if (deficit <= 0) return;
      cost += deficit * deficit;
      add?.(deficit, normal, terms);
    };
    for (const { kind, vertices: [i, j, k, l], distance } of records) {
      const a = points[i], b = points[j];
      if (kind === 'distance') {
        const { length, unit } = direction(a, b);
        retain(distance + .15 - length, unit, [[i, 1], [j, -1]]);
      } else if (kind === 'segment') {
        const p = points[k], ab = difference(b, a);
        const squared = dot(ab, ab);
        const t = squared ? g.clamp(dot(difference(p, a), ab) / squared, 0, 1) : 0;
        const { length, unit } = direction(p, g.interpolate(a, b, t));
        retain(distance + .15 - length, unit, [[i, t - 1], [j, -t], [k, 1]]);
      } else {
        const c = points[k], d = points[l];
        const first = side(a, b, c, d, [i, j, k, l]);
        const second = side(c, d, a, b, [k, l, i, j]);
        const { gap, normal, terms } = first.gap >= second.gap ? first : second;
        retain(.08 - gap, normal, terms);
      }
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

  function dampedStep(rows, frozen, damping) {
    const n = frozen.length;
    const active = rows.map(({ deficit, terms }) => ({ deficit, terms: terms.filter(([i]) => !frozen[i]) }))
      .filter(({ terms }) => terms.length);
    if (active.length < n) {
      // (JᵀJ + λI)⁻¹Jᵀ = Jᵀ(JJᵀ + λI)⁻¹. Factor in the smaller space.
      const gram = active.map(({ terms }, i) => Float64Array.from({ length: i + 1 }, (_, j) =>
        rowProduct(terms, active[j].terms)));
      const multipliers = solvePositiveDefinite(gram, Float64Array.from(active, ({ deficit }) => deficit), damping);
      const delta = new Float64Array(n);
      active.forEach(({ terms }, row) => {
        for (const [i, value] of terms) delta[i] += value * multipliers[row];
      });
      return delta;
    }
    const matrix = Array.from({ length: n }, (_, i) => new Float64Array(i + 1));
    const right = new Float64Array(n);
    for (const { deficit, terms } of active) {
      for (const [i, a] of terms) {
        right[i] += a * deficit;
        for (const [j, b] of terms) {
          if (j > i) break;
          matrix[i][j] += a * b;
        }
      }
    }
    return solvePositiveDefinite(matrix, right, damping);
  }

  function improve(level, records, obstacles, start) {
    const count = start.length, n = count * 2;
    let points = [...start, ...obstacles];
    let damping = .2;
    for (let i = 0; i < 110; i++) {
      const rows = [];
      const cost = residuals(records, points, (deficit, normal, terms) => {
        const row = terms.filter(([node]) => node < count).sort(([a], [b]) => a - b)
          .flatMap(([node, factor]) => normal.map((component, axis) => [node * 2 + axis, factor * component]));
        rows.push({ deficit, terms: row });
      });
      if (cost < 1 && !g.evaluate(level, points.slice(0, count)).count) return points.slice(0, count);
      // Freeze directions pointing out of the board at its boundary.
      const frozen = new Uint8Array(n);
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
      const trial = [...points.slice(0, count).map((point, i) => point.map((value, axis) =>
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
    return g.evaluate(level, candidate).count ? null : candidate;
  }

  function seed(drawing, angle, reverse) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotated = drawing.map(([x, y]) => [x * c - y * s, x * s + y * c]);
    const bounds = board.map(([lo, hi], axis) => {
      const width = hi - lo;
      const [start, end] = axis ? [.445, .995] : [.04, .91];
      return reverse ? [hi - width * end, hi - width * start] : [lo + width * start, lo + width * end];
    });
    const normalized = bounds.map((_, axis) => {
      const values = rotated.map((point) => point[axis]);
      return [Math.min(...values), Math.max(...values)];
    });
    return rotated.map((point) => point.map((value, axis) => {
      const [a, b] = normalized[axis], [lo, hi] = bounds[axis];
      return a === b ? (lo + hi) / 2 : lo + (hi - lo) * (value - a) / (b - a);
    }));
  }

  function repair(level, problem) {
    if (level.controls.length !== level.points.length || level.controls.some(({ kind }) => kind !== 'free')) return null;
    const drawings = globalThis.JiexianDrawing(level.points.length, level.edges);
    if (!drawings?.length) return null;
    const records = [...problem.parts, ...problem.retryParts].flatMap(({ records }) => records);
    const obstacles = problem.coordinates.slice(level.points.length);
    const seeds = angles.flatMap((angle) => drawings.slice(0, 8).flatMap((drawing) =>
      [false, true].map((reverse) => seed(drawing, angle, reverse))));
    const ranked = seeds.map((points) => ({ points, cost: residuals(records, [...points, ...obstacles]) }))
      .sort((a, b) => a.cost - b.cost);
    for (const { points: start } of ranked.slice(0, 20)) {
      const points = improve(level, records, obstacles, start);
      if (points) return { status: 'solved', state: level.controls.map(({ members: [i] }) => points[i]) };
    }
    return null;
  }

  globalThis.JiexianSolverRelaxation = { repair };
})();
