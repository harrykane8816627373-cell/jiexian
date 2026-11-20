(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const sizes = [g.width, g.height];
  const translate = (point, delta) => point.map((value, axis) => value + delta[axis]);
  const bounded = (point, margin = g.margin) => point.map((value, axis) => g.clamp(value, margin, sizes[axis] - margin));

  function translation(points, delta, margin = g.margin) {
    return delta.map((value, axis) => g.clamp(value,
      margin - Math.min(...points.map((point) => point[axis])),
      sizes[axis] - margin - Math.max(...points.map((point) => point[axis]))));
  }

  function handles(draft) {
    const result = [];
    const add = (kind, index, anchor, point) => result.push({ kind, index, anchor, point });
    draft.obstacles.forEach(({ center, r }, index) => {
      add('obstacle', index, 'center', center);
      add('obstacle', index, 'radius', [center[0] + r, center[1]]);
    });
    draft.groups.forEach(({ kind, a, b, center, members }, index) => {
      if (kind === 'rail') {
        add(kind, index, 'center', g.interpolate(a, b, .5));
        add(kind, index, 'a', a);
        add(kind, index, 'b', b);
      } else {
        const [first, second] = members;
        add(kind, index, 'center', center ?? g.interpolate(draft.points[first], draft.points[second], .5));
      }
    });
    return result;
  }

  function drag(draft, { kind, index, anchor, point, node }, delta) {
    if (Math.hypot(...delta) < .01) return draft;
    const target = translate(point, delta);
    if (kind === 'obstacle') {
      const obstacle = draft.obstacles[index];
      const { center, r } = obstacle;
      const room = Math.min(center[0], g.width - center[0], center[1], g.height - center[1]) - 10;
      const next = anchor === 'radius' ? { center, r: g.clamp(g.distance(center, target), 24, Math.max(24, Math.min(96, room))) } :
        { center: bounded(target, Math.max(g.margin, r + 10)), r };
      if (next.r === r && !g.distance(next.center, center)) return draft;
      return { ...draft, obstacles: draft.obstacles.map((value, i) => i === index ? next : value) };
    }

    const points = [...draft.points];
    const groups = [...draft.groups];
    if (kind === 'fixed') {
      points[index] = bounded(target);
    } else {
      const group = groups[index];
      const { center, members, a, b } = group;
      if (kind === 'rotor' && anchor === 'member') {
        const room = Math.min(center[0], g.width - center[0], center[1], g.height - center[1]) - g.margin;
        const r = g.distance(center, target);
        points[node] = r > 1e-8 ? g.interpolate(center, target, g.clamp(r, 29, room) / r) : point;
      } else if (kind === 'rail') {
        const shift = translation([a, b], delta);
        const nextA = anchor === 'center' ? translate(a, shift) : anchor === 'a' ? bounded(target) : a;
        const nextB = anchor === 'center' ? translate(b, shift) : anchor === 'b' ? bounded(target) : b;
        if (g.distance(nextA, nextB) < Math.min(g.distance(a, b), Math.max(70, (members.length - 1) * 36))) return draft;
        if (!g.distance(nextA, a) && !g.distance(nextB, b)) return draft;
        groups[index] = { ...group, a: nextA, b: nextB };
        for (const node of members) points[node] = g.interpolate(nextA, nextB, g.trackPosition(points[node], a, b));
      } else {
        const memberPoints = members.map((node) => points[node]);
        const margin = center ? g.margin + Math.max(...memberPoints.map((p) => g.distance(p, center))) : g.margin;
        const shift = translation(center ? [center] : memberPoints, delta, margin);
        if (!Math.hypot(...shift)) return draft;
        if (center) groups[index] = { ...group, center: translate(center, shift) };
        for (const node of members) points[node] = translate(points[node], shift);
      }
    }
    if (groups.every((value, i) => value === draft.groups[i]) && points.every((value, i) => !g.distance(value, draft.points[i]))) return draft;
    return { ...draft, points, groups };
  }

  globalThis.JiexianEditorMechanisms = { handles, drag };
})();
