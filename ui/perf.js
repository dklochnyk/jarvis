// Performance hub, free-flowing: smooth flowing curves in a strip, rounded core pills. No boxes or frames.
(function (root) {
  const N = 60, TAU = Math.PI * 2;
  const push = (arr, v) => { arr.push(v); while (arr.length > N) arr.shift(); return arr; };
  const fmtRate = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB/s' : kb.toFixed(kb < 10 ? 1 : 0) + ' KB/s');
  const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? d + 'D ' : '') + h + 'H ' + String(m).padStart(2, '0') + 'M'; };

  const H = { cpu: [], mem: [], down: [], up: [] };
  let last = null;

  function update(m) { last = m; push(H.cpu, m.cpu); push(H.mem, m.mem); push(H.down, m.net_down || 0); push(H.up, m.net_up || 0); }

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hot = (pct, c, a = 0.95) => (pct > 90 ? `rgba(255,90,90,${a})` : pct > 75 ? `rgba(255,180,60,${a})` : rgba(c, a));

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
  // one free-flowing section: small title, big number, then the wave. No frames.
  function section(ctx, title, big, small, x, w, series, max, c, t) {
    ctx.shadowColor = 'rgba(0,6,14,.9)'; ctx.shadowBlur = 6;   // keeps the text readable over bright windows
    ctx.textAlign = 'left'; ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.8); ctx.fillText(title, x, 11);
    ctx.fillStyle = '#eaffff'; ctx.font = '300 20px "Segoe UI", sans-serif'; ctx.fillText(big, x, 33);
    ctx.textAlign = 'right'; ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.6); ctx.fillText(small, x + w, 11); ctx.shadowBlur = 0;
    series.forEach((s, i) => flow(ctx, s.data, x, 40, w, 46, max, c, s.alpha, s.fill, t, i === series.length - 1 && s.head));
  }

  function draw(cv, c, sc, t) {
    if (!last) return;
    const ctx = cv.getContext('2d'), W = cv.clientWidth, Hh = cv.clientHeight;
    if (cv.width !== Math.round(W * sc) || cv.height !== Math.round(Hh * sc)) { cv.width = Math.round(W * sc); cv.height = Math.round(Hh * sc); }
    ctx.setTransform(sc, 0, 0, sc, 0, 0); ctx.clearRect(0, 0, W, Hh);
    const m = last, gap = 36, usable = W - gap * 3, w1 = usable * 0.3, w2 = usable * 0.22, w3 = usable * 0.3, w4 = usable * 0.18;
    const x1 = 0, x2 = x1 + w1 + gap, x3 = x2 + w2 + gap, x4 = x3 + w3 + gap;
    section(ctx, 'CPU · 60 S', Math.round(m.cpu) + '%', m.cores.length + ' CORES', x1, w1, [{ data: H.cpu, alpha: 0.95, fill: true, head: true }], 100, c, t);
    section(ctx, 'MEMORY', Math.round(m.mem) + '%', m.mem_used + ' / ' + Math.round(m.mem_total) + ' GB', x2, w2, [{ data: H.mem, alpha: 0.9, fill: true, head: true }], 100, c, t);
    const nmax = Math.max(50, ...H.down, ...H.up);
    section(ctx, 'NETWORK', '▼ ' + fmtRate(m.net_down), '▲ ' + fmtRate(m.net_up), x3, w3, [{ data: H.up, alpha: 0.4, fill: false }, { data: H.down, alpha: 0.95, fill: true, head: true }], nmax, c, t);
    // cores: rounded pills
    ctx.textAlign = 'left'; ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.8); ctx.fillText('CORES', x4, 11);
    const n = m.cores.length, cg = 4, bw = Math.max(3, (w4 - cg * (n - 1)) / n);
    for (let i = 0; i < n; i++) {
      const v = m.cores[i], h = 4 + (v / 100) * 38, x = x4 + i * (bw + cg);
      ctx.fillStyle = rgba(c, 0.1); ctx.beginPath(); ctx.roundRect(x, 44, bw, 42, bw / 2); ctx.fill();
      ctx.fillStyle = hot(v, c, 0.85); ctx.beginPath(); ctx.roundRect(x, 86 - h, bw, h, bw / 2); ctx.fill();
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
