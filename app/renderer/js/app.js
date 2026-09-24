/* DraftRewind arayüzü */
(() => {
    const av = window.av;
    const S = {
        app: null,
        activeId: null,
        tab: 'home',
        overview: null,
        history: [],
        tlFilter: '',
        selectedOid: null,
        changes: [],
        selectedFile: null,
        viewMode: 'diff',
        diffFull: false,
        pending: {},
        syncing: {},
        showAllFiles: false,
        railCollapsed: (() => {
            try { return localStorage.getItem('railCollapsed') === '1'; } catch (e) { return false; }
        })(),
        loginModal: null
    };

    const $ = sel => document.querySelector(sel);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Dil: ana süreçten gelen çözümlenmiş dil (S.app.lang); sözlük ../i18n/strings.js
    const I18N = window.I18N;
    const lang = () => (S.app && S.app.lang) || 'tr';
    const t = (key, vars) => I18N.t(lang(), key, vars);
    const locale = () => I18N.locale(lang());
    const num = n => Number(n || 0).toLocaleString(locale());
    // Sayı + çoğul: tn('common.words', 5) → "5 kelime" / "5 words"
    const tn = (key, n, vars) => t(key, { ...vars, n: num(n), count: Number(n) || 0 });
    const EMOJIS = ['📘', '📗', '📕', '📙', '🎓', '🧪', '🧬', '🔭', '📐', '🧠', '🌍', '⚖️', '🎨', '💻', '📊', '🏛️', '🩺', '🌱', '🚀', '🎼', '🏗️', '📜', '🦉', '✨'];
    const KIND_ICON = { auto: '💾', star: '⭐', rescue: '⚡', restore: '↩️', merge: '🤝' };
    const TYPE_LABEL = { word: 'DOC', sheet: 'XLS', slides: 'PPT', pdf: 'PDF', text: 'TXT', image: 'IMG', other: 'FILE' };
    const MONTHS = () => t('time.months');
    const DAYS = () => t('time.days');

    // ------------------------------------------------------------------ zaman
    const pad = n => String(n).padStart(2, '0');
    const hm = d => (lang() === 'tr' ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }));
    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function ago(ts) {
        if (!ts) return t('time.never');
        const d = new Date(ts);
        const s = (Date.now() - ts) / 1000;
        if (s < 45) return t('time.justNow');
        if (s < 3600) return t('time.minAgo', { n: Math.round(s / 60) });
        const now = new Date();
        if (sameDay(d, now)) return t('time.todayAt', { time: hm(d) });
        const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        if (sameDay(d, y)) return t('time.yesterdayAt', { time: hm(d) });
        return t('time.dateAt', { day: d.getDate(), month: MONTHS()[d.getMonth()], time: hm(d) });
    }
    function dayLabel(ts) {
        const d = new Date(ts);
        const now = new Date();
        if (sameDay(d, now)) return t('time.today');
        if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t('time.yesterday');
        const vars = { day: d.getDate(), month: MONTHS()[d.getMonth()], year: d.getFullYear(), weekday: DAYS()[d.getDay()] };
        return t(d.getFullYear() !== now.getFullYear() ? 'time.dayLabelYear' : 'time.dayLabel', vars);
    }
    function fullDate(ts) {
        const d = new Date(ts);
        return t('time.full', { day: d.getDate(), month: MONTHS()[d.getMonth()], year: d.getFullYear(), weekday: DAYS()[d.getDay()], time: hm(d) });
    }
    function greeting() {
        const h = new Date().getHours();
        if (h < 6) return t('greet.night');
        if (h < 12) return t('greet.morning');
        if (h < 18) return t('greet.afternoon');
        return t('greet.evening');
    }
    function sizeText(b) {
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
        return `${(b / 1024 / 1024).toFixed(1)} MB`;
    }

    // ------------------------------------------------------------------ toast / confetti
    function toast(text, icon = '✨', ms = 3800) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = `<span class="ic">${icon}</span><span>${esc(text)}</span>`;
        $('#toasts').appendChild(el);
        setTimeout(() => {
            el.classList.add('out');
            setTimeout(() => el.remove(), 260);
        }, ms);
    }

    function confetti() {
        const c = $('#confetti');
        const ctx = c.getContext('2d');
        c.width = innerWidth * devicePixelRatio;
        c.height = innerHeight * devicePixelRatio;
        ctx.scale(devicePixelRatio, devicePixelRatio);
        const colors = ['#6c5cff', '#ec62be', '#ffb938', '#22c55e', '#38bdf8', '#ff7a45'];
        const parts = Array.from({ length: 160 }, () => ({
            x: innerWidth / 2 + (Math.random() - 0.5) * 200,
            y: innerHeight / 2.4,
            vx: (Math.random() - 0.5) * 16,
            vy: -Math.random() * 15 - 5,
            r: Math.random() * 6 + 4,
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.3,
            c: colors[(Math.random() * colors.length) | 0]
        }));
        let frame = 0;
        const tick = () => {
            ctx.clearRect(0, 0, innerWidth, innerHeight);
            for (const p of parts) {
                p.vy += 0.42;
                p.vx *= 0.99;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vr;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.c;
                ctx.globalAlpha = Math.max(0, 1 - frame / 150);
                ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
                ctx.restore();
            }
            if (++frame < 150) requestAnimationFrame(tick);
            else ctx.clearRect(0, 0, innerWidth, innerHeight);
        };
        tick();
    }

    // ------------------------------------------------------------------ modal
    function openModal(html, { onClose, wide } = {}) {
        closeModal();
        const back = document.createElement('div');
        back.className = 'modal-back';
        back.innerHTML = `<div class="modal"${wide ? ' style="width:min(640px,calc(100vw - 32px))"' : ''}>${html}</div>`;
        back.addEventListener('mousedown', e => {
            if (e.target === back) closeModal();
        });
        back._onClose = onClose;
        $('#modal-root').appendChild(back);
        const first = back.querySelector('input,textarea');
        if (first) setTimeout(() => first.focus(), 60);
        return back.querySelector('.modal');
    }
    function closeModal() {
        const back = $('#modal-root .modal-back');
        if (!back) return;
        if (back._onClose) back._onClose();
        back.remove();
    }
    function confirmModal({ title, text, ok = t('common.ok'), danger = false, emoji = '🤔' }) {
        return new Promise(resolve => {
            let answered = false;
            const m = openModal(
                `<div style="font-size:40px">${emoji}</div><h2>${esc(title)}</h2><p class="sub">${text}</p>
                <div class="foot"><button class="btn ghost" data-x="no">${t('common.cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-x="yes">${esc(ok)}</button></div>`,
                { onClose: () => !answered && resolve(false) }
            );
            m.querySelector('[data-x=no]').onclick = () => closeModal();
            m.querySelector('[data-x=yes]').onclick = () => {
                answered = true;
                closeModal();
                resolve(true);
            };
        });
    }
    function promptModal({ title, sub, value = '', placeholder = '', ok = t('common.save'), emoji = '✏️' }) {
        return new Promise(resolve => {
            let answered = false;
            const m = openModal(
                `<div style="font-size:36px">${emoji}</div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}
                <input class="input" id="prompt-in" value="${esc(value)}" placeholder="${esc(placeholder)}">
                <div class="foot"><button class="btn ghost" data-x="no">${t('common.cancel')}</button><button class="btn primary" data-x="yes">${esc(ok)}</button></div>`,
                { onClose: () => !answered && resolve(null) }
            );
            const input = m.querySelector('#prompt-in');
            const done = () => {
                answered = true;
                const v = input.value.trim();
                closeModal();
                resolve(v || null);
            };
            input.addEventListener('keydown', e => e.key === 'Enter' && done());
            m.querySelector('[data-x=no]').onclick = () => closeModal();
            m.querySelector('[data-x=yes]').onclick = done;
        });
    }

    async function run(fn, errPrefix = '') {
        try {
            return await fn();
        } catch (e) {
            toast(`${errPrefix}${e.message}`, '😕', 5500);
            return undefined;
        }
    }

    // ------------------------------------------------------------------ veri yükleme
    async function loadApp() {
        S.app = await av.state();
        I18N.setLanguage(lang());
        document.documentElement.lang = lang();
        if (!S.activeId || !S.app.projects.some(p => p.id === S.activeId)) S.activeId = S.app.activeId;
    }

    async function loadOverview() {
        if (!S.activeId) {
            S.overview = null;
            return;
        }
        const id = S.activeId;
        try {
            const ov = await av.projects.overview(id);
            if (id !== S.activeId) return;
            S.overview = ov;
            checkGoal(ov);
        } catch (e) {
            // Proje henüz başlatılıyor olabilir
            S.overview = null;
            setTimeout(() => refresh(), 1200);
        }
    }

    async function loadHistory() {
        if (!S.activeId) return;
        S.history = (await run(() => av.projects.history(S.activeId, { file: S.tlFilter || undefined, limit: 500 }))) || [];
    }

    function checkGoal(ov) {
        if (!ov || !ov.stats) return;
        const goal = S.app.prefs.dailyGoal;
        const key = `goal-${ov.id}-${new Date().toDateString()}`;
        if (ov.stats.today >= goal && goal > 0) {
            let seen = false;
            try { seen = localStorage.getItem(key); } catch (e) {}
            if (!seen) {
                try { localStorage.setItem(key, '1'); } catch (e) {}
                setTimeout(() => {
                    confetti();
                    toast(tn('home.goalReached', ov.stats.today), '🏆', 6000);
                }, 400);
            }
        }
    }

    let refreshTimer = null;
    let pendingRefresh = null;
    function refresh({ history = S.tab === 'timeline' } = {}) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
            await loadApp();
            await loadOverview();
            if (history) await loadHistory();
            // "Şu anki değişiklikler" seçiliyken kayıt noktası alındıysa: yeni kaydı göster; açıksa listeyi tazele
            if (S.selectedOid === 'working') {
                if (!S.overview || !S.overview.pendingCount) {
                    S.selectedOid = null;
                    if (S.history[0]) await selectSnapshot(S.history[0].oid, false);
                } else {
                    await selectSnapshot('working', false);
                }
            }
            render();
        }, 150);
    }

    // Eski sürüm düzenlendiyse: emek kaybolmasın, projeye kopya olarak eklemeyi öner
    function oldVersionModal(ev) {
        const m = openModal(`<div style="font-size:40px">📝</div><h2>${t('old.editedTitle')}</h2>
            <p class="sub">${esc(t('old.editedBody', { name: ev.name }))}</p>
            <div class="foot"><button class="btn ghost" data-x="no">${t('old.dismiss')}</button><button class="btn primary" data-x="yes">${t('old.import')}</button></div>`);
        m.querySelector('[data-x=no]').onclick = closeModal;
        m.querySelector('[data-x=yes]').onclick = async () => {
            closeModal();
            const r = await run(() => av.projects.importEdited(ev.projectId, ev.file, ev.rel));
            if (r) {
                toast(t('old.imported', { name: r.name }), '📥', 5000);
                refresh();
            }
        };
    }

    // ------------------------------------------------------------------ çizim
    function render() {
        renderRail();
        renderMain();
        updatePill();
    }

    function projectEmoji(p) {
        return p.emoji || '📘';
    }

    function renderRail() {
        const rail = $('#rail');
        if (!S.app.projects.length) {
            rail.innerHTML = '';
            rail.style.display = 'none';
            return;
        }
        rail.style.display = '';
        rail.classList.toggle('collapsed', S.railCollapsed);
        const gh = S.app.github;
        const dr = S.app.drive;
        rail.innerHTML = `
            <div class="rail-head"><h6>${t('rail.projects')}</h6><button class="rail-toggle" data-action="toggle-rail" title="${S.railCollapsed ? t('rail.expand') : t('rail.collapse')}">${S.railCollapsed ? '»' : '«'}</button></div>
            ${S.app.projects
                .map(
                    p => `<button class="proj-btn ${p.id === S.activeId ? 'active' : ''} ${p.missing ? 'missing' : ''}" data-action="select-project" data-id="${p.id}" title="${esc(p.name)}">
                        <span class="emoji">${projectEmoji(p)}</span>
                        <span style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="psub">${p.missing ? t('rail.folderMissing') : p.id === S.activeId && S.overview && S.overview.stats ? tn('common.words', S.overview.stats.total) : t('rail.protected')}</div></span>
                    </button>`
                )
                .join('')}
            <button class="proj-btn add-btn" data-action="add-project"><span class="emoji">+</span><span>${t('rail.addProject')}</span></button>
            <div class="rail-spacer"></div>
            <div class="rail-cloud" data-action="goto-tab" data-tab="cloud">
                <div class="row">🐙<span class="lbl">GitHub</span> ${gh.connected ? `<span class="ok">${t('rail.connected')}</span>` : `<span class="off">${t('rail.notConnected')}</span>`}</div>
                <div class="row">📁<span class="lbl">Drive</span> ${dr.mode ? `<span class="ok">${t('rail.connected')}</span>` : `<span class="off">${t('rail.notConnected')}</span>`}</div>
            </div>`;
    }

    function renderMain() {
        const main = $('#main');
        if (!S.app.projects.length) {
            main.innerHTML = renderOnboarding();
            return;
        }
        const p = S.app.projects.find(x => x.id === S.activeId);
        if (!p) return;
        const ov = S.overview;
        main.innerHTML = `
            <div class="p-head">
                <div class="p-emoji" data-action="pick-emoji" title="${t('head.changeIcon')}">${projectEmoji(p)}</div>
                <div class="p-title">
                    <h1 data-action="rename" title="${t('head.renameHint')}">${esc(p.name)}</h1>
                    <div class="path" title="${esc(p.dir)}"><a data-action="open-folder">‎📂 ${esc(p.dir)}‎</a></div>
                </div>
                <button class="btn star" data-action="star">${t('head.star')}</button>
                <button class="btn ghost" data-action="settings" title="${t('head.settings')}" style="font-size:18px;padding:8px 10px">⚙️</button>
            </div>
            <div class="tabs">
                <button class="tab ${S.tab === 'home' ? 'active' : ''}" data-action="goto-tab" data-tab="home">${t('tabs.home')}</button>
                <button class="tab ${S.tab === 'timeline' ? 'active' : ''}" data-action="goto-tab" data-tab="timeline">${t('tabs.timeline')}${ov && ov.stats ? `<span class="count">${num(ov.stats.snapshots)}</span>` : ''}</button>
                <button class="tab ${S.tab === 'cloud' ? 'active' : ''}" data-action="goto-tab" data-tab="cloud">${t('tabs.cloud')}</button>
            </div>
            ${
                ov && ov.missing
                    ? renderMissing()
                    : !ov
                      ? `<div class="content"><div class="skeleton" style="height:110px;margin-bottom:14px"></div><div class="skeleton" style="height:220px"></div></div>`
                      : S.tab === 'home'
                        ? renderHome(ov)
                        : S.tab === 'timeline'
                          ? renderTimeline(ov)
                          : renderCloud(ov)
            }`;
        if (S.tab === 'timeline' && ov && !ov.missing) afterTimelineRender();
    }

    function renderOnboarding() {
        return `<div class="onboard"><div class="onboard-inner">
            <div class="hero-emoji">🎓</div>
            <h1>${t('onb.title')}</h1>
            <p class="lead">${t('onb.lead')}</p>
            <div class="feat-grid">
                <div class="feat"><div class="e">🛡️</div><b>${t('onb.f1.title')}</b><span>${t('onb.f1.text')}</span></div>
                <div class="feat"><div class="e">🕰️</div><b>${t('onb.f2.title')}</b><span>${t('onb.f2.text')}</span></div>
                <div class="feat"><div class="e">☁️</div><b>${t('onb.f3.title')}</b><span>${t('onb.f3.text')}</span></div>
            </div>
            <div class="cta">
                <button class="btn primary big" data-action="add-existing">${t('onb.pickFolder')}</button>
                <button class="btn big" data-action="create-new">${t('onb.createNew')}</button>
            </div>
            <p style="color:var(--text-3);font-size:12.5px;margin-top:18px">${t('onb.footnote')}</p>
        </div></div>`;
    }

    function renderMissing() {
        return `<div class="content"><div class="placeholder" style="height:60vh"><div>
            <div class="e">🔍</div><h3>${t('missing.title')}</h3>
            <p>${t('missing.text')}</p>
            <button class="btn primary" data-action="relink">${t('missing.relink')}</button>
        </div></div></div>`;
    }

    // ------------------------------------------------------------------ Özet
    function motivation(st, goal) {
        if (st.today >= goal) return tn('mot.goalDone', st.today);
        if (st.today > 0) return tn('mot.progress', st.today, { left: num(goal - st.today) });
        if (st.streak > 0) return tn('mot.streak', st.streak);
        return t('mot.start');
    }

    function ringSvg(pct) {
        const r = 26;
        const c = 2 * Math.PI * r;
        const off = c * (1 - Math.min(1, pct));
        return `<svg class="ring" viewBox="0 0 64 64"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6c5cff"/><stop offset="1" stop-color="#ec62be"/></linearGradient></defs>
            <circle class="track" cx="32" cy="32" r="${r}"/><circle class="fill" cx="32" cy="32" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
            <text x="32" y="37" text-anchor="middle" font-size="14" font-weight="800" fill="currentColor">${Math.round(Math.min(1, pct) * 100)}%</text></svg>`;
    }

    function fileTypeBox(kind, extraClass = 'ftype') {
        return `<div class="${extraClass} ${kind}">${TYPE_LABEL[kind] || 'FILE'}</div>`;
    }

    function renderHome(ov) {
        const st = ov.stats;
        const goal = S.app.prefs.dailyGoal;
        const user = S.app.github.user;
        const firstName = user && user.name ? user.name.split(' ')[0] : '';
        const maxWeek = Math.max(goal, ...st.week.map(w => w.words), 1);
        const rescues = ov.files.filter(f => f.rescue);
        const files = ov.files.filter(f => !f.rescue);
        const shownFiles = S.showAllFiles ? files : files.slice(0, 12);
        const cloud = ov.cloud;
        const gh = S.app.github.connected;
        const dr = S.app.drive.mode;

        return `<div class="content">
            <div class="greeting"><h2>${greeting()}${firstName ? `, ${esc(firstName)}` : ''}</h2><p>${motivation(st, goal)}</p></div>

            ${rescues.length ? `<div class="banner"><span class="ic">⚡</span><div><div class="t">${tn('home.rescueTitle', rescues.length)}</div><div class="s">${t('home.rescueText')}</div></div><button class="btn sm" data-action="open-file" data-rel="${esc(rescues[0].rel)}">${t('common.open')}</button></div>` : ''}
            ${ov.error ? `<div class="banner error"><span class="ic">⚠️</span><div><div class="t">${t('home.lastSaveFailed')}</div><div class="s">${esc(ov.error)}</div></div></div>` : ''}
            ${!gh && !dr ? `<div class="banner info"><span class="ic">☁️</span><div><div class="t">${t('home.cloudPromptTitle')}</div><div class="s">${t('home.cloudPromptText')}</div></div><button class="btn sm primary" data-action="goto-tab" data-tab="cloud">${t('home.connectCloud')}</button></div>` : ''}

            <div class="stat-grid">
                <div class="stat streak ${st.streak >= 2 ? 'hot' : ''}"><span class="big-emoji">🔥</span><span class="label">${t('stat.streak')}</span><span class="value">${tn('stat.days', st.streak)}</span><span class="hint">${st.streak ? t('stat.keepChain') : t('stat.startToday')}</span></div>
                <div class="stat"><div class="ring-wrap">${ringSvg(goal ? st.today / goal : 0)}<div><span class="label">${t('stat.today')}</span><div class="value" style="font-size:22px">${st.today >= 0 ? '+' : ''}${num(st.today)}</div><span class="hint">${tn('stat.goalHint', goal)}</span></div></div></div>
                <div class="stat"><span class="big-emoji">📚</span><span class="label">${t('stat.totalWords')}</span><span class="value">${num(st.total)}</span><span class="hint">${t('stat.allDocs')}</span></div>
                <div class="stat"><span class="big-emoji">🕰️</span><span class="label">${t('stat.snapshots')}</span><span class="value">${num(st.snapshots)}</span><span class="hint">${st.firstAt ? t('stat.startedAgo', { ago: ago(st.firstAt) }) : ''}</span></div>
            </div>

            <div class="two-col">
                <div class="card">
                    <h3>${t('week.title')}</h3><div class="sub">${t('week.sub')}</div>
                    <div class="week">${st.week
                        .map((w, i) => `<div class="bar-col"><div class="bar ${i === 6 ? 'today' : w.active ? 'active' : ''}" style="height:${Math.max(4, (w.words / maxWeek) * 100)}%">${w.words ? `<span class="tip">${num(w.words)}</span>` : ''}</div><span class="day">${i === 6 ? t('time.today') : typeof w.dow === 'number' ? t('time.daysShort')[w.dow] : esc(w.label)}</span></div>`)
                        .join('')}</div>
                </div>
                <div class="card safe-card">
                    <div><h3>${t('safe.title')}</h3><div class="sub">${t('safe.sub')}</div></div>
                    <div class="safe-row"><span class="ic">💻</span><div><div class="t">${t('safe.thisPc')}</div><div class="s">${t('safe.lastSave', { ago: ago(ov.lastSave) })}</div></div><span class="state on">${t('safe.active')}</span></div>
                    <div class="safe-row"><span class="ic">🐙</span><div><div class="t">${t('safe.github')}</div><div class="s">${gh ? (cloud.syncError ? esc(cloud.syncError) : cloud.lastSync ? t('safe.lastPush', { ago: ago(cloud.lastSync) }) : t('safe.firstPush')) : t('safe.notConnected')}</div></div><span class="state ${gh ? (cloud.syncError ? 'err' : 'on') : 'off'}">${gh ? (cloud.syncError ? '⏳' : '✓') : '—'}</span></div>
                    <div class="safe-row"><span class="ic">📁</span><div><div class="t">Google Drive</div><div class="s">${dr ? (cloud.driveError ? esc(cloud.driveError) : cloud.driveAt ? t('safe.lastCopy', { ago: ago(cloud.driveAt) }) : t('safe.waiting')) : t('safe.notConnected')}</div></div><span class="state ${dr ? (cloud.driveError ? 'err' : 'on') : 'off'}">${dr ? (cloud.driveError ? '⏳' : '✓') : '—'}</span></div>
                </div>
            </div>

            <div class="card files">
                <div class="files-head"><div><h3>${t('files.title')}</h3><div class="sub">${tn('files.sub', files.length)}</div></div>
                    <button class="btn sm" data-action="open-folder">${t('files.openFolder')}</button></div>
                ${
                    files.length
                        ? shownFiles
                              .map(
                                  f => `<div class="file-row" data-action="open-file" data-rel="${esc(f.rel)}" title="${t('files.clickToOpen')}">
                            ${fileTypeBox(f.kind)}
                            <div class="fmain"><div class="fname">${esc(f.name)} ${f.pending ? `<span class="chip pending">${t('files.newChange')}</span>` : ''}</div>
                                <div class="fsub">${f.rel.includes('/') ? esc(f.rel.slice(0, f.rel.lastIndexOf('/'))) + ' · ' : ''}${ago(f.mtime)} · ${sizeText(f.size)}</div></div>
                            ${f.words != null ? `<span class="fwords">${tn('common.words', f.words)}</span>` : ''}
                            <div class="factions"><button class="btn sm" data-action="file-history" data-rel="${esc(f.rel)}">${t('files.history')}</button></div>
                        </div>`
                              )
                              .join('') +
                          (files.length > 12 && !S.showAllFiles ? `<div style="text-align:center;margin-top:8px"><button class="linkish" data-action="show-all-files">${tn('files.showAll', files.length)}</button></div>` : '')
                        : `<div class="empty-files"><div class="e">🗂️</div><p>${t('files.empty')}</p><button class="btn" data-action="open-folder">${t('files.openFolder')}</button></div>`
                }
                ${ov.skippedLarge && ov.skippedLarge.length ? `<div class="banner" style="margin:12px 0 0"><span class="ic">🐘</span><div><div class="t">${tn('files.largeTitle', ov.skippedLarge.length)}</div><div class="s">${t('files.largeText', { list: esc(ov.skippedLarge.slice(0, 3).join(', ')) })}</div></div></div>` : ''}
            </div>
        </div>`;
    }

    // ------------------------------------------------------------------ Zaman makinesi
    function renderTimeline(ov) {
        const docsFirst = [...ov.files].sort((a, b) => (a.kind === 'word' ? -1 : 0) - (b.kind === 'word' ? -1 : 0) || a.rel.localeCompare(b.rel, locale()));
        // Anlık değişiklik satırı varsa "Bugün" başlığı onun üstünde; tekrar etmesin
        let lastDay = ov.pendingCount ? dayLabel(Date.now()) : '';
        const items = S.history
            .map(h => {
                const day = dayLabel(h.time);
                const head = day !== lastDay ? `<div class="tl-day">${day}</div>` : '';
                lastDay = day;
                const words = Object.values(h.delta || {}).reduce((a, b) => a + b, 0);
                return `${head}<div class="tl-item ${h.kind} ${h.oid === S.selectedOid ? 'active' : ''}" data-action="select-snapshot" data-oid="${h.oid}">
                    <div class="node">${KIND_ICON[h.kind] || '💾'}</div>
                    <div class="tmain"><div class="ttitle">${esc(h.title)}</div>
                    <div class="tmeta">${hm(new Date(h.time))}${words > 0 ? `<span class="chip add">+${num(words)}</span>` : words < 0 ? `<span class="chip del">${num(words)}</span>` : ''}${h.kind === 'star' ? `<span class="chip star">${t('tl.star')}</span>` : ''}${h.kind === 'rescue' ? `<span class="chip rescue">${t('tl.rescued')}</span>` : ''}</div></div>
                </div>`;
            })
            .join('');
        // Kayıt noktası alınmamış, dosyada kaydedilmiş değişiklikler (VS Code'daki "Changes" gibi anında görünür)
        const live = ov.pendingCount
            ? `<div class="tl-day">${t('time.today')}</div><div class="tl-item live ${S.selectedOid === 'working' ? 'active' : ''}" data-action="select-snapshot" data-oid="working">
                <div class="node">✏️</div>
                <div class="tmain"><div class="ttitle">${t('tl.liveTitle')}</div>
                <div class="tmeta">${t('tl.liveSub')}<span class="chip pending">${num(ov.pendingCount)}</span></div></div>
            </div>`
            : '';
        return `<div class="content split">
            <div class="tl-side">
                <div class="tl-filter"><select class="select" id="tl-filter">
                    <option value="">${t('tl.allFiles')}</option>
                    ${docsFirst.map(f => `<option value="${esc(f.rel)}" ${f.rel === S.tlFilter ? 'selected' : ''}>${esc(f.rel)}</option>`).join('')}
                </select></div>
                <div class="tl-list">${live}${items || live ? items : `<div class="placeholder" style="height:300px"><div><div class="e">🌱</div><p>${t('tl.empty')}</p></div></div>`}</div>
            </div>
            <div class="tl-detail" id="tl-detail">${renderDetail()}</div>
        </div>`;
    }

    function renderDetail() {
        const isLive = S.selectedOid === 'working';
        const h = isLive
            ? { oid: 'working', kind: 'live', title: t('tl.liveTitle'), note: t('tl.liveHint'), time: Date.now(), author: '' }
            : S.history.find(x => x.oid === S.selectedOid);
        if (!h) {
            return `<div class="placeholder"><div><div class="e">🕰️</div><h3>${t('tl.placeholderTitle')}</h3><p>${t('tl.placeholderText')}</p></div></div>`;
        }
        const sel = S.changes.find(c => c.rel === S.selectedFile);
        return `
            <div class="detail-head">
                <div class="node">${isLive ? '✏️' : KIND_ICON[h.kind] || '💾'}</div>
                <div style="flex:1;min-width:0"><h2>${esc(h.title)}</h2>${isLive ? '' : `<div class="when">${fullDate(h.time)} · ${esc(h.author)}</div>`}${h.note ? `<div class="note">${esc(h.note)}</div>` : ''}</div>
                ${isLive ? `<button class="btn primary" data-action="save-now">${t('tl.saveNow')}</button>` : ''}
            </div>
            <div class="changed-files">${S.changes
                .map(
                    c => `<button class="cf ${c.rel === S.selectedFile ? 'active' : ''}" data-action="select-file" data-rel="${esc(c.rel)}">
                    ${fileTypeBox(c.kind, 'ftype')}${esc(c.rel.split('/').pop())}
                    ${c.change === 'added' ? `<span class="chip add">${t('tl.new')}</span>` : c.change === 'deleted' ? `<span class="chip del">${t('tl.deleted')}</span>` : ''}
                    ${c.delta ? `<span class="chip ${c.delta > 0 ? 'add' : 'del'}">${c.delta > 0 ? '+' : ''}${num(c.delta)}</span>` : ''}
                </button>`
                )
                .join('') || `<span style="color:var(--text-3)">${t('tl.noFileChanges')}</span>`}</div>
            ${
                sel
                    ? `<div class="viewer-bar">
                    <div class="seg"><button class="${S.viewMode === 'diff' ? 'active' : ''}" data-action="view-mode" data-mode="diff">${t('tl.viewDiff')}</button><button class="${S.viewMode === 'preview' ? 'active' : ''}" data-action="view-mode" data-mode="preview">${t('tl.viewDoc')}</button></div>
                    <div class="viewer-actions" ${isLive ? 'hidden' : ''}>
                        ${sel.change !== 'deleted' ? `<button class="btn sm" data-action="open-version">${t('tl.openVersion')}</button><button class="btn sm" data-action="save-copy">${t('tl.saveCopy')}</button>` : ''}
                        <button class="btn sm primary" data-action="restore">${sel.change === 'deleted' ? t('tl.bringBack') : t('tl.restore')}</button>
                    </div>
                </div>
                <div id="viewer"><div class="skeleton" style="height:300px"></div></div>`
                    : ''
            }`;
    }

    async function afterTimelineRender() {
        const f = $('#tl-filter');
        if (f)
            f.onchange = async () => {
                S.tlFilter = f.value;
                S.selectedOid = null;
                await loadHistory();
                if (S.history[0]) await selectSnapshot(S.history[0].oid, false);
                render();
            };
        const active = document.querySelector('.tl-item.active');
        if (active && !active._scrolled) {
            active.scrollIntoView({ block: 'nearest' });
            active._scrolled = true;
        }
        await renderViewer();
    }

    async function selectSnapshot(oid, rerender = true) {
        S.selectedOid = oid;
        S.diffFull = false;
        S.changes = (await run(() => av.projects.changes(S.activeId, oid))) || [];
        const preferred = S.changes.find(c => c.rel === S.tlFilter) || S.changes.find(c => c.rel === S.selectedFile) || S.changes.find(c => c.kind === 'word') || S.changes[0];
        S.selectedFile = preferred ? preferred.rel : null;
        if (rerender) render();
    }

    let viewerSeq = 0;
    async function renderViewer() {
        const box = $('#viewer');
        if (!box || !S.selectedFile || !S.selectedOid) return;
        const seq = ++viewerSeq;
        const sel = S.changes.find(c => c.rel === S.selectedFile);
        if (S.viewMode === 'preview') {
            if (sel.change === 'deleted') {
                box.innerHTML = `<div class="plain-lines">${t('viewer.deleted')}</div>`;
                return;
            }
            if (sel.kind === 'word') {
                const buf = await run(() => av.projects.fileBuffer(S.activeId, S.selectedFile, S.selectedOid));
                if (seq !== viewerSeq || !buf) return;
                box.innerHTML = '<div class="preview-box" id="docx-box"></div>';
                try {
                    const holder = $('#docx-box');
                    await window.docx.renderAsync(buf, holder, null, { inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true });
                    // A4 sayfayı kutunun genişliğine sığdır
                    const wrapper = holder.querySelector('.docx-wrapper');
                    const page = holder.querySelector('section.docx');
                    if (wrapper && page) {
                        const scale = (holder.clientWidth - 32) / page.offsetWidth;
                        if (scale < 1) wrapper.style.zoom = scale;
                    }
                } catch (e) {
                    box.innerHTML = `<div class="plain-lines">${t('viewer.previewFailed')}</div>`;
                }
                return;
            }
            if (sel.kind === 'image') {
                const buf = await run(() => av.projects.fileBuffer(S.activeId, S.selectedFile, S.selectedOid));
                if (seq !== viewerSeq || !buf) return;
                const url = URL.createObjectURL(new Blob([buf]));
                box.innerHTML = `<div class="preview-box"><img src="${url}" style="max-width:100%;border-radius:10px"></div>`;
                return;
            }
            box.innerHTML = `<div class="plain-lines">${t('viewer.noPreview')}</div>`;
            return;
        }
        const d = await run(() => av.projects.diff(S.activeId, S.selectedFile, S.selectedOid));
        if (seq !== viewerSeq || !d) return;
        if (!d.supported) {
            box.innerHTML = `<div class="plain-lines">${t('viewer.noCompare')}</div>`;
            return;
        }
        box.innerHTML = renderDiff(d);
    }

    function renderDiff(d) {
        const blocks = d.blocks;
        if (!blocks.some(b => b.type !== 'same')) {
            return `<div class="plain-lines">${t('viewer.noTextChange')}</div>`;
        }
        const show = new Array(blocks.length).fill(S.diffFull);
        if (!S.diffFull) {
            blocks.forEach((b, i) => {
                if (b.type !== 'same') for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < blocks.length) show[k] = true;
            });
        }
        let html = '';
        let hidden = 0;
        const flush = () => {
            if (hidden) html += `<div class="gap" data-action="diff-full">${tn('viewer.gap', hidden)}</div>`;
            hidden = 0;
        };
        blocks.forEach((b, i) => {
            if (!show[i]) {
                hidden++;
                return;
            }
            flush();
            if (b.type === 'same') html += `<p class="same">${esc(b.text)}</p>`;
            else if (b.type === 'add') html += `<p class="add">${esc(b.text)}</p>`;
            else if (b.type === 'del') html += `<p class="del">${esc(b.text)}</p>`;
            else html += `<p>${b.parts.map(p => (p.a ? `<ins>${esc(p.t)}</ins>` : p.r ? `<del>${esc(p.t)}</del>` : esc(p.t))).join('')}</p>`;
        });
        flush();
        const first = !d.existedBefore;
        return `<div class="diff-summary">${first ? `<span class="chip mod">${t('viewer.first')}</span>` : ''}${d.added ? `<span class="chip add">${tn('viewer.added', d.added)}</span>` : ''}${d.removed ? `<span class="chip del">${tn('viewer.removed', d.removed)}</span>` : ''}</div><div class="diff">${html}</div>`;
    }

    // ------------------------------------------------------------------ Bulut
    function renderCloud(ov) {
        const gh = S.app.github;
        const dr = S.app.drive;
        const c = ov.cloud;
        const ghBody = gh.connected
            ? `<div class="user-row">${gh.user && gh.user.avatar ? `<img src="${esc(gh.user.avatar)}">` : '<span style="font-size:30px">🐙</span>'}<div><div class="nm">${esc(gh.user ? gh.user.name : '')}</div><div class="lg">@${esc(gh.user ? gh.user.login : '')}</div></div></div>
               <div class="sub">${c.syncing ? `<span class="spinner" style="display:inline-block;vertical-align:-3px"></span> ${t('cloud.sending')}` : c.syncError ? `⏳ ${esc(c.syncError)}` : c.lastSync ? t('cloud.lastPush', { ago: ago(c.lastSync) }) : t('cloud.firstSoon')}
               ${c.github ? `<br>${t('cloud.privateRepo', { link: `<button class="linkish" data-action="open-url" data-url="${esc(c.github.url || `https://github.com/${c.github.owner}/${c.github.repo}`)}">${esc(c.github.owner)}/${esc(c.github.repo)}</button>` })}` : ''}</div>
               <div class="actions"><button class="btn primary" data-action="sync-now" ${c.syncing ? 'disabled' : ''}>${t('cloud.syncNow')}</button><button class="btn ghost" data-action="github-logout">${t('cloud.logout')}</button></div>`
            : `<div class="sub">${t('cloud.ghPitch')}</div>
               <div class="actions"><button class="btn primary" data-action="github-login">${t('cloud.ghLogin')}</button><button class="btn ghost" data-action="open-url" data-url="https://github.com/signup">${t('cloud.ghSignup')}</button></div>`;

        let drBody;
        if (dr.mode === 'folder') {
            drBody = `<div class="user-row"><span style="font-size:28px">📁</span><div style="min-width:0"><div class="nm">${t('cloud.driveFolder')}</div><div class="lg" style="word-break:break-all">${esc(dr.folder)}\\DraftRewind</div></div></div>
                <div class="sub">${c.driveError ? `⏳ ${esc(c.driveError)}` : c.driveAt ? t('cloud.lastCopy', { ago: ago(c.driveAt) }) : t('cloud.copying')}<br>${t('cloud.folderInfo')}</div>
                <div class="actions"><button class="btn primary" data-action="drive-open">${t('cloud.openDriveFolder')}</button><button class="btn ghost" data-action="drive-disconnect">${t('cloud.disconnect')}</button></div>`;
        } else if (dr.mode === 'account') {
            drBody = `<div class="user-row">${dr.user && dr.user.picture ? `<img src="${esc(dr.user.picture)}">` : '<span style="font-size:28px">📁</span>'}<div><div class="nm">${esc(dr.user ? dr.user.name : t('cloud.googleAccount'))}</div><div class="lg">${esc(dr.user ? dr.user.email : '')}</div></div></div>
                <div class="sub">${c.driveError ? `⏳ ${esc(c.driveError)}` : c.driveAt ? t('cloud.lastUpload', { ago: ago(c.driveAt) }) : t('cloud.uploading')}<br>${t('cloud.accountInfo', { name: esc(ov.name) })}</div>
                <div class="actions"><button class="btn primary" data-action="drive-open" ${c.driveUrl ? '' : 'disabled'}>${t('cloud.openInDrive')}</button><button class="btn ghost" data-action="drive-disconnect">${t('cloud.disconnect')}</button></div>`;
        } else {
            const det = dr.detected.filter(d => d.kind === 'gdrive');
            const other = dr.detected.filter(d => d.kind !== 'gdrive');
            drBody = `<div class="sub">${t('cloud.drivePitch')}</div>
                <div class="detected">
                    ${dr.accountAvailable ? `<button class="btn primary" data-action="drive-signin">${t('cloud.googleSignin')}</button>` : ''}
                    ${det.map(d => `<button class="btn" data-action="drive-folder" data-path="${esc(d.path)}">${t('cloud.useDetected', { label: esc(d.label) })} <span style="margin-left:auto;color:var(--text-3);font-weight:400">${t('cloud.noLogin')}</span></button>`).join('')}
                    ${other.map(d => `<button class="btn ghost" data-action="drive-folder" data-path="${esc(d.path)}">${t('cloud.useOther', { label: esc(d.label) })}</button>`).join('')}
                    <button class="btn ghost" data-action="drive-folder">${t('cloud.pickOther')}</button>
                </div>`;
        }

        return `<div class="content">
            <div class="cloud-grid">
                <div class="card cloud-card"><div class="top"><div class="logo">🐙</div><div><h3>${t('cloud.ghTitle')}</h3><div class="sub">${t('cloud.ghSub')}</div></div><span class="badge chip ${gh.connected ? 'add' : 'mod'}">${gh.connected ? t('cloud.connected') : t('cloud.recommended')}</span></div>${ghBody}</div>
                <div class="card cloud-card"><div class="top"><div class="logo">📁</div><div><h3>Google Drive</h3><div class="sub">${t('cloud.driveSub')}</div></div><span class="badge chip ${dr.mode ? 'add' : 'mod'}">${dr.mode ? t('cloud.connected') : t('cloud.optional')}</span></div>${drBody}</div>
                <div class="card phone-card">
                    <div class="phone-mock">📱</div>
                    <div><h3>${t('cloud.phoneTitle')}</h3>
                    <div class="sub">${t('cloud.phoneText')}</div>
                    <div class="steps"><span class="step">${t('cloud.step1')}</span><span class="step">${t('cloud.step2')}</span><span class="step">${t('cloud.step3')}</span></div></div>
                </div>
            </div>
        </div>`;
    }

    // ------------------------------------------------------------------ durum göstergesi
    function updatePill() {
        const pill = $('#status-pill');
        const ov = S.overview;
        if (!S.activeId || !ov) {
            pill.hidden = true;
            return;
        }
        pill.hidden = false;
        pill.className = 'status-pill';
        let text;
        if (ov.missing) {
            pill.classList.add('warn');
            text = t('rail.folderMissing');
        } else if (S.pending[S.activeId]) {
            pill.classList.add('pending');
            text = t('pill.pending');
        } else if (S.syncing[S.activeId]) {
            pill.classList.add('syncing');
            text = t('pill.syncing');
        } else {
            text = t('pill.protected', { ago: ago(ov.lastSave) });
        }
        pill.innerHTML = `<span class="dot"></span>${text}`;
    }
    function flashPill() {
        const pill = $('#status-pill');
        pill.classList.add('flash');
        setTimeout(() => pill.classList.remove('flash'), 600);
    }
    setInterval(updatePill, 30000);

    // ------------------------------------------------------------------ eylemler
    async function addExisting() {
        const id = await run(() => av.projects.add());
        if (!id) return;
        S.activeId = id;
        S.tab = 'home';
        toast(t('toast.folderProtected'), '🎉');
        confetti();
        refresh();
    }

    async function createNew() {
        const name = await promptModal({ title: t('newProj.title'), sub: t('newProj.sub'), placeholder: t('newProj.placeholder'), ok: t('newProj.ok'), emoji: '✨' });
        if (!name) return;
        const id = await run(() => av.projects.create(name));
        if (!id) return;
        S.activeId = id;
        S.tab = 'home';
        toast(t('toast.folderReady'), '🎉');
        refresh();
    }

    function addProjectModal() {
        const m = openModal(`<div style="font-size:40px">🗂️</div><h2>${t('addProj.title')}</h2><p class="sub">${t('addProj.sub')}</p>
            <div style="display:grid;gap:10px">
                <button class="btn big primary" data-x="existing">${t('addProj.existing')}</button>
                <button class="btn big" data-x="new">${t('addProj.new')}</button>
            </div>`);
        m.querySelector('[data-x=existing]').onclick = () => { closeModal(); addExisting(); };
        m.querySelector('[data-x=new]').onclick = () => { closeModal(); createNew(); };
    }

    function starModal() {
        const m = openModal(`<div style="font-size:40px">⭐</div><h2>${t('star.title')}</h2>
            <p class="sub">${t('star.sub')}</p>
            <input class="input" id="star-title" placeholder="${esc(t('star.placeholder'))}">
            <div class="quick-chips">${t('star.quick').map(q => `<button data-t="${esc(q)}">${esc(q)}</button>`).join('')}</div>
            <label class="field">${t('star.noteLabel')}</label>
            <textarea class="input" id="star-note" rows="2" placeholder="${esc(t('star.notePlaceholder'))}"></textarea>
            <div class="foot"><button class="btn ghost" data-x="no">${t('common.cancel')}</button><button class="btn star" data-x="yes">${t('star.ok')}</button></div>`);
        const title = m.querySelector('#star-title');
        m.querySelectorAll('.quick-chips button').forEach(b => (b.onclick = () => { title.value = b.dataset.t; title.focus(); }));
        m.querySelector('[data-x=no]').onclick = closeModal;
        const go = async () => {
            const name = title.value.trim();
            if (!name) {
                title.focus();
                return;
            }
            const note = m.querySelector('#star-note').value.trim();
            closeModal();
            const r = await run(() => av.projects.snapshot(S.activeId, { star: true, title: `⭐ ${name}`, note }));
            if (r !== undefined) {
                confetti();
                toast(t('star.done', { t: name }), '⭐');
                refresh({ history: true });
            }
        };
        m.querySelector('[data-x=yes]').onclick = go;
        title.addEventListener('keydown', e => e.key === 'Enter' && go());
    }

    function emojiModal() {
        const m = openModal(`<h2>${t('emoji.title')}</h2><p class="sub">${t('emoji.sub')}</p><div class="emoji-grid">${EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>`);
        m.querySelectorAll('[data-e]').forEach(b => (b.onclick = async () => {
            closeModal();
            await run(() => av.projects.update(S.activeId, { emoji: b.dataset.e }));
            refresh();
        }));
    }

    async function renameProject() {
        const p = S.app.projects.find(x => x.id === S.activeId);
        const name = await promptModal({ title: t('rename.title'), value: p.name });
        if (!name) return;
        await run(() => av.projects.update(S.activeId, { name }));
        refresh();
    }

    function settingsModal() {
        const pr = S.app.prefs;
        const win = S.app.platform === 'win32';
        const seg = (id, current, opts) =>
            `<div class="seg" id="${id}">${opts.map(([v, label]) => `<button class="${current === v ? 'active' : ''}" data-v="${v}">${label}</button>`).join('')}</div>`;
        const m = openModal(`<h2>${t('settings.title')}</h2><p class="sub">${t('settings.sub')}</p>
            <div class="setting-row"><div><div class="t">${t('settings.language')}</div><div class="s">${t('settings.languageHint')}</div></div>${seg('pref-lang', pr.language || 'auto', [['auto', t('settings.langAuto')], ['tr', t('settings.langTr')], ['en', t('settings.langEn')]])}</div>
            <div class="setting-row"><div><div class="t">${t('settings.theme')}</div><div class="s">${t('settings.themeHint')}</div></div>${seg('pref-theme', pr.theme || 'system', [['system', t('settings.themeSystem')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')]])}</div>
            <div class="setting-row"><div><div class="t">${t('settings.goal')}</div><div class="s">${t('settings.goalHint')}</div></div><input type="range" id="goal" min="100" max="3000" step="50" value="${pr.dailyGoal}"><b id="goal-v" style="width:48px;text-align:right">${pr.dailyGoal}</b></div>
            ${win ? `<div class="setting-row"><div><div class="t">${t('settings.guardian')}</div><div class="s">${t('settings.guardianHint')}</div></div><label class="switch"><input type="checkbox" id="guardian" ${pr.guardian ? 'checked' : ''}><span></span></label></div>` : ''}
            <div class="setting-row"><div><div class="t">${t('settings.autostart')}</div><div class="s">${t('settings.autostartHint')}</div></div><label class="switch"><input type="checkbox" id="autostart" ${pr.autostart ? 'checked' : ''}><span></span></label></div>
            <div class="setting-row"><div><div class="t">${t('settings.relink')}</div><div class="s">${t('settings.relinkHint')}</div></div><button class="btn sm" id="relink">${t('settings.relinkBtn')}</button></div>
            <div class="setting-row"><div><div class="t">${t('settings.remove')}</div><div class="s">${t('settings.removeHint')}</div></div><button class="btn sm danger" id="remove">${t('settings.removeBtn')}</button></div>
            <div class="foot"><span style="margin-right:auto;color:var(--text-3);font-size:12px;align-self:center">DraftRewind ${esc(S.app.version)}</span><button class="btn primary" id="done">${t('common.ok')}</button></div>`);
        // Dil / tema: anında uygula, arayüzü yeni dilde yeniden çiz ve ayarları yeniden aç
        const bindSeg = (id, key) =>
            m.querySelectorAll(`#${id} button`).forEach(b => (b.onclick = async () => {
                if (b.classList.contains('active')) return;
                await run(() => av.setPref(key, b.dataset.v));
                await loadApp();
                render();
                settingsModal();
            }));
        bindSeg('pref-lang', 'language');
        bindSeg('pref-theme', 'theme');
        const goal = m.querySelector('#goal');
        goal.oninput = () => (m.querySelector('#goal-v').textContent = goal.value);
        goal.onchange = async () => { S.app.prefs = await av.setPref('dailyGoal', Number(goal.value)); };
        const g = m.querySelector('#guardian');
        if (g) g.onchange = async () => { S.app.prefs = await av.setPref('guardian', g.checked); };
        const a = m.querySelector('#autostart');
        a.onchange = async () => { S.app.prefs = await av.setPref('autostart', a.checked); };
        m.querySelector('#relink').onclick = async () => { closeModal(); if (await run(() => av.projects.relink(S.activeId))) { toast(t('toast.relinked'), '📂'); refresh(); } };
        m.querySelector('#remove').onclick = async () => {
            closeModal();
            const ok = await confirmModal({ title: t('remove.title'), text: t('remove.text'), ok: t('settings.removeBtn'), danger: true, emoji: '🗑️' });
            if (!ok) return;
            await run(() => av.projects.remove(S.activeId));
            S.activeId = null;
            S.overview = null;
            refresh();
        };
        m.querySelector('#done').onclick = () => { closeModal(); refresh(); };
    }

    async function githubLogin() {
        const r = await run(() => av.github.login(), 'GitHub: ');
        if (!r) return;
        const code = r.code.split('');
        const m = openModal(`<div style="text-align:center"><div style="font-size:40px">🐙</div><h2>${t('gh.title')}</h2>
            <p class="sub">${t('gh.text')}</p>
            <div class="code-boxes">${code.map((ch, i) => (ch === '-' ? '<span class="dash">–</span>' : `<span style="animation-delay:${i * 40}ms">${esc(ch)}</span>`)).join('')}</div>
            <div class="waiting" id="gh-wait"><span class="spinner"></span> ${t('gh.waiting')}</div>
            <div class="foot" style="justify-content:center"><button class="btn ghost" data-x="copy">${t('gh.copyAgain')}</button><button class="btn" data-x="open">${t('gh.openAgain')}</button><button class="btn ghost" data-x="cancel">${t('common.cancel')}</button></div></div>`,
            { onClose: () => { if (S.loginModal) av.github.cancel(); S.loginModal = null; } }
        );
        S.loginModal = m;
        m.querySelector('[data-x=copy]').onclick = () => { navigator.clipboard.writeText(r.code); toast(t('gh.copied'), '📋'); };
        m.querySelector('[data-x=open]').onclick = () => av.openExternal(r.url);
        m.querySelector('[data-x=cancel]').onclick = closeModal;
    }

    async function restoreSelected(mode) {
        const h = S.history.find(x => x.oid === S.selectedOid);
        const sel = S.changes.find(c => c.rel === S.selectedFile);
        if (!h || !sel) return;
        const name = sel.rel.split('/').pop();
        if (mode === 'copy') {
            const r = await run(() => av.projects.restore(S.activeId, sel.rel, h.oid, 'copy'));
            if (r) toast(t('restore.copied'), '📑');
            return;
        }
        const ok = await confirmModal({
            emoji: '↩️',
            title: t('restore.title', { name }),
            text: t('restore.text', { date: fullDate(h.time) }),
            ok: t('restore.ok')
        });
        if (!ok) return;
        const r = await run(() => av.projects.restore(S.activeId, sel.rel, h.oid, 'replace'));
        if (r) {
            toast(t('restore.done', { name }), '✨');
            S.selectedOid = null;
            refresh({ history: true });
        }
    }

    const actions = {
        'select-project': async d => {
            S.activeId = d.id;
            S.overview = null;
            S.selectedOid = null;
            S.tlFilter = '';
            S.showAllFiles = false;
            av.projects.setActive(d.id);
            render();
            refresh({ history: S.tab === 'timeline' });
        },
        'add-project': addProjectModal,
        'toggle-rail': () => {
            S.railCollapsed = !S.railCollapsed;
            try { localStorage.setItem('railCollapsed', S.railCollapsed ? '1' : '0'); } catch (e) {}
            renderRail();
        },
        'add-existing': addExisting,
        'create-new': createNew,
        'goto-tab': async d => {
            S.tab = d.tab;
            if (d.tab === 'timeline') {
                await loadHistory();
                if (!S.selectedOid && S.history[0]) await selectSnapshot(S.history[0].oid, false);
            }
            render();
        },
        'open-folder': () => run(() => av.projects.openFolder(S.activeId)),
        'open-file': d => run(() => av.projects.openFile(S.activeId, d.rel)),
        'file-history': async (d, el, e) => {
            e.stopPropagation();
            S.tab = 'timeline';
            S.tlFilter = d.rel;
            S.selectedOid = null;
            await loadHistory();
            if (S.history[0]) await selectSnapshot(S.history[0].oid, false);
            render();
        },
        'show-all-files': () => { S.showAllFiles = true; render(); },
        'select-snapshot': d => selectSnapshot(d.oid),
        'select-file': d => { S.selectedFile = d.rel; S.diffFull = false; render(); },
        'view-mode': d => { S.viewMode = d.mode; render(); },
        'diff-full': () => { S.diffFull = true; renderViewer(); },
        'open-version': async () => {
            const ok = await run(() => av.projects.openVersion(S.activeId, S.selectedFile, S.selectedOid));
            if (ok) toast(t('old.openedToast'), '🔒', 6000);
        },
        'save-now': async () => {
            const r = await run(() => av.projects.snapshot(S.activeId, {}));
            if (r !== undefined) {
                S.selectedOid = null;
                refresh({ history: true });
            }
        },
        'save-copy': () => restoreSelected('copy'),
        restore: () => restoreSelected('replace'),
        star: starModal,
        'pick-emoji': emojiModal,
        rename: renameProject,
        settings: settingsModal,
        relink: async () => { if (await run(() => av.projects.relink(S.activeId))) refresh(); },
        'github-login': githubLogin,
        'github-logout': async () => {
            const ok = await confirmModal({ title: t('ghLogout.title'), text: t('ghLogout.text'), ok: t('cloud.logout'), danger: true, emoji: '👋' });
            if (!ok) return;
            await run(() => av.github.logout());
            refresh();
        },
        'sync-now': async () => {
            S.syncing[S.activeId] = true;
            render();
            const r = await run(() => av.github.syncNow(S.activeId));
            S.syncing[S.activeId] = false;
            if (r && !r.syncError) toast(t('toast.synced'), '☁️');
            refresh();
        },
        'drive-folder': async d => {
            const r = await run(() => av.drive.useFolder(d.path || null));
            if (r) {
                toast(t('toast.driveConnected'), '🎉');
                confetti();
            }
            refresh();
        },
        'drive-signin': async () => {
            toast(t('toast.googleOpening'), '🔐');
            const r = await run(() => av.drive.signIn(), 'Google: ');
            if (r) {
                toast(t('toast.googleConnected'), '📁');
                confetti();
            }
            refresh();
        },
        'drive-disconnect': async () => {
            const ok = await confirmModal({ title: t('driveLogout.title'), text: t('driveLogout.text'), ok: t('cloud.disconnect'), danger: true, emoji: '📁' });
            if (!ok) return;
            await run(() => av.drive.disconnect());
            refresh();
        },
        'drive-open': () => run(() => av.drive.open(S.activeId)),
        'open-url': d => av.openExternal(d.url)
    };

    document.addEventListener('click', e => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const fn = actions[el.dataset.action];
        if (fn) fn(el.dataset, el, e);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.activeId) {
            e.preventDefault();
            av.projects.snapshot(S.activeId, {}).then(() => toast(t('toast.saved'), '💾'));
        }
    });

    // ------------------------------------------------------------------ ana süreçten olaylar
    av.onEvent(async ev => {
        switch (ev.type) {
            case 'pending':
                S.pending[ev.projectId] = true;
                if (ev.projectId === S.activeId) {
                    updatePill();
                    // Kaydedilen değişiklik hemen görünsün (kayıt noktası birazdan alınacak)
                    clearTimeout(pendingRefresh);
                    pendingRefresh = setTimeout(() => refresh({ history: S.tab === 'timeline' }), 900);
                }
                break;
            case 'oldVersionEdited':
                oldVersionModal(ev);
                break;
            case 'snapshot':
                S.pending[ev.projectId] = false;
                if (ev.projectId === S.activeId) {
                    if (ev.snapshot) flashPill();
                    refresh({ history: S.tab === 'timeline' });
                }
                break;
            case 'cloud':
                if (typeof ev.syncing === 'boolean') S.syncing[ev.projectId] = ev.syncing;
                if (ev.projectId === S.activeId) refresh({ history: false });
                break;
            case 'toast':
                toast(ev.text, ev.icon);
                break;
            case 'project':
                refresh();
                break;
            case 'github':
                if (ev.state === 'connected') {
                    S.loginModal = null;
                    closeModal();
                    confetti();
                    toast(t('toast.welcome', { name: ev.user.name }), '🐙', 5000);
                    refresh();
                } else if (ev.state === 'error' && S.loginModal) {
                    const w = S.loginModal.querySelector('#gh-wait');
                    if (w) w.innerHTML = `😕 ${esc(ev.message)}`;
                }
                break;
        }
    });

    (async () => {
        await loadApp();
        await loadOverview();
        render();
    })();
})();
