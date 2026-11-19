(function () {
  'use strict';

  const g = globalThis.Jiexian;
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

  function buildModel(level) {
    const setup = ['(set-logic QF_NRA)', '(set-option :produce-models true)',
      '(set-option :pp.decimal true)', '(set-option :pp.decimal_precision 30)'];
    const constraints = [];
    const define = (name, sort, expr) => {
      setup.push(`(define-fun ${name} () ${sort} ${expr})`);
      return name;
    };
    const points = level.points.map((point) => point.map(real));
    const assert = (expr) => setup.push(call('assert', expr));
    const bounded = (name, lower, upper) => assert(and(call('<=', real(lower), name), call('<=', name, real(upper))));
    const controls = level.controls.map((control, i) => {
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
        bounded(x, 0, 1);
        points[node] = control.a.map((start, axis) => add(real(start), mul(x, sub(real(control.b[axis]), real(start)))));
      } else {
        points[node] = names;
        if (kind === 'mirror') points[partner] = control.sum.map((sum, axis) => sub(real(sum), names[axis]));
        for (const member of control.members) {
          bounded(points[member][0], g.margin, g.width - g.margin);
          bounded(points[member][1], g.margin, g.height - g.margin);
        }
      }
      return names;
    });

    points.forEach((point, i) => {
      if (level.ownership[i] === -1) return;
      points[i] = point.map((expr, axis) => define(`p${i}_${axis}`, 'Real', expr));
    });
    const clearance = g.clearances(level);
    const requireClear = (nodes, formula) => {
      const name = define(`clear${constraints.length}`, 'Bool', formula);
      constraints.push({ name, fixed: nodes.every((node) => level.ownership[node] === -1) });
    };
    const separated = (a, b, distance) => call('>=', normSquared(vector(a, b)), square(real(distance)));
    points.forEach((point, i) => {
      for (let j = 0; j < i; j++) requireClear([i, j], separated(point, points[j], clearance.nodes));
      for (const { center, r } of level.obstacles) {
        requireClear([i], separated(point, center.map(real), r + clearance.spacing + clearance.obstacleGap));
      }
    });
    level.edges.forEach(([i, j], edge) => {
      const a = points[i];
      const b = points[j];
      points.forEach((p, k) => {
        if (k !== i && k !== j) requireClear([i, j, k], segmentClear(p, a, b, clearance.nodeEdge));
      });
      for (const { center, r } of level.obstacles) {
        requireClear([i, j], segmentClear(center.map(real), a, b, r + clearance.obstacleGap));
      }
      for (let other = 0; other < edge; other++) {
        const [k, l] = level.edges[other];
        if (i === k || i === l || j === k || j === l) continue;
        const c = points[k];
        const d = points[l];
        requireClear([i, j, k, l], or(sameSide(a, b, c, d), sameSide(c, d, a, b)));
      }
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

  function solveExact(level, ask) {
    const { setup, constraints, controls } = buildModel(level);
    const query = (command) => {
      const reply = ask(command).trim();
      if (reply.startsWith('(error')) throw new Error(reply);
      return reply;
    };
    const pending = constraints.filter(({ fixed }) => !fixed).map(({ name }) => name);
    const enforce = (names) => names.forEach((name) => query(call('assert', name)));

    for (let i = 0; i < setup.length; i += 64) query(setup.slice(i, i + 64).join('\n'));
    enforce(constraints.filter(({ fixed }) => fixed).map(({ name }) => name));
    while (true) {
      // Use NLSat on every relaxation, including after adding assertions.
      const result = query('(check-sat-using qfnra-nlsat)');
      if (result === 'unsat') return { status: 'unsat' };
      if (result !== 'sat') return { status: 'unknown' };

      // Test omitted predicates on the exact algebraic model, never on rounded coordinates.
      const conflicts = new Set();
      for (let i = 0; i < pending.length; i += 256) {
        for (const [name, value] of modelValues(query, pending.slice(i, i + 256))) {
          if (value === 'false') conflicts.add(name);
          else if (value !== 'true') throw new Error('Unevaluated constraint in Z3 model');
        }
      }
      if (!conflicts.size) {
        const variables = controls.flat();
        const values = modelValues(query, variables);
        const state = controls.map((names, i) => {
          const value = names.map((name) => numberFromModel(values.get(name)));
          return g.normalize(level.controls[i], level.controls[i].kind === 'rotor' ? [Math.atan2(value[1], value[0])] : value);
        });
        if (!g.evaluate(level, g.positions(level, state)).count) return { status: 'solved', state };
        query('(set-option :pp.decimal false)');
        const model = variables.length ? query(`(get-value (${variables.join(' ')}))`) : '()';
        return { status: 'precision', model };
      }
      enforce([...conflicts]);
      let remaining = 0;
      for (const name of pending) {
        if (!conflicts.has(name)) pending[remaining++] = name;
      }
      pending.length = remaining;
    }
  }

  globalThis.JiexianExact = { solveExact };
})();
