(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const { analyze } = globalThis.JiexianSolverGeometry;
  const call = (op, ...args) => `(${op} ${args.join(' ')})`;
  const add = (...args) => call('+', ...args);
  const sub = (a, b) => call('-', a, b);
  const mul = (a, b) => call('*', a, b);
  const square = (a) => mul(a, a);
  const and = (...args) => call('and', ...args);
  const or = (...args) => call('or', ...args);
  const vector = (a, b) => a.map((x, i) => sub(x, b[i]));
  const dot = ([x, y], [u, v]) => add(mul(x, u), mul(y, v));
  const cross = ([x, y], [u, v]) => sub(mul(x, v), mul(y, u));
  const normSquared = ([x, y]) => add(square(x), square(y));

  function real(value) {
    // SMT-LIB decimal numerals have no exponent or sign.
    const [mantissa, exponent = '0'] = Math.abs(value).toString().split('e');
    const [integer, fraction = ''] = mantissa.split('.');
    const digits = integer + fraction;
    const place = integer.length + Number(exponent);
    const decimal = place <= 0 ? '0.' + '0'.repeat(-place) + digits :
      place >= digits.length ? digits.padEnd(place, '0') : digits.slice(0, place) + '.' + digits.slice(place);
    return value < 0 ? call('-', decimal) : decimal;
  }

  function segmentClear(p, a, b, distance, checkA, checkB) {
    const ab = vector(b, a);
    const ap = vector(p, a);
    const bp = vector(p, b);
    const limit = square(real(distance));
    // Copositivity of the two-endpoint quadratic form. Use the 2D Gram identity
    // for its determinant, which also covers coincident endpoints without a division.
    const endpoints = [];
    if (checkA) endpoints.push(call('>=', normSquared(ap), limit));
    if (checkB) endpoints.push(call('>=', normSquared(bp), limit));
    const middle = or(call('>=', dot(ap, bp), limit),
      call('>=', square(cross(ab, ap)), mul(limit, normSquared(ab))));
    return endpoints.length ? and(...endpoints, middle) : middle;
  }

  function sameSide(a, b, c, d) {
    const u = cross(vector(b, a), vector(c, a));
    const v = cross(vector(b, a), vector(d, a));
    return or(and(call('>=', u, '0'), call('>=', v, '0')), and(call('<=', u, '0'), call('<=', v, '0')));
  }

  function buildModel(level, coordinates, railBounds, part) {
    const setup = ['(set-logic QF_NRA)', '(set-option :produce-models true)',
      '(set-option :pp.decimal true)', '(set-option :pp.decimal_precision 30)'];
    const define = (name, sort, expr) => {
      setup.push(`(define-fun ${name} () ${sort} ${expr})`);
      return name;
    };
    const points = coordinates.map((point) => point.map(real));
    const assert = (expr) => setup.push(call('assert', expr));
    const bounded = (name, lower, upper) => assert(lower === upper ? call('=', name, lower) :
      and(call('<=', lower, name), call('<=', name, upper)));
    const fraction = ([n, d]) => {
      if (!n) return '0';
      if (n === d) return '1';
      return n < 0n ? call('-', call('/', String(-n), String(d))) : call('/', String(n), String(d));
    };
    const { translation, axisMotion } = part;
    const shifts = ['shiftX', 'shiftY'];
    if (translation) {
      for (const name of shifts) {
        setup.push(`(declare-const ${name} Real)`);
        bounded(name, real(-translation.radius), real(translation.radius));
      }
    }
    const controls = part.controls.map((i) => {
      const control = level.controls[i];
      const { kind, members: [node, partner] } = control;
      const names = kind === 'rail' ? [`x${i}`] : [`x${i}`, `y${i}`];
      names.forEach((name, axis) => {
        if (translation) define(name, 'Real', add(real(translation.pose[i][axis]), shifts[axis]));
        else if (axisMotion && axis !== axisMotion.axis) define(name, 'Real', real(axisMotion.pose[i][axis]));
        else setup.push(`(declare-const ${name} Real)`);
      });
      const [x, y] = names;
      if (kind === 'rotor') {
        // Every point (x, y) of the unit circle is (cos θ, sin θ) for one common rotation θ.
        assert(call('=', normSquared(names), '1'));
        const center = control.center.map(real);
        for (const member of control.members) {
          const [dx, dy] = vector(points[member], center);
          points[member] = [add(center[0], sub(mul(dx, x), mul(dy, y))), add(center[1], mul(dx, y), mul(dy, x))];
        }
      } else if (kind === 'rail') {
        const [lo, hi] = railBounds[i]?.map(fraction) ?? ['0', '1'];
        bounded(x, lo, hi);
        points[node] = control.a.map((start, axis) => add(real(start), mul(x, sub(real(control.b[axis]), real(start)))));
      } else {
        points[node] = names;
        if (kind === 'mirror') points[partner] = control.sum.map((sum, axis) => sub(real(sum), names[axis]));
        for (const member of control.members) {
          bounded(points[member][0], real(g.margin), real(g.width - g.margin));
          bounded(points[member][1], real(g.margin), real(g.height - g.margin));
        }
      }
      for (const member of control.members) {
        points[member] = points[member].map((expr, axis) => define(`p${member}_${axis}`, 'Real', expr));
      }
      const cut = part.cuts?.get(i);
      if (cut) {
        assert(or(...cut.boxes.map((box) => and(...box.flatMap(([lo, hi], axis) =>
          [call('<=', fraction([lo, cut.scale]), names[axis]), call('<=', names[axis], fraction([hi, cut.scale]))])))));
      }
      const neighborhood = part.neighborhood?.get(i);
      if (neighborhood) {
        neighborhood.forEach(([lo, hi], axis) => bounded(names[axis], real(lo), real(hi)));
      }
      return { index: i, names };
    });

    const pair = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
    const separation = new Map();
    for (const { kind, vertices: [a, b], distance } of part.records) {
      if (kind !== 'distance') continue;
      const key = pair(a, b);
      separation.set(key, Math.max(distance, separation.get(key) ?? 0));
    }
    const checksEndpoint = (a, p, gap) => (separation.get(pair(a, p)) ?? 0) < gap;
    const constraints = part.records.map((record, i) => {
      const { kind, vertices, distance, support } = record;
      const [a, b, c, d] = vertices.map((node) => points[node]);
      const formula = kind === 'distance' ? call('>=', normSquared(vector(a, b)), square(real(distance))) :
        kind === 'segment' ? segmentClear(c, a, b, distance, checksEndpoint(vertices[0], vertices[2], distance),
          checksEndpoint(vertices[1], vertices[2], distance)) : or(sameSide(a, b, c, d), sameSide(c, d, a, b));
      return { name: define(`clear${i}`, 'Bool', formula), unary: support.length === 1, record };
    });
    return { setup, constraints, controls };
  }

  function modelValues(query, names) {
    if (!names.length) return new Map();
    const reply = query(`(get-value (${names.join(' ')}))`);
    const values = new Map([...reply.matchAll(/\((\w+)\s+((?:\(-\s+[^()]+\)|[^()\s]+))\)/g)]
      .map(([, name, value]) => [name, value]));
    if (names.some((name) => !values.has(name))) throw new Error('Incomplete Z3 model');
    return values;
  }

  function numberFromModel(value) {
    const negative = value.startsWith('(-');
    const decimal = negative ? value.slice(2, -1).trim() : value;
    const number = Number(decimal.replace(/\?$/, ''));
    if (!Number.isFinite(number)) throw new Error('Unexpected Z3 model numeral');
    return negative ? -number : number;
  }

  function solvePart(level, coordinates, railBounds, part, query, state, preferred, limit) {
    const { setup, constraints, controls } = buildModel(level, coordinates, railBounds, part);
    const first = [], pending = [];
    // A small local model usually costs less to solve once than to refine.
    const smallNeighborhood = part.neighborhood?.size && constraints.length <= 12;
    let prioritized = 0;
    for (const { name, unary, record } of constraints) {
      if (smallNeighborhood || unary || preferred?.has(record) && prioritized++ < 24) first.push(name);
      else pending.push(name);
    }
    const enforce = (names) => {
      for (let i = 0; i < names.length; i += 256) {
        query(names.slice(i, i + 256).map((name) => call('assert', name)).join('\n'));
      }
    };
    for (let i = 0; i < setup.length; i += 64) query(setup.slice(i, i + 64).join('\n'));
    if (limit) query('(set-option :rlimit 80000)');
    enforce(first);
    for (let pass = 0; !limit || pass < 4; pass++) {
      // Use NLSat on every relaxation, including after adding assertions.
      const result = query('(check-sat-using qfnra-nlsat)');
      if (result !== 'sat') return result === 'unsat' ? 'unsat' : 'unknown';

      // Test omitted predicates on the exact algebraic model, never on rounded coordinates.
      const conflicts = new Set();
      for (let i = 0; i < pending.length; i += 256) {
        for (const [name, value] of modelValues(query, pending.slice(i, i + 256))) {
          if (value === 'false') conflicts.add(name);
          else if (value !== 'true') throw new Error('Unevaluated constraint in Z3 model');
        }
      }
      if (!conflicts.size) {
        const values = modelValues(query, controls.flatMap(({ names }) => names));
        for (const { index, names } of controls) {
          const value = names.map((name) => numberFromModel(values.get(name)));
          const control = level.controls[index];
          state[index] = g.normalize(control, control.kind === 'rotor' ? [Math.atan2(value[1], value[0])] : value);
        }
        return 'sat';
      }
      enforce([...conflicts]);
      let remaining = 0;
      for (const name of pending) {
        if (!conflicts.has(name)) pending[remaining++] = name;
      }
      pending.length = remaining;
    }
    return 'unknown';
  }

  const playable = (level, state) => !g.evaluate(level, g.positions(level, state)).count;

  function violations(part, points) {
    const failed = [];
    for (const record of part.records) {
      const [a, b, c, d] = record.vertices.map((i) => points[i]);
      const blocked = record.kind === 'distance' ? g.distance(a, b) < record.distance :
        record.kind === 'segment' ? g.distanceToSegment(c, a, b) < record.distance : g.segmentsCross(a, b, c, d);
      if (blocked) failed.push(record);
    }
    return failed;
  }

  function smallestSupports(conflicts, required) {
    const choices = [];
    const seen = new Set();
    function visit(active) {
      const key = [...active].sort((a, b) => a - b).join(',');
      if (seen.has(key)) return;
      seen.add(key);
      const hit = conflicts.find(({ support }) => !support.some((i) => active.has(i)));
      if (!hit) choices.push(active);
      else if (active.size < 2) for (const i of hit.support) visit(new Set([...active, i]));
    }
    visit(new Set(required));
    return choices.sort((a, b) => a.size - b.size);
  }

  function restrictedPart(level, part, active, pose, points, radius) {
    const controls = part.controls.filter((i) => active.has(i));
    const neighborhood = new Map(), motion = new Map();
    if (radius) {
      for (const i of controls) {
        const { kind, a, b } = level.controls[i];
        if (kind === 'rotor') return null;
        const delta = kind === 'rail' ? radius / g.distance(a, b) : radius;
        if (!Number.isFinite(delta)) return null;
        const bounds = pose[i].map((value) => [value - delta, value + delta]);
        neighborhood.set(i, bounds);
        motion.set(i, kind === 'rail' ? radius : Math.SQRT2 * radius);
      }
    }
    function safelyFar({ kind, vertices, distance }) {
      const [a, b, c, d] = vertices.map((i) => points[i]);
      const [moveA, moveB, moveC, moveD] = vertices.map((i) => motion.get(level.ownership[i]) ?? 0);
      // Distance between compact sets is 1-Lipschitz in the Hausdorff distance of each set.
      // For a segment the Hausdorff displacement is bounded by the larger endpoint displacement.
      if (kind === 'distance') return g.distance(a, b) > distance + moveA + moveB + 1e-6;
      const extent = Math.max(moveA, moveB) + (kind === 'segment' ? moveC : Math.max(moveC, moveD)) + 1e-6;
      if (kind === 'segment') return g.distanceToSegment(c, a, b) > distance + extent;
      return !g.segmentsCross(a, b, c, d) &&
        Math.min(g.distanceToSegment(a, c, d), g.distanceToSegment(b, c, d),
          g.distanceToSegment(c, a, b), g.distanceToSegment(d, a, b)) > extent;
    }
    const records = part.records.flatMap((record) => {
      const support = record.support.filter((i) => active.has(i));
      return support.length && (!radius || !safelyFar(record)) ? [{ ...record, support }] : [];
    });
    return { ...part, controls, records, neighborhood };
  }

  function* blockNeighborhoods(level, part, active, failed, pose, points, radius, triedAll) {
    const local = restrictedPart(level, part, active, pose, points, radius);
    if (!local) return;
    if (local.controls.every((i) => level.controls[i].kind === 'free')) {
      // Relative geometry within a translated block is constant.
      const internal = ({ vertices }) => vertices.every((i) => active.has(level.ownership[i]));
      if (!failed.some(internal)) {
        yield { ...local, translation: { pose, radius }, records: local.records.filter((record) => !internal(record)) };
      }
      const blockedEdge = failed.find(({ kind, vertices: [a, b, p] }) =>
        kind === 'segment' && p >= level.points.length && active.has(level.ownership[a]) && active.has(level.ownership[b]));
      if (blockedEdge) {
        const [a, b] = blockedEdge.vertices.map((i) => points[i]);
        const axis = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 1 : 0;
        yield { ...local, axisMotion: { pose, axis } };
      }
    }
    if (!triedAll) yield local;
  }

  function prepareExact(level, current = level.initial) {
    const problem = analyze(level);
    if (problem.unsat) return { status: 'unsat' };
    const state = current.map((value, i) => g.normalize(level.controls[i], value));
    for (const [index, value] of problem.packed) state[index] = value;
    if (!problem.parts.length) {
      if (playable(level, state)) return { status: 'solved', state };
      if (!problem.retryParts.length) return { status: 'precision' };
    }
    return { status: 'ready', ...problem, state };
  }

  function solveExact(level, ask, problem = prepareExact(level), seed) {
    if (problem.status !== 'ready') return problem;
    const { coordinates, railBounds, parts, retryParts } = problem;
    const state = g.copy(problem.state);
    let checks = 0;
    const query = (command) => {
      const reply = ask(command).trim();
      if (reply.startsWith('(error')) throw new Error(reply);
      return reply;
    };
    const solve = (part, points, target, preferred, limited = false) => {
      if (checks++) query('(reset)');
      const result = solvePart(level, points, railBounds, part, query, target, preferred, limited);
      if (limited) query('(set-option :rlimit 0)');
      return result;
    };
    let seedPoints;
    const reusable = [];
    if (seed) {
      const trial = g.copy(seed);
      for (const [i, value] of problem.packed) trial[i] = value;
      const centers = coordinates.slice(level.points.length);
      const positions = () => [...g.positions(level, trial), ...centers];
      const limits = railBounds.map((range) => range?.map(([n, d]) => Number(n) / Number(d)));
      const outside = (part) => part.controls.filter((i) => {
        const range = limits[i];
        return range && (trial[i][0] < range[0] || trial[i][0] > range[1]);
      });
      seedPoints = positions();

      // A small exact repair is useful when the heuristic has left nearly all controls in a good place.
      // The unrestricted problem below still decides every failure of this restricted attempt.
      let attempts = 0;
      let smallAttempts = 0;
      let blockAttempts = 0;
      for (const part of parts) {
        if (attempts >= 3) break;
        const failed = violations(part, seedPoints);
        const required = outside(part);
        const active = new Set([...required, ...failed.flatMap(({ support }) => support)]);
        const frozenPoints = (selected) => coordinates.map((point, i) =>
          selected.has(level.ownership[i]) ? point : seedPoints[i]);
        const tryWitness = (local, selected) => {
          const proposed = g.copy(trial);
          if (solve(local, frozenPoints(selected), proposed, null, true) === 'sat' && playable(level, proposed)) {
            return { status: 'solved', state: proposed, preserveRepair: true };
          }
          return null;
        };
        if (level.obstacles.length && failed.length && failed.length <= 8 && required.length <= 2) {
          // Every current conflict must lose at least one frozen control. This
          // branch looks for a witness only, even when every small support fails.
          const radius = 30;
          let triedAll = false;
          for (const selected of smallestSupports(failed, required)) {
            if (smallAttempts >= 4) break;
            const local = restrictedPart(level, part, selected, trial, seedPoints, radius);
            if (!local) continue;
            smallAttempts++;
            triedAll ||= selected.size === active.size;
            const result = tryWitness(local, selected);
            if (result) return result;
          }
          if (active.size >= 2 && active.size <= 4 && blockAttempts < 3) {
            for (const local of blockNeighborhoods(level, part, active, failed, trial, seedPoints, radius, triedAll)) {
              if (blockAttempts >= 3) break;
              blockAttempts++;
              const result = tryWitness(local, active);
              if (result) return result;
            }
          }
        }
        if (!active.size || active.size > 6 || active.size === part.controls.length) continue;
        attempts++;
        const local = restrictedPart(level, part, active, trial, seedPoints);
        const result = solve(local, frozenPoints(active), trial, null, true);
        if (result === 'sat') seedPoints = positions();
      }
      if (playable(level, trial)) return { status: 'solved', state: trial, preserveRepair: true };
      for (const part of parts) {
        if (outside(part).length || violations(part, seedPoints).length) continue;
        reusable.push(part);
        for (const i of part.controls) state[i] = trial[i];
      }
    }
    let pending = parts.filter((part) => !reusable.includes(part)).map((part) => ({
      part, preferred: seedPoints && new Set(violations(part, seedPoints)),
    }));
    if (level.obstacles.length && pending.length > 1) {
      // Let independent components establish a quick contradiction before retrying any difficult component.
      const deferred = [];
      for (const entry of pending) {
        const result = solve(entry.part, coordinates, state, entry.preferred, true);
        if (result === 'unsat') return { status: 'unsat' };
        if (result === 'unknown') deferred.push(entry);
      }
      pending = deferred;
    }
    let uncertain = false;
    for (const { part, preferred } of pending) {
      const result = solve(part, coordinates, state, preferred);
      if (result === 'unsat') return { status: 'unsat' };
      if (result === 'unknown') uncertain = true;
    }
    if (uncertain) return { status: 'unknown' };
    if (playable(level, state)) return { status: 'solved', state };
    // Try exact models for parts previously filled from geometry or reused from an approximate state.
    for (const part of [...retryParts, ...reusable]) {
      const result = solve(part, coordinates, state);
      if (result === 'unsat') return { status: 'unsat' };
      if (result === 'unknown') uncertain = true;
    }
    if (uncertain) return { status: 'unknown' };
    return playable(level, state) ? { status: 'solved', state } : { status: 'precision' };
  }

  globalThis.JiexianExact = { prepareExact, solveExact };
})();
