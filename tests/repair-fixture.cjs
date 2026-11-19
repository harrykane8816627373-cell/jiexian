// Reconstructed from the 14-node screenshot using the visible board and node centers.
function screenshotDraft() {
  const world = ([x, y]) => [
    Math.min(858, Math.max(42, 24 + (x - 148.5) * 852 / 1090)),
    Math.min(498, Math.max(42, 24 + (y - 148.8) * 492 / 630)),
  ];
  const points = [[1215, 493], [881.5, 440.5], [912.5, 627.5], [763, 497], [951.5, 397.5], [339, 565.5],
    [1024.5, 423], [683, 171.5], [947.5, 568], [800.5, 755.5], [918.5, 522.5], [1011, 531], [849, 551.5], [837, 622.5]]
    .map(world);
  const edges = [[1, 4], [1, 8], [1, 7], [1, 3], [1, 10], [2, 5], [2, 8], [3, 9], [4, 6], [4, 10], [4, 14],
    [4, 13], [4, 11], [5, 7], [6, 8], [6, 10], [7, 8], [9, 11], [9, 12], [9, 14], [10, 14], [11, 13], [11, 12],
    [13, 14]].map(([a, b]) => [Math.min(a, b) - 1, Math.max(a, b) - 1]);
  const obstacles = [[614, 383.5, 110], [778.5, 405.5, 64.2]].map(([x, y, radius]) =>
    ({ center: world([x, y]), r: radius * 852 / 1090 }));
  return { points, edges, obstacles };
}

module.exports = { screenshotDraft };
