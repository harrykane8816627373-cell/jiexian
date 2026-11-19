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

  function segmentClear(p, a, b, distance) {
    const ab = vector(b, a);
    const ap = vector(p, a);
    const length = normSquared(ab);
    const projection = dot(ap, ab);
    const limit = square(real(distance));
    return or(
      and(call('<=', projection, '0'), call('>=', normSquared(ap), limit)),
      and(call('>=', projection, length), call('>=', normSquared(vector(p, b)), limit)),
      and(call('>', projection, '0'), call('<', projection, length),
        call('>=', square(cross(ab, ap)), mul(limit, length)))
    );
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
    const fraction = ([n, d]) => n === 0n ? '0' : n === d ? '1' : call('/', String(n), String(d));
    const controls = part.controls.map((i) => {
      const control = level.controls[i];
      const { kind, members: [node, partner] } = control;
      const names = kind === 'rail' ? [`x${i}`] : [`x${i}`, `y${i}`];
      for (const name of names) setup.push(`(declare-const ${name} Real)`);
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
      return { index: i, names };
    });

    const constraints = part.records.map(({ kind, vertices, distance, support }, i) => {
      const [a, b, c, d] = vertices.map((node) => points[node]);
      const formula = kind === 'distance' ? call('>=', normSquared(vector(a, b)), square(real(distance))) :
        kind === 'segment' ? segmentClear(c, a, b, distance) : or(sameSide(a, b, c, d), sameSide(c, d, a, b));
      return { name: define(`clear${i}`, 'Bool', formula), unary: support.length === 1 };
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

  function solvePart(level, coordinates, railBounds, part, query, state) {
    const { setup, constraints, controls } = buildModel(level, coordinates, railBounds, part);
    const pending = constraints.filter(({ unary }) => !unary).map(({ name }) => name);
    const enforce = (names) => {
      for (let i = 0; i < names.length; i += 256) {
        query(names.slice(i, i + 256).map((name) => call('assert', name)).join('\n'));
      }
    };
    for (let i = 0; i < setup.length; i += 64) query(setup.slice(i, i + 64).join('\n'));
    enforce(constraints.filter(({ unary }) => unary).map(({ name }) => name));
    while (true) {
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
  }

  const playable = (level, state) => !g.evaluate(level, g.positions(level, state)).count;

  function prepareExact(level) {
    const problem = analyze(level);
    if (problem.unsat) return { status: 'unsat' };
    const state = level.initial.map((value, i) => g.normalize(level.controls[i], value));
    for (const [index, value] of problem.packed) state[index] = value;
    if (!problem.parts.length) {
      if (playable(level, state)) return { status: 'solved', state };
      if (!problem.packingParts.length) return { status: 'precision' };
    }
    return { status: 'ready', ...problem, state };
  }

  function solveExact(level, ask, problem = prepareExact(level)) {
    if (problem.status !== 'ready') return problem;
    const { coordinates, railBounds, parts, packingParts } = problem;
    const state = g.copy(problem.state);
    let checks = 0;
    const query = (command) => {
      const reply = ask(command).trim();
      if (reply.startsWith('(error')) throw new Error(reply);
      return reply;
    };
    const solve = (part) => {
      if (checks++) query('(reset)');
      return solvePart(level, coordinates, railBounds, part, query, state);
    };
    let uncertain = false;
    for (const part of parts) {
      const result = solve(part);
      if (result === 'unsat') return { status: 'unsat' };
      if (result === 'unknown') uncertain = true;
    }
    if (uncertain) return { status: 'unknown' };
    if (playable(level, state)) return { status: 'solved', state };
    // A greedy boundary position may round into a conflict. Try another model for those parts.
    for (const part of packingParts) solve(part);
    return playable(level, state) ? { status: 'solved', state } : { status: 'precision' };
  }

  globalThis.JiexianExact = { prepareExact, solveExact };
})();
