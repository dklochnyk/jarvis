const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, screen } = require('electron');
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

function createWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
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
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  globalShortcut.register(HOTKEY, () => win && win.webContents.send('hotkey'));
  globalShortcut.register(HUD_TOGGLE, () => win && win.webContents.send('toggle-hud'));

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')));
  tray.setToolTip('Jarvis');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Talk to Jarvis', click: () => win.webContents.send('hotkey') },
    { label: 'Show / hide HUD', click: () => win.webContents.send('toggle-hud') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (backend) backend.kill();
});
app.on('window-all-closed', () => app.quit());
