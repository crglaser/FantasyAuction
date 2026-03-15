/**
 * HTML Templates for the Teddy Ballgame Draft Tool.
 * Houses all table builders, category formatters, and UI strings.
 */

const Templates = {

    // --- Tab Templates ---

    auction(players) {
        const vis  = key => UI.colVisible(key);
        const mCols = AppState.manualCols || [];

        // Column toggle bar
        // SCOUT_COL: the label shown in the toggle bar for the unified scout badge column
        const SCOUT_COL = 'scout';
        // Columns sourced from manual CSVs that are folded into SCOUT — hide from auto-discovered list
        const SCOUT_FIELDS = new Set(['CM_Role', 'PL_Rank', 'PL_Tier', 'HL_Rank', 'HL_Tier', 'HL_Pos']);
        const staticToggles = [
            { key: 'csValS',      label: 'SEASON $' },
            { key: 'csArb',       label: 'ARB'      },
            { key: 'ecr',         label: 'ECR'      },
            { key: 'espnAuction', label: 'ESPN $'   },
            { key: 'projections', label: 'PROJ'     },
            { key: SCOUT_COL,     label: 'SCOUT'    },
        ];
        const allToggles = [
            ...staticToggles,
            ...mCols.filter(k => !SCOUT_FIELDS.has(k)).map(k => ({ key: k, label: k.replace(/_/g, ' ') }))
        ];
        const toggleBar = `
            <div style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;background:#060e18;border-bottom:1px solid #0a1e30">
                <span style="font-size:10px;color:#406080;line-height:22px;margin-right:4px">COLUMNS:</span>
                ${allToggles.map(({key, label}) => `
                    <button onclick="UI.toggleCol('${key}')" style="font-size:10px;padding:2px 8px;border:1px solid ${vis(key) ? '#2a5080' : '#1a2a3a'};background:${vis(key) ? '#0a2040' : '#060e18'};color:${vis(key) ? '#90b8d8' : '#2a4060'};cursor:pointer;border-radius:2px">${label}</button>
                `).join('')}
            </div>`;

        return `
            ${toggleBar}
            <div class="tbl-wrap">
                <table>
                    <thead>
                        <tr>
                            ${this.th('csRank', '#')}
                            <th>Player</th>
                            <th>Tm</th>
                            <th>Pos</th>
                            ${this.th('csValAAdj', 'AUC $★')}
                            ${vis('csValS')      ? this.th('csValS', 'SEASON $') : ''}
                            ${vis('csArb')       ? this.th('csArb', 'ARB Δ')    : ''}
                            ${vis('ecr')         ? this.th('ecr', 'ECR')        : ''}
                            ${vis('espnAuction') ? this.th('espnAuction', 'ESPN $') : ''}
                            ${vis('projections') ? '<th>PROJECTIONS</th>'       : ''}
                            ${vis(SCOUT_COL)     ? '<th>SCOUT</th>'             : ''}
                            ${mCols.filter(k => !SCOUT_FIELDS.has(k) && vis(k)).map(k => this.th(k, k.replace(/_/g, ' '))).join('')}
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
                            const injTag = p.inj
                                ? `<span class="pb" style="background:#401010;border-color:#802020;color:#f0a0a0">${injNews?.isNew ? 'INJ!' : 'INJ'}${hasNote ? '*' : ''}</span>`
                                : (injNews ? `<span class="pb" style="background:#102010;border-color:#205020;color:#80c880">NEWS</span>`
                                : (hasNote ? `<span class="pb" style="background:#101828;border-color:#1a3050;color:#7090a8">NOTE</span>` : ''));
                            const unofficialClass = p.unofficial ? ' unofficial-est' : '';
                            const estBadge = p.unofficial ? '<span class="est-badge">est</span>' : '';
                            return `
                                <tr class="${rowCls}${unofficialClass}">
                                    <td class="mono muted">${p.csRank}</td>
                                    <td class="nm" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}${estBadge}${injTag}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td class="gold" style="font-weight:700">$${p.csValAAdj}</td>
                                    ${vis('csValS')       ? `<td class="grn">$${p.csValS}</td>` : ''}
                                    ${vis('csArb')        ? `<td>${this.formatCsArb(p.csArb)}</td>` : ''}
                                    ${vis('ecr')          ? `<td class="mono muted" style="font-size:10px">${p.ecr != null ? p.ecr : '—'}</td>` : ''}
                                    ${vis('espnAuction')  ? `<td class="mono" style="font-size:10px;color:#e8c040">${p.espnAuction ? '$'+p.espnAuction : '—'}</td>` : ''}
                                    ${vis('projections')  ? `<td class="mono muted" style="font-size:10px">${this.formatProjections(p)}</td>` : ''}
                                    ${vis(SCOUT_COL)      ? `<td>${this.formatScout(p)}</td>` : ''}
                                    ${mCols.filter(k => !SCOUT_FIELDS.has(k) && vis(k)).map(k => {
                                        const v = p[k];
                                        if (v == null) return `<td class="mono muted" style="font-size:10px">—</td>`;
                                        return `<td class="mono" style="font-size:10px;color:#c8d8e8">${v}</td>`;
                                    }).join('')}
                                    <td>
                                        ${dr ? `<span class="${isMe ? 'gold' : 'muted'}">${isMe ? '★ ' : ''}${isMe ? 'MINE' : (LG.teamsMap[dr.team]?.team || 'GONE')} <span class="gold">$${dr.cost}</span></span>`
                                             : `<button class="btn btn-go" onclick="UI.openDraftModal('${p.id}')">DRAFT</button>`}
                                    </td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    },

    season(players) {
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

    arb(players) {
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

    myteam() {
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

    league() {
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

    standings() {
        const teams = Object.keys(LG.teamsMap);
        const stats = {};
        teams.forEach(tid => {
            const picks = Object.entries(AppState.drafted).filter(([,v]) => v.team === tid).map(([id]) => AppState.players.find(p => p.id === id)).filter(Boolean);
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
            <div style="padding:8px 0 12px;color:#7090a8;font-size:11px">Projected Roto standings based on drafted players. Updates live.</div>
            <div class="tbl-wrap"><table>
                <thead><tr><th>#</th><th>Team</th><th class="gold">PTS</th><th>HR</th><th>SB</th><th>XBH</th><th>OBP</th><th>RP</th><th>K</th><th>W</th><th>SVH</th><th>ERA</th><th>WHIP</th><th>IP</th><th>Picks</th></tr></thead>
                <tbody>
                    ${sorted.map((tid,i) => {
                        const info = LG.teamsMap[tid]; const s = stats[tid]; const r = ranks[tid];
                        return `<tr class="${tid==='me'?'mine':''}">
                            <td class="mono muted">${i+1}</td><td style="font-weight:700">${info.team}</td><td class="gold" style="font-weight:700;text-align:center">${r.total}</td>
                            ${cats.map(c => cell(tid,c)).join('')}
                            <td style="text-align:center;font-size:11px;color:#7090a8">${s.IP||'—'}</td><td class="mono muted" style="text-align:center">${s.n}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>`;
    },

    ai() {
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

    import() {
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

    controls() {
        const ui = AppState.ui;
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
                    <label style="display:flex;gap:5px;align-items:center;cursor:pointer">
                        <input type="checkbox" ${ui.hideDrafted?'checked':''} onchange="AppState.ui.hideDrafted=this.checked;UI.render()">
                        <span class="lbl">Hide Drafted</span>
                    </label>
                </div>
                <button class="btn" style="margin-left:auto" onclick="document.getElementById('rulesModal').classList.add('open')">RULES</button>
            </div>
        `;
    },

    // --- Helpers ---

    pb(pos) { return pos.map(p => `<span class="pb pb-${p}">${p}</span>`).join(''); },

    th(col, label) {
        const isCur = AppState.ui.sortCol === col;
        const cls = isCur ? (AppState.ui.sortDir === 'desc' ? 'sd' : 'sa') : '';
        return `<th class="${cls}" onclick="UI.setSort('${col}')">${label}</th>`;
    },

    formatProjections(p) {
        if (p.PA) {
            return `HR:${p.HR} SB:${p.SB} XBH:${p.XBH || 0} OBP:${p.OBP.toFixed(3)} RP:${p.RP}`;
        }
        return `K:${p.K} W:${p.W} ERA:${p.ERA.toFixed(2)} WHIP:${p.WHIP.toFixed(2)} SVH:${p.SVH}`;
    },

    // Unified SCOUT badge — renders CM badge for RPs, PL badge for SPs, HL badge for hitters.
    // To rename the column: change SCOUT_COL constant in auction() above.
    formatScout(p) {
        // RP: CloserMonkey role
        if (p.CM_Role) return this.formatCloser({ closerStatus: p.CM_Role });
        // SP: PitcherList rank + tier
        if (p.PL_Rank) return this.formatRankBadge('PL', p.PL_Rank, p.PL_Tier);
        // Hitter: HitterList rank + tier
        if (p.HL_Rank) return this.formatRankBadge('HL', p.HL_Rank, p.HL_Tier);
        return '<span class="muted" style="font-size:10px">—</span>';
    },

    // Colored rank badge for PitcherList / HitterList.
    // Tier color scale: T1=gold, T2=green, T3-4=teal, T5-7=steel, T8+=gray
    formatRankBadge(source, rank, tier) {
        const tierColors = {
            1: '#d4a017', 2: '#40b870', 3: '#3a90b0', 4: '#3a90b0',
            5: '#5070a0', 6: '#5070a0', 7: '#5070a0',
        };
        const color = tierColors[tier] || '#506070';
        const t = tier ? `T${tier}·` : '';
        return `<span class="pb" style="background:#0a1a0a;border-color:${color};color:${color};white-space:nowrap;font-size:10px">${source} ${t}#${rank}</span>`;
    },

    formatCloser(p) {
        if (!p.closerStatus) return '';
        const parts = p.closerStatus.split(':');
        const status = parts[0];
        const team   = parts[1] || '';
        const committee = parts[2] === '*';
        const cfg = {
            CLOSER:   { color: '#40b870', label: 'Closer' },
            '1ST':    { color: '#e8c040', label: '1st in line' },
            '2ND':    { color: '#406080', label: '2nd in line' },
        };
        const c = cfg[status];
        if (!c) {
            // SVH#N fallback from article rankings
            return `<span class="pb" style="background:#0a1a0a;border-color:#406080;color:#7090a8">${p.closerStatus}</span>`;
        }
        const label = committee ? `${c.label}*` : c.label;
        const teamTag = team ? `<span style="opacity:0.55;font-size:9px;margin-left:2px">${team}</span>` : '';
        return `<span class="pb" style="background:#0a1a0a;border-color:${c.color};color:${c.color};white-space:nowrap">${label}${teamTag}</span>`;
    },

    formatCsArb(val) {
        if (val == null) return '-';
        const color = val > 3 ? 'grn' : (val < -3 ? 'red' : 'muted');
        const sign = val >= 0 ? '+' : '';
        return `<span class="${color}" style="font-weight:700">${sign}$${val}</span>`;
    }
};
