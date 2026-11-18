(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const byId = (id) => document.getElementById(id);
  const board = byId('board');
  const ctx = board.getContext('2d');
  const status = byId('status');
  const storageKey = 'jiexian-v1';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const turnKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const labels = { free: '自由节点', mirror: '联动节点', rotor: '星盘节点', rail: '滑轨节点' };
  const params = new URLSearchParams(location.search);
  const twoDigits = (n) => String(n).padStart(2, '0');

  let saved = { runs: {}, records: {}, chapter: 0 };
  try {
    const previous = JSON.parse(localStorage.getItem(storageKey));
    if (previous?.runs && previous?.records) saved = previous;
  } catch {
    // The game also works in browsers that disable storage.
  }

  let mode = params.get('mode') === 'daily' ? 'daily' : 'classic';
  let chapter = Number.isInteger(saved.chapter) ? g.clamp(saved.chapter, 0, g.levels.length - 1) : 0;
  let level, state, moves, assisted, elapsed, clockStart, won;
  let history = [];
  let moving = null;
  let selection = -1;
  let view = { x: 0, y: 0, zoom: 1 };
  let animation = null;
  let suggestion = null;
  let hover = -1;
  let size = { w: 0, h: 0, dpr: 1 };
  let frame = 0;

  const levelButtons = g.levels.map((item, i) => {
    const button = document.createElement('button');
    button.textContent = twoDigits(i + 1);
    button.addEventListener('click', () => { if (i !== chapter) load('classic', i); });
    byId('level-picker').append(button);
    return button;
  });

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  function timeSpent() {
    return elapsed + (clockStart === null ? 0 : performance.now() - clockStart);
  }

  function save() {
    if (!level) return;
    saved.chapter = chapter;
    saved.runs[level.id] = { state: moving?.kind === 'node' ? moving.before.state : state, moves, assisted, elapsed: timeSpent() };
    const obsolete = Object.keys(saved.runs).filter((key) => key.startsWith('daily-')).sort().slice(0, -35);
    for (const key of obsolete) {
      delete saved.runs[key];
      delete saved.records[key];
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // A full or disabled storage area does not interrupt play.
    }
  }

  function currentSnapshot() { return { state: g.copy(state), moves, assisted }; }

  function load(nextMode, nextChapter = chapter, keepRun = true) {
    if (keepRun) save();
    animation = null;
    suggestion = null;
    moving = null;
    board.classList.remove('dragging');
    mode = nextMode;
    chapter = nextChapter;
    level = mode === 'classic' ? g.levels[chapter] : g.dailyLevel(g.dayKey());
    const run = keepRun ? saved.runs[level.id] : null;
    const usable = Array.isArray(run?.state) && run.state.length === level.controls.length && run.state.every((part, i) =>
      Array.isArray(part) && part.length === level.controls[i].start.length && part.every(Number.isFinite));
    state = usable ? run.state.map((value, i) => g.normalize(level.controls[i], value)) : g.copy(level.initial);
    moves = usable && Number.isSafeInteger(run.moves) && run.moves >= 0 ? run.moves : 0;
    assisted = usable && run.assisted === true;
    elapsed = usable && Number.isFinite(run.elapsed) && run.elapsed >= 0 ? run.elapsed : 0;
    won = g.evaluate(level, g.positions(level, state)).count === 0;
    clockStart = moves && !won ? performance.now() : null;
    history = [];
    view = { x: 0, y: 0, zoom: 1 };
    selection = -1;
    hover = -1;
    byId('classic').setAttribute('aria-pressed', String(mode === 'classic'));
    byId('daily').setAttribute('aria-pressed', String(mode === 'daily'));
    byId('level-index').textContent = mode === 'classic' ? `关卡 ${twoDigits(chapter + 1)} / ${twoDigits(g.levels.length)}` : level.date.replaceAll('-', '.');
    byId('category').textContent = level.category;
    byId('level-title').textContent = level.title;
    byId('level-rule').textContent = level.rule;
    byId('chapter-panel').hidden = mode !== 'classic';
    byId('daily-panel').hidden = mode !== 'daily';
    board.setAttribute('aria-label', `${level.title}棋盘。用 Q 或 E 选择节点，用方向键移动。`);
    if (level.date) {
      byId('daily-date').textContent = level.date.slice(5).replace('-', ' / ');
      byId('daily-goal').textContent = `在 ${level.goal} 步内独立解开，达成今日目标。每天北京时间 00:00 换题。`;
    }
    if (mode === 'daily') params.set('mode', 'daily');
    else params.delete('mode');
    if (location.protocol !== 'file:') {
      const query = params.toString();
      window.history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
    }
    setStatus(won ? (assisted ? '本局已辅助解开。' : '本局已独立解开。') : '');
    updatePanel();
    save();
    render();
  }

  function updatePanel() {
    const record = saved.records[level.id];
    const independent = g.levels.filter(({ id }) => Number.isInteger(saved.records[id]?.best)).length;
    const cleared = g.levels.filter(({ id }) => saved.records[id]).length;
    const dailyBest = Number.isInteger(record?.best) ? record.best : null;
    byId('progress-label').textContent = mode === 'classic' ? '独立通关' : '今日目标';
    byId('progress-text').textContent = mode === 'classic' ? `${independent} / ${g.levels.length}` : dailyBest === null ? '待完成' : dailyBest <= level.goal ? '已达成' : `最佳 ${dailyBest} 步`;
    byId('progress').max = mode === 'classic' ? g.levels.length : 1;
    byId('progress').value = mode === 'classic' ? independent : dailyBest !== null && dailyBest <= level.goal ? 1 : 0;
    byId('chapter-detail').textContent = `已解开 ${cleared} / ${g.levels.length}`;
    byId('daily-best').textContent = dailyBest === null ? '—' : `${dailyBest} 步`;
    g.levels.forEach((item, i) => {
      const button = levelButtons[i];
      const progress = saved.records[item.id];
      button.classList.toggle('recorded', Number.isInteger(progress?.best));
      button.classList.toggle('assisted', !!progress && !Number.isInteger(progress.best));
      const description = progress ? Number.isInteger(progress.best) ? `独立最佳 ${progress.best} 步` : '已辅助解开' : '未解开';
      button.setAttribute('aria-label', `第 ${i + 1} 关 ${item.title}，${description}`);
      button.title = `${item.title} · ${description}`;
      if (i === chapter) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    byId('win').hidden = !won;
    byId('win-title').textContent = assisted ? '已辅助解开' : '解线成功';
    byId('win-detail').textContent = `${moves} 步${level.date && !assisted && moves <= level.goal ? ' · 达成今日目标' : ''}`;
    byId('next').hidden = mode !== 'classic' || chapter >= g.levels.length - 1;
    updateControls();
    updateClock();
  }

  function updateControls() {
    const busy = !!animation || moving?.kind === 'node';
    byId('solve').disabled = won || busy;
    byId('hint').disabled = won || busy;
    byId('undo').disabled = !history.length || busy;
    byId('restart').disabled = !moves || busy;
    byId('zoom-out').disabled = view.zoom <= 0.75 || moving?.kind === 'node';
    byId('zoom-in').disabled = view.zoom >= 2.8 || moving?.kind === 'node';
    byId('fit').disabled = (view.zoom === 1 && !view.x && !view.y) || moving?.kind === 'node';
  }

  function updateClock() {
    const seconds = Math.floor(timeSpent() / 1000);
    const text = `${Math.floor(seconds / 60)}:${twoDigits(seconds % 60)}`;
    if (byId('clock').textContent !== text) byId('clock').textContent = text;
  }

  function completeMove(before, count, helpUsed, message = '') {
    history.push(before);
    if (history.length > 120) history.shift();
    if (!helpUsed) suggestion = null;
    moves += count;
    assisted ||= helpUsed;
    clockStart ??= performance.now();
    won = g.evaluate(level, g.positions(level, state)).count === 0;
    if (won) {
      elapsed = timeSpent();
      clockStart = null;
      const record = saved.records[level.id] ?? {};
      if (!assisted) record.best = Math.min(moves, record.best ?? Infinity);
      saved.records[level.id] = record;
    }
    setStatus(won ? (assisted ? '本局已辅助解开。' : '本局已独立解开。') : message);
    updatePanel();
    save();
    render();
  }

  function undo() {
    if (byId('undo').disabled) return;
    ({ state, moves, assisted } = history.pop());
    suggestion = null;
    if (won && moves) clockStart = performance.now();
    if (!moves) { clockStart = null; elapsed = 0; }
    won = false;
    setStatus('已撤销上一次操作。');
    updatePanel();
    save();
    render();
  }

  function animate(singleStep) {
    const plan = suggestion ?? g.solve(level, state);
    if (!plan.length) return;
    const steps = singleStep ? plan.slice(0, 1) : plan;
    const before = currentSnapshot();
    const playback = { state: g.copy(state), index: steps[0].index };
    const duration = reducedMotion.matches ? 0 : steps.length === 1 ? 480 : 320;
    animation = playback;
    hover = -1;
    setStatus(singleStep ? '正在演示下一步…' : '正在逐步解开…');
    updateControls();
    let step = 0;
    let started = performance.now();
    let from = playback.state[steps[0].index];
    function tick(now) {
      if (animation !== playback) return;
      while (step < steps.length) {
        const move = steps[step];
        const part = duration ? g.clamp((now - started) / duration, 0, 1) : 1;
        const smooth = part * part * (3 - 2 * part);
        playback.index = move.index;
        playback.state[move.index] = part === 1 ? move.value : g.mixValue(level.controls[move.index], from, move.value, smooth);
        if (part < 1) {
          render();
          requestAnimationFrame(tick);
          return;
        }
        step++;
        started += duration;
        if (step < steps.length) from = playback.state[steps[step].index];
      }
      state = playback.state;
      animation = null;
      suggestion = singleStep ? plan.slice(1) : null;
      completeMove(before, steps.length, true, '已提示一步，可以继续拖动。');
    }
    requestAnimationFrame(tick);
  }

  function transform() {
    const fit = Math.min(Math.max(1, size.w - 22) / g.width, Math.max(1, size.h - 35) / g.height);
    return { k: fit * view.zoom, x: size.w / 2 + view.x, y: size.h / 2 + view.y };
  }

  function toWorld([px, py]) {
    const { k, x, y } = transform();
    return [(px - x) / k + g.width / 2, (py - y) / k + g.height / 2];
  }

  function local(event) {
    const rect = board.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function zoom(factor, point = [size.w / 2, size.h / 2]) {
    if (moving?.kind === 'node') return;
    const old = view.zoom;
    view.zoom = g.clamp(old * factor, 0.75, 2.8);
    const ratio = view.zoom / old;
    view.x = g.clamp(point[0] - size.w / 2 - (point[0] - size.w / 2 - view.x) * ratio, -size.w * .75, size.w * .75);
    view.y = g.clamp(point[1] - size.h / 2 - (point[1] - size.h / 2 - view.y) * ratio, -size.h * .75, size.h * .75);
    updateControls();
    render();
  }

  function resetView() {
    if (moving?.kind === 'node') return;
    view = { x: 0, y: 0, zoom: 1 };
    updateControls();
    render();
  }

  function hitTest(point, touch) {
    const { k } = transform();
    let found = -1;
    let nearest = Math.max(g.radius + 8, (touch ? 19 : 15) / k);
    g.positions(level, state).forEach((node, i) => {
      const d = g.distance(node, point);
      if (d >= nearest) return;
      nearest = d;
      found = i;
    });
    return found;
  }

  board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || moving || animation) return;
    const at = local(event);
    const point = toWorld(at);
    const node = hitTest(point, event.pointerType === 'touch');
    if (node !== -1 && level.ownership[node] === -1) {
      setStatus('这个锚点固定在原位。');
      return;
    }
    if (node !== -1 && !won) {
      const index = level.ownership[node];
      moving = { kind: 'node', node, index, point, before: currentSnapshot(), id: event.pointerId };
    } else {
      moving = { kind: 'pan', at, x: view.x, y: view.y, id: event.pointerId };
    }
    selection = -1;
    board.setPointerCapture(event.pointerId);
    board.classList.add('dragging');
    updateControls();
    render();
  });

  board.addEventListener('pointermove', (event) => {
    if (animation) return;
    const at = local(event);
    const point = toWorld(at);
    if (!moving) {
      if (event.pointerType === 'touch') return;
      const found = hitTest(point, false);
      if (hover === found) return;
      hover = found;
      board.style.cursor = hover !== -1 && level.ownership[hover] === -1 ? 'default' : 'grab';
    } else if (moving.id === event.pointerId) {
      if (moving.kind === 'pan') {
        view.x = g.clamp(moving.x + at[0] - moving.at[0], -size.w * .75, size.w * .75);
        view.y = g.clamp(moving.y + at[1] - moving.at[1], -size.h * .75, size.h * .75);
        updateControls();
      } else {
        const { node, index, before } = moving;
        state[index] = g.dragValue(level, node, point, before.state[index], moving.point);
      }
    }
    render();
  });

  function finishPointer(event) {
    if (!moving || event.pointerId !== moving.id) return;
    const action = moving;
    moving = null;
    board.classList.remove('dragging');
    if (action.kind === 'node') {
      const previous = action.before.state[action.index];
      const changed = g.moveDistance(level.controls[action.index], previous, state[action.index]) >= 2;
      if (event.type === 'pointerup' && changed) {
        completeMove(action.before, 1, false);
        return;
      }
      state[action.index] = previous;
    }
    updateControls();
    render();
  }
  board.addEventListener('pointerup', finishPointer);
  board.addEventListener('pointercancel', finishPointer);
  board.addEventListener('lostpointercapture', finishPointer);
  board.addEventListener('pointerleave', () => { hover = -1; render(); });
  board.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.deltaY) zoom(event.deltaY > 0 ? 1.12 : 1 / 1.12, local(event));
  }, { passive: false });

  board.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey || event.altKey || animation || moving || won) return;
    if (key === 'q' || key === 'e') {
      event.preventDefault();
      const order = level.ownership.map((index, node) => index < 0 ? -1 : node).filter((node) => node >= 0);
      const i = order.indexOf(selection);
      selection = i < 0 ? order[key === 'q' ? order.length - 1 : 0] : order[(i + order.length + (key === 'q' ? -1 : 1)) % order.length];
      const control = level.controls[level.ownership[selection]];
      setStatus(`选中 ${labels[control.kind]} ${selection + 1}，按方向键移动。`);
      render();
      return;
    }
    const direction = turnKeys[event.key];
    if (!direction || selection === -1) return;
    event.preventDefault();
    const index = level.ownership[selection];
    const control = level.controls[index];
    const before = currentSnapshot();
    if (control.kind === 'rotor') {
      state[index] = g.normalize(control, [state[index][0] + (direction[0] || direction[1]) * (event.shiftKey ? .32 : .09)]);
    } else {
      const point = g.positions(level, state)[selection];
      const target = point.map((value, axis) => value + direction[axis] * (event.shiftKey ? 32 : 9));
      state[index] = g.dragValue(level, selection, target, state[index], point);
    }
    if (g.moveDistance(control, before.state[index], state[index]) > 0.01) completeMove(before, 1, false);
  });
  board.addEventListener('blur', () => { selection = -1; render(); });

  function draw() {
    frame = 0;
    const active = animation?.state ?? state;
    const points = g.positions(level, active);
    const faults = g.evaluate(level, points);
    const counter = byId('conflicts');
    const count = String(faults.count);
    if (counter.textContent !== count) counter.textContent = count;
    counter.classList.toggle('good', !faults.count);
    if (byId('moves').textContent !== String(moves)) byId('moves').textContent = moves;
    if (!size.w || !size.h) return;
    const { k, x, y } = transform();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.translate(-g.width / 2, -g.height / 2);
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = '#6b78983b';
    ctx.beginPath();
    ctx.roundRect(24, 26, g.width - 48, g.height - 52, 15);
    ctx.stroke();
    ctx.lineCap = 'round';

    const circle = (center, r, fill, stroke) => {
      ctx.beginPath();
      ctx.arc(...center, r, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    };
    const line = (a, b, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.stroke();
    };

    level.controls.forEach((control) => {
      if (control.kind === 'rotor') {
        const orbit = g.distance(points[control.members[0]], control.center);
        circle(control.center, orbit + 29, '#4a392d38', '#9e794d80');
        ctx.setLineDash([4, 7]);
        circle(control.center, orbit, null, '#c4956577');
        ctx.setLineDash([]);
        circle(control.center, 5, '#f4bd79', '#b78048');
      }
      if (control.kind === 'rail') {
        ctx.lineWidth = 5;
        line(control.a, control.b, '#81a0e76b');
        circle(control.a, 5, '#9eb5ec');
        circle(control.b, 5, '#9eb5ec');
        ctx.lineWidth = 1 / k;
      }
    });
    level.obstacles.forEach(({ center, r }, i) => {
      const bad = faults.badObstacles.has(i);
      circle(center, r, bad ? '#c48d5833' : '#b86f8730', bad ? '#f4bc7c' : '#b98eac');
      ctx.save();
      ctx.clip();
      ctx.lineWidth = 1.2 / k;
      for (let dx = -2 * r; dx <= 2 * r; dx += 13) {
        line([center[0] + dx, center[1] - r], [center[0] + dx - 2 * r, center[1] + r], bad ? '#e5a25d64' : '#c794b54d');
      }
      ctx.restore();
    });

    for (const drawBad of [false, true]) {
      ctx.lineWidth = Math.max(2.15, 1.35 / k);
      ctx.setLineDash(drawBad ? [7 / k, 5 / k] : []);
      level.edges.forEach(([a, b], i) => {
        if (faults.badEdges.has(i) === drawBad) line(points[a], points[b], drawBad ? '#b993f5' : '#79ceb0');
      });
    }
    ctx.setLineDash([]);
    for (const point of faults.crosses) {
      const r = Math.max(5.2, 3.8 / k);
      ctx.lineWidth = 1.1 / k;
      circle(point, r, '#2d2447', '#c8a8ff');
      line([point[0] - r * .36, point[1] - r * .36], [point[0] + r * .36, point[1] + r * .36], '#e5d4ff');
      line([point[0] + r * .36, point[1] - r * .36], [point[0] - r * .36, point[1] + r * .36], '#e5d4ff');
    }

    points.forEach((point, node) => {
      const [px, py] = point;
      const index = level.ownership[node];
      const control = level.controls[index];
      const kind = control?.kind ?? 'fixed';
      const picked = node === selection || moving?.kind === 'node' && index === moving.index || animation?.index === index;
      const r = Math.max(g.radius, 7.2 / k);
      const color = faults.badNodes.has(node) ? '#c4a3ff' : '#91f2c5';
      ctx.lineWidth = 1.5 / k;
      if (picked || node === hover) circle(point, r + 6 / k, null, picked ? color : '#a8aeca');
      if (kind === 'fixed') {
        ctx.beginPath();
        ctx.roundRect(px - r, py - r, r * 2, r * 2, r * .34);
        ctx.fillStyle = '#242b3e';
        ctx.fill();
        ctx.strokeStyle = '#9caac8';
        ctx.stroke();
      } else {
        circle(point, r + 3.5 / k, faults.badNodes.has(node) ? '#a67df332' : '#69e2ae2b');
        circle(point, r, '#202238', color);
      }
      if (kind === 'free') {
        circle(point, Math.max(4.2, 2.5 / k), color);
      } else {
        const label = kind === 'fixed' ? '×' : kind === 'rotor' ? 'R' : kind === 'rail' ? '│' : control.members[0] === 0 ? 'A' : 'B';
        ctx.fillStyle = kind === 'rotor' ? '#f8ca8a' : kind === 'rail' ? '#afcbff' : kind === 'fixed' ? '#cbd5ec' : color;
        ctx.font = `700 ${Math.max(15, 10 / k)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px, py);
      }
    });
  }

  function render() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function resize() {
    const w = board.clientWidth;
    const h = board.clientHeight;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === size.w && h === size.h && dpr === size.dpr) return;
    size = { w, h, dpr };
    board.width = Math.round(w * dpr);
    board.height = Math.round(h * dpr);
    render();
  }

  byId('classic').addEventListener('click', () => { if (mode !== 'classic') load('classic'); });
  byId('daily').addEventListener('click', () => { if (mode !== 'daily' || level.date !== g.dayKey()) load('daily'); });
  byId('rules').addEventListener('click', () => byId('rules-dialog').showModal());
  byId('solve').addEventListener('click', () => animate(false));
  byId('hint').addEventListener('click', () => animate(true));
  byId('undo').addEventListener('click', undo);
  byId('restart').addEventListener('click', () => { load(mode, chapter, false); setStatus('已重开本局。'); });
  byId('next').addEventListener('click', () => load('classic', chapter + 1));
  byId('zoom-in').addEventListener('click', () => zoom(1.24));
  byId('zoom-out').addEventListener('click', () => zoom(1 / 1.24));
  byId('fit').addEventListener('click', resetView);
  document.addEventListener('keydown', (event) => {
    if (byId('rules-dialog').open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !byId('undo').disabled) {
      event.preventDefault();
      undo();
    }
    if (!event.ctrlKey && !event.metaKey && event.key === '1') resetView();
  });
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else if (mode === 'daily' && !moving && !animation && level.date !== g.dayKey()) load('daily');
  });
  setInterval(updateClock, 250);
  setInterval(() => {
    if (mode === 'daily' && !moving && !animation && level.date !== g.dayKey()) load('daily');
  }, 15000);
  new ResizeObserver(resize).observe(board);
  load(mode);
  resize();
})();
