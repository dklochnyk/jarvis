const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  onHotkey: (cb) => ipcRenderer.on('hotkey', cb),
  onToggleHud: (cb) => ipcRenderer.on('toggle-hud', cb),
  onResetOrb: (cb) => ipcRenderer.on('reset-orb', cb),
  onLock: (cb) => ipcRenderer.on('lock-panels', cb),
  onScreens: (cb) => ipcRenderer.on('screens', cb),
  onQuality: (cb) => ipcRenderer.on('quality', cb),
  focusInput: () => ipcRenderer.send('focus-input'),
  blurInput: () => ipcRenderer.send('blur-input'),
  onFocusInput: (cb) => ipcRenderer.on('focus-input', cb),
  setInteractive: (on) => ipcRenderer.send('interactive', !!on),
});
