(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const minNodes = 4;
  const maxNodes = 24;
  const difficulty = {
    easy: { label: '简单', nodes: 6, edgeFactor: 1.18, scramble: 0.22, target: 1 },
    medium: { label: '中等', nodes: 10, edgeFactor: 1.6, scramble: 0.52, target: 3 },
    hard: { label: '困难', nodes: 15, edgeFactor: 2.05, scramble: 0.94, target: 6 },
  };
  const modes = {
    classic: { label: '经典', rule: '拖动红色节点，让冲突连线恢复为实线。' },
    fixed: { label: '固定点', rule: '带 × 的锚点保持原位，移动其余节点。' },
    mirror: { label: '反向联动', rule: 'A、B、C 等每组独立，同字母的两个节点反向移动。' },
    rotor: { label: '旋转星盘', rule: '拖动一个星盘节点，同一星盘上的所有节点会绕圆心转动。' },
    rail: { label: '滑轨', rule: '同一滑轨上的多个节点可独立沿轨道滑动。' },
    obstacle: { label: '禁行区', rule: '节点和连线都要绕开带纹理的圆形区域。' },
    mixed: { label: '混合机制', rule: '多种机制合在同一题。留意联动组、星盘和滑轨各自的限制。' },
  };

  function defaultCount(rank, mode) {
    const base = difficulty[rank].nodes;
    return mode === 'mixed' ? base + (rank === 'hard' ? 5 : rank === 'medium' ? 4 : 3) :
      ['mirror', 'rotor', 'rail'].includes(mode) ? base + (rank === 'hard' ? 3 : 2) : base;
  }

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
    const edges = count === 2 ? [[0, 1]] : g.cycle(count);
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

  function trackSizes(count, rank, kinds) {
    if (!kinds.includes('rail')) return [];
    const mixed = kinds.length > 1;
    const reserve = (kinds.includes('mirror') ? 2 : 0) + (kinds.includes('rotor') ? 2 : 0) + 2;
    const total = Math.min(count - reserve, mixed ? (rank === 'hard' && count >= 16 ? 5 : 3) :
      rank === 'hard' ? Math.min(10, Math.floor(count * .52)) : rank === 'medium' ? Math.min(6, Math.floor(count * .50)) : 3);
    if (total < 2) return [];
    const tracks = mixed ? (total >= 5 ? 2 : 1) : Math.min(3, Math.max(1, Math.floor(total / 3)));
    return Array.from({ length: tracks }, (_, i) => Math.floor(total / tracks) + Number(i < total % tracks));
  }

  function addTracks(points, sizes, random) {
    const horizontal = random() < .47;
    const controls = [];
    sizes.forEach((size, i) => {
      const gap = (i - (sizes.length - 1) / 2) * (horizontal ? 105 : 169);
      const center = [450 + (horizontal ? 0 : gap) + (random() - .5) * 28, 270 + (horizontal ? gap : 0) + (random() - .5) * 23];
      const angle = (horizontal ? 0 : Math.PI / 2) + (random() - .5) * .25;
      const length = (horizontal ? 255 : 142) + random() * 16;
      const x = Math.cos(angle) * length;
      const y = Math.sin(angle) * length;
      const a = [center[0] - x, center[1] - y];
      const b = [center[0] + x, center[1] + y];
      const spacing = horizontal ? .61 / (size - 1) : .67 / (size - 1);
      for (let n = 0; n < size; n++) {
        const t = .5 + (n - (size - 1) / 2) * spacing + (random() - .5) * spacing * .19;
        const node = points.length;
        points.push(g.interpolate(a, b, t));
        controls.push(g.rail(node, a, b, t));
      }
    });
    return controls;
  }

  function chooseRotor(points, available, desired, centers, random) {
    let bestSize = 1;
    const options = [];
    const middles = available.flatMap((a, i) => available.slice(i + 1).map((b) => g.interpolate(points[a], points[b], .5)));
    for (const center of middles) {
      if (centers.some((other) => g.distance(other, center) < 110)) continue;
      const [x, y] = center;
      const room = Math.min(x, y, g.width - x, g.height - y) - g.margin;
      const nearby = available.filter((node) => {
        const r = g.distance(points[node], center);
        return r >= 32 && r <= Math.min(182, room);
      });
      const size = Math.min(desired, nearby.length);
      if (size < 2 || size < bestSize) continue;
      if (size > bestSize) {
        bestSize = size;
        options.length = 0;
      }
      options.push({ center, nearby });
    }
    if (!options.length) return null;
    const { center, nearby } = options[Math.floor(random() * options.length)];
    return { center, members: shuffle(nearby, random).slice(0, bestSize) };
  }

  function buildWitness(count, rank, mode, random) {
    const settings = difficulty[rank];
    const primary = shuffle(['mirror', 'rotor', 'rail'], random);
    const kinds = mode === 'mixed' ? [...primary.slice(0, count < 6 ? 1 : count < 9 ? 2 : 3), 'fixed', 'obstacle'] : [mode];
    const sizes = trackSizes(count, rank, kinds);
    const trackNodes = sizes.reduce((sum, size) => sum + size, 0);
    const inside = trackNodes ? 0 : count >= 10 && rank === 'hard' ? 2 : count >= 6 && rank !== 'easy' ? 1 : 0;
    const ring = count - trackNodes - inside;
    const phase = random() * 2 * Math.PI;
    const points = Array.from({ length: ring }, (_, i) => {
      const angle = phase + (i + random() * .20) * 2 * Math.PI / ring;
      return [450 + (315 + random() * 25) * Math.cos(angle), 270 + (187 + random() * 20) * Math.sin(angle)];
    });
    for (let i = 0; i < inside; i++) {
      points.push([450 + (i - (inside - 1) / 2) * 205 + (random() - .5) * 48, 270 + (random() - .5) * 106]);
    }
    const controlled = addTracks(points, sizes, random);
    const graph = fitGraph(points, ring, settings, random);
    if (!graph) return null;
    const available = shuffle(Array.from({ length: ring + inside }, (_, i) => i), random);
    const take = () => available.pop();
    if (kinds.includes('rotor')) {
      const extraInMix = mode === 'mixed' && count >= 18 && rank === 'hard' && random() < .5;
      const reserve = kinds.includes('mirror') ? (extraInMix ? 7 : 4) : 1;
      const amount = extraInMix || mode === 'rotor' && count >= (rank === 'hard' ? 10 : 13) ? 2 : 1;
      const centers = [];
      for (let i = 0; i < amount; i++) {
        const wanted = rank === 'hard' ? 5 : rank === 'medium' ? 4 : 3;
        const desired = Math.max(2, Math.min(wanted, available.length - reserve - 2 * (amount - i - 1)));
        const disk = chooseRotor(points, available, desired, centers, random);
        if (!disk) {
          if (!i) return null;
          break;
        }
        disk.members.forEach((node) => available.splice(available.indexOf(node), 1));
        centers.push(disk.center);
        controlled.push(g.rotor(disk.members, disk.center, 0));
      }
    }
    if (kinds.includes('mirror')) {
      const wanted = rank === 'hard' ? 4 : rank === 'medium' ? 3 : 2;
      const target = mode === 'mixed' ? Math.min(wanted, Math.max(1, Math.floor(count / 6))) : wanted;
      const pairs = Math.min(Math.floor(available.length / 2), target);
      for (let i = 0; i < pairs; i++) {
        const a = take();
        const b = take();
        controlled.push(g.mirror(a, b, points[a]));
      }
    }
    if (kinds.includes('fixed')) {
      const anchors = Math.min(available.length - 1, mode === 'mixed' ? Math.max(1, Math.floor(count / 11)) : Math.max(1, Math.floor(count / 5)));
      for (let i = 0; i < anchors; i++) take();
    }
    if (kinds.includes('obstacle')) {
      const candidates = Array.from({ length: 80 }, () => ({
        center: [91 + random() * 718, 100 + random() * 340], r: 30 + random() * 14,
      }));
      const amount = rank === 'hard' && count >= 9 ? 2 : 1;
      for (const candidate of candidates) {
        if (graph.obstacles.some((other) => g.distance(other.center, candidate.center) < other.r + candidate.r + 20)) continue;
        graph.obstacles.push(candidate);
        if (g.evaluate(graph, points).count) graph.obstacles.pop();
        if (graph.obstacles.length >= amount) break;
      }
      if (!graph.obstacles.length) return null;
    }
    return g.createLevel({ ...graph, points, controls: [...available.map((node) => g.free(node, points[node])), ...controlled] });
  }

  function generate(seed, rank, count, mode) {
    const random = randomFrom(seed);
    const settings = difficulty[rank];
    let best;
    for (let attempt = 0; attempt < 30; attempt++) {
      const puzzle = buildWitness(count, rank, mode, random);
      if (!puzzle) continue;
      const indices = puzzle.controls.map((_, i) => i);
      const movable = indices.filter((i) => puzzle.controls[i].kind === 'free');
      const special = indices.filter((i) => puzzle.controls[i].kind !== 'free');
      const tracks = new Map();
      special.forEach((i) => {
        const control = puzzle.controls[i];
        if (control.kind === 'rail') {
          if (!tracks.has(control.a)) tracks.set(control.a, []);
          tracks.get(control.a).push(i);
        }
      });
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
          if (control.kind === 'mirror') {
            const [x, y] = control.target;
            start[i] = g.normalize(control, [x + (random() - .5) * 470, y + (random() - .5) * 390]);
          }
        });
        for (const members of tracks.values()) {
          const gap = .80 / (members.length - 1);
          shuffle(members, random).forEach((i, position) => {
            start[i] = [.10 + gap * position + (random() - .5) * Math.min(.10, gap * .28)];
          });
        }
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

  function authored(draft, witness, radius = draft.spacing ?? g.radius) {
    const groups = draft.groups ?? [];
    const fixed = draft.fixed ?? [];
    const obstacles = draft.obstacles ?? [];
    const points = witness ?? draft.points;
    const claimed = new Set([...fixed, ...groups.flatMap(({ members }) => members)]);
    const controls = draft.points.flatMap((point, i) => claimed.has(i) ? [] : [g.free(i, point)]);
    for (const group of groups) {
      const [node, partner] = group.members;
      if (group.kind === 'mirror') controls.push(g.mirror(node, partner, points[node]));
      if (group.kind === 'rotor') controls.push(g.rotor(group.members, group.center, 0));
      if (group.kind === 'rail') {
        group.members.forEach((member) => {
          const position = g.trackPosition(points[member], group.a, group.b);
          controls.push(g.rail(member, group.a, group.b, position));
        });
      }
    }
    return g.createLevel({ points, edges: draft.edges, obstacles, radius, controls });
  }

  function rotorFits(points, members, center) {
    const [x, y] = center;
    const room = Math.min(x, y, g.width - x, g.height - y) - g.margin;
    return members.every((node) => {
      const r = g.distance(points[node], center);
      return r >= 29 && r <= room + 1e-6;
    });
  }

  function projectState(puzzle, points) {
    return puzzle.controls.map((control) => {
      const node = control.members[0];
      const point = points[node];
      if (control.kind === 'rotor') {
        const [cx, cy] = control.center;
        const [x, y] = puzzle.points[node];
        return g.normalize(control, [Math.atan2(point[1] - cy, point[0] - cx) - Math.atan2(y - cy, x - cx)]);
      }
      if (control.kind === 'rail') return [g.trackPosition(point, control.a, control.b)];
      if (control.kind === 'mirror') {
        const other = points[control.members[1]];
        return g.normalize(control, point.map((x, axis) => (x + control.sum[axis] - other[axis]) / 2));
      }
      return g.normalize(control, point);
    });
  }

  function answerState(puzzle, answer) {
    if (!answer || answer.length !== puzzle.points.length) return null;
    const state = projectState(puzzle, answer);
    const points = g.positions(puzzle, state);
    return points.every((point, n) => g.distance(point, answer[n]) < .1) && !g.evaluate(puzzle, points).count ? state : null;
  }

  function rememberAnswer(draft) {
    const puzzle = authored(draft);
    const answer = g.evaluate(puzzle, g.positions(puzzle, puzzle.initial)).count ?
      answerState(puzzle, draft.answer) ? draft.answer : undefined : g.positions(puzzle, puzzle.initial);
    return { ...draft, answer };
  }

  function randomValue(control, random) {
    if (control.kind === 'rotor') return [random() * Math.PI * 2];
    if (control.kind === 'rail') return [.03 + random() * .94];
    const anywhere = [g.margin + random() * (g.width - g.margin * 2), g.margin + random() * (g.height - g.margin * 2)];
    return g.normalize(control, anywhere);
  }

  function scrambleDraft(draft, seed) {
    const puzzle = authored(draft);
    const answer = answerState(puzzle, draft.answer);
    if (!answer || !draft.edges.length) return null;
    const random = randomFrom(seed);
    let best;
    let quality = Infinity;
    for (let trial = 0; trial < 30; trial++) {
      const state = answer.map((value, i) => random() < .68 ? randomValue(puzzle.controls[i], random) : value);
      const points = g.positions(puzzle, state);
      const faults = g.evaluate(puzzle, points).count;
      if (!faults) continue;
      const delta = Math.abs(faults - Math.min(8, Math.ceil(draft.edges.length / 2)));
      if (delta < quality) { quality = delta; best = points; }
      if (!quality) break;
    }
    return best ? { ...draft, points: best } : null;
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

  function searchConstrained(puzzle, drawings) {
    const random = randomFrom(17257833 + puzzle.edges.length * 17);
    const score = (state) => g.evaluate(puzzle, g.positions(puzzle, state));
    const projected = drawings.slice(0, 7).flatMap((drawing) =>
      [0, Math.PI / 2, Math.PI].map((angle) => projectState(puzzle, fitDrawing(drawing, angle))));
    const seeds = [puzzle.initial, ...projected]
      .map((state) => ({ state, count: score(state).count }))
      .sort((a, b) => a.count - b.count);
    if (!seeds[0].count) return seeds[0].state;
    if (!puzzle.controls.length) return null;
    const indices = puzzle.controls.map((_, i) => i);
    let checks = 0;
    for (let restart = 0; restart < 18 && checks < 2600; restart++) {
      const base = seeds[restart % Math.min(6, seeds.length)].state;
      const state = base.map((value, i) => restart > 5 && random() < .34 ? randomValue(puzzle.controls[i], random) : value);
      let faults = score(state);
      if (!faults.count) return state;
      for (let pass = 0; pass < 4 && checks < 2600; pass++) {
        for (const i of shuffle(indices, random)) {
          if (!puzzle.controls[i].members.some((node) => faults.badNodes.has(node))) continue;
          const control = puzzle.controls[i];
          const current = state[i];
          const candidates = control.kind === 'rotor' || control.kind === 'rail' ?
            Array.from({ length: 15 }, (_, n) => control.kind === 'rotor' ? [n * Math.PI * 2 / 15] : [n / 14]) :
            Array.from({ length: 12 }, (_, n) => {
              const radius = n < 6 ? 45 : 150;
              const dx = (random() - .5) * radius * 2;
              const dy = (random() - .5) * radius * 2;
              return g.normalize(control, [current[0] + dx, current[1] + dy]);
            }).concat(Array.from({ length: 4 }, () => randomValue(control, random)));
          let bestValue = current;
          let best = faults;
          for (const value of candidates) {
            state[i] = value;
            const trial = score(state);
            checks++;
            if (!trial.count) return state;
            if (trial.count < best.count || (trial.count === best.count && random() < .18)) {
              best = trial;
              bestValue = value;
            }
          }
          faults = best;
          state[i] = bestValue;
        }
      }
    }
    return null;
  }

  function solveDraft(draft) {
    const initial = authored(draft);
    if (!g.evaluate(initial, g.positions(initial, initial.initial)).count) return { puzzle: initial };
    const known = answerState(initial, draft.answer);
    if (known) return { puzzle: { ...initial, witness: known } };
    const drawings = globalThis.JiexianDrawing(draft.points.length, draft.edges);
    if (!drawings) return { reason: '这张图不是平面图，移动节点也无法消除全部交叉。可以删掉一些连线再试。' };
    if (draft.fixed?.length || draft.groups?.length || draft.obstacles?.length) {
      const witness = searchConstrained(initial, drawings);
      return witness ? { puzzle: { ...initial, witness } } : {
        puzzle: { ...initial, witness: null },
        reason: '暂时没找到符合所有机制的解。可以继续试玩，或回到编辑器摆成无冲突的布局，再点「打乱」生成有解题。',
      };
    }
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

  globalThis.JiexianPuzzles = { difficulty, modes, minNodes, maxNodes, defaultCount, generate, authored, solveDraft,
    rotorFits, rememberAnswer, scrambleDraft };
})();
