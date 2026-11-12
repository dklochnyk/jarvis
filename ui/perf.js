// Performance hub, free-flowing: two soft rings (CPU, memory), smooth flowing curves, rounded core pills. No boxes or frames.
(function (root) {
  const N = 60, TAU = Math.PI * 2;
  const push = (arr, v) => { arr.push(v); while (arr.length > N) arr.shift(); return arr; };
  const fmtRate = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB/s' : kb.toFixed(kb < 10 ? 1 : 0) + ' KB/s');
  const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? d + 'D ' : '') + h + 'H ' + String(m).padStart(2, '0') + 'M'; };

  const H = { cpu: [], mem: [], down: [], up: [] };
  let last = null;
  const shown = { cpu: 0, mem: 0 };   // eased values so the rings glide instead of jumping

  function update(m) { last = m; push(H.cpu, m.cpu); push(H.mem, m.mem); push(H.down, m.net_down || 0); push(H.up, m.net_up || 0); }

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hot = (pct, c, a = 0.95) => (pct > 90 ? `rgba(255,90,90,${a})` : pct > 75 ? `rgba(255,180,60,${a})` : rgba(c, a));

  // a soft ring: faint full circle, a round-capped arc for the value, a slow orbiting dot, big number inside
  function ring(ctx, x, y, r, pct, c, label, sub, t) {
    ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round';
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(c, 0.12); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    const a0 = -Math.PI / 2, a1 = a0 + TAU * Math.max(0.01, Math.min(1, pct / 100));
    ctx.strokeStyle = hot(pct, c); ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(c, 0.28); ctx.beginPath(); ctx.arc(0, 0, r - 9, t * 0.5, t * 0.5 + 2.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r - 9, t * 0.5 + 3.4, t * 0.5 + 4.6); ctx.stroke();
    ctx.fillStyle = rgba(c, 0.95); ctx.beginPath(); ctx.arc(Math.cos(a1) * r, Math.sin(a1) * r, 2.6, 0, TAU); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = '#eaffff'; ctx.font = '300 24px "Segoe UI", sans-serif'; ctx.fillText(Math.round(pct) + '%', 0, 8);
    ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.85); ctx.fillText(label, 0, r + 22);
    ctx.fillStyle = rgba(c, 0.5); ctx.fillText(sub, 0, r + 34);
    ctx.restore();
  }

  // smooth flowing curve (midpoint quadratic smoothing) with a fading fill underneath and a glowing head
  function flow(ctx, data, x, y, w, h, max, c, alpha, fill, t, head) {
    if (data.length < 3) return;
    const off = N - data.length;
    const P = data.map((v, i) => [x + ((i + off) / (N - 1)) * w, y + h - Math.min(1, v / max) * h]);
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length - 1; i++) ctx.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
    const L = P[P.length - 1]; ctx.lineTo(L[0], L[1]);
    ctx.strokeStyle = rgba(c, alpha); ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    if (fill) {
      ctx.lineTo(L[0], y + h); ctx.lineTo(P[0][0], y + h); ctx.closePath();
      const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, rgba(c, 0.28)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fill();
    }
    if (head) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(L[0], L[1], 2.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(c, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(L[0], L[1], 5 + Math.sin(t * 4), 0, TAU); ctx.stroke();
    }
  }
  function label(ctx, left, right, x, y, w, c) {
    ctx.font = '9px Consolas, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = rgba(c, 0.8); ctx.fillText(left, x, y);
    ctx.textAlign = 'right'; ctx.fillStyle = rgba(c, 0.6); ctx.fillText(right, x + w, y);
  }

  function draw(cv, c, sc, t) {
    if (!last) return;
    const ctx = cv.getContext('2d'), W = cv.clientWidth, Hh = cv.clientHeight;
    if (cv.width !== Math.round(W * sc)) { cv.width = Math.round(W * sc); cv.height = Math.round(Hh * sc); }
    ctx.setTransform(sc, 0, 0, sc, 0, 0); ctx.clearRect(0, 0, W, Hh);
    const m = last;
    shown.cpu += (m.cpu - shown.cpu) * 0.5; shown.mem += (m.mem - shown.mem) * 0.5;
    ring(ctx, W * 0.27, 52, 36, shown.cpu, c, 'CPU', m.cores.length + ' CORES', t);
    ring(ctx, W * 0.73, 52, 36, shown.mem, c, 'MEMORY', m.mem_used + ' / ' + Math.round(m.mem_total) + ' GB', t);

    label(ctx, 'LOAD · 60 S', Math.round(m.cpu) + '% CPU', 0, 140, W, c);
    flow(ctx, H.cpu, 0, 148, W, 52, 100, c, 0.95, true, t, true);
    label(ctx, 'MEMORY', Math.round(m.mem) + '%', 0, 222, W, c);
    flow(ctx, H.mem, 0, 230, W, 38, 100, c, 0.8, true, t, false);
    const nmax = Math.max(50, ...H.down, ...H.up);
    label(ctx, '▼ ' + fmtRate(m.net_down), '▲ ' + fmtRate(m.net_up), 0, 290, W, c);
    flow(ctx, H.up, 0, 298, W, 40, nmax, c, 0.4, false, t, false);
    flow(ctx, H.down, 0, 298, W, 40, nmax, c, 0.95, true, t, true);

    // cores: rounded pills that rise from a soft baseline
    const n = m.cores.length, gap = 5, bw = Math.max(4, (W - gap * (n - 1)) / n);
    for (let i = 0; i < n; i++) {
      const v = m.cores[i], h = 4 + (v / 100) * 24, x = i * (bw + gap);
      ctx.fillStyle = rgba(c, 0.1); ctx.beginPath(); ctx.roundRect(x, 356, bw, 28, bw / 2); ctx.fill();
      ctx.fillStyle = hot(v, c, 0.85); ctx.beginPath(); ctx.roundRect(x, 384 - h, bw, h, bw / 2); ctx.fill();
    }
  }

  function text(dom) {
    if (!last) return;
    dom.up.textContent = 'UP ' + fmtUptime(last.uptime || 0);
    dom.bat.textContent = last.battery == null ? 'AC POWER' : 'BAT ' + last.battery + '%' + (last.plugged ? ' ⚡' : '');
  }

  const api = { update, draw, text, push, fmtRate, fmtUptime, history: H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Perf = api;
})(typeof window !== 'undefined' ? window : globalThis);
