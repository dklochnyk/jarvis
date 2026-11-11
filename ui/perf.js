// Performance hub: gauges, rolling charts, per-core bars, top processes.
(function (root) {
  const N = 60;
  const push = (arr, v) => { arr.push(v); while (arr.length > N) arr.shift(); return arr; };
  const fmtRate = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB/s' : kb.toFixed(kb < 10 ? 1 : 0) + ' KB/s');
  const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? d + 'D ' : '') + h + 'H ' + String(m).padStart(2, '0') + 'M'; };

  const H = { cpu: [], mem: [], down: [], up: [] };
  let last = null;

  function update(m) {
    last = m;
    push(H.cpu, m.cpu); push(H.mem, m.mem); push(H.down, m.net_down || 0); push(H.up, m.net_up || 0);
  }

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function ring(ctx, x, y, r, pct, c, label, sub) {
    ctx.lineWidth = 6; ctx.lineCap = 'butt';
    ctx.strokeStyle = rgba(c, 0.14); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    const a0 = -Math.PI / 2, a1 = a0 + 6.2832 * Math.max(0.005, Math.min(1, pct / 100));
    ctx.strokeStyle = pct > 90 ? 'rgba(255,90,90,.95)' : pct > 75 ? 'rgba(255,180,60,.95)' : rgba(c, 0.95);
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(c, 0.3);
    for (let i = 0; i < 40; i++) { const a = (i / 40) * 6.2832; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6)); ctx.lineTo(x + Math.cos(a) * (r + (i % 5 ? 8 : 10)), y + Math.sin(a) * (r + (i % 5 ? 8 : 10))); ctx.stroke(); }
    ctx.fillStyle = rgba(c, 1); ctx.textAlign = 'center';
    ctx.font = '15px Consolas, monospace'; ctx.fillText(Math.round(pct) + '%', x, y + 5);
    ctx.font = '10px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.8); ctx.fillText(label, x, y + r + 21);
    ctx.fillStyle = rgba(c, 0.55); ctx.fillText(sub, x, y + r + 33);
  }

  function chart(ctx, series, x, y, w, h, max, c, fillA) {
    ctx.strokeStyle = rgba(c, 0.12); ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x, y + (h * i) / 2); ctx.lineTo(x + w, y + (h * i) / 2); ctx.stroke(); }
    series.forEach(({ data, alpha, fill }) => {
      if (data.length < 2) return;
      const px = (i) => x + (i / (N - 1)) * w + (N - data.length) * (w / (N - 1)) * 0;
      const off = N - data.length;
      ctx.beginPath();
      data.forEach((v, i) => { const X = x + ((i + off) / (N - 1)) * w, Y = y + h - Math.min(1, v / max) * h; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.strokeStyle = rgba(c, alpha); ctx.lineWidth = 1.5; ctx.stroke();
      if (fill) { ctx.lineTo(x + w, y + h); ctx.lineTo(x + (off / (N - 1)) * w, y + h); ctx.closePath(); ctx.fillStyle = rgba(c, fillA); ctx.fill(); }
    });
  }

  function draw(cv, c) {
    if (!last) return;
    const ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, Hh = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = Hh * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hh);
    const m = last;
    ring(ctx, 48, 40, 28, m.cpu, c, 'CPU', m.cores.length + ' CORES');
    ring(ctx, 146, 40, 28, m.mem, c, 'MEMORY', m.mem_used + '/' + Math.round(m.mem_total) + ' GB');
    ring(ctx, 244, 40, 28, m.disk, c, 'DISK', m.disk_used + '/' + m.disk_total + ' GB');

    ctx.textAlign = 'left'; ctx.font = '10px Consolas, monospace'; ctx.fillStyle = rgba(c, 0.7);
    ctx.fillText('CPU LOAD / MEMORY · 60 S', 0, 126);
    chart(ctx, [{ data: H.mem, alpha: 0.45, fill: false }, { data: H.cpu, alpha: 0.95, fill: true }], 0, 132, W, 36, 100, c, 0.18);

    ctx.fillStyle = rgba(c, 0.7); ctx.fillText('NETWORK', 0, 186);
    ctx.textAlign = 'right'; ctx.fillText('▼ ' + fmtRate(m.net_down) + '   ▲ ' + fmtRate(m.net_up), W, 186);
    const nmax = Math.max(50, ...H.down, ...H.up);
    chart(ctx, [{ data: H.up, alpha: 0.4, fill: false }, { data: H.down, alpha: 0.95, fill: true }], 0, 192, W, 36, nmax, c, 0.18);

    ctx.textAlign = 'left'; ctx.fillStyle = rgba(c, 0.7); ctx.fillText('CORES', 0, 246);
    const n = m.cores.length, gap = 3, bw = Math.max(3, (W - gap * (n - 1)) / n);
    m.cores.forEach((v, i) => {
      const h = Math.max(2, (v / 100) * 22), x = i * (bw + gap);
      ctx.fillStyle = rgba(c, 0.14); ctx.fillRect(x, 252, bw, 22);
      ctx.fillStyle = v > 85 ? 'rgba(255,90,90,.95)' : rgba(c, 0.9); ctx.fillRect(x, 274 - h, bw, h);
    });
  }

  function text(dom) {
    if (!last) return;
    const rows = (last.procs || []).map(([n, v]) => `<div class="row"><span>${n.replace(/[<>&]/g, '').slice(0, 22)}</span><span>${v.toFixed(1)}%</span></div>`);
    dom.procs.innerHTML = rows.length ? '<div class="ph" style="margin:6px 0 2px">Top processes</div>' + rows.join('') : '';
    dom.up.textContent = 'UP ' + fmtUptime(last.uptime || 0);
    dom.bat.textContent = last.battery == null ? 'AC POWER' : 'BAT ' + last.battery + '%' + (last.plugged ? ' ⚡' : '');
  }

  const api = { update, draw, text, push, fmtRate, fmtUptime, history: H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Perf = api;
})(typeof window !== 'undefined' ? window : globalThis);
