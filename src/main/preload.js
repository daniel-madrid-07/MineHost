const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('mh', {
  app: {
    info: invoke('app:info'),
    minimize: invoke('window:minimize'),
    maximize: invoke('window:maximize'),
    close: invoke('window:close'),
    onProgress: on('task:progress'),
  },

  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },

  servers: {
    list: invoke('servers:list'),
    active: invoke('servers:active'),
    add: invoke('servers:add'),
    update: (id, patch) => ipcRenderer.invoke('servers:update', { id, patch }),
    remove: invoke('servers:remove'),
    select: invoke('servers:select'),
  },

  i18n: {
    bundle: invoke('i18n:bundle'),
    set: invoke('i18n:set'),
  },

  updates: {
    check: invoke('app:checkUpdate'),
  },

  tray: {
    set: invoke('app:tray'),
    autoLaunch: invoke('app:autoLaunch'),
    autoLaunchState: invoke('app:autoLaunchState'),
  },

  wake: {
    set: (enabled, idleMinutes) => ipcRenderer.invoke('app:wakeOnDemand', { enabled, idleMinutes }),
    state: invoke('app:wakeState'),
  },

  files: {
    list: invoke('files:list'),
    read: invoke('files:read'),
    write: (rel, content) => ipcRenderer.invoke('files:write', { rel, content }),
    remove: invoke('files:remove'),
    rename: (rel, name) => ipcRenderer.invoke('files:rename', { rel, name }),
    newFolder: (rel, name) => ipcRenderer.invoke('files:newFolder', { rel, name }),
    upload: (rel, files) => ipcRenderer.invoke('files:upload', { rel, files }),
    reveal: invoke('files:reveal'),
    pickAny: invoke('dialog:pickAny'),
  },

  network: {
    summary: invoke('network:summary'),
    testPort: invoke('network:testPort'),
    firewall: invoke('network:firewall'),
  },

  dialog: {
    pickFolder: invoke('dialog:pickFolder'),
    pickJars: invoke('dialog:pickJars'),
    pickZip: invoke('dialog:pickZip'),
    saveZip: invoke('dialog:saveZip'),
  },

  shell: {
    openPath: invoke('shell:openPath'),
    openExternal: invoke('shell:openExternal'),
  },

  installer: {
    versions: invoke('platform:versions'),
    status: invoke('installer:status'),
    javaFor: invoke('installer:javaFor'),
    install: invoke('installer:install'),
  },

  server: {
    start: invoke('server:start'),
    stop: invoke('server:stop'),
    restart: invoke('server:restart'),
    command: invoke('server:command'),
    state: invoke('server:state'),
    recentLog: invoke('server:recentLog'),
    recentEvents: invoke('server:recentEvents'),
    history: invoke('server:history'),
    onLog: on('server:log'),
    onEvent: on('server:event'),
    onState: on('server:state'),
    onStats: on('server:stats'),
    onCrash: on('server:crash'),
  },

  ngrok: {
    ensure: invoke('ngrok:ensure'),
    setToken: invoke('ngrok:setToken'),
    allowInDefender: invoke('ngrok:allowInDefender'),
    start: invoke('ngrok:start'),
    stop: invoke('ngrok:stop'),
    state: invoke('ngrok:state'),
    onLog: on('ngrok:log'),
    onState: on('ngrok:state'),
  },

  props: {
    read: invoke('props:read'),
    write: (serverPath, values) => ipcRenderer.invoke('props:write', { serverPath, values }),
  },

  gamerules: {
    set: (key, value) => ipcRenderer.invoke('gamerules:set', { key, value }),
  },

  players: {
    read: invoke('players:read'),
    mutate: (list, action, value, opts) =>
      ipcRenderer.invoke('players:mutate', { list, action, value, opts }),
    kick: (name, reason) => ipcRenderer.invoke('players:kick', { name, reason }),
  },

  backups: {
    list: invoke('backups:list'),
    create: invoke('backups:create'),
    restore: invoke('backups:restore'),
    remove: invoke('backups:remove'),
    openFolder: invoke('backups:openFolder'),
  },

  worlds: {
    list: invoke('worlds:list'),
    activate: invoke('worlds:activate'),
    rename: (from, to) => ipcRenderer.invoke('worlds:rename', { from, to }),
    remove: invoke('worlds:remove'),
    resetDimension: (world, dimension) =>
      ipcRenderer.invoke('worlds:resetDimension', { world, dimension }),
    export: (name, dest) => ipcRenderer.invoke('worlds:export', { name, dest }),
    import: (zipPath, name) => ipcRenderer.invoke('worlds:import', { zipPath, name }),
  },

  mods: {
    list: invoke('mods:list'),
    add: invoke('mods:add'),
    toggle: invoke('mods:toggle'),
    remove: invoke('mods:remove'),
    openFolder: invoke('mods:openFolder'),
  },

  modrinth: {
    search: (query, offset, filters) =>
      ipcRenderer.invoke('modrinth:search', { query, offset, filters }),
    facets: invoke('modrinth:facets'),
    install: invoke('modrinth:install'),
  },

  datapacks: {
    list: invoke('datapacks:list'),
    add: invoke('datapacks:add'),
    remove: invoke('datapacks:remove'),
  },

  schedule: {
    get: invoke('schedule:get'),
    set: invoke('schedule:set'),
  },

  /** Real filesystem path for a dropped File, across Electron versions. */
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch (_) { return file.path || null; }
  },
});
