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
                if (r.ecrMin != null)       p.ecrMin       = r.ecrMin;
                if (r.ecrMax != null)       p.ecrMax       = r.ecrMax;
                if (r.espnAuction != null)  p.espnAuction  = r.espnAuction;
                if (r.pctOwned != null)     p.pctOwned     = r.pctOwned;
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

        // Merge FANTRAX_ROSTERS (live roster data from bake_rosters.py)
        mergeFantraxRosters();

        // Load owner profiles (non-critical, async)
        fetch('data/owner_profiles/summary.json')
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) AppState.ownerProfiles = data; })
            .catch(() => {});

        // Apply shared state AFTER players are loaded so index lookups work
        if (sharedState) {
            if (ShareManager.loadFromStateString(sharedState)) {
                const banner = document.getElementById('readOnlyBanner');
                if (banner) banner.style.display = 'flex';
                const sBtn = document.getElementById('shareBtn');
                if (sBtn) sBtn.style.display = 'none';
            }
        }

        // Auto-load baked 2026 draft state if localStorage has no picks
        // Must run here (not StateManager.load) because draft_state_2026.js loads after state.js
        if (!Object.keys(AppState.drafted).length && typeof DRAFT_STATE_2026 !== 'undefined') {
            AppState.drafted   = DRAFT_STATE_2026.drafted   || {};
            AppState.draftLog  = DRAFT_STATE_2026.draftLog  || [];
            AppState.snakePick = DRAFT_STATE_2026.snakePick || 0;
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

        // Update filtered count in status bar
        const sFiltered = document.getElementById('sFiltered');
        const sFilteredN = document.getElementById('sFilteredN');
        const isFiltered = players.length < AppState.players.length;
        if (sFiltered) sFiltered.style.display = isFiltered ? '' : 'none';
        if (sFilteredN) sFilteredN.textContent = players.length;

        const content = document.getElementById('mainContent');
        const tab = AppState.ui.activeTab;

        if (tab === 'auction') content.innerHTML = Templates.auction(players);
        else if (tab === 'arb') content.innerHTML = Templates.arb(players);
        else if (tab === 'freeagents') {
            const was = AppState.ui.hideDrafted;
            AppState.ui.hideDrafted = true;
            content.innerHTML = Templates.auction(this.getFilteredPlayers());
            AppState.ui.hideDrafted = was;
        }
        else if (tab === 'watchlist') {
            const wl = AppState.watchlist || [];
            const wlPlayers = this.getFilteredPlayers().filter(p => wl.includes(p.id));
            content.innerHTML = wlPlayers.length
                ? Templates.auction(wlPlayers)
                : `<div style="padding:40px;text-align:center;color:#406080;font-size:13px">No players on watchlist.<br><br><span style="font-size:11px;opacity:0.6">Click ☆ on any player in FREE AGENTS or AUCTION BOARD to add them.</span></div>`;
        }
        else if (tab === 'myteam') content.innerHTML = Templates.myteam();
        else if (tab === 'league') content.innerHTML = Templates.league();
        else if (tab === 'standings') content.innerHTML = Templates.standings();
        else if (tab === 'faab') this.renderFaab();
        else if (tab === 'trade') this.renderTrade();
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
        if (ui.scoutOnly)  list = list.filter(p => p.CM_Role || p.PL_Rank || p.HL_Rank);
        if (ui.watchOnly)  list = list.filter(p => p.Watch);
        if (ui.plOnly)     list = list.filter(p => p.PL_Rank || p.HL_Rank);
        if (ui.hideInjured) list = list.filter(p => {
            const news = InjuryManager.getLatestFor(p.id);
            const prog = (news?.summary?.match(/PROGNOSIS:\s*(\w+)/i) || [])[1]?.toLowerCase();
            return !p.inj && !(prog && (prog === 'serious' || prog === 'moderate'));
        });

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
        const hasControls = ['auction', 'arb', 'freeagents', 'watchlist'].includes(tab);
        const ctrlBar = document.getElementById('controlsBar');
        if (ctrlBar) ctrlBar.style.display = hasControls ? 'block' : 'none';
        this.render();
    },

    toggleDraftMode() {
        const draftTabs = document.querySelectorAll('.draft-only');
        const anyVisible = [...draftTabs].some(el => el.style.display !== 'none');
        draftTabs.forEach(el => { el.style.display = anyVisible ? 'none' : ''; });
    },

    toggleWatchlist(id) {
        const wl = AppState.watchlist || (AppState.watchlist = []);
        const idx = wl.indexOf(id);
        if (idx === -1) wl.push(id);
        else wl.splice(idx, 1);
        StateManager.save();
        this.render();
    },

    setStandingsSort(col) {
        const invCols = new Set(['ERA', 'WHIP']);
        const defaultDir = invCols.has(col) ? 'asc' : 'desc';
        if (AppState.ui.standingsSortCol === col) {
            AppState.ui.standingsSortDir = AppState.ui.standingsSortDir === 'desc' ? 'asc' : 'desc';
        } else {
            AppState.ui.standingsSortCol = col;
            AppState.ui.standingsSortDir = defaultDir;
        }
        this.render();
    },

    toggleStandingsTeam(tid) {
        AppState.ui.standingsExpandedTeam =
            AppState.ui.standingsExpandedTeam === tid ? null : tid;
        this.render();
    },

    toggleLineupPlayer(teamId, playerId) {
        const overrides = AppState.ui.lineupOverrides || (AppState.ui.lineupOverrides = {});
        if (!overrides[teamId]) {
            const picks = Object.entries(effectiveDrafted())
                .filter(([, v]) => v.team === teamId)
                .map(([id]) => AppState.players.find(p => p.id === id))
                .filter(Boolean);
            const { starters, bench } = optimalLineup(picks);
            overrides[teamId] = {
                active: starters.map(p => p.id),
                bench: bench.map(p => p.id)
            };
        }
        const ov = overrides[teamId];
        if (ov.active.includes(playerId)) {
            ov.active = ov.active.filter(id => id !== playerId);
            ov.bench.push(playerId);
        } else {
            ov.bench = ov.bench.filter(id => id !== playerId);
            ov.active.push(playerId);
        }
        this.render();
    },

    resetLineupOverride(teamId) {
        if (AppState.ui.lineupOverrides) delete AppState.ui.lineupOverrides[teamId];
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

    toggleSource(keys) {
        const h = AppState.ui.hiddenCols;
        const anyVisible = keys.some(k => !h.includes(k));
        if (anyVisible) {
            keys.forEach(k => { if (!h.includes(k)) h.push(k); });
        } else {
            keys.forEach(k => { const i = h.indexOf(k); if (i !== -1) h.splice(i, 1); });
        }
        this.render();
    },

    colVisible(key) {
        return !AppState.ui.hiddenCols.includes(key);
    },

    sourceVisible(keys) {
        return keys.some(k => !AppState.ui.hiddenCols.includes(k));
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

    toggleSnakePos(pos) {
        const f = AppState.ui.snakePosFilter;
        const idx = f.indexOf(pos);
        if (idx >= 0) f.splice(idx, 1); else f.push(pos);
        this.render();
    },

    toggleRosterPos(pos) {
        const f = AppState.ui.rosterPosFilter;
        const idx = f.indexOf(pos);
        if (idx >= 0) f.splice(idx, 1); else f.push(pos);
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

    // ─── FAAB ADVISOR TAB ──────────────────────────────────────────────────────

    clearAnalysisCache() {
        AppState.faabEnriched     = null;
        AppState.tradeAssets      = null;
        AppState.tradeSuggestions = null;
    },

    renderFaab() {
        const content = document.getElementById('mainContent');
        if (!content) return;

        // Determine FA source: live fantraxRosters.fa (preferred) or recommendations JSON
        const liveFa = AppState.fantraxRosters && AppState.fantraxRosters.fa;
        const hasFaab = AppState.faab && AppState.faab.recommendations;

        if (!liveFa && !hasFaab) {
            content.innerHTML = `
                <div style="padding:30px;text-align:center;color:#dde8f8;font-size:14px;line-height:1.5">
                    <div style="margin-bottom:8px">Loading FAAB recommendations…</div>
                    <div style="font-size:12px;opacity:0.6">Source: data/faab_recommendations.json</div>
                    <button class="btn btn-go" style="margin-top:10px" onclick="UI.loadFaabRecommendations()">Reload</button>
                </div>`;
            this.loadFaabRecommendations();
            return;
        }

        const rawRecs = liveFa || AppState.faab.recommendations || [];
        const budget  = (AppState.faab && AppState.faab.faabBudget) || 400;
        const srcLabel = liveFa
            ? `Live Fantrax (${liveFa.length} FAs · ${AppState.fantraxRosters._meta && AppState.fantraxRosters._meta.source || ''})`
            : `faab_recommendations.json · ${AppState.faab && AppState.faab.runAt || ''}`;

        const posFilter = AppState.ui.faabPosFilter || 'ALL';
        const statSort  = AppState.ui.faabStatSort  || 'ROTO+';
        const opts = { useOptimal: AppState.ui.projOptimal !== false, useRepl: AppState.ui.projILRepl !== false };

        // Enrichment — compute once, cache until roster changes or forced refresh
        if (!AppState.faabEnriched || AppState.ui.faabForceRefresh) {
            AppState.faabEnriched = FaabEngine.enrichFaabCandidates(
                rawRecs, effectiveDrafted(), AppState.players, opts, 'me'
            );
            AppState.ui.faabForceRefresh = false;
        }
        const enriched = AppState.faabEnriched;

        // Filter
        let visible = enriched.filter(r => {
            if (r._alreadyDrafted) return false;
            if (posFilter === 'ALL') return true;
            return (r.Position || '').split(',').map(p => p.trim()).includes(posFilter);
        });

        // Sort
        const sortBy = {
            'ROTO+': (a, b) => b._deltaROTO - a._deltaROTO,
            'Fit':   (a, b) => b._teamFit   - a._teamFit,
            'Score': (a, b) => b.Score       - a.Score,
            'ADP':   (a, b) => (a.ADP || 999) - (b.ADP || 999),
            'HR':    (a, b) => (b._player && b._player.HR || 0) - (a._player && a._player.HR || 0),
            'SB':    (a, b) => (b._player && b._player.SB || 0) - (a._player && a._player.SB || 0),
            'K':     (a, b) => (b._player && b._player.K  || 0) - (a._player && a._player.K  || 0),
            'W':     (a, b) => (b._player && b._player.W  || 0) - (a._player && a._player.W  || 0),
            'ERA':   (a, b) => (a._player && a._player.ERA || 99) - (b._player && b._player.ERA || 99),
            'WHIP':  (a, b) => (a._player && a._player.WHIP || 9) - (b._player && b._player.WHIP || 9),
            'SVH':   (a, b) => (b._player && b._player.SVH || 0) - (a._player && a._player.SVH || 0),
        };
        visible.sort(sortBy[statSort] || sortBy['ROTO+']);

        const selOpts = (current, opts2) => opts2.map(v =>
            `<option value="${v}"${v === current ? ' selected' : ''}>${v}</option>`
        ).join('');

        let html = `
        <div style="padding:10px 14px 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-bottom:1px solid #0a1e30">
            <span style="color:#7090a8;font-size:11px;flex:1">Source: <span style="color:#9cb8d8">${srcLabel}</span></span>
            <span style="font-size:11px;color:#7090a8">FAAB: <strong style="color:#b0d8ff">$${budget}</strong></span>
            <button class="btn" onclick="UI.loadFaabRecommendations()">Reload JSON</button>
            <button class="btn btn-go" onclick="AppState.ui.faabForceRefresh=true;UI.render()">Refresh Analysis</button>
        </div>
        <div style="padding:8px 14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <label style="font-size:11px;color:#9cb8d8">Pos:</label>
            <select onchange="AppState.ui.faabPosFilter=this.value;UI.render()" style="font-size:11px;padding:2px 6px">
                ${selOpts(posFilter, ['ALL','C','1B','2B','3B','SS','OF','SP','RP'])}
            </select>
            <label style="font-size:11px;color:#9cb8d8;margin-left:8px">Sort:</label>
            <select onchange="AppState.ui.faabStatSort=this.value;UI.render()" style="font-size:11px;padding:2px 6px">
                ${selOpts(statSort, ['ROTO+','Fit','Score','ADP','HR','SB','K','W','SVH','ERA','WHIP'])}
            </select>
            <span style="font-size:11px;color:#506878;margin-left:8px">${visible.length} players · ROTO+ = rank-pts gained by adding player</span>
        </div>
        <div class="tbl-wrap"><table class="grid" style="width:100%;font-size:12px">
            <thead><tr>
                <th style="width:28px;text-align:right">#</th>
                <th>Player</th>
                <th style="width:70px">Pos</th>
                <th style="width:50px;text-align:right" title="Fantrax score">Score</th>
                <th style="width:44px;text-align:right">ADP</th>
                <th style="width:52px;text-align:right;color:#40b870" title="Roto rank-points gained by adding to your team">ROTO+</th>
                <th style="width:38px;text-align:right" title="Team fit (position need + scarcity)">Fit</th>
                <th style="width:90px" title="Team that benefits most from adding this player (trade demand)">Best Trade-To</th>
                <th>Role / News</th>
            </tr></thead>
            <tbody>`;

        if (!visible.length) {
            html += `<tr><td colspan="9" style="text-align:center;color:#88a8c4;padding:20px">No players found for filter.</td></tr>`;
        } else {
            visible.slice(0, 75).forEach((r, idx) => {
                const p   = r._player || {};
                const dr  = r._deltaROTO;
                const drClr  = dr > 1 ? '#40b870' : dr > 0 ? '#8ec8a0' : dr < 0 ? '#d04040' : '#7090a8';
                const injBadge = p.inj ? ' <span style="color:#e8c040;font-size:10px">INJ</span>' : '';
                const unmatch  = !r._player ? ' <span style="opacity:0.4;font-size:10px">(est)</span>' : '';

                let tradeTo = '—';
                if (r._bestTradeTo && r._bestTradeTo.delta > 0) {
                    tradeTo = `<span style="color:#9cb8d8">${r._bestTradeTo.team}</span> <span style="color:#6080a0;font-size:10px">+${r._bestTradeTo.delta.toFixed(1)}</span>`;
                }

                const roleShort = (r._roleNews || '—').substring(0, 70);
                const roleFull  = (r._roleNews || '').replace(/"/g, '&quot;');

                html += `<tr${r._alreadyDrafted ? ' style="opacity:0.35"' : ''}>
                    <td style="text-align:right;color:#506878">${idx + 1}</td>
                    <td>${r.Player}${injBadge}${unmatch}</td>
                    <td style="color:#9cb8d8">${r.Position}</td>
                    <td style="text-align:right">${(+r.Score || 0).toFixed(1)}</td>
                    <td style="text-align:right;color:#7090a8">${r.ADP && r.ADP < 900 ? (+r.ADP).toFixed(0) : '—'}</td>
                    <td style="text-align:right;font-weight:700;color:${drClr}">${dr > 0 ? '+' : ''}${dr.toFixed(2)}</td>
                    <td style="text-align:right;color:#9cb8d8">${r._teamFit.toFixed(1)}</td>
                    <td>${tradeTo}</td>
                    <td style="color:#7090a8;font-size:11px" title="${roleFull}">${roleShort}</td>
                </tr>`;
            });
        }

        html += '</tbody></table></div>';
        content.innerHTML = html;
    },

    loadFaabRecommendations() {
        fetch('data/faab_recommendations.json', {cache: 'no-store'})
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(data => {
                AppState.faab = data;
                if (!AppState.faab.faabBudget) AppState.faab.faabBudget = 400;
                AppState.faab.runAt = new Date().toLocaleString();
                AppState.faabEnriched = null; // bust cache
                this.render();
            })
            .catch(err => {
                const c = document.getElementById('mainContent');
                if (c) c.innerHTML = `<div style="padding:30px;text-align:center;color:#e8b0b0;font-size:13px">Failed to load FAAB data: ${err.message}</div>`;
            });
    },

    // ─── TRADE LAB TAB ─────────────────────────────────────────────────────────

    renderTrade() {
        const content = document.getElementById('mainContent');
        if (!content) return;
        const sub = AppState.ui.tradeSubView || 'assets';
        const tabs = [['assets','MY ASSETS'],['ideas','TRADE IDEAS'],['evaluate','EVALUATE']];
        const tabBar = tabs.map(([k, lbl]) =>
            `<button class="btn${k === sub ? ' btn-go' : ''}" style="font-size:11px"
                onclick="AppState.ui.tradeSubView='${k}';UI.render()">${lbl}</button>`
        ).join('');
        const opts = { useOptimal: AppState.ui.projOptimal !== false, useRepl: AppState.ui.projILRepl !== false };

        let inner = '';
        if (sub === 'assets')   inner = this._renderTradeAssets(opts);
        if (sub === 'ideas')    inner = this._renderTradeIdeas(opts);
        if (sub === 'evaluate') inner = this._renderTradeEvaluate(opts);

        content.innerHTML = `
            <div style="padding:8px 14px;display:flex;gap:6px;align-items:center;border-bottom:1px solid #0a1e30;flex-shrink:0">
                ${tabBar}
                <span style="font-size:11px;color:#506878;margin-left:10px">All simulations use your current projected rosters · standings engine</span>
            </div>
            ${inner}`;
    },

    _renderTradeAssets(opts) {
        const drafted = effectiveDrafted();
        const players = AppState.players;

        if (!AppState.tradeAssets) {
            return `<div style="padding:30px;text-align:center">
                <div style="color:#9cb8d8;margin-bottom:12px;font-size:13px">Compute marginal roto value for every player on your roster.</div>
                <button class="btn btn-go" onclick="UI.computeTradeAssets()">COMPUTE MY ASSETS</button>
            </div>`;
        }

        const assets = AppState.tradeAssets;
        const myTid  = 'me';

        // Get my players with asset data
        const myPlayers = Object.entries(assets)
            .filter(([, a]) => a.tid === myTid)
            .map(([pid, a]) => {
                const p = players.find(pl => pl.id === pid);
                return p ? { ...p, ...a } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.marginalPts - a.marginalPts);

        if (!myPlayers.length) {
            return `<div style="padding:30px;text-align:center;color:#7090a8">No asset data. Make sure you have players on your roster.</div>`;
        }

        const cats = ['HR','SB','XBH','OBP','RP','K','W','SVH','ERA','WHIP'];
        const catColors = c => {
            const inv = c === 'ERA' || c === 'WHIP';
            return (v) => {
                if (!v || Math.abs(v) < 0.05) return '#506878';
                return (inv ? v < 0 : v > 0) ? '#40b870' : '#d04040';
            };
        };

        let html = `
        <div style="padding:8px 14px;display:flex;gap:10px;align-items:center">
            <span style="font-size:11px;color:#7090a8">${myPlayers.length} players · Marginal pts = rank-pts team loses without this player</span>
            <button class="btn" style="margin-left:auto" onclick="AppState.tradeAssets=null;UI.render()">Recompute</button>
        </div>
        <div class="tbl-wrap"><table class="grid" style="width:100%;font-size:11px">
            <thead><tr>
                <th>Player</th><th style="width:55px">Pos</th>
                <th style="width:55px;text-align:right" title="Rank-points team loses without this player">Marg.Pts</th>
                ${cats.map(c => `<th style="width:38px;text-align:right">${c}</th>`).join('')}
            </tr></thead>
            <tbody>`;

        myPlayers.forEach(p => {
            const clr = p.marginalPts > 4 ? '#40b870' : p.marginalPts > 1 ? '#e8c040' : '#7090a8';
            const catCells = cats.map(c => {
                const v = p.catContrib && p.catContrib[c] != null ? p.catContrib[c] : 0;
                const color = catColors(c)(v);
                return `<td style="text-align:right;color:${color}">${v !== 0 ? (v > 0 ? '+' : '') + v.toFixed(1) : '—'}</td>`;
            }).join('');
            html += `<tr>
                <td>${p.n}${p.inj ? ' <span style="color:#e8c040;font-size:10px">INJ</span>' : ''}</td>
                <td style="color:#9cb8d8">${(p.pos || []).join(',')}</td>
                <td style="text-align:right;font-weight:700;color:${clr}">${p.marginalPts > 0 ? '+' : ''}${p.marginalPts.toFixed(2)}</td>
                ${catCells}
            </tr>`;
        });

        html += '</tbody></table></div>';
        return html;
    },

    computeTradeAssets() {
        const opts = { useOptimal: AppState.ui.projOptimal !== false, useRepl: AppState.ui.projILRepl !== false };
        const content = document.getElementById('mainContent');
        if (content) {
            const subEl = content.querySelector('[data-trade-inner]');
            if (subEl) subEl.innerHTML = '<div style="padding:20px;text-align:center;color:#9cb8d8">Computing…</div>';
        }
        setTimeout(() => {
            AppState.tradeAssets = TradeEngine.computeAllAssetValues(effectiveDrafted(), AppState.players, opts);
            this.render();
        }, 10);
    },

    _renderTradeIdeas(opts) {
        if (!AppState.tradeSuggestions) {
            return `<div style="padding:30px;text-align:center">
                <div style="color:#9cb8d8;margin-bottom:6px;font-size:13px">Find 1-for-1 trades that improve your roto standing.</div>
                <div style="color:#506878;font-size:11px;margin-bottom:14px">Searches all possible swaps with each team. May take a few seconds.</div>
                <button class="btn btn-go" onclick="UI.findTrades()">FIND TRADES</button>
            </div>`;
        }

        const suggestions = AppState.tradeSuggestions;
        if (!suggestions.length) {
            return `<div style="padding:30px;text-align:center;color:#7090a8">
                No beneficial 1-for-1 trades found. Try after more of the season is underway.
                <br><br><button class="btn" onclick="AppState.tradeSuggestions=null;UI.render()">Search Again</button>
            </div>`;
        }

        let html = `
        <div style="padding:8px 14px;display:flex;gap:10px;align-items:center">
            <span style="font-size:11px;color:#7090a8">${suggestions.length} beneficial trades found</span>
            <button class="btn" style="margin-left:auto" onclick="AppState.tradeSuggestions=null;UI.render()">Search Again</button>
        </div>
        <div class="tbl-wrap"><table class="grid" style="width:100%;font-size:11px">
            <thead><tr>
                <th>Give</th><th>Receive</th><th style="width:70px">From</th>
                <th style="width:52px;text-align:right;color:#40b870">My +pts</th>
                <th style="width:52px;text-align:right">Their +pts</th>
                <th style="width:38px;text-align:right">New Rank</th>
                <th>Why</th>
                <th style="width:90px">Profile</th>
            </tr></thead>
            <tbody>`;

        suggestions.forEach(s => {
            const isWinWin   = s.myDelta > 0 && s.otherDelta > 0;
            const rowStyle   = isWinWin ? 'background:#062010' : '';
            const otherClr   = s.otherDelta > 0 ? '#40b870' : s.otherDelta < 0 ? '#d04040' : '#7090a8';
            const teamName   = LG.teamsMap[s.receiveTid] && LG.teamsMap[s.receiveTid].team || s.receiveTid;
            const tradeStyle = s.profile && s.profile.trade_style || '';
            const profileNote = tradeStyle.toLowerCase().includes('active')
                ? '<span style="color:#40b870">active trader</span>'
                : tradeStyle ? `<span style="color:#7090a8;font-size:10px">${tradeStyle.substring(0, 30)}</span>` : '—';
            const winWinBadge = isWinWin ? ' <span style="color:#40b870;font-size:10px">WIN-WIN</span>' : '';

            html += `<tr style="${rowStyle}">
                <td>${s.give.n}</td>
                <td>${s.receive.n}${winWinBadge}</td>
                <td style="color:#9cb8d8">${teamName}</td>
                <td style="text-align:right;font-weight:700;color:#40b870">+${s.myDelta.toFixed(2)}</td>
                <td style="text-align:right;color:${otherClr}">${s.otherDelta > 0 ? '+' : ''}${s.otherDelta.toFixed(2)}</td>
                <td style="text-align:right;color:#9cb8d8">${s.myNewRank}</td>
                <td style="color:#7090a8">${s.reason}</td>
                <td>${profileNote}</td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        return html;
    },

    findTrades() {
        const opts = { useOptimal: AppState.ui.projOptimal !== false, useRepl: AppState.ui.projILRepl !== false };
        const content = document.getElementById('mainContent');
        // Show computing indicator
        const inner = content && content.querySelector('.trade-inner');
        if (content) content.innerHTML = `<div style="padding:40px;text-align:center;color:#9cb8d8;font-size:13px">Finding trades…<br><span style="font-size:11px;color:#506878">Evaluating all possible 1-for-1 swaps</span></div>`;
        setTimeout(() => {
            AppState.tradeSuggestions = TradeEngine.suggestTrades('me', effectiveDrafted(), AppState.players, opts);
            this.render();
        }, 20);
    },

    _renderTradeEvaluate(opts) {
        const drafted  = effectiveDrafted();
        const players  = AppState.players;
        const otherTid = AppState.ui.tradeOtherTid || 't1';

        const myRoster    = FaabEngine._getRosterByTid('me',    drafted, players).sort((a,b)=>(a.n||'').localeCompare(b.n||''));
        const otherRoster = FaabEngine._getRosterByTid(otherTid, drafted, players).sort((a,b)=>(a.n||'').localeCompare(b.n||''));
        const otherTeam   = LG.teamsMap[otherTid] && LG.teamsMap[otherTid].team || otherTid;

        const teamOptions = Object.entries(LG.teamsMap)
            .filter(([tid]) => tid !== 'me')
            .map(([tid, info]) => `<option value="${tid}"${tid === otherTid ? ' selected' : ''}>${info.team}</option>`)
            .join('');

        const playerOpts = (roster, selKey) => roster.map(p =>
            `<option value="${p.id}"${(AppState.ui[selKey] || []).includes(p.id) ? ' selected' : ''}>${p.n} (${(p.pos||[]).join(',')})</option>`
        ).join('');

        // Evaluate if both sides have selections
        const giveIds    = AppState.ui.tradeGive    || [];
        const receiveIds = AppState.ui.tradeReceive || [];
        const givePlayers    = giveIds.map(id => players.find(p => p.id === id)).filter(Boolean);
        const receivePlayers = receiveIds.map(id => players.find(p => p.id === id)).filter(Boolean);

        let resultHtml = '';
        if (givePlayers.length && receivePlayers.length) {
            const result = TradeEngine.evaluateTrade(givePlayers, receivePlayers, 'me', otherTid, drafted, players, opts);
            const myClr    = result.myDelta > 0 ? '#40b870' : result.myDelta < 0 ? '#d04040' : '#9cb8d8';
            const otherClr = result.otherDelta > 0 ? '#40b870' : result.otherDelta < 0 ? '#d04040' : '#9cb8d8';

            const cats = ['HR','SB','XBH','OBP','RP','K','W','SVH','ERA','WHIP'];
            const inv  = new Set(['ERA','WHIP']);
            const statRows = cats.map(cat => {
                const mb = result.myStatsBefore    && result.myStatsBefore[cat]    != null ? result.myStatsBefore[cat]    : null;
                const ma = result.myStatsAfter     && result.myStatsAfter[cat]     != null ? result.myStatsAfter[cat]     : null;
                const tb = result.theirStatsBefore && result.theirStatsBefore[cat] != null ? result.theirStatsBefore[cat] : null;
                const ta = result.theirStatsAfter  && result.theirStatsAfter[cat]  != null ? result.theirStatsAfter[cat]  : null;
                const fmt = (v, c) => v == null ? '—' : (c === 'OBP' ? v.toFixed(3) : (c === 'ERA' || c === 'WHIP') ? v.toFixed(2) : Math.round(v));
                const dMy    = ma != null && mb != null ? ma - mb : null;
                const dOther = ta != null && tb != null ? ta - tb : null;
                const dClr = (d, c) => {
                    if (d == null || Math.abs(d) < 0.001) return '#506878';
                    const good = inv.has(c) ? d < 0 : d > 0;
                    return good ? '#40b870' : '#d04040';
                };
                return `<tr>
                    <td style="color:#9cb8d8">${cat}</td>
                    <td style="text-align:right">${fmt(mb, cat)}</td>
                    <td style="text-align:right;color:${dClr(dMy,cat)}">${fmt(ma, cat)}${dMy != null ? ` <span style="font-size:10px">(${dMy > 0 ? '+' : ''}${fmt(dMy,cat)})</span>` : ''}</td>
                    <td style="width:20px"></td>
                    <td style="text-align:right">${fmt(tb, cat)}</td>
                    <td style="text-align:right;color:${dClr(dOther,cat)}">${fmt(ta, cat)}${dOther != null ? ` <span style="font-size:10px">(${dOther > 0 ? '+' : ''}${fmt(dOther,cat)})</span>` : ''}</td>
                </tr>`;
            }).join('');

            resultHtml = `
            <div style="margin:14px;padding:12px 16px;background:#06101a;border:1px solid #0d2030;border-radius:3px">
                <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#dde8f8">${result.summary}</div>
                <div style="display:flex;gap:24px;margin-bottom:12px">
                    <div>Chathams: <span style="font-weight:700;color:${myClr}">${result.myDelta > 0 ? '+' : ''}${result.myDelta.toFixed(2)} pts</span>
                        · rank ${result.myOldRank} → <strong>${result.myNewRank}</strong></div>
                    <div>${otherTeam}: <span style="font-weight:700;color:${otherClr}">${result.otherDelta > 0 ? '+' : ''}${result.otherDelta.toFixed(2)} pts</span>
                        · rank ${result.otherOldRank} → <strong>${result.otherNewRank}</strong></div>
                </div>
                <table style="font-size:11px;border-collapse:collapse">
                    <thead><tr>
                        <th style="width:50px">Cat</th>
                        <th style="width:70px;text-align:right">My Before</th>
                        <th style="width:90px;text-align:right">My After</th>
                        <th style="width:20px"></th>
                        <th style="width:70px;text-align:right">Their Before</th>
                        <th style="width:90px;text-align:right">Their After</th>
                    </tr></thead>
                    <tbody>${statRows}</tbody>
                </table>
            </div>`;
        }

        return `
        <div style="padding:12px 14px;display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
            <div>
                <div style="font-size:11px;color:#7090a8;margin-bottom:6px">Other team</div>
                <select onchange="AppState.ui.tradeOtherTid=this.value;AppState.ui.tradeReceive=[];UI.render()" style="font-size:12px;padding:3px 6px">
                    ${teamOptions}
                </select>
            </div>
            <div>
                <div style="font-size:11px;color:#7090a8;margin-bottom:6px">I give (my roster)</div>
                <select multiple size="8" style="font-size:11px;width:200px;background:#06101a;color:#c8d8e8;border:1px solid #0d2030"
                    onchange="AppState.ui.tradeGive=Array.from(this.selectedOptions).map(o=>o.value);UI.render()">
                    ${playerOpts(myRoster, 'tradeGive')}
                </select>
            </div>
            <div>
                <div style="font-size:11px;color:#7090a8;margin-bottom:6px">I receive (${otherTeam})</div>
                <select multiple size="8" style="font-size:11px;width:200px;background:#06101a;color:#c8d8e8;border:1px solid #0d2030"
                    onchange="AppState.ui.tradeReceive=Array.from(this.selectedOptions).map(o=>o.value);UI.render()">
                    ${playerOpts(otherRoster, 'tradeReceive')}
                </select>
            </div>
            <div style="align-self:flex-end;padding-bottom:4px">
                <div style="font-size:10px;color:#506878;margin-bottom:6px">Hold Ctrl/Cmd for multi-select</div>
                <button class="btn btn-go" onclick="UI.render()">Evaluate</button>
            </div>
        </div>
        ${resultHtml || '<div style="padding:10px 14px;color:#506878;font-size:11px">Select players on both sides to evaluate the trade.</div>'}`;
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
