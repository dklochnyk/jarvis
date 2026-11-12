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

const S = { exec: false, planned: false,
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

const NBARS = 72;
const bars = new Float32Array(NBARS);
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const brain = new BrainViz.Brain(7);
const orbNow = { x: 0, y: 0, R: 40 };
let frameNo = 0;

const fmtRate = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + 'M' : Math.round(kb) + 'K');

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
const GOLD = [255, 190, 80], VIOLET = [190, 125, 255], ROSE = [255, 105, 170];
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

  g.globalAlpha = 1 - 0.92 * cm;   // the rigid instrument layer fades out when the core is small; the free-form waves stay
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
      if (v != null) { g.strokeStyle = v > 90 ? `rgba(255,90,90,${alpha})` : rgba(idx ? VIOLET : c, 0.95 * alpha); g.beginPath(); g.arc(0, 0, R * k, base, base + span * Math.min(1, v / 100)); g.stroke(); }
    });
  }

  // arc-reactor rings, each in its own colour
  g.lineWidth = 2.2;
  [[R * 1.25, 3, 0.7, 1, c], [R * 1.05, 5, 0.55, -1.4, GOLD], [R * 0.9, 2, 0.8, 2.1, VIOLET]].forEach(([rr, segs, frac, dir, col]) => {
    const base = t * speed * dir, span = (6.2832 / segs) * frac * 0.8;
    g.strokeStyle = rgba(col, 0.9 * alpha); g.beginPath();
    for (let s = 0; s < segs; s++) { const a0 = base + (s / segs) * 6.2832; g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr); g.arc(0, 0, rr, a0, a0 + span); }
    g.stroke();
  });

  // segmented power ring (gold) that fills with Jarvis' voice level / activity, plus a rose scale of fine dashes
  if (q > 0) {
    const SEG = 36, lit = Math.round(Math.min(1, 0.12 + lv * 1.4 + (st === 'thinking' ? 0.4 : 0)) * SEG), rr = R * 1.88, step = 6.2832 / SEG;
    g.lineWidth = 4; g.strokeStyle = rgba(GOLD, 0.14 * alpha); g.beginPath();
    for (let i = lit; i < SEG; i++) { const a0 = -1.5708 + i * step; g.moveTo(Math.cos(a0 + 0.03) * rr, Math.sin(a0 + 0.03) * rr); g.arc(0, 0, rr, a0 + 0.03, a0 + step - 0.03); }
    g.stroke();
    g.strokeStyle = rgba(GOLD, 0.9 * alpha); g.beginPath();
    for (let i = 0; i < lit; i++) { const a0 = -1.5708 + i * step; g.moveTo(Math.cos(a0 + 0.03) * rr, Math.sin(a0 + 0.03) * rr); g.arc(0, 0, rr, a0 + 0.03, a0 + step - 0.03); }
    g.stroke();
    g.save(); g.rotate(t * 0.15); g.strokeStyle = rgba(ROSE, 0.45 * alpha); g.lineWidth = 1; g.stroke(tickPath(R * 2.0, 90, 5, 2.5, 9)); g.restore();
    // satellite with a fading trail on the dashed guide
    const sa = t * 0.7;
    for (let i = 0; i < 8; i++) { g.fillStyle = rgba(VIOLET, (0.9 - i * 0.11) * alpha); g.beginPath(); g.arc(Math.cos(sa - i * 0.07) * R * 2.22, Math.sin(sa - i * 0.07) * R * 2.22, 3.2 - i * 0.28, 0, 7); g.fill(); }
    // degree labels at the four compass points
    if (cm < 0.6) {
      g.font = `${Math.max(7, R * 0.14)}px Consolas, monospace`; g.textAlign = 'center'; g.fillStyle = rgba(c, 0.55 * alpha * (1 - cm));
      [['000', 0, -2.3], ['090', 2.3, 0.05], ['180', 0, 2.38], ['270', -2.3, 0.05]].forEach(([s, kx, ky]) => g.fillText(s, kx * R, ky * R + 3));
    }
  }

  // hexagon frame + radar sweep around the brain
  g.save(); g.rotate(t * 0.12); g.strokeStyle = rgba(ROSE, 0.5 * alpha); g.lineWidth = 1.2; g.beginPath();
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

  // ---- extra detail: only when the core is big enough to show it ----
  if (cm < 0.7) {
    const fa = alpha * (1 - cm), TAU = 6.2832;
    // faint concentric guide circles
    g.lineWidth = 1; g.strokeStyle = rgba(c, 0.12 * fa); g.beginPath();
    for (const k of [1.15, 1.35, 1.7, 2.1, 2.95]) { g.moveTo(R * k, 0); g.arc(0, 0, R * k, 0, TAU); }
    g.stroke();
    // targeting brackets on the outer rim
    g.lineWidth = 2.2; g.strokeStyle = rgba(c, 0.75 * fa); g.beginPath();
    for (let i = 0; i < 4; i++) { const a0 = i * TAU / 4 + 0.785 - 0.2; g.moveTo(Math.cos(a0) * R * 2.95, Math.sin(a0) * R * 2.95); g.arc(0, 0, R * 2.95, a0, a0 + 0.4); }
    g.stroke();
    // ring of small hexagon cells (violet), turning slowly
    g.save(); g.rotate(-t * 0.07); g.strokeStyle = rgba(VIOLET, 0.5 * fa); g.lineWidth = 1; g.stroke(hexRing(R * 1.72, 24, R * 0.085)); g.restore();
    // scrolling data ring (gold hex stream) between the scales
    if (q > 0) {
      const n = 56, step = TAU / n, fs = Math.max(6, R * 0.11), seed = Math.floor(t * 2);
      g.font = `${fs}px Consolas, monospace`; g.textAlign = 'center'; g.fillStyle = rgba(GOLD, 0.55 * fa);
      g.save(); g.rotate(t * 0.09);
      for (let i = 0; i < n; i++) { g.save(); g.translate(0, -R * 2.3); g.fillText('0123456789ABCDEF'[((i * 7 + i * i + (i % 5 === 0 ? seed : 0)) & 15)], 0, 0); g.restore(); g.rotate(step); }
      g.restore();
    }
    // network of nodes: a rotating polygon with a bright node on each corner
    const nn = 7, na = t * 0.18, nr = R * 1.5;
    g.strokeStyle = rgba(ROSE, 0.3 * fa); g.lineWidth = 1; g.beginPath();
    for (let i = 0; i <= nn; i++) { const a = na + (i * 3 % nn) * TAU / nn; i ? g.lineTo(Math.cos(a) * nr, Math.sin(a) * nr) : g.moveTo(Math.cos(a) * nr, Math.sin(a) * nr); }
    g.stroke();
    g.fillStyle = rgba(ROSE, 0.95 * fa); g.beginPath();
    for (let i = 0; i < nn; i++) { const a = na + i * TAU / nn; g.moveTo(Math.cos(a) * nr + 2.6, Math.sin(a) * nr); g.arc(Math.cos(a) * nr, Math.sin(a) * nr, 2.6, 0, TAU); }
    g.fill();
    // circuit traces inside the hexagon (violet, drifting)
    g.save(); g.rotate(t * 0.03); g.strokeStyle = rgba(VIOLET, 0.28 * fa); g.lineWidth = 1; g.stroke(circuitPath(R)); g.restore();
    // radar blips: they flare as the sweep passes and then fade
    if (q > 0) {
      const sweep = (t * (st === 'thinking' ? 4 : 1.1)) % TAU;
      for (let i = 0; i < 7; i++) {
        const a = (i * 2.399) % TAU, d = (0.35 + ((i * 0.37) % 0.5)) * R, since = (sweep - a + TAU) % TAU, f = Math.max(0, 1 - since / 2.4);
        if (f <= 0.02) continue;
        g.fillStyle = rgba(GOLD, f * 0.9 * fa); g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 1.6 + f * 1.6, 0, TAU); g.fill();
      }
    }
    // slow ripple that leaves the core every few seconds
    const rp = (t / 3.2) % 1; g.strokeStyle = rgba(c, 0.35 * (1 - rp) * fa); g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, R * (1.2 + rp * 1.7), 0, TAU); g.stroke();
    // data chips around the rim
    if (q > 0) {
      const sT2 = S.stats, d = new Date(), pad = (n) => String(n).padStart(2, '0');
      const chips = [[-2.356, 'CPU ' + (sT2 ? Math.round(sT2.cpu) + '%' : '--')], [-0.785, 'MEM ' + (sT2 ? Math.round(sT2.mem) + '%' : '--')],
        [2.356, 'NET ' + (sT2 ? fmtRate(sT2.net_down || 0) : '--')], [0.785, pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())]];
      g.font = `${Math.max(7, R * 0.13)}px Consolas, monospace`; g.textAlign = 'center';
      for (const [a, s] of chips) {
        const x = Math.cos(a) * R * 2.62, y = Math.sin(a) * R * 2.62;
        g.fillStyle = rgba(GOLD, 0.85 * fa); g.fillText(s, x, y + 3);
      }
    }
  }

  g.globalAlpha = 1;
  // ---- free-form layer: drifting colour clouds, wavy rings that ride the voice, and flowing tendrils ----
  {
    const TAU = 6.2832, fw = 0.55 + 0.45 * cm;
    for (let i = 0; i < 3; i++) {
      const a = t * (0.25 + i * 0.08) + i * 2.1, bx = Math.cos(a) * R * 0.75, by = Math.sin(a * 1.2) * R * 0.75, col = [c, GOLD, VIOLET][i];
      const bg = g.createRadialGradient(bx, by, 0, bx, by, R * 1.5); bg.addColorStop(0, rgba(col, 0.2 * alpha)); bg.addColorStop(1, rgba(col, 0));
      g.fillStyle = bg; g.beginPath(); g.arc(bx, by, R * 1.5, 0, TAU); g.fill();
    }
    const P = q > 0 ? 120 : 64, amp = 1 + lv * 3.2;
    const rings = [[1.32, c, 0.7, 5, 0.9], [1.58, GOLD, 0.55, 7, -0.7], [1.86, VIOLET, 0.6, 4, 0.55], [2.12, ROSE, 0.5, 9, -0.45], [2.42, c, 0.4, 6, 0.3], [2.7, GOLD, 0.3, 11, -0.25]];
    g.lineWidth = 1.6; g.lineJoin = 'round';
    rings.forEach(([k, col, a, n, sp], ri) => {
      if (cm > 0.5 && ri > 3) return;
      g.strokeStyle = rgba(col, a * alpha * fw); g.beginPath();
      for (let i = 0; i <= P; i++) {
        const th = (i / P) * TAU, rr = R * k + R * 0.05 * amp * Math.sin(n * th + t * sp * 2.4) + R * 0.03 * amp * Math.sin((n + 3) * th - t * sp * 1.7 + ri);
        i ? g.lineTo(Math.cos(th) * rr, Math.sin(th) * rr) : g.moveTo(Math.cos(th) * rr, Math.sin(th) * rr);
      }
      g.stroke();
    });
    // tendrils drifting outward
    g.lineWidth = 1.2; g.strokeStyle = rgba(c, 0.3 * alpha * fw); g.beginPath();
    const nt = q > 0 ? 18 : 10;
    for (let i = 0; i < nt; i++) {
      const a = (i / nt) * TAU + t * 0.05, w = Math.sin(t * 1.3 + i * 1.7), r1 = R * 1.15, r2 = R * (1.7 + 0.1 * Math.sin(t + i)), r3 = R * (2.35 + lv * 0.7 + 0.12 * w);
      const px = (rr, off) => [Math.cos(a) * rr - Math.sin(a) * off, Math.sin(a) * rr + Math.cos(a) * off];
      const p0 = px(r1, 0), pm = px(r2, w * R * 0.3), p3 = px(r3, -w * R * 0.22);
      g.moveTo(p0[0], p0[1]); g.quadraticCurveTo(pm[0], pm[1], p3[0], p3[1]);
    }
    g.stroke();
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
  const alpha = 0.6 + 0.4 * Math.max(k, st === 'loading' ? 0.6 : 0);
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
