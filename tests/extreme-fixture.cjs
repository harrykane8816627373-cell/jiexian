'use strict';

const { interruptedNode19Draft } = require('./node19-fixture.cjs');
const { eightDiskCorridorDraft } = require('./eight-corridor-fixture.cjs');

function perturb(g, draft, strength, seed) {
  const renumber = seed % 2 === 1;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const move = (point, reach) => point.map((value, axis) => g.clamp(value + (2 * random() - 1) * reach,
    g.margin, (axis ? g.height : g.width) - g.margin));
  const points = draft.points.map((point) => move(point, strength / 2));
  const obstacles = draft.obstacles.map(({ center, r }) => ({ center: move(center, strength), r }));
  if (!renumber) return { points, edges: draft.edges, obstacles };

  const order = points.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const index = new Int32Array(order.length);
  order.forEach((node, i) => { index[node] = i; });
  const edges = draft.edges.map(([a, b]) => [index[a], index[b]]).reverse();
  return { points: order.map((node) => points[node]), edges, obstacles };
}

const extremeCases = new Map([
  ['pocket-20-seed103', [interruptedNode19Draft, 20, 103]],
  ['pocket-36-seed103', [interruptedNode19Draft, 36, 103]],
  ['pocket-50-seed103', [interruptedNode19Draft, 50, 103]],
  ['pocket-60-seed103', [interruptedNode19Draft, 60, 103]],
  ['pocket-30-seed107', [interruptedNode19Draft, 30, 107]],
  ['pocket-25-seed109', [interruptedNode19Draft, 25, 109]],
  ['pocket-40-seed109', [interruptedNode19Draft, 40, 109]],
  ['corridor-42-seed107', [eightDiskCorridorDraft, 42, 107]],
  ['corridor-42-seed107-reflected', [eightDiskCorridorDraft, 42, 107, true]],
]);
const recoveryCases = [...extremeCases.keys()];

function extremeDraft(g, name) {
  const [createDraft, strength, seed, reflected] = extremeCases.get(name);
  const draft = perturb(g, createDraft(), strength, seed);
  if (!reflected) return draft;
  const reflect = ([x, y]) => [g.width - x, y];
  return { ...draft, points: draft.points.map(reflect),
    obstacles: draft.obstacles.map((disk) => ({ ...disk, center: reflect(disk.center) })) };
}

module.exports = { extremeCases, recoveryCases, extremeDraft };
