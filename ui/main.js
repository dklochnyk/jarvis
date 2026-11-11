const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const HOTKEY = process.env.JARVIS_HOTKEY || 'CommandOrControl+Alt+J';      // talk to / interrupt Jarvis
const HUD_TOGGLE = process.env.JARVIS_HUD_KEY || 'CommandOrControl+Alt+H'; // show / hide the HUD
const DEMO = process.argv.includes('--demo') || !!process.env.JARVIS_DEMO;

let win, tray, backend;

function startBackend() {
  if (process.env.JARVIS_NO_BACKEND) return;
  const root = path.join(__dirname, '..');
  const venvPy = process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
  const py = fs.existsSync(venvPy) ? venvPy : (process.env.JARVIS_PYTHON || 'python');
  backend = spawn(py, ['main.py', ...(DEMO ? ['--demo'] : [])], {
    cwd: path.join(root, 'backend'),
    stdio: 'inherit',
  });
  backend.on('exit', (code) => {
    console.log('backend exited', code);
    if (code === 42) app.exit(42);   // update applied: run.bat starts everything again
  });
}

// ---- which screen(s) the HUD lives on: one chosen monitor, or one overlay spanning every monitor ----
const SCREEN_FILE = () => path.join(app.getPath('userData'), 'screen.json');
let screenCfg = { span: false, home: null };
function loadScreenCfg() { try { screenCfg = { ...screenCfg, ...JSON.parse(fs.readFileSync(SCREEN_FILE(), 'utf8')) }; } catch (e) { /* first run */ } }
function saveScreenCfg() { try { fs.writeFileSync(SCREEN_FILE(), JSON.stringify(screenCfg)); } catch (e) { /* fine */ } }
const homeDisplay = () => screen.getAllDisplays().find((d) => d.id === screenCfg.home) || screen.getPrimaryDisplay();
function unionBounds(bs) {
  const l = Math.min(...bs.map((b) => b.x)), t = Math.min(...bs.map((b) => b.y));
  return { x: l, y: t, width: Math.max(...bs.map((b) => b.x + b.width)) - l, height: Math.max(...bs.map((b) => b.y + b.height)) - t };
}
function physRect(r) {   // DIP -> real screen pixels (what the window watcher reports)
  try { const p = screen.dipToScreenRect(win, r); return { x: p.x, y: p.y, w: p.width, h: p.height }; }
  catch (e) { const f = screen.getPrimaryDisplay().scaleFactor || 1; return { x: r.x * f, y: r.y * f, w: r.width * f, h: r.height * f }; }
}
function placeWindow(changed = false) {
  if (!win) return;
  const home = homeDisplay();
  const all = screen.getAllDisplays().map((d) => d.bounds);
  const b = screenCfg.span ? unionBounds(all) : home.bounds;
  const bounds = { x: b.x, y: b.y, width: b.width, height: b.height - 1 };   // 1px short so Windows keeps the taskbar visible
  win.setBounds(bounds);
  win.setBounds(bounds);                                                     // twice: Windows can misplace it across mixed-DPI screens
  const hb = home.bounds;
  const homeRel = { x: hb.x - b.x, y: hb.y - b.y, w: hb.width, h: Math.min(hb.height, bounds.y + bounds.height - hb.y) };
  win.webContents.send('screens', {
    changed,
    home: homeRel,
    phys: { win: physRect(bounds), home: physRect({ x: hb.x, y: hb.y, width: hb.width, height: homeRel.h }) },
  });
  buildTray();
}

function createWindow() {
  loadScreenCfg();
  const { x, y, width, height } = homeDisplay().bounds;
  win = new BrowserWindow({
    x, y, width,
    height: height - 1,       // 1px short of full screen so Windows keeps the taskbar visible
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true }); // clicks pass straight through to your desktop
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => placeWindow(false));
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => placeWindow(false));
}

function buildTray() {
  if (!tray) return;
  const ds = screen.getAllDisplays(), home = homeDisplay();
  const primary = screen.getPrimaryDisplay().id;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Talk to Jarvis', click: () => win.webContents.send('hotkey') },
    {
      label: 'Main screen',
      submenu: ds.map((d, i) => ({
        label: `Screen ${i + 1} (${d.bounds.width}x${d.bounds.height})${d.id === primary ? ' - main display' : ''}`,
        type: 'radio', checked: d.id === home.id,
        click: () => { screenCfg.home = d.id; saveScreenCfg(); placeWindow(true); },
      })),
    },
    {
      label: 'Span all screens (move panels between monitors)', type: 'checkbox', checked: !!screenCfg.span,
      click: (item) => { screenCfg.span = item.checked; saveScreenCfg(); placeWindow(true); },
    },
    { label: 'Reset layout (positions and sizes)', click: () => win.webContents.send('reset-orb') },
    { label: 'Lock / unlock panels (click-through)', click: () => win.webContents.send('lock-panels') },
    { label: 'Show / hide HUD', click: () => win.webContents.send('toggle-hud') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// The overlay ignores the mouse except while the renderer says the pointer is over the visualizer / launcher.
ipcMain.on('interactive', (_e, on) => { if (win) win.setIgnoreMouseEvents(!on, { forward: true }); });

app.whenReady().then(() => {
  startBackend();
  createWindow();

  globalShortcut.register(HOTKEY, () => win && win.webContents.send('hotkey'));
  globalShortcut.register(HUD_TOGGLE, () => win && win.webContents.send('toggle-hud'));
  globalShortcut.register('CommandOrControl+Alt+R', () => win && win.webContents.send('reset-orb'));   // put everything back
  globalShortcut.register('CommandOrControl+Alt+S', () => { screenCfg.span = !screenCfg.span; saveScreenCfg(); placeWindow(true); });  // span all screens on/off

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')));
  tray.setToolTip('Jarvis');
  buildTray();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (backend) backend.kill();
});
app.on('window-all-closed', () => app.quit());
