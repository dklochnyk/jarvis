// ---------- websocket to the Python backend ----------
let ws;
const $ = (id) => document.getElementById(id);

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
  ws = new WebSocket('ws://127.0.0.1:8765');
  ws.onopen = () => addLog('Link established');
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { setState('loading'); setTimeout(connect, 1500); };
  ws.onerror = () => ws.close();
}

window.jarvis.onHotkey(() => send({ type: 'hotkey' }));
window.jarvis.onToggleHud(() => $('hud').classList.toggle('hidden'));

// ---------- state ----------
const COLORS = {
  loading:   [120, 150, 175],
  idle:      [0, 200, 255],
  listening: [0, 255, 190],
  thinking:  [255, 180, 60],
  speaking:  [90, 220, 255],
  error:     [255, 80, 80],
};
const LABEL = { loading: 'Initialising', idle: 'Standing by', listening: 'Listening', thinking: 'Processing', speaking: 'Responding', error: 'Fault' };

const S = { wins: [], compact: 0, state: 'loading', followup: false, level: 0, target: 0, prom: 0, color: [...COLORS.loading], t: 0 };

function setState(st, followup = false) {
  S.state = st; S.followup = followup;
  const lbl = (LABEL[st] || st).toUpperCase() + (followup && st === 'idle' ? ' · LISTENING' : '');
  $('state').textContent = lbl; $('cstate').textContent = lbl;
  document.body.classList.toggle('dim', st === 'idle' && !followup);
}

let capTimer;
function showCaption() { $('caption').classList.add('show'); clearTimeout(capTimer); }
function fadeCaptionSoon() { clearTimeout(capTimer); capTimer = setTimeout(() => $('caption').classList.remove('show'), 6000); }

function addLog(text) {
  const d = document.createElement('div');
  d.textContent = '> ' + text;
  const log = $('log');
  log.appendChild(d);
  while (log.children.length > 5) log.removeChild(log.firstChild);
  setTimeout(() => d.remove(), 15000);
}

function handle(m) {
  switch (m.type) {
    case 'state':
      setState(m.state, !!m.followup);
      if (m.state === 'idle') fadeCaptionSoon();
      break;
    case 'level': S.target = Math.max(S.target, m.value); break;
    case 'transcript':
      showCaption();
      if (m.role === 'alert') { $('cap-user').textContent = '⏰'; $('cap-ai').textContent = m.text; }
      else if (m.role === 'user') { $('cap-user').textContent = '“' + m.text + '”'; $('cap-ai').textContent = ''; }
      else { $('cap-ai').textContent += (($('cap-ai').textContent ? ' ' : '') + m.text); }
      break;
    case 'desktop': S.wins = m.windows || []; updateCovered(); break;
    case 'tool': addLog('Executing ' + m.name + (m.input && m.input.name ? ': ' + m.input.name : '')); break;
    case 'tool_result': addLog(m.result); break;
    case 'log': addLog(m.text); break;
    case 'timers': S.timers = m.items || []; drawTimers(); break;
    case 'error': addLog('ERROR: ' + m.text); break;
    case 'stats':
      $('cpuv').textContent = Math.round(m.cpu) + '%'; $('cpub').style.width = m.cpu + '%';
      $('memv').textContent = Math.round(m.mem) + '%'; $('memb').style.width = m.mem + '%';
      break;
  }
}

// ---------- window awareness ----------
const PANELS = ['status', 'log', 'timers', 'clockbox', 'stats'];
function updateCovered() {
  document.body.classList.toggle('compact', Layout.isCompact(S.wins));
  for (const id of PANELS) {
    const el = $(id), r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    el.classList.toggle('covered', Layout.covered({ l: r.left, t: r.top, r: r.right, b: r.bottom }, S.wins, innerWidth, innerHeight));
  }
}
setInterval(updateCovered, 400);   // panels resize as logs/timers come and go
addEventListener('resize', updateCovered);

// ---------- timers panel ----------
S.timers = [];
function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
  return (h ? h + ':' + String(mi).padStart(2, '0') : mi) + ':' + String(se).padStart(2, '0');
}
function drawTimers() {
  const box = $('timers');
  box.replaceChildren();
  for (const t of S.timers) {
    const d = document.createElement('div');
    const a = document.createElement('span'), b = document.createElement('span');
    a.textContent = t.label; b.textContent = fmt(t.end_ms - Date.now());
    d.append(a, b); box.appendChild(d);
  }
}
setInterval(() => { if (S.timers.length) drawTimers(); }, 1000);

// ---------- clock ----------
function tick() {
  const d = new Date();
  $('time').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
setInterval(tick, 1000); tick();

// ---------- canvas: orb + audio visuals ----------
const cv = $('c'), ctx = cv.getContext('2d');
let W, H;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize); resize();

const NBARS = 72;
const bars = new Array(NBARS).fill(0);
const lin = new Array(56).fill(0);
const rgba = (c, a) => `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;

function frame(ms) {
  const t = ms / 1000, dt = Math.min(0.05, t - S.t); S.t = t;
  ctx.clearRect(0, 0, W, H);

  // ease colour + prominence + audio level
  const tc = COLORS[S.state] || COLORS.idle;
  for (let i = 0; i < 3; i++) S.color[i] += (tc[i] - S.color[i]) * 0.08;
  document.documentElement.style.setProperty('--c', S.color.map(Math.round).join(','));
  const active = (S.state === 'idle' && !S.followup) || S.state === 'loading' ? 0 : 1;
  S.prom += (active - S.prom) * 0.06;
  S.target *= 0.9;
  S.level += (S.target - S.level) * 0.35;
  const lv = S.level;
  const c = S.color;

  // No windows: orb sits bottom-right when idle and grows toward the screen centre when active.
  // Window open: it stays small in the bottom-right corner.
  const k = S.prom * S.prom * (3 - 2 * S.prom);
  const wantC = Layout.isCompact(S.wins) ? 1 : 0;
  S.compact += (wantC - S.compact) * 0.07;
  const cm = S.compact * S.compact * (3 - 2 * S.compact);
  const { x: cx, y: cy, R } = Layout.orb(W, H, cm, k);
  const speed = S.state === 'thinking' ? 3.2 : S.state === 'listening' ? 1.2 : 0.55;

  const alpha = 0.45 + 0.55 * Math.max(k * (1 - cm), cm * 0.55, S.state === 'loading' ? 0.6 : 0);

  // glow
  const pulse = 1 + 0.06 * Math.sin(t * 2) + lv * 0.25;
  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3.2 * pulse);
  g.addColorStop(0, rgba(c, 0.35 * alpha)); g.addColorStop(0.4, rgba(c, 0.10 * alpha)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 3.2 * pulse, 0, 7); ctx.fill();

  // radial audio bars
  for (let i = 0; i < NBARS; i++) {
    const a = (i / NBARS) * Math.PI * 2 + t * 0.08 * speed;
    const wob = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + t * 6) * Math.cos(i * 0.6 - t * 3));
    const want = (S.state === 'listening' || S.state === 'speaking') ? lv * wob : 0.04 + 0.03 * Math.sin(t * 2 + i);
    bars[i] += (want - bars[i]) * 0.4;
    const r0 = R * 1.55, r1 = r0 + 6 + bars[i] * R * 1.1;
    ctx.strokeStyle = rgba(c, (0.35 + 0.65 * bars[i]) * alpha);
    ctx.lineWidth = 2.2 - 0.9 * cm; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  // arc-reactor rings
  ctx.lineWidth = 2;
  const rings = [[R * 1.25, 3, 0.7, 1], [R * 1.05, 5, 0.55, -1.4], [R * 0.85, 2, 0.8, 2.1]];
  for (const [rr, segs, frac, dir] of rings) {
    const base = t * speed * dir;
    for (let s = 0; s < segs; s++) {
      const a0 = base + (s / segs) * Math.PI * 2;
      ctx.strokeStyle = rgba(c, 0.85 * alpha);
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a0 + (Math.PI * 2 / segs) * frac * 0.8); ctx.stroke();
    }
  }
  // tick ring
  ctx.strokeStyle = rgba(c, 0.35 * alpha); ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - t * 0.1;
    const r0 = R * 2.55, r1 = r0 + (i % 5 === 0 ? 9 : 4);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }

  // core
  const cr = R * (0.55 + 0.1 * lv + 0.03 * Math.sin(t * 3));
  g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
  g.addColorStop(0, `rgba(255,255,255,${0.95 * alpha})`); g.addColorStop(0.35, rgba(c, 0.9 * alpha)); g.addColorStop(1, rgba(c, 0.05));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 7); ctx.fill();

  // thinking: orbiting dots
  if (S.state === 'thinking') {
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + i * 2.094;
      ctx.fillStyle = rgba(c, 0.95);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 2.0, cy + Math.sin(a) * R * 2.0, 4, 0, 7); ctx.fill();
    }
  }

  // linear waveform under the captions
  if (k * (1 - cm) > 0.02) {
    const n = lin.length, bw = 6, gap = 5, total = n * (bw + gap), x0 = W / 2 - total / 2, yb = H - 26;
    for (let i = 0; i < n; i++) {
      const env = Math.sin((i / (n - 1)) * Math.PI);
      const wob = 0.4 + 0.6 * Math.abs(Math.sin(i * 0.9 + t * 7) * Math.cos(i * 0.4 - t * 4));
      const want = (S.state === 'listening' || S.state === 'speaking') ? lv * wob * env : 0.02 * env;
      lin[i] += (want - lin[i]) * 0.4;
      const h = 3 + lin[i] * 46;
      ctx.fillStyle = rgba(c, (0.4 + 0.6 * lin[i]) * k * (1 - cm));
      ctx.fillRect(x0 + i * (bw + gap), yb - h / 2, bw, h);
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setState('loading');
connect();
