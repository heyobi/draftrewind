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
        loginModal: null,
        aiCache: {}
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
    const ic = (name, cls) => window.Icons.icon(name, cls);
    // Proje rozeti: renkli kare + baş harfler (emoji yerine)
    const PROJECT_COLORS = ['#6c5cff', '#2f80ed', '#0ea5a4', '#16a34a', '#ca8a04', '#ea580c', '#e11d48', '#c026d3', '#475569', '#0f766e'];
    const KIND_ICON = { auto: 'save', star: 'star', rescue: 'bolt', restore: 'undo', merge: 'merge', mobile: 'phone' };
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
    function toast(text, icon = 'sparkle', ms = 3800) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = `<span class="ic">${ic(icon)}</span><span>${esc(text)}</span>`;
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
    function confirmModal({ title, text, ok = t('common.ok'), danger = false, emoji = 'help' }) {
        return new Promise(resolve => {
            let answered = false;
            const m = openModal(
                `<div class="modal-ic${danger ? ' danger' : ''}">${ic(emoji)}</div><h2>${esc(title)}</h2><p class="sub">${text}</p>
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
    function promptModal({ title, sub, value = '', placeholder = '', ok = t('common.save'), emoji = 'pencil' }) {
        return new Promise(resolve => {
            let answered = false;
            const m = openModal(
                `<div class="modal-ic">${ic(emoji)}</div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}
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
            toast(`${errPrefix}${e.message}`, 'error', 5500);
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
                    toast(tn('home.goalReached', ov.stats.today), 'trophy', 6000);
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
        const m = openModal(`<div class="modal-ic">${ic('doc')}</div><h2>${t('old.editedTitle')}</h2>
            <p class="sub">${esc(t('old.editedBody', { name: ev.name }))}</p>
            <div class="foot"><button class="btn ghost" data-x="no">${t('old.dismiss')}</button><button class="btn primary" data-x="yes">${t('old.import')}</button></div>`);
        m.querySelector('[data-x=no]').onclick = closeModal;
        m.querySelector('[data-x=yes]').onclick = async () => {
            closeModal();
            const r = await run(() => av.projects.importEdited(ev.projectId, ev.file, ev.rel));
            if (r) {
                toast(t('old.imported', { name: r.name }), 'inbox', 5000);
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

    function projectColor(p) {
        if (p.color && PROJECT_COLORS.includes(p.color)) return p.color;
        let h = 0;
        for (const ch of String(p.id || p.name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return PROJECT_COLORS[h % PROJECT_COLORS.length];
    }
    function projectInitials(p) {
        const words = String(p.name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
        const a = words[0] ? [...words[0]][0] : '?';
        const b = words[1] ? [...words[1]][0] : words[0] && [...words[0]][1] ? [...words[0]][1] : '';
        return (a + b).toLocaleUpperCase(locale());
    }
    function projectTile(p) {
        return `<span class="ptile" style="--c:${projectColor(p)}">${esc(projectInitials(p))}</span>`;
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
                        <span class="emoji">${projectTile(p)}</span>
                        <span style="min-width:0"><div class="pname">${esc(p.name)}</div><div class="psub">${p.missing ? t('rail.folderMissing') : p.id === S.activeId && S.overview && S.overview.stats ? tn('common.words', S.overview.stats.total) : t('rail.protected')}</div></span>
                    </button>`
                )
                .join('')}
            <button class="proj-btn add-btn" data-action="add-project" title="${esc(t('rail.addProject'))}"><span class="emoji">+</span><span>${t('rail.addProject')}</span></button>
            <div class="rail-spacer"></div>
            <div class="rail-cloud" data-action="goto-tab" data-tab="cloud" title="${esc(t('tabs.cloud'))}">
                <div class="row">${ic('github')}<span class="lbl">GitHub</span> ${gh.connected ? `<span class="ok">${t('rail.connected')}</span>` : `<span class="off">${t('rail.notConnected')}</span>`}</div>
                <div class="row">${ic('drive')}<span class="lbl">Drive</span> ${dr.mode ? `<span class="ok">${t('rail.connected')}</span>` : `<span class="off">${t('rail.notConnected')}</span>`}</div>
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
                <div class="p-emoji" data-action="pick-emoji" title="${t('head.changeIcon')}">${projectTile(p)}</div>
                <div class="p-title">
                    <h1 data-action="rename" title="${t('head.renameHint')}">${esc(p.name)}</h1>
                    <div class="path" title="${esc(p.dir)}"><a data-action="open-folder">‎${ic('folderOpen')} ${esc(p.dir)}‎</a></div>
                </div>
                <button class="btn star" data-action="star" title="${esc(t('head.starTip'))}">${ic('star')} ${t('head.star')}</button>
                <button class="btn ghost" data-action="help" title="F1">${ic('help')} ${t('head.help')}</button>
                <button class="btn ghost" data-action="settings">${ic('settings')} ${t('head.settings')}</button>
            </div>
            <div class="tabs">
                <button class="tab ${S.tab === 'home' ? 'active' : ''}" data-action="goto-tab" data-tab="home" title="Ctrl+1"><span class="tl">${t('tabs.home')}</span><span class="ts">${t('tabs.homeSub')}</span></button>
                <button class="tab ${S.tab === 'timeline' ? 'active' : ''}" data-action="goto-tab" data-tab="timeline" title="Ctrl+2"><span class="tl">${t('tabs.timeline')}${ov && ov.stats ? `<span class="count">${num(ov.stats.snapshots)}</span>` : ''}</span><span class="ts">${t('tabs.timelineSub')}</span></button>
                <button class="tab ${S.tab === 'cloud' ? 'active' : ''}" data-action="goto-tab" data-tab="cloud" title="Ctrl+3"><span class="tl">${t('tabs.cloud')}</span><span class="ts">${t('tabs.cloudSub')}</span></button>
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
            <div class="hero-emoji">${ic('cap')}</div>
            <h1>${t('onb.title')}</h1>
            <p class="lead">${t('onb.lead')}</p>
            <div class="feat-grid">
                <div class="feat"><div class="e">${ic('shield')}</div><b>${t('onb.f1.title')}</b><span>${t('onb.f1.text')}</span></div>
                <div class="feat"><div class="e">${ic('history')}</div><b>${t('onb.f2.title')}</b><span>${t('onb.f2.text')}</span></div>
                <div class="feat"><div class="e">${ic('cloud')}</div><b>${t('onb.f3.title')}</b><span>${t('onb.f3.text')}</span></div>
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
            <div class="e">${ic('search')}</div><h3>${t('missing.title')}</h3>
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

    // Dosyanın nerelerde yedekli olduğu (alanlar henüz yoksa hiçbir şey gösterme)
    function backupBadges(f) {
        const b = f && f.backup;
        if (!b || typeof b !== 'object') return '';
        const icons = [];
        if (b.history) icons.push(`<span class="bk on" title="${esc(t('bk.history'))}">${ic('history')}</span>`);
        if (S.app.github.connected && b.history && b.github != null) {
            const on = b.github === true;
            icons.push(`<span class="bk ${on ? 'on' : 'muted'}" title="${esc(on ? t('bk.github') : t('bk.githubPending'))}">${ic('github')}</span>`);
        }
        if (b.drive != null) {
            const on = b.drive === true;
            icons.push(`<span class="bk ${on ? 'on' : 'muted'}" title="${esc(on ? t('bk.drive') : b.reason === 'driveError' ? t('bk.reason.driveError') : t('bk.drivePending'))}">${ic('drive')}</span>`);
        }
        const reasonKey = `bk.reason.${b.reason || 'unknown'}`;
        const reason = t(reasonKey) === reasonKey ? t('bk.reason.unknown') : t(reasonKey);
        const warn = b.history === false && b.drive !== true ? `<span class="chip warn" title="${esc(reason)}">${t('bk.notBacked')}</span>` : '';
        return `<span class="fbackup">${warn}${icons.join('')}</span>`;
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
        // Yalnızca bu bilgisayarda olan dosyalar (yol dizisi ya da { rel, … } nesneleri)
        const unprotected = (Array.isArray(ov.unprotected) ? ov.unprotected : []).map(u => (typeof u === 'string' ? u : u && u.rel)).filter(Boolean);

        return `<div class="content">
            <div class="greeting"><h2>${greeting()}${firstName ? `, ${esc(firstName)}` : ''}</h2><p>${motivation(st, goal)}</p></div>

            ${dismissed().guide ? '' : `<div class="card guide">
                <div class="guide-head"><h3>${t('guide.title')}</h3><button class="dismiss-x" data-action="dismiss" data-key="guide" title="${esc(t('tips.hide'))}" aria-label="${esc(t('tips.hide'))}">✕</button></div>
                <div class="guide-steps">
                    <div class="gstep"><span class="gn">1</span><div><b>${t('guide.s1t')}</b><p>${t('guide.s1x')}</p></div></div>
                    <div class="gstep"><span class="gn">2</span><div><b>${t('guide.s2t')}</b><p>${t('guide.s2x')}</p></div></div>
                    <div class="gstep"><span class="gn">3</span><div><b>${t('guide.s3t')}</b><p>${t('guide.s3x')}</p><button class="btn sm" data-action="goto-tab" data-tab="timeline">${t('guide.openTimeline')}</button></div></div>
                    <div class="gstep"><span class="gn">4</span><div><b>${t('guide.s4t')}</b><p>${t('guide.s4x')}</p><button class="btn sm" data-action="goto-tab" data-tab="cloud">${t('tabs.cloud')}</button></div></div>
                </div>
            </div>`}

            ${rescues.length ? `<div class="banner"><span class="ic">${ic('bolt')}</span><div><div class="t">${tn('home.rescueTitle', rescues.length)}</div><div class="s">${t('home.rescueText')}</div></div><button class="btn sm" data-action="open-file" data-rel="${esc(rescues[0].rel)}">${t('common.open')}</button></div>` : ''}
            ${ov.error ? `<div class="banner error"><span class="ic">${ic('alert')}</span><div><div class="t">${t('home.lastSaveFailed')}</div><div class="s">${esc(ov.error)}</div></div></div>` : ''}
            ${unprotected.length ? `<div class="banner error"><span class="ic">${ic('shieldOff')}</span><div><div class="t">${tn('bk.bannerTitle', unprotected.length)}</div><div class="s">${tn(dr ? 'bk.bannerTextDrive' : 'bk.bannerText', unprotected.length)} <span class="bk-list">${esc(unprotected.slice(0, 3).map(r => r.split('/').pop()).join(', '))}${unprotected.length > 3 ? '…' : ''}</span></div></div><button class="btn sm primary" data-action="goto-tab" data-tab="cloud">${dr ? t('bk.bannerBtnCheck') : t('bk.bannerBtn')}</button></div>` : ''}
            ${!gh && !dr && !dismissed().cloudBanner ? `<div class="banner info"><span class="ic">${ic('cloud')}</span><div><div class="t">${t('home.cloudPromptTitle')}</div><div class="s">${t('home.cloudPromptText')}</div></div><button class="btn sm primary" data-action="goto-tab" data-tab="cloud">${t('home.connectCloud')}</button><button class="dismiss-x" data-action="dismiss" data-key="cloudBanner" title="${esc(t('tips.hide'))}" aria-label="${esc(t('tips.hide'))}">✕</button></div>` : ''}

            <div class="stat-grid">
                <div class="stat streak ${st.streak >= 2 ? 'hot' : ''}"><span class="big-emoji">${ic('flame')}</span><span class="label">${t('stat.streak')}</span><span class="value">${tn('stat.days', st.streak)}</span><span class="hint">${st.streak ? t('stat.keepChain') : t('stat.startToday')}</span></div>
                <div class="stat"><div class="ring-wrap">${ringSvg(goal ? st.today / goal : 0)}<div><span class="label">${t('stat.today')}</span><div class="value" style="font-size:22px">${st.today >= 0 ? '+' : ''}${num(st.today)}</div><span class="hint">${tn('stat.goalHint', goal)}</span></div></div></div>
                <div class="stat"><span class="big-emoji">${ic('book')}</span><span class="label">${t('stat.totalWords')}</span><span class="value">${num(st.total)}</span><span class="hint">${t('stat.allDocs')}</span></div>
                <div class="stat"><span class="big-emoji">${ic('history')}</span><span class="label">${t('stat.snapshots')}</span><span class="value">${num(st.snapshots)}</span><span class="hint">${st.firstAt ? t('stat.startedAgo', { ago: ago(st.firstAt) }) : ''}</span></div>
            </div>

            <div class="two-col">
                <div class="card">
                    <div style="display:flex;align-items:flex-start;gap:8px"><div style="flex:1"><h3>${t('week.title')}</h3><div class="sub">${t('week.sub')}</div></div>${aiReady() ? `<button class="btn sm ai-btn" data-action="ai-week">${t('ai.myWeek')}</button>` : ''}</div>
                    <div class="week">${st.week
                        .map((w, i) => `<div class="bar-col"><div class="bar ${i === 6 ? 'today' : w.active ? 'active' : ''}" style="height:${Math.max(4, (w.words / maxWeek) * 100)}%">${w.words ? `<span class="tip">${num(w.words)}</span>` : ''}</div><span class="day">${i === 6 ? t('time.today') : typeof w.dow === 'number' ? t('time.daysShort')[w.dow] : esc(w.label)}</span></div>`)
                        .join('')}</div>
                </div>
                <div class="card safe-card">
                    <div><h3>${t('safe.title')}</h3><div class="sub">${t('safe.sub')}</div></div>
                    <div class="safe-row"><span class="ic">${ic('laptop')}</span><div><div class="t">${t('safe.thisPc')}</div><div class="s">${t('safe.lastSave', { ago: ago(ov.lastSave) })}</div></div><span class="state on">${t('safe.active')}</span></div>
                    <div class="safe-row"><span class="ic">${ic('github')}</span><div><div class="t">${t('safe.github')}</div><div class="s">${gh ? (cloud.syncError ? esc(cloud.syncError) : cloud.lastSync ? t('safe.lastPush', { ago: ago(cloud.lastSync) }) : t('safe.firstPush')) : t('safe.notConnected')}</div></div><span class="state ${gh ? (cloud.syncError ? 'err' : 'on') : 'off'}">${gh ? (cloud.syncError ? 'history' : '✓') : '—'}</span></div>
                    <div class="safe-row"><span class="ic">${ic('drive')}</span><div><div class="t">Google Drive</div><div class="s">${dr ? (cloud.driveError ? esc(cloud.driveError) : cloud.driveAt ? t('safe.lastCopy', { ago: ago(cloud.driveAt) }) : t('safe.waiting')) : t('safe.notConnected')}</div></div><span class="state ${dr ? (cloud.driveError ? 'err' : 'on') : 'off'}">${dr ? (cloud.driveError ? 'history' : '✓') : '—'}</span></div>
                    ${unprotected.length ? `<div class="safe-warn" title="${esc(unprotected.join('\n'))}">${tn('bk.onlyHere', unprotected.length)}</div>` : ''}
                </div>
            </div>

            <div class="card files">
                <div class="files-head"><div><h3>${t('files.title')}</h3><div class="sub">${tn('files.sub', files.length)}</div></div>
                    <div class="files-head-actions"><button class="btn sm" data-action="add-files" title="${esc(t('fx.addFilesTip'))}">${t('fx.addFiles')}</button><button class="btn sm" data-action="open-folder">${t('files.openFolder')}</button></div></div>
                ${
                    files.length
                        ? shownFiles
                              .map(
                                  f => `<div class="file-row" data-action="open-file" data-rel="${esc(f.rel)}" data-file-rel="${esc(f.rel)}" draggable="true" title="${esc(t('fx.rowTip'))}">
                            ${fileTypeBox(f.kind)}
                            <div class="fmain"><div class="fname">${esc(f.name)} ${f.pending ? `<span class="chip pending">${t('files.newChange')}</span>` : ''}</div>
                                <div class="fsub">${f.rel.includes('/') ? esc(f.rel.slice(0, f.rel.lastIndexOf('/'))) + ' · ' : ''}${ago(f.mtime)} · ${sizeText(f.size)}</div></div>
                            ${f.words != null ? `<span class="fwords">${tn('common.words', f.words)}</span>` : ''}
                            ${backupBadges(f)}
                            <div class="factions"><button class="btn sm hist" data-action="file-history" data-rel="${esc(f.rel)}" title="${esc(t('files.historyTip'))}">${ic('history')} ${t('files.history')}</button><button class="btn sm more-btn" data-action="file-more" data-rel="${esc(f.rel)}" title="${esc(t('fx.more'))}" aria-label="${esc(t('fx.more'))}">⋯</button></div>
                        </div>`
                              )
                              .join('') +
                          (files.length > 12 && !S.showAllFiles ? `<div style="text-align:center;margin-top:8px"><button class="linkish" data-action="show-all-files">${tn('files.showAll', files.length)}</button></div>` : '')
                        : `<div class="empty-files"><div class="e">${ic('files')}</div><p>${t('files.empty')}</p><div style="display:flex;gap:8px;justify-content:center"><button class="btn primary" data-action="add-files">${t('fx.addFiles')}</button><button class="btn" data-action="open-folder">${t('files.openFolder')}</button></div></div>`
                }
                ${ov.skippedLarge && ov.skippedLarge.length ? `<div class="banner" style="margin:12px 0 0"><span class="ic">${ic('box')}</span><div><div class="t">${tn('files.largeTitle', ov.skippedLarge.length)}</div><div class="s">${t('files.largeText', { list: esc(ov.skippedLarge.slice(0, 3).join(', ')) })}</div></div></div>` : ''}
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
                    <div class="node">${ic(KIND_ICON[h.kind] || 'save')}</div>
                    <div class="tmain"><div class="ttitle">${esc(h.title)}</div>
                    <div class="tmeta">${hm(new Date(h.time))}${words > 0 ? `<span class="chip add">+${num(words)}</span>` : words < 0 ? `<span class="chip del">${num(words)}</span>` : ''}${h.kind === 'star' ? `<span class="chip star">${t('tl.star')}</span>` : ''}${h.kind === 'rescue' ? `<span class="chip rescue">${t('tl.rescued')}</span>` : ''}${h.kind === 'mobile' ? `<span class="chip mobile">${ic('phone')} ${t('tl.fromPhone')}</span>` : ''}</div></div>
                </div>`;
            })
            .join('');
        // Kayıt noktası alınmamış, dosyada kaydedilmiş değişiklikler (VS Code'daki "Changes" gibi anında görünür)
        const live = ov.pendingCount
            ? `<div class="tl-day">${t('time.today')}</div><div class="tl-item live ${S.selectedOid === 'working' ? 'active' : ''}" data-action="select-snapshot" data-oid="working">
                <div class="node">${ic('pencil')}</div>
                <div class="tmain"><div class="ttitle">${t('tl.liveTitle')}</div>
                <div class="tmeta">${t('tl.liveSub')}<span class="chip pending">${num(ov.pendingCount)}</span></div></div>
            </div>`
            : '';
        return `<div class="content split">
            <div class="tl-side">
                <div class="tl-filter"><label for="tl-filter">${t('tl.filterLabel')}</label><select class="select" id="tl-filter">
                    <option value="">${t('tl.allFiles')}</option>
                    ${docsFirst.map(f => `<option value="${esc(f.rel)}" ${f.rel === S.tlFilter ? 'selected' : ''}>${esc(f.rel)}</option>`).join('')}
                </select></div>
                ${S.tlFilter ? `<div class="tl-only">${ic('doc')}<span>${t('tl.onlyFile')}</span><button class="linkish" data-action="tl-clear-filter">${t('tl.showAllFiles')}</button></div>` : ''}
                <div class="tl-list">${live}${items || live ? items : `<div class="placeholder" style="height:300px"><div><div class="e">${ic('doc')}</div><p>${t('tl.empty')}</p></div></div>`}</div>
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
            return `<div class="placeholder"><div><div class="e">${ic('history')}</div><h3>${t('tl.placeholderTitle')}</h3><p>${t('tl.placeholderText')}</p></div></div>`;
        }
        const sel = S.changes.find(c => c.rel === S.selectedFile);
        return `
            <div class="detail-head">
                <div class="node">${ic(isLive ? 'pencil' : KIND_ICON[h.kind] || 'save')}</div>
                <div style="flex:1;min-width:0"><h2>${esc(h.title)}</h2>${isLive ? '' : `<div class="when">${fullDate(h.time)} · ${esc(h.author)}</div>`}${h.note ? `<div class="note">${esc(h.note)}</div>` : ''}</div>
                ${isLive ? `<button class="btn primary" data-action="save-now">${t('tl.saveNow')}</button>` : ''}
            </div>
            <div class="changed-files">${S.changes
                .map(
                    c => `<button class="cf ${c.rel === S.selectedFile ? 'active' : ''}" data-action="select-file" data-rel="${esc(c.rel)}" data-file-rel="${esc(c.rel)}" data-file-oid="${esc(h.oid)}"${c.change === 'deleted' ? ' data-file-deleted="1"' : ' draggable="true"'} title="${esc(t('fx.chipTip'))}">
                    ${fileTypeBox(c.kind, 'ftype')}${esc(c.rel.split('/').pop())}
                    ${c.change === 'added' ? `<span class="chip add">${t('tl.new')}</span>` : c.change === 'deleted' ? `<span class="chip del">${t('tl.deleted')}</span>` : ''}
                    ${c.delta ? `<span class="chip ${c.delta > 0 ? 'add' : 'del'}">${c.delta > 0 ? '+' : ''}${num(c.delta)}</span>` : ''}
                </button>`
                )
                .join('') || `<span style="color:var(--text-3)">${t('tl.noFileChanges')}</span>`}</div>
            ${
                sel
                    ? `<div class="viewer-bar">
                    <div class="seg"><button class="${S.viewMode === 'diff' ? 'active' : ''}" data-action="view-mode" data-mode="diff">${t('tl.viewDiff')}</button><button class="${S.viewMode === 'preview' ? 'active' : ''}" data-action="view-mode" data-mode="preview">${t('tl.viewDoc')}</button></div>${aiReady() && sel.change !== 'deleted' ? `<button class="btn sm ai-btn" data-action="ai-summarize">${t('ai.summarize')}</button>` : ''}
                    <div class="viewer-actions" ${isLive ? 'hidden' : ''}>
                        ${sel.change !== 'deleted' ? `<button class="btn sm" data-action="open-version">${t('tl.openVersion')}</button><button class="btn sm" data-action="save-copy">${t('tl.saveCopy')}</button>` : ''}
                        <button class="btn sm primary" data-action="restore">${sel.change === 'deleted' ? t('tl.bringBack') : t('tl.restore')}</button>
                    </div>
                </div>
                <div id="ai-answer">${S.aiCache[`${S.selectedOid}|${S.selectedFile}`] ? aiCard(S.aiCache[`${S.selectedOid}|${S.selectedFile}`]) : ''}</div>
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
            ? `<div class="user-row">${gh.user && gh.user.avatar ? `<img src="${esc(gh.user.avatar)}">` : `<span class="avatar-ic">${ic('github')}</span>`}<div><div class="nm">${esc(gh.user ? gh.user.name : '')}</div><div class="lg">@${esc(gh.user ? gh.user.login : '')}</div></div></div>
               <div class="sub">${c.syncing ? `<span class="spinner" style="display:inline-block;vertical-align:-3px"></span> ${t('cloud.sending')}` : c.syncError ? `${ic('history')} ${esc(c.syncError)}` : c.lastSync ? t('cloud.lastPush', { ago: ago(c.lastSync) }) : t('cloud.firstSoon')}
               ${c.github ? `<br>${t('cloud.privateRepo', { link: `<button class="linkish" data-action="open-url" data-url="${esc(c.github.url || `https://github.com/${c.github.owner}/${c.github.repo}`)}">${esc(c.github.owner)}/${esc(c.github.repo)}</button>` })}` : ''}</div>
               <div class="actions"><button class="btn primary" data-action="sync-now" ${c.syncing ? 'disabled' : ''}>${t('cloud.syncNow')}</button>${dismissed().phoneCard ? `<button class="btn" data-action="phone-qr">${t('qr.button')}</button>` : ''}<button class="btn ghost" data-action="github-logout">${t('cloud.logout')}</button></div>`
            : `<div class="sub">${t('cloud.ghPitch')}</div>
               <div class="actions"><button class="btn primary" data-action="github-login">${t('cloud.ghLogin')}</button><button class="btn ghost" data-action="open-url" data-url="https://github.com/signup">${t('cloud.ghSignup')}</button></div>`;

        let drBody;
        if (dr.mode === 'folder') {
            drBody = `<div class="user-row"><span class="avatar-ic">${ic('folder')}</span><div style="min-width:0"><div class="nm">${t('cloud.driveFolder')}</div><div class="lg" style="word-break:break-all">${esc(dr.folder)}\\DraftRewind</div></div></div>
                <div class="sub">${c.driveError ? `${ic('history')} ${esc(c.driveError)}` : c.driveAt ? t('cloud.lastCopy', { ago: ago(c.driveAt) }) : t('cloud.copying')}<br>${t('cloud.folderInfo')}</div>
                <div class="actions"><button class="btn primary" data-action="drive-open">${t('cloud.openDriveFolder')}</button><button class="btn" data-action="drive-check">${ic('refresh')} ${t('cloud.driveCheckNow')}</button><button class="btn ghost" data-action="drive-disconnect">${t('cloud.disconnect')}</button></div>`;
        } else if (dr.mode === 'account') {
            drBody = `<div class="user-row">${dr.user && dr.user.picture ? `<img src="${esc(dr.user.picture)}">` : `<span class="avatar-ic">${ic('drive')}</span>`}<div><div class="nm">${esc(dr.user ? dr.user.name : t('cloud.googleAccount'))}</div><div class="lg">${esc(dr.user ? dr.user.email : '')}</div></div></div>
                <div class="sub">${c.driveError ? `${ic('history')} ${esc(c.driveError)}` : c.driveAt ? t('cloud.lastUpload', { ago: ago(c.driveAt) }) : t('cloud.uploading')}<br>${t('cloud.accountInfo', { name: esc(ov.name) })}<br>${t('cloud.driveAuto')}</div>
                <div class="actions"><button class="btn primary" data-action="drive-open" ${c.driveUrl ? '' : 'disabled'}>${t('cloud.openInDrive')}</button><button class="btn" data-action="drive-check">${ic('refresh')} ${t('cloud.driveCheckNow')}</button><button class="btn ghost" data-action="drive-disconnect">${t('cloud.disconnect')}</button></div>`;
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
                <div class="card cloud-card"><div class="top"><div class="logo">${ic('github')}</div><div><h3>${t('cloud.ghTitle')}</h3><div class="sub">${t('cloud.ghSub')}</div></div><span class="badge chip ${gh.connected ? 'add' : 'mod'}">${gh.connected ? t('cloud.connected') : t('cloud.recommended')}</span></div>${ghBody}</div>
                <div class="card cloud-card"><div class="top"><div class="logo">${ic('drive')}</div><div><h3>Google Drive</h3><div class="sub">${t('cloud.driveSub')}</div></div><span class="badge chip ${dr.mode ? 'add' : 'mod'}">${dr.mode ? t('cloud.connected') : t('cloud.optional')}</span></div>${drBody}</div>
                ${dismissed().phoneCard ? '' : `<div class="card phone-card">
                    <button class="dismiss-x on-grad" data-action="dismiss" data-key="phoneCard" title="${esc(t('tips.hide'))}" aria-label="${esc(t('tips.hide'))}">✕</button>
                    <div class="phone-mock">${ic('phone')}</div>
                    <div><h3>${t('cloud.phoneTitle')}</h3>
                    <div class="sub">${t('cloud.phoneText')}</div>
                    <div class="steps"><span class="step">${t('cloud.step1')}</span><span class="step">${t('cloud.step2')}</span><span class="step">${t('cloud.step3')}</span></div>
                    <div class="qr-row"><button class="btn qr-btn" data-action="phone-qr" ${gh.connected ? '' : 'disabled'}>${t('qr.button')}</button>${gh.connected ? '' : `<span class="qr-hint">${t('qr.needGithub')}</span>`}</div></div>
                </div>`}
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
        toast(t('toast.folderProtected'), 'check');
        confetti();
        refresh();
    }

    async function createNew() {
        const name = await promptModal({ title: t('newProj.title'), sub: t('newProj.sub'), placeholder: t('newProj.placeholder'), ok: t('newProj.ok'), emoji: 'sparkle' });
        if (!name) return;
        const id = await run(() => av.projects.create(name));
        if (!id) return;
        S.activeId = id;
        S.tab = 'home';
        toast(t('toast.folderReady'), 'check');
        refresh();
    }

    function addProjectModal() {
        const m = openModal(`<div class="modal-ic">${ic('files')}</div><h2>${t('addProj.title')}</h2><p class="sub">${t('addProj.sub')}</p>
            <div style="display:grid;gap:10px">
                <button class="btn big primary" data-x="existing">${t('addProj.existing')}</button>
                <button class="btn big" data-x="new">${t('addProj.new')}</button>
                <button class="btn big" data-x="github">${t('addProj.github')}</button>
            </div>
            <p class="modal-hint">${ic('info')} ${t('addProj.hint')}</p>`);
        m.querySelector('[data-x=existing]').onclick = () => { closeModal(); addExisting(); };
        m.querySelector('[data-x=new]').onclick = () => { closeModal(); createNew(); };
        m.querySelector('[data-x=github]').onclick = () => { closeModal(); importGithubModal(); };
    }

    function starModal() {
        const m = openModal(`<div class="modal-ic">${ic('star')}</div><h2>${t('star.title')}</h2>
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
            const r = await run(() => av.projects.snapshot(S.activeId, { star: true, title: name, note }));
            if (r !== undefined) {
                confetti();
                toast(t('star.done', { t: name }), 'star');
                refresh({ history: true });
            }
        };
        m.querySelector('[data-x=yes]').onclick = go;
        title.addEventListener('keydown', e => e.key === 'Enter' && go());
    }

    // "Nasıl yapılır?": her işin nerede olduğunu gösteren kısa tablo + kısayollar (F1)
    function helpModal() {
        const rows = t('help.rows');
        const keys = t('help.keys');
        openModal(
            `<div class="modal-ic">${ic('help')}</div><h2>${t('help.title')}</h2><p class="sub">${t('help.sub')}</p>
            <table class="help-table">${rows.map(([task, where]) => `<tr><td>${esc(task)}</td><td>${esc(where)}</td></tr>`).join('')}</table>
            <h3 style="margin:16px 0 4px">${t('help.shortcuts')}</h3>
            <div class="help-keys">${keys.map(([k, what]) => `<span><kbd>${esc(k)}</kbd> ${esc(what)}</span>`).join('')}</div>
            <div class="foot"><button class="btn primary" data-x="ok">${t('common.ok')}</button></div>`,
            { wide: true }
        ).querySelector('[data-x=ok]').onclick = () => closeModal();
    }

    function emojiModal() {
        const m = openModal(`<h2>${t('emoji.title')}</h2><p class="sub">${t('emoji.sub')}</p><div class="color-grid">${PROJECT_COLORS.map(c => `<button data-e="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>`);
        m.querySelectorAll('[data-e]').forEach(b => (b.onclick = async () => {
            closeModal();
            await run(() => av.projects.update(S.activeId, { color: b.dataset.e }));
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

    // ------------------------------------------------------------------ yerel yapay zekâ
    const aiReady = () => !!(S.app && S.app.ai && S.app.ai.installed);
    const gb = n => (n / 1073741824).toLocaleString(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });

    function aiBlockHtml() {
        const a = S.app.ai;
        if (!a || !a.supported) return `<div class="setting-row"><div><div class="t">${t('ai.title')}</div><div class="s">${t('ai.unsupported')}</div></div></div>`;
        if (a.installing) {
            const pct = a.installing.total ? Math.floor((a.installing.received * 100) / a.installing.total) : 0;
            return `<div class="setting-row"><div style="flex:1"><div class="t">${t('ai.title')}</div>
                <div class="s">${t(a.installing.phase === 'engine' ? 'ai.phaseEngine' : 'ai.phaseModel')} · %${pct} (${gb(a.installing.received)} / ${gb(a.installing.total)} GB)</div>
                <div class="ai-progress"><span style="width:${pct}%"></span></div></div>
                <button class="btn sm" id="ai-cancel">${t('common.cancel')}</button></div>`;
        }
        if (!a.installed) {
            return `<div class="setting-row"><div><div class="t">${t('ai.title')}</div><div class="s">${t('ai.pitch', { size: gb(a.model.size + a.engineSize) })}${a.ramOk ? '' : ` ${t('ai.lowRam')}`}</div></div>
                <button class="btn sm primary" id="ai-install">${t('ai.install')}</button></div>`;
        }
        return `<div class="setting-row"><div><div class="t">${t('ai.titlesToggle')} <span class="chip add">${t('ai.ready')}</span></div><div class="s">${t('ai.readyHint', { model: esc(a.model.name) })}</div></div>
                <label class="switch"><input type="checkbox" id="ai-titles" ${S.app.prefs.aiTitles !== false ? 'checked' : ''}><span></span></label></div>
            <div class="setting-row"><div><div class="s">${t('ai.titlesHint')}</div></div><button class="btn sm danger" id="ai-remove">${t('ai.remove')}</button></div>`;
    }

    function bindAiBlock(root) {
        const q = s => root.querySelector(s);
        if (q('#ai-install')) q('#ai-install').onclick = async () => {
            const r = await run(() => av.ai.install());
            if (r && r.installed) {
                S.app.ai = r;
                confetti();
                toast(t('ai.installed'), 'sparkle', 5000);
                refreshAiBlock();
            }
        };
        if (q('#ai-cancel')) q('#ai-cancel').onclick = () => av.ai.cancel();
        if (q('#ai-titles')) q('#ai-titles').onchange = async e => { S.app.prefs = await av.setPref('aiTitles', e.target.checked); };
        if (q('#ai-remove')) q('#ai-remove').onclick = async () => {
            closeModal();
            const ok = await confirmModal({ title: t('ai.removeTitle'), text: t('ai.removeText'), ok: t('ai.remove'), danger: true, emoji: 'trash' });
            if (ok) S.app.ai = (await run(() => av.ai.remove())) || S.app.ai;
            settingsModal();
        };
    }

    function refreshAiBlock() {
        const blk = document.getElementById('ai-block');
        if (!blk) return;
        blk.innerHTML = aiBlockHtml();
        bindAiBlock(blk);
    }

    const aiCard = text => `<div class="ai-card"><div class="ai-text">${esc(text)}</div><div class="ai-foot">${ic('lock')} ${t('ai.footnote')}</div></div>`;
    const aiThinking = () => `<div class="ai-card thinking"><span class="spinner"></span> ${t('ai.thinking')}</div>`;

    async function aiWeekModal() {
        const m = openModal(`<div class="modal-ic">${ic('calendar')}</div><h2>${t('ai.weekTitle')}</h2><div id="ai-week">${aiThinking()}</div><div class="foot"><button class="btn primary" data-x="ok">${t('common.ok')}</button></div>`);
        m.querySelector('[data-x=ok]').onclick = closeModal;
        try {
            const text = await av.ai.weekly(S.activeId);
            const box = document.getElementById('ai-week');
            if (box) box.innerHTML = aiCard(text);
        } catch (e) {
            const box = document.getElementById('ai-week');
            if (box) box.innerHTML = `<p class="sub">${ic('error')} ${esc(e.message)}</p>`;
        }
    }

    function settingsModal() {
        const pr = S.app.prefs;
        const win = S.app.platform === 'win32';
        const seg = (id, current, opts) =>
            `<div class="seg" id="${id}">${opts.map(([v, label]) => `<button class="${current === v ? 'active' : ''}" data-v="${v}">${label}</button>`).join('')}</div>`;
        const m = openModal(`<h2>${t('settings.title')}</h2><p class="sub">${t('settings.sub')}</p>
            <div class="setting-row"><div><div class="t">${t('settings.language')}</div><div class="s">${t('settings.languageHint')}</div></div>${seg('pref-lang', pr.language || 'auto', [['auto', t('settings.langAuto')], ['tr', t('settings.langTr')], ['en', t('settings.langEn')]])}</div>
            <div class="setting-row"><div><div class="t">${t('settings.theme')}</div><div class="s">${t('settings.themeHint')}</div></div>${seg('pref-theme', pr.theme || 'system', [['system', t('settings.themeSystem')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')]])}</div>
            <div id="ai-block">${aiBlockHtml()}</div>
            <div class="setting-row"><div><div class="t">${t('settings.goal')}</div><div class="s">${t('settings.goalHint')}</div></div><input type="range" id="goal" min="100" max="3000" step="50" value="${pr.dailyGoal}"><b id="goal-v" style="width:48px;text-align:right">${pr.dailyGoal}</b></div>
            ${win ? `<div class="setting-row"><div><div class="t">${t('settings.guardian')}</div><div class="s">${t('settings.guardianHint')}</div></div><label class="switch"><input type="checkbox" id="guardian" ${pr.guardian ? 'checked' : ''}><span></span></label></div>` : ''}
            <div class="setting-row"><div><div class="t">${t('settings.autostart')}</div><div class="s">${t('settings.autostartHint')}</div></div><label class="switch"><input type="checkbox" id="autostart" ${pr.autostart ? 'checked' : ''}><span></span></label></div>
            <div class="setting-row"><div><div class="t">${t('settings.tips')}</div><div class="s">${t('settings.tipsHint')}</div></div><button class="linkish" id="tips-again" ${Object.keys(dismissed()).length ? '' : 'disabled style="opacity:.5;cursor:default"'}>${t('settings.tipsBtn')}</button></div>
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
        bindAiBlock(m);
        const goal = m.querySelector('#goal');
        goal.oninput = () => (m.querySelector('#goal-v').textContent = goal.value);
        goal.onchange = async () => { S.app.prefs = await av.setPref('dailyGoal', Number(goal.value)); };
        const g = m.querySelector('#guardian');
        if (g) g.onchange = async () => { S.app.prefs = await av.setPref('guardian', g.checked); };
        const a = m.querySelector('#autostart');
        a.onchange = async () => { S.app.prefs = await av.setPref('autostart', a.checked); };
        m.querySelector('#tips-again').onclick = async () => {
            if (!Object.keys(dismissed()).length) return;
            S.app.prefs = (await run(() => av.setPref('dismissed', {}))) || S.app.prefs;
            toast(t('toast.tipsBack'), 'info');
            render();
            settingsModal();
        };
        m.querySelector('#relink').onclick = async () => { closeModal(); if (await run(() => av.projects.relink(S.activeId))) { toast(t('toast.relinked'), 'folderOpen'); refresh(); } };
        m.querySelector('#remove').onclick = async () => {
            closeModal();
            const ok = await confirmModal({ title: t('remove.title'), text: t('remove.text'), ok: t('settings.removeBtn'), danger: true, emoji: 'trash' });
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
        const m = openModal(`<div style="text-align:center"><div class="modal-ic">${ic('github')}</div><h2>${t('gh.title')}</h2>
            <p class="sub">${t('gh.text')}</p>
            <div class="code-boxes">${code.map((ch, i) => (ch === '-' ? '<span class="dash">–</span>' : `<span style="animation-delay:${i * 40}ms">${esc(ch)}</span>`)).join('')}</div>
            <div class="waiting" id="gh-wait"><span class="spinner"></span> ${t('gh.waiting')}</div>
            <div class="foot" style="justify-content:center"><button class="btn ghost" data-x="copy">${t('gh.copyAgain')}</button><button class="btn" data-x="open">${t('gh.openAgain')}</button><button class="btn ghost" data-x="cancel">${t('common.cancel')}</button></div></div>`,
            { onClose: () => { if (S.loginModal) av.github.cancel(); S.loginModal = null; } }
        );
        S.loginModal = m;
        m.querySelector('[data-x=copy]').onclick = () => { navigator.clipboard.writeText(r.code); toast(t('gh.copied'), 'copy'); };
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
            if (r) toast(t('restore.copied'), 'copy');
            return;
        }
        const ok = await confirmModal({
            emoji: 'undo',
            title: t('restore.title', { name }),
            text: t('restore.text', { date: fullDate(h.time) }),
            ok: t('restore.ok')
        });
        if (!ok) return;
        const r = await run(() => av.projects.restore(S.activeId, sel.rel, h.oid, 'replace'));
        if (r) {
            toast(t('restore.done', { name }), 'sparkle');
            S.selectedOid = null;
            refresh({ history: true });
        }
    }

    // ------------------------------------------------------------------ dosya eylemleri (sağ tık, sürükle, ekle)
    function dismissed() {
        return (S.app && S.app.prefs && S.app.prefs.dismissed) || {};
    }

    async function fileMenu(rel, opts) {
        if (!S.activeId) return;
        const r = await run(() => av.files.menu(S.activeId, rel, opts));
        if (!r) return;
        if (r.action === 'copyFile') toast(r.how === 'file' ? t('fx.fileCopied') : t('fx.pathCopied'), 'copy', 5000);
        else if (r.action === 'copyPath') toast(t('fx.pathCopied'), 'copy');
        else if (r.action === 'copyVersion') toast(r.how === 'file' ? t('fx.versionCopied') : t('fx.pathCopied'), 'copy', 5000);
        else if (r.action === 'history') actions['file-history']({ rel }, null, { stopPropagation() {} });
        else if (r.action === 'openVersion') {
            const ok = await run(() => av.projects.openVersion(S.activeId, rel, opts.oid));
            if (ok) toast(t('old.openedToast'), 'lock', 6000);
        }
    }

    function fileTarget(el) {
        const node = el && el.closest && el.closest('[data-file-rel]');
        if (!node) return null;
        return { node, rel: node.dataset.fileRel, oid: node.dataset.fileOid || undefined, deleted: node.dataset.fileDeleted === '1' };
    }

    document.addEventListener('contextmenu', e => {
        const f = fileTarget(e.target);
        if (!f) return;
        e.preventDefault();
        fileMenu(f.rel, { oid: f.oid, deleted: f.deleted });
    });

    // Eski sürümün geçici kopyası sürükleme başlamadan hazır olsun
    document.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const f = fileTarget(e.target);
        if (f && f.oid && f.oid !== 'working' && !f.deleted) av.files.prepareDrag(S.activeId, f.rel, f.oid).catch(() => {});
    });

    // Dosyayı uygulamadan dışarı sürükle (Gezgin, WhatsApp, e-posta…): yerel sürükleme ana süreçte başlar
    let draggingOut = false;
    document.addEventListener('dragstart', e => {
        const f = fileTarget(e.target);
        if (!f || f.deleted) return;
        e.preventDefault();
        draggingOut = true;
        av.files.startDrag(S.activeId, f.rel, f.oid);
    });
    document.addEventListener('mousemove', e => {
        if (draggingOut && e.buttons === 0) draggingOut = false;
    });

    // Dışarıdan dosya/klasör bırakma → projeye kopyala
    let dragDepth = 0;
    const hasFiles = e => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    const canDrop = () => {
        const p = S.app && S.app.projects.find(x => x.id === S.activeId);
        return !!(p && !p.missing && !$('#modal-root .modal-back'));
    };
    function dropOverlay(show) {
        let el = $('#drop-overlay');
        if (!show) {
            if (el) el.classList.remove('on');
            return;
        }
        const p = S.app.projects.find(x => x.id === S.activeId);
        if (!el) {
            el = document.createElement('div');
            el.id = 'drop-overlay';
            document.body.appendChild(el);
        }
        el.innerHTML = `<div class="drop-card"><div class="drop-emoji">${projectTile(p)}</div><h2>${esc(t('fx.dropTitle', { name: p.name }))}</h2><p>${t('fx.dropSub')}</p></div>`;
        requestAnimationFrame(() => el.classList.add('on'));
    }
    window.addEventListener('dragenter', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (draggingOut || !canDrop()) return;
        if (dragDepth++ === 0) dropOverlay(true);
    });
    window.addEventListener('dragover', e => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) && !draggingOut && canDrop() ? 'copy' : 'none';
    });
    window.addEventListener('dragleave', e => {
        if (!hasFiles(e) || dragDepth === 0) return;
        if (--dragDepth <= 0) {
            dragDepth = 0;
            dropOverlay(false);
        }
    });
    window.addEventListener('drop', async e => {
        e.preventDefault();
        dragDepth = 0;
        dropOverlay(false);
        if (draggingOut) {
            draggingOut = false;
            return;
        }
        if (!hasFiles(e) || !canDrop()) return;
        const paths = Array.from(e.dataTransfer.files || [])
            .map(f => av.files.pathOf(f))
            .filter(Boolean);
        if (!paths.length) return;
        const r = await run(() => av.files.importPaths(S.activeId, paths));
        if (r) addedToast(r);
    });

    function addedToast(r) {
        if (r.added.length) {
            toast(tn('fx.added', r.added.length), 'inbox', 4500);
            refresh();
        }
        if (r.skipped.length) toast(tn('fx.skipped', r.skipped.length), 'info', 4500);
    }

    // ------------------------------------------------------------------ GitHub'dan proje aç
    let importModal = null;
    function importGithubModal(prefill = '') {
        const m = openModal(`<div class="modal-ic">${ic('github')}</div><h2>${t('imp.title')}</h2><p class="sub">${t('imp.sub')}</p>
            <input class="input" id="imp-url" value="${esc(prefill)}" placeholder="${esc(t('imp.placeholder'))}" spellcheck="false">
            ${S.app.github.connected ? '' : `<p class="modal-hint">${ic('lock')} ${t('imp.privateHint')}</p>`}
            <div class="foot"><button class="btn ghost" data-x="no">${t('common.cancel')}</button><button class="btn primary" data-x="yes">${t('imp.ok')}</button></div>`);
        const input = m.querySelector('#imp-url');
        m.querySelector('[data-x=no]').onclick = closeModal;
        const go = async () => {
            const url = input.value.trim();
            if (!url) {
                input.focus();
                return;
            }
            const name = url.replace(/\.git$/i, '').replace(/[/?#]+$/, '').split('/').pop() || 'GitHub';
            importModal = openModal(`<div style="text-align:center"><div class="modal-ic imp-bob">${ic('github')}</div><h2>${esc(t('imp.progressTitle', { name }))}</h2>
                <p class="sub" id="imp-phase">${t('imp.phaseStart')}</p>
                <div class="progress"><div class="bar indet" id="imp-bar"></div></div></div>`);
            const r = await run(() => av.projects.importGithub(url));
            const stillOpen = !!(importModal && importModal.isConnected);
            importModal = null;
            if (stillOpen) closeModal();
            if (!r) {
                if (stillOpen) importGithubModal(url);
                return;
            }
            S.activeId = r.id;
            S.tab = 'home';
            S.overview = null;
            toast(t('imp.done', { name: r.name }), 'check', 5000);
            confetti();
            refresh();
        };
        m.querySelector('[data-x=yes]').onclick = go;
        input.addEventListener('keydown', e => e.key === 'Enter' && go());
    }

    function updateImportProgress(p) {
        if (!importModal || !importModal.isConnected) return;
        const phase = String(p.phase || '');
        let from = 0, span = 5, label = t('imp.phaseStart');
        if (/receiv/i.test(phase)) { from = 5; span = 60; label = t('imp.phaseDownload'); }
        else if (/resolv/i.test(phase)) { from = 65; span = 20; label = t('imp.phaseUnpack'); }
        else if (/workdir/i.test(phase)) { from = 85; span = 15; label = t('imp.phaseFiles'); }
        const bar = importModal.querySelector('#imp-bar');
        const ph = importModal.querySelector('#imp-phase');
        if (ph) ph.textContent = label + (p.total ? ` ${Math.min(100, Math.round((p.loaded / p.total) * 100))}%` : '');
        if (bar) {
            bar.classList.toggle('indet', !p.total);
            bar.style.width = p.total ? `${Math.min(100, from + span * (p.loaded / p.total))}%` : '';
        }
    }

    // ------------------------------------------------------------------ Telefonu QR ile bağla
    let qrTimer = null;
    function phoneQrModal() {
        if (!S.app.github.connected) {
            toast(t('qr.needGithub'), 'github');
            return;
        }
        clearInterval(qrTimer);
        const m = openModal(`<div style="text-align:center"><div class="modal-ic">${ic('phone')}</div><h2>${t('qr.title')}</h2>
            <p class="sub">${t('qr.text')}</p>
            <div class="qr-box" id="qr-box"><div class="skeleton" style="width:260px;height:260px"></div></div>
            <div class="qr-timer" id="qr-timer">&nbsp;</div>
            <div class="foot" style="justify-content:center"><button class="btn ghost" data-x="close">${t('common.ok')}</button></div></div>`,
            { onClose: () => clearInterval(qrTimer) });
        m.querySelector('[data-x=close]').onclick = closeModal;
        const load = async () => {
            clearInterval(qrTimer);
            const box = m.querySelector('#qr-box');
            const r = await run(() => av.phone.pairQr());
            if (!r || !m.isConnected) return;
            box.classList.remove('expired');
            box.innerHTML = `<img src="${r.dataUrl}" alt="QR" draggable="false"><div class="qr-expired"><b>${t('qr.expired')}</b><button class="btn primary sm" data-x="refresh">${t('qr.refresh')}</button></div>`;
            box.querySelector('[data-x=refresh]').onclick = load;
            const timer = m.querySelector('#qr-timer');
            const tick = () => {
                const left = Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000));
                timer.classList.toggle('done', !left);
                if (!left) {
                    clearInterval(qrTimer);
                    box.classList.add('expired');
                    timer.innerHTML = '&nbsp;';
                    return;
                }
                timer.textContent = t('qr.expiresIn', { time: `${Math.floor(left / 60)}:${pad(left % 60)}` });
            };
            tick();
            qrTimer = setInterval(tick, 1000);
        };
        load();
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
        'tl-clear-filter': async () => {
            S.tlFilter = '';
            S.selectedOid = null;
            await loadHistory();
            if (S.history[0]) await selectSnapshot(S.history[0].oid, false);
            render();
        },
        'help': helpModal,
        // Bulut sekmesi: Drive'daki düzenlemeleri hemen al
        'drive-check': async (d, el) => {
            if (el) el.disabled = true;
            const ov = await run(() => av.drive.syncNow(S.activeId));
            if (ov) {
                S.overview = ov;
                toast(t('cloud.driveChecked'), 'check');
            }
            render();
        },
        'select-snapshot': d => selectSnapshot(d.oid),
        'select-file': d => { S.selectedFile = d.rel; S.diffFull = false; render(); },
        'view-mode': d => { S.viewMode = d.mode; render(); },
        'diff-full': () => { S.diffFull = true; renderViewer(); },
        'open-version': async () => {
            const ok = await run(() => av.projects.openVersion(S.activeId, S.selectedFile, S.selectedOid));
            if (ok) toast(t('old.openedToast'), 'lock', 6000);
        },
        'ai-week': aiWeekModal,
        'ai-summarize': async () => {
            const key = `${S.selectedOid}|${S.selectedFile}`;
            const box = document.getElementById('ai-answer');
            if (!box) return;
            box.innerHTML = aiThinking();
            try {
                const text = await av.ai.summarizeChange(S.activeId, S.selectedFile, S.selectedOid);
                if (S.selectedOid !== 'working') S.aiCache[key] = text;
                const now = document.getElementById('ai-answer');
                if (now) now.innerHTML = aiCard(text);
            } catch (e) {
                const now = document.getElementById('ai-answer');
                if (now) now.innerHTML = '';
                toast(e.message, 'error', 5000);
            }
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
            const ok = await confirmModal({ title: t('ghLogout.title'), text: t('ghLogout.text'), ok: t('cloud.logout'), danger: true, emoji: 'logout' });
            if (!ok) return;
            await run(() => av.github.logout());
            refresh();
        },
        'sync-now': async () => {
            S.syncing[S.activeId] = true;
            render();
            const r = await run(() => av.github.syncNow(S.activeId));
            S.syncing[S.activeId] = false;
            if (r && !r.syncError) toast(t('toast.synced'), 'cloud');
            refresh();
        },
        'drive-folder': async d => {
            const r = await run(() => av.drive.useFolder(d.path || null));
            if (r) {
                toast(t('toast.driveConnected'), 'check');
                confetti();
            }
            refresh();
        },
        'drive-signin': async () => {
            toast(t('toast.googleOpening'), 'key');
            const r = await run(() => av.drive.signIn(), 'Google: ');
            if (r) {
                toast(t('toast.googleConnected'), 'drive');
                confetti();
            }
            refresh();
        },
        'drive-disconnect': async () => {
            const ok = await confirmModal({ title: t('driveLogout.title'), text: t('driveLogout.text'), ok: t('cloud.disconnect'), danger: true, emoji: 'drive' });
            if (!ok) return;
            await run(() => av.drive.disconnect());
            refresh();
        },
        'drive-open': () => run(() => av.drive.open(S.activeId)),
        'open-url': d => av.openExternal(d.url),
        'file-more': (d, el, e) => {
            e.stopPropagation();
            fileMenu(d.rel, {});
        },
        'add-files': async () => {
            const r = await run(() => av.files.add(S.activeId));
            if (r) addedToast(r);
        },
        dismiss: async (d, el, e) => {
            e.stopPropagation();
            const next = { ...dismissed(), [d.key]: true };
            S.app.prefs = (await run(() => av.setPref('dismissed', next))) || S.app.prefs;
            render();
        },
        'phone-qr': phoneQrModal
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
            av.projects.snapshot(S.activeId, {}).then(() => toast(t('toast.saved'), 'save'));
        }
        // F1: nasıl yapılır · F5: yenile · Ctrl+1/2/3: sekmeler
        if (e.key === 'F1' && S.activeId) {
            e.preventDefault();
            helpModal();
        }
        if (e.key === 'F5') {
            e.preventDefault();
            refresh({ history: S.tab === 'timeline' });
            toast(t('kbd.refresh'), 'refresh', 1400);
        }
        const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && ['1', '2', '3'].includes(e.key) && S.activeId && !inField && !$('#modal-root .modal-back')) {
            e.preventDefault();
            actions['goto-tab']({ tab: { 1: 'home', 2: 'timeline', 3: 'cloud' }[e.key] });
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
            case 'ai':
                if (S.app) S.app.ai = ev.status;
                refreshAiBlock();
                break;
            case 'toast':
                toast(ev.text, ev.icon);
                break;
            case 'project':
                refresh();
                break;
            case 'importProgress':
                updateImportProgress(ev);
                break;
            case 'github':
                if (ev.state === 'connected') {
                    S.loginModal = null;
                    closeModal();
                    confetti();
                    toast(t('toast.welcome', { name: ev.user.name }), 'github', 5000);
                    refresh();
                } else if (ev.state === 'error' && S.loginModal) {
                    const w = S.loginModal.querySelector('#gh-wait');
                    if (w) w.innerHTML = `${ic('error')} ${esc(ev.message)}`;
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
