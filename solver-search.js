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
    const freeObstacleLayout = prepare && puzzle.obstacles.length &&
      puzzle.controls.length === puzzle.points.length && puzzle.controls.every(({ kind }) => kind === 'free');
    const reembed = freeObstacleLayout && initial.some(({ kind }) => kind === 'crossing');
    const blocked = freeObstacleLayout ? initial.filter(({ kind }) => kind === 'edge-obstacle') : [];
    const mixedCrossing = reembed && blocked.length > 0;
    const relaxContacts = blocked.length >= 2;
    const useBoundaryBands = mixedCrossing || new Set(blocked.map(({ obstacle }) => obstacle)).size >= 2;
    const relieved = globalThis.JiexianContactRepair.repair(puzzle, current, { initial, offer });
    const repaired = relieved ??
      (candidate !== current && fewest === 1 ? sweep(puzzle, candidate, { depthLimit: 1 }) : null) ??
      globalThis.JiexianObstacleCorridors.repair(puzzle, current, initial, offer) ??
      coupled(puzzle, current, { offer }) ??
      (relaxContacts ? null : coupled(puzzle, current, { mixed: true, offer })) ??
      (reembed || relaxContacts ? null : sweep(puzzle, current));
    if (repaired) return repaired;
    const obstacleLayout = puzzles.searchObstacles(puzzle, current);
    if (obstacleLayout) return { status: 'solved', state: obstacleLayout };
    const problem = prepare?.(puzzle, current);
    if (problem?.status === 'solved' || problem?.status === 'unsat') return problem;
    const relaxation = globalThis.JiexianSolverRelaxation;
    const crossings = reembed ? initial.filter(({ kind }) => kind === 'crossing') : [];
    const crowded = reembed && (crossings.length >= 5 || initial.length >= puzzle.points.length);
    if (crowded && problem?.status === 'ready') {
      // Several crossed wires can trap repairs that start from the current layout.
      const corridor = relaxation?.findCorridor(puzzle, crossings, candidate, current);
      if (corridor) return corridor;
    }
    const relax = relaxation?.repair;
    const previousSeed = candidate;
    if (reembed || relaxContacts) {
      const starts = relaxContacts || mixedCrossing ? [current, candidate] : [];
      const rearranged = (problem?.status === 'ready' ?
        relax(puzzle, problem, { starts, reembed, useBoundaryBands, offer }) : null) ??
        (relaxContacts ? coupled(puzzle, current, { mixed: true, offer }) : null) ??
        sweep(puzzle, current);
      if (rearranged) return rearranged;
    }
    if (problem?.status === 'ready') {
      if (reembed) {
        const split = relaxation?.repairSplit(puzzle, problem, candidate);
        if (split) return split;
      }
      const compact = relaxation?.findCompact(puzzle, candidate, current);
      if (compact) return compact;
    }
    const state = puzzles.searchDraft(puzzle, current, { candidate, offer, problem: problem?.status === 'ready' ? problem : undefined });
    if (state) return { status: 'solved', state };
    if (problem?.status === 'ready' && puzzle.obstacles.length) {
      const refined = globalThis.JiexianSolverBreakout.repair(puzzle, problem, current, candidate, fewest, offer);
      if (refined) return refined;
      if (relaxContacts && candidate !== current && candidate !== previousSeed && fewest <= 3) {
        const polished = relax(puzzle, problem, { starts: [candidate], reembed: false, restarts: 12, offer });
        if (polished) return polished;
      }
      if (crowded) {
        const embedded = relaxation?.reembedFaces?.(puzzle, crossings, current);
        if (embedded) return embedded;
      }
    }
    return problem?.status === 'ready' ? { status: 'ready', problem, candidate } : problem ?? { status: 'local' };
  }

  globalThis.JiexianSolverSearch = { search };
})();
