/**
 * UI Rendering logic and event handlers.
 */

const UI = {
    async init() {
        this.populateTeams();
        
        // Initial data load
        if (AppState.players.length === 0) {
            const players = await DataLoader.loadDefaultData();
            if (players.length > 0) {
                AppState.players = players;
            }
        }

        // Initial render of controls (only once)
        this.renderControls();
        this.render();
        this.setupEventListeners();
    },

    populateTeams() {
        const sel = document.getElementById('mTeam');
        if (!sel) return;
        sel.innerHTML = Object.entries(LG.teamsMap).map(([id, info]) =>
            `<option value="${id}">${info.team}</option>`
        ).join('');
    },

    /**
     * Renders the persistent control bar separately from the table data.
     */
    renderControls() {
        const ctrlBar = document.getElementById('controlsBar');
        if (!ctrlBar) return;
        ctrlBar.innerHTML = this.templateControls();
    },

    render() {
        ValEngine.calculateAll();
        const players = this.getFilteredPlayers();
        
        this.updateHeader();
        
        const content = document.getElementById('mainContent');
        const tab = AppState.ui.activeTab;

        if (tab === 'auction') content.innerHTML = this.templateAuction(players);
        else if (tab === 'season') content.innerHTML = this.templateSeason(players);
        else if (tab === 'arb') content.innerHTML = this.templateArb(players);
        else if (tab === 'myteam') content.innerHTML = this.templateMyTeam();
        else if (tab === 'league') content.innerHTML = this.templateLeague();
        else if (tab === 'import') content.innerHTML = this.templateImport();
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

        // Sorting
        return list.sort((a, b) => {
            const av = a[ui.sortCol] ?? -999;
            const bv = b[ui.sortCol] ?? -999;
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

    // --- Templates ---

    templateAuction(players) {
        return `
            <div class="tbl-wrap">
                <table>
                    <thead>
                        <tr>
                            ${this.th('csRank', '#')}
                            <th>Player</th>
                            <th>Tm</th>
                            <th>Pos</th>
                            ${this.th('csValAAdj', 'AUC $★')}
                            ${this.th('csValS', 'SEASON $')}
                            ${this.th('csArb', 'ARB Δ')}
                            ${this.th('aValAdj', 'OUR $')}
                            <th>PROJECTIONS</th>
                            <th>ACTION</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${players.map(p => {
                            const dr = AppState.drafted[p.id];
                            const isMe = dr?.team === 'me';
                            const rowCls = (isMe ? 'mine' : '') + (dr ? ' drafted' : '') + (p.csArb > 3 && !dr ? ' aup' : '') + (p.csArb < -3 && !dr ? ' adn' : '');
                            const stats = p.PA ? `HR:${p.HR} SB:${p.SB} XBH:${p.XBH} OBP:${p.OBP.toFixed(3)}` : `K:${p.K} W:${p.W} ERA:${p.ERA.toFixed(2)} SVH:${p.SVH}`;
                            return `
                                <tr class="${rowCls}">
                                    <td class="mono muted">${p.csRank}</td>
                                    <td class="nm">${p.n}${p.inj ? '<span class="wb">INJ</span>' : ''}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td class="gold" style="font-weight:700">$${p.csValAAdj}</td>
                                    <td class="grn">$${p.csValS}</td>
                                    <td>${this.formatCsArb(p.csArb)}</td>
                                    <td class="muted">$${p.aValAdj}</td>
                                    <td class="mono muted" style="font-size:10px">${stats}</td>
                                    <td>
                                        ${dr ? `<span class="gold">${isMe ? '★ MINE' : 'GONE'} $${dr.cost}</span>` :
                                        `<button class="btn btn-go" onclick="UI.openDraftModal('${p.id}')">DRAFT</button>`}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    templateSeason(players) {
        return `
            <div class="tbl-wrap">
                <table>
                    <thead>
                        <tr>
                            ${this.th('csRank', '#')}
                            <th>Player</th>
                            <th>Tm</th>
                            <th>Pos</th>
                            ${this.th('csValS', 'SEASON $★')}
                            ${this.th('csValAAdj', 'AUC $')}
                            ${this.th('csArb', 'ARB Δ')}
                            ${this.th('fVal', 'OUR $')}
                            <th>PROJECTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${players.map(p => {
                            const dr = AppState.drafted[p.id];
                            const stats = p.PA ? `HR:${p.HR} SB:${p.SB} XBH:${p.XBH} OBP:${p.OBP.toFixed(3)}` : `K:${p.K} W:${p.W} ERA:${p.ERA.toFixed(2)} SVH:${p.SVH}`;
                            return `
                                <tr class="${dr ? 'drafted' : ''}">
                                    <td class="mono muted">${p.csRank}</td>
                                    <td class="nm">${p.n}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td class="grn" style="font-weight:700">$${p.csValS}</td>
                                    <td class="gold">$${p.csValAAdj}</td>
                                    <td>${this.formatCsArb(p.csArb)}</td>
                                    <td class="muted">$${p.fVal}</td>
                                    <td class="mono muted" style="font-size:10px">${stats}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    templateArb(players) {
        return `
            <div class="arb-legend">
                <span><span class="grn">■</span> POSITIVE = Season value exceeds auction → <strong>BUY at auction</strong></span>
                <span><span class="red">■</span> NEGATIVE = Auction value exceeds season → <strong>TRAP / snake target</strong></span>
            </div>
            <div class="tbl-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Player</th>
                            <th>Tm</th>
                            <th>Pos</th>
                            ${this.th('csArb', 'ARB ($)')}
                            ${this.th('csValS', 'SEASON $★')}
                            ${this.th('csValAAdj', 'AUC $★')}
                        </tr>
                    </thead>
                    <tbody>
                        ${players.map(p => {
                            const dr = AppState.drafted[p.id];
                            return `
                                <tr class="${dr ? 'drafted' : ''}${p.csArb > 3 && !dr ? ' aup' : ''}${p.csArb < -3 && !dr ? ' adn' : ''}">
                                    <td class="nm">${p.n}${p.inj ? '<span class="wb">INJ</span>' : ''}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td style="font-size:15px">${this.formatCsArb(p.csArb)}</td>
                                    <td class="grn">$${p.csValS}</td>
                                    <td class="gold">$${p.csValAAdj}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    templateMyTeam() {
        const myDrafted = Object.entries(AppState.drafted).filter(([,v]) => v.team === 'me').map(([id, pick]) => ({...AppState.players.find(p => p.id === id), ...pick}));
        const spent = myDrafted.reduce((s, p) => s + p.cost, 0);
        const hitters = myDrafted.filter(p => p.PA > 0);
        const pitchers = myDrafted.filter(p => p.IP > 0);
        const projIP = pitchers.reduce((s, p) => s + (p.IP || 0), 0);

        // Stats calculation
        let HR=0, SB=0, XBH=0, OBPw=0, RP=0, PAw=0, K=0, W=0, ERAw=0, SVH=0, WHIPw=0, IPw=0;
        hitters.forEach(p => { HR+=p.HR; SB+=p.SB; XBH+=p.XBH; OBPw+=p.OBP*p.PA; RP+=p.RP; PAw+=p.PA; });
        pitchers.forEach(p => { K+=p.K; W+=p.W; ERAw+=p.ERA*p.IP; SVH+=p.SVH; WHIPw+=p.WHIP*p.IP; IPw+=p.IP; });
        const tOBP = PAw ? OBPw/PAw : 0, tERA = IPw ? ERAw/IPw : 0, tWHIP = IPw ? WHIPw/IPw : 0;

        const bar = (v, max, inv=false) => {
            const pct = max ? Math.min(100, inv ? (1 - Math.min(v, max) / max) * 100 : (v / max) * 100) : 0;
            const c = pct > 66 ? '#40b870' : (pct > 33 ? '#e8c040' : '#d04040');
            return `<div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${c}"></div></div>`;
        };

        return `
            <div class="two-col">
                <div class="left-col">
                    <div class="sec">MY ROSTER (${myDrafted.length}/${LG.total})</div>
                    ${myDrafted.length === 0 ? '<div style="padding:20px;color:#1a3050;font-style:italic">No players drafted yet.</div>' : ''}
                    ${myDrafted.sort((a,b) => b.cost - a.cost).map(p => `
                        <div class="rslot">
                            <div><div style="font-weight:700;color:#c8daf0">${p.n}</div><div>${this.pb(p.pos)}</div></div>
                            <div style="text-align:right"><div class="gold">$${p.cost}</div><div class="muted" style="font-size:10px">val:$${p.csValAAdj || p.csValA || p.aValAdj}</div></div>
                        </div>
                    `).join('')}
                </div>
                <div class="right-col">
                    <div class="stat-grid">
                        <div class="stat-card"><div class="sclbl">Budget Used</div><div class="scval">$${spent}</div>${bar(spent, LG.budget)}</div>
                        <div class="stat-card"><div class="sclbl">Remaining</div><div class="scval" style="color:#40b870">$${LG.budget - spent}</div></div>
                        <div class="stat-card"><div class="sclbl">Projected IP</div><div class="scval">${Math.round(projIP)}</div>${bar(projIP, LG.minIP)}</div>
                        <div class="stat-card"><div class="sclbl">H/P Split</div><div class="scval">${hitters.length}/${pitchers.length}</div></div>
                    </div>
                    <div class="cat-hdr">PROJECTED CATEGORY TOTALS</div>
                    <div class="cat-grid">
                        <div class="cat-card"><div class="ccat">HR</div><div class="cval">${HR.toFixed(0)}</div>${bar(HR, 200)}</div>
                        <div class="cat-card"><div class="ccat">SB</div><div class="cval">${SB.toFixed(0)}</div>${bar(SB, 150)}</div>
                        <div class="cat-card"><div class="ccat">XBH</div><div class="cval">${XBH.toFixed(0)}</div>${bar(XBH, 200)}</div>
                        <div class="cat-card"><div class="ccat">OBP</div><div class="cval">${tOBP.toFixed(3)}</div>${bar(tOBP, 0.380)}</div>
                        <div class="cat-card"><div class="ccat">RP</div><div class="cval">${RP.toFixed(0)}</div>${bar(RP, 1500)}</div>
                        <div class="cat-card"><div class="ccat">K</div><div class="cval">${K.toFixed(0)}</div>${bar(K, 1400)}</div>
                        <div class="cat-card"><div class="ccat">W</div><div class="cval">${W.toFixed(0)}</div>${bar(W, 90)}</div>
                        <div class="cat-card"><div class="ccat">ERA</div><div class="cval">${tERA.toFixed(2)}</div>${bar(tERA, 4.5, true)}</div>
                        <div class="cat-card"><div class="ccat">SVH</div><div class="cval">${SVH.toFixed(0)}</div>${bar(SVH, 130)}</div>
                        <div class="cat-card"><div class="ccat">WHIP</div><div class="cval">${tWHIP.toFixed(2)}</div>${bar(tWHIP, 1.4, true)}</div>
                    </div>
                </div>
            </div>
        `;
    },

    templateLeague() {
        const teams = Object.keys(LG.teamsMap);
        return `
            <div class="league-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Team</th>
                            <th>Owner</th>
                            <th># Drafted</th>
                            <th>Spent</th>
                            <th>Remaining</th>
                            <th>Avg $/Pick</th>
                            <th>Top Picks</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${teams.map(tid => {
                            const info = LG.teamsMap[tid];
                            const picks = Object.entries(AppState.drafted).filter(([,v]) => v.team === tid).map(([id,v]) => ({...AppState.players.find(p=>p.id===id), ...v})).filter(p => p.n);
                            const spent = picks.reduce((sum, p) => sum + p.cost, 0);
                            const rem = LG.budget - spent;
                            const topPicks = picks.sort((a,b) => b.cost - a.cost).slice(0,3).map(p => `${p.n.split(' ').pop()} ($${p.cost})`).join(', ');
                            return `
                                <tr class="${tid === 'me' ? 'mine' : ''}">
                                    <td style="font-weight:700">${info.team}</td>
                                    <td class="muted">${info.owner}</td>
                                    <td class="mono">${picks.length}</td>
                                    <td class="gold">$${spent}</td>
                                    <td class="mono" style="color:${rem < 20 ? '#d04040' : '#40b870'}">$${rem}</td>
                                    <td class="mono muted">$${picks.length ? Math.round(spent/picks.length) : 0}</td>
                                    <td style="font-size:11px" class="muted">${topPicks || '—'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    templateControls() {
        const ui = AppState.ui;
        const set = AppState.settings;
        const weights = set.weights;
        return `
            <div class="controls">
                <div class="ctrl"><span class="lbl">Search</span><input type="text" id="playerSearch" placeholder="Name or team..." value="${ui.search}" oninput="UI.handleSearch(this.value)"></div>
                <div class="ctrl">
                    <span class="lbl">Pos</span>
                    <select onchange="AppState.ui.posFilter=this.value;UI.render()">
                        <option value="ALL" ${ui.posFilter==='ALL'?'selected':''}>All</option>
                        ${['C','1B','2B','SS','3B','MI','CI','OF','SP','RP'].map(pos => `<option value="${pos}" ${ui.posFilter===pos?'selected':''}>${pos}</option>`).join('')}
                    </select>
                </div>
                <div class="ctrl">
                    <span class="lbl">Hit $ split</span>
                    <input type="range" min="55" max="75" value="${set.hitSplit}" oninput="AppState.settings.hitSplit=+this.value;UI.updateSplitLabel(this.value);UI.render()">
                    <span class="badge" id="splitBadge">${set.hitSplit}%</span>
                </div>
                <div class="ctrl">
                    <span class="lbl">Snake Disc</span>
                    <button class="tog ${set.snakeDisc?'on':''}" onclick="AppState.settings.snakeDisc=!AppState.settings.snakeDisc;this.classList.toggle('on');this.textContent=AppState.settings.snakeDisc?'ON':'OFF';UI.render()">${set.snakeDisc?'ON':'OFF'}</button>
                </div>
                <div class="ctrl">
                    <span class="lbl">Cutoff</span>
                    <input type="range" min="100" max="250" value="${set.snakeCutoff}" oninput="AppState.settings.snakeCutoff=+this.value;UI.updateCutoffLabel(this.value);UI.render()">
                    <span class="badge" id="cutoffBadge">${set.snakeCutoff}</span>
                </div>
                <div class="ctrl">
                    <label style="display:flex;gap:5px;align-items:center;cursor:pointer">
                        <input type="checkbox" ${ui.hideDrafted?'checked':''} onchange="AppState.ui.hideDrafted=this.checked;UI.render()">
                        <span class="lbl">Hide Drafted</span>
                    </label>
                </div>
                <button class="btn" style="margin-left:auto" onclick="UI.toggleWeights()">WEIGHTS</button>
                <button class="btn" onclick="document.getElementById('rulesModal').classList.add('open')">RULES</button>
                <button class="btn btn-go" onclick="UI.copyAICatContext()">COPY FOR AI</button>
            </div>
            <div id="weightControls" style="display:none;padding:10px;background:#0a1520;border-bottom:1px solid #1a3050;gap:15px;flex-wrap:wrap">
                ${Object.entries(weights).map(([cat, w]) => `
                    <div class="ctrl">
                        <span class="lbl">${cat}</span>
                        <input type="range" min="0" max="3" step="0.1" value="${w}" oninput="AppState.settings.weights['${cat}']=+this.value;UI.render()">
                        <span class="badge">${w.toFixed(1)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    },

    templateImport() {
        return `
            <div class="two-col">
                <div class="left-col" style="width:350px;padding:15px">
                    <h2 class="modal-title">Live Assistant</h2>
                    <p class="muted" style="margin-bottom:15px">Log drafts via text or get quick advice.</p>
                    <div class="field">
                        <textarea id="assistantInput" placeholder="Judge to me 45..." style="width:100%;height:60px;background:#060e18;color:#c8d8e8;border:1px solid #1a3050;padding:8px;font-size:12px"></textarea>
                    </div>
                    <button class="btn btn-go" style="width:100%" onclick="UI.handleAssistant()">RUN COMMAND</button>
                    <div id="assistantLog" class="muted" style="margin-top:15px;font-size:11px;max-height:200px;overflow:auto"></div>
                    
                    <div class="sec" style="margin-top:20px">Quick Advice</div>
                    <div id="adviceBox" class="gold" style="padding:10px;font-size:11px;line-height:1.4">
                        ${Assistant.getQuickAdvice()}
                    </div>
                </div>
                <div class="right-col" style="padding:20px">
                    <h2 class="modal-title">Data Management</h2>
                    <div style="background: #0d1e30; border: 1px solid #1a3050; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                        <h4 style="color: #e8c040; margin-bottom: 10px;">Default Data</h4>
                        <p class="muted" style="font-size: 11px; margin-bottom: 10px;">Try reloading the default Auction & Season CSVs from the server.</p>
                        <button class="btn" onclick="UI.reloadDefaults()">RELOAD DEFAULT CSVS</button>
                    </div>

                    <h2 class="modal-title">Manual Import</h2>
                    <p class="muted" style="margin-bottom:20px">Export your Mr. CheatSheet XLSM as a CSV and paste the contents here, or upload the file.</p>
                    
                    <div class="field">
                        <label>Paste Mr. CheatSheet CSV</label>
                        <textarea id="csvInput" style="width:100%;height:200px;background:#060e18;color:#c8d8e8;border:1px solid #1a3050;padding:10px;font-family:monospace"></textarea>
                    </div>
                    <div class="modal-btns">
                        <button class="btn btn-go" onclick="UI.handleImport()">PROCESS CSV</button>
                        <input type="file" id="fileInput" style="display:none" onchange="UI.handleFile(this)">
                        <button class="btn" onclick="document.getElementById('fileInput').click()">UPLOAD FILE</button>
                        <button class="btn" onclick="StateManager.exportConfig()">EXPORT CONFIG (JSON)</button>
                    </div>
                    <div id="importStatus" style="margin-top:20px" class="grn"></div>
                </div>
            </div>
        `;
    },

    // --- Interaction Handlers ---

    handleSearch(val) {
        AppState.ui.search = val;
        this.render();
    },

    updateSplitLabel(val) {
        const badge = document.getElementById('splitBadge');
        if (badge) badge.textContent = val + '%';
    },

    updateCutoffLabel(val) {
        const badge = document.getElementById('cutoffBadge');
        if (badge) badge.textContent = val;
    },

    async reloadDefaults() {
        const status = document.getElementById('importStatus');
        if (status) {
            status.textContent = "Fetching default data...";
            status.className = "gold";
        }
        const players = await DataLoader.loadDefaultData();
        if (players.length > 0) {
            AppState.players = players;
            if (status) {
                status.textContent = `Successfully merged ${players.length} players from defaults.`;
                status.className = "grn";
            }
            this.render();
        } else {
            if (status) {
                status.textContent = "Failed to load defaults. Check console/network.";
                status.className = "red";
            }
        }
    },

    handleAssistant() {
        const input = document.getElementById('assistantInput');
        const log = document.getElementById('assistantLog');
        const res = Assistant.processCommand(input.value);
        log.innerHTML = `<div style="margin-bottom:8px">${res}</div>` + log.innerHTML;
        input.value = '';
        this.render();
    },

    // --- Helpers ---

    pb(pos) {
        return pos.map(p => `<span class="pb pb-${p}">${p}</span>`).join('');
    },

    th(col, label) {
        const isCur = AppState.ui.sortCol === col;
        const cls = isCur ? (AppState.ui.sortDir === 'desc' ? 'sd' : 'sa') : '';
        return `<th class="${cls}" onclick="UI.setSort('${col}')">${label}</th>`;
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

    formatArb(val) {
        if (val == null) return '-';
        const color = val > 1.5 ? 'grn' : (val < -1.5 ? 'red' : 'muted');
        const sign = val >= 0 ? '+' : '';
        return `<span class="${color}" style="font-weight:700">${sign}${val.toFixed(2)}</span>`;
    },

    formatCsArb(val) {
        if (val == null) return '-';
        const color = val > 3 ? 'grn' : (val < -3 ? 'red' : 'muted');
        const sign = val >= 0 ? '+' : '';
        return `<span class="${color}" style="font-weight:700">${sign}$${val}</span>`;
    },

    // --- Actions ---

    showTab(tab) {
        AppState.ui.activeTab = tab;
        document.querySelectorAll('.tab').forEach(el => {
            el.classList.toggle('active', el.id === `tab-${tab}`);
        });
        // Controls are only visible for the main board tabs
        const hasControls = ['auction', 'season', 'arb'].includes(tab);
        document.getElementById('controlsBar').style.display = hasControls ? 'block' : 'none';
        
        this.render();
    },

    openDraftModal(id) {
        const p = AppState.players.find(x => x.id === id);
        if (!p) return;
        
        AppState.pendingPlayerId = id;
        document.getElementById('modalTitle').textContent = `Draft: ${p.n}`;
        document.getElementById('mCost').value = p.csValAAdj || p.aValAdj || 1;
        document.getElementById('mTeam').value = 'me'; // Default to Chathams
        document.getElementById('modalBg').classList.add('open');
        setTimeout(() => document.getElementById('mCost').select(), 50);
    },

    closeModal() {
        document.getElementById('modalBg').classList.remove('open');
        AppState.pendingPlayerId = null;
    },

    confirmDraft() {
        const id = AppState.pendingPlayerId;
        if (!id) return;

        AppState.drafted[id] = {
            cost: parseInt(document.getElementById('mCost').value) || 0,
            team: document.getElementById('mTeam').value,
            ts: Date.now()
        };

        StateManager.save();
        this.closeModal();
        this.render();
    },

    async handleImport() {
        const text = document.getElementById('csvInput').value;
        if (!text) return;
        try {
            const players = await DataLoader.parseMrCheatSheet(text, "Manual Paste");
            if (players.length) {
                AppState.players = players;
                document.getElementById('importStatus').textContent = `Successfully loaded ${players.length} players.`;
                this.render();
            }
        } catch (e) {
            document.getElementById('importStatus').textContent = `Error: ${e.message}`;
        }
    },

    handleFile(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            try {
                const players = await DataLoader.parseMrCheatSheet(text, file.name);
                if (players.length) {
                    AppState.players = players;
                    UI.render();
                    UI.showTab('auction');
                }
            } catch (e) {
                alert(`Error: ${e.message}`);
            }
        };
        reader.readAsText(file);
    },

    copyAICatContext() {
        const ctx = StateManager.getAICategoryContext();
        navigator.clipboard.writeText(ctx).then(() => {
            alert('Draft context copied to clipboard! Paste into Gemini/Claude for advice.');
        });
    },

    setupEventListeners() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && document.getElementById('modalBg').classList.contains('open')) {
                this.confirmDraft();
            }
            if (e.key === 'Escape') this.closeModal();
        });
    }
};
