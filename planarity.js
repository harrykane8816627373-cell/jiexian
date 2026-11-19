(function () {
  'use strict';

  // Left-right planarity test and face augmentation adapted from NetworkX 3.5.
  // See NETWORKX-LICENSE.txt for the copyright and redistribution terms.
  const lists = (n) => Array.from({ length: n }, () => []);
  const group = () => ({ low: null, high: null });
  const pair = () => ({ left: group(), right: group() });
  const swap = (item) => { [item.left, item.right] = [item.right, item.left]; };
  const depth = (edge) => edge?.low ?? Infinity;

  function rotation(count, edges) {
    if (count > 2 && edges.length > 3 * count - 6) return null;
    const neighbors = lists(count);
    edges.forEach(([v, w]) => {
      const edge = { v, w, side: 1, ref: null };
      neighbors[v].push(edge);
      neighbors[w].push(edge);
    });
    const out = lists(count);
    const height = Array(count).fill(-1);
    const parent = Array(count).fill(null);
    const roots = [];

    function orient(v) {
      for (const edge of neighbors[v]) {
        if (edge.oriented) continue;
        edge.oriented = true;
        if (edge.v !== v) [edge.v, edge.w] = [edge.w, edge.v];
        const w = edge.w;
        out[v].push(edge);
        edge.low = height[v];
        edge.second = height[v];
        if (height[w] < 0) {
          height[w] = height[v] + 1;
          parent[w] = edge;
          orient(w);
        } else {
          edge.low = height[w];
        }
        edge.nesting = 2 * edge.low + Number(edge.second < height[v]);
        const p = parent[v];
        if (!p) continue;
        if (edge.low < p.low) {
          p.second = Math.min(p.low, edge.second);
          p.low = edge.low;
        } else {
          p.second = Math.min(p.second, edge.low === p.low ? edge.second : edge.low);
        }
      }
    }

    for (let v = 0; v < count; v++) {
      if (height[v] !== -1) continue;
      height[v] = 0;
      roots.push(v);
      orient(v);
    }
    const byNesting = (a, b) => a.nesting - b.nesting;
    out.forEach((list) => list.sort(byNesting));
    const stack = [];
    const top = () => stack.at(-1);
    const conflicts = (interval, edge) => interval?.high && interval.high.low > edge.low;

    function integrate(edge, p, bottom) {
      const merged = pair();
      do {
        const item = stack.pop();
        if (item.left.low) swap(item);
        if (item.left.low) return false;
        if (item.right.low.low > p.low) {
          if (merged.right.low) merged.right.low.ref = item.right.high;
          else merged.right.high = item.right.high;
          merged.right.low = item.right.low;
        } else {
          item.right.low.ref = p.lowEdge;
        }
      } while (stack.length > bottom);

      while (conflicts(top()?.left, edge) || conflicts(top()?.right, edge)) {
        const item = stack.pop();
        if (conflicts(item.right, edge)) swap(item);
        if (conflicts(item.right, edge)) return false;
        if (merged.right.low) merged.right.low.ref = item.right.high;
        if (item.right.low) merged.right.low = item.right.low;
        if (merged.left.low) merged.left.low.ref = item.left.high;
        else merged.left.high = item.left.high;
        merged.left.low = item.left.low;
      }
      if (merged.left.low || merged.right.low) stack.push(merged);
      return true;
    }

    function trim(edge) {
      const v = edge.v;
      while (top() && Math.min(depth(top().left.low), depth(top().right.low)) === height[v]) {
        const { left } = stack.pop();
        if (left.low) left.low.side = -1;
      }
      if (top()) {
        const item = top();
        for (const [side, other] of [[item.left, item.right], [item.right, item.left]]) {
          while (side.high?.w === v) side.high = side.high.ref;
          if (!side.high && side.low) {
            side.low.ref = other.low;
            side.low.side = -1;
            side.low = null;
          }
        }
      }
      if (edge.low < height[v]) {
        const { left, right } = top();
        edge.ref = left.high && (!right.high || left.high.low > right.high.low) ? left.high : right.high;
      }
    }

    function test(v) {
      const p = parent[v];
      for (const edge of out[v]) {
        const bottom = stack.length;
        if (parent[edge.w] === edge) {
          if (!test(edge.w)) return false;
        } else {
          edge.lowEdge = edge;
          stack.push({ left: group(), right: { low: edge, high: edge } });
        }
        if (edge.low < height[v]) {
          if (edge === out[v][0]) p.lowEdge = edge.lowEdge;
          else if (!integrate(edge, p, bottom)) return false;
        }
      }
      if (p) trim(p);
      return true;
    }
    if (!roots.every(test)) return null;

    function sign(edge) {
      if (edge.ref) {
        edge.side *= sign(edge.ref);
        edge.ref = null;
      }
      return edge.side;
    }
    out.flat().forEach((edge) => { edge.nesting *= sign(edge); });
    const order = out.map((list) => list.sort(byNesting).map(({ w }) => w));
    const left = [];
    const right = [];
    function embed(v) {
      for (const edge of out[v]) {
        const { w } = edge;
        if (parent[w] === edge) {
          order[w].unshift(v);
          left[v] = w;
          right[v] = w;
          embed(w);
        } else if (edge.side === 1) {
          order[w].splice(order[w].indexOf(right[w]) + 1, 0, v);
        } else {
          order[w].splice(order[w].indexOf(left[w]), 0, v);
          left[w] = v;
        }
      }
    }
    roots.forEach(embed);
    return { order, roots };
  }

  function drawing(count, edges) {
    const result = rotation(count, edges);
    if (!result) return null;
    if (count <= 3) return [[[0, 0], [1, 0], [0.5, 1]].slice(0, count)];
    const { order, roots } = result;
    for (let i = 1; i < roots.length; i++) {
      const a = roots[i - 1];
      const b = roots[i];
      order[a].unshift(b);
      order[b].unshift(a);
    }
    const previous = (list, item) => list[(list.indexOf(item) + list.length - 1) % list.length];
    const next = (a, b) => previous(order[b], a);
    const addDiagonal = (a, b, c) => {
      order[a].splice(order[a].indexOf(b) + 1, 0, c);
      order[c].splice(order[c].indexOf(b), 0, a);
    };
    const visited = new Set();
    const faces = [];
    const key = (a, b) => a * count + b;
    // Connect cut vertices by adding diagonals when a face revisits one.
    order.forEach((list, start) => {
      for (const first of [...list]) {
        if (visited.has(key(start, first))) continue;
        let a = start;
        let b = first;
        visited.add(key(a, b));
        const face = [a];
        for (let c = next(a, b); b !== start || c !== first; c = next(a, b)) {
          if (face.includes(b)) {
            addDiagonal(a, b, c);
            visited.add(key(b, c));
            visited.add(key(c, a));
            b = a;
          } else {
            face.push(b);
          }
          [a, b] = [b, c];
          visited.add(key(a, b));
        }
        faces.push(face);
      }
    });

    const outerFaces = [...faces].sort((a, b) => b.length - a.length).slice(0, 24);
    const original = order.map((list) => [...list]);
    return outerFaces.map((outer) => {
      original.forEach((list, i) => { order[i] = [...list]; });
      for (const face of faces) {
        if (face === outer) continue;
        let [a, b] = face;
        let c = next(a, b);
        for (let d = next(b, c); a !== d; d = next(b, c)) {
          if (order[a].includes(c)) [a, b, c] = [b, c, d];
          else { addDiagonal(a, b, c); [b, c] = [c, d]; }
        }
      }
      return convexDrawing(order, outer);
    });
  }

  function convexDrawing(order, outer) {
    // Tutte drawing. Boundary vertices form a convex polygon and each interior
    // vertex is the average of its neighbors in the augmented embedding.
    const n = order.length;
    const boundary = new Map(outer.map((node, i) => {
      const angle = i * Math.PI * 2 / outer.length;
      return [node, [Math.cos(angle), Math.sin(angle)]];
    }));
    const rows = order.map((neighbors, i) => {
      const row = Array(n + 2).fill(0);
      if (boundary.has(i)) {
        row[i] = 1;
        [row[n], row[n + 1]] = boundary.get(i);
      } else {
        row[i] = neighbors.length;
        neighbors.forEach((node) => { row[node] = -1; });
      }
      return row;
    });
    for (let i = 0; i < n; i++) {
      const pivot = rows[i][i];
      for (let k = i; k < n + 2; k++) rows[i][k] /= pivot;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const factor = rows[j][i];
        for (let k = i; k < n + 2; k++) rows[j][k] -= factor * rows[i][k];
      }
    }
    return rows.map((row) => row.slice(-2));
  }

  globalThis.JiexianDrawing = drawing;
  globalThis.JiexianIsPlanar = (count, edges) => rotation(count, edges) !== null;
})();
