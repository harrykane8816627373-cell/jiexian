(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const tolerance = .1;
  const score = (level, state) => g.totalLength(level, g.positions(level, state));

  function result(level, state, length, lower) {
    const upper = globalThis.JiexianSolverGeometry.lengthUpperBound(level, g.positions(level, state));
    return { status: upper >= lower && upper - lower <= tolerance ? 'length-proven' : 'length-best',
      state, length, lower, upper };
  }

  function contraction(level, state) {
    if (level.obstacles.length || state.length !== level.points.length ||
        level.controls.some(({ kind }) => kind !== 'free')) return state;
    const center = state.reduce(([x, y], [u, v]) => [x + u / state.length, y + v / state.length], [0, 0]);
    // A positive homothety preserves crossings and scales all other clearances.
    let lo = 0, hi = 1, best = state;
    for (let i = 0; i < 20; i++) {
      const scale = (lo + hi) / 2;
      const trial = state.map((point) => g.interpolate(center, point, scale));
      if (g.evaluate(level, g.positions(level, trial)).count) lo = scale;
      else {
        hi = scale;
        best = trial;
      }
    }
    return best;
  }

  function directions(level, points) {
    const forces = points.map(() => [0, 0]);
    for (const [a, b] of level.edges) {
      const [x, y] = points[b].map((value, axis) => value - points[a][axis]);
      const length = Math.hypot(x, y);
      if (!length) continue;
      forces[a][0] += x / length;
      forces[a][1] += y / length;
      forces[b][0] -= x / length;
      forces[b][1] -= y / length;
    }
    return level.controls.map(({ kind, members: [a, b], members, center, a: start, b: end }) => {
      const [x, y] = forces[a];
      if (kind === 'rail') {
        const [dx, dy] = end.map((value, i) => value - start[i]);
        const length = Math.hypot(dx, dy);
        return [length ? Math.sign(x * dx + y * dy) / length : 0];
      }
      if (kind === 'rotor') {
        const torque = members.reduce((sum, i) =>
          sum + (points[i][0] - center[0]) * forces[i][1] - (points[i][1] - center[1]) * forces[i][0], 0);
        return [Math.sign(torque) / 94];
      }
      const direction = kind === 'mirror' ? [x - forces[b][0], y - forces[b][1]] : [x, y];
      const length = Math.hypot(...direction);
      return length ? direction.map((value) => value / length) : direction;
    });
  }

  function shorten(level, initial, lower) {
    let state = contraction(level, initial), points = g.positions(level, state), length = g.totalLength(level, points);
    function tryState(trial) {
      const placed = g.positions(level, trial), cost = g.totalLength(level, placed);
      if (cost >= length - 1e-8 || g.evaluate(level, placed).count) return false;
      state = trial;
      points = placed;
      length = cost;
      return true;
    }
    for (const step of [96, 48, 24, 12, 6, 3, 1, .25, .06, .015]) {
      for (let pass = 0; pass < 3; pass++) {
        if (length - lower < tolerance - 1e-6) {
          const current = result(level, state, length, lower);
          if (current.status === 'length-proven') return current;
        }
        const deltas = directions(level, points);
        const shifted = (i, delta) => g.normalize(level.controls[i],
          state[i].map((value, axis) => value + step * delta[axis]));
        if (tryState(deltas.map((delta, i) => shifted(i, delta)))) continue;
        let advanced = false;
        for (const [i, delta] of deltas.entries()) {
          const [x, y] = delta;
          const proposals = y === undefined ? [delta] : [delta, [(x - y) * Math.SQRT1_2, (y + x) * Math.SQRT1_2],
            [(x + y) * Math.SQRT1_2, (y - x) * Math.SQRT1_2]];
          for (const direction of proposals) {
            const trial = state.slice();
            trial[i] = shifted(i, direction);
            if (tryState(trial)) {
              advanced = true;
              break;
            }
          }
        }
        if (!advanced) break;
      }
    }
    return result(level, state, length, lower);
  }

  function start(level, candidates, progress) {
    const lower = globalThis.JiexianSolverGeometry.lengthLowerBound(level);
    let best;
    for (const state of candidates) {
      if (!state || g.evaluate(level, g.positions(level, state)).count) continue;
      const length = score(level, state);
      if (!best || length < best.length) best = result(level, state, length, lower);
    }
    if (!best || best.status === 'length-proven') return best;
    progress?.(best);
    return shorten(level, best.state, lower);
  }

  function certify(level, best, ask, progress) {
    if (best.status === 'length-proven') return best;
    const { prepareLength, solveLengthBound } = globalThis.JiexianExact;
    const model = prepareLength(level);
    if (model.unsat) return best;
    let ceiling = best.upper;
    for (let attempt = 0; attempt < 8 && best.status !== 'length-proven'; attempt++) {
      if (ceiling - best.lower <= tolerance) break;
      const midpoint = (best.lower + ceiling) / 2;
      const target = attempt === 0 && level.controls.length <= 6 ? Math.max(midpoint, best.upper - .09) : midpoint;
      const middle = Math.floor(target * 1e6) / 1e6;
      const probe = solveLengthBound(level, ask, model, middle);
      if (probe.status === 'unsat') {
        best = result(level, best.state, best.length, middle);
      } else if (probe.status === 'sat' && score(level, probe.state) < best.length - 1e-7) {
        best = shorten(level, probe.state, best.lower);
        ceiling = best.upper;
      } else {
        // An inconclusive probe never strengthens the lower bound.
        ceiling = middle;
      }
      progress?.(best);
    }
    return best;
  }

  globalThis.JiexianSolverLength = { start, certify };
})();
