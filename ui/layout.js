// Pure layout helpers (no DOM) so they can be unit-tested with node.
(function (root) {
  const overlap = (a, b, pad = 0) =>
    a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;

  // fraction windows [[l,t,r,b],...] -> pixel rects
  const toPx = (wins, W, H) =>
    (wins || []).map(([l, t, r, b]) => ({ l: l * W, t: t * H, r: r * W, b: b * H }));

  // is this on-screen box (pixel rect) covered by any window?
  const covered = (box, wins, W, H, pad = 14) => toPx(wins, W, H).some((w) => overlap(box, w, pad));

  // compact = a window is open somewhere
  const isCompact = (wins) => !!(wins && wins.length);

  // where the orb lives. c = 0 (no windows) .. 1 (windows open); k = 0 idle .. 1 active
  const orb = (W, H, c, k) => {
    const big = { x: W - 150 + (W / 2 - (W - 150)) * k, y: H - 170 + (H / 2 - 40 - (H - 170)) * k, R: 42 + 46 * k };
    const small = { x: W - 80, y: H - 120, R: 19 + 7 * k };
    return { x: big.x + (small.x - big.x) * c, y: big.y + (small.y - big.y) * c, R: big.R + (small.R - big.R) * c };
  };

  const api = { overlap, toPx, covered, isCompact, orb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layout = api;
})(typeof window !== 'undefined' ? window : globalThis);
