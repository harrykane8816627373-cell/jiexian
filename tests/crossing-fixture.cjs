const edges = [[4, 7], [4, 9], [2, 9], [1, 2], [1, 3], [2, 3], [3, 7], [3, 5], [5, 6], [6, 8], [2, 8], [8, 10],
  [8, 12], [10, 11], [10, 15], [10, 14], [11, 12], [11, 16], [12, 13], [13, 14], [13, 18], [15, 16], [16, 18],
  [17, 18], [14, 17], [17, 19], [19, 20], [19, 21], [20, 21], [14, 21]]
  .map(([a, b]) => [Math.min(a, b) - 1, Math.max(a, b) - 1]);

function fromPixels([left, top], pixels, circles) {
  const scale = 1090 / 852;
  const world = ([x, y]) => [24 + (x - left) / scale, 24 + (y - top) / scale];
  const points = pixels.map(world).map(([x, y]) => [
    Math.max(42, Math.min(858, x)), Math.max(42, Math.min(498, y)),
  ]);
  const obstacles = circles.map(([x, y, radius]) => ({ center: world([x, y]), r: radius / scale }));
  return { points, edges, obstacles };
}

// Reconstructed from each screenshot's labeled centers and two circles.
function crossingScreenshotDraft() {
  return fromPixels([150, 178],
    [[268, 298], [290, 381], [174, 386], [274, 201], [177, 513], [172, 651], [172, 243], [392, 476],
      [349, 243], [671, 533], [622, 689], [526, 785], [753, 785], [1079, 778], [767, 652], [709, 710], [911, 723],
      [846, 714], [1071, 455], [801, 309], [1164, 256]],
    [[642.5, 317, 122.5], [885.5, 508, 122.5]]);
}

function crossingAndClearanceScreenshotDraft() {
  return fromPixels([156, 175],
    [[275, 295], [297, 378], [180, 383], [281, 198], [183, 510], [179, 648], [179, 240], [399, 473], [356, 241],
      [681, 541], [545, 665], [442, 781], [572, 777], [1122, 774], [773, 650], [649, 725], [928, 687], [810, 735],
      [1090, 446], [884, 327], [1171, 254]],
    [[649.5, 314.5, 122.5], [892.5, 505.5, 122.5]]);
}

module.exports = { crossingScreenshotDraft, crossingAndClearanceScreenshotDraft };
