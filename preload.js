const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  onSessions: (fn) => ipcRenderer.on('sessions', (_e, list) => fn(list)),
  onConfig: (fn) => ipcRenderer.on('config', (_e, config) => fn(config)),
  rects: (r) => ipcRenderer.send('rects', r),
  moveTo: (x, y) => ipcRenderer.send('move-to', x, y),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onCursor: (fn) => ipcRenderer.on('cursor', (_e, x, y) => fn(x, y)),
  setSize: (px) => ipcRenderer.send('set-size', px),
  menu: () => ipcRenderer.send('menu'),
  ack: (id, updated) => ipcRenderer.send('ack', id, updated),
  connect: () => ipcRenderer.send('connect'),
  onConnection: (fn) => ipcRenderer.on('connection', (_e, c) => fn(c)),
  openApp: () => ipcRenderer.send('open-app'),
  setCharacter: (id) => ipcRenderer.send('set-character', id),
  importPack: () => ipcRenderer.send('import-pack'),
  importCharacter: () => ipcRenderer.send('import-character'),
})
