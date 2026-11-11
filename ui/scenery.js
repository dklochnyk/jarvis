// Command-center scenery: starfield + circuit traces, wireframe globe, orbit rings, hologram platform,
// callouts, process radar, reactor emblem, waveform. Everything takes the current HUD colour `c`.
(function (root) {
  const TAU = Math.PI * 2;
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const ORANGE = [255, 170, 60];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const mulberry = (a) => () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---------------------------------------------------------------- background
  let stars = [], traces = [], gW = 0, gH = 0;
  function init(W, H) {
    gW = W; gH = H;
    const r = mulberry(11);
    stars = Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, vx: (r() - 0.5) * 6, vy: (r() - 0.5) * 6, s: 0.6 + r() * 1.4, tw: r() * TAU }));
    traces = [];
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < 9; i++) {
        const dir = side ? -1 : 1;
        let x = side ? W : 0, y = 40 + r() * (H - 80);
        const pts = [[x, y]];
        for (let s = 0; s < 4; s++) {
          if (s % 2 === 0) x += dir * (50 + r() * 130); else y += (r() < 0.5 ? -1 : 1) * (30 + r() * 110);
          pts.push([x, Math.max(10, Math.min(H - 10, y))]);
        }
        let len = 0; const segs = [];
        for (let k = 1; k < pts.length; k++) { const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); segs.push(l); len += l; }
        traces.push({ pts, segs, len, ph: r(), sp: 0.04 + r() * 0.06 });
      }
    }
  }
  const along = (tr, d) => {
    for (let k = 0; k < tr.segs.length; k++) {
      if (d <= tr.segs[k]) { const f = d / tr.segs[k]; return [tr.pts[k][0] + (tr.pts[k + 1][0] - tr.pts[k][0]) * f, tr.pts[k][1] + (tr.pts[k + 1][1] - tr.pts[k][1]) * f]; }
      d -= tr.segs[k];
    }
    return tr.pts[tr.pts.length - 1];
  };
  function drawBackground(ctx, t, dt, c, big) {
    if (big < 0.03) return;
    ctx.save();
    // circuit traces with data pulses
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(c, 0.13 * big); ctx.fillStyle = rgba(c, 0.3 * big);
    for (const tr of traces) {
      ctx.beginPath(); tr.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      for (const [x, y] of tr.pts.slice(1)) { ctx.fillRect(x - 2, y - 2, 4, 4); }
      const [px, py] = along(tr, ((t * tr.sp + tr.ph) % 1) * tr.len);
      ctx.fillStyle = rgba(c, 0.85 * big); ctx.beginPath(); ctx.arc(px, py, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(c, 0.3 * big);
    }
    // drifting constellation
    for (const s of stars) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < 0) s.x += gW; if (s.x > gW) s.x -= gW; if (s.y < 0) s.y += gH; if (s.y > gH) s.y -= gH;
    }
    ctx.lineWidth = 0.8;
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const d = Math.hypot(stars[i].x - stars[j].x, stars[i].y - stars[j].y);
        if (d < 130) { ctx.strokeStyle = rgba(c, 0.10 * (1 - d / 130) * big); ctx.beginPath(); ctx.moveTo(stars[i].x, stars[i].y); ctx.lineTo(stars[j].x, stars[j].y); ctx.stroke(); }
      }
    }
    for (const s of stars) { ctx.fillStyle = rgba(c, (0.25 + 0.25 * Math.sin(t * 1.5 + s.tw)) * big); ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // ---------------------------------------------------------------- globe
  const dots = (() => { const r = mulberry(5); return Array.from({ length: 46 }, () => { const u = r() * 2 - 1, a = r() * TAU, q = Math.sqrt(1 - u * u); return [q * Math.cos(a), u, q * Math.sin(a), r()]; }); })();
  function rot(x, y, z, yaw, tilt) {
    const x1 = x * Math.cos(yaw) + z * Math.sin(yaw), z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return [x1, y * Math.cos(tilt) - z1 * Math.sin(tilt), y * Math.sin(tilt) + z1 * Math.cos(tilt)];
  }
  function drawGlobe(ctx, cx, cy, Rg, t, c, alpha, lv) {
    const yaw = t * 0.22, tilt = 0.38;
    ctx.save();
    // shell glow
    const g = ctx.createRadialGradient(cx, cy, Rg * 0.7, cx, cy, Rg * 1.08);
    g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.9, rgba(c, 0.10 * alpha)); g.addColorStop(1, rgba(c, 0.32 * alpha));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, Rg * 1.08, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(c, 0.5 * alpha); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, Rg, 0, TAU); ctx.stroke();
    const ring = (fn) => {
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i <= 56; i++) {
          const [x, y, z] = rot(...fn(i / 56 * TAU), yaw, tilt);
          if ((z >= 0) !== (pass === 1)) { pen = false; continue; }
          const X = cx + x * Rg, Y = cy + y * Rg;
          pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true;
        }
        ctx.strokeStyle = rgba(c, (pass ? 0.34 : 0.12) * alpha); ctx.lineWidth = pass ? 1 : 0.7; ctx.stroke();
      }
    };
    for (const lat of [-60, -30, 0, 30, 60]) { const a = lat * Math.PI / 180, rr = Math.cos(a), yy = Math.sin(a); ring((u) => [rr * Math.cos(u), yy, rr * Math.sin(u)]); }
    for (let m = 0; m < 6; m++) { const b = (m / 6) * Math.PI; ring((u) => [Math.cos(u) * Math.cos(b), Math.sin(u), Math.cos(u) * Math.sin(b)]); }
    // data nodes riding the surface
    for (const [x0, y0, z0, ph] of dots) {
      const [x, y, z] = rot(x0, y0, z0, yaw, tilt);
      const a = (z >= 0 ? 0.9 : 0.25) * alpha * (0.6 + 0.4 * Math.sin(t * 2 + ph * 9));
      ctx.fillStyle = rgba(c, a); ctx.beginPath(); ctx.arc(cx + x * Rg, cy + y * Rg, z >= 0 ? 1.8 + lv * 1.5 : 1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- orbit rings (orange + HUD colour)
  function drawOrbits(ctx, cx, cy, R, t, c, alpha) {
    const specs = [[2.3, 0.62, -0.42, ORANGE, 0.55, 1], [2.15, 0.5, 0.5, c, 0.5, -0.8], [2.6, 0.38, 0.05, c, 0.25, 0.5]];
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [rx, ry, tilt, col, a, sp] of specs) {
      const pt = (th) => { const x = Math.cos(th) * rx * R, y = Math.sin(th) * ry * R; return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]; };
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) { const [x, y] = pt((i / 96) * TAU); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = rgba(col, a * 0.5 * alpha); ctx.lineWidth = 1.2; ctx.stroke();
      const head = t * sp * 1.2;
      for (let i = 0; i < 28; i++) {            // comet trail
        const [x, y] = pt(head - i * 0.045), [x2, y2] = pt(head - (i + 1) * 0.045);
        ctx.strokeStyle = rgba(col, a * alpha * (1 - i / 28)); ctx.lineWidth = 3.2 * (1 - i / 28) + 0.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      }
      const [hx, hy] = pt(head);
      ctx.fillStyle = `rgba(255,255,255,${0.95 * alpha})`; ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 11); g.addColorStop(0, rgba(col, 0.7 * alpha)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 11, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- hologram platform + beam
  function drawPlatform(ctx, cx, cy, R, t, c, alpha, lv) {
    const py = cy + R * 2.95;
    ctx.save();
    const beam = ctx.createLinearGradient(0, cy + R, 0, py);
    beam.addColorStop(0, rgba(c, 0)); beam.addColorStop(1, rgba(c, 0.22 * alpha));
    ctx.fillStyle = beam; ctx.beginPath();
    ctx.moveTo(cx - R * 0.5, cy + R); ctx.lineTo(cx + R * 0.5, cy + R); ctx.lineTo(cx + R * 1.2, py); ctx.lineTo(cx - R * 1.2, py); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const radii = [1.1, 1.7, 2.35, 3.1, 3.9];
    radii.forEach((m, i) => {
      const rx = R * m, ry = rx * 0.2, pulse = 0.5 + 0.5 * Math.sin(t * 1.6 - i * 0.9) + lv * 0.4;
      ctx.lineWidth = i % 2 ? 1 : 1.8; ctx.strokeStyle = rgba(c, (0.16 + 0.22 * pulse) * alpha * (1 - i * 0.12));
      ctx.setLineDash(i % 2 ? [] : [rx * 0.4, rx * 0.12]); ctx.lineDashOffset = -t * 24 * (i % 2 ? 1 : -1);
      ctx.beginPath(); ctx.ellipse(cx, py, rx, ry, 0, 0, TAU); ctx.stroke();
    });
    ctx.setLineDash([]);
    // radial spokes + rotating ticks on the platform
    ctx.strokeStyle = rgba(c, 0.14 * alpha); ctx.lineWidth = 1;
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU + t * 0.05; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 1.1, py + Math.sin(a) * R * 0.22); ctx.lineTo(cx + Math.cos(a) * R * 3.9, py + Math.sin(a) * R * 0.78); ctx.stroke(); }
    ctx.restore();
  }

  // ---------------------------------------------------------------- callouts
  function drawCallouts(ctx, cx, cy, R, t, c, alpha, items) {
    ctx.save(); ctx.font = '10px Consolas, monospace'; ctx.textBaseline = 'middle';
    const angles = [-0.62, 0.55, Math.PI + 0.62, Math.PI - 0.55];
    items.slice(0, 4).forEach(([title, value], i) => {
      const a = angles[i], right = Math.cos(a) > 0;
      const x0 = cx + Math.cos(a) * R * 2.75, y0 = cy + Math.sin(a) * R * 2.75;
      const x1 = cx + Math.cos(a) * R * 3.15, y1 = y0 + (i < 2 ? -1 : 1) * 0 + Math.sin(a) * R * 0.15;
      const x2 = x1 + (right ? 46 : -46);
      ctx.strokeStyle = rgba(c, 0.45 * alpha); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y1); ctx.stroke();
      ctx.fillStyle = rgba(c, 0.9 * alpha); ctx.fillRect(x0 - 2, y0 - 2, 4, 4);
      ctx.textAlign = right ? 'left' : 'right';
      const tx = x2 + (right ? 6 : -6);
      ctx.fillStyle = rgba(c, 0.6 * alpha); ctx.fillText(String(title).toUpperCase(), tx, y1 - 7);
      ctx.fillStyle = rgba(c, 1 * alpha); ctx.fillText(String(value).toUpperCase().slice(0, 18), tx, y1 + 7);
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- process radar
  function drawRadar(cv, procs, t, c) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const cx = 86, cy = H / 2, r = 80, sweep = (t * 0.9) % TAU;
    ctx.strokeStyle = rgba(c, 0.25); ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, (r * i) / 4, 0, TAU); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(sweep - 1.0, cx, cy);
      g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.16, rgba(c, 0.35)); g.addColorStop(0.1667, rgba(c, 0)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = rgba(c, 0.9); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * r, cy + Math.sin(sweep) * r); ctx.stroke();
    const list = (procs || []).slice(0, 8);
    list.forEach(([name, pct], i) => {
      const a = hash(name) * TAU, d = r * (0.95 - Math.min(1, pct / 20) * 0.7);
      let diff = (sweep - a) % TAU; if (diff < 0) diff += TAU;
      const glow = Math.max(0.25, 1 - diff / TAU * 1.4);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      ctx.fillStyle = pct > 25 ? `rgba(255,120,90,${glow})` : rgba(c, glow); ctx.beginPath(); ctx.arc(x, y, 2 + Math.min(4, pct / 5), 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(c, glow * 0.5); ctx.beginPath(); ctx.arc(x, y, 5 + Math.min(5, pct / 4), 0, TAU); ctx.stroke();
    });
    ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'left';
    list.slice(0, 6).forEach(([name, pct], i) => {
      const y = 22 + i * 24;
      ctx.fillStyle = rgba(c, 0.9); ctx.fillText(name.slice(0, 13).toUpperCase(), 186, y);
      ctx.fillStyle = rgba(c, 0.18); ctx.fillRect(186, y + 5, 96, 3);
      ctx.fillStyle = pct > 25 ? 'rgba(255,120,90,.95)' : rgba(c, 0.95); ctx.fillRect(186, y + 5, Math.min(96, (pct / 25) * 96), 3);
      ctx.fillStyle = rgba(c, 0.6); ctx.textAlign = 'right'; ctx.fillText(pct.toFixed(1) + '%', 282, y); ctx.textAlign = 'left';
    });
  }

  // ---------------------------------------------------------------- reactor emblem (status bar)
  function drawEmblem(cv, t, c, k) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 4;
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, rgba(c, 0.35 + 0.3 * k)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) { const a = t * (0.8 + k) + (i * TAU) / 3; ctx.strokeStyle = rgba(c, 0.9); ctx.beginPath(); ctx.arc(cx, cy, R, a, a + 1.4); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(c, 0.4); ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, TAU); ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + t * 0.2; const x = cx + Math.cos(a) * R * 0.7, y = cy + Math.sin(a) * R * 0.7; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(c, 1); ctx.fillStyle = rgba(c, 0.25 + 0.2 * Math.sin(t * 3) * k);
    ctx.beginPath(); ctx.moveTo(cx - R * 0.42, cy - R * 0.3); ctx.lineTo(cx + R * 0.42, cy - R * 0.3); ctx.lineTo(cx, cy + R * 0.48); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(cx, cy - R * 0.08, 3, 0, TAU); ctx.fill();
  }

  // ---------------------------------------------------------------- waveform (status bar)
  function drawWave(cv, arr, c, busy, t) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const n = arr.length, bw = W / n;
    ctx.strokeStyle = rgba(c, 0.2); ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.fillStyle = rgba(c, 0.95);
    for (let i = 0; i < n; i++) {
      const env = 0.35 + 0.65 * Math.sin((i / (n - 1)) * Math.PI);
      const h = Math.max(2, arr[i] * H * env + (busy ? 3 : 1.5));
      ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, arr[i] * 1.5);
      ctx.fillRect(i * bw + 0.5, H / 2 - h / 2, Math.max(1.5, bw - 1.5), h);
    }
    ctx.globalAlpha = 1;
  }

  const api = { init, drawBackground, drawGlobe, drawOrbits, drawPlatform, drawCallouts, drawRadar, drawEmblem, drawWave, hash, mulberry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scenery = api;
})(typeof window !== 'undefined' ? window : globalThis);
