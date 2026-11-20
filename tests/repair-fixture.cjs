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

// Reconstructed from the 15-node screenshot whose only dashed edge is 2–5.
function coupledScreenshotDraft() {
  const world = ([x, y]) => [
    Math.min(858, Math.max(42, 24 + (x - 156.5) * 852 / 1090)),
    Math.min(498, Math.max(42, 24 + (y - 181.9) * 492 / 630)),
  ];
  const points = [[1169.5, 497], [1146.5, 744.5], [426, 690.5], [515.5, 715.5], [309, 399.5], [1014, 460],
    [297, 664.3], [364, 657.5], [646, 708.2], [540.3, 623.8], [329.5, 580.5], [227.3, 788.6], [940.5, 331.8],
    [940.3, 609.8], [713.6, 708.3]].map(world);
  const edges = [[1, 2], [1, 13], [2, 5], [2, 6], [2, 12], [2, 15], [3, 4], [3, 5], [3, 8], [3, 12],
    [4, 5], [4, 9], [4, 10], [4, 12], [5, 10], [5, 11], [5, 12], [5, 15], [6, 14], [7, 11], [7, 12], [8, 11],
    [8, 12], [9, 10], [9, 15], [13, 14]].map(([a, b]) => [a - 1, b - 1]);
  const obstacles = [{ center: world([771.1, 630.3]), r: 73 * 852 / 1090 }];
  return { points, edges, obstacles };
}

function mixedScreenshotDraft() {
  const draft = coupledScreenshotDraft();
  draft.points[1] = [24 + (872.5 - 156.5) * 852 / 1090, 24 + (722.5 - 169.9) * 492 / 630];
  return draft;
}

// Approximate layout of the 27-node screenshot. Circle two is just clear of node 14.
function contactScreenshotDraft() {
  const world = ([x, y]) => [
    Math.min(858, Math.max(42, 24 + (x - 153) * 852 / 1090)),
    Math.min(498, Math.max(42, 24 + (y - 181.25) * 492 / 630)),
  ];
  const points = [[529.1, 788.3], [345.3, 320.8], [967.3, 619.1], [1036.1, 694.6], [797.3, 788.3], [497.5, 646.7],
    [446.1, 204.4], [742.4, 267.3], [881.7, 650.5], [566.3, 725.1], [702.6, 717.9], [176.2, 337.9], [340.4, 583.1],
    [539.8, 261.9], [234.1, 631], [195.6, 785], [176.1, 568.7], [330.2, 662.3], [1147.2, 614.9], [635.8, 748.3],
    [1197.5, 518.9], [1070.7, 545.2], [972, 375], [873.3, 312], [1016.7, 445.5], [381, 722.9], [487.3, 722.9]].map(world);
  const edges = [[1, 16], [1, 5], [1, 10], [1, 27], [2, 12], [2, 7], [3, 8], [3, 4], [3, 9], [3, 13], [4, 5], [4, 19],
    [5, 9], [5, 11], [6, 9], [6, 13], [6, 18], [6, 26], [6, 11], [6, 10], [7, 14], [8, 14], [8, 24], [10, 20], [12, 13],
    [13, 15], [13, 17], [15, 17], [15, 16], [15, 18], [19, 21], [19, 22], [21, 25], [23, 24], [23, 25], [26, 27]]
    .map(([a, b]) => [a - 1, b - 1]);
  const obstacles = [[368.1, 445.7, 89.2], [527.1, 354.3, 69.59], [712.5, 393, 78.6], [489.1, 523.2, 63],
    [634.8, 514.5, 68.8], [795.8, 520.2, 60.5], [272.1, 707.1, 50.2], [352.2, 691.6, 67.8]]
    .map(([x, y, radius]) => ({ center: world([x, y]), r: radius * 852 / 1090 }));
  return { points, edges, obstacles };
}

function perturbedContactDraft(sample, amount) {
  const draft = contactScreenshotDraft();
  const points = draft.points.map((point, i) => point.map((value, axis) =>
    Math.min(axis ? 498 : 858, Math.max(42, value + amount * Math.sin(sample * 31 + i * 47 + axis * 11)))));
  const obstacles = draft.obstacles.map(({ center, r }, i) => ({
    center: center.map((value, axis) => value + .7 * amount * Math.cos(sample * 47 + i * 97 + axis * 3)),
    r: r + .5 * amount * Math.sin(sample * 7 + i * 61),
  }));
  return { ...draft, points, obstacles };
}

function corridorScreenshotDraft() {
  const world = ([x, y]) => [
    Math.min(858, Math.max(42, 24 + (x - 150.3) * 852 / 1090)),
    Math.min(498, Math.max(42, 24 + (y - 177.2) * 492 / 630)),
  ];
  const points = [[1217.7, 471.7], [173.5, 784.4], [884.5, 445.1], [941.8, 387.2], [1086.8, 283.1], [1034.7, 519.4],
    [173.45, 677.8], [204.05, 488], [930.9, 579.75], [1105.3, 602.9], [1093, 404.8], [239.2, 608.1], [837.6, 730.9],
    [196.35, 541.9], [1113.75, 784.4], [1217.65, 708], [977.1, 713.5], [1029.2, 619.15], [915.7, 250.7],
    [1140.6, 673.4], [757.7, 214.1], [857.1, 353.9], [367.8, 264.35], [230.6, 332.45], [539.3, 203.25],
    [1106.15, 525.85], [1141.85, 457.6]].map(world);
  const obstacles = [[381.3, 421, 99.8], [618, 339.6, 86.2], [503.2, 584.2, 80.7], [715.6, 567.2, 76.3]]
    .map(([x, y, radius]) => ({ center: world([x, y]), r: radius * 852 / 1090 }));
  return { points, edges: contactScreenshotDraft().edges, obstacles };
}

module.exports = {
  screenshotDraft, coupledScreenshotDraft, mixedScreenshotDraft, contactScreenshotDraft, perturbedContactDraft, corridorScreenshotDraft,
};
