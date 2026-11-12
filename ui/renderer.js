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
window.jarvis.onResetOrb && window.jarvis.onResetOrb(() => resetAllUI());

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

const S = { sp: null, spec: new Array(40).fill(0), specAt: 0, specShown: new Array(40).fill(0), exec: false, planned: false,
            compact: 0, state: 'loading', followup: false, level: 0, target: 0, prom: 0, hold: 0,
            color: [...COLORS.loading], t: 0, pin: loadPin(), stats: null,
            screens: [], busy: [], anyWin: false, legacyWins: [], rects: null, phys: null };
let pttActive = false;
const eff = () => (pttActive && (S.state === 'idle' || S.state === 'speaking') ? 'listening' : S.state);

function refreshLabel() {
  const st = eff();
  $('cstate').textContent = (LABEL[st] || st).toUpperCase() + (S.followup && st === 'idle' ? ' · LISTENING' : '');
  document.body.classList.toggle('dim', st === 'idle' && !S.followup);
}
function setState(st, followup = false) { S.state = st; S.followup = followup; refreshLabel(); }

let capTimer;
function showCaption() { $('caption').classList.add('show'); clearTimeout(capTimer); }
function fadeCaptionSoon() { clearTimeout(capTimer); capTimer = setTimeout(() => $('caption').classList.remove('show'), 6000); }
function addLog(text) { console.log(text); }

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
    case 'tool': S.exec = true; break;
    case 'tool_result': S.exec = false; S.planned = true; break;
    case 'error': termLine('ERROR: ' + m.text, true); break;
    case 'term': termLine(m.text, m.err); break;
    case 'termbuf': $('tlines').replaceChildren(); (m.lines || []).forEach((l) => termLine(l.text, l.err, true)); break;
    case 'desktop': S.legacyWins = m.windows || []; S.rects = m.rects || null; recomputeBusy(); updateCovered(); break;
    case 'spotify': S.sp = { ...m, at: Date.now() }; updatePlayer(true); break;
    case 'spectrum': S.spec = m.bands || S.spec; S.specAt = Date.now(); break;
    case 'stats': S.stats = m; Perf.update(m); Perf.text({ up: $('up'), bat: $('bat') }); break;
  }
}

// ---------- window awareness, per screen ----------
// Windows arrive as absolute screen pixels. A screen is "busy" when a window of reasonable size is open on it.
// Panels hide, and the core shrinks, only on a busy screen - windows on your other monitors don't matter.
function recomputeBusy() {
  const sc = S.screens;
  if (!S.rects || !S.phys || !sc.length) {
    S.busy = sc.map(() => (S.legacyWins || []).length > 0);
    S.anyWin = (S.legacyWins || []).length > 0;
    return;
  }
  S.busy = sc.map((s) => S.rects.some(([l, t, r, b]) => Math.min(r, s.phys.x + s.phys.w) - Math.max(l, s.phys.x) >= 120 && Math.min(b, s.phys.y + s.phys.h) - Math.max(t, s.phys.y) >= 80));
  S.anyWin = S.busy.some(Boolean);
}
function screenAt(x, y) {   // which screen (index) a point in the overlay window is on
  const sc = S.screens;
  if (!sc.length) return -1;
  let best = 0, bd = Infinity;
  sc.forEach((s, i) => {
    const dx = Math.max(s.x - x, 0, x - (s.x + s.w)), dy = Math.max(s.y - y, 0, y - (s.y + s.h)), d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function busyAt(x, y) {
  const i = screenAt(x, y);
  return i < 0 ? S.anyWin : !!S.busy[i];
}
const PANELS = ['perf', 'player'];
function updateCovered() {
  for (const id of PANELS) {
    const el = $(id), r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    el.classList.toggle('covered', busyAt((r.left + r.right) / 2, (r.top + r.bottom) / 2));
  }
  const o = orbNow;
  $('corner').classList.toggle('covered', busyAt(o.x, o.y) && !S.pin);
}
setInterval(updateCovered, 400);

// ---------- the core: its own small canvas that follows it ----------
const cv = $('c'), ctx = cv.getContext('2d');
let W, H, CW, CH, HX = 0, HY = 0, homeRect = null;   // CW/CH: whole overlay; HX,HY,W,H: the home screen
function applyHome() {
  const h = homeRect || { x: 0, y: 0, w: CW, h: CH };
  HX = h.x; HY = h.y; W = h.w; H = h.h;
  const st = $('stage').style;
  st.left = HX + 'px'; st.top = HY + 'px'; st.width = W + 'px'; st.height = H + 'px';
}
// Visual quality: 0 low / 1 medium / 2 high. Sets frame rates and drawing resolution (the big CPU/GPU costs).
let QUALITY = 1;
const FPS_IDLE = [6, 10, 15], FPS_ACTIVE = [15, 24, 36], PERF_MS = [500, 250, 150];
function renderScale() {
  const dpr = window.devicePixelRatio || 1;
  return QUALITY === 0 ? Math.min(dpr, 1) * 0.75 : QUALITY === 1 ? Math.min(dpr, 1.25) : Math.min(dpr, 1.75);
}
let canvasSide = 0, canvasSc = 0;
function sizeCoreCanvas() {
  const side = Math.ceil(58 * 7 * uiScale('orb')), sc = renderScale();
  if (side === canvasSide && sc === canvasSc) return;
  canvasSide = side; canvasSc = sc;
  cv.style.width = cv.style.height = side + 'px';
  cv.width = cv.height = Math.round(side * sc);
}
function resize() {
  CW = innerWidth; CH = innerHeight;
  applyHome(); sizeCoreCanvas();
}
window.jarvis.onQuality && window.jarvis.onQuality((_e, q) => { QUALITY = Math.max(0, Math.min(2, q | 0)); sizeCoreCanvas(); });
addEventListener('resize', resize);
window.jarvis.onScreens && window.jarvis.onScreens((_e, m) => {
  S.phys = m.phys || null;
  S.screens = (m.displays || []).filter((d) => d.phys);
  homeRect = m.home || null;
  if (m.changed) { UI = {}; saveUI(); setPin(null); }
  resize(); MOVABLE.forEach(applyUI); MOVABLE.forEach(keepOnScreen); recomputeBusy(); updateCovered();
});

const NBARS = 72;
const bars = new Float32Array(NBARS);
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const brain = new BrainViz.Brain(7);
const orbNow = { x: 0, y: 0, R: 40 };
let frameNo = 0;

// the audio spectrum: real (from the backend's loopback capture) or simulated while a song is playing
function updateSpectrum(t) {
  const live = Date.now() - S.specAt < 2500, playing = !!(S.sp && S.sp.playing);
  const beat = Math.pow(Math.max(0, Math.sin(t * 3.9)), 3);
  for (let i = 0; i < 40; i++) {
    let want;
    if (live) want = (S.spec[i] || 0) / 100;
    else if (playing) want = 0.55 * Math.exp(-i / 24) * (0.3 + 0.7 * Math.abs(Math.sin(t * (1.6 + i * 0.17) + i * 1.3))) * (0.55 + 0.6 * beat);
    else want = 0.02;
    S.specShown[i] += (want - S.specShown[i]) * (want > S.specShown[i] ? 0.5 : 0.18);
  }
}

// ---------- spotify player ----------
const fmtT = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const PLAY = 'M8 5v14l11-7z', PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';
let lastArt = null;
function updatePlayer(full) {
  const sp = S.sp, box = $('player');
  if (!sp) return;
  box.classList.toggle('off', !sp.ok);
  if (full || sp.ok === false) {
    if (!sp.ok) { $('pl-label').textContent = 'SPOTIFY · NOT LINKED'; $('pl-title').textContent = 'Spotify is not connected'; $('pl-artist').textContent = 'Run spotify-login.bat once to link it'; }
    else if (!sp.title) { $('pl-label').textContent = 'SPOTIFY · IDLE'; $('pl-title').textContent = 'Nothing playing'; $('pl-artist').textContent = 'Say “Jarvis, play something”'; }
    else { $('pl-label').textContent = sp.playing ? 'SPOTIFY · NOW PLAYING' : 'SPOTIFY · PAUSED'; $('pl-title').textContent = sp.title; $('pl-artist').textContent = sp.artist + (sp.album ? ' — ' + sp.album : ''); }
    if (sp.art !== lastArt) { lastArt = sp.art; const im = $('pl-img'); if (sp.art) { im.style.visibility = 'visible'; im.src = sp.art; } else { im.style.visibility = 'hidden'; } }
  }
  $('pl-pp').innerHTML = '<path d="' + (sp.playing ? PAUSE : PLAY) + '"/>';
  const dur = sp.duration_ms || 0, prog = Math.min(dur, (sp.progress_ms || 0) + (sp.playing ? Date.now() - sp.at : 0));
  $('pl-fill').style.width = dur ? (prog / dur) * 100 + '%' : '0%';
  $('pl-t0').textContent = fmtT(prog); $('pl-t1').textContent = fmtT(dur);
}
setInterval(() => { if (!$('player').classList.contains('covered')) updatePlayer(false); }, 500);
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.pbtn');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'play_pause' && S.sp) { S.sp.progress_ms = (S.sp.progress_ms || 0) + (S.sp.playing ? Date.now() - S.sp.at : 0); S.sp.at = Date.now(); S.sp.playing = !S.sp.playing; updatePlayer(true); }
  send({ type: 'spotify', action: a });
});

function placeFollowers(cx, cy, R) {   // window coordinates
  const f = Layout.followers(cx, cy, R, CW, CH);
  const cap = $('caption').style, lab = $('corner').style;
  cap.left = f.caption.left + 'px';
  cap.top = f.caption.top != null ? f.caption.top + 'px' : 'auto';
  cap.bottom = f.caption.bottom != null ? f.caption.bottom + 'px' : 'auto';
  lab.left = f.label.x + 'px'; lab.top = f.label.y + 'px';
  lab.transform = f.label.onLeft ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
  lab.textAlign = f.label.onLeft ? 'right' : 'left';
}

// ---------- drawing the core (everything is batched into few strokes, rings are cached paths) ----------
const pathCache = {};
function tickPath(r, n, long, short, every) {
  const key = [r.toFixed(1), n, long, short, every].join();
  if (pathCache[key]) return pathCache[key];
  const p = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.2832, r1 = r + (i % every === 0 ? long : short), ca = Math.cos(a), sa = Math.sin(a);
    p.moveTo(ca * r, sa * r); p.lineTo(ca * r1, sa * r1);
  }
  const keys = Object.keys(pathCache); if (keys.length > 40) delete pathCache[keys[0]];
  return (pathCache[key] = p);
}
const RING_TEXT = 'J.A.R.V.I.S.  ·  AI CORE  ·  ';

function drawCore(R, t, dt, st, lv, c, alpha, cm, speed) {
  const g = ctx, sc = canvasSc, mid = canvasSide / 2;
  g.setTransform(sc, 0, 0, sc, 0, 0);
  g.clearRect(0, 0, canvasSide, canvasSide);
  g.save(); g.translate(mid, mid);
  const q = QUALITY, pulse = 1 + 0.06 * Math.sin(t * 2) + lv * 0.25;

  // glow
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 3.2 * pulse);
  gr.addColorStop(0, rgba(c, 0.28 * alpha)); gr.addColorStop(0.4, rgba(c, 0.09 * alpha)); gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 3.2 * pulse, 0, 7); g.fill();

  // outer instrument rings: coarse ticks, fine ticks (counter-rotating), dashed guide
  g.lineWidth = 1;
  g.save(); g.rotate(-t * 0.1); g.strokeStyle = rgba(c, 0.38 * alpha); g.stroke(tickPath(R * 2.55, 60, 9, 4, 5)); g.restore();
  if (q > 0) { g.save(); g.rotate(t * 0.05); g.strokeStyle = rgba(c, 0.22 * alpha); g.stroke(tickPath(R * 2.4, 180, 4, 2, 15)); g.restore(); }
  g.setLineDash([3, 7]); g.lineDashOffset = -t * 6; g.strokeStyle = rgba(c, 0.3 * alpha);
  g.beginPath(); g.arc(0, 0, R * 2.22, 0, 6.2832); g.stroke(); g.setLineDash([]);

  // curved name ring
  if (q > 0 && cm < 0.6) {
    const fs = Math.max(8, R * 0.2), rr = R * 2.8, n = RING_TEXT.length, step = 6.2832 / n;
    g.font = `${fs}px Consolas, monospace`; g.textAlign = 'center'; g.fillStyle = rgba(c, 0.6 * alpha * (1 - cm));
    g.save(); g.rotate(t * 0.04);
    for (let i = 0; i < n; i++) { const ch = RING_TEXT[i]; if (ch === ' ') { g.rotate(step); continue; } g.save(); g.translate(0, -rr); g.fillText(ch, 0, 0); g.restore(); g.rotate(step); }
    g.restore();
  }

  // cardinal pointers
  g.fillStyle = rgba(c, 0.8 * alpha);
  for (let i = 0; i < 4; i++) { g.save(); g.rotate((i * Math.PI) / 2); g.beginPath(); g.moveTo(0, -R * 2.72); g.lineTo(-R * 0.07, -R * 2.86); g.lineTo(R * 0.07, -R * 2.86); g.closePath(); g.fill(); g.restore(); }

  // radial audio bars (one path)
  let sum = 0;
  for (let i = 0; i < NBARS; i++) {
    const wob = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + t * 6) * Math.cos(i * 0.6 - t * 3));
    const want = (st === 'listening' || st === 'speaking') ? lv * wob : 0.04 + 0.03 * Math.sin(t * 2 + i);
    bars[i] += (want - bars[i]) * 0.4; sum += bars[i];
  }
  g.strokeStyle = rgba(c, Math.min(1, 0.4 + (sum / NBARS) * 2.4) * alpha); g.lineWidth = 2.2 - 0.9 * cm; g.lineCap = 'round'; g.beginPath();
  g.save(); g.rotate(t * 0.08 * speed);
  for (let i = 0; i < NBARS; i++) {
    const a = (i / NBARS) * 6.2832, r0 = R * 1.55, r1 = r0 + 6 + bars[i] * R * 1.1, ca = Math.cos(a), sa = Math.sin(a);
    g.moveTo(ca * r0, sa * r0); g.lineTo(ca * r1, sa * r1);
  }
  g.stroke(); g.restore(); g.lineCap = 'butt';

  // live system gauges as thin arcs inside the bars: CPU / GPU / MEM
  const sT = S.stats;
  if (sT && q > 0) {
    const arcs = [['CPU', sT.cpu, 1.44], ['MEM', sT.mem, 1.36]];
    g.lineWidth = 2;
    arcs.forEach(([name, v, k], idx) => {
      const base = -Math.PI / 2 + idx * Math.PI + 0.12, span = Math.PI - 0.24;
      g.strokeStyle = rgba(c, 0.16 * alpha); g.beginPath(); g.arc(0, 0, R * k, base, base + span); g.stroke();
      if (v != null) { g.strokeStyle = v > 90 ? `rgba(255,90,90,${alpha})` : rgba(c, 0.95 * alpha); g.beginPath(); g.arc(0, 0, R * k, base, base + span * Math.min(1, v / 100)); g.stroke(); }
    });
  }

  // arc-reactor rings
  g.lineWidth = 2;
  for (const [rr, segs, frac, dir] of [[R * 1.25, 3, 0.7, 1], [R * 1.05, 5, 0.55, -1.4], [R * 0.9, 2, 0.8, 2.1]]) {
    const base = t * speed * dir, span = (6.2832 / segs) * frac * 0.8;
    g.strokeStyle = rgba(c, 0.85 * alpha); g.beginPath();
    for (let s = 0; s < segs; s++) { const a0 = base + (s / segs) * 6.2832; g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr); g.arc(0, 0, rr, a0, a0 + span); }
    g.stroke();
  }

  // hexagon frame + radar sweep around the brain
  g.save(); g.rotate(t * 0.12); g.strokeStyle = rgba(c, 0.45 * alpha); g.lineWidth = 1; g.beginPath();
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * 6.2832, x = Math.cos(a) * R * 0.98, y = Math.sin(a) * R * 0.98; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke(); g.restore();
  if (q > 0 && g.createConicGradient) {
    const sw = g.createConicGradient(t * (st === 'thinking' ? 4 : 1.1), 0, 0);
    sw.addColorStop(0, rgba(c, 0)); sw.addColorStop(0.9, rgba(c, 0)); sw.addColorStop(1, rgba(c, 0.32 * alpha));
    g.fillStyle = sw; g.beginPath(); g.arc(0, 0, R * 0.9, 0, 6.2832); g.fill();
  }

  // hold-to-talk: expanding rings
  if (S.hold > 0.02) {
    for (let i = 0; i < 2; i++) {
      const ph = (t * 1.1 + i * 0.5) % 1;
      g.strokeStyle = rgba(c, 0.8 * (1 - ph) * S.hold); g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, R * (1.7 + ph * 1.1), 0, 7); g.stroke();
    }
  }

  // the digital brain at the heart of it
  gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.85);
  gr.addColorStop(0, rgba(c, 0.30 * alpha + lv * 0.2)); gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.85, 0, 7); g.fill();
  brain.update(dt, st, lv);
  brain.draw(g, 0, 0, R, t, c, Math.min(1, alpha + 0.25));

  // thinking: orbiting dots
  if (st === 'thinking') {
    g.fillStyle = rgba(c, 0.95);
    for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.094; g.beginPath(); g.arc(Math.cos(a) * R * 2.0, Math.sin(a) * R * 2.0, 4 - cm * 1.5, 0, 7); g.fill(); }
  }
  g.restore();
}

let lastDraw = 0, lastPerf = 0, lastSpec = 0;
function frame(ms) {
  const hidden = $('hud').classList.contains('hidden');
  const quiet = S.state === 'idle' && !S.followup && !pttActive;
  const fps = hidden ? 2 : (quiet ? FPS_IDLE[QUALITY] : FPS_ACTIVE[QUALITY]);
  if (ms - lastDraw < 1000 / fps - 3) { requestAnimationFrame(frame); return; }
  lastDraw = ms;
  if (hidden) { requestAnimationFrame(frame); return; }
  const t = ms / 1000, dt = Math.min(0.1, t - S.t); S.t = t; frameNo++;

  const st = eff();
  const tc = COLORS[st] || COLORS.idle;
  for (let i = 0; i < 3; i++) S.color[i] += (tc[i] - S.color[i]) * 0.08;
  document.documentElement.style.setProperty('--c', S.color.map(Math.round).join(','));
  const active = (st === 'idle' && !S.followup) || st === 'loading' ? 0 : 1;
  S.prom += (active - S.prom) * 0.06;
  S.hold += ((pttActive ? 1 : 0) - S.hold) * 0.15;
  S.target *= 0.9;
  S.level += (S.target - S.level) * 0.35;
  const lv = S.level, c = S.color;

  // Core: bottom-right of the main screen. A window open on the screen the core is on shrinks it; a dragged position overrides the spot.
  const k = S.prom * S.prom * (3 - 2 * S.prom);
  const o0 = Layout.orb(W, H, 0, k, null);
  let cx = o0.x + HX, cy = o0.y + HY;
  if (S.pin) {
    const mg = Math.min(o0.R * 2, CW / 2, CH / 2);
    cx = Layout.clamp(S.pin.x * CW, mg, CW - mg); cy = Layout.clamp(S.pin.y * CH, mg, CH - mg);
  }
  S.compact += ((busyAt(cx, cy) ? 1 : 0) - S.compact) * 0.12;
  const cm = S.compact * S.compact * (3 - 2 * S.compact);
  const R = (o0.R + (22 + 8 * k - o0.R) * cm) * uiScale('orb');
  orbNow.x = cx; orbNow.y = cy; orbNow.R = R;
  cv.style.left = (cx - canvasSide / 2) + 'px'; cv.style.top = (cy - canvasSide / 2) + 'px';
  placeFollowers(cx, cy, R);

  const speed = st === 'thinking' ? 3.2 : st === 'listening' ? 1.2 : 0.55;
  const alpha = 0.6 + 0.4 * Math.max(k, st === 'loading' ? 0.6 : 0);
  drawCore(R, t, dt, st, lv, c, alpha, cm, speed);

  // panels: redrawn on their own slower clock, and only while visible
  const perfOn = !$('perf').classList.contains('covered'), playOn = !$('player').classList.contains('covered');
  if (perfOn && ms - lastPerf > PERF_MS[QUALITY]) { lastPerf = ms; Perf.draw($('perfc'), c, renderScale(), t); }
  if (playOn) {
    const playing = !!(S.sp && S.sp.playing);
    if (ms - lastSpec > (playing ? [100, 66, 40][QUALITY] : 1000)) {
      lastSpec = ms; updateSpectrum(t);
      Viz.radial($('pl-rad'), S.specShown, c, t, playing, renderScale());
      Viz.bars($('pl-spec'), S.specShown, c, t, renderScale());
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- terminal panel (mirrors the console window; appears when something goes wrong) ----------
let termTimer;
function showTerm(ms = 12000) {
  const el = $('term'); el.classList.add('show'); clearTimeout(termTimer);
  termTimer = setTimeout(() => { if (document.activeElement !== $('tin')) el.classList.remove('show'); }, ms);
}
function termLine(text, err, quiet) {
  const box = $('tlines');
  if (box.lastChild && box.lastChild.textContent === text) return;   // the same message printed and sent twice
  const d = document.createElement('div');
  d.textContent = text;
  const bad = /traceback|error|exception|failed|fatal|denied|refused|invalid|unavailable|\b[45]\d\d\b/i.test(text);
  if (bad) d.className = 'err';
  else if (err || /warn|deprecat|retry|stopped/i.test(text)) d.className = 'warn';
  box.appendChild(d);
  while (box.children.length > 60) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  const n = box.querySelectorAll('.err').length, cnt = $('tcnt');
  cnt.textContent = n ? n + (n === 1 ? ' ERROR' : ' ERRORS') : 'ALL CLEAR';
  cnt.classList.toggle('bad', n > 0);
  if (!quiet && bad) showTerm();
}
$('tcnt').textContent = 'ALL CLEAR';

// ---------- command box: type to Jarvis when the microphone isn't an option ----------
const tin = $('tin');
function openInput() { window.jarvis.focusInput(); showTerm(60000); setTimeout(() => tin.focus(), 90); }
tin.addEventListener('mousedown', (e) => { if (document.activeElement !== tin) { e.preventDefault(); openInput(); } });
tin.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && tin.value.trim()) { send({ type: 'text', text: tin.value.trim() }); tin.value = ''; tin.blur(); }
  else if (e.key === 'Escape') tin.blur();
});
tin.addEventListener('blur', () => { window.jarvis.blurInput(); setInteractive(false); showTerm(4000); });
window.jarvis.onFocusInput && window.jarvis.onFocusInput(() => { $('hud').classList.remove('hidden'); showTerm(60000); setTimeout(() => tin.focus(), 90); });

// ---------- movable / scalable panels (right-drag to move, right-hold + scroll to resize) ----------
const MOVABLE = ['perf', 'player', 'term'];
let UI = {};
try { UI = JSON.parse(localStorage.getItem('jarvis.ui')) || {}; } catch (e) { UI = {}; }
const saveUI = () => { try { localStorage.setItem('jarvis.ui', JSON.stringify(UI)); } catch (e) { /* fine */ } };
function uiScale(id) { return (UI[id] && UI[id].s) || 1; }
function applyUI(id) {
  const el = $(id), u = UI[id];
  if (!el) return;
  el.style.translate = u ? `${u.dx || 0}px ${u.dy || 0}px` : '';
  el.style.scale = u && u.s ? String(u.s) : '';
}
MOVABLE.forEach(applyUI);
// Keep every item at least partly on the overlay, so one dragged off the edge can always be grabbed again.
function keepOnScreen(id) {
  const u = UI[id];
  const el = $(id);
  if (!u || !el || id === 'orb') return;
  const r = el.getBoundingClientRect(), m = 70;
  if (r.width === 0) return;
  if (r.left > CW - m) u.dx -= r.left - (CW - m);
  if (r.right < m) u.dx += m - r.right;
  if (r.top > CH - m) u.dy -= r.top - (CH - m);
  if (r.bottom < m) u.dy += m - r.bottom;
  applyUI(id);
}
function resetUI(id) { delete UI[id]; applyUI(id); saveUI(); if (id === 'orb') sizeCoreCanvas(); }
function resetAllUI() { UI = {}; MOVABLE.forEach(applyUI); saveUI(); setPin(null); sizeCoreCanvas(); }
let locked = false;
try { locked = localStorage.getItem('jarvis.lock') === '1'; } catch (e) { /* fine */ }
window.jarvis.onLock && window.jarvis.onLock(() => {
  locked = !locked;
  try { localStorage.setItem('jarvis.lock', locked ? '1' : '0'); } catch (e) { /* fine */ }
});
let rmb = false, pdrag = null;
function hitTarget(e) {
  if (overOrb(e.clientX, e.clientY)) return 'orb';
  const p = e.target.closest && e.target.closest('.panel');
  if (p && p.id && !p.classList.contains('covered') && (p.id !== 'term' || p.classList.contains('show'))) return p.id;
  return null;
}
const applyAny = (id) => (id === 'orb' ? (sizeCoreCanvas(), saveUI()) : applyUI(id));

// ---------- mouse: hold-to-talk, drag to move ----------
const interactive = { on: false };
function setInteractive(on) { if (interactive.on !== on) { interactive.on = on; window.jarvis.setInteractive(on); } }
const overOrb = (x, y) => Math.hypot(x - orbNow.x, y - orbNow.y) < orbNow.R * 1.9;
let dragging = null;

document.addEventListener('mousemove', (e) => {
  if (pdrag) {
    const u = (UI[pdrag.id] = UI[pdrag.id] || {});
    u.dx = Math.max(-CW, Math.min(CW, pdrag.u0.dx + e.clientX - pdrag.x0));
    u.dy = Math.max(-CH, Math.min(CH, pdrag.u0.dy + e.clientY - pdrag.y0));
    applyUI(pdrag.id); keepOnScreen(pdrag.id);
    return;
  }
  if (dragging) { setPin({ x: (e.clientX - dragging.dx) / CW, y: (e.clientY - dragging.dy) / CH }); return; }
  const on = overOrb(e.clientX, e.clientY);
  const tgt = on || locked ? null : hitTarget(e);
  setInteractive(on || pttActive || !!tgt || !!(e.target.closest && e.target.closest('.interactive')));
  document.body.style.cursor = on ? 'pointer' : '';
  $('corner').classList.toggle('hover', on);
});
document.addEventListener('mouseleave', () => { if (!dragging && !pdrag && !pttActive) setInteractive(false); });
document.addEventListener('mousedown', (e) => {
  if (e.button === 2) rmb = true;
  const orb = overOrb(e.clientX, e.clientY);
  const tgt = orb ? 'orb' : (locked ? null : hitTarget(e));
  if (!tgt) return;
  if (tgt !== 'orb' && e.button === 0) return;
  e.preventDefault();
  if (e.button === 0) {                       // hold to talk (also cuts Jarvis off mid-sentence)
    pttActive = true; refreshLabel(); send({ type: 'ptt_down' });
  } else if (e.button === 2) {                // right-drag to move (scroll while held to resize)
    if (tgt === 'orb') dragging = { dx: e.clientX - orbNow.x, dy: e.clientY - orbNow.y };
    else {
      const u = UI[tgt] || {};
      pdrag = { id: tgt, x0: e.clientX, y0: e.clientY, u0: { dx: u.dx || 0, dy: u.dy || 0 } };
      $(tgt).classList.add('grab');
    }
    document.body.style.cursor = 'grabbing';
    setInteractive(true);
  } else if (e.button === 1) {                // middle-click: back to the default spot and size
    if (tgt === 'orb') { setPin(null); resetUI('orb'); } else resetUI(tgt);
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0 && pttActive) { pttActive = false; refreshLabel(); send({ type: 'ptt_up' }); }
  if (e.button === 2) {
    rmb = false;
    if (dragging) dragging = null;
    if (pdrag) { $(pdrag.id).classList.remove('grab'); pdrag = null; saveUI(); }
    document.body.style.cursor = '';
  }
});
document.addEventListener('wheel', (e) => {
  if (!rmb) return;
  const id = pdrag ? pdrag.id : dragging ? 'orb' : hitTarget(e);
  if (!id) return;
  e.preventDefault();
  const u = (UI[id] = UI[id] || {});
  u.s = Math.max(0.4, Math.min(2.6, (u.s || 1) * Math.exp(-e.deltaY * 0.0016)));
  applyAny(id);
}, { passive: false });
addEventListener('contextmenu', (e) => e.preventDefault());

resize();
refreshLabel();
connect();
