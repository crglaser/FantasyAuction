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
        const SCOUT_FIELDS = new Set(['CM_Role', 'CM_Rank', 'PL_Rank', 'PL_Tier', 'HL_Rank', 'HL_Tier', 'HL_Pos', 'AVG']);
        const staticToggles = [
            { key: 'csValS',      label: 'SEASON $' },
            { key: 'csValAAdj',   label: 'ADJ $'    },
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

        const drafted = effectiveDrafted();
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
                            ${this.th('csValA', 'AUC $')}
                            ${vis('csValAAdj')   ? this.th('csValAAdj', 'ADJ $') : ''}
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
                            const dr = drafted[p.id];
                            const isSim = dr?.sim;
                            const isMe = dr?.team === 'me';
                            const rowCls = (isMe && !isSim ? 'mine' : '') + (dr ? ' drafted' : '') + (p.csArb > 3 && !dr ? ' aup' : '') + (p.csArb < -3 && !dr ? ' adn' : '');
                            const injNews = InjuryManager.getLatestFor(p.id);
                            const hasNote = !!AppState.playerNotes[p.id];
                            const injTag = p.inj
                                ? `<span class="pb" style="background:#401010;border-color:#802020;color:#f0a0a0">${injNews?.isNew ? 'INJ!' : 'INJ'}${hasNote ? '*' : ''}</span>`
                                : (injNews ? `<span class="pb" style="background:#102010;border-color:#205020;color:#80c880">NEWS</span>`
                                : (hasNote ? `<span class="pb" style="background:#101828;border-color:#1a3050;color:#7090a8">NOTE</span>` : ''));
                            const unofficialClass = p.unofficial ? ' unofficial-est' : '';
                            const estBadge = p.unofficial ? '<span class="est-badge">est</span>' : '';
                            const sanityWarn = this._getSanityWarning(p);
                            const sanityBadge = sanityWarn ? `<span class="pb" title="⚠ DATA CHECK: ${sanityWarn}" style="background:#201000;border-color:#604000;color:#c87020;cursor:default;font-size:9px">⚠</span>` : '';
                            const actionCell = dr
                                ? (isSim
                                    ? `<span class="muted" style="font-size:10px;cursor:pointer" onclick="UI.openDraftModal('${p.id}')" title="Edit sim pick">${LG.teamsMap[dr.team]?.team || dr.team} <span class="gold">$${dr.cost}</span> <span style="font-size:9px;opacity:0.4">SIM✎</span></span>`
                                    : `<span class="${isMe ? 'gold' : 'muted'}" style="cursor:pointer" title="Click to edit" onclick="UI.openDraftModal('${p.id}')">${isMe ? '★ MINE' : (LG.teamsMap[dr.team]?.team || 'GONE')} <span class="gold">$${dr.cost}</span> <span style="font-size:9px;opacity:0.35">✎</span></span>`)
                                : `<button class="btn btn-go" onclick="UI.openDraftModal('${p.id}')">DRAFT</button>`;
                            return `
                                <tr class="${rowCls}${unofficialClass}">
                                    <td class="mono muted">${p.csRank}</td>
                                    <td class="nm" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}${estBadge}${injTag}${sanityBadge}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td>${this.formatAucVal(p.csValA)}</td>
                                    ${vis('csValAAdj')    ? `<td class="mono muted" style="font-size:11px">$${p.csValAAdj}</td>` : ''}
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
                                    <td>${actionCell}</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    },

    season(players) {
        const drafted = effectiveDrafted();
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
                            ${this.th('csValA', 'AUC $')}
                            ${this.th('csArb', 'ARB Δ')}
                            <th>PROJECTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${players.map(p => {
                            const dr = drafted[p.id];
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
                                    <td>${this.formatAucVal(p.csValA)}</td>
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
        const vis = key => UI.colVisible(key);
        const arbToggles = [
            { key: 'arb_season', label: 'CS SEASON $' },
            { key: 'arb_ftxrank', label: 'FTX RANK'   },
            { key: 'arb_rkdelta', label: 'RANK Δ'      },
            { key: 'arb_ftxscore', label: 'FTX SCORE'  },
            { key: 'arb_ecr',    label: 'ECR'          },
            { key: 'arb_espn',   label: 'ESPN $'       },
            { key: 'arb_mkt',    label: 'MKT RATIO'    },
            { key: 'arb_proj',   label: 'FTX PROJ'     },
            { key: 'arb_scout',  label: 'SCOUT'        },
            { key: 'arb_draft',  label: 'DRAFT'        },
        ];
        const toggleBar = `
            <div style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;background:#060e18;border-bottom:1px solid #0a1e30">
                <span style="font-size:10px;color:#406080;line-height:22px;margin-right:4px">COLUMNS:</span>
                ${arbToggles.map(({key, label}) => `
                    <button onclick="UI.toggleCol('${key}')" style="font-size:10px;padding:2px 8px;border:1px solid ${vis(key) ? '#2a5080' : '#1a2a3a'};background:${vis(key) ? '#0a2040' : '#060e18'};color:${vis(key) ? '#90b8d8' : '#2a4060'};cursor:pointer;border-radius:2px">${label}</button>
                `).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:4px;padding:6px 8px;background:#060e18;border-bottom:1px solid #0a1e30">
                <span style="font-size:10px;color:#406080;margin-right:4px">FILTER:</span>
                <button onclick="UI.toggleArbOutlier()" id="arbOutlierBtn" style="font-size:10px;padding:2px 8px;border:1px solid ${AppState.ui.arbOutlierOnly ? '#205040' : '#1a2a3a'};background:${AppState.ui.arbOutlierOnly ? '#0a2018' : '#060e18'};color:${AppState.ui.arbOutlierOnly ? '#40c880' : '#2a4060'};cursor:pointer;border-radius:2px">&#128269; SLEEPERS ONLY</button>
            </div>
            <div class="arb-legend">
                <span style="color:#7090a8;font-size:10px">
                    CS $ = MrCheatSheet auction value (our baseline) &nbsp;·&nbsp;
                    RANK Δ = FTX rank − CS rank (negative = Fantrax likes them more than we do) &nbsp;·&nbsp;
                    MKT RATIO = ESPN $ ÷ CS $ (&lt;0.8 = market underprices, &gt;1.25 = market inflated) &nbsp;·&nbsp;
                    FTX▲/ECR▲ = that source ranks player 30+ spots higher than CS (CS undervalues) &nbsp;·&nbsp; CS▲ = CS ranks player 30+ spots higher than FTX/ECR
                </span>
            </div>`;

        const drafted = effectiveDrafted();
        return `
            ${toggleBar}
            <div class="tbl-wrap">
                <table>
                    <thead>
                        <tr>
                            ${this.th('csRank',    'CS #')}
                            <th>Player</th>
                            <th>Tm</th>
                            <th>Pos</th>
                            ${this.th('csValA', 'CS AUC $')}
                            ${vis('arb_season')  ? this.th('csValS',    'CS SZN $')   : ''}
                            ${vis('arb_ftxrank') ? this.th('FTX_Rank',  'FTX RK')     : ''}
                            ${vis('arb_rkdelta') ? this.th('ftxRkDelta','RK Δ')        : ''}
                            ${vis('arb_ftxscore')? this.th('FTX_Score', 'FTX SCORE')  : ''}
                            ${vis('arb_ecr')     ? this.th('ecr',       'ECR')        : ''}
                            ${vis('arb_espn')    ? this.th('espnAuction','ESPN $')    : ''}
                            ${vis('arb_mkt')     ? this.th('mktRatio',  'MKT RATIO')  : ''}
                            ${vis('arb_proj')    ? '<th>FTX PROJ</th>'               : ''}
                            ${vis('arb_scout')   ? '<th>SCOUT</th>'                  : ''}
                            ${vis('arb_draft')   ? '<th></th>'                       : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${players.map(p => {
                            // Rank delta: positive = FTX ranks them lower (we like them more), negative = FTX likes them more
                            const ftxRkDelta = (p.FTX_Rank != null && p.csRank != null) ? p.FTX_Rank - p.csRank : null;
                            p.ftxRkDelta = ftxRkDelta; // attach for sorting
                            const mktRatio = p.espnAuction && p.csValAAdj ? (p.espnAuction / p.csValAAdj) : null;
                            p.mktRatio = mktRatio;
                            const ecrDelta = (p.ecr != null && p.csRank != null) ? p.ecr - p.csRank : null;
                            // Sleeper sources: which lists are bullish on this player vs the others?
                            // FTX/ECR sleeper: they rank the player 30+ higher than CS, and CS has them low
                            const csLow = (p.csRank == null || p.csRank > 75) || (p.csValAAdj != null && p.csValAAdj <= 15);
                            const ftxBull = ftxRkDelta != null && ftxRkDelta < -30 && csLow;  // FTX likes them more, CS doesn't
                            const ecrBull = ecrDelta   != null && ecrDelta   < -30 && csLow;  // ECR likes them more, CS doesn't
                            // CS sleeper: CS ranks them 30+ higher than FTX or ECR, while those sources are low
                            const ftxLow  = ftxRkDelta != null && ftxRkDelta > 30;
                            const ecrLow  = ecrDelta   != null && ecrDelta   > 30;
                            const csTop   = p.csRank != null && p.csRank <= 100;
                            const csBull  = csTop && (ftxLow || ecrLow);  // CS likes them more, FTX/ECR don't
                            const isSleeper = ftxBull || ecrBull || csBull;
                            // Source tags to display
                            const sourceTags = [
                                ftxBull ? `<span class="pb" style="background:#0a2010;border-color:#205030;color:#40c870;font-size:9px">FTX▲</span>` : '',
                                ecrBull ? `<span class="pb" style="background:#0a1828;border-color:#1a3848;color:#4090c8;font-size:9px">ECR▲</span>` : '',
                                csBull  ? `<span class="pb" style="background:#201a00;border-color:#403400;color:#c8a000;font-size:9px">CS▲</span>`  : '',
                            ].join('');
                            p.outlierScore = isSleeper ? Math.max(
                                ftxRkDelta != null ? Math.abs(ftxRkDelta) : 0,
                                ecrDelta   != null ? Math.abs(ecrDelta)   : 0
                            ) : 0;
                            if (AppState.ui.arbOutlierOnly && !isSleeper) return '';
                            const dr = drafted[p.id];
                            const isSim = dr?.sim;
                            const rowCls = (dr ? 'drafted' : '');
                            const mktColor = mktRatio == null ? '#7090a8' : mktRatio > 1.25 ? '#d04040' : mktRatio < 0.8 ? '#40b870' : '#c8d8e8';
                            const rkColor  = ftxRkDelta == null ? '#7090a8' : ftxRkDelta < -20 ? '#40b870' : ftxRkDelta > 20 ? '#d06040' : '#c8d8e8';
                            const injBadge = p.inj ? `<span class="pb" style="background:#401010;border-color:#802020;color:#f0a0a0;cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">INJ</span>` : '';
                            const draftCell = dr
                                ? (isSim
                                    ? `<span class="muted" style="font-size:10px;opacity:0.5">SIM · ${LG.teamsMap[dr.team]?.team||dr.team} <span class="gold">$${dr.cost}</span></span>`
                                    : `<span class="muted" style="font-size:10px;cursor:pointer" onclick="UI.openDraftModal('${p.id}')">${dr.team==='me'?'★ MINE':(LG.teamsMap[dr.team]?.team||'GONE')} <span class="gold">$${dr.cost}</span></span>`)
                                : `<button class="btn btn-go" style="font-size:10px;padding:2px 6px" onclick="UI.openDraftModal('${p.id}')">DRAFT</button>`;
                            const ftxProj = p.FTX_IP != null
                                ? `IP:${p.FTX_IP} W:${p.FTX_W} K:${p.FTX_K} ERA:${p.FTX_ERA} WHIP:${p.FTX_WHIP} SVH:${p.FTX_SVH}`
                                : p.FTX_AB != null
                                ? `HR:${p.FTX_HR} SB:${p.FTX_SB} OBP:${p.FTX_OBP} XBH:${p.FTX_XBH} RP:${p.FTX_RP}`
                                : '—';
                            return `
                                <tr class="${rowCls}">
                                    <td class="mono muted">${p.csRank}</td>
                                    <td class="nm" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}${injBadge}${sourceTags}</td>
                                    <td class="tm">${p.t}</td>
                                    <td>${this.pb(p.pos)}</td>
                                    <td>${this.formatAucVal(p.csValA)}</td>
                                    ${vis('arb_season')  ? `<td class="grn" style="font-size:11px">$${p.csValS}</td>` : ''}
                                    ${vis('arb_ftxrank') ? `<td class="mono muted" style="font-size:10px">${p.FTX_Rank ?? '—'}</td>` : ''}
                                    ${vis('arb_rkdelta') ? `<td class="mono" style="font-size:11px;font-weight:700;color:${rkColor}">${ftxRkDelta != null ? (ftxRkDelta > 0 ? '+' : '') + ftxRkDelta : '—'}</td>` : ''}
                                    ${vis('arb_ftxscore')? `<td class="mono muted" style="font-size:10px">${p.FTX_Score != null ? p.FTX_Score : '—'}</td>` : ''}
                                    ${vis('arb_ecr')     ? `<td class="mono muted" style="font-size:10px">${p.ecr ?? '—'}</td>` : ''}
                                    ${vis('arb_espn')    ? `<td class="mono" style="font-size:10px;color:#e8c040">${p.espnAuction ? '$'+p.espnAuction : '—'}</td>` : ''}
                                    ${vis('arb_mkt')     ? `<td class="mono" style="font-size:11px;color:${mktColor}">${mktRatio != null ? mktRatio.toFixed(2)+'×' : '—'}</td>` : ''}
                                    ${vis('arb_proj')    ? `<td class="mono muted" style="font-size:10px">${ftxProj}</td>` : ''}
                                    ${vis('arb_scout')   ? `<td>${this.formatScout(p)}</td>` : ''}
                                    ${vis('arb_draft')   ? `<td>${draftCell}</td>` : ''}
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    },

    myteam() {
        const viewTeam = AppState.ui.myteamView || 'me';
        const drafted = effectiveDrafted();
        const myDrafted = Object.entries(drafted).filter(([,v]) => v.team === viewTeam).map(([id, pick]) => ({...AppState.players.find(p => p.id === id), ...pick}));
        const spent = myDrafted.filter(p => !p.sim).reduce((s, p) => s + p.cost, 0);
        const hitters = myDrafted.filter(p => p.PA > 0);
        const pitchers = myDrafted.filter(p => p.IP > 0);
        const projIP = pitchers.reduce((s, p) => s + (p.IP || 0), 0);

        let HR=0, SB=0, XBH=0, OBPw=0, RP=0, PAw=0, K=0, W=0, ERAw=0, SVH=0, WHIPw=0, IPw=0;
        hitters.forEach(p => { HR+=p.HR; SB+=p.SB; XBH+=p.XBH; OBPw+=p.OBP*p.PA; RP+=p.RP; PAw+=p.PA; });
        pitchers.forEach(p => { K+=p.K; W+=p.W; ERAw+=p.ERA*p.IP; SVH+=p.SVH; WHIPw+=p.WHIP*p.IP; IPw+=p.IP; });
        const tOBP = PAw ? OBPw/PAw : 0, tERA = IPw ? ERAw/IPw : 0, tWHIP = IPw ? WHIPw/IPw : 0;

        // Compute category totals for ALL teams so bars reflect league-relative standing
        const allTeams = Object.keys(LG.teamsMap);
        const lgCats = {};
        ['HR','SB','XBH','OBP','RP','K','W','ERA','SVH','WHIP'].forEach(cat => { lgCats[cat] = []; });
        allTeams.forEach(tid => {
            const tp = Object.entries(effectiveDrafted()).filter(([,v]) => v.team === tid)
                .map(([id]) => AppState.players.find(p => p.id === id)).filter(Boolean);
            const tH = tp.filter(p => p.PA > 0), tP = tp.filter(p => p.IP > 0);
            let tPAw=0,tOBPw=0,tIPw=0,tERAw=0,tWHIPw=0;
            tH.forEach(p => { tPAw+=p.PA; tOBPw+=p.OBP*p.PA; });
            tP.forEach(p => { tIPw+=p.IP; tERAw+=p.ERA*p.IP; tWHIPw+=p.WHIP*p.IP; });
            lgCats.HR.push(tH.reduce((s,p)=>s+p.HR,0));
            lgCats.SB.push(tH.reduce((s,p)=>s+p.SB,0));
            lgCats.XBH.push(tH.reduce((s,p)=>s+p.XBH,0));
            lgCats.OBP.push(tPAw ? tOBPw/tPAw : 0);
            lgCats.RP.push(tH.reduce((s,p)=>s+p.RP,0));
            lgCats.K.push(tP.reduce((s,p)=>s+p.K,0));
            lgCats.W.push(tP.reduce((s,p)=>s+p.W,0));
            lgCats.ERA.push(tIPw ? tERAw/tIPw : 0);
            lgCats.SVH.push(tP.reduce((s,p)=>s+p.SVH,0));
            lgCats.WHIP.push(tIPw ? tWHIPw/tIPw : 0);
        });

        // bar(v, cat, inv): position v within the league distribution for cat
        const bar = (v, maxFixed, inv=false) => {
            const pct = maxFixed ? Math.min(100, inv ? (1 - Math.min(v, maxFixed) / maxFixed) * 100 : (v / maxFixed) * 100) : 0;
            const c = pct > 66 ? '#40b870' : (pct > 33 ? '#e8c040' : '#d04040');
            return `<div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${c}"></div></div>`;
        };
        const lgBar = (v, cat, inv=false) => {
            const vals = lgCats[cat];
            const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
            const pct = Math.min(100, Math.max(0, inv ? (1-(v-min)/range)*100 : (v-min)/range*100));
            const c = pct > 66 ? '#40b870' : (pct > 33 ? '#e8c040' : '#d04040');
            const rank = [...vals].sort((a,b) => inv ? a-b : b-a).indexOf(
                [...vals].sort((a,b) => inv ? a-b : b-a).find(x => Math.abs(x-v) < 0.0001) ?? v
            ) + 1;
            return `<div class="bar-bg" title="Rank ${rank}/${allTeams.length} in league"><div class="bar-fill" style="width:${pct}%;background:${c}"></div></div>`;
        };

        const teamSelector = `
            <div style="display:flex;gap:4px;padding:6px 8px;background:#060e18;border-bottom:1px solid #0a1e30;flex-wrap:wrap">
                ${Object.entries(LG.teamsMap).map(([tid, info]) => {
                    const active = viewTeam === tid;
                    return `<button onclick="UI.setMyteamView('${tid}')" style="font-size:10px;padding:2px 8px;border:1px solid ${active ? '#2a5080' : '#1a2a3a'};background:${active ? '#0a2040' : '#060e18'};color:${active ? '#90b8d8' : '#2a4060'};cursor:pointer;border-radius:2px">${info.team}</button>`;
                }).join('')}
            </div>`;

        const mySearch = (AppState.ui.myteamSearch || '').toLowerCase();
        const myFiltered = myDrafted.filter(p => !mySearch || p.n?.toLowerCase().includes(mySearch));

        return `
            <div style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden">
            ${teamSelector}
            <div style="padding:4px 8px;background:#060e18;border-bottom:1px solid #0a1e30;flex-shrink:0">
                <input type="text" id="myteamSearchInput" placeholder="Filter roster…" value="${AppState.ui.myteamSearch || ''}"
                    oninput="AppState.ui.myteamSearch=this.value;UI.render()"
                    style="background:#0a1420;color:#c8d8e8;border:1px solid #1a3050;padding:3px 8px;font-size:11px;width:180px">
            </div>
            <div style="flex:1;overflow-y:auto;min-height:0">
                <div style="display:flex;min-height:min-content">
                    <div style="width:265px;flex-shrink:0;border-right:1px solid #0a1828">
                        <div class="sec">${LG.teamsMap[viewTeam]?.team || viewTeam} ROSTER (${myDrafted.length}/${LG.total})</div>
                        ${myFiltered.sort((a,b) => b.cost - a.cost).map(p => `
                            <div class="rslot" style="${p.sim ? 'opacity:0.7' : ''};cursor:pointer" onclick="UI.openDraftModal('${p.id}')" title="${p.sim ? 'Edit sim pick' : 'Edit pick'}">
                                <div><div style="font-weight:700;color:#c8daf0">${p.n}${p.sim ? ' <span style="font-size:9px;color:#406080;font-weight:400">SIM✎</span>' : ' <span style="font-size:9px;opacity:0.3">✎</span>'}</div><div>${this.pb(p.pos)}</div></div>
                                <div style="text-align:right"><div class="gold">$${p.cost}</div><div class="muted" style="font-size:10px">val:$${p.csValAAdj || p.csValA || p.aValAdj}</div></div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="flex:1;padding:14px">
                        <div class="stat-grid">
                            <div class="stat-card"><div class="sclbl">Budget Used</div><div class="scval">$${spent}</div>${bar(spent, LG.budget)}</div>
                            <div class="stat-card"><div class="sclbl">Remaining</div><div class="scval" style="color:#40b870">$${LG.budget - spent}</div></div>
                            <div class="stat-card"><div class="sclbl">Projected IP</div><div class="scval">${Math.round(projIP)}</div>${bar(projIP, LG.minIP)}</div>
                            <div class="stat-card"><div class="sclbl">H/P Split</div><div class="scval">${hitters.length}/${pitchers.length}</div></div>
                        </div>
                        <div class="cat-hdr">PROJECTED CATEGORY TOTALS</div>
                        <div class="cat-grid">
                            <div class="cat-card"><div class="ccat">HR</div><div class="cval">${HR.toFixed(0)}</div>${lgBar(HR, 'HR')}</div>
                            <div class="cat-card"><div class="ccat">SB</div><div class="cval">${SB.toFixed(0)}</div>${lgBar(SB, 'SB')}</div>
                            <div class="cat-card"><div class="ccat">XBH</div><div class="cval">${XBH.toFixed(0)}</div>${lgBar(XBH, 'XBH')}</div>
                            <div class="cat-card"><div class="ccat">OBP</div><div class="cval">${tOBP.toFixed(3)}</div>${lgBar(tOBP, 'OBP')}</div>
                            <div class="cat-card"><div class="ccat">RP</div><div class="cval">${RP.toFixed(0)}</div>${lgBar(RP, 'RP')}</div>
                            <div class="cat-card"><div class="ccat">K</div><div class="cval">${K.toFixed(0)}</div>${lgBar(K, 'K')}</div>
                            <div class="cat-card"><div class="ccat">W</div><div class="cval">${W.toFixed(0)}</div>${lgBar(W, 'W')}</div>
                            <div class="cat-card"><div class="ccat">ERA</div><div class="cval">${tERA.toFixed(2)}</div>${lgBar(tERA, 'ERA', true)}</div>
                            <div class="cat-card"><div class="ccat">SVH</div><div class="cval">${SVH.toFixed(0)}</div>${lgBar(SVH, 'SVH')}</div>
                            <div class="cat-card"><div class="ccat">WHIP</div><div class="cval">${tWHIP.toFixed(2)}</div>${lgBar(tWHIP, 'WHIP', true)}</div>
                        </div>
                    </div>
                </div>
                ${this.draftLog(viewTeam)}
            </div>
            </div>
        `;
    },

    league() {
        const teams = Object.keys(LG.teamsMap);
        const lgSearch = (AppState.ui.leagueSearch || '').toLowerCase();
        const teamFilter = AppState.ui.leagueTeamFilter || null;
        const drafted = effectiveDrafted();

        const teamFilterBar = `
            <div style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;background:#060e18;border-bottom:1px solid #0a1e30;flex-shrink:0">
                <button onclick="AppState.ui.leagueTeamFilter=null;UI.render()" style="font-size:10px;padding:2px 8px;border:1px solid ${!teamFilter ? '#2a5080' : '#1a2a3a'};background:${!teamFilter ? '#0a2040' : '#060e18'};color:${!teamFilter ? '#90b8d8' : '#2a4060'};cursor:pointer;border-radius:2px">ALL</button>
                ${teams.map(tid => {
                    const active = teamFilter === tid;
                    return `<button onclick="UI.setLeagueTeamFilter('${tid}')" style="font-size:10px;padding:2px 8px;border:1px solid ${active ? '#2a5080' : '#1a2a3a'};background:${active ? '#0a2040' : '#060e18'};color:${active ? '#90b8d8' : '#2a4060'};cursor:pointer;border-radius:2px">${LG.teamsMap[tid].team}</button>`;
                }).join('')}
            </div>`;

        // Team detail view when a specific team is selected
        const teamDetail = teamFilter ? (() => {
            const info  = LG.teamsMap[teamFilter];
            const picks = Object.entries(drafted)
                .filter(([, v]) => v.team === teamFilter)
                .map(([id, v]) => ({ ...AppState.players.find(p => p.id === id), ...v }))
                .filter(p => p.n)
                .sort((a, b) => b.cost - a.cost);
            const spent = picks.filter(p => !p.sim).reduce((s, p) => s + p.cost, 0);
            const hitters  = picks.filter(p => p.PA > 0);
            const pitchers = picks.filter(p => p.IP > 0);
            return `
                <div style="margin:12px;background:#060e18;border:1px solid #0a1e30;border-radius:4px">
                    <div style="padding:8px 12px;background:#0a1420;border-bottom:1px solid #0a1e30;border-radius:4px 4px 0 0;display:flex;align-items:baseline;gap:10px">
                        <div style="font-weight:700;font-size:14px;color:#c8d8e8">${info.team}</div>
                        <div style="font-size:11px;color:#7090a8">${info.owner}</div>
                        <div style="margin-left:auto;font-size:11px;color:#406080">
                            ${picks.length} picks · <span class="gold">$${spent} spent</span> · <span style="color:#40b870">$${LG.budget - spent} left</span>
                            · ${hitters.length}H / ${pitchers.length}P
                        </div>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:0">
                        ${picks.map(p => {
                            return `<div style="width:200px;padding:5px 10px;border-right:1px solid #0a1828;border-bottom:1px solid #0a1828;cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">
                                <div style="font-size:12px;color:#c8d8e8;font-weight:600">${p.n}${p.sim ? ' <span style="font-size:9px;color:#406080">SIM</span>' : ''}</div>
                                <div style="display:flex;justify-content:space-between;margin-top:2px">
                                    <span style="font-size:10px">${this.pb(p.pos)}</span>
                                    <span class="${p.sim ? 'muted' : 'gold'}" style="font-size:11px;font-weight:700">$${p.cost}</span>
                                </div>
                            </div>`;
                        }).join('')}
                        ${!picks.length ? '<div style="padding:16px;color:#406080;font-size:11px">No picks yet</div>' : ''}
                    </div>
                </div>`;
        })() : '';

        return `
            <div style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden">
            ${teamFilterBar}
            <div style="padding:4px 8px;background:#060e18;border-bottom:1px solid #0a1e30;flex-shrink:0">
                <input type="text" id="leagueSearchInput" placeholder="Filter players…" value="${AppState.ui.leagueSearch || ''}"
                    oninput="AppState.ui.leagueSearch=this.value;UI.render()"
                    style="background:#0a1420;color:#c8d8e8;border:1px solid #1a3050;padding:3px 8px;font-size:11px;width:180px">
            </div>
            <div style="flex:1;overflow-y:auto;min-height:0">
            <div class="league-wrap" style="overflow:visible">
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
                            const picks = Object.entries(drafted).filter(([,v]) => v.team === tid).map(([id,v]) => ({...AppState.players.find(p=>p.id===id), ...v})).filter(p => p.n);
                            const spent = picks.reduce((sum, p) => sum + p.cost, 0);
                            const rem = LG.budget - spent;
                            const topPicks = picks.sort((a,b) => b.cost - a.cost).slice(0,3).map(p => `${p.n.split(' ').pop()} ($${p.cost})`).join(', ');
                            const isFiltered = teamFilter === tid;
                            return `
                                <tr class="${tid === 'me' ? 'mine' : ''}" style="${isFiltered ? 'outline:1px solid #2a5080;' : ''}" onclick="UI.setLeagueTeamFilter('${tid}')" title="Click to spotlight ${info.team}">
                                    <td style="font-weight:700;cursor:pointer">${info.team}${isFiltered ? ' ◀' : ''}</td>
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
            ${teamDetail}
            ${lgSearch ? `
                <div style="padding:8px 12px;font-size:11px;color:#7090a8;border-top:1px solid #0a1e30">
                    PLAYERS MATCHING "${lgSearch.toUpperCase()}":
                </div>
                ${teams.map(tid => {
                    const info = LG.teamsMap[tid];
                    const picks = Object.entries(drafted).filter(([,v]) => v.team === tid)
                        .map(([id,v]) => ({...AppState.players.find(p=>p.id===id), ...v}))
                        .filter(p => p.n?.toLowerCase().includes(lgSearch));
                    if (!picks.length) return '';
                    return `<div style="padding:4px 12px;font-size:11px">
                        <span style="color:#e8c040;font-weight:700">${info.team}:</span>
                        ${picks.map(p => `<span style="color:#c8d8e8;margin-left:8px">${p.n} <span class="gold">$${p.cost}</span>${p.sim ? ' <span style="color:#406080">SIM</span>' : ''}</span>`).join('')}
                    </div>`;
                }).join('')}
            ` : (!teamDetail ? this.draftLog() : '')}
            </div>
            </div>
        `;
    },

    standings() {
        const teams = Object.keys(LG.teamsMap);
        const simActive = Object.values(AppState.drafted).some(v => v.sim);
        const drafted = effectiveDrafted();
        const stats = {};
        teams.forEach(tid => {
            const picks = Object.entries(drafted).filter(([,v]) => v.team === tid).map(([id]) => AppState.players.find(p => p.id === id)).filter(Boolean);
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
            // Tie handling: teams with equal values split the points for those positions
            let i = 0;
            while (i < sorted.length) {
                let j = i;
                const val = stats[sorted[i]][cat];
                while (j < sorted.length && stats[sorted[j]][cat] === val) j++;
                // Average rank points across the tied group (e.g. 3-way tie for 2nd: (8+7+6)/3 = 7)
                let pts = 0;
                for (let k = i; k < j; k++) pts += (teams.length - k);
                const avg = pts / (j - i);
                for (let k = i; k < j; k++) { ranks[sorted[k]][cat] = avg; ranks[sorted[k]].total += avg; }
                i = j;
            }
        });
        const sorted = [...teams].sort((a,b) => ranks[b].total - ranks[a].total);

        const cell = (tid, cat) => {
            const s = stats[tid]; const r = ranks[tid][cat];
            const val = cat==='OBP' ? s[cat].toFixed(3) : cat==='ERA'||cat==='WHIP' ? s[cat].toFixed(2) : Math.round(s[cat]);
            const clr = r>=8 ? '#40b870' : r<=3 ? '#d04040' : '#c8d8e8';
            const rDisp = Number.isInteger(r) ? r : r.toFixed(1);
            return `<td style="text-align:center;font-size:11px"><span style="color:${clr}">${s.n?val:'—'}</span><br><span class="muted" style="font-size:10px">(${rDisp})</span></td>`;
        };

        return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0 12px">
                <span style="color:#7090a8;font-size:11px;flex:1">Projected Roto standings based on drafted players.${simActive ? ' <span style="color:#e8c040">★ SIMULATION ACTIVE</span>' : ' Updates live.'}</span>
                ${simActive
                    ? `<button class="btn btn-danger" onclick="UI.clearSimulation()">CLEAR SIM</button>`
                    : `<button class="btn btn-go" onclick="UI.simulateDraft()">SIM FULL DRAFT</button>
                       <button class="btn" style="margin-left:4px" onclick="UI.simulateAuction()">SIM AUCTION ONLY</button>`
                }
            </div>
            <div class="tbl-wrap"><table>
                <thead><tr><th>#</th><th>Team</th><th class="gold">PTS</th><th>HR</th><th>SB</th><th>XBH</th><th>OBP</th><th>RP</th><th>K</th><th>W</th><th>SVH</th><th>ERA</th><th>WHIP</th><th>IP</th><th>Picks</th></tr></thead>
                <tbody>
                    ${sorted.map((tid,i) => {
                        const info = LG.teamsMap[tid]; const s = stats[tid]; const r = ranks[tid];
                        return `<tr class="${tid==='me'?'mine':''}">
                            <td class="mono muted">${i+1}</td><td style="font-weight:700">${info.team}</td><td class="gold" style="font-weight:700;text-align:center">${Number.isInteger(r.total) ? r.total : r.total.toFixed(1)}</td>
                            ${cats.map(c => cell(tid,c)).join('')}
                            <td style="text-align:center;font-size:11px;color:#7090a8">${s.IP||'—'}</td><td class="mono muted" style="text-align:center">${s.n}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>`;
    },

    snake() {
        const order     = AppState.snakeOrder;          // array of teamIds, length 0–10
        const teams     = Object.keys(LG.teamsMap);
        const n         = teams.length;                 // 10
        const pick      = AppState.snakePick;           // current pick index (0-based)
        const round     = Math.floor(pick / n);         // 0-based round
        const roundNum  = round + 1;
        const posInRound = pick % n;
        const curTeam   = currentSnakeTeam();
        const curInfo   = curTeam ? LG.teamsMap[curTeam] : null;
        const sRounds   = LG.sSlots; // 14

        // Real snake picks from draftLog (cost === 0 = snake pick)
        const snakePicks = (AppState.draftLog || []).filter(e => e.cost === 0);

        // Order setup section
        const orderSetup = `
            <div style="background:#060e18;border:1px solid #0a1e30;border-radius:4px;padding:12px;margin-bottom:12px">
                <div style="font-size:11px;font-weight:700;color:#7090a8;letter-spacing:1px;margin-bottom:10px">DRAFT ORDER SETUP (Slot 1 = First Pick)</div>
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">
                    ${Array.from({ length: n }, (_, slot) => {
                        const cur = order[slot] || '';
                        return `
                            <div style="background:#0a1420;border:1px solid #1a3050;border-radius:3px;padding:6px 8px">
                                <div style="font-size:10px;color:#406080;margin-bottom:4px">SLOT ${slot + 1}</div>
                                <select onchange="UI.setSnakeSlot(${slot}, this.value)" style="width:100%;background:#060e18;color:#c8d8e8;border:1px solid #1a3050;padding:3px;font-size:10px">
                                    <option value="">— unset —</option>
                                    ${teams.map(tid => `<option value="${tid}" ${cur === tid ? 'selected' : ''}>${LG.teamsMap[tid].team}</option>`).join('')}
                                </select>
                            </div>`;
                    }).join('')}
                </div>
            </div>`;

        // Current pick banner
        const isOrderSet = order.length === n && order.every(Boolean);
        const allDone    = pick >= n * sRounds;
        const banner = `
            <div style="display:flex;align-items:center;gap:12px;background:${curTeam === 'me' ? '#0a2010' : '#060e18'};border:1px solid ${curTeam === 'me' ? '#1a5020' : '#0a1e30'};border-radius:4px;padding:10px 14px;margin-bottom:12px">
                ${isOrderSet && !allDone ? `
                    <div style="flex:1">
                        <div style="font-size:10px;color:#406080;margin-bottom:2px">CURRENT PICK</div>
                        <div style="font-size:16px;font-weight:700;color:${curTeam === 'me' ? '#40b870' : '#c8d8e8'}">
                            Round ${roundNum} · Pick ${posInRound + 1} of ${n}
                            ${curInfo ? `&nbsp;—&nbsp; <span style="color:${curTeam === 'me' ? '#40b870' : '#e8c040'}">${curInfo.team}</span>` : ''}
                            ${curTeam === 'me' ? '<span style="font-size:11px;color:#40b870;margin-left:6px">★ YOUR PICK</span>' : ''}
                        </div>
                        <div style="font-size:10px;color:#406080;margin-top:2px">Overall snake pick #${pick + 1} of ${n * sRounds}</div>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center">
                        <button class="btn" onclick="UI.advanceSnakePick(-1)" ${pick <= 0 ? 'disabled' : ''}>◀ BACK</button>
                        <button class="btn btn-go" onclick="UI.advanceSnakePick(1)">NEXT ▶</button>
                    </div>
                ` : isOrderSet && allDone ? `
                    <div style="flex:1;color:#40b870;font-weight:700">Snake draft complete (${n * sRounds} picks)</div>
                    <button class="btn" onclick="UI.resetSnakePick()">RESET PICK #</button>
                ` : `
                    <div style="flex:1;color:#406080;font-size:12px">Set all 10 draft order slots above to enable pick tracking.</div>
                `}
            </div>`;

        // Snake board grid
        const boardHtml = isOrderSet ? `
            <div style="font-size:11px;font-weight:700;color:#7090a8;letter-spacing:1px;margin-bottom:6px">SNAKE BOARD</div>
            <div style="overflow-x:auto">
                <table style="border-collapse:collapse;width:100%;font-size:10px">
                    <thead>
                        <tr>
                            <th style="padding:4px 6px;color:#406080;text-align:left;white-space:nowrap">Round</th>
                            ${order.map(tid => {
                                const info = LG.teamsMap[tid];
                                return `<th style="padding:4px 6px;color:${tid === 'me' ? '#40b870' : '#406080'};text-align:center;white-space:nowrap">${info?.team || '?'}</th>`;
                            }).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${Array.from({ length: sRounds }, (_, r) => {
                            const isEven = r % 2 === 0;
                            const slotOrder = isEven ? order : [...order].reverse();
                            return `<tr style="border-top:1px solid #0a1e30">
                                <td style="padding:4px 6px;color:#406080;font-weight:700">R${r + 1}</td>
                                ${slotOrder.map((tid, slot) => {
                                    const pickIdx = r * n + slot;
                                    const isCurrent = pickIdx === pick;
                                    const isDone    = pickIdx < pick;
                                    // Find real pick in this slot
                                    const slotPick  = snakePicks[pickIdx];
                                    const player    = slotPick ? AppState.players.find(p => p.id === slotPick.id) : null;
                                    const isMe      = tid === 'me';
                                    const bg = isCurrent ? (isMe ? '#0a2010' : '#0a1a2a') : 'transparent';
                                    const border = isCurrent ? `border:1px solid ${isMe ? '#1a5020' : '#1a3050'}` : '';
                                    return `<td style="padding:4px 6px;text-align:center;background:${bg};${border};${isDone ? 'opacity:0.6' : ''}">
                                        ${player
                                            ? `<span style="color:${isMe ? '#40b870' : '#c8d8e8'}">${player.n.split(' ').pop()}</span><br><span style="color:#406080">${slotPick.team !== tid ? `⚠` : ''}</span>`
                                            : isCurrent ? `<span style="color:${isMe ? '#40b870' : '#e8c040'};font-weight:700">NOW</span>`
                                            : isDone ? `<span style="color:#1a3050">—</span>`
                                            : `<span style="color:#1a3050">·</span>`
                                        }
                                    </td>`;
                                }).join('')}
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>` : '';

        return `
            <div style="padding:12px 16px;max-width:1200px">
                ${orderSetup}
                ${banner}
                ${boardHtml}
            </div>`;
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
                <div class="ctrl">
                    <label style="display:flex;gap:5px;align-items:center;cursor:pointer">
                        <input type="checkbox" ${ui.hideSubRep?'checked':''} onchange="AppState.ui.hideSubRep=this.checked;UI.render()">
                        <span class="lbl">Hide Sub-Rep</span>
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
        if (p.CM_Role) return this.formatCloser({ closerStatus: p.CM_Role, closerRank: p.CM_Rank });
        // SP: PitcherList rank + tier
        if (p.PL_Rank) return this.formatRankBadge('PL', p.PL_Rank, p.PL_Tier);
        // Hitter: HitterList rank + tier + OBP-AVG adjustment signal
        if (p.HL_Rank) return this.formatRankBadge('HL', p.HL_Rank, p.HL_Tier, p.OBP, p.AVG);
        return '<span class="muted" style="font-size:10px">—</span>';
    },

    // Colored rank badge for PitcherList / HitterList.
    // Tier color scale: T1=gold, T2=green, T3-4=teal, T5-7=steel, T8+=gray
    // For HL badges: OBP-AVG delta adds a ▲ (red, walker underrated for OBP league) or
    // ▽ (blue, AVG-dependent, overrated for OBP league) indicator.
    formatRankBadge(source, rank, tier, obp, avg) {
        const tierColors = {
            1: '#d4a017', 2: '#40b870', 3: '#3a90b0', 4: '#3a90b0',
            5: '#5070a0', 6: '#5070a0', 7: '#5070a0',
        };
        const color = tierColors[tier] || '#506070';
        const t = tier ? `T${tier}·` : '';
        const sourceFull = source === 'PL' ? 'PitcherList' : 'HitterList';

        let adj = '', adjTooltip = '';
        if (source === 'HL' && obp != null && avg != null) {
            const delta = obp - avg;
            if (delta > 0.090) {
                adj = `<span style="color:#e05050;margin-left:3px;font-size:9px">▲</span>`;
                adjTooltip = ' | High walker — underrated for OBP leagues';
            } else if (delta < 0.055) {
                adj = `<span style="color:#5080d0;margin-left:3px;font-size:9px">▽</span>`;
                adjTooltip = ' | AVG-dependent — relatively overrated for OBP leagues';
            }
        }

        const tooltip = `${sourceFull}: ${tier ? 'Tier ' + tier + ' · ' : ''}Rank #${rank}${adjTooltip}`;
        return `<span class="pb" title="${tooltip}" style="background:#0a1a0a;border-color:${color};color:${color};white-space:nowrap;font-size:10px;cursor:default">${source} ${t}#${rank}${adj}</span>`;
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
            const tooltip = `CloserMonkey: ${p.closerStatus}${p.closerRank ? ' · CM rank #' + p.closerRank : ''}`;
            return `<span class="pb" title="${tooltip}" style="background:#0a1a0a;border-color:#406080;color:#7090a8;cursor:default">${p.closerStatus}</span>`;
        }
        const label = committee ? `${c.label}*` : c.label;
        const teamTag = team ? `<span style="opacity:0.55;font-size:9px;margin-left:2px">${team}</span>` : '';
        const rankTag = p.closerRank ? `<span style="opacity:0.6;font-size:9px;margin-left:3px">#${p.closerRank}</span>` : '';
        const committeeNote = committee ? ' (committee)' : '';
        const tooltip = `CloserMonkey: ${label}${committeeNote}${team ? ' · ' + team : ''}${p.closerRank ? ' · CM rank #' + p.closerRank : ''}`;
        return `<span class="pb" title="${tooltip}" style="background:#0a1a0a;border-color:${c.color};color:${c.color};white-space:nowrap;cursor:default">${label}${teamTag}${rankTag}</span>`;
    },

    formatAucVal(val) {
        if (val == null) return '—';
        if (val < 0) return `<span style="color:#d04040;font-weight:700">$${val}</span>`;
        return `<span class="gold" style="font-weight:700">$${val}</span>`;
    },

    formatCsArb(val) {
        if (val == null) return '-';
        const color = val > 3 ? 'grn' : (val < -3 ? 'red' : 'muted');
        const sign = val >= 0 ? '+' : '';
        return `<span class="${color}" style="font-weight:700">${sign}$${val}</span>`;
    },

    /**
     * Projection Sanity Shield — returns a short warning string if a player's
     * stats are notably good but their CS value is suspiciously low (likely bad data).
     * Returns null if no issue detected.
     */
    _getSanityWarning(p) {
        const val = p.csValAAdj;
        if (!val || val > 6) return null;  // only flag low-value players
        if (p.PA > 0) {
            if (p.HR >= 18) return `HR ${p.HR} vs only $${val}`;
            if (p.SB >= 25) return `SB ${p.SB} vs only $${val}`;
        }
        if (p.IP > 0) {
            if (p.K >= 150) return `K ${p.K} vs only $${val}`;
            if (p.IP >= 170) return `IP ${p.IP} vs only $${val}`;
        }
        // Source rank vs value mismatch (any player type)
        if (p.FTX_Rank != null && p.FTX_Rank <= 50 && val <= 4) return `FTX #${p.FTX_Rank} vs only $${val}`;
        if (p.ecr      != null && p.ecr      <= 50 && val <= 4) return `ECR #${Math.round(p.ecr)} vs only $${val}`;
        return null;
    },

    rosterscout() {
        const drafted    = effectiveDrafted();
        const myPicks    = Object.entries(drafted)
            .filter(([, v]) => v.team === 'me')
            .map(([id]) => AppState.players.find(p => p.id === id))
            .filter(Boolean);
        const taken      = new Set(Object.keys(drafted));
        const available  = AppState.players.filter(p => !taken.has(p.id));
        const n          = AppState.settings.snakePlannerN || 5;
        const totalReal  = Object.values(AppState.drafted).filter(v => !v.sim && v.team === 'me').length;
        const totalSim   = Object.values(drafted).filter(v => v.sim && v.team === 'me').length;

        // Default depth targets; user overrides stored in settings.rosterTargets
        const DEFAULTS = { C: 3, '1B': 2, '2B': 2, '3B': 2, SS: 2, OF: 7, SP: 7, RP: 5 };
        const overrides = AppState.settings.rosterTargets || {};
        const posGroups = [
            { pos: 'C',  label: 'C — Catcher' },
            { pos: '1B', label: '1B — First Base' },
            { pos: '2B', label: '2B — Second Base' },
            { pos: '3B', label: '3B — Third Base' },
            { pos: 'SS', label: 'SS — Shortstop' },
            { pos: 'OF', label: 'OF — Outfield' },
            { pos: 'SP', label: 'SP — Starting Pitcher' },
            { pos: 'RP', label: 'RP — Relief Pitcher' },
        ].map(g => ({ ...g, target: overrides[g.pos] ?? DEFAULTS[g.pos] }));

        // Compute all data per position once (used by both main sections and sidebar)
        const posData = posGroups.map(({ pos, target, label }) => {
            const myAtPos    = myPicks.filter(p => p.pos.includes(pos));
            const have       = myAtPos.length;
            const need       = Math.max(0, target - have);
            const topPlayers = available
                .filter(p => p.pos.includes(pos))
                .sort((a, b) => (b.csValAAdj || 0) - (a.csValAAdj || 0))
                .slice(0, n);
            return { pos, target, label, have, need, myAtPos, topPlayers };
        });

        const nButtons = [3, 5, 7, 10].map(v =>
            `<button onclick="UI.setSnakePlannerN(${v})" style="font-size:10px;padding:2px 8px;border:1px solid ${n === v ? '#2a5080' : '#1a2a3a'};background:${n === v ? '#0a2040' : '#060e18'};color:${n === v ? '#90b8d8' : '#2a4060'};cursor:pointer;border-radius:2px">${v}</button>`
        ).join('');

        const sections = posData.map(({ target, label, have, need, myAtPos, topPlayers }) => {
            const statusColor = have >= target ? '#40b870' : have === 0 ? '#d04040' : '#e8c040';
            const statusText  = have >= target ? '✓ FILLED' : `NEED ${need}`;
            const playerRows  = topPlayers.map(p => {
                const injBadge    = p.inj ? `<span class="pb" style="background:#401010;border-color:#802020;color:#f0a0a0;font-size:9px">INJ</span>` : '';
                const unoffBadge  = p.unofficial ? `<span class="est-badge">est</span>` : '';
                const sanityWarn  = this._getSanityWarning(p);
                const sanityBadge = sanityWarn ? `<span class="pb" title="⚠ DATA CHECK: ${sanityWarn}" style="background:#201000;border-color:#604000;color:#c87020;font-size:9px">⚠</span>` : '';
                const ecrStr      = p.ecr      != null ? `<span class="muted" style="font-size:10px">ECR:${Math.round(p.ecr)}</span>` : '';
                const ftxStr      = p.FTX_Rank != null ? `<span class="muted" style="font-size:10px">FTX:${p.FTX_Rank}</span>` : '';
                return `
                    <div style="padding:5px 10px;border-bottom:1px solid #0a1828;display:flex;align-items:center;gap:10px">
                        <div style="width:170px;flex-shrink:0">
                            <div style="color:#c8d8e8;font-size:12px;font-weight:600;cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}${unoffBadge}${injBadge}${sanityBadge}</div>
                            <div style="color:#406080;font-size:10px">${p.t} · ${p.pos.join('/')}</div>
                        </div>
                        <div style="display:flex;gap:8px;font-size:11px;flex:1;align-items:center;flex-wrap:wrap">
                            <span class="gold" style="font-weight:700">$${p.csValAAdj}</span>
                            ${p.csValS ? `<span class="grn" style="font-size:10px">$${p.csValS} SZN</span>` : ''}
                            ${ecrStr}${ftxStr}
                            <span class="muted" style="font-size:10px">${this.formatProjections(p)}</span>
                            ${this.formatScout(p)}
                        </div>
                        <button class="btn btn-go" style="font-size:10px;padding:2px 8px;flex-shrink:0" onclick="UI.openDraftModal('${p.id}')">PICK</button>
                    </div>`;
            }).join('');

            const myNames = myAtPos.slice(0, 5)
                .map(p => `<span style="font-size:11px;color:#7090a8">${p.n.split(' ').pop()}</span>`)
                .join('<span style="color:#1a3050;margin:0 3px">·</span>');

            return `
                <div style="background:#060e18;border:1px solid #0a1e30;border-radius:4px;margin-bottom:10px">
                    <div style="display:flex;align-items:center;gap:12px;padding:7px 10px;background:#0a1420;border-bottom:1px solid #0a1e30;border-radius:4px 4px 0 0;flex-wrap:wrap">
                        <div style="font-weight:700;color:#c8d8e8;min-width:160px">${label}</div>
                        <div style="font-size:11px;color:#7090a8">Have: <span style="color:#c8d8e8;font-weight:700">${have}</span></div>
                        <div style="font-size:11px;color:#7090a8">Target: <span style="color:#c8d8e8">${target}</span></div>
                        <div style="font-size:11px;font-weight:700;color:${statusColor}">${statusText}</div>
                        ${myNames ? `<div style="margin-left:8px;flex:1">${myNames}</div>` : '<div style="flex:1"></div>'}
                    </div>
                    ${playerRows || `<div style="padding:10px;color:#406080;font-size:11px;font-style:italic">No available players at this position</div>`}
                </div>`;
        }).join('');

        // Right sidebar: position summary with editable targets
        const sidebarRows = posData.map(({ pos, target, have, need }) => {
            const sc = have >= target ? '#40b870' : have === 0 ? '#d04040' : '#e8c040';
            const st = have >= target ? '✓' : `-${need}`;
            // Sanitize pos for use as element ID (replace / with _)
            const inputId = `tgt-${pos.replace(/\//g, '_')}`;
            return `<tr style="border-top:1px solid #0a1828">
                <td style="padding:5px 6px;font-size:12px;color:#c8d8e8;font-weight:700">${pos}</td>
                <td style="text-align:center;padding:5px 4px;font-size:12px;font-weight:700;color:${sc}">${have}</td>
                <td style="text-align:center;padding:3px 4px">
                    <input type="number" min="1" max="20" value="${target}" id="${inputId}"
                        onchange="UI.setRosterTarget('${pos}', this.value)"
                        style="width:38px;background:#0a1420;color:#c8d8e8;border:1px solid #1a3050;padding:2px 3px;font-size:11px;text-align:center">
                </td>
                <td style="text-align:right;padding:5px 6px;font-size:12px;font-weight:700;color:${sc}">${st}</td>
            </tr>`;
        }).join('');

        const hasOverrides = Object.keys(overrides).length > 0;
        const sidebar = `
            <div style="width:220px;flex-shrink:0;border-left:1px solid #0a1e30;background:#060e18;overflow-y:auto;min-height:0">
                <div style="padding:10px 12px">
                    <div style="font-size:10px;font-weight:700;color:#7090a8;letter-spacing:1px;margin-bottom:8px">POSITION NEEDS</div>
                    <table style="width:100%;border-collapse:collapse">
                        <thead><tr>
                            <th style="text-align:left;font-size:9px;color:#406080;padding:2px 6px 4px">POS</th>
                            <th style="text-align:center;font-size:9px;color:#406080;padding:2px 4px 4px">HAVE</th>
                            <th style="text-align:center;font-size:9px;color:#406080;padding:2px 4px 4px">TGT</th>
                            <th style="text-align:right;font-size:9px;color:#406080;padding:2px 6px 4px">NEED</th>
                        </tr></thead>
                        <tbody>${sidebarRows}</tbody>
                    </table>
                    ${hasOverrides ? `<button onclick="UI.resetRosterTargets()" style="margin-top:10px;font-size:10px;padding:2px 8px;border:1px solid #1a2a3a;background:#060e18;color:#2a4060;cursor:pointer;border-radius:2px;width:100%">RESET TO DEFAULTS</button>` : ''}
                    <div style="margin-top:10px;font-size:10px;color:#406080;line-height:1.5">
                        Depth targets incl. bench.<br>Edit TGT cells to customize.
                    </div>
                </div>
            </div>`;

        return `
            <div style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden">
                <div style="flex-shrink:0;display:flex;align-items:center;gap:12px;padding:8px 12px;background:#060e18;border-bottom:1px solid #0a1e30">
                    <span style="font-size:11px;color:#7090a8">Top N per position:</span>
                    <div style="display:flex;gap:4px">${nButtons}</div>
                    <span style="margin-left:auto;font-size:11px;color:#406080">
                        My roster: <span style="color:#c8d8e8">${totalReal} real</span>${totalSim ? ` + ${totalSim} sim` : ''} / ${LG.total} total
                        · <span style="color:#c8d8e8">${LG.total - myPicks.length}</span> spots open
                    </span>
                </div>
                <div style="display:flex;flex:1;min-height:0">
                    <div style="flex:1;overflow-y:auto;min-height:0">
                        <div style="padding:12px 16px">
                            <div style="font-size:10px;color:#406080;margin-bottom:10px">
                                Targets = suggested full-roster depth including bench. Available pool excludes all drafted players.
                            </div>
                            ${sections}
                        </div>
                    </div>
                    ${sidebar}
                </div>
            </div>`;
    },

    dataaudit() {
        const drafted = effectiveDrafted();
        const players = AppState.players;

        // Section 1: stat/value mismatches
        const mismatches = players
            .map(p => ({ p, warn: this._getSanityWarning(p) }))
            .filter(x => x.warn)
            .sort((a, b) => (a.p.csRank || 9999) - (b.p.csRank || 9999));

        // Section 2: large source rank disagreements (top-200 CS, |delta| > 80)
        const disagreements = players
            .filter(p => p.csRank != null && p.csRank <= 200)
            .map(p => {
                const ftxD = (p.FTX_Rank != null) ? p.FTX_Rank - p.csRank : null;
                const ecrD = (p.ecr      != null) ? p.ecr      - p.csRank : null;
                const worst = [ftxD, ecrD].filter(d => d != null).sort((a,b) => Math.abs(b)-Math.abs(a))[0];
                return { p, ftxD, ecrD, worst };
            })
            .filter(x => x.worst != null && Math.abs(x.worst) >= 80)
            .sort((a, b) => Math.abs(b.worst) - Math.abs(a.worst));

        // Section 3: top-150 CS players missing FTX or ECR data
        const missingData = players
            .filter(p => p.csRank != null && p.csRank <= 150 && (p.FTX_Rank == null || p.ecr == null))
            .sort((a, b) => a.csRank - b.csRank);

        const drTag = id => drafted[id]
            ? `<span class="muted" style="font-size:10px">${LG.teamsMap[drafted[id].team]?.team || drafted[id].team} $${drafted[id].cost}</span>`
            : `<button class="btn btn-go" style="font-size:10px;padding:1px 6px" onclick="UI.openDraftModal('${id}')">PICK</button>`;

        const section = (title, color, count, body) => `
            <div style="margin-bottom:16px">
                <div style="font-size:11px;font-weight:700;color:${color};letter-spacing:1px;padding:6px 10px;background:#060e18;border:1px solid #0a1e30;border-radius:4px 4px 0 0">
                    ${title} <span style="color:#406080;font-weight:400">(${count})</span>
                </div>
                ${body || `<div style="padding:10px 12px;font-size:11px;color:#406080;background:#060e18;border:1px solid #0a1e30;border-top:0;border-radius:0 0 4px 4px">None detected — data looks clean ✓</div>`}
            </div>`;

        const mismatchRows = mismatches.length ? `
            <div class="tbl-wrap" style="border-top:0;border-radius:0 0 4px 4px"><table>
                <thead><tr><th>Player</th><th>Pos</th><th>CS $</th><th>CS #</th><th>Issue</th><th>ECR</th><th>FTX</th><th></th></tr></thead>
                <tbody>
                ${mismatches.map(({ p, warn }) => `
                    <tr class="${drafted[p.id] ? 'drafted' : ''}">
                        <td class="nm" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}</td>
                        <td>${this.pb(p.pos)}</td>
                        <td class="gold">$${p.csValAAdj}</td>
                        <td class="mono muted">${p.csRank || '—'}</td>
                        <td style="font-size:11px;color:#c87020">${warn}</td>
                        <td class="mono muted" style="font-size:10px">${p.ecr != null ? Math.round(p.ecr) : '—'}</td>
                        <td class="mono muted" style="font-size:10px">${p.FTX_Rank ?? '—'}</td>
                        <td>${drTag(p.id)}</td>
                    </tr>`).join('')}
                </tbody>
            </table></div>` : '';

        const disagreeRows = disagreements.length ? `
            <div class="tbl-wrap" style="border-top:0;border-radius:0 0 4px 4px"><table>
                <thead><tr><th>Player</th><th>Pos</th><th>CS $</th><th>CS #</th><th>FTX #</th><th>FTX Δ</th><th>ECR</th><th>ECR Δ</th><th></th></tr></thead>
                <tbody>
                ${disagreements.map(({ p, ftxD, ecrD }) => {
                    const ftxColor = ftxD == null ? '#7090a8' : ftxD < -50 ? '#40b870' : ftxD > 50 ? '#d04040' : '#c8d8e8';
                    const ecrColor = ecrD == null ? '#7090a8' : ecrD < -50 ? '#40b870' : ecrD > 50 ? '#d04040' : '#c8d8e8';
                    return `<tr class="${drafted[p.id] ? 'drafted' : ''}">
                        <td class="nm" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}</td>
                        <td>${this.pb(p.pos)}</td>
                        <td class="gold">$${p.csValAAdj}</td>
                        <td class="mono muted">${p.csRank}</td>
                        <td class="mono muted">${p.FTX_Rank ?? '—'}</td>
                        <td class="mono" style="color:${ftxColor};font-weight:700">${ftxD != null ? (ftxD > 0 ? '+' : '') + Math.round(ftxD) : '—'}</td>
                        <td class="mono muted">${p.ecr != null ? Math.round(p.ecr) : '—'}</td>
                        <td class="mono" style="color:${ecrColor};font-weight:700">${ecrD != null ? (ecrD > 0 ? '+' : '') + Math.round(ecrD) : '—'}</td>
                        <td>${drTag(p.id)}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>` : '';

        const missingRows = missingData.length ? `
            <div class="tbl-wrap" style="border-top:0;border-radius:0 0 4px 4px"><table>
                <thead><tr><th>Player</th><th>Pos</th><th>CS $</th><th>CS #</th><th>FTX</th><th>ECR</th><th></th></tr></thead>
                <tbody>
                ${missingData.map(p => `
                    <tr class="${drafted[p.id] ? 'drafted' : ''}">
                        <td class="nm" style="cursor:pointer" onclick="UI.openInjuryModal('${p.id}')">${p.n}</td>
                        <td>${this.pb(p.pos)}</td>
                        <td class="gold">$${p.csValAAdj}</td>
                        <td class="mono muted">${p.csRank}</td>
                        <td style="color:${p.FTX_Rank == null ? '#d04040' : '#40b870'};font-size:11px">${p.FTX_Rank != null ? `#${p.FTX_Rank}` : '✗ missing'}</td>
                        <td style="color:${p.ecr == null ? '#d04040' : '#40b870'};font-size:11px">${p.ecr != null ? `#${Math.round(p.ecr)}` : '✗ missing'}</td>
                        <td>${drTag(p.id)}</td>
                    </tr>`).join('')}
                </tbody>
            </table></div>` : '';

        return `
            <div style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden">
                <div style="flex-shrink:0;padding:8px 12px;background:#060e18;border-bottom:1px solid #0a1e30;font-size:11px;color:#7090a8">
                    Flags potential data quality issues across all players. Drafted players shown greyed out.
                    Run <span style="color:#406080;font-family:monospace">python3 scripts/bake_assets.py</span> and
                    <span style="color:#406080;font-family:monospace">fetch_rankings.py --ranks</span> to refresh source data.
                </div>
                <div style="flex:1;overflow-y:auto;min-height:0;padding:12px 16px;max-width:1100px">
                    ${section('⚠ STAT / VALUE MISMATCHES', '#c87020', mismatches.length, mismatchRows)}
                    ${section('↕ LARGE SOURCE DISAGREEMENTS  (|Δ| ≥ 80, CS top 200)', '#4090c8', disagreements.length, disagreeRows)}
                    ${section('🔍 MISSING SOURCE DATA  (CS top 150)', '#7090a8', missingData.length, missingRows)}
                </div>
            </div>`;
    },

    // Shared draft log renderer used by myteam() and league().
    // Shows all real picks across all teams in chronological order with EDIT/✕ actions.
    draftLog(filterTeam) {
        const log = AppState.draftLog || [];
        const filtered = filterTeam ? log.filter(e => e.team === filterTeam) : log;
        if (!filtered.length) return '';
        const title = filterTeam
            ? `${LG.teamsMap[filterTeam]?.team || filterTeam} — DRAFT LOG (${filtered.length} picks)`
            : `DRAFT LOG — ALL TEAMS (${filtered.length} picks, chronological)`;
        return `
            <div style="margin-top:16px">
                <div class="sec">${title}</div>
                <div class="tbl-wrap"><table>
                    <thead><tr>
                        <th style="width:30px">#</th><th>Player</th><th>Pos</th>
                        <th>Team</th><th>Cost</th><th style="width:90px"></th>
                    </tr></thead>
                    <tbody>
                        ${filtered.map(entry => {
                            const p = AppState.players.find(x => x.id === entry.id);
                            const teamInfo = LG.teamsMap[entry.team];
                            const isMe = entry.team === 'me';
                            return `<tr class="${isMe ? 'mine' : ''}">
                                <td class="mono muted">${log.indexOf(entry) + 1}</td>
                                <td class="nm">${p?.n || entry.id}</td>
                                <td>${p ? this.pb(p.pos) : ''}</td>
                                <td class="${isMe ? 'gold' : 'muted'}" style="font-size:11px">${teamInfo?.team || entry.team}</td>
                                <td class="gold">$${entry.cost}</td>
                                <td style="display:flex;gap:4px;padding:3px 6px">
                                    <button class="btn" style="font-size:10px;padding:2px 6px" onclick="UI.openDraftModal('${entry.id}')">EDIT</button>
                                    <button class="btn btn-danger" style="font-size:10px;padding:2px 6px" onclick="Modals.undraftPlayer('${entry.id}')">✕</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table></div>
            </div>`;
    }
};
