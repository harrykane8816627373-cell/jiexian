(function () {
  'use strict';

  const g = globalThis.Jiexian;
  const puzzles = globalThis.JiexianPuzzles;

  function search(puzzle, current, prepare) {
    let candidate = current;
    const initial = [];
    let fewest = g.evaluate(puzzle, g.positions(puzzle, current), (nodes, kind, obstacle) => {
      initial.push({ nodes, kind, obstacle });
    }).count;
    if (!fewest) return { status: 'solved', state: current };
    const offer = (state, count) => {
      if (count >= fewest) return;
      fewest = count;
      candidate = state;
    };
    const coupled = globalThis.JiexianCoupledRepair.repair;
    const sweep = globalThis.JiexianRepair.repair;
    const relieved = globalThis.JiexianContactRepair.repair(puzzle, current, { initial, offer });
    const repaired = relieved ??
      (candidate !== current && fewest === 1 ? sweep(puzzle, candidate, { depthLimit: 1 }) : null) ??
      globalThis.JiexianObstacleCorridors.repair(puzzle, current, initial, offer) ??
      coupled(puzzle, current, { offer }) ??
      coupled(puzzle, current, { mixed: true, offer }) ??
      sweep(puzzle, current);
    if (repaired) return repaired;
    const obstacleLayout = puzzles.searchObstacles(puzzle, current);
    if (obstacleLayout) return { status: 'solved', state: obstacleLayout };
    const problem = prepare?.(puzzle, current);
    if (problem?.status === 'solved' || problem?.status === 'unsat') return problem;
    const state = puzzles.searchDraft(puzzle, current, { candidate, offer, problem: problem?.status === 'ready' ? problem : undefined });
    if (state) return { status: 'solved', state };
    if (problem?.status === 'ready' && puzzle.obstacles.length) {
      const refined = globalThis.JiexianSolverBreakout.repair(puzzle, problem, current, candidate, fewest, offer);
      if (refined) return refined;
    }
    return problem?.status === 'ready' ? { status: 'ready', problem, candidate } : problem ?? { status: 'local' };
  }

  globalThis.JiexianSolverSearch = { search };
})();
