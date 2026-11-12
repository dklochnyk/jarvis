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
    ctx.shadowColor = rgba(c, 0.7); ctx.shadowBlur = 6;
    ctx.strokeStyle = rgba(c, alpha); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); ctx.shadowBlur = 0;
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
  // accent colours so each readout has its own hue (they still shift a little with Jarvis' state)
  const mix = (c, k, w) => [c[0] + (k[0] - c[0]) * w, c[1] + (k[1] - c[1]) * w, c[2] + (k[2] - c[2]) * w];
  const KIND = {
    cpu: { title: 'CPU · 60 S', col: (c) => c, max: () => 100 },
    mem: { title: 'MEMORY', col: (c) => mix(c, [200, 130, 255], 0.75), max: () => 100 },
    net: { title: 'NETWORK', col: (c) => mix(c, [90, 255, 170], 0.8), max: () => Math.max(50, ...H.down, ...H.up) },
  };

  // each readout is its own free-floating canvas: title, big number, then a wave that fades in and out at both ends
  function draw(kind, cv, c0, sc, t) {
    if (!last) return;
    const K = KIND[kind], c = K.col(c0), m = last;
    const ctx = cv.getContext('2d'), W = cv.clientWidth, Hh = cv.clientHeight;
    if (cv.width !== Math.round(W * sc) || cv.height !== Math.round(Hh * sc)) { cv.width = Math.round(W * sc); cv.height = Math.round(Hh * sc); }
    ctx.setTransform(sc, 0, 0, sc, 0, 0); ctx.clearRect(0, 0, W, Hh);
    const wy = 44, wh = 48;
    let big, small, series;
    if (kind === 'cpu') { big = Math.round(m.cpu) + '%'; small = m.cores.length + ' CORES'; series = [{ data: H.cpu, a: 0.95, fill: true, head: true }]; }
    else if (kind === 'mem') { big = Math.round(m.mem) + '%'; small = m.mem_used + ' / ' + Math.round(m.mem_total) + ' GB'; series = [{ data: H.mem, a: 0.9, fill: true, head: true }]; }
    else { big = '▼ ' + fmtRate(m.net_down); small = '▲ ' + fmtRate(m.net_up); series = [{ data: H.up, a: 0.45, fill: false }, { data: H.down, a: 0.95, fill: true, head: true }]; }
    const max = K.max();
    series.forEach((s) => flow(ctx, s.data, 0, wy, W, wh, max, c, s.a, s.fill, t, false));
    // soften both ends of the wave so it has no hard start or finish
    ctx.save(); ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,1)'); g.addColorStop(0.9, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh); ctx.restore();
    // glowing head just inside the right edge
    const lead = series[series.length - 1].data, hx = W * 0.97, hy = wy + wh - Math.min(1, lead[lead.length - 1] / max) * wh;
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 12); hg.addColorStop(0, rgba(c, 0.8)); hg.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hx, hy, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 2.2, 0, TAU); ctx.fill();
    // text on top (with a soft dark halo so it reads over bright windows)
    ctx.shadowColor = 'rgba(0,6,14,.9)'; ctx.shadowBlur = 6;
    ctx.textAlign = 'left'; ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.9); ctx.fillText(K.title, 4, 11);
    ctx.fillStyle = '#f2ffff'; ctx.font = '300 20px "Segoe UI", sans-serif'; ctx.fillText(big, 4, 34);
    ctx.textAlign = 'right'; ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.7); ctx.fillText(small, W - 4, 11);
    ctx.shadowBlur = 0;
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
