(function () {
  'use strict';

  const min = (a, b) => a < b ? a : b;
  const max = (a, b) => a > b ? a : b;
  const square = (x) => x * x;
  const abs = (x) => x < 0n ? -x : x;
  const dot = ([x, y], [u, v]) => x * u + y * v;
  const normal = ([x, y], [u, v]) => x * v - y * u;

  function ceilSqrt(value) {
    if (value < 2n) return value;
    let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
    while (true) {
      const next = (root + value / root) / 2n;
      if (next >= root) return square(root) === value ? root : root + 1n;
      root = next;
    }
  }

  function rootBounds(value) {
    if (value <= 0n) return [0n, 0n];
    const upper = ceilSqrt(value);
    return [square(upper) === value ? upper : upper - 1n, upper];
  }

  function direction(a, b) {
    let [x, y] = b.map((v, i) => v - a[i]);
    if (!x && !y) return [1n, 0n];
    if (x < 0n || !x && y < 0n) [x, y] = [-x, -y];
    let u = abs(x), v = abs(y);
    while (v) [u, v] = [v, u % v];
    return [x / u, y / u];
  }

  function availableIntervals(lo, hi, blocked) {
    const available = [];
    let start = lo;
    blocked.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [a, b] of blocked) {
      if (b <= start) continue;
      if (a >= hi) break;
      if (start <= a) available.push([start, a]);
      start = b;
      if (start > hi) return available;
    }
    if (start <= hi) available.push([start, hi]);
    return available;
  }

  function nextPosition(domain, from) {
    let lo = 0, hi = domain.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (domain[mid][1] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < domain.length ? max(domain[lo][0], from) : null;
  }

  function placeOnTrack(domain, count, gap) {
    if (!domain.length) return null;
    let from = domain[0][0];
    const slots = [];
    for (let i = 0; i < count; i++) {
      const x = nextPosition(domain, from);
      if (x === null) return null;
      slots.push(x);
      from = x + gap;
    }
    return slots;
  }

  const reverseDomain = (domain) => [...domain].reverse().map(([lo, hi]) => [-hi, -lo]);

  function trackDomains(track, stationary, segments, spacing) {
    const { a, b, along, norm, offset, members } = track;
    const [stepLow, stepHigh] = rootBounds(square(spacing) * norm);
    const low = [], high = [];
    let exact = stepLow === stepHigh;
    function exclude(start, end, delta, distance) {
      const [inner, outer] = rootBounds(square(distance) * norm - square(delta));
      if (!outer) return;
      if (inner || start !== end) low.push([start - inner, end + inner]);
      high.push([start - outer, end + outer]);
      exact &&= inner === outer;
    }
    for (const [point, d] of stationary) {
      const x = dot(along, point);
      exclude(x, x, normal(along, point) - offset, d);
    }
    for (const [p, q, d] of segments) {
      const offsetP = normal(along, p);
      if (offsetP !== normal(along, q)) continue;
      const x = dot(along, p), y = dot(along, q);
      exclude(min(x, y), max(x, y), offsetP - offset, d);
    }
    const x = dot(along, a), y = dot(along, b);
    const lo = min(x, y), hi = max(x, y);
    const relaxed = availableIntervals(lo, hi, low);
    const relaxedSlots = placeOnTrack(relaxed, members.length, stepLow);
    if (!relaxedSlots) return false;
    const [back] = placeOnTrack(reverseDomain(relaxed), members.length, stepLow);
    // Use the full unary domains in ordering. The hull is also a bound for the algebraic solver.
    track.bounds = [relaxedSlots[0], -back];
    track.relaxed = relaxed;
    track.tightened = exact ? relaxed : availableIntervals(lo, hi, high);
    track.relaxedSlots = relaxedSlots;
    track.stepLow = stepLow;
    track.stepHigh = stepHigh;
    track.exact = exact;
    return true;
  }

  function buildTracks(level, points, owners, units, spacing, nodeLimits, nodeEdge) {
    const groups = new Map();
    const rails = level.controls.map(({ kind, a, b }, index) => {
      if (kind !== 'rail') return null;
      a = a.map(units);
      b = b.map(units);
      const key = [String(a), String(b)].sort().join('/');
      if (!groups.has(key)) {
        const along = direction(a, b);
        groups.set(key, { a, b, along, orientation: String(along), norm: dot(along, along),
          offset: normal(along, a), members: [] });
      }
      const track = groups.get(key);
      track.members.push(index);
      return { track, a, b, start: dot(track.along, a), end: dot(track.along, b) };
    });
    const tracks = [...groups.values()];
    if (!tracks.length) return { rails, tracks };
    const stationary = owners.flatMap((owner, i) => owner === -1 ?
      [[points[i], i < level.points.length ? spacing : units(nodeLimits[i - level.points.length])]] : []);
    const segments = level.edges.filter(([i, j]) => owners[i] === -1 && owners[j] === -1)
      .map(([i, j]) => [points[i], points[j], nodeEdge]);
    for (const track of tracks) {
      const { a, b, norm, members } = track;
      const length = dot(track.along, b) - dot(track.along, a);
      if (square(length) < square(BigInt(members.length - 1) * spacing) * norm ||
          !trackDomains(track, stationary, segments, spacing)) return null;
    }
    return { rails, tracks };
  }

  function parameter(rail, coordinate) {
    if (rail.start === rail.end) return [0n, 1n];
    return rail.start < rail.end ? [coordinate - rail.start, rail.end - rail.start] :
      [rail.start - coordinate, rail.start - rail.end];
  }

  function parameterBounds(rail) {
    const bounds = rail.start <= rail.end ? rail.track.bounds : [...rail.track.bounds].reverse();
    return bounds.map((x) => parameter(rail, x));
  }

  function motionBox(rail) {
    const [start, end] = parameterBounds(rail);
    return rail.a.map((a, axis) => {
      const delta = rail.b[axis] - a;
      const [lower, upper] = delta >= 0n ? [start, end] : [end, start];
      const project = ([n, d], ceil) => {
        const product = delta * n;
        const remainder = product % d;
        const rounding = ceil && remainder > 0n ? 1n : !ceil && remainder < 0n ? -1n : 0n;
        return a + product / d + rounding;
      };
      return [project(lower, false), project(upper, true)];
    });
  }

  function approximateParameter(rail, coordinate) {
    const [n, d] = parameter(rail, coordinate);
    if (!n) return 0;
    const places = 24 + String(d).length - String(n).length;
    return Number(`${n * 10n ** BigInt(places) / d}e-${places}`);
  }

  function bufferedDomain(track, buffer) {
    const a = dot(track.along, track.a), b = dot(track.along, track.b);
    const start = min(a, b), end = max(a, b);
    return track.tightened.map(([lo, hi]) => [lo > start ? lo + buffer : lo, hi < end ? hi - buffer : hi])
      .filter(([lo, hi]) => lo <= hi);
  }

  function parallelGaps(tracks, spacing) {
    let exact = true;
    const gaps = tracks.map((track, i) => tracks.map((other, j) => {
      if (i === j) return [track.stepLow, track.stepHigh];
      const range = rootBounds(square(spacing) * track.norm - square(track.offset - other.offset));
      exact &&= range[0] === range[1];
      return range;
    }));
    return { gaps, exact };
  }

  function schedule(tracks, gaps, useTightened, budget, buffer = 0n) {
    const choice = useTightened ? 1 : 0;
    const weight = gaps.map((row) => row.map((bounds) => bounds[choice] ? bounds[choice] + buffer : 0n));
    const domains = tracks.map((track) => buffer ? bufferedDomain(track, buffer) :
      useTightened ? track.tightened : track.relaxed);
    const remaining = tracks.map(({ members }) => members.length);
    const latest = domains.map((domain, i) => {
      if (!domain.length) return [null];
      const backwards = reverseDomain(domain);
      let from = backwards[0][0];
      const result = [null];
      for (let n = 1; n <= remaining[i]; n++) {
        const x = nextPosition(backwards, from);
        if (x === null) break;
        result.push(-x);
        from = x + weight[i][i];
      }
      return result;
    });
    if (latest.some((last, i) => last[remaining[i]] === undefined)) return { status: 'unsat' };

    const total = remaining.reduce((sum, count) => sum + count, 0);
    const sequences = tracks.map(() => []);
    const failures = new Map();
    const initial = domains.map((domain) => domain[0][0]);
    const smallestGap = weight.flat().reduce(min);
    const rightmost = latest.map((last) => last[1]).reduce(max);
    let span = BigInt(total - 1) * smallestGap;
    for (let i = 0; i < tracks.length; i++) {
      // All other nodes can split this track into at most total - remaining[i] + 1 runs.
      const forcedNeighbors = Math.max(0, 2 * remaining[i] - total - 1);
      span += BigInt(forcedNeighbors) * (weight[i][i] - smallestGap);
    }
    if (initial.reduce(min) + span > rightmost) return { status: 'unsat' };

    function dominates(a, b) {
      return a.every((x, i) => !remaining[i] || x <= b[i]);
    }

    function search(lower, left) {
      if (!left) return 'solved';
      if (budget-- <= 0) return 'unknown';
      const key = remaining.join(',');
      const known = failures.get(key) ?? [];
      if (known.some((old) => dominates(old, lower))) return 'unsat';
      const choices = [];
      for (let i = 0; i < tracks.length; i++) {
        if (!remaining[i]) continue;
        const x = nextPosition(domains[i], lower[i]);
        if (x === null || x > latest[i][remaining[i]]) return 'unsat';
        choices.push({ index: i, x, slack: latest[i][remaining[i]] - x });
      }
      choices.sort((a, b) => a.slack < b.slack ? -1 : a.slack > b.slack ? 1 : a.index - b.index);
      for (const { index, x } of choices) {
        remaining[index]--;
        sequences[index].push(x);
        const result = search(lower.map((value, i) => max(value, x + weight[index][i])), left - 1);
        if (result === 'solved') return result;
        sequences[index].pop();
        remaining[index]++;
        if (result === 'unknown') return result;
      }
      failures.set(key, [...known.filter((old) => !dominates(lower, old)), lower]);
      return 'unsat';
    }

    const status = search(initial, total);
    return status === 'solved' ? { status, sequences } : { status };
  }

  function solveParallel(tracks, spacing, canUseSolution) {
    // A small stricter trial gives the rounded game coordinates room at pair boundaries.
    const buffer = max(1n, tracks[0].stepHigh / 1_000_000_000n);
    if (tracks.length === 1) {
      const track = tracks[0];
      const slots = placeOnTrack(bufferedDomain(track, buffer), track.members.length, track.stepHigh + buffer) ??
        placeOnTrack(track.tightened, track.members.length, track.stepHigh);
      return slots ? { status: 'solved', sequences: [slots] } : { status: 'unknown' };
    }
    const { gaps, exact } = parallelGaps(tracks, spacing);
    const sameModel = exact && tracks.every((track) => track.exact);
    if (canUseSolution) {
      const playable = schedule(tracks, gaps, true, 1000, buffer);
      if (playable.status === 'solved') return playable;
      const result = schedule(tracks, gaps, true, 8000);
      if (sameModel || result.status === 'solved') return result;
    }
    const result = schedule(tracks, gaps, false, canUseSolution ? 8000 : 1500);
    return result.status === 'unsat' ? result : { status: 'unknown' };
  }

  function supports(record, rails, points, owners) {
    const [a, b] = record.vertices;
    const track = rails[record.support[0]].track;
    if (record.kind === 'distance') return true;
    return record.kind === 'segment' && owners[a] === -1 && owners[b] === -1 &&
      normal(track.along, points[a]) === normal(track.along, points[b]);
  }

  globalThis.JiexianSolverTracks = { ceilSqrt, buildTracks, motionBox, parameterBounds, approximateParameter, solveParallel, supports };
})();
