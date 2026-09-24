const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) =>
    ipcRenderer.invoke(channel, ...args).then(r => {
        if (!r.ok) throw new Error(r.error);
        return r.data;
    });

contextBridge.exposeInMainWorld('av', {
    state: () => call('app:state'),
    onEvent: cb => ipcRenderer.on('av:event', (_e, payload) => cb(payload)),

    projects: {
        add: () => call('project:add'),
        create: name => call('project:create', name),
        remove: id => call('project:remove', id),
        update: (id, patch) => call('project:update', id, patch),
        relink: id => call('project:relink', id),
        setActive: id => call('project:setActive', id),
        overview: id => call('project:overview', id),
        history: (id, opts) => call('project:history', id, opts),
        changes: (id, oid) => call('project:changes', id, oid),
        diff: (id, rel, oid) => call('project:diff', id, rel, oid),
        fileBuffer: (id, rel, oid) => call('project:fileBuffer', id, rel, oid),
        snapshot: (id, opts) => call('project:snapshot', id, opts),
        restore: (id, rel, oid, mode) => call('project:restore', id, rel, oid, mode),
        openVersion: (id, rel, oid) => call('project:openVersion', id, rel, oid),
        importEdited: (id, file, rel) => call('project:importEdited', id, file, rel),
        openFolder: id => call('project:openFolder', id),
        openFile: (id, rel) => call('file:open', id, rel),
        revealFile: (id, rel) => call('file:reveal', id, rel)
    },

    github: {
        login: () => call('github:login'),
        cancel: () => call('github:cancel'),
        logout: () => call('github:logout'),
        syncNow: id => call('github:syncNow', id)
    },

    drive: {
        useFolder: folder => call('drive:useFolder', folder),
        signIn: () => call('drive:signIn'),
        disconnect: () => call('drive:disconnect'),
        open: id => call('drive:open', id)
    },

    setPref: (key, value) => call('prefs:set', key, value),
    openExternal: url => call('shell:openExternal', url)
});
