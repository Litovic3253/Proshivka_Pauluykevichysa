/** Мост «интерфейс ↔ программа»: только эти функции видны окну, диск и система — нет. */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pauluk', {
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    save: (meta, data, eeprom) => ipcRenderer.invoke('library:save', meta, data, eeprom),
    read: (id) => ipcRenderer.invoke('library:read', id),
    update: (id, patch) => ipcRenderer.invoke('library:update', id, patch),
    remove: (id) => ipcRenderer.invoke('library:remove', id),
    folder: () => ipcRenderer.invoke('library:folder'),
    openFolder: () => ipcRenderer.invoke('library:openFolder'),
    showInFolder: (id) => ipcRenderer.invoke('library:showInFolder', id),
  },
  files: {
    saveAs: (defaultName, data) => ipcRenderer.invoke('files:saveAs', defaultName, data),
  },
  ports: {
    onRequest: (cb) => {
      const handler = (_event, list) => cb(list)
      ipcRenderer.on('ports:request', handler)
      return () => ipcRenderer.removeListener('ports:request', handler)
    },
    choose: (portId) => ipcRenderer.send('ports:choose', portId),
  },
  app: {
    ready: () => ipcRenderer.send('app:ready'),
  },
})
