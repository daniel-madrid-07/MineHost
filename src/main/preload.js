const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('minehost', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
    pickMods: () => ipcRenderer.invoke('mods:pickFiles'),
  },
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  java: {
    detect: () => ipcRenderer.invoke('java:detect'),
  },
  installer: {
    versions: () => ipcRenderer.invoke('installer:versions'),
    install: (opts) => ipcRenderer.invoke('installer:install', opts),
    status: (serverPath) => ipcRenderer.invoke('installer:status', serverPath),
    onProgress: on('installer:progress'),
  },
  server: {
    start: (opts) => ipcRenderer.invoke('server:start', opts),
    stop: () => ipcRenderer.invoke('server:stop'),
    command: (cmd) => ipcRenderer.invoke('server:command', cmd),
    state: () => ipcRenderer.invoke('server:state'),
    onLog: on('server:log'),
    onState: on('server:state'),
  },
  ngrok: {
    ensure: () => ipcRenderer.invoke('ngrok:ensure'),
    setToken: (token) => ipcRenderer.invoke('ngrok:setToken', token),
    start: (port) => ipcRenderer.invoke('ngrok:start', port),
    stop: () => ipcRenderer.invoke('ngrok:stop'),
    state: () => ipcRenderer.invoke('ngrok:state'),
    onLog: on('ngrok:log'),
    onState: on('ngrok:state'),
  },
  props: {
    read: (serverPath) => ipcRenderer.invoke('props:read', serverPath),
    write: (serverPath, values) => ipcRenderer.invoke('props:write', { serverPath, values }),
  },
  eula: {
    accept: (serverPath) => ipcRenderer.invoke('eula:accept', serverPath),
  },
  mods: {
    list: (serverPath) => ipcRenderer.invoke('mods:list', serverPath),
    add: (serverPath, files) => ipcRenderer.invoke('mods:add', { serverPath, files }),
    toggle: (serverPath, file) => ipcRenderer.invoke('mods:toggle', { serverPath, file }),
    remove: (serverPath, file) => ipcRenderer.invoke('mods:remove', { serverPath, file }),
  },
  system: {
    ram: () => ipcRenderer.invoke('system:ram'),
  },
  // Resolves real filesystem paths for drag & dropped files.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file.path || null;
    }
  },
});
