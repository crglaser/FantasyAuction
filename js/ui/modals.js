/**
 * Modal logic for the Teddy Ballgame Draft Tool.
 * Handles opening/closing of Draft, Injury, and Rules modals.
 */

const Modals = {

    openDraftModal(id) {
        const p = AppState.players.find(x => x.id === id);
        if (!p) return;
        AppState.pendingPlayerId = id;
        const existing = AppState.drafted[id];
        const label = existing ? (existing.sim ? `Edit Sim: ${p.n}` : `Edit Pick: ${p.n}`) : `Draft: ${p.n}`;
        document.getElementById('modalTitle').textContent = label;
        const teamSel = document.getElementById('mTeam');
        const snakeDefault = !existing ? currentSnakeTeam() : null;
        teamSel.value = existing ? existing.team : (snakeDefault || 'me');
        this.updateDraftConstraints(teamSel.value);
        const costEl = document.getElementById('mCost');
        if (!costEl.disabled) {
            costEl.value = existing ? existing.cost : Math.min(p.csValAAdj || p.aValAdj || 1, parseInt(costEl.max) || 202);
        }
        const undraftBtn = document.getElementById('mUndraftBtn');
        if (undraftBtn) undraftBtn.style.display = existing ? '' : 'none';
        document.getElementById('modalBg').classList.add('open');
        setTimeout(() => { if (!costEl.disabled) costEl.select(); }, 50);
    },

    // Recalculate and display budget constraints for the selected team.
    // Called on open and whenever the team dropdown changes.
    updateDraftConstraints(teamId) {
        const id = AppState.pendingPlayerId;
        const constraintsEl = document.getElementById('draftConstraints');
        const costField     = document.getElementById('draftCostField');
        const costEl        = document.getElementById('mCost');
        if (!constraintsEl || !costEl) return;

        // Slot count: include sim picks — they consume auction slots
        const allTeamPicks  = Object.entries(effectiveDrafted())
            .filter(([pid, v]) => v.team === teamId && pid !== id);
        const slotsUsed = allTeamPicks.length;
        const slotsLeft = LG.aSlots - slotsUsed;

        // Budget: only real picks (sim costs aren't actual spend)
        const realTeamPicks = Object.entries(AppState.drafted)
            .filter(([pid, v]) => v.team === teamId && pid !== id);
        const spent = realTeamPicks.reduce((s, [, v]) => s + v.cost, 0);

        // If the existing pick already has a cost, it's an auction pick — always show cost field
        const existingCost = AppState.drafted[id]?.cost;
        const forceAuction = existingCost != null && existingCost > 0;

        if (slotsLeft <= 0 && !forceAuction) {
            // Snake phase for this team — no budget cost
            constraintsEl.innerHTML = `<span style="color:#406080">Snake pick — no auction cost</span>`;
            costField.style.display = 'none';
            costEl.disabled = true;
            costEl.value = 0;
        } else {
            costField.style.display = '';
            costEl.disabled = false;
            const budgetLeft = LG.budget - spent;
            // Must keep $1 per remaining slot (excluding this one)
            const maxBid = Math.max(1, budgetLeft - (slotsLeft - 1));
            costEl.max = maxBid;
            costEl.min = 1;
            const clr = maxBid < 10 ? '#d04040' : maxBid < 30 ? '#e8c040' : '#40b870';
            const slotLabel = slotsLeft === 1 ? 'last auction slot' : `${slotsLeft} auction slots left`;
            constraintsEl.innerHTML =
                `<span style="color:#406080">Budget: </span><span class="gold">$${budgetLeft} left</span>` +
                ` &nbsp;·&nbsp; <span style="color:#406080">${slotLabel}</span>` +
                ` &nbsp;·&nbsp; <span style="color:#406080">Max bid: </span><span style="color:${clr};font-weight:700">$${maxBid}</span>`;
            this.validateCostInput();
        }
    },

    validateCostInput() {
        const costEl = document.getElementById('mCost');
        if (!costEl || costEl.disabled) return;
        const val = parseInt(costEl.value) || 0;
        const max = parseInt(costEl.max) || LG.budget;
        costEl.style.borderColor = val > max || val < 1 ? '#d04040' : '';
    },

    closeModal() {
        const modals = ['modalBg', 'injuryModal', 'rulesModal'];
        modals.forEach(m => {
            const el = document.getElementById(m);
            if (el) el.classList.remove('open');
        });
        AppState.pendingPlayerId = null;
    },

    confirmDraft() {
        const id = AppState.pendingPlayerId;
        if (!id) return;
        const costEl = document.getElementById('mCost');
        const teamId = document.getElementById('mTeam').value;
        const cost   = costEl.disabled ? 0 : (parseInt(costEl.value) || 0);

        if (!costEl.disabled) {
            const max = parseInt(costEl.max) || LG.budget;
            if (cost < 1)   { alert('Minimum bid is $1.'); return; }
            if (cost > max) { alert(`Maximum bid for ${LG.teamsMap[teamId]?.team || teamId} is $${max}.`); return; }
        }

        const isNew = !AppState.drafted[id];
        // Push undo snapshot before mutating state
        StateManager.pushUndo();
        // Editing a sim pick manually promotes it to a real pick (drop sim flag)
        AppState.drafted[id] = { cost, team: teamId, ts: Date.now() };
        if (isNew) {
            AppState.draftLog.push({ id, ...AppState.drafted[id] });
            if (cost === 0 && AppState.snakeOrder.length) {
                const max = AppState.snakeOrder.length * LG.sSlots;
                if (AppState.snakePick < max) AppState.snakePick++;
            }
            // Auto-backup after new real picks
            StateManager.checkAutoBackup();
        } else {
            const entry = AppState.draftLog.find(e => e.id === id);
            if (entry) Object.assign(entry, AppState.drafted[id]);
        }
        StateManager.save();
        UI.clearAnalysisCache();
        this.closeModal();
        UI.render();
    },

    undraftPlayer(id) {
        const p = AppState.players.find(x => x.id === id);
        if (!confirm(`Remove ${p?.n || id} from draft?`)) return;
        delete AppState.drafted[id];
        AppState.draftLog = AppState.draftLog.filter(e => e.id !== id);
        StateManager.save();
        UI.clearAnalysisCache();
        UI.render();
    },

    openInjuryModal(id) {
        const p = AppState.players.find(x => x.id === id);
        if (!p) return;
        AppState.pendingPlayerId = id;

        const news = InjuryManager.getLatestFor(id);
        const note = AppState.playerNotes[id] || '';
        const proj = p.PA
            ? `OBP ${p.OBP.toFixed(3)}  ·  HR ${p.HR}  ·  SB ${p.SB}  ·  XBH ${p.XBH}  ·  RP ${p.RP}  ·  PA ${p.PA}`
            : `ERA ${p.ERA?.toFixed(2)}  ·  WHIP ${p.WHIP?.toFixed(2)}  ·  K ${p.K}  ·  W ${p.W}  ·  SVH ${p.SVH}  ·  IP ${p.IP}`;

        document.getElementById('injTitle').innerHTML = news && p.inj
            ? `<span style="color:#f0a0a0">⚠ ${news.title}</span>`
            : p.n;

        document.getElementById('injName').textContent =
            `${p.t}  ·  ${p.pos.join('/')}  ·  AUC $${p.csValAAdj || p.csValA || '—'}  ·  SZN $${p.csValS || '—'}  ·  Age ${p.age || '?'}`;

        // Role section
        const roleEl = document.getElementById('injRoleSection');
        const roleParts = this._buildRoleParts(p);
        if (roleParts.length) {
            roleEl.style.display = 'flex';
            roleEl.innerHTML = roleParts.join('');
        } else {
            roleEl.style.display = 'none';
            roleEl.innerHTML = '';
        }

        document.getElementById('modalProj').textContent = proj;

        const blurbEl = document.getElementById('injNewsBlurb');
        if (news) {
            blurbEl.textContent = news.blurb;
            blurbEl.style.color = '#c8d8e8';
        } else {
            blurbEl.textContent = 'No cached news — fetching live...';
            blurbEl.style.color = '#406080';
        }

        // Links
        document.getElementById('linkCBS').href =
            `https://www.cbssports.com/mlb/players/search/${encodeURIComponent(p.n)}/`;
        document.getElementById('linkFG').href = p.fgId
            ? `https://www.fangraphs.com/statss.aspx?playerid=${p.fgId}&position=${p.IP > 0 ? 'P' : 'PB'}`
            : `https://www.fangraphs.com/search?query=${encodeURIComponent(p.n)}`;
        const savantEl = document.getElementById('linkSavant');
        if (p.mlbId) {
            savantEl.href = `https://baseballsavant.mlb.com/savant-player/${p.mlbId}`;
            savantEl.style.opacity = '1';
        } else {
            savantEl.href = `https://baseballsavant.mlb.com/search?player_type=batter&results=&game_date_gt=&game_date_lt=&player_lookup%5B%5D=${encodeURIComponent(p.n)}`;
            savantEl.style.opacity = '0.5';
        }
        document.getElementById('linkRoto').href =
            `https://www.rotoballer.com/player-news?sport=baseball&player=${encodeURIComponent(p.n)}`;

        document.getElementById('noteArea').value = note;

        // Pre-computed summary or on-demand button
        const summaryBlock = document.getElementById('injSummaryBlock');
        const summaryEl    = document.getElementById('injSummary');
        const summarizeBtn = document.getElementById('injSummarizeBtn');
        if (news?.summary) {
            summaryBlock.style.display = 'block';
            summarizeBtn.style.display = 'none';
            summaryEl.innerHTML = this._formatSummary(news.summary);
        } else {
            summaryBlock.style.display = 'none';
            summarizeBtn.style.display = news?.blurb ? '' : 'none';
            summarizeBtn.textContent = '⚡ AI SUMMARY';
        }

        document.getElementById('injuryModal').classList.add('open');
        InjuryManager.markRead(id);

        // Auto-fetch live news in background
        const fetchStatusEl = document.getElementById('injLiveFetchStatus');
        fetchStatusEl.textContent = 'fetching...';
        InjuryManager.searchForPlayer(p).then(found => {
            if (AppState.pendingPlayerId !== id) return; // modal closed/changed
            const refreshed = InjuryManager.getLatestFor(id);
            if (found && refreshed) {
                blurbEl.textContent = refreshed.blurb;
                blurbEl.style.color = '#c8d8e8';
                const ago = this._timeAgo(refreshed.ts);
                fetchStatusEl.textContent = ago;
                if (refreshed.summary) {
                    summaryBlock.style.display = 'block';
                    summarizeBtn.style.display = 'none';
                    summaryEl.innerHTML = this._formatSummary(refreshed.summary);
                } else if (refreshed.blurb) {
                    summarizeBtn.style.display = '';
                }
            } else if (!news) {
                blurbEl.textContent = 'No news found. Check the links below.';
                blurbEl.style.color = '#304050';
                fetchStatusEl.textContent = 'no reports';
            } else {
                const ago = this._timeAgo(news.ts);
                fetchStatusEl.textContent = `cached ${ago}`;
            }
        });
    },

    _timeAgo(ts) {
        if (!ts) return '';
        const mins = Math.floor((Date.now() - ts) / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    },

    _buildRoleParts(p) {
        const parts = [];
        // Closer role from CM_Role
        if (p.CM_Role) {
            const segments = p.CM_Role.split(':');
            const status = segments[0];
            const committee = segments[2] === '*';
            const colors = { CLOSER: '#40b870', '1ST': '#e8c040', '2ND': '#6090c0' };
            const labels = { CLOSER: 'CLOSER', '1ST': '1ST IN LINE', '2ND': '2ND IN LINE' };
            const color = colors[status] || '#6090c0';
            const label = (labels[status] || status) + (committee ? ' (COM)' : '');
            parts.push(`<span style="background:${color};color:#000;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px">${label}</span>`);
        } else if (p.closerStatus) {
            const colors = { CLOSER: '#40b870', '1ST': '#e8c040', '2ND': '#6090c0' };
            const color = colors[p.closerStatus] || '#6090c0';
            parts.push(`<span style="background:${color};color:#000;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px">${p.closerStatus}</span>`);
        }
        // PL rank for SPs
        if (p.PL_Rank && p.IP > 0) {
            const t = p.PL_Tier || 99;
            const c = t <= 1 ? '#e8c040' : t <= 2 ? '#40b870' : t <= 4 ? '#409080' : '#7090a8';
            parts.push(`<span style="color:${c};font-size:11px;font-weight:600">PL SP #${p.PL_Rank}${p.PL_Tier ? ` T${p.PL_Tier}` : ''}</span>`);
        }
        // HL rank for hitters
        if (p.HL_Rank && p.PA > 0) {
            const t = p.HL_Tier || 99;
            const c = t <= 1 ? '#e8c040' : t <= 2 ? '#40b870' : t <= 4 ? '#409080' : '#7090a8';
            parts.push(`<span style="color:${c};font-size:11px;font-weight:600">HL #${p.HL_Rank}${p.HL_Tier ? ` T${p.HL_Tier}` : ''}</span>`);
        }
        // ECR
        if (p.ecr) {
            parts.push(`<span style="color:#7090a8;font-size:11px">ECR #${Math.round(p.ecr)}</span>`);
        }
        // ESPN auction $
        if (p.espnAuction) {
            parts.push(`<span style="color:#7090a8;font-size:11px">ESPN $${p.espnAuction}</span>`);
        }
        // ADP
        if (p.adp) {
            parts.push(`<span style="color:#7090a8;font-size:11px">ADP ${p.adp.toFixed(0)}</span>`);
        }
        return parts;
    },

    _formatSummary(text) {
        return text.split('\n').filter(l => l.trim()).map(line => {
            const m = line.match(/^(INJURY|PROGNOSIS|RETURN):\s*(.*)/i);
            if (!m) return `<span style="color:#c8d8e8">${line}</span>`;
            const labelColor = { INJURY: '#e8c040', PROGNOSIS: '#7090a8', RETURN: '#40b870' }[m[1].toUpperCase()] || '#c8d8e8';
            return `<span style="color:${labelColor};font-weight:700">${m[1]}:</span> <span style="color:#c8d8e8">${m[2]}</span>`;
        }).join('<br>');
    },

    async summarizeInjury() {
        const id = AppState.pendingPlayerId;
        const news = id ? InjuryManager.getLatestFor(id) : null;
        const apiKey = localStorage.getItem('claudeApiKey');

        const btn   = document.getElementById('injSummarizeBtn');
        const block = document.getElementById('injSummaryBlock');
        const out   = document.getElementById('injSummary');

        if (!apiKey) {
            block.style.display = 'block';
            out.innerHTML = '<span style="color:#7090a8">Add a Claude API key in the AI ADVISOR tab to enable injury summaries.</span>';
            return;
        }
        if (!news?.blurb) {
            block.style.display = 'block';
            out.innerHTML = '<span style="color:#7090a8">No news blurb available to summarize.</span>';
            return;
        }

        btn.textContent = '…';
        btn.disabled = true;
        block.style.display = 'block';
        out.innerHTML = '<span style="color:#406080">Summarizing…</span>';

        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 120,
                    system: 'You are a terse fantasy baseball injury analyst. Respond with exactly 3 labeled lines and nothing else.',
                    messages: [{
                        role: 'user',
                        content: `Summarize this injury report in exactly 3 lines:\nINJURY: [type of injury]\nPROGNOSIS: [good/moderate/serious/season-ending]\nRETURN: [expected timeline, e.g. "2-3 weeks" or "day-to-day" or "out for season"]\n\nReport: ${news.blurb}`
                    }]
                })
            });
            const data = await res.json();
            const text = data.content?.[0]?.text || 'Could not parse response.';
            out.innerHTML = this._formatSummary(text);
        } catch (e) {
            out.innerHTML = `<span style="color:#d04040">Error: ${e.message}</span>`;
        }
        btn.textContent = '⚡ AI SUMMARY';
        btn.disabled = false;
    },

    savePlayerNote() {
        const id = AppState.pendingPlayerId;
        const note = document.getElementById('noteArea').value;
        if (id) {
            AppState.playerNotes[id] = note;
            StateManager.save();
            document.getElementById('injuryModal').classList.remove('open');
            UI.render();
        }
    }
};
