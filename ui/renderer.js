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

const S = { sp: null, spec: new Array(40).fill(0), specAt: 0, specShown: new Array(40).fill(0), procs: [], exec: false, planned: false, info: null, compact: 0, state: 'loading', followup: false, level: 0, target: 0, prom: 0, hold: 0,
            color: [...COLORS.loading], t: 0, pin: loadPin(), timers: [], wins: [], homeWins: [], legacyWins: [], rects: null, phys: null };
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
    case 'term': termLine(m.text, m.err); break;
    case 'termbuf': $('tlines').replaceChildren(); (m.lines || []).forEach((l) => termLine(l.text, l.err)); break;
    case 'desktop': S.legacyWins = m.windows || []; S.rects = m.rects || null; recomputeWins(); updateCovered(); break;
    case 'launcher': buildTiles(m.items || []); break;
    case 'spotify': S.sp = { ...m, at: Date.now() }; updatePlayer(true); break;
    case 'spectrum': S.spec = m.bands || S.spec; S.specAt = Date.now(); break;
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
const isCompactNow = () => S.homeWins.length > 0;
// Windows arrive as absolute screen pixels. Turn them into fractions of the overlay window (for hiding panels under them)
// and keep the ones that touch the home screen (they put the HUD in its small "window open" layout).
function recomputeWins() {
  const ph = S.phys;
  if (!S.rects || !ph) { S.wins = S.legacyWins || []; S.homeWins = S.wins; return; }
  const w = ph.win, hm = ph.home, wins = [], home = [];
  for (const [l, t, r, b] of S.rects) {
    const L = Math.max(l, w.x), T = Math.max(t, w.y), R = Math.min(r, w.x + w.w), B = Math.min(b, w.y + w.h);
    if (R - L < 40 || B - T < 40) continue;
    wins.push([(L - w.x) / w.w, (T - w.y) / w.h, (R - w.x) / w.w, (B - w.y) / w.h]);
    if (Math.min(r, hm.x + hm.w) - Math.max(l, hm.x) >= 120 && Math.min(b, hm.y + hm.h) - Math.max(t, hm.y) >= 80) home.push(wins[wins.length - 1]);
  }
  S.wins = wins; S.homeWins = home;
}
const PANELS = ['diag', 'log', 'timers', 'dock', 'clockbox', 'perf', 'radar', 'term'];
function updateCovered() {
  document.body.classList.toggle('compact', isCompactNow());
  for (const id of PANELS) {
    const el = $(id), r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    el.classList.toggle('covered', !(id === 'term' && document.activeElement === $('tin')) && Layout.covered({ l: r.left, t: r.top, r: r.right, b: r.bottom }, S.wins, innerWidth, innerHeight));
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
// The overlay window can span several monitors. CW/CH = whole window; the "home" screen (HX,HY,W,H) hosts the main stage.
let W, H, CW, CH, HX = 0, HY = 0, homeRect = null;
function applyHome() {
  const h = homeRect || { x: 0, y: 0, w: CW, h: CH };
  HX = h.x; HY = h.y; W = h.w; H = h.h;
  const st = $('stage').style;
  st.left = HX + 'px'; st.top = HY + 'px'; st.width = W + 'px'; st.height = H + 'px';
  Scenery.init(W, H);
}
// Visual quality: 0 low / 1 medium / 2 high. Sets the frame-rate cap and the drawing resolution (the big CPU/GPU costs).
let QUALITY = 1;
const FPS_CAP = [20, 30, 45];
function renderScale() {
  const dpr = window.devicePixelRatio || 1;
  return QUALITY === 0 ? Math.min(dpr, 1) * 0.7 : QUALITY === 1 ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
}
function resize() {
  const sc = renderScale();
  CW = innerWidth; CH = innerHeight;
  cv.width = Math.round(CW * sc); cv.height = Math.round(CH * sc);
  ctx.setTransform(sc, 0, 0, sc, 0, 0);
  applyHome();
}
window.jarvis.onQuality && window.jarvis.onQuality((_e, q) => { QUALITY = Math.max(0, Math.min(2, q | 0)); hero.detail = QUALITY; resize(); addLog('Visual quality: ' + ['low', 'medium', 'high'][QUALITY]); });
addEventListener('resize', resize); resize();
window.jarvis.onScreens && window.jarvis.onScreens((_e, m) => {
  S.phys = m.phys || null;
  homeRect = m.home || null;
  if (m.changed) { UI = {}; saveUI(); setPin(null); }
  resize(); MOVABLE.forEach(applyUI); MOVABLE.forEach(keepOnScreen); keepOnScreen('hero'); recomputeWins(); updateCovered();
});

const NBARS = 72;
const bars = new Array(NBARS).fill(0);
const rgba = (c, a) => `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const brain = new BrainViz.Brain(7);
const hero = new HeroViz.Hero(21); hero.detail = 1;
let brainAct = 0;
const orbNow = { x: 0, y: 0, R: 40 };
let frameNo = 0, lastFollow = null;

function heroPhase() { return phase() || (S.state === 'loading' ? 'loading' : S.state === 'error' ? 'error' : 'idle'); }

function drawEdgeDim(big) {   // soft shading at the screen edges so free-floating text stays readable on any wallpaper
  const a = 0.34 * big;
  let g = ctx.createLinearGradient(0, 0, 400, 0); g.addColorStop(0, `rgba(0,6,14,${a})`); g.addColorStop(1, 'rgba(0,6,14,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 400, H);
  g = ctx.createLinearGradient(W, 0, W - 400, 0); g.addColorStop(0, `rgba(0,6,14,${a})`); g.addColorStop(1, 'rgba(0,6,14,0)');
  ctx.fillStyle = g; ctx.fillRect(W - 400, 0, 400, H);
  g = ctx.createLinearGradient(0, H, 0, H - 300); g.addColorStop(0, `rgba(0,6,14,${a * 0.9})`); g.addColorStop(1, 'rgba(0,6,14,0)');
  ctx.fillStyle = g; ctx.fillRect(0, H - 300, W, 300);
}

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
  $('pl-art').classList.toggle('playing', !!sp.playing);
  $('pl-pp').innerHTML = '<path d="' + (sp.playing ? PAUSE : PLAY) + '"/>';
  const dur = sp.duration_ms || 0, prog = Math.min(dur, (sp.progress_ms || 0) + (sp.playing ? Date.now() - sp.at : 0));
  $('pl-fill').style.width = dur ? (prog / dur) * 100 + '%' : '0%';
  $('pl-t0').textContent = fmtT(prog); $('pl-t1').textContent = fmtT(dur);
}
setInterval(() => updatePlayer(false), 250);
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.pbtn');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'play_pause' && S.sp) { S.sp.progress_ms = (S.sp.progress_ms || 0) + (S.sp.playing ? Date.now() - S.sp.at : 0); S.sp.at = Date.now(); S.sp.playing = !S.sp.playing; updatePlayer(true); }
  send({ type: 'spotify', action: a });
});

function placeFollowers(cx, cy, R) {
  const f = Layout.followers(cx + HX, cy + HY, R, CW, CH);   // worked out in window space, placed in stage space
  const cap = $('caption').style, lab = $('corner').style;
  cap.left = (f.caption.left - HX) + 'px';
  cap.top = f.caption.top != null ? (f.caption.top - HY) + 'px' : 'auto';
  cap.bottom = f.caption.bottom != null ? (f.caption.bottom - (CH - HY - H)) + 'px' : 'auto';
  lab.left = (f.label.x - HX) + 'px'; lab.top = (f.label.y - HY) + 'px';
  lab.transform = f.label.onLeft ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
  lab.textAlign = f.label.onLeft ? 'right' : 'left';
}

let lastDraw = 0;
function frame(ms) {
  // frame-rate cap: lower when nothing is happening, and almost off while the HUD is hidden
  const hidden = $('hud').classList.contains('hidden');
  const quiet = S.state === 'idle' && !(S.sp && S.sp.playing);
  const fps = hidden ? 3 : Math.min(FPS_CAP[QUALITY], quiet ? 24 : 99);
  if (ms - lastDraw < 1000 / fps - 3) { requestAnimationFrame(frame); return; }
  lastDraw = ms;
  if (hidden) { ctx.clearRect(0, 0, CW, CH); requestAnimationFrame(frame); return; }
  const t = ms / 1000, dt = Math.min(0.05, t - S.t); S.t = t; frameNo++;
  ctx.clearRect(0, 0, CW, CH);
  ctx.save(); ctx.translate(HX, HY);   // everything below is drawn relative to the home screen

  // ease colour + prominence + audio level
  const st = eff();
  updateSpectrum(t);
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
  const wantC = isCompactNow() ? 1 : 0;
  S.compact += (wantC - S.compact) * 0.07;
  const cm = S.compact * S.compact * (3 - 2 * S.compact);
  const o0 = Layout.orb(W, H, cm, k, null);
  if (S.pin) {                                   // a dragged position is kept as a fraction of the whole window (any screen)
    const mg = Math.min(o0.R * 2, CW / 2, CH / 2);
    o0.x = Layout.clamp(S.pin.x * CW, mg, CW - mg) - HX; o0.y = Layout.clamp(S.pin.y * CH, mg, CH - mg) - HY;
  }
  const cx = o0.x, cy = o0.y, R = o0.R * uiScale('orb');
  orbNow.x = cx + HX; orbNow.y = cy + HY; orbNow.R = R;
  const speed = st === 'thinking' ? 3.2 : st === 'listening' ? 1.2 : 0.55;

  const follow = isCompactNow() || !!S.pin;
  if (follow !== lastFollow) {
    lastFollow = follow;
    document.body.classList.toggle('follow', follow);
    if (!follow) for (const el of [$('caption'), $('corner')]) { el.style.left = el.style.top = el.style.bottom = el.style.transform = el.style.textAlign = ''; }
  }
  document.body.classList.toggle('pinned', !!S.pin);
  if (follow) placeFollowers(cx, cy, R);

  const alpha = 0.55 + 0.45 * Math.max(k * (1 - cm), cm * 0.4, S.pin ? 0.6 : 0, st === 'loading' ? 0.6 : 0);
  const big = 1 - cm;   // how "full size" the HUD is (radar, waveform)

  // ---- the main stage (clear desktop only): background, hero brain, hologram platform ----
  heroNow.on = false;
  if (big > 0.03) {
    Scenery.drawBackground(ctx, t, dt, c, big);
    drawEdgeDim(big);
    const hu = UI.hero || {};
    const hR = Math.min(W * 0.17, H * 0.27) * (hu.s || 1), hx = W / 2 + (hu.dx || 0), hy = H * 0.42 + (hu.dy || 0);
    heroNow.x = hx + HX; heroNow.y = hy + HY; heroNow.R = hR; heroNow.on = big > 0.5;
    const ha = Math.min(1, 0.75 + 0.25 * brainAct) * big;
    const rp = hR * 0.34;                                           // platform sits just under the stem
    Scenery.drawPlatform(ctx, hx, hy + hR * 1.02 + 44 - rp * 2.95, rp, t, c, ha, lv);
    const bass = (S.specShown[0] + S.specShown[1] + S.specShown[2] + S.specShown[3] + S.specShown[4]) / 5;
    hero.update(dt, heroPhase(), lv, S.sp && S.sp.playing ? bass : 0);
    hero.draw(ctx, hx, hy, hR, t, c, ha, W >= 1500);
    Scenery.drawOrbits(ctx, hx, hy, hR * 0.42, t, c, ha * 0.9);
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
  const rings = [[R * 1.25, 3, 0.7, 1], [R * 1.05, 5, 0.55, -1.4], [R * 0.9, 2, 0.8, 2.1]];
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
  if (frameNo % 15 === 0) { $('i-syn').textContent = hero.firing; }

  // thinking: orbiting dots
  if (st === 'thinking') {
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + i * 2.094;
      ctx.fillStyle = rgba(c, 0.95);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 2.0, cy + Math.sin(a) * R * 2.0, 4 - cm * 1.5, 0, 7); ctx.fill();
    }
  }

  ctx.restore();
  if (frameNo % 3 === 0) { Perf.draw($('perfc'), c); }
  if (frameNo % 2 === 0) {
    Scenery.drawRadar($('radarc'), S.procs, t, c);
    if (big > 0.2) {
      Scenery.drawWave($('wave'), waveArr, c, st !== 'idle', t);
      setBars('r-syn', hero.firing / 90, 0.9);
      Scenery.drawSpectrum($('pl-spec'), S.specShown, c, t);
    }
  }
  if (frameNo % 6 === 0) updatePhases();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);


// ---------- terminal panel (mirrors the console window) ----------
function termLine(text, err) {
  const box = $('tlines'), d = document.createElement('div');
  d.textContent = text;
  if (/traceback|error|exception|failed|fatal|denied|refused|invalid|unavailable|\b[45]\d\d\b/i.test(text)) d.className = 'err';
  else if (err || /warn|deprecat|retry|stopped/i.test(text)) d.className = 'warn';
  box.appendChild(d);
  while (box.children.length > 60) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  const n = box.querySelectorAll('.err').length, cnt = $('tcnt');
  cnt.textContent = n ? n + (n === 1 ? ' ERROR' : ' ERRORS') : 'ALL CLEAR';
  cnt.classList.toggle('bad', n > 0);
}
$('tcnt').textContent = 'ALL CLEAR';

// ---------- command box: type to Jarvis when the microphone isn't an option ----------
const tin = $('tin');
function openInput() { window.jarvis.focusInput(); setTimeout(() => { tin.focus(); updateCovered(); }, 90); }
tin.addEventListener('mousedown', (e) => { if (document.activeElement !== tin) { e.preventDefault(); openInput(); } });
tin.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && tin.value.trim()) { send({ type: 'text', text: tin.value.trim() }); tin.value = ''; tin.blur(); }
  else if (e.key === 'Escape') tin.blur();
});
tin.addEventListener('blur', () => { window.jarvis.blurInput(); setInteractive(false); });
window.jarvis.onFocusInput && window.jarvis.onFocusInput(() => { $('hud').classList.remove('hidden'); setTimeout(() => { tin.focus(); updateCovered(); }, 90); });

// ---------- movable / scalable panels (right-drag to move, right-hold + scroll to resize) ----------
const MOVABLE = ['diag', 'log', 'timers', 'dock', 'clockbox', 'perf', 'radar', 'bar', 'player', 'term', 'rail'];
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
  if (!u) return;
  if (id === 'hero') {
    u.dx = Math.max(-(W / 2 + HX) + 80, Math.min(CW - HX - W / 2 - 80, u.dx || 0));
    u.dy = Math.max(-(H * 0.42 + HY) + 80, Math.min(CH - HY - H * 0.42 - 80, u.dy || 0));
    return;
  }
  const el = $(id);
  if (!el || id === 'orb') return;
  const r = el.getBoundingClientRect(), m = 70;
  if (r.width === 0) return;
  if (r.left > CW - m) u.dx -= r.left - (CW - m);
  if (r.right < m) u.dx += m - r.right;
  if (r.top > CH - m) u.dy -= r.top - (CH - m);
  if (r.bottom < m) u.dy += m - r.bottom;
  applyUI(id);
}
function resetUI(id) { delete UI[id]; applyUI(id); saveUI(); }
function resetAllUI() { UI = {}; MOVABLE.forEach(applyUI); saveUI(); setPin(null); }
let locked = false;
try { locked = localStorage.getItem('jarvis.lock') === '1'; } catch (e) { /* fine */ }
window.jarvis.onLock && window.jarvis.onLock(() => {
  locked = !locked;
  try { localStorage.setItem('jarvis.lock', locked ? '1' : '0'); } catch (e) { /* fine */ }
  addLog(locked ? 'Panels locked (click-through)' : 'Panels unlocked: right-drag to move');
});
const heroNow = { x: 0, y: 0, R: 100, on: false };
const overHero = (x, y) => heroNow.on && Math.hypot(x - heroNow.x, y - heroNow.y) < heroNow.R * 0.85;
let rmb = false, pdrag = null;
function hitTarget(e) {
  if (overOrb(e.clientX, e.clientY)) return 'orb';
  const p = e.target.closest && e.target.closest('.panel, #rail');
  if (p && p.id && !p.classList.contains('covered')) return p.id;
  return overHero(e.clientX, e.clientY) ? 'hero' : null;
}
const applyAny = (id) => (id === 'hero' || id === 'orb' ? saveUI() : applyUI(id));

// ---------- mouse: hold-to-talk, drag to move ----------
// The overlay ignores the mouse (clicks pass to your desktop) except while the pointer is over the
// visualizer or the launcher. mousemove events are still forwarded to us so we can tell.
let interactive = false, dragging = null;
function setInteractive(v) { if (v !== interactive) { interactive = v; window.jarvis.setInteractive && window.jarvis.setInteractive(v); } }
const overOrb = (x, y) => Math.hypot(x - orbNow.x, y - orbNow.y) < orbNow.R * 1.75 + 6;

document.addEventListener('mousemove', (e) => {
  if (pdrag) {
    const u = (UI[pdrag.id] = UI[pdrag.id] || {});
    u.dx = Math.max(-CW, Math.min(CW, pdrag.u0.dx + e.clientX - pdrag.x0));
    u.dy = Math.max(-CH, Math.min(CH, pdrag.u0.dy + e.clientY - pdrag.y0));
    applyAny(pdrag.id);
    keepOnScreen(pdrag.id);
    return;
  }
  if (dragging) {
    setPin({ x: (e.clientX - dragging.dx) / CW, y: (e.clientY - dragging.dy) / CH });
    return;
  }
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
    if (tgt === 'orb') dragging = { dx: e.clientX - orbNow.x, dy: e.clientY - orbNow.y, orb: true };
    else {
      const u = UI[tgt] || {};
      pdrag = { id: tgt, x0: e.clientX, y0: e.clientY, u0: { dx: u.dx || 0, dy: u.dy || 0 } };
      const el = $(tgt); el && el.classList.add('grab');
    }
    document.body.style.cursor = 'grabbing';
    setInteractive(true);
  } else if (e.button === 1) {                // middle-click: back to the default spot and size
    if (tgt === 'orb') { setPin(null); delete UI.orb; saveUI(); }
    else if (tgt === 'hero') { delete UI.hero; saveUI(); }
    else resetUI(tgt);
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0 && pttActive) { pttActive = false; refreshLabel(); send({ type: 'ptt_up' }); }
  if (e.button === 2) {
    rmb = false;
    if (dragging) dragging = null;
    if (pdrag) { const el = $(pdrag.id); el && el.classList.remove('grab'); pdrag = null; saveUI(); }
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
addEventListener('blur', () => { if (pttActive) { pttActive = false; refreshLabel(); send({ type: 'ptt_up' }); } });

setState('loading');
connect();
