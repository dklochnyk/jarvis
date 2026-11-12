// Performance hub in the style of the Jarvis core: segmented ring gauges, framed live charts, per-core bars.
(function (root) {
  const N = 60, TAU = Math.PI * 2;
  const push = (arr, v) => { arr.push(v); while (arr.length > N) arr.shift(); return arr; };
  const fmtRate = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB/s' : kb.toFixed(kb < 10 ? 1 : 0) + ' KB/s');
  const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? d + 'D ' : '') + h + 'H ' + String(m).padStart(2, '0') + 'M'; };

  const H = { cpu: [], gpu: [], mem: [], down: [], up: [] };
  let last = null;
  const cache = {};

  function update(m) {
    last = m;
    push(H.cpu, m.cpu); push(H.mem, m.mem); push(H.down, m.net_down || 0); push(H.up, m.net_up || 0);
    if (m.gpu != null) push(H.gpu, m.gpu);
  }

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hot = (pct, c, a = 0.95) => (pct > 90 ? `rgba(255,90,90,${a})` : pct > 75 ? `rgba(255,180,60,${a})` : rgba(c, a));

  function tickRing(r, n, every) {
    const key = r + ':' + n;
    if (cache[key]) return cache[key];
    const p = new Path2D();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r1 = r + (i % every === 0 ? 5 : 2.5);
      p.moveTo(Math.cos(a) * r, Math.sin(a) * r); p.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
    return (cache[key] = p);
  }

  // one gauge, built like the core: tick ring, segmented progress ring, dashed inner ring, counter-rotating arcs
  function gauge(ctx, x, y, r, pct, c, label, sub, t) {
    const ok = pct != null, SEG = 28, lit = ok ? Math.round((Math.min(100, pct) / 100) * SEG) : 0;
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = rgba(c, ok ? 0.4 : 0.15); ctx.lineWidth = 1; ctx.stroke(tickRing(r + 6, 48, 4));
    ctx.lineWidth = 4.5; ctx.lineCap = 'butt';
    const gap = 0.05, step = TAU / SEG;
    ctx.strokeStyle = rgba(c, 0.13); ctx.beginPath();
    for (let i = lit; i < SEG; i++) { const a0 = -Math.PI / 2 + i * step; ctx.moveTo(Math.cos(a0 + gap) * r, Math.sin(a0 + gap) * r); ctx.arc(0, 0, r, a0 + gap, a0 + step - gap); }
    ctx.stroke();
    if (lit) {
      ctx.strokeStyle = hot(pct, c); ctx.beginPath();
      for (let i = 0; i < lit; i++) { const a0 = -Math.PI / 2 + i * step; ctx.moveTo(Math.cos(a0 + gap) * r, Math.sin(a0 + gap) * r); ctx.arc(0, 0, r, a0 + gap, a0 + step - gap); }
      ctx.stroke();
    }
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(c, 0.32); ctx.setLineDash([2, 4]); ctx.lineDashOffset = -t * 10;
    ctx.beginPath(); ctx.arc(0, 0, r - 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(c, 0.7); ctx.beginPath();
    for (let s = 0; s < 3; s++) { const a0 = -t * 0.9 + (s * TAU) / 3; ctx.moveTo(Math.cos(a0) * (r - 12), Math.sin(a0) * (r - 12)); ctx.arc(0, 0, r - 12, a0, a0 + 0.45); }
    ctx.stroke();
    ctx.fillStyle = rgba(c, 1); ctx.textAlign = 'center'; ctx.font = '14px Consolas, monospace';
    ctx.fillText(ok ? Math.round(pct) + '%' : 'N/A', 0, 5);
    ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.85); ctx.fillText(label, 0, r + 22);
    ctx.fillStyle = rgba(c, 0.5); ctx.fillText(sub, 0, r + 33);
    ctx.restore();
  }

  // framed chart with grid, scale ticks, glow line, filled area and a live marker
  function chart(ctx, title, right, series, x, y, w, h, max, c, t) {
    ctx.textAlign = 'left'; ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.8); ctx.fillText(title, x, y - 7);
    ctx.textAlign = 'right'; ctx.fillStyle = rgba(c, 0.6); ctx.fillText(right, x + w, y - 7);
    ctx.fillStyle = rgba(c, 0.05); ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(c, 0.13); ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo(x, y + (h * i) / 4); ctx.lineTo(x + w, y + (h * i) / 4); }
    for (let i = 1; i < 6; i++) { ctx.moveTo(x + (w * i) / 6, y); ctx.lineTo(x + (w * i) / 6, y + h); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = rgba(c, 0.55); ctx.beginPath();
    const k = 7;   // corner brackets
    ctx.moveTo(x, y + k); ctx.lineTo(x, y); ctx.lineTo(x + k, y); ctx.moveTo(x + w - k, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + k);
    ctx.moveTo(x, y + h - k); ctx.lineTo(x, y + h); ctx.lineTo(x + k, y + h); ctx.moveTo(x + w - k, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - k);
    ctx.stroke();
    for (const { data, alpha, fill, color } of series) {
      if (data.length < 2) continue;
      const off = N - data.length;
      const px = (i) => x + ((i + off) / (N - 1)) * w, py = (v) => y + h - 1 - Math.min(1, v / max) * (h - 2);
      ctx.beginPath();
      data.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
      ctx.strokeStyle = color || rgba(c, alpha); ctx.lineWidth = 1.5; ctx.stroke();
      if (fill) { ctx.lineTo(px(data.length - 1), y + h); ctx.lineTo(px(0), y + h); ctx.closePath(); ctx.fillStyle = rgba(c, 0.16); ctx.fill(); }
      if (alpha > 0.6) {
        const lx = px(data.length - 1), ly = py(data[data.length - 1]), p = 2.5 + Math.sin(t * 5) * 0.8;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(lx, ly, 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(c, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(lx, ly, p + 2, 0, TAU); ctx.stroke();
      }
    }
  }

  function draw(cv, c, sc, t) {
    if (!last) return;
    const ctx = cv.getContext('2d'), W = cv.clientWidth, Hh = cv.clientHeight;
    if (cv.width !== Math.round(W * sc)) { cv.width = Math.round(W * sc); cv.height = Math.round(Hh * sc); }
    ctx.setTransform(sc, 0, 0, sc, 0, 0); ctx.clearRect(0, 0, W, Hh);
    const m = last, cw = W / 4, r = 27;
    gauge(ctx, cw * 0.5, 44, r, m.cpu, c, 'CPU', m.cores.length + ' CORES', t);
    gauge(ctx, cw * 1.5, 44, r, m.gpu, c, 'GPU', m.gpu == null ? 'NO DATA' : 'ENGINE LOAD', t);
    gauge(ctx, cw * 2.5, 44, r, m.mem, c, 'MEMORY', m.mem_used + '/' + Math.round(m.mem_total) + ' GB', t);
    gauge(ctx, cw * 3.5, 44, r, m.disk, c, 'DISK', m.disk_used + '/' + m.disk_total + ' GB', t);

    const series = [{ data: H.cpu, alpha: 0.95, fill: true }];
    if (H.gpu.length) series.push({ data: H.gpu, alpha: 0.7, fill: false, color: 'rgba(255,205,110,.9)' });
    chart(ctx, 'CPU' + (H.gpu.length ? ' / GPU' : '') + ' LOAD · 60 S', Math.round(m.cpu) + '%' + (m.gpu != null ? '  ' + Math.round(m.gpu) + '%' : ''), series, 0, 140, W, 62, 100, c, t);
    chart(ctx, 'MEMORY · 60 S', Math.round(m.mem) + '%', [{ data: H.mem, alpha: 0.95, fill: true }], 0, 232, W, 50, 100, c, t);
    const nmax = Math.max(50, ...H.down, ...H.up);
    chart(ctx, 'NETWORK', '▼ ' + fmtRate(m.net_down) + '  ▲ ' + fmtRate(m.net_up), [{ data: H.up, alpha: 0.4, fill: false }, { data: H.down, alpha: 0.95, fill: true }], 0, 314, W, 50, nmax, c, t);

    ctx.textAlign = 'left'; ctx.font = '9px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.8); ctx.fillText('CORES', 0, 388);
    const n = m.cores.length, gap = 3, bw = Math.max(3, (W - gap * (n - 1)) / n);
    for (let i = 0; i < n; i++) {
      const v = m.cores[i], h = Math.max(2, (v / 100) * 22), x = i * (bw + gap);
      ctx.fillStyle = rgba(c, 0.13); ctx.fillRect(x, 394, bw, 22);
      ctx.fillStyle = hot(v, c, 0.9); ctx.fillRect(x, 416 - h, bw, h);
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
