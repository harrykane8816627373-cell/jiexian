(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const puzzles = globalThis.JiexianPuzzles;

  function search(puzzle, current, prepare) {
    let candidate = current;
    let fewest = g.evaluate(puzzle, g.positions(puzzle, current)).count;
    if (!fewest) return { status: 'solved', state: current };
    const offer = (state, count) => {
      if (count >= fewest) return;
      fewest = count;
      candidate = state;
    };
    const repair = globalThis.JiexianCoupledRepair.repair;
    const repaired = repair(puzzle, current, { offer }) ??
      repair(puzzle, current, { mixed: true, offer }) ??
      globalThis.JiexianRepair.repair(puzzle, current);
    if (repaired) return repaired;
    const obstacleLayout = puzzles.searchObstacles(puzzle, current);
    if (obstacleLayout) return { status: 'solved', state: obstacleLayout };
    const problem = prepare?.(puzzle, current);
    if (problem?.status === 'solved' || problem?.status === 'unsat') return problem;
    const state = puzzles.searchDraft(puzzle, current, { candidate, offer, problem: problem?.status === 'ready' ? problem : undefined });
    if (state) return { status: 'solved', state };
    return problem?.status === 'ready' ? { status: 'ready', problem, candidate } : problem ?? { status: 'local' };
  }

  globalThis.JiexianSolverSearch = { search };
})();
