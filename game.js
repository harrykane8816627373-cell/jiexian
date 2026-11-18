(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const puzzles = globalThis.JiexianPuzzles;
  const byId = (id) => document.getElementById(id);
  const board = byId('board');
  const ctx = board.getContext('2d');
  const status = byId('status');
  const form = byId('generator');
  const countInput = byId('node-count');
  const mechanism = byId('mechanism');
  const storageKey = 'jiexian-v2';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const turnKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const labels = { free: '自由节点', mirror: '联动节点', rotor: '星盘节点', rail: '滑轨节点' };
  const tools = {
    add: '点棋盘空白处添加一个节点。',
    edge: '依次点两个节点，为它们连线。',
    move: '拖动节点调整位置。拖动空白处平移。',
    erase: '点节点删除它及相连的线，也可以单独点线删除。',
  };
  const twoDigits = (n) => String(n).padStart(2, '0');
  const clockText = (ms) => {
    const seconds = Math.floor(ms / 1000);
    return `${twoDigits(Math.floor(seconds / 60))}:${twoDigits(seconds % 60)}`;
  };

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey)) ?? {};
  } catch {
    // The game also works with local storage blocked.
  }
  const validPoint = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  const bounded = ([x, y]) => [g.clamp(x, g.margin, g.width - g.margin), g.clamp(y, g.margin, g.height - g.margin)];
  const emptyDraft = () => ({ points: [], edges: [] });
  function readDraft(value) {
    if (!Array.isArray(value?.points) || value.points.length > puzzles.maxNodes || !value.points.every(validPoint) || !Array.isArray(value.edges)) return emptyDraft();
    const edges = [];
    for (const edge of value.edges) {
      if (!Array.isArray(edge) || edge.length !== 2) continue;
      const [a, b] = [...edge].sort((x, y) => x - y);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= value.points.length || a === b) continue;
      if (!edges.some(([u, v]) => u === a && v === b)) edges.push([a, b]);
    }
    return { points: value.points.map(bounded), edges };
  }

  let draft = readDraft(saved.draft);
  const draftHistory = [];
  let activeTool = 'add';
  let editorOrigin = -1;
  let tab = 'random';
  let editing = false;
  let randomConfig = null;
  let level, state, moves, assisted, elapsed, won;
  let clockStart = null;
  let timerMode = 'idle';
  let history = [];
  let moving = null;
  let selection = -1;
  let view = { x: 0, y: 0, zoom: 1 };
  let animation = null;
  let suggestion = null;
  let hover = -1;
  let size = { w: 0, h: 0, dpr: 1 };
  let frame = 0;
  let expandedView = false;

  for (const [value, { label }] of Object.entries(puzzles.modes)) mechanism.add(new Option(label, value));
  const editButtons = [...byId('edit-tools').querySelectorAll('button')];

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  function timeSpent() {
    return elapsed + (clockStart === null ? 0 : performance.now() - clockStart);
  }

  function startClock() {
    if (timerMode === 'running') return;
    clockStart = performance.now();
    timerMode = 'running';
    updateControls();
  }

  function stopClock(nextMode) {
    elapsed = timeSpent();
    clockStart = null;
    timerMode = nextMode;
  }

  function save() {
    if (!level) return;
    saved.draft = draft;
    saved.tab = tab;
    if (tab === 'random') {
      const stable = moving?.kind === 'node' ? moving.before.state : state;
      saved.random = { config: randomConfig, state: stable, moves, assisted, elapsed: timeSpent(), timerMode };
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // A full storage area does not interrupt play.
    }
  }

  function currentSnapshot() { return { state: g.copy(state), moves, assisted }; }

  function load(next, run) {
    animation = null;
    suggestion = null;
    moving = null;
    board.classList.remove('dragging');
    board.style.cursor = '';
    level = next;
    const usable = Array.isArray(run?.state) && run.state.length === level.controls.length && run.state.every((part, i) =>
      Array.isArray(part) && part.length === level.controls[i].start.length && part.every(Number.isFinite));
    state = usable ? run.state.map((value, i) => g.normalize(level.controls[i], value)) : g.copy(level.initial);
    moves = usable && Number.isSafeInteger(run.moves) && run.moves >= 0 ? run.moves : 0;
    assisted = usable && run.assisted === true;
    elapsed = usable && Number.isFinite(run.elapsed) && run.elapsed >= 0 ? run.elapsed : 0;
    won = !editing && g.evaluate(level, g.positions(level, state)).count === 0;
    timerMode = usable && ['paused', 'running'].includes(run.timerMode) ? run.timerMode : won ? 'finished' : 'idle';
    clockStart = timerMode === 'running' ? performance.now() : null;
    history = [];
    view = { x: 0, y: 0, zoom: 1 };
    selection = -1;
    editorOrigin = -1;
    hover = -1;
    byId('random-tab').setAttribute('aria-pressed', String(tab === 'random'));
    byId('editor-tab').setAttribute('aria-pressed', String(tab === 'editor'));
    byId('generator').hidden = tab !== 'random';
    byId('editor-panel').hidden = tab !== 'editor';
    byId('edit-tools').hidden = !editing;
    byId('editor-tip').hidden = !editing;
    byId('editor-actions').hidden = !editing;
    byId('edit-quiet').hidden = !editing;
    byId('edit-again').hidden = editing;
    byId('session-panel').hidden = editing;
    byId('timer').hidden = editing;
    byId('editor-status').textContent = '';
    setStatus(won ? (assisted ? '本题已辅助解开。' : '本题的连线已经理顺。') : '');
    updatePanel();
    save();
    render();
  }

  function progressText() {
    const meta = `${level.points.length} 个节点 · ${level.edges.length} 条线`;
    const random = tab === 'random';
    byId('level-title').textContent = random ? '随机解线' : '自定义题';
    byId('difficulty-label').textContent = random ? puzzles.difficulty[level.rank].label : editing ? '编辑题目' : '试玩题目';
    byId('puzzle-meta').textContent = random ? `${puzzles.modes[level.mode].label} · ${meta}` : meta;
    byId('level-rule').textContent = random ? puzzles.modes[level.mode].rule :
      editing ? '自己布置节点和连线，再试玩或求解。' : '拖动红色节点，让冲突连线恢复为实线。';
    board.setAttribute('aria-label', editing ? '自定义题编辑棋盘' : '解线棋盘。用 Q 或 E 选择节点，用方向键移动。');
    byId('anchor-legend').hidden = !level.ownership.includes(-1);
    byId('board-help').textContent = editing ? '滚轮缩放 · 选择「移动」可平移' : '拖动空白处平移 · 滚轮缩放 · 键盘用 Q / E 选点';
    byId('draft-count').textContent = `${draft.points.length} / ${puzzles.maxNodes} 个节点`;
  }

  function updatePanel() {
    progressText();
    byId('win').hidden = !won;
    byId('win-title').textContent = assisted ? '已辅助解开' : moves ? '解线成功' : '连线已经理顺';
    byId('win-detail').textContent = `${moves} 步 · ${clockText(timeSpent())}`;
    updateStats(g.evaluate(level, g.positions(level, state)).count);
    updateControls();
    updateClock();
  }

  function updateStats(conflicts) {
    const counter = byId('conflicts');
    const count = String(conflicts);
    if (counter.textContent !== count) counter.textContent = count;
    counter.classList.toggle('good', !conflicts);
    if (byId('moves').textContent !== String(moves)) byId('moves').textContent = moves;
  }

  function updateControls() {
    const dragging = moving?.kind === 'node';
    const busy = !!animation || dragging;
    byId('solve').disabled = busy;
    byId('hint').disabled = busy;
    byId('undo').disabled = !history.length || busy;
    byId('restart').disabled = busy || (!moves && timerMode === 'idle');
    byId('timer-toggle').textContent = timerMode === 'running' ? '暂停' : timerMode === 'idle' ? '开始' : '继续';
    byId('zoom-out').disabled = view.zoom <= 0.75 || dragging;
    byId('zoom-in').disabled = view.zoom >= 2.8 || dragging;
    byId('fit').disabled = (view.zoom === 1 && !view.x && !view.y) || dragging;
    byId('draft-undo').disabled = !draftHistory.length || dragging;
    byId('draft-clear').disabled = !draft.points.length || dragging;
    byId('solve-draft').disabled = dragging;
    byId('play-draft').disabled = dragging;
  }

  function updateClock() {
    const text = clockText(timeSpent());
    if (byId('clock').textContent !== text) byId('clock').textContent = text;
  }

  function refreshCompletion() {
    const complete = g.evaluate(level, g.positions(level, state)).count === 0;
    if (complete && !won) stopClock('finished');
    if (!complete && timerMode === 'finished') timerMode = 'paused';
    won = complete;
  }

  function completeMove(before, count, helpUsed, message = '') {
    history.push(before);
    if (history.length > 120) history.shift();
    if (!helpUsed) suggestion = null;
    moves += count;
    assisted ||= helpUsed;
    if (timerMode === 'idle') startClock();
    refreshCompletion();
    setStatus(won ? (assisted ? '本题已辅助解开。' : '本题已独立解开。') : message);
    updatePanel();
    save();
    render();
  }

  function undo() {
    if (byId('undo').disabled) return;
    ({ state, moves, assisted } = history.pop());
    suggestion = null;
    refreshCompletion();
    setStatus('已撤销上一次操作。');
    updatePanel();
    save();
    render();
  }

  function pickTool(tool) {
    activeTool = tool;
    editorOrigin = -1;
    board.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
    editButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
    byId('editor-tip').textContent = tools[tool];
    byId('editor-status').textContent = '';
    render();
  }

  function replaceDraft(next, remember = true) {
    if (remember) {
      draftHistory.push(draft);
      if (draftHistory.length > 120) draftHistory.shift();
    }
    draft = next;
    level = puzzles.authored(draft);
    state = g.copy(level.initial);
    selection = -1;
    editorOrigin = -1;
    hover = -1;
    byId('editor-status').textContent = '';
    updatePanel();
    save();
    render();
  }

  function undoDraft() {
    if (!byId('draft-undo').disabled) replaceDraft(draftHistory.pop(), false);
  }

  function editAt(point, node) {
    const message = byId('editor-status');
    if (activeTool === 'add') {
      if (node >= 0) { message.textContent = '请选择棋盘空白处。'; return; }
      if (draft.points.length >= puzzles.maxNodes) { message.textContent = `最多可放 ${puzzles.maxNodes} 个节点。`; return; }
      const place = bounded(point);
      if (draft.points.some((other) => g.distance(place, other) < g.radius * 2 + 5)) {
        message.textContent = '请与已有节点留一点距离。';
        return;
      }
      replaceDraft({ ...draft, points: [...draft.points, place] });
    } else if (activeTool === 'edge' && node >= 0) {
      if (editorOrigin < 0 || editorOrigin === node) {
        editorOrigin = editorOrigin === node ? -1 : node;
        message.textContent = editorOrigin < 0 ? '' : `已选节点 ${node + 1}，请选择另一个节点。`;
        render();
        return;
      }
      const [a, b] = [editorOrigin, node].sort((x, y) => x - y);
      if (draft.edges.some(([u, v]) => u === a && v === b)) {
        message.textContent = '这两个节点已经连线。';
        editorOrigin = -1;
        render();
        return;
      }
      replaceDraft({ ...draft, edges: [...draft.edges, [a, b]] });
    } else if (activeTool === 'erase') {
      if (node >= 0) {
        const points = draft.points.filter((_, i) => i !== node);
        const edges = draft.edges.filter(([a, b]) => a !== node && b !== node)
          .map((edge) => edge.map((n) => n > node ? n - 1 : n));
        replaceDraft({ points, edges });
      } else {
        let nearest = 11 / transform().k;
        let chosen = -1;
        draft.edges.forEach(([a, b], i) => {
          const distance = g.distanceToSegment(point, draft.points[a], draft.points[b]);
          if (distance < nearest) { nearest = distance; chosen = i; }
        });
        if (chosen >= 0) replaceDraft({ ...draft, edges: draft.edges.filter((_, i) => i !== chosen) });
      }
    }
  }

  function startDraft(solveNow) {
    if (!draft.edges.length) {
      byId('editor-status').textContent = '请先放置节点并添加至少一条连线。';
      return;
    }
    const result = puzzles.solveDraft(draft);
    if (!result.puzzle) {
      byId('editor-status').textContent = result.reason;
      return;
    }
    editing = false;
    load(result.puzzle);
    if (solveNow && !won) animate(false);
  }

  function randomize(config, run) {
    const stage = puzzles.generate(config.seed, config.rank, config.count, config.mechanism);
    if (!stage) return false;
    randomConfig = config;
    tab = 'random';
    editing = false;
    load(stage, run);
    return true;
  }

  function createRandom(rank, count, mode, auto) {
    const config = { rank, count, mechanism: mode, auto };
    for (let tries = 0; tries < 6; tries++) {
      config.seed = Math.floor(Math.random() * 4294967296);
      if (config.seed !== randomConfig?.seed && randomize(config)) return true;
    }
    return false;
  }

  function reflectConfig(config) {
    form.querySelector(`input[value="${config.rank}"]`).checked = true;
    countInput.value = config.auto ? '' : config.count;
    countInput.placeholder = `自动（${puzzles.difficulty[config.rank].nodes}）`;
    mechanism.value = config.mechanism;
  }

  function animate(singleStep) {
    const plan = suggestion ?? g.solve(level, state);
    if (!plan.length) {
      setStatus('连线已经理顺，可以继续拖动节点。');
      return;
    }
    if (timerMode === 'idle') startClock();
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

  function syncFullscreen() {
    const active = Boolean(document.fullscreenElement) || expandedView;
    document.documentElement.classList.toggle('game-fullscreen', active);
    const button = byId('fullscreen');
    const label = active ? '退出全屏' : '全屏';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.querySelector('use').setAttribute('href', active ? '#i-exit-fullscreen' : '#i-fullscreen');
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (!expandedView && document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
        return;
      } catch {
        // Embedded browsers may only allow an expanded layout within the viewport.
      }
    }
    expandedView = !expandedView;
    syncFullscreen();
  }

  function hitTest(point, touch) {
    const { k } = transform();
    let found = -1;
    let nearest = Math.max((level.radius ?? g.radius) + 8, (touch ? 19 : 15) / k);
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
    if (editing && activeTool !== 'move') {
      editAt(point, node);
      return;
    }
    if (node !== -1 && level.ownership[node] === -1) {
      setStatus('这个锚点固定在原位。');
      return;
    }
    if (node !== -1) {
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
      board.style.cursor = editing && activeTool !== 'move' ? 'crosshair' : hover !== -1 && level.ownership[hover] === -1 ? 'default' : 'grab';
    } else if (moving.id === event.pointerId) {
      if (moving.kind === 'pan') {
        view.x = g.clamp(moving.x + at[0] - moving.at[0], -size.w * .75, size.w * .75);
        view.y = g.clamp(moving.y + at[1] - moving.at[1], -size.h * .75, size.h * .75);
        updateControls();
      } else {
        const { node, index, before } = moving;
        state[index] = g.dragValue(level, node, point, before.state[index], moving.point);
        if (!editing && timerMode === 'idle' && g.moveDistance(level.controls[index], before.state[index], state[index]) >= 2) startClock();
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
        if (editing) replaceDraft({ ...draft, points: g.copy(state) });
        else completeMove(action.before, 1, false);
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
    if (event.ctrlKey || event.metaKey || event.altKey || animation || moving) return;
    if (key === 'q' || key === 'e') {
      event.preventDefault();
      const order = level.ownership.map((index, node) => index < 0 ? -1 : node).filter((node) => node >= 0);
      if (!order.length) return;
      const i = order.indexOf(selection);
      selection = i < 0 ? order[key === 'q' ? order.length - 1 : 0] : order[(i + order.length + (key === 'q' ? -1 : 1)) % order.length];
      const control = level.controls[level.ownership[selection]];
      const description = `选中 ${labels[control.kind]} ${selection + 1}，按方向键移动。`;
      if (editing) byId('editor-status').textContent = description;
      else setStatus(description);
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
    if (g.moveDistance(control, before.state[index], state[index]) > 0.01) {
      if (editing) {
        const node = selection;
        replaceDraft({ ...draft, points: g.copy(state) });
        selection = node;
      } else completeMove(before, 1, false);
    }
  });
  board.addEventListener('blur', () => { selection = -1; render(); });

  function draw() {
    frame = 0;
    const active = animation?.state ?? state;
    const points = g.positions(level, active);
    const faults = g.evaluate(level, points);
    updateStats(faults.count);
    if (!size.w || !size.h) return;
    const { k, x, y } = transform();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.translate(-g.width / 2, -g.height / 2);
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = '#e3e3e0';
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
        circle(control.center, orbit + 29, '#f6f6f4', '#b0b0ab');
        ctx.setLineDash([4, 7]);
        circle(control.center, orbit, null, '#8e8e88');
        ctx.setLineDash([]);
        circle(control.center, 4, '#71716b');
      }
      if (control.kind === 'rail') {
        ctx.lineWidth = 5;
        line(control.a, control.b, '#cdcdca');
        circle(control.a, 5, '#81817d');
        circle(control.b, 5, '#81817d');
        ctx.lineWidth = 1 / k;
      }
    });
    level.obstacles.forEach(({ center, r }, i) => {
      const bad = faults.badObstacles.has(i);
      circle(center, r, bad ? '#fcf1f1' : '#f5f5f3', bad ? '#ad4850' : '#96968f');
      ctx.save();
      ctx.clip();
      ctx.lineWidth = 1.2 / k;
      for (let dx = -2 * r; dx <= 2 * r; dx += 13) {
        line([center[0] + dx, center[1] - r], [center[0] + dx - 2 * r, center[1] + r], bad ? '#bd616879' : '#85857b80');
      }
      ctx.restore();
    });

    for (const drawBad of [false, true]) {
      ctx.lineWidth = Math.max(2.15, 1.35 / k);
      ctx.setLineDash(drawBad ? [7 / k, 5 / k] : []);
      level.edges.forEach(([a, b], i) => {
        if (faults.badEdges.has(i) === drawBad) line(points[a], points[b], '#111111');
      });
    }
    ctx.setLineDash([]);
    points.forEach((point, node) => {
      const [px, py] = point;
      const index = level.ownership[node];
      const control = level.controls[index];
      const kind = control?.kind ?? 'fixed';
      const picked = node === selection || node === editorOrigin || moving?.kind === 'node' && index === moving.index || animation?.index === index;
      const r = level.radius && level.radius < g.radius ? Math.max(2 / k, level.radius) : Math.max(g.radius, 7.2 / k);
      const color = faults.badNodes.has(node) ? '#c32e37' : '#287646';
      ctx.lineWidth = 1.5 / k;
      if (kind === 'fixed') {
        const border = 1.5 / k;
        ctx.beginPath();
        ctx.roundRect(px - r - border, py - r - border, (r + border) * 2, (r + border) * 2, r * .34);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(px - r, py - r, r * 2, r * 2, r * .34);
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        circle(point, r + 1.5 / k, '#fff');
        circle(point, r, color);
      }
      if (picked || node === hover) circle(point, r + 5 / k, null, picked ? color : '#6b6b66');
      if (kind === 'free' && !editing) {
        circle(point, Math.min(r * .27, Math.max(3.4, 1.8 / k)), '#fff');
      } else {
        const label = editing ? String(node + 1) : kind === 'fixed' ? '×' : kind === 'rotor' ? 'R' : kind === 'rail' ? '│' : 'A';
        ctx.fillStyle = '#fff';
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

  form.addEventListener('change', () => {
    const rank = new FormData(form).get('rank');
    countInput.placeholder = `自动（${puzzles.difficulty[rank].nodes}）`;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const rank = new FormData(form).get('rank');
    const automatic = countInput.value === '';
    const count = automatic ? puzzles.difficulty[rank].nodes : Number(countInput.value);
    const ok = createRandom(rank, count, mechanism.value, automatic);
    const message = byId('generator-status');
    message.hidden = ok;
    message.textContent = ok ? '' : '这次没能生成可解的布局，请再试一次。';
    if (ok) setStatus('已生成新题。');
  });
  function enterEditor() {
    save();
    tab = 'editor';
    editing = true;
    load(puzzles.authored(draft));
    pickTool(activeTool);
  }
  byId('random-tab').addEventListener('click', () => {
    if (tab === 'random') return;
    save();
    if (saved.random && randomize(saved.random.config, saved.random)) return;
    createRandom('easy', puzzles.difficulty.easy.nodes, 'classic', true);
  });
  byId('editor-tab').addEventListener('click', () => { if (tab !== 'editor') enterEditor(); });
  byId('edit-again').addEventListener('click', enterEditor);
  editButtons.forEach((button) => button.addEventListener('click', () => pickTool(button.dataset.tool)));
  byId('draft-undo').addEventListener('click', undoDraft);
  byId('draft-clear').addEventListener('click', () => replaceDraft(emptyDraft()));
  byId('solve-draft').addEventListener('click', () => startDraft(true));
  byId('play-draft').addEventListener('click', () => startDraft(false));
  byId('rules').addEventListener('click', () => byId('rules-dialog').showModal());
  byId('solve').addEventListener('click', () => animate(false));
  byId('hint').addEventListener('click', () => animate(true));
  byId('undo').addEventListener('click', undo);
  byId('restart').addEventListener('click', () => { load(level); setStatus('已重开本题。'); });
  byId('timer-toggle').addEventListener('click', () => {
    if (timerMode === 'running') stopClock('paused');
    else startClock();
    updateControls();
    updateClock();
    save();
  });
  byId('zoom-in').addEventListener('click', () => zoom(1.24));
  byId('zoom-out').addEventListener('click', () => zoom(1 / 1.24));
  byId('fit').addEventListener('click', resetView);
  byId('fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('keydown', (event) => {
    if (byId('rules-dialog').open) return;
    if (event.key === 'Escape' && expandedView) {
      expandedView = false;
      syncFullscreen();
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (editing) undoDraft();
      else undo();
    }
    if (!event.ctrlKey && !event.metaKey && event.key === '1') resetView();
  });
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  setInterval(updateClock, 250);
  new ResizeObserver(resize).observe(board);
  const initialTab = saved.tab;
  const config = saved.random?.config;
  const valid = config && Object.hasOwn(puzzles.difficulty, config.rank) && Object.hasOwn(puzzles.modes, config.mechanism) &&
    Number.isInteger(config.count) && config.count >= puzzles.minNodes && config.count <= puzzles.maxNodes && Number.isInteger(config.seed);
  if (!valid || !randomize(config, saved.random)) createRandom('easy', puzzles.difficulty.easy.nodes, 'classic', true);
  reflectConfig(randomConfig);
  if (initialTab === 'editor') enterEditor();
  resize();
})();
