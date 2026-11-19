(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const board = [[g.margin, g.width - g.margin], [g.margin, g.height - g.margin]];
  const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];
  const center = ([lo, hi]) => (lo + hi) / 2;
  const length = ([lo, hi]) => hi - lo;

  // Only the interior of a forbidden interval is blocked. Its endpoints can be tangent.
  function gaps([lo, hi], blocked) {
    blocked.sort((a, b) => a[0] - b[0]);
    const free = [];
    let cursor = lo;
    for (const [a, b] of blocked) {
      if (b <= cursor) continue;
      if (a >= hi) break;
      if (a >= cursor) free.push([cursor, a]);
      cursor = b;
      if (cursor > hi) return free;
    }
    if (cursor <= hi) free.push([cursor, hi]);
    return free;
  }

  function emptyRectangles(obstacles, spacing, obstacleGap) {
    // Each expanded node exclusion disk lies inside an open axis-aligned box.
    const blocked = obstacles.map(({ center, r }) => {
      const reach = r + spacing + obstacleGap;
      return center.map((coordinate) => [coordinate - reach, coordinate + reach]);
    });
    const [left, right] = board[0];
    const xs = [...new Set([left, right, ...blocked.flatMap(([bounds]) =>
      bounds.filter((x) => left < x && x < right))])].sort((a, b) => a - b);
    const rectangles = [];
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const xRange = [xs[i], xs[j]];
        const intervals = blocked.filter(([[lo, hi]]) => lo < xRange[1] && hi > xRange[0]).map(([, y]) => y);
        for (const yRange of gaps(board[1], intervals)) {
          if (length(yRange) > 0) rectangles.push([xRange, yRange]);
        }
      }
    }
    rectangles.sort((a, b) => length(b[0]) - length(a[0]) || length(b[1]) - length(a[1]));
    let tallest = 0;
    const frontier = rectangles.filter(([, yRange]) => {
      if (length(yRange) <= tallest) return false;
      tallest = length(yRange);
      return true;
    });
    const area = ([x, y]) => length(x) * length(y);
    return frontier.sort((a, b) => area(b) - area(a));
  }

  function drawingBounds(points) {
    return [0, 1].map((axis) => {
      const values = points.map((p) => p[axis]);
      return [Math.min(...values), Math.max(...values)];
    });
  }

  function rotate(drawing, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return drawing.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  }

  function fitRectangle({ points, bounds }, rectangle) {
    return points.map((point) => point.map((value, axis) => {
      const [from, to] = bounds[axis];
      const [lo, hi] = rectangle[axis];
      return from === to ? center(rectangle[axis]) : lo + (value - from) * (hi - lo) / (to - from);
    }));
  }

  function minimumScale(points, edges, clearance) {
    let scale = 0;
    points.forEach((point, i) => {
      for (let j = 0; j < i; j++) scale = Math.max(scale, clearance.nodes / g.distance(point, points[j]));
      for (const [a, b] of edges) {
        if (i !== a && i !== b) scale = Math.max(scale, clearance.nodeEdge / g.distanceToSegment(point, points[a], points[b]));
      }
    });
    return scale;
  }

  function diskSlice([cx, cy], r, x) {
    const offset = Math.abs(x - cx);
    if (offset >= r) return null;
    const width = Math.sqrt((r - offset) * (r + offset));
    return [cy - width, cy + width];
  }

  function stripSlice([x, y], [dx, dy], lenSquared, r, slice) {
    const u = slice - x;
    const projection = dx * u;
    const cross = -dy * u;
    const reach = r * Math.sqrt(lenSquared);
    if ((!dy && (projection < 0 || projection > lenSquared)) || (!dx && Math.abs(cross) >= reach)) return null;
    const along = dy ? [-projection / dy, (lenSquared - projection) / dy] : [-Infinity, Infinity];
    const across = dx ? [(-reach - cross) / dx, (reach - cross) / dx] : [-Infinity, Infinity];
    const lo = Math.max(Math.min(...along), Math.min(...across));
    const hi = Math.min(Math.max(...along), Math.max(...across));
    return lo < hi ? [y + lo, y + hi] : null;
  }

  function capsuleSlice({ a, b, delta, lenSquared, radius, xRange }, x) {
    if (x <= xRange[0] || x >= xRange[1]) return null;
    const first = diskSlice(a, radius, x);
    if (!lenSquared) return first;
    const second = diskSlice(b, radius, x);
    const strip = stripSlice(a, delta, lenSquared, radius, x);
    const intervals = [first, second, strip].filter(Boolean);
    if (!intervals.length) return null;
    // A capsule is convex, so its intersection with the line is a single open interval.
    return [Math.min(...intervals.map(([lo]) => lo)), Math.max(...intervals.map(([, hi]) => hi))];
  }

  function translationShapes(points, puzzle, clearance, axis) {
    const shapes = [];
    for (const { center, r } of puzzle.obstacles) {
      const shifted = points.map((point) => [axis, 1 - axis].map((i) => center[i] - point[i]));
      function add(a, b, radius) {
        const delta = [b[0] - a[0], b[1] - a[1]];
        const xRange = [Math.min(a[0], b[0]) - radius, Math.max(a[0], b[0]) + radius];
        shapes.push({ a, b, delta, lenSquared: delta[0] ** 2 + delta[1] ** 2, radius, xRange });
      }
      for (const point of shifted) add(point, point, r + clearance.spacing + clearance.obstacleGap);
      for (const [a, b] of puzzle.edges) add(shifted[a], shifted[b], r + clearance.obstacleGap);
    }
    return shapes;
  }

  function slices([lo, hi], shapes) {
    const events = [...new Set([lo, hi, ...shapes.flatMap(({ xRange }) => xRange.filter((x) => lo < x && x < hi))])]
      .sort((a, b) => a - b);
    const spans = events.slice(1).map((x, i) => [events[i], x]).sort((a, b) => length(b) - length(a));
    const samples = [g.clamp(0, lo, hi), center([lo, hi]), lo, hi, .75 * lo + .25 * hi, .25 * lo + .75 * hi];
    for (const span of spans.slice(0, 8)) samples.push(center(span), ...span);
    return [...new Set(samples)].slice(0, 22);
  }

  function placeTranslation(points, puzzle, clearance, verify) {
    const bounds = drawingBounds(points);
    const domain = board.map(([lo, hi], i) => [lo - bounds[i][0], hi - bounds[i][1]]);
    if (domain.some((range) => length(range) < 0)) return null;
    const axes = length(domain[0]) >= length(domain[1]) ? [0, 1] : [1, 0];
    for (const axis of axes) {
      const shapes = translationShapes(points, puzzle, clearance, axis);
      for (const x of slices(domain[axis], shapes)) {
        const intervals = shapes.map((shape) => capsuleSlice(shape, x)).filter(Boolean);
        const free = gaps(domain[1 - axis], intervals).sort((a, b) => length(b) - length(a));
        for (const gap of free.slice(0, 3)) {
          for (const y of new Set([g.clamp(0, ...gap), center(gap), ...gap])) {
            const shift = axis === 0 ? [x, y] : [y, x];
            const state = verify(points.map((point) => point.map((coordinate, i) => coordinate + shift[i])));
            if (state) return state;
          }
        }
      }
    }
    return null;
  }

  function solve(puzzle, current) {
    const clearance = g.clearances(puzzle);
    const geometry = { ...puzzle, obstacles: [] };
    const verify = (points) => {
      const state = puzzle.controls.map((control) => g.normalize(control, points[control.members[0]]));
      return g.evaluate(puzzle, g.positions(puzzle, state)).count ? null : state;
    };
    const initial = g.positions(puzzle, current);
    // Moving a valid planar layout together preserves every internal distance and edge crossing test.
    if (!g.evaluate(geometry, initial).count) {
      const result = verify(initial) ?? placeTranslation(initial, puzzle, clearance, verify);
      if (result) return result;
    }

    const drawings = globalThis.JiexianDrawing(puzzle.points.length, puzzle.edges);
    if (!drawings?.length) return null;
    const templates = drawings.slice(0, 8).map((drawing) => ({
      drawing,
      orientations: angles.map((angle) => {
        const points = rotate(drawing, angle);
        return { points, bounds: drawingBounds(points) };
      }),
    }));
    const rectangles = emptyRectangles(puzzle.obstacles, clearance.spacing, clearance.obstacleGap);
    let rectangleChecks = 0;
    for (const rectangle of rectangles) {
      for (const { orientations } of templates) {
        for (const orientation of orientations) {
          if (rectangleChecks++ >= 240) break;
          const result = verify(fitRectangle(orientation, rectangle));
          if (result) return result;
        }
      }
      if (rectangleChecks >= 240) break;
    }

    let translations = 0;
    const compact = templates.map(({ drawing, orientations }) =>
      ({ minimum: minimumScale(drawing, puzzle.edges, clearance), orientations }));
    for (const factor of [1.035, 1.2]) {
      for (const { minimum, orientations } of compact) {
        if (!Number.isFinite(minimum) || minimum <= 0) continue;
        for (const { points, bounds } of orientations) {
          const scale = Math.min(minimum * factor, ...bounds.map((range, axis) => length(board[axis]) / length(range)));
          if (scale < minimum) continue;
          const template = points.map((point) => point.map((coordinate) => coordinate * scale));
          if (g.evaluate(geometry, template).count) continue;
          if (translations++ >= 24) return null;
          const result = placeTranslation(template, puzzle, clearance, verify);
          if (result) return result;
        }
      }
    }
    return null;
  }

  globalThis.JiexianObstacleDrawing = { solve };
})();
