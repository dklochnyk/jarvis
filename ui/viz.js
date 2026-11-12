// Spotify visualiser drawing: a radial spectrum around the album art + a bar spectrum with reflection.
(function (root) {
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const TAU = Math.PI * 2;
  const peaks = new Array(40).fill(0);
  const cache = {};

  // a ring of tick marks as one reusable path (a single stroke call instead of dozens)
  function ticks(r0, n, long, short, every) {
    const key = [r0, n, long, short, every].join();
    if (cache[key]) return cache[key];
    const p = new Path2D();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r1 = r0 + (i % every === 0 ? long : short), ca = Math.cos(a), sa = Math.sin(a);
      p.moveTo(ca * r0, sa * r0); p.lineTo(ca * r1, sa * r1);
    }
    return (cache[key] = p);
  }

  function prep(cv, sc) {
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * sc)) { cv.width = Math.round(W * sc); cv.height = Math.round(H * sc); }
    const ctx = cv.getContext('2d'); ctx.setTransform(sc, 0, 0, sc, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }

  function radial(cv, arr, c, t, playing, sc) {
    const { ctx, W, H } = prep(cv, sc), cx = W / 2, cy = H / 2, spin = playing ? t : 0;
    ctx.save(); ctx.translate(cx, cy);
    // outer tick ring, counter-rotating from the inner arcs
    ctx.save(); ctx.rotate(-spin * 0.06); ctx.strokeStyle = rgba(c, 0.4); ctx.lineWidth = 1; ctx.stroke(ticks(W * 0.485 - 9, 72, 8, 4, 6)); ctx.restore();
    ctx.setLineDash([2, 6]); ctx.strokeStyle = rgba(c, 0.3); ctx.beginPath(); ctx.arc(0, 0, W * 0.485 - 14, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    // spectrum, mirrored left/right so it reads as one symmetrical ring
    const r0 = W * 0.33, span = W * 0.15, n = 80;
    ctx.save(); ctx.rotate(-Math.PI / 2);
    ctx.strokeStyle = rgba(c, 0.95); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const f = i / n, idx = Math.min(39, Math.floor((f < 0.5 ? f * 2 : (1 - f) * 2) * 39));
      const v = Math.max(0, Math.min(1, arr[idx])), a = f * TAU, len = 2.5 + v * span, ca = Math.cos(a), sa = Math.sin(a);
      ctx.moveTo(ca * r0, sa * r0); ctx.lineTo(ca * (r0 + len), sa * (r0 + len));
    }
    ctx.stroke(); ctx.restore();
    // inner segmented ring (spins while playing)
    ctx.save(); ctx.rotate(spin * 0.5); ctx.lineWidth = 3; ctx.lineCap = 'butt'; ctx.strokeStyle = rgba(c, 0.85); ctx.beginPath();
    for (let s = 0; s < 4; s++) { const a0 = (s / 4) * TAU; ctx.moveTo(Math.cos(a0) * (r0 - 6), Math.sin(a0) * (r0 - 6)); ctx.arc(0, 0, r0 - 6, a0, a0 + TAU / 4 * 0.6); }
    ctx.stroke(); ctx.restore();
    ctx.strokeStyle = rgba(c, 0.3); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r0 - 12, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function bars(cv, arr, c, t, sc) {
    const { ctx, W, H } = prep(cv, sc), n = arr.length, bw = W / n, base = H * 0.68, maxH = H * 0.6;
    // scale: faint grid + side ticks
    ctx.strokeStyle = rgba(c, 0.1); ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i <= 3; i++) { const y = base - (maxH * i) / 3; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    const grad = ctx.createLinearGradient(0, base - maxH, 0, base); grad.addColorStop(0, rgba(c, 1)); grad.addColorStop(1, rgba(c, 0.3));
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(1, arr[i])), h = 2 + v * maxH;
      ctx.fillRect(i * bw + 1.5, base - h, bw - 3, h);
      peaks[i] = Math.max(peaks[i] - 0.012, v);
    }
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < n; i++) ctx.fillRect(i * bw + 1.5, base - 4 - peaks[i] * maxH, bw - 3, 2);
    ctx.fillStyle = rgba(c, 0.16);
    for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(1, arr[i])); ctx.fillRect(i * bw + 1.5, base + 3, bw - 3, Math.min(H - base - 3, (2 + v * maxH) * 0.4)); }
    ctx.strokeStyle = rgba(c, 0.5); ctx.beginPath(); ctx.moveTo(0, base + 1.5); ctx.lineTo(W, base + 1.5); ctx.stroke();
    // end caps + frequency labels
    ctx.fillStyle = rgba(c, 0.55); ctx.font = '8px Consolas, monospace'; ctx.textAlign = 'left'; ctx.fillText('LOW', 0, H - 2);
    ctx.textAlign = 'right'; ctx.fillText('HIGH', W, H - 2); ctx.textAlign = 'center'; ctx.fillText('SPECTRUM', W / 2, H - 2);
  }

  const api = { radial, bars, ticks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Viz = api;
})(typeof window !== 'undefined' ? window : globalThis);
