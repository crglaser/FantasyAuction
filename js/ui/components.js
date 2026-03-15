/**
 * UI Component Controller for the Teddy Ballgame Draft Tool.
 * Orchestrates rendering, data loading, and event handling.
 */

const UI = {
    async init() {
        // Handle Shared State from URL
        const urlParams = new URLSearchParams(window.location.search);
        const sharedState = urlParams.get('s');
        if (sharedState) {
            if (ShareManager.loadFromStateString(sharedState)) {
                const banner = document.getElementById('readOnlyBanner');
                if (banner) banner.style.display = 'flex';
                const sBtn = document.getElementById('shareBtn');
                if (sBtn) sBtn.style.display = 'none';
            }
        }

        // Admin mode setup
        window.ADMIN_MODE = false;
        if (urlParams.has('admin')) {
            const authed = sessionStorage.getItem('tbg_admin');
            if (authed === '1') {
                window.ADMIN_MODE = true;
            } else {
                const pw = prompt('Admin password:');
                if (pw === ADMIN_PASS) {
                    sessionStorage.setItem('tbg_admin', '1');
                    window.ADMIN_MODE = true;
                }
            }
        }

        // Hide admin-only tabs
        if (!window.ADMIN_MODE) {
            ['tab-ai', 'tab-import'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }

        const vEl = document.getElementById('appVersion');
        if (vEl) vEl.textContent = `v${APP_VERSION}`;

        this.populateTeams();

        // Initial data load
        if (AppState.players.length === 0) {
            if (typeof SEED_PLAYERS !== 'undefined') {
                AppState.players = SEED_PLAYERS;
            } else {
                const players = await DataLoader.loadDefaultData();
                if (players.length > 0) AppState.players = players;
            }
        }

        // Merge external rankings + IDs into player objects
        if (typeof PLAYER_RANKINGS !== 'undefined') {
            AppState.players.forEach(p => {
                const r = PLAYER_RANKINGS[p.id];
                if (!r) return;
                if (r.ecr != null)         p.ecr          = r.ecr;
                if (r.espnAuction != null)  p.espnAuction  = r.espnAuction;
                if (r.adp != null)          p.adp          = r.adp;
                if (r.closerStatus != null) {
                    p.closerStatus = r.closerStatus;
                    p.closerRank   = r.closerStatus === 'CLOSER' ? 3 : r.closerStatus === 'HANDCUFF' ? 2 : 1;
                }
            });
        }
        if (typeof PLAYER_IDS !== 'undefined') {
            AppState.players.forEach(p => {
                const ids = PLAYER_IDS[p.id];
                if (ids?.fgId) p.fgId = ids.fgId;
            });
        }

        this.renderControls();
        this.render();
        this.setupEventListeners();
    },

    populateTeams() {
        const sel = document.getElementById('mTeam');
        if (!sel) return;
        sel.innerHTML = Object.entries(LG.teamsMap).map(([id, info]) =>
            `<option value="${id}">${info.team} (${info.owner.split(' ')[0]})</option>`
        ).join('');
    },

    renderControls() {
        const ctrlBar = document.getElementById('controlsBar');
        if (!ctrlBar) return;
        ctrlBar.innerHTML = Templates.controls();
    },

    render() {
        ValEngine.calculateAll();
        const players = this.getFilteredPlayers();
        this.updateHeader();
        
        const content = document.getElementById('mainContent');
        const tab = AppState.ui.activeTab;

        if (tab === 'auction') content.innerHTML = Templates.auction(players);
        else if (tab === 'season') content.innerHTML = Templates.season(players);
        else if (tab === 'arb') content.innerHTML = Templates.arb(players);
        else if (tab === 'myteam') content.innerHTML = Templates.myteam();
        else if (tab === 'league') content.innerHTML = Templates.league();
        else if (tab === 'standings') content.innerHTML = Templates.standings();
        else if (tab === 'ai') content.innerHTML = Templates.ai();
        else if (tab === 'import') content.innerHTML = Templates.import();
    },

    getFilteredPlayers() {
        let list = [...AppState.players];
        const ui = AppState.ui;

        if (ui.search) {
            const s = ui.search.toLowerCase();
            list = list.filter(p => p.n.toLowerCase().includes(s) || p.t.toLowerCase().includes(s));
        }
        if (ui.posFilter !== 'ALL') {
            list = list.filter(p => p.pos.includes(ui.posFilter));
        }
        if (ui.typeFilter === 'HIT') list = list.filter(p => p.PA > 0);
        if (ui.typeFilter === 'PIT') list = list.filter(p => p.IP > 0);
        if (ui.hideDrafted) list = list.filter(p => !AppState.drafted[p.id]);

        return list.sort((a, b) => {
            const av = a[ui.sortCol];
            const bv = b[ui.sortCol];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return ui.sortDir === 'desc' ? bv - av : av - bv;
        });
    },

    updateHeader() {
        const myDrafted = Object.entries(AppState.drafted).filter(([,v]) => v.team === 'me');
        const spent = myDrafted.reduce((s, [,v]) => s + v.cost, 0);
        const myPlayers = myDrafted.map(([id]) => AppState.players.find(p => p.id === id)).filter(Boolean);
        const projIP = myPlayers.reduce((s, p) => s + (p.IP || 0), 0);

        const hBudget = document.getElementById('hBudget');
        const hRoster = document.getElementById('hRoster');
        const hIP = document.getElementById('hIP');

        if (hBudget) hBudget.textContent = `$${LG.budget - spent}`;
        if (hRoster) hRoster.textContent = `${myPlayers.length}/${LG.total}`;
        if (hIP) {
            hIP.textContent = Math.round(projIP);
            hIP.style.color = projIP >= LG.minIP ? '#40b870' : (projIP > 600 ? '#e8c040' : '#d04040');
        }
        
        const sTot = document.getElementById('sTot');
        if (sTot) sTot.textContent = AppState.players.length;
    },

    // --- Action Handlers (Proxies to specific engines) ---

    handleSearch(val) {
        AppState.ui.search = val;
        this.render();
    },

    async handleRefreshNews() {
        const btn = event.target;
        btn.textContent = "REFRESHING...";
        const count = await InjuryManager.refreshNews();
        btn.textContent = "REFRESH NEWS";
        this.render();
    },

    updateSplitLabel(val) {
        const b = document.getElementById('splitBadge');
        if (b) b.textContent = val + '%';
    },

    updateCutoffLabel(val) {
        const b = document.getElementById('cutoffBadge');
        if (b) b.textContent = val;
    },

    showTab(tab) {
        AppState.ui.activeTab = tab;
        document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`));
        const hasControls = ['auction', 'season', 'arb'].includes(tab);
        const ctrlBar = document.getElementById('controlsBar');
        if (ctrlBar) ctrlBar.style.display = hasControls ? 'block' : 'none';
        this.render();
    },

    // --- Modal Proxies ---
    openDraftModal(id) { Modals.openDraftModal(id); },
    confirmDraft() { Modals.confirmDraft(); },
    openInjuryModal(id) { Modals.openInjuryModal(id); },
    savePlayerNote() { Modals.savePlayerNote(); },
    closeModal() { Modals.closeModal(); },

    setSort(col) {
        if (AppState.ui.sortCol === col) {
            AppState.ui.sortDir = AppState.ui.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            AppState.ui.sortCol = col;
            AppState.ui.sortDir = 'desc';
        }
        this.render();
    },

    saveApiKey() {
        const key = document.getElementById('aiKeyInput')?.value?.trim();
        if (key) { localStorage.setItem('claudeApiKey', key); this.render(); }
    },

    handleAssistant() {
        const input = document.getElementById('assistantInput');
        const log = document.getElementById('assistantLog');
        const res = Assistant.processCommand(input.value);
        log.innerHTML = `<div style="margin-bottom:8px">${res}</div>` + log.innerHTML;
        input.value = '';
        this.render();
    },

    async handleAIQuery() {
        const apiKey = localStorage.getItem('claudeApiKey');
        if (!apiKey) { alert('Enter your Claude API key first.'); return; }
        const input = document.getElementById('aiInput');
        const question = input?.value?.trim();
        if (!question) return;

        const btn = document.getElementById('aiBtnSend');
        if (btn) { btn.textContent = '⟳ Thinking…'; btn.disabled = true; }
        if (input) input.value = '';

        const ctx = StateManager.generateAIContext();
        const teamsContext = Object.entries(LG.teamsMap).map(([tid, info]) => {
            const picks = Object.entries(AppState.drafted)
                .filter(([,v]) => v.team === tid)
                .map(([id, pick]) => { const p = AppState.players.find(x => x.id === id); return p ? `${p.n} $${pick.cost}` : null; })
                .filter(Boolean);
            const spent = Object.entries(AppState.drafted).filter(([,v]) => v.team === tid).reduce((s,[,v]) => s + v.cost, 0);
            return `${info.team}: $${LG.budget - spent} left, ${picks.length} players [${picks.join(', ') || 'none'}]`;
        }).join('\n');

        const system = `You are a sharp fantasy baseball advisor for the Teddy Ballgame League (10-team Roto, Fantrax).
Roto categories: HR, SB, XBH (2B+3B), OBP, RP (R+RBI) | K, W, ERA, SVH (SV+HLD), WHIP.
CRITICAL: 1,000 IP minimum per season — missing it forfeits ERA + WHIP for the entire season.
Draft format: Auction (17 players, $202 budget) + 14-round snake. $400 FAAB blind bid in-season.

MY TEAM (${ctx.rosterSize}, $${ctx.budgetRemaining} remaining):
${ctx.currentRoster.length ? ctx.currentRoster.join(' | ') : 'No picks yet'}

ALL TEAMS:
${teamsContext}

Be concise. Lead with the recommendation, then brief reasoning.`;

        const entry = { q: question, a: '', ts: Date.now(), streaming: true };
        AppState.aiHistory.unshift(entry);
        this.render();

        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, stream: true, system, messages: [{ role: 'user', content: question }] })
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `HTTP ${res.status}`); }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let answer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value).split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const evt = JSON.parse(data);
                        if (evt.type === 'content_block_delta' && evt.delta?.text) {
                            answer += evt.delta.text;
                            entry.a = answer;
                            const el = document.getElementById('aiStreamTarget');
                            if (el) el.textContent = answer;
                        }
                    } catch {}
                }
            }
            entry.streaming = false;
            if (AppState.aiHistory.length > 20) AppState.aiHistory.pop();
            StateManager.save();
        } catch (e) {
            entry.a = `Error: ${e.message}`;
            entry.streaming = false;
        }
        this.render();
        setTimeout(() => document.getElementById('aiInput')?.focus(), 50);
    },

    copyAICatContext() {
        const ctx = StateManager.getAICategoryContext();
        navigator.clipboard.writeText(ctx).then(() => alert('Draft context copied to clipboard!'));
    },

    setupEventListeners() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && document.getElementById('modalBg').classList.contains('open')) this.confirmDraft();
            if (e.key === 'Escape') this.closeModal();
        });
    }
};
