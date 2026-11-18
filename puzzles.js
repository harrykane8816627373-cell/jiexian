(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const minNodes = 4;
  const maxNodes = 18;
  const difficulty = {
    easy: { label: '简单', nodes: 6, edgeFactor: 1.18, scramble: 0.22, target: 1 },
    medium: { label: '中等', nodes: 10, edgeFactor: 1.6, scramble: 0.52, target: 3 },
    hard: { label: '困难', nodes: 15, edgeFactor: 2.05, scramble: 0.94, target: 6 },
  };
  const modes = {
    classic: { label: '经典', rule: '拖动红色节点，让冲突连线恢复为实线。' },
    fixed: { label: '固定点', rule: '带 × 的锚点保持原位，移动其余节点。' },
    mirror: { label: '反向联动', rule: '拖动任意 A 节点，它的搭档会沿相反方向移动。' },
    rotor: { label: '旋转星盘', rule: '拖动任意 R 节点，整组会一起绕圆心旋转。' },
    rail: { label: '滑轨', rule: '带短划的节点只能沿轨道上下移动。' },
    obstacle: { label: '禁行区', rule: '节点和连线都要绕开带纹理的圆形区域。' },
    mixed: { label: '混合机制', rule: '同时处理固定点、禁行区和本题抽中的联动机制。' },
  };

  function randomFrom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function shuffle(items, random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function fitGraph(points, count, settings, random) {
    const edges = g.cycle(count);
    const graph = { edges, obstacles: [] };
    const tryEdge = (a, b) => {
      if (edges.some(([u, v]) => (a === u && b === v) || (a === v && b === u))) return false;
      edges.push([a, b]);
      if (!g.evaluate(graph, points).count) return true;
      edges.pop();
      return false;
    };
    if (g.evaluate(graph, points).count) return null;
    for (let a = count; a < points.length; a++) {
      const candidates = points.map((_, i) => i).filter((b) => b < a)
        .sort((b, c) => g.distance(points[a], points[b]) - g.distance(points[a], points[c]));
      if (!candidates.some((b) => tryEdge(a, b))) return null;
    }
    const choices = points.flatMap((_, a) => points.slice(a + 1).map((__, i) => [a, a + i + 1]));
    for (const [a, b] of shuffle(choices, random)) {
      if (edges.length >= Math.ceil(points.length * settings.edgeFactor)) break;
      tryEdge(a, b);
    }
    return graph;
  }

  function buildWitness(count, settings, mode, random) {
    const inside = count >= 10 && settings === difficulty.hard ? 2 : count >= 6 && settings !== difficulty.easy ? 1 : 0;
    const ring = count - inside;
    const phase = random() * 2 * Math.PI;
    const points = Array.from({ length: ring }, (_, i) => {
      const angle = phase + (i + random() * .20) * 2 * Math.PI / ring;
      return [450 + (315 + random() * 25) * Math.cos(angle), 270 + (187 + random() * 20) * Math.sin(angle)];
    });
    for (let i = 0; i < inside; i++) {
      points.push([450 + (i - (inside - 1) / 2) * 205 + (random() - .5) * 48, 270 + (random() - .5) * 106]);
    }
    const graph = fitGraph(points, ring, settings, random);
    if (!graph) return null;
    const available = shuffle(points.map((_, i) => i), random);
    const controlled = [];
    const take = () => available.pop();
    const mechanisms = mode === 'mixed' ? [
      ['mirror', 'rotor', 'rail'][Math.floor(random() * 3)], 'fixed', 'obstacle',
    ] : [mode];
    for (const mechanism of mechanisms) {
      if (mechanism === 'fixed') {
        const anchors = Math.min(available.length - 1, mode === 'mixed' ? 1 : Math.max(1, Math.floor(count / 5)));
        for (let i = 0; i < anchors; i++) take();
      } else if (mechanism === 'mirror') {
        const a = take();
        const b = take();
        controlled.push(g.mirror(a, b, points[a]));
      } else if (mechanism === 'rotor') {
        const choices = available.flatMap((a, i) => available.slice(i + 1).map((b) => {
          const center = points[a].map((x, axis) => (x + points[b][axis]) / 2);
          const r = g.distance(center, points[a]);
          const [x, y] = center;
          return { a, b, center, r, room: Math.min(x, y, g.width - x, g.height - y) - g.margin };
        })).filter(({ r, room }) => r >= 40 && r <= Math.min(155, room));
        if (!choices.length) return null;
        const { a, b, center } = choices[Math.floor(random() * choices.length)];
        available.splice(available.indexOf(a), 1);
        available.splice(available.indexOf(b), 1);
        controlled.push(g.rotor([a, b], center, 0));
      } else if (mechanism === 'rail') {
        const sliders = mode === 'mixed' ? 1 : Math.max(1, Math.floor(count / 5));
        for (let i = 0; i < sliders; i++) {
          const node = take();
          const [x, y] = points[node];
          const a = [x, g.margin + 12];
          const b = [x, g.height - g.margin - 12];
          controlled.push(g.rail(node, a, b, (y - a[1]) / (b[1] - a[1])));
        }
      } else if (mechanism === 'obstacle') {
        const candidates = Array.from({ length: 80 }, () => ({
          center: [91 + random() * 718, 100 + random() * 340], r: 35 + random() * 16,
        }));
        const amount = settings === difficulty.hard && count >= 9 ? 2 : 1;
        for (const candidate of candidates) {
          if (graph.obstacles.some((other) => g.distance(other.center, candidate.center) < other.r + candidate.r + 20)) continue;
          graph.obstacles.push(candidate);
          if (g.evaluate(graph, points).count) graph.obstacles.pop();
          if (graph.obstacles.length >= amount) break;
        }
        if (!graph.obstacles.length) return null;
      }
    }
    return g.createLevel({ ...graph, points, controls: [...available.map((node) => g.free(node, points[node])), ...controlled] });
  }

  function generate(seed, rank, count, mode) {
    const random = randomFrom(seed);
    const settings = difficulty[rank];
    let best;
    for (let attempt = 0; attempt < 30; attempt++) {
      const puzzle = buildWitness(count, settings, mode, random);
      if (!puzzle) continue;
      const indices = puzzle.controls.map((_, i) => i);
      const movable = indices.filter((i) => puzzle.controls[i].kind === 'free');
      const special = indices.filter((i) => puzzle.controls[i].kind !== 'free');
      const sampleCount = Math.max(1, Math.round(movable.length * settings.scramble));
      const target = Math.min(settings.target, Math.max(1, count - 3));
      for (let mix = 0; mix < 13; mix++) {
        const start = g.copy(puzzle.witness);
        const selected = shuffle(movable, random).slice(0, sampleCount);
        const destinations = selected.map((i) => puzzle.controls[i].target);
        selected.forEach((index, i) => {
          const arbitrary = [g.margin + random() * (g.width - g.margin * 2), g.margin + random() * (g.height - g.margin * 2)];
          start[index] = selected.length < 2 || random() < .30 ? arbitrary : destinations[(i + 1) % selected.length];
        });
        special.forEach((i) => {
          const control = puzzle.controls[i];
          if (control.kind === 'rotor') start[i] = [(random() > .5 ? 1 : -1) * (.5 + random() * 2.45)];
          if (control.kind === 'rail') start[i] = [g.clamp(control.target[0] + (random() < .5 ? -.45 : .45), 0, 1)];
          if (control.kind === 'mirror') {
            const [x, y] = control.target;
            start[i] = g.normalize(control, [x + (random() - .5) * 470, y + (random() - .5) * 390]);
          }
        });
        const faults = g.evaluate(puzzle, g.positions(puzzle, start)).count;
        const candidate = { ...puzzle, initial: start, rank, mode, seed };
        if (faults >= target && (rank !== 'easy' || faults <= Math.max(4, Math.ceil(count / 2)))) return candidate;
        if (faults && (!best || Math.abs(faults - target) < best.delta)) {
          best = { puzzle: candidate, delta: Math.abs(faults - target) };
        }
      }
      if (best && attempt >= 3) break;
    }
    return best?.puzzle ?? null;
  }

  function authored(draft, witness = draft.points, radius = g.radius) {
    return g.createLevel({
      points: witness, edges: draft.edges, radius,
      controls: draft.points.map((point, i) => g.free(i, point)),
    });
  }

  function clearance(points, edges) {
    let best = Infinity;
    points.forEach((point, i) => {
      for (let j = 0; j < i; j++) best = Math.min(best, g.distance(point, points[j]) * 14 / 33);
      for (const [a, b] of edges) {
        if (a !== i && b !== i) best = Math.min(best, g.distanceToSegment(point, points[a], points[b]) * 14 / 19);
      }
    });
    return best;
  }

  function fitDrawing(points, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = points.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
    const limits = [0, 1].map((axis) => {
      const coordinates = rotated.map((point) => point[axis]);
      return [Math.min(...coordinates), Math.max(...coordinates)];
    });
    const pad = g.margin + 18;
    return rotated.map((point) => point.map((value, axis) => {
      const [min, max] = limits[axis];
      const size = axis ? g.height : g.width;
      return max - min < 1e-9 ? size / 2 : pad + (value - min) * (size - 2 * pad) / (max - min);
    }));
  }

  function solveDraft(draft) {
    const initial = authored(draft);
    if (!g.evaluate(initial, draft.points).count) return { puzzle: initial };
    const drawings = globalThis.JiexianDrawing(draft.points.length, draft.edges);
    if (!drawings) return { reason: '这张图不是平面图，移动节点也无法消除全部交叉。可以删掉一些连线再试。' };
    let best = 0;
    let witness;
    for (const drawing of drawings) {
      for (const angle of [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, -Math.PI / 6]) {
        const points = fitDrawing(drawing, angle);
        const space = clearance(points, draft.edges);
        if (!(space > best) || g.evaluate({ ...initial, radius: Math.min(g.radius, space * .85) }, points).count) continue;
        best = space;
        witness = points;
      }
    }
    if (!witness) return { reason: '找不到能在棋盘内展开的布局。试试减少连线或节点。' };
    return { puzzle: authored(draft, witness, Math.min(g.radius, best * .85)) };
  }

  globalThis.JiexianPuzzles = { difficulty, modes, minNodes, maxNodes, generate, authored, solveDraft };
})();
