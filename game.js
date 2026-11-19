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
  const editMechanism = byId('edit-mechanism');
  const storageKey = 'jiexian-v2';
  const generatorRevision = 3;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const historyDuration = 240;
  const smoothStep = (t) => t * t * (3 - 2 * t);
  const turnKeys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const labels = { free: '自由节点', mirror: '联动节点', rotor: '星盘节点', rail: '滑轨节点' };
  const tools = {
    add: '点棋盘空白处添加一个节点。',
    edge: '依次点两个节点，为它们连线。',
    move: '拖动节点调整位置。拖动空白处平移。',
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
  let clockStart = null;
  let timerMode = 'idle';
  let history = [];
  let future = [];
  let moving = null;
  let selection = -1;
  let view = { x: 0, y: 0, zoom: 1 };
  let animation = null;
  let historyMotion = null;
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
      saved.random = { config: randomConfig, state: stable, moves, elapsed: timeSpent(), timerMode };
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // A full storage area does not interrupt play.
    }
  }

  function currentSnapshot() { return { state: g.copy(state), moves }; }

  function load(next, run) {
    animation = null;
    historyMotion = null;
    suggestion = null;
    moving = null;
    board.classList.remove('dragging');
    board.style.cursor = '';
    level = next;
    const usable = Array.isArray(run?.state) && run.state.length === level.controls.length && run.state.every((part, i) =>
      Array.isArray(part) && part.length === level.controls[i].start.length && part.every(Number.isFinite));
    state = usable ? run.state.map((value, i) => g.normalize(level.controls[i], value)) : g.copy(level.initial);
    moves = usable && Number.isSafeInteger(run.moves) && run.moves >= 0 ? run.moves : 0;
    elapsed = usable && Number.isFinite(run.elapsed) && run.elapsed >= 0 ? run.elapsed : 0;
    won = !editing && g.evaluate(level, g.positions(level, state)).count === 0;
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
    byId('timer').hidden = editing;
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
      editing ? '自己布置节点和连线，再试玩或求解。' : '拖动红色节点，让冲突连线恢复为实线。';
    board.setAttribute('aria-label', editing ? '自定义题编辑棋盘' : '解线棋盘。用 Q 或 E 选择节点，用方向键移动。');
    byId('anchor-legend').hidden = !level.ownership.includes(-1);
    byId('board-help').textContent = editing ? '滚轮缩放 · 选择「移动」可平移' : '拖动空白处平移 · 滚轮缩放 · 键盘用 Q / E 选点';
    byId('draft-count').textContent = `${draft.points.length} / ${puzzles.maxNodes} 个节点`;
  }

  function updatePanel() {
    progressText();
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
    byId('redo').disabled = !future.length || busy;
    byId('restart').disabled = busy || (!moves && timerMode === 'idle');
    byId('timer-toggle').textContent = timerMode === 'running' ? '暂停' : timerMode === 'idle' ? '开始' : '继续';
    byId('zoom-out').disabled = view.zoom <= 0.75 || dragging;
    byId('zoom-in').disabled = view.zoom >= 2.8 || dragging;
    byId('fit').disabled = (view.zoom === 1 && !view.x && !view.y) || dragging;
    byId('draft-undo').disabled = !draftHistory.length || dragging;
    byId('draft-redo').disabled = !draftFuture.length || dragging;
    byId('draft-clear').disabled = !draft.points.length || dragging;
    byId('scramble-draft').disabled = dragging || !draft.edges.length;
    byId('solve-draft').disabled = dragging;
    byId('play-draft').disabled = dragging;
    byId('edit-current').disabled = busy;
  }

  function updateClock() {
    const text = clockText(timeSpent());
    if (byId('clock').textContent !== text) byId('clock').textContent = text;
  }

  function refreshCompletion() {
    const complete = g.evaluate(level, g.positions(level, state)).count === 0;
    if (complete && !won) stopClock('finished');
    if (complete && !level.witness) level.witness = g.copy(state);
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
    setStatus(won ? '' : message);
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
      rotor: anchors.length ? `已选 ${members.length} 个节点。选至少两个，再确认。` : '点空白处设圆心，或点已建星盘的节点来编辑成员。',
      rail: anchors.length === 0 ? '点滑轨起点，或点已有滑轨节点来编辑成员。' :
        anchors.length === 1 ? '再点终点。' : `已选 ${members.length} 个节点。选择节点后确认，它们会吸附到同一条轨道。`,
      fixed: '点击自由节点切换固定状态。',
      obstacle: anchors.length ? '再点一个位置确定圆形禁行区的半径。' : '点空白处设禁行区圆心。',
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

  function startDraft(solveNow) {
    if (!draft.edges.length) {
      byId('editor-status').textContent = '请先放置节点并添加至少一条连线。';
      return;
    }
    const result = puzzles.solveDraft(draft);
    if (!result.puzzle || (solveNow && !result.puzzle.witness)) {
      byId('editor-status').textContent = result.reason;
      return;
    }
    editing = false;
    load(result.puzzle);
    syncMechanism();
    if (result.reason) setStatus(result.reason);
    if (solveNow) animate(false);
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
    const config = { rank, count, mechanism: mode, auto, revision: generatorRevision };
    for (let tries = 0; tries < 6; tries++) {
      config.seed = Math.floor(Math.random() * 4294967296);
      if (config.seed !== randomConfig?.seed && randomize(config)) return true;
    }
    return false;
  }

  function reflectConfig(config) {
    form.querySelector(`input[value="${config.rank}"]`).checked = true;
    countInput.value = config.auto ? '' : config.count;
    countInput.placeholder = `自动（${puzzles.defaultCount(config.rank, config.mechanism)}）`;
    mechanism.value = config.mechanism;
  }

  function animate(singleStep) {
    if (!level.witness && !won) {
      setStatus('暂时没找到符合所有机制的解。返回编辑，摆出无冲突布局后再打乱即可生成有解题。');
      return;
    }
    const plan = suggestion ?? g.solve(level, state);
    if (!plan.length) {
      setStatus('');
      return;
    }
    if (timerMode === 'idle') startClock();
    const steps = singleStep ? plan.slice(0, 1) : plan;
    historyMotion = null;
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
        const smooth = smoothStep(part);
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
      completeMove(before, steps.length, true, singleStep ? '已提示一步，可以继续拖动。' : '');
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
    button.querySelector('span').textContent = active ? '退出全屏' : '全屏';
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
    if (event.button !== 0 || moving || animation || historyMotion) return;
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
    if (animation || historyMotion) return;
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
        replaceDraft({ ...draft, points: g.positions(level, state) });
        selection = node;
      } else completeMove(before, 1, false);
    }
  });
  board.addEventListener('blur', () => { selection = -1; render(); });

  function conflictDash(a, b, trimA, trimB, scale) {
    const visible = g.distance(a, b) - trimA - trimB;
    if (visible <= 0) return { pattern: [8 / scale, 7 / scale], phase: 0 };
    const period = visible / Math.max(1, Math.round(visible * scale / 15));
    const gap = Math.min(7 / scale, period / 2);
    const dash = period - gap;
    // Start and finish at the center of a dash so even a short visible edge has a gap.
    return { pattern: [dash, gap], phase: dash / 2 - trimA };
  }

  function draw(now) {
    frame = 0;
    const motion = sampleHistoryMotion(now);
    if (motion) render();
    else historyMotion = null;
    const shownLevel = motion?.shownLevel ?? level;
    const active = animation?.state ?? motion?.state ?? state;
    const points = motion?.points ?? g.positions(level, active);
    const faults = g.evaluate(shownLevel, points);
    if (!motion) updateStats(faults.count);
    if (!size.w || !size.h) return;
    const { k, x, y } = transform();
    const r = Math.max(g.radius, 8 / k);
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

    const tracks = new Set();
    shownLevel.controls.forEach((control) => {
      if (control.kind === 'rotor') {
        const orbits = [...new Set(control.members.map((node) => Math.round(g.distance(points[node], control.center) / 6) * 6))];
        circle(control.center, Math.max(...orbits) + 23, '#f6f6f485', '#b0b0ab');
        ctx.setLineDash([4, 7]);
        orbits.forEach((orbit) => circle(control.center, orbit, null, '#a3a39d'));
        ctx.setLineDash([]);
        circle(control.center, 9 / k, '#fff', '#8e8e88');
        ctx.font = `700 ${9 / k}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#4b4b49';
        ctx.fillText(control.symbol, ...control.center);
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
    const conflictWidth = Math.max(2.8, 2.35 / k);
    ctx.lineCap = 'butt';
    for (const [color, width] of [['#fff', conflictWidth + 2.4 / k], ['#111111', conflictWidth]]) {
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
        ctx.fillText(label, px, py);
      }
    });
    ctx.globalAlpha = 1;
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
  byId('solve-draft').addEventListener('click', () => startDraft(true));
  byId('play-draft').addEventListener('click', () => startDraft(false));
  byId('rules').addEventListener('click', () => byId('rules-dialog').showModal());
  byId('solve').addEventListener('click', () => animate(false));
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
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('keydown', (event) => {
    if (byId('rules-dialog').open) return;
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
  if (valid && config.revision !== generatorRevision) {
    const count = config.auto ? puzzles.defaultCount(config.rank, config.mechanism) : config.count;
    createRandom(config.rank, count, config.mechanism, config.auto);
  } else if (valid) randomize(config, saved.random);
  if (!randomConfig) createRandom('easy', puzzles.defaultCount('easy', 'classic'), 'classic', true);
  reflectConfig(randomConfig);
  if (initialTab === 'editor') enterEditor();
  resize();
})();
