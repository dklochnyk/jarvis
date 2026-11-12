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
    case 'spotify': S.sp = { playing: !!m.playing }; break;
    case 'spectrum': S.spec = m.bands || S.spec; S.specAt = Date.now(); break;
    case 'tool': S.exec = true; break;
    case 'tool_result': S.exec = false; S.planned = true; break;
    case 'error': termLine('ERROR: ' + m.text, true); break;
    case 'term': termLine(m.text, m.err); break;
    case 'termbuf': $('tlines').replaceChildren(); (m.lines || []).forEach((l) => termLine(l.text, l.err, true)); break;
    case 'desktop': S.legacyWins = m.windows || []; S.rects = m.rects || null; recomputeBusy(); updateCovered(); break;
        case 'stats': S.stats = m; break;
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

// does an open window cover (part of) a circle at this overlay position? (windows arrive as physical screen pixels)
function coreBlocked(cx, cy, rad) {
  if (!S.rects || !S.phys || !S.phys.win || !S.phys.win.w) return busyAt(cx, cy);
  const w = S.phys.win, sx = CW / w.w, sy = CH / w.h;
  for (const [l, t, r, b] of S.rects) {
    if (r - l < 120 || b - t < 80) continue;
    const x0 = (l - w.x) * sx, y0 = (t - w.y) * sy, x1 = (r - w.x) * sx, y1 = (b - w.y) * sy;
    const nx = Math.max(x0, Math.min(cx, x1)), ny = Math.max(y0, Math.min(cy, y1));
    if ((nx - cx) ** 2 + (ny - cy) ** 2 < rad * rad) return true;
  }
  return false;
}
function updateCovered() {
  $('corner').classList.toggle('covered', S.compact > 0.5 && eff() === 'idle' && !S.followup);   // small and quiet: no label
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
const FPS_IDLE = [6, 10, 15], FPS_ACTIVE = [15, 24, 36];
function renderScale() {
  const dpr = window.devicePixelRatio || 1;
  return QUALITY === 0 ? Math.min(dpr, 1) * 0.75 : QUALITY === 1 ? Math.min(dpr, 1.25) : Math.min(dpr, 1.75);
}
let canvasSide = 0, canvasSc = 0;
function sizeCoreCanvas() {
  const side = Math.ceil(84 * 7 * uiScale('orb')), sc = renderScale();
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

const NBARS = 144;
const bars = new Float32Array(NBARS);
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const brain = new BrainViz.Brain(7);
const orbNow = { x: 0, y: 0, R: 40 };
let frameNo = 0;

const fmtRate = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + 'M' : Math.round(kb) + 'K');

// the PC's audio spectrum: real (loopback capture from the backend) or simulated while Spotify is playing
function updateSpectrum(t) {
  const live = Date.now() - S.specAt < 2500, playing = !!(S.sp && S.sp.playing);
  const beat = Math.pow(Math.max(0, Math.sin(t * 3.9)), 3);
  for (let i = 0; i < 40; i++) {
    let want;
    if (live) want = (S.spec[i] || 0) / 100;
    else if (playing) want = 0.55 * Math.exp(-i / 24) * (0.3 + 0.7 * Math.abs(Math.sin(t * (1.6 + i * 0.17) + i * 1.3))) * (0.55 + 0.6 * beat);
    else want = 0;
    S.specShown[i] += (want - S.specShown[i]) * (want > S.specShown[i] ? 0.5 : 0.16);
  }
}

function placeFollowers(cx, cy, R, scr) {   // window coordinates; scr = the screen the core is on
  const f = Layout.followers(cx, cy, R, CW, CH);
  if (scr) { f.label.onLeft = cx + R * 3.3 + 160 > scr.x + scr.w; f.label.x = f.label.onLeft ? cx - R * 3.3 - 10 : cx + R * 3.3 + 10; }
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

// cached shapes for the extra detail
function hexRing(r, n, size) {
  const key = 'hex' + r.toFixed(1) + n + size.toFixed(1);
  if (pathCache[key]) return pathCache[key];
  const p = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.2832, cx = Math.cos(a) * r, cy = Math.sin(a) * r;
    for (let k = 0; k <= 6; k++) { const b = a + (k / 6) * 6.2832, x = cx + Math.cos(b) * size, y = cy + Math.sin(b) * size; k ? p.lineTo(x, y) : p.moveTo(x, y); }
  }
  return (pathCache[key] = p);
}
function circuitPath(R) {
  const key = 'ckt' + R.toFixed(1);
  if (pathCache[key]) return pathCache[key];
  const p = new Path2D();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * 6.2832, ca = Math.cos(a), sa = Math.sin(a), r0 = R * 0.62, r1 = R * (0.72 + (i % 3) * 0.05), r2 = R * 0.9, j = (i % 2 ? 1 : -1) * 0.09;
    p.moveTo(ca * r0, sa * r0); p.lineTo(ca * r1, sa * r1);
    const b = a + j; p.lineTo(Math.cos(b) * r1, Math.sin(b) * r1); p.lineTo(Math.cos(b) * r2, Math.sin(b) * r2);
    p.moveTo(Math.cos(b) * r2 + 2, Math.sin(b) * r2); p.arc(Math.cos(b) * r2, Math.sin(b) * r2, 2, 0, 6.2832);
  }
  return (pathCache[key] = p);
}
const GOLD = [255, 190, 80], VIOLET = [190, 125, 255], ROSE = [255, 105, 170];   // accent colours: recoloured every frame so they cycle through the whole spectrum
function hsl(h, s, l, out) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  out[0] = f(0); out[1] = f(8); out[2] = f(4);
}
function hueOf(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (!d) return 190;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
const RING_TEXT = 'J.A.R.V.I.S.  ·  AI CORE  ·  ';

// ---- palette: mostly the state colour (cyan), with a warm orange accent like the reference art ----
function cycleAccents(t, c) {
  const hb = hueOf(c);
  hsl(28 + 10 * Math.sin(t * 0.3), 1, 0.58, GOLD);               // orange, drifting a little
  hsl(hb + 22 * Math.sin(t * 0.45), 0.95, 0.74, VIOLET);          // lighter tints of the main colour
  hsl(hb - 22 * Math.sin(t * 0.35 + 1), 0.9, 0.82, ROSE);
}

const TAU = 6.2832;
// thick broken arcs: [radius, segments, fill fraction, lineWidth]; drawn as one path each
function brokenArcs(g, r, segs, frac, rot) {
  const step = TAU / segs, span = step * frac;
  g.beginPath();
  for (let s = 0; s < segs; s++) { const a0 = rot + s * step; g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r); g.arc(0, 0, r, a0, a0 + span); }
  g.stroke();
}
// a little hexagon cluster like the one in the corner of the reference
function hexCluster(g, x, y, s, fillCol) {
  const cells = [[0, 0], [1.75, 0], [0.875, 1.5], [-0.875, 1.5], [0.875, -1.5], [-0.875, -1.5], [-1.75, 0]];
  g.beginPath();
  cells.forEach(([cx, cy]) => { for (let k = 0; k <= 6; k++) { const a = (k / 6) * TAU, px = x + (cx + Math.cos(a)) * s, py = y + (cy + Math.sin(a)) * s; k ? g.lineTo(px, py) : g.moveTo(px, py); } });
  g.stroke();
  g.fillStyle = fillCol; g.beginPath(); for (let k = 0; k <= 6; k++) { const a = (k / 6) * TAU, px = x + Math.cos(a) * s, py = y + Math.sin(a) * s; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.fill();
}

function drawCore(R, t, dt, st, lv, c, alpha, cm, speed) {
  cycleAccents(t, c);
  const g = ctx, sc = canvasSc, mid = canvasSide / 2, q = QUALITY;
  g.setTransform(sc, 0, 0, sc, 0, 0);
  g.clearRect(0, 0, canvasSide, canvasSide);
  g.save(); g.translate(mid, mid);
  const speech = st === 'listening' || st === 'speaking' || pttActive;
  let en = 0; for (let i = 0; i < 40; i++) en += S.specShown[i];
  const music = !speech && en > 0.6;
  const bass = (S.specShown[0] + S.specShown[1] + S.specShown[2]) / 3;
  const pulse = 1 + 0.05 * Math.sin(t * 2) + lv * 0.2;
  const rig = 1 - 0.92 * cm;                       // the technical layer fades when the core is small

  // glow
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 3.1 * pulse);
  gr.addColorStop(0, rgba(c, 0.4 * alpha)); gr.addColorStop(0.45, rgba(c, 0.13 * alpha)); gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 3.1 * pulse, 0, 7); g.fill();

  // ======== technical layer (outer): crosshairs, arrows, fragments, scales ========
  g.globalAlpha = rig;
  g.lineCap = 'butt'; g.lineWidth = 1;
  // crosshair lines with a gap around the core
  g.strokeStyle = rgba(c, 0.4 * alpha); g.beginPath();
  for (let i = 0; i < 4; i++) { const ca = Math.cos(i * 1.5708), sa = Math.sin(i * 1.5708); g.moveTo(ca * R * 2.05, sa * R * 2.05); g.lineTo(ca * R * 3.0, sa * R * 3.0); }
  g.stroke();
  // two long diagonal lines with arrowheads, drifting slowly
  g.save(); g.rotate(0.65 + Math.sin(t * 0.1) * 0.12); g.strokeStyle = rgba(c, 0.55 * alpha); g.fillStyle = rgba(c, 0.8 * alpha); g.beginPath();
  g.moveTo(-R * 2.9, 0); g.lineTo(-R * 1.3, 0); g.moveTo(R * 1.3, 0); g.lineTo(R * 2.9, 0); g.stroke();
  g.beginPath(); g.moveTo(R * 2.95, 0); g.lineTo(R * 2.75, -R * 0.07); g.lineTo(R * 2.75, R * 0.07); g.closePath(); g.fill(); g.restore();
  g.save(); g.rotate(-0.95 + Math.sin(t * 0.13) * 0.1); g.strokeStyle = rgba(c, 0.4 * alpha); g.beginPath();
  g.moveTo(-R * 2.6, 0); g.lineTo(-R * 1.6, 0); g.moveTo(R * 1.6, 0); g.lineTo(R * 2.6, 0); g.stroke(); g.restore();
  // scales: fine ticks with long marks
  g.save(); g.rotate(-t * 0.03); g.strokeStyle = rgba(c, 0.55 * alpha); g.stroke(tickPath(R * 2.9, 120, 9, 4, 10)); g.restore();
  g.save(); g.rotate(t * 0.02); g.strokeStyle = rgba(c, 0.3 * alpha); g.stroke(tickPath(R * 2.2, 240, 3, 1.5, 20)); g.restore();
  // scattered fragment arcs (thin, uneven), like the loose technical linework
  g.lineWidth = 1.2; g.strokeStyle = rgba(c, 0.6 * alpha); g.beginPath();
  [[2.78, 0.3, 0.5], [2.78, 2.1, 0.22], [2.5, 3.6, 0.7], [2.62, 5.2, 0.35], [2.3, 1.1, 0.25], [2.4, 4.4, 0.18]].forEach(([k, a0, sp], i) => {
    const a = a0 + t * (i % 2 ? 0.05 : -0.04); g.moveTo(Math.cos(a) * R * k, Math.sin(a) * R * k); g.arc(0, 0, R * k, a, a + sp);
  });
  g.stroke();
  // thin outer rim with glow
  g.shadowColor = rgba(c, 1); g.shadowBlur = 12; g.lineWidth = 2.2; g.strokeStyle = rgba(c, 0.95 * alpha);
  g.beginPath(); g.arc(0, 0, R * 3.05, 0, TAU); g.stroke(); g.shadowBlur = 0;

  // ======== thick segmented rings ========
  g.shadowColor = rgba(c, 0.9); g.shadowBlur = 10;
  g.lineWidth = 9; g.strokeStyle = rgba(c, 0.92 * alpha);
  g.save(); g.rotate(t * 0.06 * speed + 0.4); brokenArcs(g, R * 2.62, 3, 0.62, 0); g.restore();
  g.lineWidth = 3.2; g.strokeStyle = rgba(VIOLET, 0.95 * alpha);
  g.save(); g.rotate(-t * 0.11 * speed); brokenArcs(g, R * 2.4, 7, 0.45, 0); g.restore();
  g.lineWidth = 5.5; g.strokeStyle = rgba(c, alpha);
  g.save(); g.rotate(t * 0.14 * speed + 2); brokenArcs(g, R * 2.06, 2, 0.4, 0); g.restore();
  g.shadowBlur = 0;
  g.lineWidth = 1.4; g.strokeStyle = rgba(c, 0.55 * alpha); g.setLineDash([2, 6]); g.lineDashOffset = -t * 8;
  g.beginPath(); g.arc(0, 0, R * 2.22, 0, TAU); g.stroke(); g.setLineDash([]);
  // hexagon cluster
  if (cm < 0.7) { g.lineWidth = 1.4; g.strokeStyle = rgba(c, 0.9 * alpha); hexCluster(g, R * 2.5, R * 0.8, R * 0.07, rgba(GOLD, alpha)); }
  g.globalAlpha = 1;

  // ======== the sunburst ring: dense radial lines; reacts to voice, and to the PC's sound when not listening ========
  let sum = 0;
  for (let i = 0; i < NBARS; i++) {
    const wob = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + t * 6) * Math.cos(i * 0.6 - t * 3));
    const f = i / NBARS, k = Math.min(39, Math.floor((f < 0.5 ? f * 2 : (1 - f) * 2) * 39));
    const want = speech ? lv * wob : music ? Math.min(0.85, S.specShown[k] * 1.5) : 0.04 + 0.03 * Math.sin(t * 2 + i);
    bars[i] += (want - bars[i]) * (music ? 0.55 : 0.4); sum += bars[i];
  }
  g.lineCap = 'butt'; g.lineWidth = Math.max(1.2, 2.2 - 0.9 * cm); g.shadowColor = rgba(c, 0.9); g.shadowBlur = 8;
  g.strokeStyle = rgba(c, Math.min(1, 0.65 + (sum / NBARS) * 2) * alpha); g.beginPath();
  g.save(); g.rotate(music ? -1.5708 : t * 0.05 * speed);
  for (let i = 0; i < NBARS; i++) {
    const a = (i / NBARS) * TAU, r0 = R * 1.5, len = R * (0.07 + 0.06 * Math.abs(Math.sin(i * 2.3)) + bars[i] * (music ? 1.15 : 0.9)), ca = Math.cos(a), sa = Math.sin(a);
    g.moveTo(ca * r0, sa * r0); g.lineTo(ca * (r0 + len), sa * (r0 + len));
  }
  g.stroke();
  if (music) {   // the loud lines glow orange at their tips
    g.strokeStyle = rgba(GOLD, alpha); g.lineWidth = 2.6; g.beginPath();
    for (let i = 0; i < NBARS; i++) {
      if (bars[i] < 0.18) continue;
      const a = (i / NBARS) * TAU, r1 = R * (1.5 + 0.1 + bars[i] * 1.15), ca = Math.cos(a), sa = Math.sin(a);
      g.moveTo(ca * r1, sa * r1); g.lineTo(ca * (r1 + 5), sa * (r1 + 5));
    }
    g.stroke();
  }
  g.restore(); g.shadowBlur = 0;
  // a thin ring just inside the sunburst
  g.lineWidth = 1.2; g.strokeStyle = rgba(c, 0.7 * alpha); g.beginPath(); g.arc(0, 0, R * 1.46, 0, TAU); g.stroke();

  // live CPU / memory arcs on the inner side
  const sT = S.stats;
  if (sT && q > 0) {
    [['CPU', sT.cpu, 1.4, c], ['MEM', sT.mem, 1.33, VIOLET]].forEach(([name, v, k, col], idx) => {
      const base = -Math.PI / 2 + idx * Math.PI + 0.12, span = Math.PI - 0.24;
      g.lineWidth = 2.4; g.strokeStyle = rgba(col, 0.2 * alpha); g.beginPath(); g.arc(0, 0, R * k, base, base + span); g.stroke();
      if (v != null) { g.strokeStyle = v > 90 ? `rgba(255,90,90,${alpha})` : rgba(col, alpha); g.beginPath(); g.arc(0, 0, R * k, base, base + span * Math.min(1, v / 100)); g.stroke(); }
    });
  }

  // thick inner rings
  g.shadowColor = rgba(c, 0.9); g.shadowBlur = 10; g.lineWidth = 6; g.strokeStyle = rgba(c, alpha);
  g.save(); g.rotate(-t * 0.5 * speed); brokenArcs(g, R * 1.22, 3, 0.7, 0); g.restore();
  g.lineWidth = 2.4; g.strokeStyle = rgba(VIOLET, alpha);
  g.save(); g.rotate(t * 0.9 * speed); brokenArcs(g, R * 1.1, 6, 0.5, 0); g.restore();
  g.shadowBlur = 0;

  // ======== the iris: dark disc, radar sweep, hexagon, then the brain ========
  gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.02);
  gr.addColorStop(0, 'rgba(2,10,20,0.78)'); gr.addColorStop(0.8, 'rgba(3,14,26,0.62)'); gr.addColorStop(1, rgba(c, 0.18));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 1.02, 0, TAU); g.fill();
  g.lineWidth = 1.2; g.strokeStyle = rgba(c, 0.8 * alpha); g.beginPath(); g.arc(0, 0, R * 0.98, 0, TAU); g.stroke();
  g.strokeStyle = rgba(c, 0.35 * alpha); g.beginPath(); g.arc(0, 0, R * 0.7, 0, TAU); g.moveTo(R * 0.45, 0); g.arc(0, 0, R * 0.45, 0, TAU); g.stroke();
  if (q > 0 && g.createConicGradient) {
    const sw = g.createConicGradient(t * (st === 'thinking' ? 4 : 1.1), 0, 0);
    sw.addColorStop(0, rgba(c, 0)); sw.addColorStop(0.88, rgba(c, 0)); sw.addColorStop(1, rgba(c, 0.38 * alpha));
    g.fillStyle = sw; g.beginPath(); g.arc(0, 0, R * 0.96, 0, TAU); g.fill();
  }
  g.save(); g.rotate(t * 0.1); g.strokeStyle = rgba(VIOLET, 0.8 * alpha); g.lineWidth = 1.4; g.beginPath();
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU, x = Math.cos(a) * R * 0.82, y = Math.sin(a) * R * 0.82; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke(); g.restore();

  // hold-to-talk: expanding rings
  if (S.hold > 0.02) {
    for (let i = 0; i < 2; i++) {
      const ph = (t * 1.1 + i * 0.5) % 1;
      g.strokeStyle = rgba(c, 0.8 * (1 - ph) * S.hold); g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, R * (1.7 + ph * 1.1), 0, 7); g.stroke();
    }
  }

  // the digital brain
  brain.update(dt, st, lv);
  brain.draw(g, 0, 0, R * 0.92, t, c, Math.min(1, alpha + 0.25));

  // ======== three glowing orange nodes (they swell with voice level and music) ========
  {
    const nr = R * 1.22, spin = t * 0.28 * (0.6 + speed * 0.5), pw = 1 + Math.max(lv, bass * 0.6) * 1.2;
    const pts = [0, 1, 2].map((i) => [Math.cos(spin + i * 2.094) * nr, Math.sin(spin + i * 2.094) * nr]);
    g.strokeStyle = rgba(GOLD, 0.45 * alpha); g.lineWidth = 1; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
    pts.forEach(([x, y]) => {
      const hr = R * 0.34 * pw, hg = g.createRadialGradient(x, y, 0, x, y, hr);
      hg.addColorStop(0, rgba(GOLD, 0.95)); hg.addColorStop(0.35, rgba(GOLD, 0.45 * alpha)); hg.addColorStop(1, rgba(GOLD, 0));
      g.fillStyle = hg; g.beginPath(); g.arc(x, y, hr, 0, TAU); g.fill();
      g.fillStyle = '#fff3e0'; g.beginPath(); g.arc(x, y, R * 0.045, 0, TAU); g.fill();
    });
  }

  // thinking: orbiting dots
  if (st === 'thinking') {
    g.fillStyle = rgba(c, 0.95);
    for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.094; g.beginPath(); g.arc(Math.cos(a) * R * 1.95, Math.sin(a) * R * 1.95, 4 - cm * 1.5, 0, 7); g.fill(); }
  }

  // data chips on the rim (big, readable)
  if (cm < 0.6 && q > 0) {
    const sT2 = S.stats, d = new Date(), pad = (n) => String(n).padStart(2, '0'), h12 = d.getHours() % 12 || 12;
    const chips = [[-2.356, 'CPU ' + (sT2 ? Math.round(sT2.cpu) + '%' : '--')], [-0.785, 'MEM ' + (sT2 ? Math.round(sT2.mem) + '%' : '--')],
      [2.356, 'NET ' + (sT2 ? fmtRate(sT2.net_down || 0) : '--')], [0.785, h12 + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + (d.getHours() < 12 ? ' AM' : ' PM')]];
    g.font = `bold ${Math.max(11, R * 0.21)}px Consolas, monospace`; g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 5;
    g.fillStyle = rgba(ROSE, (1 - cm) * alpha);
    for (const [a, s] of chips) g.fillText(s, Math.cos(a) * R * 2.45, Math.sin(a) * R * 2.45 + 4);
    g.shadowBlur = 0;
  }
  g.restore();
}

let lastDraw = 0;
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
  updateSpectrum(t);
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
  // go small, into the corner of its own screen, only when a window would actually cover the full-size core
  const fullR = o0.R * uiScale('orb') * 3;
  S.compact += ((coreBlocked(cx, cy, fullR) ? 1 : 0) - S.compact) * 0.1;
  const cm = S.compact * S.compact * (3 - 2 * S.compact);
  const sIdx = screenAt(cx, cy), sc0 = sIdx >= 0 ? S.screens[sIdx] : { x: HX, y: HY, w: W, h: H };
  const R = (o0.R + (32 + 10 * k - o0.R) * cm) * uiScale('orb');
  cx += (sc0.x + sc0.w - 95 - cx) * cm; cy += (sc0.y + sc0.h - 125 - cy) * cm;
  orbNow.x = cx; orbNow.y = cy; orbNow.R = R;
  cv.style.left = (cx - canvasSide / 2) + 'px'; cv.style.top = (cy - canvasSide / 2) + 'px';
  placeFollowers(cx, cy, R, sc0);

  const speed = st === 'thinking' ? 3.2 : st === 'listening' ? 1.2 : 0.55;
  const alpha = 0.88 + 0.12 * Math.max(k, st === 'loading' ? 0.6 : 0);
  drawCore(R, t, dt, st, lv, c, alpha, cm, speed);

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
const MOVABLE = ['term'];
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
