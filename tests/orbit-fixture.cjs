function rotorChord(g, chordOffset, probeOffset) {
  const center = [450, 270];
  const points = [[center[0] + chordOffset, 190], [center[0] + chordOffset, 350]];
  return g.createLevel({
    points, edges: [[0, 1]], controls: [g.rotor([0, 1], center, 0)],
    obstacles: [{ center: [center[0] + probeOffset, center[1]], r: 24 }],
  });
}

module.exports = { rotorChord };
