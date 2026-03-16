/**
 * UI Component Controller for the Teddy Ballgame Draft Tool.
 * Orchestrates rendering, data loading, and event handling.
 */

const UI = {
    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        const sharedState = urlParams.get('s');

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
        if (typeof MANUAL_RANKINGS !== 'undefined') {
            AppState.players.forEach(p => {
                const r = MANUAL_RANKINGS[p.id];
                if (r) Object.assign(p, r);
            });
            // Expose manual column names for the column toggle UI
            AppState.manualCols = [...new Set(
                Object.values(MANUAL_RANKINGS).flatMap(r => Object.keys(r))
            )];
        } else {
            AppState.manualCols = [];
        }

        // Merge FANTRAX_DATA (league-scoring ranks + projected stats)
        if (typeof FANTRAX_DATA !== 'undefined') {
            AppState.players.forEach(p => {
                const f = FANTRAX_DATA[p.id];
                if (f) Object.assign(p, f);
            });
        }

        // Merge INJURY_CACHE (baked static news) into AppState.injuryCache
        // localStorage entries win when their timestamp is newer
        if (typeof INJURY_CACHE !== 'undefined') {
            Object.entries(INJURY_CACHE).forEach(([id, entry]) => {
                const existing = AppState.injuryCache[id];
                if (!existing || entry.ts > existing.ts) {
                    AppState.injuryCache[id] = entry;
                }
            });
        }

        // Merge STEAMER_EXTRAS (unofficial Steamer estimates)
        if (typeof STEAMER_EXTRAS !== 'undefined') {
            // Only add extras not already in seed
            const seedIds = new Set(AppState.players.map(p => p.id));
            STEAMER_EXTRAS.forEach(p => {
                if (!seedIds.has(p.id)) AppState.players.push(p);
            });
        }

        // Apply shared state AFTER players are loaded so index lookups work
        if (sharedState) {
            if (ShareManager.loadFromStateString(sharedState)) {
                const banner = document.getElementById('readOnlyBanner');
                if (banner) banner.style.display = 'flex';
                const sBtn = document.getElementById('shareBtn');
                if (sBtn) sBtn.style.display = 'none';
            }
        }

        this.renderControls();
        this.render();
        this.setupEventListeners();
    },

    populateTeams() {
        const sel = document.getElementById('mTeam');
        if (!sel) return;
        sel.innerHTML = Object.entries(LG.teamsMap).map(([id, info]) =>
            `<option value="${id}">${info.team} (${info.owner})</option>`
        ).join('');
    },

    renderControls() {
        const ctrlBar = document.getElementById('controlsBar');
        if (!ctrlBar) return;
        ctrlBar.innerHTML = Templates.controls();
    },

    render() {
        // Save focused input inside mainContent so we can restore after DOM replacement
        const mainContent = document.getElementById('mainContent');
        const active = document.activeElement;
        const saveFocusId  = (mainContent?.contains(active) && active?.id &&
                              (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'))
                             ? active.id : null;
        const saveSel      = saveFocusId ? active.selectionStart : null;

        ValEngine.calculateAll();
        const players = this.getFilteredPlayers();
        this.updateHeader();

        const content = document.getElementById('mainContent');
        const tab = AppState.ui.activeTab;

        if (tab === 'auction') content.innerHTML = Templates.auction(players);
        else if (tab === 'arb') content.innerHTML = Templates.arb(players);
        else if (tab === 'myteam') content.innerHTML = Templates.myteam();
        else if (tab === 'league') content.innerHTML = Templates.league();
        else if (tab === 'standings') content.innerHTML = Templates.standings();
        else if (tab === 'snake')        content.innerHTML = Templates.snake();
        else if (tab === 'rosterscout')  content.innerHTML = Templates.rosterscout();
        else if (tab === 'dataaudit')    content.innerHTML = Templates.dataaudit();
        else if (tab === 'ai') content.innerHTML = Templates.ai();
        else if (tab === 'import') content.innerHTML = Templates.import();

        // Apply zoom scaling
        const zoom = AppState.ui.uiZoom || 1.0;
        content.style.zoom = zoom;
        const ctrlBar2 = document.getElementById('controlsBar');
        if (ctrlBar2) ctrlBar2.style.zoom = zoom;

        // Restore focus to the input that was active before re-render
        if (saveFocusId) {
            const el = document.getElementById(saveFocusId);
            if (el) {
                el.focus();
                try { if (saveSel != null) el.setSelectionRange(saveSel, saveSel); } catch(e) {}
            }
        }
    },

    getFilteredPlayers() {
        let list = [...AppState.players];
        const ui = AppState.ui;

        if (ui.search) {
            const s = ui.search.toLowerCase();
            list = list.filter(p => p.n.toLowerCase().includes(s) || p.t.toLowerCase().includes(s));
        }
        if (ui.posFilter !== 'ALL') {
            if (ui.posFilter === 'MI') list = list.filter(p => p.pos.includes('2B') || p.pos.includes('SS'));
            else if (ui.posFilter === 'CI') list = list.filter(p => p.pos.includes('1B') || p.pos.includes('3B'));
            else list = list.filter(p => p.pos.includes(ui.posFilter));
        }
        if (ui.typeFilter === 'HIT') list = list.filter(p => p.PA > 0);
        if (ui.typeFilter === 'PIT') list = list.filter(p => p.IP > 0);
        if (ui.hideDrafted) list = list.filter(p => !effectiveDrafted()[p.id]);
        if (ui.hideSubRep)  list = list.filter(p => (p.csValS || 0) > 0);

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
        const myDrafted = Object.entries(effectiveDrafted()).filter(([,v]) => v.team === 'me');
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
        const hasControls = ['auction', 'arb'].includes(tab);
        const ctrlBar = document.getElementById('controlsBar');
        if (ctrlBar) ctrlBar.style.display = hasControls ? 'block' : 'none';
        this.render();
    },

    // --- Draft Simulation ---
    // Shared helpers for simulation
    _simBuildRealRosters(teams) {
        // Only count non-sim picks as the "real" base when building sim rosters
        const realRosters = {};
        teams.forEach(tid => { realRosters[tid] = []; });
        Object.entries(AppState.drafted).forEach(([id, pick]) => {
            if (pick.sim) return; // exclude previous sim picks
            const p = AppState.players.find(x => x.id === id);
            if (p && realRosters[pick.team]) realRosters[pick.team].push(p);
        });
        return realRosters;
    },

    _simAssignCosts(simRosters, realRosters) {
        // Write sim picks directly into drafted + draftLog with sim:true flag
        Object.entries(simRosters).forEach(([tid, picks]) => {
            if (!picks.length) return;
            const auctionPicks = picks.filter(p => p._simAuction);
            const snakePicks   = picks.filter(p => !p._simAuction);
            const realSpent    = realRosters[tid].reduce((s, p) => s + (AppState.drafted[p.id]?.cost || 0), 0);
            const budget       = Math.max(LG.budget - realSpent, auctionPicks.length);
            const totalVal     = auctionPicks.reduce((s, p) => s + Math.max(p.csValAAdj || 1, 1), 0);
            auctionPicks.forEach(p => {
                const base  = Math.max(p.csValAAdj || 1, 1) / totalVal * budget;
                const cost  = Math.max(1, Math.round(base * (0.70 + Math.random() * 0.60)));
                const entry = { cost, team: tid, ts: Date.now(), sim: true };
                AppState.drafted[p.id] = entry;
                AppState.draftLog.push({ id: p.id, ...entry });
            });
            snakePicks.forEach(p => {
                const entry = { cost: 0, team: tid, ts: Date.now(), sim: true };
                AppState.drafted[p.id] = entry;
                AppState.draftLog.push({ id: p.id, ...entry });
            });
        });
    },

    simulateAuction() {
        const teams      = Object.keys(LG.teamsMap);
        const realRosters = this._simBuildRealRosters(teams);
        const taken      = new Set(Object.keys(AppState.drafted));
        // Shuffle pool with value-weighted noise so not always the same players
        const pool = AppState.players
            .filter(p => !taken.has(p.id) && (p.csValAAdj || 0) > 0)
            .map(p => ({ p, sort: (p.csValAAdj || 0) + (Math.random() - 0.5) * 8 }))
            .sort((a, b) => b.sort - a.sort)
            .map(x => x.p);

        const simRosters = {};
        teams.forEach(tid => { simRosters[tid] = []; });
        const simPicked = new Set();

        // Simple snake with per-round shuffle and occasional skip (reach/miss)
        for (let round = 0; round < LG.aSlots + 2; round++) {
            const base  = round % 2 === 0 ? [...teams] : [...teams].reverse();
            // Slight shuffle within round to simulate bidding chaos
            const order = base.map((t, i) => ({ t, r: i + (Math.random() - 0.5) * 1.5 }))
                              .sort((a, b) => a.r - b.r).map(x => x.t);
            for (const tid of order) {
                const realAuc = realRosters[tid].length;
                const simAuc  = simRosters[tid].filter(p => p._simAuction).length;
                if (realAuc + simAuc >= LG.aSlots) continue;
                // 15% chance to skip best and take next-best (simulate being outbid)
                const skip   = Math.random() < 0.15 ? 1 : 0;
                let found = 0;
                const pick = pool.find(p => {
                    if (simPicked.has(p.id)) return false;
                    if (found++ < skip) return false;
                    return true;
                });
                if (!pick) continue;
                pick._simAuction = true;
                simPicked.add(pick.id);
                simRosters[tid].push(pick);
            }
        }

        this.clearSimulation(); // wipe any previous sim picks first
        this._simAssignCosts(simRosters, realRosters);
        StateManager.save();
        this.render();
    },

    simulateDraft() {
        const teams       = Object.keys(LG.teamsMap);
        const realRosters = this._simBuildRealRosters(teams);
        const taken       = new Set(Object.keys(AppState.drafted));
        const pool = AppState.players
            .filter(p => !taken.has(p.id) && (p.csValAAdj || 0) > 0)
            .map(p => ({ p, sort: (p.csValAAdj || 0) + (Math.random() - 0.5) * 8 }))
            .sort((a, b) => b.sort - a.sort)
            .map(x => x.p);

        const quota   = { C: 1, '1B': 2, '2B': 2, '3B': 2, SS: 2, OF: 5, SP: 5, RP: 3 };
        const posOrder = ['SP', 'RP', 'C', '1B', 'SS', '2B', '3B', 'OF'];
        const simRosters = {};
        teams.forEach(tid => { simRosters[tid] = []; });
        const simPicked = new Set();

        const getCounts = tid => {
            const all = [...realRosters[tid], ...simRosters[tid]];
            const c = {};
            all.forEach(p => p.pos.forEach(pos => { c[pos] = (c[pos] || 0) + 1; }));
            return c;
        };
        const getSize  = tid => realRosters[tid].length + simRosters[tid].length;
        const needPos  = tid => {
            const c = getCounts(tid);
            for (const pos of posOrder) if ((c[pos] || 0) < (quota[pos] || 0)) return pos;
            return null;
        };
        const bestFor  = (posFilter, skip = 0) => {
            let skipped = 0;
            return pool.find(p => {
                if (simPicked.has(p.id)) return false;
                if (posFilter && !p.pos.includes(posFilter)) return false;
                return skipped++ >= skip;
            });
        };

        for (let round = 0; round < LG.total + 5; round++) {
            const isAuction = round < LG.aSlots;
            const base  = round % 2 === 0 ? [...teams] : [...teams].reverse();
            const order = base.map((t, i) => ({ t, r: i + (Math.random() - 0.5) * 1.5 }))
                              .sort((a, b) => a.r - b.r).map(x => x.t);
            let anyPick = false;
            for (const tid of order) {
                if (getSize(tid) >= LG.total) continue;
                const auctionSoFar = simRosters[tid].filter(p => p._simAuction).length + realRosters[tid].length;
                if (isAuction && auctionSoFar >= LG.aSlots) continue;
                if (!isAuction && auctionSoFar < LG.aSlots) continue;
                const skip = Math.random() < 0.15 ? 1 : 0;
                const pos  = needPos(tid);
                const pick = bestFor(pos, skip) || bestFor(null, skip) || bestFor(null, 0);
                if (!pick) continue;
                anyPick = true;
                if (isAuction) pick._simAuction = true;
                simPicked.add(pick.id);
                simRosters[tid].push(pick);
            }
            if (!anyPick) break;
        }

        this.clearSimulation(); // wipe any previous sim picks first
        this._simAssignCosts(simRosters, realRosters);
        StateManager.save();
        this.render();
    },

    clearSimulation() {
        const simIds = new Set(Object.entries(AppState.drafted).filter(([,v]) => v.sim).map(([id]) => id));
        simIds.forEach(id => delete AppState.drafted[id]);
        AppState.draftLog = AppState.draftLog.filter(e => !simIds.has(e.id));
        StateManager.save();
        this.render();
    },

    // --- Modal Proxies ---
    openDraftModal(id) { Modals.openDraftModal(id); },
    confirmDraft() { Modals.confirmDraft(); },
    undraftPending() { const id = AppState.pendingPlayerId; if (id) { Modals.closeModal(); Modals.undraftPlayer(id); } },
    undoLastPick() { StateManager.undoLastPick(); },
    openInjuryModal(id) { Modals.openInjuryModal(id); },
    savePlayerNote() { Modals.savePlayerNote(); },
    closeModal() { Modals.closeModal(); },

    toggleCol(key) {
        const h = AppState.ui.hiddenCols;
        const i = h.indexOf(key);
        if (i === -1) h.push(key); else h.splice(i, 1);
        this.render();
    },

    colVisible(key) {
        return !AppState.ui.hiddenCols.includes(key);
    },

    toggleArbOutlier() {
        AppState.ui.arbOutlierOnly = !AppState.ui.arbOutlierOnly;
        this.render();
    },

    setMyteamView(tid) {
        AppState.ui.myteamView = tid;
        this.render();
    },

    setSnakeSlot(slot, teamId) {
        if (AppState.snakeOrder.length < 10) AppState.snakeOrder = new Array(10).fill('');
        AppState.snakeOrder[slot] = teamId;
        StateManager.save();
        this.render();
    },

    advanceSnakePick(delta) {
        const max = Object.keys(LG.teamsMap).length * LG.sSlots;
        AppState.snakePick = Math.max(0, Math.min(max, AppState.snakePick + delta));
        StateManager.save();
        this.render();
    },

    resetSnakePick() {
        AppState.snakePick = 0;
        StateManager.save();
        this.render();
    },

    setSnakePlannerN(n) {
        AppState.settings.snakePlannerN = parseInt(n);
        StateManager.save();
        this.render();
    },

    setRosterTarget(pos, val) {
        if (!AppState.settings.rosterTargets) AppState.settings.rosterTargets = {};
        const n = parseInt(val);
        if (n >= 1 && n <= 20) AppState.settings.rosterTargets[pos] = n;
        StateManager.save();
        this.render();
    },

    resetRosterTargets() {
        AppState.settings.rosterTargets = {};
        StateManager.save();
        this.render();
    },

    setLeagueTeamFilter(tid) {
        AppState.ui.leagueTeamFilter = (AppState.ui.leagueTeamFilter === tid) ? null : tid;
        this.render();
    },

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
