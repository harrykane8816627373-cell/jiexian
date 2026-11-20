(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const puzzles = globalThis.JiexianPuzzles;
  const mechanismEditor = globalThis.JiexianEditorMechanisms;
  const byId = (id) => document.getElementById(id);
  const board = byId('board');
  const ctx = board.getContext('2d');
  const status = byId('status');
  const form = byId('generator');
  const countInput = byId('node-count');
  const mechanism = byId('mechanism');
  const editMechanism = byId('edit-mechanism');
  const lengthSelect = byId('length-challenge');
  const lengthLabels = { off: '关闭', easy: '简单', medium: '中等', hard: '困难' };
  const storageKey = 'jiexian-v2';
  const generatorRevision = puzzles.revision;
  const boardInset = 24;
  const minZoom = .75;
  const maxZoom = 3.5;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = matchMedia('(orientation: portrait)');
  const compactViewport = matchMedia('(max-width: 730px) and (orientation: portrait), (max-height: 510px) and (orientation: landscape)');
  const timer = byId('timer');
  const timerHome = timer.parentElement;
  const gameControls = byId('game-controls');
  const historyDuration = 240;
  const smoothStep = (t) => t * t * (3 - 2 * t);
  const turnKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const labels = { free: '自由节点', mirror: '联动节点', rotor: '星盘节点', rail: '滑轨节点' };
  const tools = {
    add: '点棋盘空白处添加一个节点。',
    edge: '依次点两个节点，为它们连线。',
    move: '拖动节点调整位置。拖实心手柄移动机制，拖空心手柄调整禁行区半径或滑轨端点。拖动星盘节点可改变它的轨道半径。',
    mechanism: '',
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
  const emptyDraft = () => ({ points: [], edges: [], groups: [], fixed: [], obstacles: [] });
  function readDraft(value) {
    if (!Array.isArray(value?.points) || value.points.length > puzzles.maxNodes || !value.points.every(validPoint) || !Array.isArray(value.edges)) return emptyDraft();
    const edges = [];
    for (const edge of value.edges) {
      if (!Array.isArray(edge) || edge.length !== 2) continue;
      const [a, b] = [...edge].sort((x, y) => x - y);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= value.points.length || a === b) continue;
      if (!edges.some(([u, v]) => u === a && v === b)) edges.push([a, b]);
    }
    const points = value.points.map(bounded);
    const validNode = (i) => Number.isInteger(i) && i >= 0 && i < points.length;
    const fixed = Array.isArray(value.fixed) ? [...new Set(value.fixed.filter(validNode))] : [];
    const used = new Set(fixed);
    const groups = [];
    for (const group of Array.isArray(value.groups) ? value.groups : []) {
      if (!Array.isArray(group?.members)) continue;
      const members = [...new Set(group.members)];
      if (!members.length || members.some((i) => !validNode(i) || used.has(i))) continue;
      const { kind } = group;
      if (kind === 'mirror' && members.length === 2) groups.push({ kind, members });
      else if (kind === 'rotor' && members.length >= 2 && validPoint(group.center) && puzzles.rotorFits(points, members, group.center)) {
        groups.push({ kind, members, center: group.center });
      } else if (kind === 'rail' && validPoint(group.a) && validPoint(group.b)) {
        const a = bounded(group.a);
        const b = bounded(group.b);
        if (g.distance(a, b) < 70 || members.some((node) => g.distanceToSegment(points[node], a, b) > .1)) continue;
        groups.push({ kind, members, a, b });
      } else continue;
      members.forEach((id) => used.add(id));
    }
    const obstacles = (Array.isArray(value.obstacles) ? value.obstacles : []).slice(0, 8).filter((item) =>
      validPoint(item?.center) && Number.isFinite(item.r) && item.r >= 24 && item.r <= 96);
    const answer = Array.isArray(value.answer) && value.answer.length === points.length && value.answer.every(validPoint) ? value.answer : undefined;
    const spacing = Number.isFinite(value.spacing) && value.spacing > 0 ? Math.min(g.radius, value.spacing) : undefined;
    return puzzles.rememberAnswer({ points, edges, groups, fixed, obstacles, answer, spacing });
  }

  let draft = readDraft(saved.draft);
  const draftHistory = [];
  const draftFuture = [];
  let activeTool = 'add';
  let editorOrigin = -1;
  let mechanismDraft = { anchors: [], members: [], index: -1 };
  let tab = 'random';
  let editing = false;
  let randomConfig = null;
  let level, state, moves, elapsed, won;
  let lengthChallenge = null;
  let clockStart = null;
  let timerMode = 'idle';
  let history = [];
  let future = [];
  let moving = null;
  const touches = new Map();
  let selection = -1;
  let view = { x: 0, y: 0, zoom: 1 };
  let animation = null;
  let search = null;
  let previousLengthResult;
  let historyMotion = null;
  let suggestion = null;
  let hover = -1;
  let size = { w: 0, h: 0, dpr: 1, turned: false };
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

  const lengthLimit = () => lengthChallenge?.targets[lengthChallenge.rank];
  const draftChallengeKey = (puzzle) => JSON.stringify([
    draft.points, draft.edges, draft.fixed, draft.groups, draft.obstacles, puzzle.radius,
  ]);

  function save() {
    if (!level) return;
    saved.draft = draft;
    saved.tab = tab;
    if (tab === 'random') {
      const stable = moving?.kind === 'node' ? moving.before.state : state;
      saved.random = { config: randomConfig, state: stable, moves, elapsed: timeSpent(), timerMode, lengthChallenge };
    } else if (!editing) {
      const key = draftChallengeKey(level);
      if (lengthChallenge) saved.draftLengthChallenge = { key, lengthChallenge };
      else if (saved.draftLengthChallenge?.key === key) delete saved.draftLengthChallenge;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // A full storage area does not interrupt play.
    }
  }

  function currentSnapshot() { return { state: g.copy(state), moves }; }

  function load(next, run) {
    const storedChallenge = run?.lengthChallenge ?? (next === level ? lengthChallenge : null);
    cancelSearch();
    animation = null;
    historyMotion = null;
    suggestion = null;
    moving = null;
    touches.clear();
    board.classList.remove('dragging');
    board.style.cursor = '';
    setFullscreenMenu(false);
    level = next;
    lengthChallenge = storedChallenge && !editing ? g.lengthChallenge(level, storedChallenge.rank, storedChallenge.reference) : null;
    const usable = Array.isArray(run?.state) && run.state.length === level.controls.length && run.state.every((part, i) =>
      Array.isArray(part) && part.length === level.controls[i].start.length && part.every(Number.isFinite));
    state = usable ? run.state.map((value, i) => g.normalize(level.controls[i], value)) : g.copy(level.initial);
    moves = usable && Number.isSafeInteger(run.moves) && run.moves >= 0 ? run.moves : 0;
    elapsed = usable && Number.isFinite(run.elapsed) && run.elapsed >= 0 ? run.elapsed : 0;
    const points = g.positions(level, state);
    const limit = lengthLimit();
    won = !editing && !g.evaluate(level, points).count && (limit === undefined || g.totalLength(level, points) <= limit);
    timerMode = usable && ['paused', 'running'].includes(run.timerMode) ? run.timerMode : won ? 'finished' : 'idle';
    clockStart = timerMode === 'running' ? performance.now() : null;
    history = [];
    future = [];
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
    byId('editing-return').hidden = editing;
    byId('session-panel').hidden = editing;
    timer.hidden = editing;
    byId('editor-status').textContent = '';
    setStatus('');
    updatePanel();
    syncMechanism();
    save();
    render();
  }

  function progressText() {
    const meta = `${level.points.length} 个节点 · ${level.edges.length} 条线`;
    const pairs = level.controls.filter(({ kind }) => kind === 'mirror').length;
    const disks = level.controls.filter(({ kind }) => kind === 'rotor').length;
    const rails = new Set(level.controls.filter(({ kind }) => kind === 'rail').map(({ a }) => a)).size;
    const fixed = level.ownership.filter((index) => index === -1).length;
    const obstacles = level.obstacles.length;
    const extras = [fixed && `${fixed} 个固定点`, pairs && `${pairs} 组联动`, disks && `${disks} 个星盘`,
      rails && `${rails} 条滑轨`, obstacles && `${obstacles} 个禁行区`].filter(Boolean);
    const random = tab === 'random';
    byId('level-title').textContent = random ? '随机解线' : '自定义题';
    byId('difficulty-label').textContent = random ? puzzles.difficulty[level.rank].label : editing ? '编辑题目' : '试玩题目';
    byId('puzzle-meta').textContent = [...(random ? [puzzles.modes[level.mode].label] : []), meta, ...extras].join(' · ');
    byId('level-rule').textContent = random ? puzzles.modes[level.mode].rule :
      editing ? '自己布置节点和连线，再试玩或求解。' : lengthLimit() === undefined ?
        '拖动红色节点，让冲突连线恢复为实线。' : '拖动可移动节点，消除冲突并缩短总线长。';
    board.setAttribute('aria-label', editing ? '自定义题编辑棋盘' : '解线棋盘。用 Q 或 E 选择节点，用方向键移动。');
    byId('anchor-legend').hidden = !level.ownership.includes(-1);
    byId('board-help').textContent = editing ? '双指或滚轮缩放 · 选择「移动」可平移' : '拖动空白处平移 · 双指或滚轮缩放';
    byId('draft-count').textContent = `${draft.points.length} / ${puzzles.maxNodes} 个节点`;
  }

  function updatePanel() {
    progressText();
    const points = g.positions(level, state);
    const count = g.evaluate(level, points).count;
    updateStats(count);
    updateLength(level, points, count);
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

  function updateLength(shownLevel, points, conflicts) {
    const length = g.totalLength(shownLevel, points);
    const meter = byId('current-length');
    const text = length.toFixed(2);
    if (meter.textContent !== text) meter.textContent = text;
    const goal = byId('length-goal');
    const limit = lengthLimit();
    goal.hidden = limit === undefined || editing;
    if (goal.hidden) return;
    const reached = !conflicts && length <= limit;
    const excess = (Math.ceil((length - limit) * 100) / 100).toFixed(2);
    const progress = reached ? '已通关' : conflicts ? '还需消除冲突' : `还需缩短 ${excess}`;
    const caption = `目标 ≤ ${limit.toFixed(2)} · ${progress}`;
    if (goal.textContent !== caption) goal.textContent = caption;
    goal.classList.toggle('good', reached);
  }

  function updateControls() {
    const dragging = moving?.kind === 'node' || moving?.kind === 'mechanism';
    const busy = !!animation || dragging;
    lengthSelect.disabled = busy || !!search || !level.edges.length;
    const rank = lengthChallenge?.rank ?? 'off';
    if (lengthSelect.value !== rank) lengthSelect.value = rank;
    for (const option of lengthSelect.options) {
      const limit = lengthChallenge?.targets[option.value];
      const label = lengthLabels[option.value];
      const text = limit === undefined ? label : `${label} · ≤ ${limit.toFixed(2)}`;
      if (option.textContent !== text) option.textContent = text;
    }
    const lengthSearch = search?.objective === 'length';
    const lengthLabel = lengthSearch ? (search.progress ? '停止并播放当前解' : '取消最短搜索') : '最短总线长';
    byId('solve').disabled = dragging || lengthSearch || animation?.singleStep === true;
    const solveLabel = search ? '取消搜索' : animation && !animation.singleStep ?
      (animation.paused ? '继续求解' : '暂停求解') : '一键求解';
    if (byId('solve-label').textContent !== solveLabel) byId('solve-label').textContent = solveLabel;
    const compactSolve = byId('compact-solve');
    compactSolve.hidden = !(search && !editing) && (!animation || animation.singleStep);
    if (!compactSolve.hidden && compactSolve.getAttribute('aria-label') !== solveLabel) {
      compactSolve.setAttribute('aria-label', solveLabel);
      compactSolve.textContent = search ? '取消搜索' : animation.paused ? '继续' : '暂停';
    }
    byId('hint').disabled = busy || !!search;
    byId('shortest').disabled = busy || (!!search && !lengthSearch);
    if (byId('shortest').textContent !== lengthLabel) byId('shortest').textContent = lengthLabel;
    byId('undo').disabled = !history.length || busy || lengthSearch;
    byId('redo').disabled = !future.length || busy || lengthSearch;
    byId('restart').disabled = busy || (!moves && timerMode === 'idle');
    byId('timer-toggle').textContent = timerMode === 'running' ? '暂停' : timerMode === 'idle' ? '开始' : '继续';
    byId('zoom-out').disabled = view.zoom <= minZoom || dragging;
    byId('zoom-in').disabled = view.zoom >= maxZoom || dragging;
    byId('fit').disabled = (view.zoom === 1 && !view.x && !view.y) || dragging;
    byId('draft-undo').disabled = !draftHistory.length || dragging;
    byId('draft-redo').disabled = !draftFuture.length || dragging;
    byId('draft-clear').disabled = !draft.points.length || dragging;
    byId('scramble-draft').disabled = dragging || !draft.edges.length;
    byId('solve-draft').disabled = dragging || lengthSearch;
    byId('shortest-draft').disabled = dragging || (!!search && !lengthSearch);
    if (byId('shortest-draft').textContent !== lengthLabel) byId('shortest-draft').textContent = lengthLabel;
    const draftSolveLabel = search ? '取消搜索' : '求解这题';
    if (byId('solve-draft-label').textContent !== draftSolveLabel) byId('solve-draft-label').textContent = draftSolveLabel;
    byId('play-draft').disabled = dragging;
    byId('edit-current').disabled = busy;
  }

  function updateClock() {
    const text = clockText(timeSpent());
    if (byId('clock').textContent !== text) byId('clock').textContent = text;
    if (search) updateSearchClock(search);
  }

  function refreshCompletion() {
    const points = g.positions(level, state);
    const clear = !g.evaluate(level, points).count;
    const limit = lengthLimit();
    const complete = clear && (limit === undefined || g.totalLength(level, points) <= limit);
    if (complete && !won) stopClock('finished');
    if (clear && !level.witness) level.witness = g.copy(state);
    if (!complete && timerMode === 'finished') timerMode = 'paused';
    won = complete;
  }

  function completeMove(before, count, helpUsed, message = '') {
    history.push(before);
    future.length = 0;
    if (history.length > 120) history.shift();
    if (!helpUsed) suggestion = null;
    moves += count;
    if (timerMode === 'idle') startClock();
    refreshCompletion();
    setStatus(won ? (lengthLimit() === undefined ? '' : '线长挑战已通关。') : message);
    updatePanel();
    save();
    render();
  }

  function stepHistory(forward) {
    if (byId(forward ? 'redo' : 'undo').disabled) return;
    const from = sampleHistoryMotion()?.state ?? state;
    (forward ? history : future).push(currentSnapshot());
    ({ state, moves } = (forward ? future : history).pop());
    const target = state;
    const controls = level.controls;
    startHistoryMotion((t) => ({
      state: target.map((value, i) => g.mixValue(controls[i], from[i], value, t)),
    }));
    suggestion = null;
    refreshCompletion();
    setStatus(forward ? '已恢复上一次撤销的操作。' : '已撤销上一次操作。');
    updatePanel();
    save();
    render();
  }

  function startHistoryMotion(sample) {
    historyMotion = reducedMotion.matches ? null : { started: performance.now(), sample };
    hover = -1;
  }

  function sampleHistoryMotion(now = performance.now()) {
    if (!historyMotion || reducedMotion.matches) return null;
    const t = g.clamp((now - historyMotion.started) / historyDuration, 0, 1);
    return t < 1 ? historyMotion.sample(smoothStep(t)) : null;
  }

  function pickTool(tool) {
    activeTool = tool;
    editorOrigin = -1;
    mechanismDraft = { anchors: [], members: [], index: -1 };
    board.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
    editButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)));
    syncMechanism();
    byId('editor-status').textContent = '';
    render();
  }

  function replaceDraft(next, { remember = true, changedNode } = {}) {
    cancelSearch();
    if (remember) {
      draftHistory.push({ draft, changedNode });
      draftFuture.length = 0;
      if (draftHistory.length > 120) draftHistory.shift();
    }
    historyMotion = null;
    draft = puzzles.rememberAnswer(next);
    level = puzzles.authored(draft);
    state = g.copy(level.initial);
    selection = -1;
    editorOrigin = -1;
    mechanismDraft = { anchors: [], members: [], index: -1 };
    hover = -1;
    byId('editor-status').textContent = '';
    updatePanel();
    syncMechanism();
    save();
    render();
  }

  function stepDraftHistory(forward) {
    if (byId(forward ? 'draft-redo' : 'draft-undo').disabled) return;
    const previous = level;
    const from = sampleHistoryMotion()?.draftPoints ?? g.positions(level, state);
    const next = (forward ? draftFuture : draftHistory).pop();
    (forward ? draftHistory : draftFuture).push({ draft, changedNode: next.changedNode });
    replaceDraft(next.draft, { remember: false });
    if (!reducedMotion.matches) animateDraftHistory(previous, from, next.changedNode);
  }

  function animateDraftHistory(previous, from, changedNode) {
    const to = g.positions(level, state);
    const growing = to.length > from.length;
    const shrinking = to.length < from.length;
    const shownLevel = shrinking ? previous : level;
    const larger = shrinking ? from : to;
    const isChanging = larger.map((_, i) => (growing || shrinking) && (changedNode === undefined || i === changedNode));
    const align = (points) => larger.map((point, i) => isChanging[i] ? point : points[i - (i > changedNode ? 1 : 0)]);
    const start = growing ? align(from) : from;
    const end = shrinking ? align(to) : to;
    if (!growing && !shrinking && start.every((point, i) => g.distance(point, end[i]) < .01)) return;

    // Retain mechanism paths when both layouts fit the displayed controls.
    const fromState = puzzles.projectState(shownLevel, start);
    const toState = puzzles.projectState(shownLevel, end);
    const modeledStart = g.positions(shownLevel, fromState);
    const modeledEnd = g.positions(shownLevel, toState);
    const fits = start.map((point, i) => g.distance(point, modeledStart[i]) < .1 && g.distance(end[i], modeledEnd[i]) < .1);
    startHistoryMotion((t) => {
      const pose = toState.map((value, i) => g.mixValue(shownLevel.controls[i], fromState[i], value, t));
      const points = g.positions(shownLevel, pose).map((point, i) => fits[i] ? point : g.interpolate(start[i], end[i], t));
      const opacity = isChanging.map((changing) => changing ? growing ? t : 1 - t : 1);
      const draftPoints = shrinking ? points.filter((_, i) => !isChanging[i]) : points;
      return { shownLevel, points, opacity, draftPoints };
    });
  }

  function syncMechanism() {
    const active = editing && activeTool === 'mechanism';
    byId('mechanism-editor').hidden = !active;
    const confirm = byId('apply-mechanism');
    const { anchors, members, index } = mechanismDraft;
    const kind = editMechanism.value;
    const grouped = kind === 'rotor' || kind === 'rail';
    confirm.hidden = !active || !grouped;
    confirm.textContent = (index < 0 ? '完成' : '保存') + (kind === 'rail' ? '滑轨' : '星盘');
    confirm.disabled = kind === 'rail' ? anchors.length !== 2 || !members.length : members.length < 2;
    const tips = {
      mirror: members.length ? '已选第一个节点，再点一个自由节点建立联动。' : '点两个自由节点建立一组。可以重复建立多组。',
      rotor: anchors.length ? `已选 ${members.length} 个节点。选至少两个，再确认。` : '点空白处设圆心，或点已有星盘的节点编辑成员。用「移动」调整已有星盘的位置和半径。',
      rail: anchors.length === 0 ? '点滑轨起点，或点已有滑轨节点编辑成员。用「移动」调整已有滑轨的端点。' :
        anchors.length === 1 ? '再点终点。' : `已选 ${members.length} 个节点。选择节点后确认，它们会吸附到同一条轨道。`,
      fixed: '点击自由节点切换固定状态。',
      obstacle: anchors.length ? '再点一个位置确定圆形禁行区的半径。' : '点空白处设禁行区圆心。用「移动」调整已有禁行区的位置和大小。',
      release: '点节点解除所在机制，或点禁行区删除它。',
    };
    byId('editor-tip').textContent = active ? tips[kind] : tools[activeTool];
  }

  function editMechanismAt(point, node) {
    const kind = editMechanism.value;
    const message = byId('editor-status');
    const { anchors, members } = mechanismDraft;
    const groupIndex = draft.groups.findIndex((group) => group.members.includes(node));
    const fixed = draft.fixed.includes(node);
    message.textContent = '';
    if (kind === 'release') {
      if (fixed) replaceDraft({ ...draft, fixed: draft.fixed.filter((item) => item !== node) });
      else if (groupIndex >= 0) replaceDraft({ ...draft, groups: draft.groups.filter((_, i) => i !== groupIndex) });
      else {
        const obstacle = draft.obstacles.findIndex(({ center, r }) => g.distance(center, point) < r);
        if (obstacle >= 0) replaceDraft({ ...draft, obstacles: draft.obstacles.filter((_, i) => i !== obstacle) });
      }
      return;
    }
    if (kind === 'fixed') {
      if (node < 0) return;
      if (groupIndex >= 0) { message.textContent = '先解除这个节点原有的机制。'; return; }
      replaceDraft({ ...draft, fixed: fixed ? draft.fixed.filter((item) => item !== node) : [...draft.fixed, node] });
      return;
    }
    if (kind === 'obstacle') {
      if (draft.obstacles.length >= 8) { message.textContent = '最多可添加八个禁行区。'; return; }
      if (!anchors.length) {
        if (node >= 0) return;
        anchors.push(bounded(point));
      } else {
        const center = anchors[0];
        const [x, y] = center;
        const room = Math.min(x, y, g.width - x, g.height - y) - 10;
        const r = g.clamp(g.distance(center, point), 24, Math.min(96, room));
        replaceDraft({ ...draft, obstacles: [...draft.obstacles, { center, r }] });
      }
      syncMechanism();
      render();
      return;
    }
    if (kind === 'mirror') {
      if (node < 0) return;
      if (fixed || groupIndex >= 0) { message.textContent = '请选择还没有机制的节点。'; return; }
      if (members.includes(node)) members.length = 0;
      else if (members.length) replaceDraft({ ...draft, groups: [...draft.groups, { kind, members: [members[0], node] }] });
      else members.push(node);
      syncMechanism();
      render();
      return;
    }
    const needed = kind === 'rotor' ? 1 : 2;
    if (!anchors.length && groupIndex >= 0 && draft.groups[groupIndex].kind === kind) {
      const group = draft.groups[groupIndex];
      mechanismDraft = { anchors: kind === 'rotor' ? [group.center] : [group.a, group.b], members: [...group.members], index: groupIndex };
    } else if (anchors.length < needed) {
      const anchor = bounded(point);
      if (anchors.length && g.distance(anchors[0], anchor) < 74) {
        message.textContent = '滑轨的两个端点需要离远一些。';
        return;
      }
      anchors.push(anchor);
    } else if (node >= 0) {
      if (fixed || groupIndex >= 0 && groupIndex !== mechanismDraft.index) {
        message.textContent = '请选择自由节点，或先解除它原有的机制。';
        return;
      }
      if (members.includes(node)) members.splice(members.indexOf(node), 1);
      else if (kind === 'rotor' && !puzzles.rotorFits(draft.points, [node], anchors[0])) {
        message.textContent = '此节点太靠近圆心，或旋转时会超出棋盘。';
        return;
      } else members.push(node);
    }
    syncMechanism();
    render();
  }

  function applyMechanism() {
    const { anchors, members, index } = mechanismDraft;
    const kind = editMechanism.value;
    const [a, b] = anchors;
    const points = g.copy(draft.points);
    const group = { kind, members: [...members] };
    if (kind === 'rotor') {
      group.center = a;
    } else {
      const length = g.distance(a, b);
      if (members.length > 1 && (members.length - 1) * 36 > length) {
        byId('editor-status').textContent = '这条滑轨太短，放不下所选的节点。';
        return;
      }
      group.a = a;
      group.b = b;
      const slots = members.map((node) => ({ node, parameter: g.trackPosition(points[node], a, b) }))
        .sort((x, y) => x.parameter - y.parameter);
      const collide = slots.some((slot, i) => i && (slot.parameter - slots[i - 1].parameter) * length < 36);
      slots.forEach(({ node, parameter }, i) => {
        points[node] = g.interpolate(a, b, collide ? i / (slots.length - 1) : parameter);
      });
    }
    const groups = [...draft.groups];
    if (index >= 0) groups[index] = group;
    else groups.push(group);
    replaceDraft({ ...draft, points, groups });
  }

  function scrambleDraft() {
    if (!draft.answer) {
      byId('editor-status').textContent = '先把节点和线摆成无冲突的布局，再打乱。';
      return;
    }
    const scrambled = puzzles.scrambleDraft(draft, Math.floor(Math.random() * 4294967296));
    if (!scrambled) {
      byId('editor-status').textContent = '当前机制下没能打乱题目。可以加一条连线或放开一个节点。';
      return;
    }
    replaceDraft(scrambled);
    byId('editor-status').textContent = '已打乱，并保留一个有效解。';
  }

  function editAt(point, node) {
    const message = byId('editor-status');
    if (activeTool === 'mechanism') { editMechanismAt(point, node); return; }
    if (activeTool === 'add') {
      if (node >= 0) { message.textContent = '请选择棋盘空白处。'; return; }
      if (draft.points.length >= puzzles.maxNodes) { message.textContent = `最多可放 ${puzzles.maxNodes} 个节点。`; return; }
      const place = bounded(point);
      if (draft.points.some((other) => g.distance(place, other) < g.radius * 2 + 5)) {
        message.textContent = '请与已有节点留一点距离。';
        return;
      }
      replaceDraft({ ...draft, points: [...draft.points, place] }, { changedNode: draft.points.length });
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
        const shift = (n) => n > node ? n - 1 : n;
        const points = draft.points.filter((_, i) => i !== node);
        const edges = draft.edges.filter(([a, b]) => a !== node && b !== node)
          .map((edge) => edge.map(shift));
        const fixed = draft.fixed.filter((n) => n !== node).map(shift);
        const groups = draft.groups.map((group) => ({
          ...group, members: group.members.filter((n) => n !== node).map(shift),
        })).filter(({ kind, members }) => members.length >= (kind === 'rail' ? 1 : 2));
        replaceDraft({ ...draft, points, edges, fixed, groups }, { changedNode: node });
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

  function searchTime(started) {
    return `${((performance.now() - started) / 1000).toFixed(2)} 秒`;
  }

  function lengthText({ status, length, lower, upper }) {
    const down = (Math.floor(lower * 100) / 100).toFixed(2);
    const gap = upper >= lower ? (Math.ceil((upper - lower) * 100) / 100).toFixed(2) : null;
    return `当前最短线长 ${length.toFixed(2)}，全局下界 ${down}。${status === 'length-proven' ?
      '已证距全局最短不超过 0.10 棋盘单位。' :
      `尚未证明最短。${gap === null ? '' : `最优差距至多 ${gap}。`}`}`;
  }

  function lengthProblemKey(puzzle) {
    return JSON.stringify([puzzle.radius ?? g.radius, puzzle.edges, puzzle.obstacles,
      puzzle.controls.map(({ kind, members, sum, center, a, b }) => [kind, members, sum, center, a, b]),
      puzzle.points.map((point, i) => {
        const control = puzzle.controls[puzzle.ownership[i]];
        return !control || control.kind === 'rotor' ? point : null;
      }),
    ]);
  }

  function updateSearchClock(job) {
    const clock = clockText(performance.now() - job.started);
    if (clock === job.clock) return;
    job.clock = clock;
    const task = job.objective === 'length' ? '正在搜索最短总线长' : '正在进行全局判定';
    job.report(`${task} · 总用时 ${clock} · 可随时取消${job.progress ? `。已找到${lengthText(job.progress)}` : ''}`);
  }

  function cancelSearch(message) {
    if (!search) return;
    const job = search;
    search = null;
    job.worker?.terminate();
    if (message !== undefined) job.report(message ? `${message} 判定总用时 ${searchTime(job.started)}。` : '');
  }

  function stopSearch() {
    const job = search;
    if (job.objective === 'length') {
      if (job.progress) {
        cancelSearch();
        updateControls();
        job.onSolved(searchTime(job.started), { ...job.progress, stopped: true });
        return;
      }
      cancelSearch('已取消最短搜索。取消前尚未找到可回放的布局。');
    } else cancelSearch('已取消搜索，题目是否有解尚未确定。');
    updateControls();
  }

  function requestWitness(puzzle, current, report, onSolved, started = performance.now(), objective) {
    const lengthKey = objective === 'length' ? lengthProblemKey(puzzle) : null;
    const previous = lengthKey && lengthKey === previousLengthResult?.key ? previousLengthResult.result : undefined;
    const job = { report, started, objective, onSolved };
    search = job;
    updateSearchClock(job);
    updateControls();
    function receive(result) {
      if (search !== job) return;
      const { status, state: answer, preserveRepair, reason } = result;
      const validAnswer = () => Array.isArray(answer) && answer.length === puzzle.controls.length &&
        answer.every((value, i) => Array.isArray(value) && value.length === current[i].length && value.every(Number.isFinite)) &&
        !g.evaluate(puzzle, g.positions(puzzle, answer)).count;
      if (result.type === 'length-progress') {
        if (!validAnswer()) return;
        previousLengthResult = { key: lengthKey, result };
        job.progress = result;
        job.clock = null;
        updateSearchClock(job);
        updateControls();
        return;
      }
      cancelSearch();
      updateControls();
      if ((status === 'solved' || status === 'length-best' || status === 'length-proven') &&
          validAnswer()) {
        if (status === 'solved') {
          puzzle.witness = answer;
          puzzle.preserveRepair = preserveRepair === true;
        } else previousLengthResult = { key: lengthKey, result };
        report('');
        onSolved(searchTime(job.started), status === 'solved' ? undefined : result);
        return;
      }
      const messages = {
        unsat: reason === 'obstacle-barrier' ? '已证明无解。禁行区构成屏障，相连节点的活动范围被隔在两侧。' :
          '已证明无解。当前机制和间距要求无法同时满足。',
        precision: '数学判定为有解，当前解转换成游戏坐标后未通过冲突检查。',
        local: '快速搜索未找到解。通过 HTTP 打开页面即可运行全局判定。',
        'length-local': '请通过 HTTP 打开页面以搜索最短总线长。',
      };
      const message = messages[status] ?? '全局判定未完成，当前题目是否有解尚未确定。';
      report(`${message} 判定总用时 ${searchTime(job.started)}。`);
    }
    if (location.protocol === 'file:') {
      if (objective === 'length') {
        receive({ status: 'length-local' });
        return;
      }
      // File URLs cannot load a same-origin worker or fetch its WebAssembly.
      setTimeout(() => {
        if (search !== job) return;
        receive(globalThis.JiexianSolverSearch.search(puzzle, current));
      }, 0);
      return;
    }
    try {
      job.worker = new Worker('./solver-worker.js?v=28');
      job.worker.onmessage = ({ data }) => receive(data);
      job.worker.onerror = () => receive({ status: 'unknown' });
      job.worker.postMessage({ puzzle, current, objective, previous });
    } catch {
      receive({ status: 'unknown' });
    }
  }

  function startDraft(solveNow, objective) {
    const started = performance.now();
    if (!draft.edges.length) {
      byId('editor-status').textContent = '请先放置节点并添加至少一条连线。';
      return;
    }
    const result = objective === 'length' ? { puzzle: puzzles.authored(draft) } : puzzles.solveDraft(draft);
    const report = (message) => { byId('editor-status').textContent = message; };
    if (!result.puzzle) {
      report(solveNow ? `${result.reason} 判定总用时 ${searchTime(started)}。` : result.reason);
      return;
    }
    if (objective === 'length') result.puzzle.witness = draft.answer ? puzzles.projectState(result.puzzle, draft.answer) : null;
    const play = (duration, lengthResult) => {
      editing = false;
      const stored = saved.draftLengthChallenge;
      const remembered = stored?.key === draftChallengeKey(result.puzzle) ? stored.lengthChallenge : null;
      load(result.puzzle, { lengthChallenge: remembered });
      if (solveNow) animate(false, duration ?? searchTime(started), lengthResult);
    };
    if (objective === 'length' || (solveNow && !result.puzzle.witness)) {
      requestWitness(result.puzzle, result.puzzle.initial, report, play, started, objective);
    }
    else play();
  }

  function randomize(config, run) {
    const stage = puzzles.generate(config.seed, config.rank, config.count, config.mechanism, config.revision);
    if (!stage) return false;
    randomConfig = config;
    tab = 'random';
    editing = false;
    load(stage, run);
    return true;
  }

  function createRandom(rank, count, mode, auto) {
    const config = { rank, count, mechanism: mode, auto, revision: generatorRevision };
    const challengeRank = lengthChallenge?.rank;
    for (let tries = 0; tries < 6; tries++) {
      config.seed = Math.floor(Math.random() * 4294967296);
      if (config.seed !== randomConfig?.seed && randomize(config)) {
        if (challengeRank && challengeRank !== 'off') chooseLengthChallenge(challengeRank);
        return true;
      }
    }
    return false;
  }

  function reflectConfig(config) {
    form.querySelector(`input[value="${config.rank}"]`).checked = true;
    countInput.value = config.auto ? '' : config.count;
    countInput.placeholder = `自动（${puzzles.defaultCount(config.rank, config.mechanism)}）`;
    mechanism.value = config.mechanism;
  }

  function chooseLengthChallenge(rank) {
    function apply(challenge, totalTime) {
      lengthChallenge = challenge;
      suggestion = null;
      refreshCompletion();
      if (!won && timerMode === 'paused' && !elapsed && !moves) timerMode = 'idle';
      let message = won && lengthLimit() !== undefined ? '线长挑战已通关。' : '';
      if (totalTime) message = `${message} 判定总用时 ${totalTime}。`.trim();
      setStatus(message);
      updatePanel();
      save();
      render();
    }
    if (lengthChallenge || rank === 'off') {
      apply(lengthChallenge && { ...lengthChallenge, rank });
      return;
    }
    function reference() {
      const candidates = [level.witness, state].map((pose) => g.lengthChallenge(level, rank, pose)).filter(Boolean);
      const best = candidates.sort((a, b) => a.targets.hard - b.targets.hard)[0];
      if (!best) return null;
      const short = globalThis.JiexianSolverLength.shortenLayout(level, best.reference);
      return g.lengthChallenge(level, rank, short.state) ?? best;
    }
    const ready = reference();
    if (ready) apply(ready);
    else requestWitness(level, g.copy(state), setStatus, (duration) => apply(reference(), duration));
  }

  function animate(singleStep, totalTime, lengthResult) {
    const challengeAnswer = lengthLimit() === undefined ? null : lengthChallenge.reference;
    if (!lengthResult && !challengeAnswer && !level.witness && !won) {
      requestWitness(level, g.copy(state), setStatus, (duration) => animate(singleStep, duration));
      return;
    }
    const withTime = (message) => totalTime ? `${message} 判定总用时 ${totalTime}。`.trim() : message;
    const summary = lengthResult ? `${lengthResult.stopped ? '已停止搜索并应用当前解。' : ''}${lengthText(lengthResult)}` : '';
    const goal = lengthResult?.state ?? challengeAnswer;
    const plan = !lengthResult && challengeAnswer && won ? [] :
      goal ? g.planTo(level, state, goal) : suggestion ?? g.solve(level, state);
    if (!plan.length) {
      setStatus(withTime(summary || (won && challengeAnswer ? '线长挑战已通关。' : '')));
      return;
    }
    if (timerMode === 'idle') startClock();
    setFullscreenMenu(false);
    const steps = singleStep ? plan.slice(0, 1) : plan;
    historyMotion = null;
    const before = currentSnapshot();
    const playback = { state: g.copy(state), index: steps[0].index, singleStep, paused: false };
    const duration = reducedMotion.matches ? 0 : steps.length === 1 ? 480 : Math.min(320, 4800 / steps.length);
    animation = playback;
    hover = -1;
    setStatus(withTime(singleStep ? '正在演示下一步…' : '正在逐步解开…'));
    updateControls();
    let step = 0;
    let started = performance.now();
    let lastFrame = started;
    let pending = 0;
    let from = playback.state[steps[0].index];
    playback.togglePause = () => {
      if (playback.paused) {
        const now = performance.now();
        started += now - lastFrame;
        lastFrame = now;
        pending = requestAnimationFrame(tick);
      } else cancelAnimationFrame(pending);
      playback.paused = !playback.paused;
      setStatus(withTime(playback.paused ? '求解已暂停。' : '正在逐步解开…'));
      updateControls();
    };
    function tick(now) {
      if (animation !== playback || playback.paused) return;
      lastFrame = now;
      while (step < steps.length) {
        const move = steps[step];
        const part = duration ? g.clamp((now - started) / duration, 0, 1) : 1;
        const smooth = smoothStep(part);
        playback.index = move.index;
        playback.state[move.index] = part === 1 ? move.value : g.mixValue(level.controls[move.index], from, move.value, smooth);
        if (part < 1) {
          render();
          pending = requestAnimationFrame(tick);
          return;
        }
        step++;
        started += duration;
        if (step < steps.length) from = playback.state[steps[step].index];
      }
      state = playback.state;
      animation = null;
      suggestion = singleStep ? plan.slice(1) : null;
      completeMove(before, steps.length, true, withTime(singleStep ? '已提示一步，可以继续拖动。' : ''));
      if (lengthResult || won && totalTime) setStatus(withTime(summary || (won && challengeAnswer ? '线长挑战已通关。' : '')));
    }
    pending = requestAnimationFrame(tick);
  }

  function transform() {
    const width = size.turned ? g.height : g.width;
    const height = size.turned ? g.width : g.height;
    const fit = Math.min(Math.max(1, size.w - 12) / (width - 2 * boardInset),
      Math.max(1, size.h - 12) / (height - 2 * boardInset));
    return { k: fit * view.zoom, x: size.w / 2 + view.x, y: size.h / 2 + view.y };
  }

  function toWorld([px, py]) {
    const { k, x, y } = transform();
    const dx = (px - x) / k;
    const dy = (py - y) / k;
    return [g.width / 2 + (size.turned ? dy : dx), g.height / 2 + (size.turned ? -dx : dy)];
  }

  function local(event) {
    const rect = board.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function setView(x, y, zoom = view.zoom) {
    view = { x: g.clamp(x, -size.w * .75, size.w * .75), y: g.clamp(y, -size.h * .75, size.h * .75), zoom };
    updateControls();
    render();
  }

  function zoom(factor, from = [size.w / 2, size.h / 2], to = from) {
    if (moving?.kind === 'node' || moving?.kind === 'mechanism') return;
    const nextZoom = g.clamp(view.zoom * factor, minZoom, maxZoom);
    const ratio = nextZoom / view.zoom;
    const cx = size.w / 2;
    const cy = size.h / 2;
    setView(to[0] - cx - (from[0] - cx - view.x) * ratio, to[1] - cy - (from[1] - cy - view.y) * ratio, nextZoom);
  }

  function resetView() {
    if (moving?.kind === 'node' || moving?.kind === 'mechanism') return;
    view = { x: 0, y: 0, zoom: 1 };
    updateControls();
    render();
  }

  function setFullscreenMenu(open) {
    document.documentElement.classList.toggle('fullscreen-menu-open', open);
    const button = byId('fullscreen-menu');
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? '收起操作' : '操作';
    if (!open && gameControls.contains(document.activeElement) && compactViewport.matches &&
        document.documentElement.classList.contains('compact-fullscreen')) button.focus({ preventScroll: true });
  }

  function syncFullscreen() {
    const active = Boolean(document.fullscreenElement) || expandedView;
    const compact = active && compactViewport.matches;
    const root = document.documentElement;
    root.classList.toggle('game-fullscreen', active);
    root.classList.toggle('compact-fullscreen', compact);
    if (!compact) setFullscreenMenu(false);
    const timerContainer = compact ? gameControls : timerHome;
    if (timer.parentElement !== timerContainer) timerContainer.append(timer);
    const button = byId('fullscreen');
    button.querySelector('span').textContent = active ? '退出全屏' : '全屏';
    button.querySelector('use').setAttribute('href', active ? '#i-exit-fullscreen' : '#i-fullscreen');
    resize();
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

  function mechanismHandleAt(point, touch) {
    if (!editing || activeTool !== 'move') return null;
    let best = null;
    let distance = (touch ? 15 : 10) / transform().k;
    for (const handle of mechanismEditor.handles(draft)) {
      const gap = g.distance(point, handle.point);
      if (gap >= distance) continue;
      distance = gap;
      best = handle;
    }
    return best;
  }

  function pinchSample() {
    const [a, b] = touches.values();
    return { center: g.interpolate(a, b, .5), distance: Math.max(1, g.distance(a, b)) };
  }

  function beginPointer(action) {
    if (action.kind === 'node' || action.kind === 'mechanism') cancelSearch('');
    moving = action;
    hover = -1;
    selection = -1;
    board.classList.add('dragging');
    updateControls();
    render();
  }

  board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const touch = event.pointerType === 'touch';
    const id = event.pointerId;
    if (moving && (!touch || (!touches.size && moving.kind !== 'pinch'))) return;
    const at = local(event);
    if (touch) {
      touches.set(id, at);
      board.setPointerCapture(id);
      if (touches.size >= 2) {
        if (moving?.kind === 'node') state = moving.before.state;
        beginPointer({ kind: 'pinch', sample: pinchSample() });
        return;
      }
    }
    if (animation || historyMotion) {
      if (!touch) board.setPointerCapture(id);
      beginPointer({ kind: 'pan', at, id });
      return;
    }
    const point = toWorld(at);
    const node = hitTest(point, touch);
    if (editing && activeTool !== 'move') {
      if (touch) moving = { kind: 'editTap', at, id };
      else editAt(point, node);
      return;
    }
    let handle = mechanismHandleAt(point, touch);
    if (!handle && editing && node !== -1) {
      const index = draft.groups.findIndex((group) => group.kind === 'rotor' && group.members.includes(node));
      if (index >= 0 && !event.shiftKey) handle = { kind: 'rotor', index, anchor: 'member', point: draft.points[node], node };
      else if (level.ownership[node] === -1) handle = { kind: 'fixed', index: node, point: draft.points[node] };
    }
    if (handle) {
      beginPointer({ kind: 'mechanism', point, handle, id });
    } else if (node !== -1 && level.ownership[node] === -1) {
      setStatus('这个锚点固定在原位。');
      return;
    } else if (node !== -1) {
      const index = level.ownership[node];
      beginPointer({ kind: 'node', node, index, point, before: currentSnapshot(), id });
    } else {
      beginPointer({ kind: 'pan', at, id });
    }
    if (!touch) board.setPointerCapture(id);
  });

  board.addEventListener('pointermove', (event) => {
    const touch = event.pointerType === 'touch';
    const at = local(event);
    if (touches.has(event.pointerId)) touches.set(event.pointerId, at);
    if (moving?.kind === 'pinch') {
      if (!touches.has(event.pointerId)) return;
      const previous = moving.sample;
      moving.sample = pinchSample();
      zoom(moving.sample.distance / previous.distance, previous.center, moving.sample.center);
      return;
    }
    if (!moving) {
      if (touch || animation || historyMotion) return;
      const point = toWorld(at);
      const found = hitTest(point, false);
      const handle = mechanismHandleAt(point, false);
      board.style.cursor = handle && handle.anchor !== 'center' ? 'move' :
        editing && activeTool !== 'move' ? 'crosshair' : !editing && found !== -1 && level.ownership[found] === -1 ? 'default' : 'grab';
      if (hover === found) return;
      hover = found;
    } else if (moving.id === event.pointerId) {
      if (moving.kind === 'editTap') {
        if (g.distance(at, moving.at) < 8) return;
        beginPointer({ ...moving, kind: 'pan' });
      }
      if (moving.kind === 'pan') {
        setView(view.x + at[0] - moving.at[0], view.y + at[1] - moving.at[1]);
        moving.at = at;
      } else if (moving.kind === 'mechanism') {
        const delta = toWorld(at).map((value, axis) => value - moving.point[axis]);
        moving.nextDraft = mechanismEditor.drag(draft, moving.handle, delta);
        moving.preview = moving.nextDraft === draft ? null : puzzles.authored(moving.nextDraft);
      } else {
        const { node, index, before } = moving;
        state[index] = g.dragValue(level, node, toWorld(at), before.state[index], moving.point);
        if (!touch && !editing && timerMode === 'idle' && g.moveDistance(level.controls[index], before.state[index], state[index]) >= 2) startClock();
      }
    }
    render();
  });

  function finishPointer(event) {
    const ended = touches.delete(event.pointerId);
    if (moving?.kind === 'pinch') {
      if (!ended) return;
      if (touches.size >= 2) moving.sample = pinchSample();
      else if (touches.size) {
        const [[id, at]] = touches;
        moving = { kind: 'pan', at, id };
      } else {
        moving = null;
        board.classList.remove('dragging');
      }
      return;
    }
    if (!moving || event.pointerId !== moving.id) return;
    const action = moving;
    moving = null;
    board.classList.remove('dragging');
    if (action.kind === 'editTap' && event.type === 'pointerup' && !animation && !historyMotion) {
      const point = toWorld(action.at);
      editAt(point, hitTest(point, true));
    }
    if (action.kind === 'mechanism' && event.type === 'pointerup' && action.preview) {
      replaceDraft(action.nextDraft);
      return;
    }
    if (action.kind === 'node') {
      const previous = action.before.state[action.index];
      const changed = g.moveDistance(level.controls[action.index], previous, state[action.index]) >= 2;
      if (event.type === 'pointerup' && changed) {
        if (editing) replaceDraft({ ...draft, points: g.positions(level, state) });
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
    if (event.ctrlKey || event.metaKey || event.altKey || animation || historyMotion || moving) return;
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
    const screenDirection = turnKeys[event.key];
    if (!screenDirection || selection === -1) return;
    const direction = size.turned ? [screenDirection[1], -screenDirection[0]] : screenDirection;
    event.preventDefault();
    if (search) {
      cancelSearch('');
      updateControls();
    }
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
        replaceDraft({ ...draft, points: g.positions(level, state) });
        selection = node;
      } else completeMove(before, 1, false);
    }
  });
  board.addEventListener('blur', () => { selection = -1; render(); });

  function conflictDash(a, b, trimA, trimB, scale) {
    const visible = g.distance(a, b) - trimA - trimB;
    if (visible <= 0) return { pattern: [5 / scale, 4 / scale], phase: 0 };
    const period = visible / Math.max(1, Math.round(visible * scale / 9));
    const gap = Math.min(4.5 / scale, period / 2);
    const dash = period - gap;
    // Start and finish at the center of a dash so even a short visible edge has a gap.
    return { pattern: [dash, gap], phase: dash / 2 - trimA };
  }

  function draw(now) {
    frame = 0;
    const motion = sampleHistoryMotion(now);
    if (motion) render();
    else historyMotion = null;
    const preview = moving?.preview;
    const shownLevel = preview ?? motion?.shownLevel ?? level;
    const active = animation?.state ?? motion?.state ?? state;
    const points = preview ? g.positions(preview, preview.initial) : motion?.points ?? g.positions(level, active);
    const faults = g.evaluate(shownLevel, points);
    if (!motion) updateStats(faults.count);
    updateLength(shownLevel, points, faults.count);
    if (!size.w || !size.h) return;
    const { k, x, y } = transform();
    const r = Math.max(g.radius, 8 / k);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.translate(x, y);
    ctx.scale(k, k);
    if (size.turned) ctx.rotate(Math.PI / 2);
    ctx.translate(-g.width / 2, -g.height / 2);
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = '#e3e3e0';
    ctx.beginPath();
    ctx.roundRect(boardInset, boardInset, g.width - 2 * boardInset, g.height - 2 * boardInset, 15);
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
    const uprightLabel = (label, [px, py]) => {
      if (!size.turned) { ctx.fillText(label, px, py); return; }
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    };

    const tracks = new Set();
    shownLevel.controls.forEach((control) => {
      if (control.kind === 'rotor') {
        const orbits = [];
        for (const node of control.members) {
          const radius = g.distance(points[node], control.center);
          if (!orbits.some((orbit) => Math.abs(orbit - radius) < 4)) orbits.push(radius);
        }
        circle(control.center, Math.max(...orbits) + 23, '#f6f6f485', '#b0b0ab');
        ctx.setLineDash([4, 7]);
        orbits.forEach((orbit) => circle(control.center, orbit, null, '#a3a39d'));
        ctx.setLineDash([]);
        circle(control.center, 9 / k, '#fff', '#8e8e88');
        ctx.font = `700 ${9 / k}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#4b4b49';
        uprightLabel(control.symbol, control.center);
      }
      if (control.kind === 'rail' && !tracks.has(control.a)) {
        tracks.add(control.a);
        ctx.lineWidth = 5;
        line(control.a, control.b, '#cdcdca');
        circle(control.a, 5, '#81817d');
        circle(control.b, 5, '#81817d');
        ctx.lineWidth = 1 / k;
      }
    });
    shownLevel.obstacles.forEach(({ center, r }, i) => {
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

    if (editing && activeTool === 'mechanism') {
      const { anchors } = mechanismDraft;
      const [a, b] = anchors;
      if (a) {
        ctx.lineWidth = 1.5 / k;
        if (b) line(a, b, '#28536e');
        anchors.forEach((point) => circle(point, 5 / k, '#fff', '#28536e'));
      }
    }

    const conflicts = [];
    const nodeRim = r + 1.5 / k;
    ctx.lineWidth = Math.max(2.15, 1.35 / k);
    shownLevel.edges.forEach(([a, b], i) => {
      const from = points[a];
      const to = points[b];
      const opacity = motion?.opacity ? Math.min(motion.opacity[a], motion.opacity[b]) : 1;
      if (faults.badEdges.has(i)) {
        const dx = Math.abs(to[0] - from[0]);
        const dy = Math.abs(to[1] - from[1]);
        const squareRim = dx || dy ? nodeRim * Math.hypot(dx, dy) / Math.max(dx, dy) : nodeRim;
        const trim = (node) => shownLevel.ownership[node] === -1 ? squareRim : nodeRim;
        conflicts.push({ from, to, opacity, ...conflictDash(from, to, trim(a), trim(b), k) });
      } else {
        ctx.globalAlpha = opacity;
        line(from, to, '#111111');
      }
    });
    const conflictWidth = Math.max(1.65, 1.35 / k);
    ctx.lineCap = 'butt';
    for (const [color, width] of [['#fff', conflictWidth + 1 / k], ['#696966', conflictWidth]]) {
      ctx.lineWidth = width;
      for (const { from, to, opacity, pattern, phase } of conflicts) {
        ctx.globalAlpha = opacity;
        ctx.setLineDash(pattern);
        ctx.lineDashOffset = phase;
        line(from, to, color);
      }
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.lineCap = 'round';
    points.forEach((point, node) => {
      const [px, py] = point;
      ctx.globalAlpha = motion?.opacity?.[node] ?? 1;
      const index = shownLevel.ownership[node];
      const control = shownLevel.controls[index];
      const kind = control?.kind ?? 'fixed';
      const picked = node === selection || node === editorOrigin ||
        editing && mechanismDraft.members.includes(node) || moving?.kind === 'node' && index === moving.index || animation?.index === index;
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
      if (kind === 'rail') {
        const length = g.distance(control.a, control.b);
        const dx = (control.b[0] - control.a[0]) / length * r * .52;
        const dy = (control.b[1] - control.a[1]) / length * r * .52;
        line([px - dx, py - dy], [px + dx, py + dy], '#fff');
      } else if (kind === 'free' && !editing) {
        circle(point, Math.min(r * .27, Math.max(3.4, 1.8 / k)), '#fff');
      } else {
        const label = kind === 'free' ? String(node + 1) : kind === 'fixed' ? '×' : control.symbol;
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.max(label.length > 1 ? 12 : 15, 9 / k)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        uprightLabel(label, point);
      }
    });
    ctx.globalAlpha = 1;
    if (editing && activeTool === 'move' && !motion) {
      const handles = mechanismEditor.handles(moving?.nextDraft ?? draft);
      ctx.lineWidth = 1.8 / k;
      for (const { kind, index, anchor, point } of handles) {
        const selected = moving?.handle?.kind === kind && moving.handle.index === index && moving.handle.anchor === anchor;
        const color = '#28536e';
        circle(point, (selected ? 8 : 6) / k, anchor === 'center' ? color : '#fff', anchor === 'center' ? '#fff' : color);
      }
    }
  }

  function render() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function resize() {
    const w = board.clientWidth;
    const h = board.clientHeight;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const turned = document.documentElement.classList.contains('compact-fullscreen') && portrait.matches;
    if (w === size.w && h === size.h && dpr === size.dpr && turned === size.turned) return;
    const center = size.w && size.h ? toWorld([size.w / 2, size.h / 2]) : [g.width / 2, g.height / 2];
    size = { w, h, dpr, turned };
    board.width = Math.round(w * dpr);
    board.height = Math.round(h * dpr);
    const { k } = transform();
    const dx = center[0] - g.width / 2;
    const dy = center[1] - g.height / 2;
    setView(-k * (turned ? -dy : dx), -k * (turned ? dx : dy));
  }

  form.addEventListener('change', () => {
    const rank = new FormData(form).get('rank');
    countInput.placeholder = `自动（${puzzles.defaultCount(rank, mechanism.value)}）`;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const rank = new FormData(form).get('rank');
    const automatic = countInput.value === '';
    const count = automatic ? puzzles.defaultCount(rank, mechanism.value) : Number(countInput.value);
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
  byId('edit-current').addEventListener('click', () => {
    const points = g.positions(level, state);
    const spacing = level.radius;
    enterEditor();
    pickTool('move');
    replaceDraft({ ...draft, points, spacing });
    byId('editor-status').textContent = '正在编辑刚才的布局。可以撤销编辑以取回原题。';
  });
  editButtons.forEach((button) => button.addEventListener('click', () => pickTool(button.dataset.tool)));
  editMechanism.addEventListener('change', () => pickTool('mechanism'));
  byId('apply-mechanism').addEventListener('click', applyMechanism);
  byId('scramble-draft').addEventListener('click', scrambleDraft);
  byId('draft-undo').addEventListener('click', () => stepDraftHistory(false));
  byId('draft-redo').addEventListener('click', () => stepDraftHistory(true));
  byId('draft-clear').addEventListener('click', () => replaceDraft(emptyDraft()));
  byId('solve-draft').addEventListener('click', () => {
    if (search) stopSearch();
    else startDraft(true);
  });
  byId('shortest-draft').addEventListener('click', () => {
    if (search) stopSearch();
    else startDraft(true, 'length');
  });
  byId('play-draft').addEventListener('click', () => startDraft(false));
  byId('rules').addEventListener('click', () => byId('rules-dialog').showModal());
  function toggleSolve() {
    if (animation) animation.togglePause();
    else if (search) stopSearch();
    else animate(false);
  }
  byId('solve').addEventListener('click', toggleSolve);
  lengthSelect.addEventListener('change', () => chooseLengthChallenge(lengthSelect.value));
  byId('shortest').addEventListener('click', () => {
    if (search) stopSearch();
    else {
      const puzzle = lengthLimit() === undefined ? level : { ...level, witness: lengthChallenge.reference };
      requestWitness(puzzle, g.copy(state), setStatus, (duration, result) => animate(false, duration, result),
        performance.now(), 'length');
    }
  });
  byId('hint').addEventListener('click', () => animate(true));
  byId('undo').addEventListener('click', () => stepHistory(false));
  byId('redo').addEventListener('click', () => stepHistory(true));
  byId('restart').addEventListener('click', () => { load(level); setStatus('已重开本题。'); });
  byId('timer-toggle').addEventListener('click', () => {
    if (timerMode === 'running') stopClock('paused');
    else startClock();
    updateControls();
    updateClock();
    save();
  });
  byId('timer-reset').addEventListener('click', () => {
    elapsed = 0;
    clockStart = timerMode === 'running' ? performance.now() : null;
    updateClock();
    save();
  });
  byId('zoom-in').addEventListener('click', () => zoom(1.24));
  byId('zoom-out').addEventListener('click', () => zoom(1 / 1.24));
  byId('fit').addEventListener('click', resetView);
  byId('fullscreen').addEventListener('click', toggleFullscreen);
  byId('fullscreen-menu').addEventListener('click', () => {
    setFullscreenMenu(!document.documentElement.classList.contains('fullscreen-menu-open'));
  });
  byId('compact-solve').addEventListener('click', toggleSolve);
  document.addEventListener('fullscreenchange', syncFullscreen);
  compactViewport.addEventListener('change', syncFullscreen);
  portrait.addEventListener('change', syncFullscreen);
  document.addEventListener('keydown', (event) => {
    if (byId('rules-dialog').open) return;
    if (event.key === 'Escape' && document.documentElement.classList.contains('fullscreen-menu-open')) {
      setFullscreenMenu(false);
      return;
    }
    if (event.key === 'Escape' && expandedView) {
      expandedView = false;
      syncFullscreen();
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (!event.altKey && (event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      const forward = key === 'y' || event.shiftKey;
      if (editing) stepDraftHistory(forward);
      else stepHistory(forward);
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
  if (valid && ![3, 4, generatorRevision].includes(config.revision)) {
    const count = config.auto ? puzzles.defaultCount(config.rank, config.mechanism) : config.count;
    createRandom(config.rank, count, config.mechanism, config.auto);
  } else if (valid) randomize(config, saved.random);
  if (!randomConfig) createRandom('easy', puzzles.defaultCount('easy', 'classic'), 'classic', true);
  reflectConfig(randomConfig);
  if (initialTab === 'editor') enterEditor();
  resize();
})();
