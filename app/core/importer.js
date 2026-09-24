// GitHub'daki bir projeyi (bağlantı ya da owner/repo) DraftRewind projesi olarak indirir.
// Çalışma klasörü kullanıcının Belgeler klasörüne, git verisi ise ayrı gitdir'e (userData/depolar/<id>.git) yazılır;
// böylece kullanıcının klasöründe .git oluşmaz. Motor 'main' dalını okuduğu için varsayılan dal farklıysa
// refs/heads/main aynı kayda yönlendirilir.
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const I18N = require('../i18n/strings');
const T = (key, vars) => I18N.text(key, vars);

const BRANCH = 'main';

// "https://github.com/owner/repo(.git)(/...)", "github.com/owner/repo", "git@github.com:owner/repo.git" ya da "owner/repo"
function parseRepo(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    s = s.replace(/^git@github\.com:/i, 'https://github.com/');
    let m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?(?:[/?#].*)?$/i);
    if (!m) m = s.match(/^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?$/);
    if (!m) return null;
    const owner = m[1];
    const repo = m[2];
    if (!owner || !repo || owner === '.' || repo === '.' || repo === '..') return null;
    return { owner, repo, url: `https://github.com/${owner}/${repo}.git` };
}

function uniqueDir(base, name) {
    const clean = String(name).replace(/[<>:"/\\|?*]/g, '').trim() || 'GitHub';
    let dir = path.join(base, clean);
    for (let i = 2; fs.existsSync(dir) && i < 1000; i++) dir = path.join(base, `${clean} (${i})`);
    return dir;
}

function friendlyError(e, hasToken) {
    const status = e && e.data && e.data.statusCode;
    const msg = String((e && (e.message || e.code)) || e);
    if (status === 404 || status === 401 || status === 403 || (e && e.code === 'UserCanceledError') || /\b(401|403|404)\b|Unauthorized|not found/i.test(msg)) {
        return new Error(hasToken ? T('imp.errNotFound') : T('imp.errPrivate'));
    }
    if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket/i.test(msg)) return new Error(T('imp.errNetwork'));
    return new Error(T('imp.errGeneric', { msg }));
}

/**
 * @param {object} o
 * @param {string} o.input         bağlantı ya da owner/repo
 * @param {string} o.baseDir       çalışma klasörünün oluşturulacağı üst klasör
 * @param {string} o.gitdir        ayrı git klasörü
 * @param {string|null} o.token    GitHub erişim jetonu (özel depolar için)
 * @param {function} o.onProgress  ({ phase, loaded, total }) => void
 * @returns {Promise<{ dir, name, owner, repo, branch }>}
 */
async function cloneFromGithub({ input, baseDir, gitdir, token, onProgress }) {
    const ref = parseRepo(input);
    if (!ref) throw new Error(T('imp.errBadLink'));
    fs.mkdirSync(baseDir, { recursive: true });
    const dir = uniqueDir(baseDir, ref.repo);
    const onAuth = token ? () => ({ username: token, password: 'x-oauth-basic' }) : undefined;
    // Jeton reddedilirse tekrar sorma: hemen vazgeç (anlaşılır hata gösterilir)
    const onAuthFailure = () => ({ cancel: true });
    fs.mkdirSync(dir, { recursive: true });
    try {
        await git.clone({
            fs,
            http,
            dir,
            gitdir,
            url: ref.url,
            singleBranch: true,
            tags: false,
            onAuth: onAuth || (() => ({ cancel: true })), // jeton yoksa GitHub'ın kimlik sorusunda hemen vazgeç
            onAuthFailure,
            onProgress: p => {
                try { onProgress && onProgress({ phase: p.phase, loaded: p.loaded, total: p.total }); } catch (e) {}
            }
        });
    } catch (e) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {}
        try { fs.rmSync(gitdir, { recursive: true, force: true }); } catch (err) {}
        throw friendlyError(e, !!token);
    }

    let branch = null;
    try {
        branch = await git.currentBranch({ fs, gitdir, fullname: false });
        const head = await git.resolveRef({ fs, gitdir, ref: 'HEAD' });
        if (branch !== BRANCH) {
            await git.writeRef({ fs, gitdir, ref: `refs/heads/${BRANCH}`, value: head, force: true });
            await git.writeRef({ fs, gitdir, ref: 'HEAD', value: `refs/heads/${BRANCH}`, symbolic: true, force: true });
            if (branch) {
                try { await git.deleteRef({ fs, gitdir, ref: `refs/heads/${branch}` }); } catch (e) {}
            }
        }
    } catch (e) {
        // Boş depo: ilk kaydı DraftRewind alır
        try { fs.writeFileSync(path.join(gitdir, 'HEAD'), `ref: refs/heads/${BRANCH}\n`); } catch (err) {}
    }
    // Kaynağın uzak ayarını kaldır: DraftRewind kendi özel yedek deposunu 'origin' olarak kuracak
    try { await git.deleteRemote({ fs, gitdir, remote: 'origin' }); } catch (e) {}
    try { fs.rmSync(path.join(gitdir, 'refs', 'remotes'), { recursive: true, force: true }); } catch (e) {}
    try {
        const packed = path.join(gitdir, 'packed-refs');
        if (fs.existsSync(packed)) {
            const kept = fs.readFileSync(packed, 'utf8').split('\n').filter(l => !/ refs\/remotes\//.test(l));
            fs.writeFileSync(packed, kept.join('\n'));
        }
    } catch (e) {}

    return { dir, name: path.basename(dir), owner: ref.owner, repo: ref.repo, branch };
}

module.exports = { parseRepo, cloneFromGithub };
