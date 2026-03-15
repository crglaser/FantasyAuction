/**
 * UI Rendering logic and event handlers.
 */

const UI = {
    async init() {
        // Admin mode: only unlocked via ?admin URL param + password
        window.ADMIN_MODE = false;
        if (new URLSearchParams(window.location.search).has('admin')) {
            const authed = sessionStorage.getItem('tbg_admin');
            if (authed === '1') {
                window.ADMIN_MODE = true;
            } else {
                const pw = prompt('Admin password:');
                if (pw === ADMIN_PASS) {
                    sessionStorage.setItem('tbg_admin', '1');
                    window.ADMIN_MODE = true;
                } else {
                    alert('Incorrect password. Entering read-only mode.');
                    history.replaceState(null, '', window.location.pathname);
                }
            }
        }

        // Hide admin-only tabs in public mode
        if (!window.ADMIN_MODE) {
            ['tab-ai', 'tab-import'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }

        // Pre-populate injury cache from baked-in data (don't overwrite user-added entries)
        if (typeof INJURY_CACHE !== 'undefined') {
            Object.entries(INJURY_CACHE).forEach(([id, news]) => {
                if (!AppState.injuryCache[id]) AppState.injuryCache[id] = news;
            });
        }

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
        else if (tab === 'standings') content.innerHTML = this.templateStandings();
        else if (tab === 'ai') content.innerHTML = this.templateAI();
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
                            <th>PROJECTIONS</th>
                            <th>ACTION</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${players.map(p => {
                            const dr = AppState.drafted[p.id];
                            const isMe = dr?.team === 'me';
                            const rowCls = (isMe ? 'mine' : '') + (dr ? ' drafted' : '') + (p.csArb > 3 && !dr ? ' aup' : '') + (p.csArb < -3 && !dr ? ' adn' : '');
                            const injNews = InjuryManager.getLatestFor(p.id);
                            const hasNote = !!AppState.playerNotes[p.id];
                            const hasNews = !!injNews;
                            const injTag = p.inj ? `<span class="pb" style="background:#401010;border-color:#802020;color:#f0a0a0">${injNews?.isNew ? 'INJ!' : 'INJ'}${hasNote ? '*' : ''}</span>` : (hasNews ? `<span class="pb" style="background:#102010;border-color:#205020;color:#80c880">NEWS</span>` : (hasNote ? `<span class="pb" style="background:#101828;border-color:#1a3050;color:#7090a8">NOTE</span>` : ''));

                            return `
                                <tr class="${rowCls}">
                                    <td class="mono muted">${p.csRank}</td>
                                    <td class="nm" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}${injTag}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td class="gold" style="font-weight:700">$${p.csValAAdj}</td>
                                    <td class="grn">$${p.csValS}</td>
                                    <td>${this.formatCsArb(p.csArb)}</td>
                                    <td class="mono muted" style="font-size:10px">${this.formatProjections(p)}</td>
                                    <td>
                                        ${dr ? `<span class="${isMe ? 'gold' : 'muted'}">${isMe ? '★ ' : ''}${isMe ? 'MINE' : (LG.teamsMap[dr.team]?.team || 'GONE')} <span class="gold">$${dr.cost}</span></span>` :
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
                            <th>PROJECTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${players.map(p => {
                            const dr = AppState.drafted[p.id];
                            const injNews = InjuryManager.getLatestFor(p.id);
                            const hasNote = !!AppState.playerNotes[p.id];
                            const injTag = p.inj ? `<span class="pb ${injNews?.isNew ? 'pulse' : ''}" style="background:#401010;border-color:#802020;color:#f0a0a0;cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">INJ${hasNote ? '*' : ''}</span>` : '';
                            return `
                                <tr class="${dr ? 'drafted' : ''}">
                                    <td class="mono muted">${p.csRank}</td>
                                    <td class="nm">${p.n}${injTag}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td class="grn" style="font-weight:700">$${p.csValS}</td>
                                    <td class="gold">$${p.csValAAdj}</td>
                                    <td>${this.formatCsArb(p.csArb)}</td>
                                    <td class="mono muted" style="font-size:10px">${this.formatProjections(p)}</td>
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
                <span><span class="grn">■</span> POSITIVE = Season value exceeds auction → <strong>BUY</strong></span>
                <span><span class="red">■</span> NEGATIVE = Auction value exceeds season → <strong>TRAP</strong></span>
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
                                    <td class="nm">${p.n}${p.inj ? `<span class="wb" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">INJ</span>` : ''}</td>
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

    templateStandings() {
        const teams = Object.keys(LG.teamsMap);
        const stats = {};
        teams.forEach(tid => {
            const picks = Object.entries(AppState.drafted)
                .filter(([,v]) => v.team === tid)
                .map(([id]) => AppState.players.find(p => p.id === id))
                .filter(Boolean);
            const H = picks.filter(p => p.PA > 0);
            const P = picks.filter(p => p.IP > 0);
            let PAw=0, OBPw=0, IPw=0, ERAw=0, WHIPw=0;
            H.forEach(p => { PAw += p.PA; OBPw += p.OBP * p.PA; });
            P.forEach(p => { IPw += p.IP; ERAw += p.ERA * p.IP; WHIPw += p.WHIP * p.IP; });
            stats[tid] = {
                HR: H.reduce((s,p)=>s+p.HR,0), SB: H.reduce((s,p)=>s+p.SB,0),
                XBH: H.reduce((s,p)=>s+p.XBH,0), OBP: PAw ? OBPw/PAw : 0,
                RP: H.reduce((s,p)=>s+p.RP,0), K: P.reduce((s,p)=>s+p.K,0),
                W: P.reduce((s,p)=>s+p.W,0), SVH: P.reduce((s,p)=>s+p.SVH,0),
                ERA: IPw ? ERAw/IPw : 99, WHIP: IPw ? WHIPw/IPw : 99,
                IP: Math.round(IPw), n: picks.length
            };
        });

        const cats = ['HR','SB','XBH','OBP','RP','K','W','SVH','ERA','WHIP'];
        const inv = new Set(['ERA','WHIP']);
        const ranks = {};
        teams.forEach(tid => { ranks[tid] = { total: 0 }; });
        cats.forEach(cat => {
            const sorted = [...teams].sort((a,b) => inv.has(cat) ? stats[a][cat]-stats[b][cat] : stats[b][cat]-stats[a][cat]);
            sorted.forEach((tid,i) => { ranks[tid][cat] = 10-i; ranks[tid].total += 10-i; });
        });
        const sorted = [...teams].sort((a,b) => ranks[b].total - ranks[a].total);

        const cell = (tid, cat) => {
            const s = stats[tid]; const r = ranks[tid][cat];
            const val = cat==='OBP' ? s[cat].toFixed(3) : cat==='ERA'||cat==='WHIP' ? s[cat].toFixed(2) : Math.round(s[cat]);
            const clr = r>=8 ? '#40b870' : r<=3 ? '#d04040' : '#c8d8e8';
            return `<td style="text-align:center;font-size:11px"><span style="color:${clr}">${s.n?val:'—'}</span><br><span class="muted" style="font-size:10px">(${r})</span></td>`;
        };

        return `
            <div style="padding:8px 0 12px;color:#7090a8;font-size:11px">
                Projected Roto standings based on drafted players. Updates live as picks are recorded. Each cell shows projected stat + rank (10=best).
            </div>
            <div class="tbl-wrap"><table>
                <thead><tr>
                    <th>#</th><th>Team</th><th class="gold">PTS</th>
                    <th>HR</th><th>SB</th><th>XBH</th><th>OBP</th><th>RP</th>
                    <th>K</th><th>W</th><th>SVH</th><th>ERA</th><th>WHIP</th>
                    <th>IP</th><th>Picks</th>
                </tr></thead>
                <tbody>
                    ${sorted.map((tid,i) => {
                        const info = LG.teamsMap[tid]; const s = stats[tid]; const r = ranks[tid];
                        const ipColor = s.IP > 0 && s.IP < (LG.minIP / LG.total * s.n * 0.9) ? '#d04040' : '#7090a8';
                        return `<tr class="${tid==='me'?'mine':''}">
                            <td class="mono muted">${i+1}</td>
                            <td style="font-weight:700">${info.team}</td>
                            <td class="gold" style="font-weight:700;text-align:center">${r.total}</td>
                            ${cats.map(c => cell(tid,c)).join('')}
                            <td style="text-align:center;font-size:11px;color:${ipColor}">${s.IP||'—'}</td>
                            <td class="mono muted" style="text-align:center">${s.n}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>
            <div style="margin-top:12px;font-size:10px;color:#406080">
                Green = top 3 in category · Red = bottom 3 · ERA/WHIP inverted (lower = better rank) · IP pace flag at 90% of target
            </div>`;
    },

    templateAI() {
        const apiKey = localStorage.getItem('claudeApiKey') || '';
        const history = AppState.aiHistory || [];
        return `
            <div style="max-width:800px;margin:0 auto;padding:16px">
                ${!apiKey ? `
                    <div style="background:#0a1a2a;border:1px solid #1a3050;border-radius:6px;padding:16px;margin-bottom:16px">
                        <div style="font-weight:700;color:#c8d8e8;margin-bottom:6px">CLAUDE API KEY</div>
                        <div class="muted" style="font-size:11px;margin-bottom:10px">Stored in localStorage only — sent directly to Anthropic's API, nowhere else.</div>
                        <input type="password" id="aiKeyInput" placeholder="sk-ant-..." style="width:100%;background:#060e18;color:#c8d8e8;border:1px solid #1a3050;padding:8px;font-size:12px;margin-bottom:8px;box-sizing:border-box">
                        <button class="btn btn-go" onclick="UI.saveApiKey()">SAVE KEY</button>
                    </div>
                ` : `<div style="font-size:11px;color:#406080;margin-bottom:10px">✓ API key saved · <a href="#" onclick="event.preventDefault();localStorage.removeItem('claudeApiKey');UI.render()" style="color:#406080">clear</a></div>`}
                <div id="aiHistory" style="max-height:420px;overflow-y:auto;margin-bottom:12px;display:flex;flex-direction:column;gap:12px">
                    ${history.length === 0 ? `
                        <div style="padding:24px;color:#1a3050;font-style:italic;text-align:center;line-height:2">
                            Ask anything about your draft strategy.<br>
                            <span style="color:#2a4060;font-size:11px">
                                "Who should I target with my last $45?" &nbsp;·&nbsp; "What categories am I weakest in?"<br>
                                "Is $28 fair for Bregman right now?" &nbsp;·&nbsp; "Team X just loaded up on SPs — how does that affect me?"
                            </span>
                        </div>
                    ` : history.map((h, i) => `
                        <div>
                            <div style="color:#406080;font-size:10px;margin-bottom:3px">YOU</div>
                            <div style="color:#c8d8e8;padding:8px;background:#0a1a2a;border-radius:4px;margin-bottom:6px">${h.q}</div>
                            <div style="color:#406080;font-size:10px;margin-bottom:3px">CLAUDE ${h.streaming ? '<span style="animation:pulse 1s infinite">⟳</span>' : ''}</div>
                            <div ${i===0&&h.streaming?'id="aiStreamTarget"':''} style="color:#c8d8e8;padding:10px;background:#060e18;border:1px solid #1a3050;border-radius:4px;white-space:pre-wrap;font-size:12px;line-height:1.6">${h.a || '…'}</div>
                        </div>
                    `).join('')}
                </div>
                <div style="display:flex;gap:8px;align-items:flex-end">
                    <textarea id="aiInput" placeholder="Ask about your draft strategy..." rows="3"
                        style="flex:1;background:#060e18;color:#c8d8e8;border:1px solid #1a3050;padding:8px;font-size:12px;resize:vertical"
                        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();UI.handleAIQuery()}"
                    ></textarea>
                    <button class="btn btn-go" id="aiBtnSend" onclick="UI.handleAIQuery()">ASK</button>
                </div>
                <div style="font-size:10px;color:#406080;margin-top:5px">Enter to send · Shift+Enter for newline · Context: your roster, all budgets, league rules</div>
            </div>`;
    },

    saveApiKey() {
        const key = document.getElementById('aiKeyInput')?.value?.trim();
        if (key) { localStorage.setItem('claudeApiKey', key); this.render(); }
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

        // Build all-teams context
        const ctx = StateManager.generateAIContext();
        const teamsContext = Object.entries(LG.teamsMap).map(([tid, info]) => {
            const picks = Object.entries(AppState.drafted)
                .filter(([,v]) => v.team === tid)
                .map(([id, pick]) => {
                    const p = AppState.players.find(x => x.id === id);
                    return p ? `${p.n} $${pick.cost}` : null;
                }).filter(Boolean);
            const spent = Object.entries(AppState.drafted)
                .filter(([,v]) => v.team === tid)
                .reduce((s,[,v]) => s + v.cost, 0);
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

        // Push placeholder entry so user sees it immediately
        const entry = { q: question, a: '', ts: Date.now(), streaming: true };
        AppState.aiHistory.unshift(entry);
        this.render();

        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 1024,
                    stream: true,
                    system,
                    messages: [{ role: 'user', content: question }]
                })
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || `HTTP ${res.status}`); }

            // Stream the response
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let answer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                for (const line of chunk.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const evt = JSON.parse(data);
                        if (evt.type === 'content_block_delta' && evt.delta?.text) {
                            answer += evt.delta.text;
                            entry.a = answer;
                            // Update in-place without full re-render
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

    templateControls() {
        const ui = AppState.ui;
        const set = AppState.settings;
        return `
            <div class="controls">
                <div class="ctrl"><span class="lbl">Search</span><input type="text" id="playerSearch" placeholder="Name or team..." value="${ui.search}" oninput="UI.handleSearch(this.value)"></div>
                <div class="ctrl">
                    <span class="lbl">Type</span>
                    <select onchange="AppState.ui.typeFilter=this.value;UI.render()">
                        <option value="ALL" ${ui.typeFilter==='ALL'?'selected':''}>All</option>
                        <option value="HIT" ${ui.typeFilter==='HIT'?'selected':''}>Batters</option>
                        <option value="PIT" ${ui.typeFilter==='PIT'?'selected':''}>Pitchers</option>
                    </select>
                </div>
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
                <button class="btn btn-go" onclick="UI.handleRefreshNews()">REFRESH NEWS</button>
                <button class="btn" style="margin-left:auto" onclick="document.getElementById('rulesModal').classList.add('open')">RULES</button>
            </div>
        `;
    },

    templateImport() {
        return `
            <div class="two-col">
                <div class="left-col" style="width:350px;padding:15px">
                    <h2 class="modal-title">Live Assistant</h2>
                    <div class="field">
                        <textarea id="assistantInput" placeholder="Judge to me 45..." style="width:100%;height:60px;background:#060e18;color:#c8d8e8;border:1px solid #1a3050;padding:8px;font-size:12px"></textarea>
                    </div>
                    <button class="btn btn-go" style="width:100%" onclick="UI.handleAssistant()">RUN COMMAND</button>
                    <div id="assistantLog" class="muted" style="margin-top:15px;font-size:11px;max-height:200px;overflow:auto"></div>
                    <div class="sec" style="margin-top:20px">Quick Advice</div>
                    <div id="adviceBox" class="gold" style="padding:10px;font-size:11px;line-height:1.4">${Assistant.getQuickAdvice()}</div>
                </div>
                <div class="right-col" style="padding:20px">
                    <h2 class="modal-title">Data Management</h2>
                    <div class="modal-btns">
                        <button class="btn" onclick="StateManager.exportConfig()">EXPORT CONFIG (JSON)</button>
                        <button class="btn btn-go" onclick="UI.copyAICatContext()">COPY FOR AI</button>
                    </div>
                    <div id="importStatus" style="margin-top:20px" class="grn"></div>
                </div>
            </div>
        `;
    },

    // --- Handlers ---

    handleSearch(val) {
        AppState.ui.search = val;
        this.render();
    },

    async handleRefreshNews() {
        const btn = event.target;
        btn.textContent = "REFRESHING...";
        const count = await InjuryManager.refreshNews();
        btn.textContent = "REFRESH NEWS";
        if (count > 0) alert(`Updated news for ${count} players!`);
        this.render();
    },

    formatProjections(p) {
        if (p.PA) {
            return `HR:${p.HR} SB:${p.SB} XBH:${p.XBH || 0} OBP:${p.OBP.toFixed(3)} RP:${p.RP}`;
        }
        return `K:${p.K} W:${p.W} ERA:${p.ERA.toFixed(2)} WHIP:${p.WHIP.toFixed(2)} SVH:${p.SVH}`;
    },

    updateSplitLabel(val) {
        const b = document.getElementById('splitBadge');
        if (b) b.textContent = val + '%';
    },

    updateCutoffLabel(val) {
        const b = document.getElementById('cutoffBadge');
        if (b) b.textContent = val;
    },

    openInjuryModal(id) {
        const p = AppState.players.find(x => x.id === id);
        if (!p) return;
        
        AppState.pendingPlayerId = id; // Track for saving notes
        const news = InjuryManager.getLatestFor(id);
        const note = AppState.playerNotes[id] || "";
        
        const proj = p.PA
            ? `OBP ${p.OBP.toFixed(3)} · HR ${p.HR} · SB ${p.SB} · XBH ${p.XBH} · RP ${p.RP}`
            : `ERA ${p.ERA?.toFixed(2)} · WHIP ${p.WHIP?.toFixed(2)} · K ${p.K} · W ${p.W} · SVH ${p.SVH} · IP ${p.IP}`;

        document.getElementById('injName').textContent = `${p.n} · ${p.t} · ${p.pos.join('/')}`;
        document.getElementById('injTitle').innerHTML = news
            ? `<span style="color:#f0a0a0">⚠ ${news.title}</span>`
            : `${p.n}`;

        // Projections line
        const modal = document.getElementById('injuryModal').querySelector('.modal');
        let projDiv = document.getElementById('modalProj');
        if (!projDiv) {
            projDiv = document.createElement('div');
            projDiv.id = 'modalProj';
            projDiv.style.cssText = 'font-size:11px;color:#7090a8;margin-bottom:12px;font-family:monospace';
            modal.insertBefore(projDiv, modal.querySelector('.field'));
        }
        projDiv.textContent = proj;

        const rotoworld = document.getElementById('linkRotoworld');
        const fallbackHref = `https://www.nbcsports.com/fantasy/baseball/player-news?search=${encodeURIComponent(p.n)}`;
        if (news) {
            rotoworld.innerHTML = `NEWS: ${news.blurb.substring(0, 200)}…`;
            rotoworld.href = news.link;
        } else {
            rotoworld.innerHTML = '⟳ Fetching latest news…';
            rotoworld.href = fallbackHref;
            InjuryManager.searchForPlayer(p).then(() => {
                const fresh = InjuryManager.getLatestFor(id);
                rotoworld.innerHTML = fresh ? `NEWS: ${fresh.blurb.substring(0, 200)}…` : 'SEARCH NBC SPORTS / ROTOWORLD ↗';
                if (fresh) rotoworld.href = fresh.link;
            });
        }

        document.getElementById('linkCBS').href = `https://www.cbssports.com/mlb/players/search/${encodeURIComponent(p.n)}/`;
        document.getElementById('linkFG').href = `https://www.fangraphs.com/search?query=${encodeURIComponent(p.n)}`;

        // Notes field
        let noteField = document.getElementById('noteArea');
        if (!noteField) {
            const field = document.createElement('div');
            field.className = 'field';
            field.style.marginTop = '12px';
            field.innerHTML = `<label>Scouting Notes</label>
                               <textarea id="noteArea" style="width:100%;height:60px;background:#060e18;color:#c8d8e8;border:1px solid #1a3050;padding:8px;font-size:12px"></textarea>
                               <button class="btn btn-go" style="width:100%;margin-top:5px" onclick="UI.savePlayerNote()">SAVE</button>`;
            modal.insertBefore(field, modal.querySelector('.modal-btns'));
            noteField = document.getElementById('noteArea');
        }
        noteField.value = note;
        
        document.getElementById('injuryModal').classList.add('open');
        InjuryManager.markRead(id);
    },

    savePlayerNote() {
        const id = AppState.pendingPlayerId;
        const note = document.getElementById('noteArea').value;
        if (id) {
            AppState.playerNotes[id] = note;
            StateManager.save();
            document.getElementById('injuryModal').classList.remove('open');
            this.render();
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

    pb(pos) { return pos.map(p => `<span class="pb pb-${p}">${p}</span>`).join(''); },

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

    formatCsArb(val) {
        if (val == null) return '-';
        const color = val > 3 ? 'grn' : (val < -3 ? 'red' : 'muted');
        const sign = val >= 0 ? '+' : '';
        return `<span class="${color}" style="font-weight:700">${sign}$${val}</span>`;
    },

    showTab(tab) {
        AppState.ui.activeTab = tab;
        document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`));
        const hasControls = ['auction', 'season', 'arb'].includes(tab);
        AppState.ui.search = ''; // clear search on tab switch
        const ctrlBar = document.getElementById('controlsBar');
        if (ctrlBar) ctrlBar.style.display = hasControls ? 'block' : 'none';
        this.render();
    },

    openDraftModal(id) {
        const p = AppState.players.find(x => x.id === id);
        if (!p) return;
        AppState.pendingPlayerId = id;
        document.getElementById('modalTitle').textContent = `Draft: ${p.n}`;
        document.getElementById('mCost').value = p.csValAAdj || p.aValAdj || 1;
        document.getElementById('mTeam').value = 'me';
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
        AppState.drafted[id] = { cost: parseInt(document.getElementById('mCost').value) || 0, team: document.getElementById('mTeam').value, ts: Date.now() };
        StateManager.save();
        this.closeModal();
        this.render();
    },

    async handleImport() {
        const text = document.getElementById('csvInput').value;
        if (!text) return;
        try {
            const players = await DataLoader.parseMrCheatSheet(text, "Manual Paste");
            if (players.length) { AppState.players = players; this.render(); }
        } catch (e) { alert(e.message); }
    },

    handleFile(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            try {
                const players = await DataLoader.parseMrCheatSheet(text, file.name);
                if (players.length) { AppState.players = players; UI.render(); UI.showTab('auction'); }
            } catch (e) { alert(e.message); }
        };
        reader.readAsText(file);
    },

    copyAICatContext() {
        const ctx = StateManager.getAICategoryContext();
        navigator.clipboard.writeText(ctx).then(() => { alert('Draft context copied to clipboard!'); });
    },

    setupEventListeners() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && document.getElementById('modalBg').classList.contains('open')) this.confirmDraft();
            if (e.key === 'Escape') this.closeModal();
        });
    }
};
