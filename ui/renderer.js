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
window.jarvis.onResetOrb && window.jarvis.onResetOrb(() => setPin(null));

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

function loadPin() { try { return JSON.parse(localStorage.getItem('jarvis.orbpin')) || null; } catch (e) { return null; } }
function setPin(p) {
  S.pin = p;
  try { p ? localStorage.setItem('jarvis.orbpin', JSON.stringify(p)) : localStorage.removeItem('jarvis.orbpin'); } catch (e) { /* storage unavailable: fine */ }
}

const S = { idle: 'center', procs: [], exec: false, planned: false, info: null, wins: [], compact: 0, state: 'loading', followup: false, level: 0, target: 0, prom: 0, hold: 0,
            color: [...COLORS.loading], t: 0, pin: loadPin(), timers: [] };
let pttActive = false;
const eff = () => (pttActive && (S.state === 'idle' || S.state === 'speaking') ? 'listening' : S.state);

function refreshLabel() {
  const st = eff();
  const lbl = (LABEL[st] || st).toUpperCase() + (S.followup && st === 'idle' ? ' · LISTENING' : '');
  $('state').textContent = lbl; $('cstate').textContent = lbl;
  $('s-voice').textContent = st === 'speaking' ? 'Speaking' : st === 'listening' ? 'Listening' : st === 'idle' ? 'Standing by' : 'Busy';
  document.body.classList.toggle('dim', st === 'idle' && !S.followup);
}

// which stage Jarvis is in, for the status bar: listening / thinking / planning / executing / responding
function phase() {
  const st = eff();
  if (st === 'listening') return 'listening';
  if (st === 'speaking') return 'responding';
  if (st === 'thinking') return S.exec ? 'executing' : S.planned ? 'planning' : 'thinking';
  return null;
}
function updatePhases() {
  const p = phase();
  document.querySelectorAll('.phs').forEach((el) => el.classList.toggle('on', el.dataset.p === p));
  $('barstate').textContent = p ? p.toUpperCase() : (S.state === 'loading' ? 'INITIALISING' : 'AWAITING WAKE WORD');
}
function setState(st, followup = false) { S.state = st; S.followup = followup; refreshLabel(); }

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

function buildTiles(items) {
  const box = $('tiles');
  box.replaceChildren();
  $('dcount').textContent = items.length ? '· ' + items.length + ' LINKS' : '';
  if (!items.length) {
    const d = document.createElement('div'); d.className = 'empty';
    d.textContent = 'Add launcher: items in settings.yaml'; box.appendChild(d); return;
  }
  items.forEach((it, i) => {
    const t = document.createElement('div'); t.className = 'tile interactive'; t.title = it.name;
    const inner = document.createElement('div'); inner.className = 'in';
    const ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = it.icon;
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.name;
    inner.append(ic, nm); t.appendChild(inner);
    t.addEventListener('click', () => {
      t.classList.remove('fire'); void t.offsetWidth; t.classList.add('fire');
      addLog('Launching ' + it.name); send({ type: 'launch', index: i });
    });
    box.appendChild(t);
  });
}

function handle(m) {
  switch (m.type) {
    case 'state':
      if (m.state === 'idle' || m.state === 'listening') { S.exec = false; S.planned = false; }
      setState(m.state, !!m.followup);
      if (m.state === 'idle') fadeCaptionSoon();
      break;
    case 'level': S.target = Math.max(S.target, m.value); break;
    case 'transcript':
      showCaption();
      if (m.role === 'user') { S.exec = false; S.planned = false; }
      if (m.role === 'alert') { $('cap-user').textContent = '⏰'; $('cap-ai').textContent = m.text; }
      else if (m.role === 'user') { $('cap-user').textContent = '“' + m.text + '”'; $('cap-ai').textContent = ''; }
      else { $('cap-ai').textContent += (($('cap-ai').textContent ? ' ' : '') + m.text); }
      break;
    case 'tool': S.exec = true; addLog('Executing ' + m.name + (m.input && m.input.name ? ': ' + m.input.name : '')); break;
    case 'tool_result': S.exec = false; S.planned = true; addLog(m.result); break;
    case 'log': addLog(m.text); break;
    case 'timers': S.timers = m.items || []; drawTimers(); break;
    case 'error': addLog('ERROR: ' + m.text); break;
    case 'desktop': S.wins = m.windows || []; updateCovered(); break;
    case 'launcher': buildTiles(m.items || []); break;
    case 'config': S.idle = m.idle_position === 'corner' ? 'corner' : 'center'; break;
    case 'info': showInfo(m); break;
    case 'stats': onStats(m); break;
  }
}

function setText(id, v, title) { const el = $(id); el.textContent = v; if (title) el.title = title; }
function showInfo(m) {
  S.info = m;
  const model = String(m.model || '').replace(/^models\//, '');
  setText('i-brain', model || (m.provider || '--'), model);
  setText('s-brain', 'Active');
  setText('i-voice', (m.voice || '--').toUpperCase());
  const sv = m.services || [], ok = sv.filter((x) => x.ok);
  const ai = sv.filter((x) => x.name === 'Gemini' || x.name === 'Claude' || x.name === 'ElevenLabs');
  setText('i-prov', ai.filter((x) => x.ok).length + ' available', ai.filter((x) => x.ok).map((x) => x.name).join(', '));
  setText('i-svc', ok.length + ' of ' + sv.length, ok.map((x) => x.name).join(', '));
  $('ver').textContent = m.version ? 'v' + m.version : '';
}
function setBars(id, frac, hotAt = 0.85) {
  const box = $(id);
  if (!box.children.length) for (let i = 0; i < 14; i++) box.appendChild(document.createElement('i'));
  const n = Math.round(Math.max(0, Math.min(1, frac)) * box.children.length);
  [...box.children].forEach((el, i) => { el.className = i < n ? (i / box.children.length >= hotAt ? 'hot' : 'on') : ''; });
}
function onStats(m) {
  Perf.update(m); Perf.text({ up: $('up'), bat: $('bat') });
  S.procs = m.procs || [];
  setText('i-mem', Math.round(m.mem) + '%'); setText('s-mem', m.mem_used + ' / ' + Math.round(m.mem_total) + ' GB');
  setText('i-disk', Math.round(m.disk) + '%'); setText('s-disk', m.disk_used + ' / ' + m.disk_total + ' GB');
  setText('i-run', Perf.fmtUptime(m.jarvis_up || 0));
  setBars('r-cpu', m.cpu / 100); setBars('r-mem', m.mem / 100);
  setBars('r-net', Math.log10(1 + (m.net_down || 0) + (m.net_up || 0)) / Math.log10(1 + 20000), 0.9);
}

// ---------- window awareness ----------
const PANELS = ['diag', 'log', 'timers', 'dock', 'clockbox', 'perf', 'radar'];
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
  $('secfill').style.width = ((d.getSeconds() + d.getMilliseconds() / 1000) / 60 * 100) + '%';
}
setInterval(tick, 250); tick();

// ---------- audio history for the status-bar waveform ----------
const waveArr = new Array(64).fill(0);
setInterval(() => { waveArr.push(Math.min(1, S.level * (0.45 + Math.random() * 0.9))); waveArr.shift(); }, 45);

// ---------- canvas: orb + digital brain + audio visuals ----------
const cv = $('c'), ctx = cv.getContext('2d');
let W, H;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', () => { resize(); Scenery.init(W, H); }); resize(); Scenery.init(W, H);

const NBARS = 72;
const bars = new Array(NBARS).fill(0);
const rgba = (c, a) => `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const brain = new BrainViz.Brain(7);
const orbNow = { x: 0, y: 0, R: 40 };
let frameNo = 0, lastFollow = null;

function placeFollowers(cx, cy, R) {
  const f = Layout.followers(cx, cy, R, W, H);
  const cap = $('caption').style, lab = $('corner').style;
  cap.left = f.caption.left + 'px';
  cap.top = f.caption.top != null ? f.caption.top + 'px' : 'auto';
  cap.bottom = f.caption.bottom != null ? f.caption.bottom + 'px' : 'auto';
  lab.left = f.label.x + 'px'; lab.top = f.label.y + 'px';
  lab.transform = f.label.onLeft ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
  lab.textAlign = f.label.onLeft ? 'right' : 'left';
}

function frame(ms) {
  const t = ms / 1000, dt = Math.min(0.05, t - S.t); S.t = t; frameNo++;
  ctx.clearRect(0, 0, W, H);

  // ease colour + prominence + audio level
  const st = eff();
  const tc = COLORS[st] || COLORS.idle;
  for (let i = 0; i < 3; i++) S.color[i] += (tc[i] - S.color[i]) * 0.08;
  document.documentElement.style.setProperty('--c', S.color.map(Math.round).join(','));
  const active = (st === 'idle' && !S.followup) || st === 'loading' ? 0 : 1;
  S.prom += (active - S.prom) * 0.06;
  S.hold += ((pttActive ? 1 : 0) - S.hold) * 0.15;
  S.target *= 0.9;
  S.level += (S.target - S.level) * 0.35;
  const lv = S.level;
  const c = S.color;

  // No windows: orb sits bottom-right when idle and grows toward the screen centre when active.
  // Window open: it stays small in the bottom-right corner. A dragged position overrides both.
  const k = S.prom * S.prom * (3 - 2 * S.prom);
  const wantC = Layout.isCompact(S.wins) ? 1 : 0;
  S.compact += (wantC - S.compact) * 0.07;
  const cm = S.compact * S.compact * (3 - 2 * S.compact);
  const { x: cx, y: cy, R } = Layout.orb(W, H, cm, k, S.pin, S.idle);
  orbNow.x = cx; orbNow.y = cy; orbNow.R = R;
  const speed = st === 'thinking' ? 3.2 : st === 'listening' ? 1.2 : 0.55;

  const follow = Layout.isCompact(S.wins) || !!S.pin;
  if (follow !== lastFollow) {
    lastFollow = follow;
    document.body.classList.toggle('follow', follow);
    if (!follow) for (const el of [$('caption'), $('corner')]) { el.style.left = el.style.top = el.style.bottom = el.style.transform = el.style.textAlign = ''; }
  }
  document.body.classList.toggle('pinned', !!S.pin);
  if (follow) placeFollowers(cx, cy, R);

  const alpha = 0.45 + 0.55 * Math.max(k * (1 - cm), cm * 0.55, S.pin ? 0.6 : 0, st === 'loading' ? 0.6 : 0, S.idle === 'center' ? 0.7 * (1 - cm) : 0);
  const big = 1 - cm;   // how "full size" the HUD is (radar, waveform)

  const scenic = big > 0.05 && !S.pin;          // full command-center scenery only on a clear desktop
  const sa = Math.min(1, alpha + 0.2) * big;
  if (scenic) {
    Scenery.drawBackground(ctx, t, dt, c, big);
    Scenery.drawPlatform(ctx, cx, cy, R, t, c, sa, lv);
  }

  // glow
  const pulse = 1 + 0.06 * Math.sin(t * 2) + lv * 0.25;
  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3.2 * pulse);
  g.addColorStop(0, rgba(c, 0.28 * alpha)); g.addColorStop(0.4, rgba(c, 0.09 * alpha)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 3.2 * pulse, 0, 7); ctx.fill();

  // radial audio bars
  for (let i = 0; i < NBARS; i++) {
    const a = (i / NBARS) * Math.PI * 2 + t * 0.08 * speed;
    const wob = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + t * 6) * Math.cos(i * 0.6 - t * 3));
    const want = (st === 'listening' || st === 'speaking') ? lv * wob : 0.04 + 0.03 * Math.sin(t * 2 + i);
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
  const showGlobe = R > 38;
  const rings = showGlobe ? [[R * 1.25, 3, 0.7, 1]] : [[R * 1.25, 3, 0.7, 1], [R * 1.05, 5, 0.55, -1.4], [R * 0.9, 2, 0.8, 2.1]];
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

  // hold-to-talk: expanding rings from the orb
  if (S.hold > 0.02) {
    for (let i = 0; i < 2; i++) {
      const ph = (t * 1.1 + i * 0.5) % 1;
      ctx.strokeStyle = rgba(c, 0.8 * (1 - ph) * S.hold); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.7 + ph * 1.1), 0, 7); ctx.stroke();
    }
  }

  // the digital brain at the heart of it
  g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.85);
  g.addColorStop(0, rgba(c, 0.30 * alpha + lv * 0.2)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.85, 0, 7); ctx.fill();
  brain.update(dt, st, lv);
  brain.draw(ctx, cx, cy, R, t, c, Math.min(1, alpha + 0.25));
  if (showGlobe) Scenery.drawGlobe(ctx, cx, cy, R * 1.0, t, c, Math.min(1, alpha + 0.2), lv);
  if (scenic) {
    Scenery.drawOrbits(ctx, cx, cy, R, t, c, sa);
    if (W >= 1700) {
      const inf = S.info || {};
      Scenery.drawCallouts(ctx, cx, cy, R, t, c, sa * (0.5 + 0.5 * k), [['Neural net', 'Online'], ['Voice', inf.voice || '--'], ['Brain', inf.provider || '--'], ['Link', 'Secure']]);
    }
  }
  if (frameNo % 15 === 0) { $('i-syn').textContent = brain.firing; }

  // thinking: orbiting dots
  if (st === 'thinking') {
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + i * 2.094;
      ctx.fillStyle = rgba(c, 0.95);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 2.0, cy + Math.sin(a) * R * 2.0, 4 - cm * 1.5, 0, 7); ctx.fill();
    }
  }

  if (frameNo % 3 === 0) { Perf.draw($('perfc'), c); }
  if (frameNo % 2 === 0) {
    Scenery.drawRadar($('radarc'), S.procs, t, c);
    if (big > 0.2 && !S.pin) {
      Scenery.drawEmblem($('emblem'), t, c, k); Scenery.drawWave($('wave'), waveArr, c, st !== 'idle', t);
      setBars('r-syn', brain.firing / 70, 0.9);
    }
  }
  if (frameNo % 6 === 0) updatePhases();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- mouse: hold-to-talk, drag to move ----------
// The overlay ignores the mouse (clicks pass to your desktop) except while the pointer is over the
// visualizer or the launcher. mousemove events are still forwarded to us so we can tell.
let interactive = false, dragging = null;
function setInteractive(v) { if (v !== interactive) { interactive = v; window.jarvis.setInteractive && window.jarvis.setInteractive(v); } }
const overOrb = (x, y) => Math.hypot(x - orbNow.x, y - orbNow.y) < orbNow.R * 1.75 + 6;

document.addEventListener('mousemove', (e) => {
  if (dragging) {
    setPin({ x: (e.clientX - dragging.dx) / W, y: (e.clientY - dragging.dy) / H });
    return;
  }
  const on = overOrb(e.clientX, e.clientY);
  setInteractive(on || pttActive || !!(e.target.closest && e.target.closest('.interactive')));
  document.body.style.cursor = on ? 'pointer' : '';
  $('corner').classList.toggle('hover', on);
});
document.addEventListener('mouseleave', () => { if (!dragging && !pttActive) setInteractive(false); });
document.addEventListener('mousedown', (e) => {
  if (!overOrb(e.clientX, e.clientY)) return;
  e.preventDefault();
  if (e.button === 0) {                       // hold to talk (also cuts Jarvis off mid-sentence)
    pttActive = true; refreshLabel(); send({ type: 'ptt_down' });
  } else if (e.button === 2) {                // right-drag to move
    dragging = { dx: e.clientX - orbNow.x, dy: e.clientY - orbNow.y };
    document.body.style.cursor = 'grabbing';
    setInteractive(true);
  } else if (e.button === 1) {                // middle-click: back to the default spot
    setPin(null);
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0 && pttActive) { pttActive = false; refreshLabel(); send({ type: 'ptt_up' }); }
  if (e.button === 2 && dragging) { dragging = null; document.body.style.cursor = ''; }
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('blur', () => { if (pttActive) { pttActive = false; refreshLabel(); send({ type: 'ptt_up' }); } });

setState('loading');
connect();
