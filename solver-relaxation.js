(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const difference = ([x, y], [u, v]) => [x - u, y - v];
  const dot = ([x, y], [u, v]) => x * u + y * v;
  const board = [[g.margin, g.width - g.margin], [g.margin, g.height - g.margin]];

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

  function dampedStep(matrix, right, damping) {
    const n = right.length;
    const lower = matrix.map((row) => row.slice());
    const answer = right.slice();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let value = lower[i][j] + (i === j ? damping : 0);
        for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
        lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j];
      }
      for (let j = 0; j < i; j++) answer[i] -= lower[i][j] * answer[j];
      answer[i] /= lower[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) answer[i] -= lower[j][i] * answer[j];
      answer[i] /= lower[i][i];
    }
    return answer;
  }

  function improve(level, records, obstacles, start) {
    const count = start.length, n = count * 2;
    let points = [...start, ...obstacles];
    let damping = .2;
    for (let i = 0; i < 110; i++) {
      const matrix = Array.from({ length: n }, () => new Float64Array(n));
      const right = new Float64Array(n);
      const cost = residuals(records, points, (deficit, normal, terms) => {
        const row = terms.filter(([node]) => node < count).flatMap(([node, factor]) =>
          normal.map((component, axis) => [node * 2 + axis, factor * component]));
        for (const [j, a] of row) {
          right[j] += a * deficit;
          for (const [k, b] of row) matrix[j][k] += a * b;
        }
      });
      if (cost < 1 && !g.evaluate(level, points.slice(0, count)).count) return points.slice(0, count);
      // Freeze directions pointing out of the board at its boundary.
      function freeze(index) {
        for (let j = 0; j < n; j++) matrix[index][j] = matrix[j][index] = 0;
        right[index] = 0;
      }
      let delta = dampedStep(matrix, right, damping);
      for (let pass = 0; pass < 3; pass++) {
        let blocked = false;
        for (let j = 0; j < n; j++) {
          const axis = j % 2, value = points[Math.floor(j / 2)][axis];
          const [lo, hi] = board[axis];
          if (delta[j] < -1e-10 && value === lo || delta[j] > 1e-10 && value === hi) {
            freeze(j);
            blocked = true;
          }
        }
        if (!blocked) break;
        delta = dampedStep(matrix, right, damping);
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

  function seed(drawing, reverse) {
    const bounds = board.map(([lo, hi], axis) => {
      const width = hi - lo;
      const [start, end] = axis ? [.445, .995] : [.04, .91];
      return reverse ? [hi - width * end, hi - width * start] : [lo + width * start, lo + width * end];
    });
    const normalized = bounds.map((_, axis) => {
      const values = drawing.map((point) => point[axis]);
      return [Math.min(...values), Math.max(...values)];
    });
    return drawing.map((point) => point.map((value, axis) => {
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
    for (const drawing of drawings.slice(0, 3)) {
      for (const reverse of [false, true]) {
        const points = improve(level, records, obstacles, seed(drawing, reverse));
        if (points) return { status: 'solved', state: level.controls.map(({ members: [i] }) => points[i]) };
      }
    }
    return null;
  }

  globalThis.JiexianSolverRelaxation = { repair };
})();
