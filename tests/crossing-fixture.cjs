// Reconstructed from the screenshot's 21 labeled centers, 30 edges and two circles.
function crossingScreenshotDraft() {
  const scale = 1090 / 852;
  const world = ([x, y]) => [24 + (x - 150) / scale, 24 + (y - 178) / scale];
  const points = [[268, 298], [290, 381], [174, 386], [274, 201], [177, 513], [172, 651], [172, 243], [392, 476],
    [349, 243], [671, 533], [622, 689], [526, 785], [753, 785], [1079, 778], [767, 652], [709, 710], [911, 723],
    [846, 714], [1071, 455], [801, 309], [1164, 256]].map(world).map(([x, y]) => [
    Math.max(42, Math.min(858, x)), Math.max(42, Math.min(498, y)),
  ]);
  const edges = [[4, 7], [4, 9], [2, 9], [1, 2], [1, 3], [2, 3], [3, 7], [3, 5], [5, 6], [6, 8], [2, 8], [8, 10],
    [8, 12], [10, 11], [10, 15], [10, 14], [11, 12], [11, 16], [12, 13], [13, 14], [13, 18], [15, 16], [16, 18],
    [17, 18], [14, 17], [17, 19], [19, 20], [19, 21], [20, 21], [14, 21]]
    .map(([a, b]) => [Math.min(a, b) - 1, Math.max(a, b) - 1]);
  const obstacles = [[642.5, 317, 122.5], [885.5, 508, 122.5]]
    .map(([x, y, radius]) => ({ center: world([x, y]), r: radius / scale }));
  return { points, edges, obstacles };
}

module.exports = { crossingScreenshotDraft };
