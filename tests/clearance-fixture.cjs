function corridorLevel(g, { halfGap, shift, rightShift = 0 }) {
  const points = [[112.341, 270 + shift], [791.877, 270 + rightShift]];
  const edges = [[0, 1]];
  const columns = [110, 186, 720, 790];
  for (const [row, y] of [62, 119, 177, 388, 434, 487].entries()) {
    const start = points.length;
    for (const [column, x] of columns.entries()) {
      const index = points.length;
      points.push([x + Math.sin(index) * 2, y + Math.cos(index) * 1.3]);
      if (column % 2) edges.push([index - 1, index]);
      if (row > 0 && row !== 3 && column % 2 === 0) edges.push([index - columns.length, index]);
    }
    if (row === 2 || row === 3) edges.push([0, start], [1, start + 3]);
  }
  const obstacles = [212 - halfGap, 328 + halfGap].map((y) => ({ center: [450, y], r: 54 }));
  return g.createLevel({ points, edges, obstacles, controls: points.map((point, i) => g.free(i, point)) });
}

module.exports = { corridorLevel };
