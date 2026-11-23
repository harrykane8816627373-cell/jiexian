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

function contactFans(g, separated) {
  const hubs = separated ? [[110, 145], [510, 145], [110, 385], [510, 385]] : [[128, 270]];
  const leaves = separated ? 4 : 12;
  const spread = separated ? .44 : .74;
  const reach = separated ? 185 : 325;
  const points = [], edges = [], obstacles = [];
  for (const [x, y] of hubs) {
    const hub = points.length;
    points.push([x, y]);
    obstacles.push({ center: [x + 5, y], r: 28 });
    for (let i = 0; i < leaves; i++) {
      const angle = -spread + 2 * spread * i / (leaves - 1);
      edges.push([hub, points.length]);
      points.push([x + 72 + reach * Math.cos(angle), y + reach * Math.sin(angle)]);
    }
  }
  return g.createLevel({ points, edges, obstacles, controls: points.map((point, i) => g.free(i, point)) });
}

const denseContactCases = new Map([
  ['seeded-single-fan', (g) => contactFans(g, false)],
  ['seeded-separated-fans', (g) => contactFans(g, true)],
]);

module.exports = { corridorLevel, denseContactCases };
