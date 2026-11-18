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
    const controls = data.controls.map((control, i) => {
      control.members.forEach((node) => { ownership[node] = i; });
      const target = data.points[control.members[0]];
      if (control.kind === 'rotor') return { ...control, target: [0] };
      if (control.kind === 'rail') return { ...control, target: [distance(control.a, target) / distance(control.a, control.b)] };
      if (control.kind === 'mirror') {
        const other = data.points[control.members[1]];
        return { ...control, sum: target.map((value, axis) => value + other[axis]), target };
      }
      return { ...control, target };
    });
    return { obstacles: [], ...data, controls, ownership, initial: controls.map(({ start }) => start), witness: controls.map(({ target }) => target) };
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
    const crosses = [];
    let count = 0;
    const markEdge = (i) => {
      badEdges.add(i);
      level.edges[i].forEach((n) => badNodes.add(n));
    };
    points.forEach((p, i) => {
      for (let j = 0; j < i; j++) {
        if (distance(p, points[j]) >= radius * 2 + 5) continue;
        badNodes.add(i);
        badNodes.add(j);
        count++;
      }
      level.obstacles.forEach(({ center, r }, j) => {
        if (distance(p, center) >= r + radius + 4) return;
        badNodes.add(i);
        badObstacles.add(j);
        count++;
      });
    });
    level.edges.forEach(([i, j], edge) => {
      const a = points[i];
      const b = points[j];
      points.forEach((p, k) => {
        if (k === i || k === j || distanceToSegment(p, a, b) >= radius + 5) return;
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
        crosses.push([a[0] + t * rx, a[1] + t * ry]);
        markEdge(edge);
        markEdge(other);
        count++;
      }
    });
    return { count, badEdges, badNodes, badObstacles, crosses };
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

  function solve(level, state) {
    const score = (candidate) => evaluate(level, positions(level, candidate)).count;
    const initialScore = score(state);
    if (!initialScore) return [];
    const pending = level.controls.map((_, i) => i);
    // Start from a valid embedding. Keep as much of the player's layout as geometry allows.
    const goal = copy(level.witness);
    const nearest = [...pending].sort((a, b) =>
      moveDistance(level.controls[a], goal[a], state[a]) - moveDistance(level.controls[b], goal[b], state[b]));
    for (let pass = 0; pass < 2; pass++) {
      for (const i of nearest) {
        const previous = goal[i];
        for (const fraction of [1, 0.75, 0.5, 0.25, 0.125]) {
          goal[i] = mixValue(level.controls[i], previous, state[i], fraction);
          if (score(goal) === 0) break;
          goal[i] = previous;
        }
      }
    }
    const current = copy(state);
    const moves = [];
    let conflicts = initialScore;
    while (conflicts && pending.length) {
      let best;
      for (const i of pending) {
        const length = moveDistance(level.controls[i], current[i], goal[i]);
        if (length < eps) continue;
        const trial = [...current];
        trial[i] = goal[i];
        const remaining = score(trial);
        if (!best || remaining < best.remaining || (remaining === best.remaining && length < best.length)) {
          best = { index: i, value: goal[i], length, remaining };
        }
      }
      if (!best) break;
      moves.push(best);
      current[best.index] = best.value;
      pending.splice(pending.indexOf(best.index), 1);
      conflicts = best.remaining;
    }
    return moves;
  }

  const wheel = (count) => [...cycle(count), ...Array.from({ length: count }, (_, i) => [i, count])];
  const compass = [450, 270];
  const angles = [-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6];
  const diskPoints = [208, 94].flatMap((r) => angles.map((angle) => polar(compass, r, angle)));
  const diskEdges = [...cycle(3), ...cycle(3).map(([a, b]) => [a + 3, b + 3]), [0, 3], [1, 4], [2, 5]];

  const levels = [
    createLevel({ id: 'first', title: '初见交错', category: '入门', rule: '拖动任意圆点，让所有虚线恢复为实线。',
      points: [[234,147],[446,85],[658,138],[713,343],[455,438],[206,350],[449,264]],
      edges: [...cycle(6), [0,6],[2,6],[4,6],[5,6]],
      controls: [[225,137],[443,89],[668,344],[673,159],[443,417],[235,357],[491,283]].map((p, i) => free(i, p)) }),
    createLevel({ id: 'orbit', title: '环绕中心', category: '经典', rule: '留意最外侧的一圈。先理顺外圈，再找中心的位置。',
      points: [[206,156],[367,90],[579,103],[717,234],[644,411],[428,449],[237,373],[452,263]],
      edges: wheel(7), controls: [[366,90],[642,406],[212,154],[712,222],[231,376],[581,111],[435,452],[510,286]].map((p, i) => free(i, p)) }),
    createLevel({ id: 'anchor', title: '锚点之间', category: '固定点', rule: '带 × 的方形锚点保持原位。移动其余节点，绕开固定连线。',
      points: [[182,145],[450,82],[717,146],[665,416],[450,465],[232,416],[450,270]],
      edges: wheel(6), controls: [free(1,[335,402]),free(3,[503,143]),free(5,[622,323]),free(6,[365,171])] }),
    createLevel({ id: 'mirror', title: '相反方向', category: '反向联动', rule: '拖动 A 或 B，同字母的搭档会沿相反方向移动。',
      points: [[191,148],[422,108],[695,159],[706,386],[478,432],[205,381],[452,270]],
      edges: wheel(6), controls: [mirror(0,3,[630,130]),mirror(1,4,[491,395]),free(6,[513,299])] }),
    createLevel({ id: 'rotor', title: '星盘回转', category: '旋转组', rule: '沿圆盘拖动任意 R 节点，整组会一起绕中心转动。',
      points: diskPoints, edges: diskEdges, controls: [rotor([3,4,5],compass,2.45)] }),
    createLevel({ id: 'rail', title: '双轨换位', category: '滑轨', rule: '带短划的滑块只能沿自己的轨道上下移动。',
      points: [[172,133],[172,408],[396,150],[540,389],[731,145],[731,409]],
      edges: [[0,2],[2,4],[1,3],[3,5],[0,1],[4,5],[2,3]],
      controls: [rail(2,[396,99],[396,443],0.88),rail(3,[540,99],[540,443],0.18)] }),
    createLevel({ id: 'island', title: '绕开暗礁', category: '禁行区', rule: '节点和连线都要避开带纹理的圆形禁行区。',
      points: [[174,161],[446,105],[727,160],[733,370],[458,442],[180,372],[450,272]],
      obstacles: [{ center: [317,320], r: 49 }, { center: [620,236], r: 49 }],
      edges: [...cycle(6),[0,6],[1,6],[3,6],[4,6]],
      controls: [free(1,[529,388]),free(2,[243,352]),free(4,[519,152]),free(5,[664,167]),free(6,[294,225])] }),
    createLevel({ id: 'crosswind', title: '穿行星轨', category: '组合', rule: '同时调整星盘与滑块，把连线带离两处禁行区。',
      points: [...diskPoints, [160,365],[740,379]],
      obstacles: [{ center: [245,190], r: 38 }, { center: [657,185], r: 38 }],
      edges: [...diskEdges,[0,6],[2,6],[0,7],[1,7]],
      controls: [rotor([3,4,5],compass,3.2), rail(6,[160,123],[160,443],0.15),rail(7,[740,123],[740,443],0.19)] }),
  ];

  const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

  function dayKey(date = new Date()) {
    const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function dailyLevel(date) {
    let seed = 2166136261;
    for (const digit of date) seed = Math.imul(seed ^ digit.charCodeAt(0), 16777619);
    function random() {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    const count = 6 + Math.floor(random() * 3);
    const phase = random() * tau;
    const points = Array.from({ length: count }, (_, i) => {
      const angle = phase + (i + random() * 0.16) * tau / count;
      return [450 + Math.cos(angle) * 300, 270 + Math.sin(angle) * 186];
    });
    points.push([430 + random() * 40, 250 + random() * 40]);
    const anchors = [Math.floor(random() * count)];
    if (count >= 7) anchors.push((anchors[0] + 3) % count);
    const movable = points.map((_, i) => i).filter((i) => !anchors.includes(i));
    const destinations = [...movable];
    for (let i = destinations.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [destinations[i], destinations[j]] = [destinations[j], destinations[i]];
    }
    const edges = wheel(count).filter((_, i) => i !== count + anchors[0]);
    const data = { id: `daily-${date}`, date, title: '每日一结', category: '每日挑战',
      rule: '今天的题目对所有玩家相同。试试在目标步数内独立解开。', points, edges, goal: movable.length + 1 };
    let level = createLevel({ ...data, controls: movable.map((i, j) => free(i, points[destinations[j]])) });
    if (evaluate(level, positions(level, level.initial)).count < 3) {
      level = createLevel({ ...data, controls: movable.map((i, j) => free(i, points[destinations[(j + 2) % destinations.length]])) });
    }
    if (evaluate(level, positions(level, level.initial)).count === 0) {
      const corner = movable[0];
      level = createLevel({ ...data, controls: movable.map((i) => free(i, i === corner ? points[movable[1]] : points[i])) });
    }
    return level;
  }

  globalThis.Jiexian = { width, height, radius, clamp, copy, distance, positions, normalize, dragValue, evaluate, mixValue, moveDistance, solve, levels, dayKey, dailyLevel };
})();
