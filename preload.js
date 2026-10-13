'use strict';
// The only bridge between the sandboxed UI and the core. Exposes named functions, never ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  env: inv('env:get'),
  drives: inv('drives:list'),
  scan: inv('scan:start'),
  cancelScan: inv('scan:cancel'),
  lastScan: inv('scan:last'),
  pickFolder: inv('scan:pickFolder'),
  snapshots: inv('snapshots:list'),
  snapshot: inv('snapshots:get'),
  checkMarkers: inv('markers:check'),
  inspect: inv('inspect'),
  sysContext: (force) => ipcRenderer.invoke('sys:context', !!force),
  delete: inv('fs:delete'),
  forbidden: inv('fs:forbidden'),
  reveal: inv('shell:reveal'),
  open: inv('shell:open'),
  copy: inv('clipboard:write'),
  action: inv('action:run'),
  icon: inv('app:icon'),
  uninstall: inv('app:uninstall'),
  relaunchAdmin: inv('app:relaunchAdmin'),
  getSettings: inv('settings:get'),
  setSettings: inv('settings:set'),
  overlay: inv('window:overlay'),
  exportFile: inv('export:save'),
  exportReport: inv('report:export'),
  quarantine: { list: inv('quarantine:list'), restore: inv('quarantine:restore'), purge: inv('quarantine:purge') },
  history: inv('history:list'),
  dupes: { start: inv('dupes:start'), cancel: inv('dupes:cancel'), link: inv('dupes:link') },
  docker: { info: inv('docker:info'), remove: inv('docker:remove'), prune: inv('docker:prune') },
  wsl: { info: inv('wsl:info'), shutdown: inv('wsl:shutdown'), terminate: inv('wsl:terminate'), move: inv('wsl:move') },
  drivers: { list: inv('drivers:list'), remove: inv('drivers:delete') },
  restorePts: { info: inv('restore:info'), deleteOldest: inv('restore:deleteOldest'), resize: inv('restore:resize') },
  compact: { state: inv('compact:state'), setOs: inv('compact:setOs'), folder: inv('compact:folder'), risk: inv('compact:risk') },
  move: { status: inv('move:status'), pickTarget: inv('move:pickTarget'), procs: inv('move:procs'), run: inv('move:run'), restore: inv('move:restore') },
  ai: { status: inv('ai:status'), saveProvider: inv('ai:saveProvider'), deleteProvider: inv('ai:deleteProvider'), setActive: inv('ai:setActive'), consent: inv('ai:consent'), test: inv('ai:test'), preview: inv('ai:preview'), explain: inv('ai:explain') },
  monitor: { history: inv('monitor:history'), check: inv('monitor:check') },
  shellMenu: { status: inv('shellmenu:status'), set: inv('shellmenu:set') },
  update: { check: inv('update:check'), install: inv('update:install') },
  onProgress: on('scan:progress'),
  onDone: on('scan:done'),
  onCancelled: on('scan:cancelled'),
  onError: on('scan:error'),
  onNotice: on('scan:notice'),
  onBackgroundScan: on('scan:background'),
  onDeleteProgress: on('delete:progress'),
  onDupesProgress: on('dupes:progress'),
  onDupesDone: on('dupes:done'),
  onDupesError: on('dupes:error'),
  onOpProgress: on('op:progress'),
  onAnalyze: on('app:analyze'),
  onNav: on('app:nav'),
  onAlert: on('monitor:alert'),
});
