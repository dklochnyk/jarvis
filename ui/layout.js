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

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Where the orb lives. c = 0 (no windows) .. 1 (windows open); k = 0 idle .. 1 active.
  // pin = {x, y} as screen fractions when the user has dragged it somewhere (then it never drifts).
  const orb = (W, H, c, k, pin) => {
    const big = { x: W - 150 + (W / 2 - (W - 150)) * k, y: H - 170 + (H / 2 - 40 - (H - 170)) * k, R: 46 + 64 * k };
    const small = { x: W - 80, y: H - 120, R: 22 + 8 * k };
    const R = big.R + (small.R - big.R) * c;
    let x = big.x + (small.x - big.x) * c, y = big.y + (small.y - big.y) * c;
    if (pin) {
      const m = Math.min(R * 2.0, W / 2, H / 2);
      x = clamp(pin.x * W, m, W - m);
      y = clamp(pin.y * H, m, H - m);
    }
    return { x, y, R };
  };

  // Where the caption box and the state label sit relative to the orb when they "follow" it.
  const followers = (cx, cy, R, W, H, capW = 380) => {
    const above = cy > H * 0.4;
    const left = clamp(cx - capW / 2, 12, Math.max(12, W - capW - 12));
    const caption = above ? { left, bottom: H - (cy - R * 2.7 - 8) } : { left, top: cy + R * 2.7 + 8 };
    const onLeft = cx > W / 2;
    const label = { x: onLeft ? cx - R * 2.7 - 8 : cx + R * 2.7 + 8, y: cy, onLeft };
    return { caption, label, above };
  };

  const api = { overlap, toPx, covered, isCompact, orb, followers, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layout = api;
})(typeof window !== 'undefined' ? window : globalThis);
