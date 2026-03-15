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
        document.getElementById('modalTitle').textContent = existing ? `Edit Pick: ${p.n}` : `Draft: ${p.n}`;
        document.getElementById('mCost').value = existing ? existing.cost : (p.csValAAdj || p.aValAdj || 1);
        document.getElementById('mTeam').value = existing ? existing.team : 'me';
        document.getElementById('modalBg').classList.add('open');
        setTimeout(() => document.getElementById('mCost').select(), 50);
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
        const isNew = !AppState.drafted[id];
        AppState.drafted[id] = {
            cost: parseInt(document.getElementById('mCost').value) || 0,
            team: document.getElementById('mTeam').value,
            ts: Date.now()
        };
        if (isNew) {
            AppState.draftLog.push({ id, ...AppState.drafted[id] });
        } else {
            const entry = AppState.draftLog.find(e => e.id === id);
            if (entry) Object.assign(entry, AppState.drafted[id]);
        }
        StateManager.save();
        this.closeModal();
        UI.render();
    },

    undraftPlayer(id) {
        const p = AppState.players.find(x => x.id === id);
        if (!confirm(`Remove ${p?.n || id} from draft?`)) return;
        delete AppState.drafted[id];
        AppState.draftLog = AppState.draftLog.filter(e => e.id !== id);
        StateManager.save();
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
            `${p.t}  ·  ${p.pos.join('/')}  ·  AUC $${p.csValAAdj || p.csValA || '—'}  ·  SZN $${p.csValS || '—'}`;

        document.getElementById('modalProj').textContent = proj;

        const blurbEl = document.getElementById('injNewsBlurb');
        if (news) {
            blurbEl.textContent = news.blurb;
            blurbEl.style.color = '#c8d8e8';
        } else {
            blurbEl.textContent = 'No cached news. Check the links below for current status.';
            blurbEl.style.color = '#406080';
        }

        document.getElementById('linkCBS').href =
            `https://www.cbssports.com/mlb/players/search/${encodeURIComponent(p.n)}/`;
        document.getElementById('linkFG').href = p.fgId
            ? `https://www.fangraphs.com/statss.aspx?playerid=${p.fgId}&position=${p.IP > 0 ? 'P' : 'PB'}`
            : `https://www.fangraphs.com/search?query=${encodeURIComponent(p.n)}`;

        document.getElementById('noteArea').value = note;

        // Pre-computed summary (from update_injuries.py --summarize) or reset for on-demand
        const summaryBlock = document.getElementById('injSummaryBlock');
        const summaryEl    = document.getElementById('injSummary');
        const summarizeBtn = document.getElementById('injSummarizeBtn');
        if (news?.summary) {
            summaryBlock.style.display = 'block';
            summarizeBtn.textContent = '⚡ AI SUMMARY';
            // Format the 3 lines with colored labels (same as live summarize)
            summaryEl.innerHTML = news.summary.split('\n').filter(l => l.trim()).map(line => {
                const m = line.match(/^(INJURY|PROGNOSIS|RETURN):\s*(.*)/i);
                if (!m) return `<span style="color:#c8d8e8">${line}</span>`;
                const labelColor = { INJURY: '#e8c040', PROGNOSIS: '#7090a8', RETURN: '#40b870' }[m[1].toUpperCase()] || '#c8d8e8';
                return `<span style="color:${labelColor};font-weight:700">${m[1]}:</span> <span style="color:#c8d8e8">${m[2]}</span>`;
            }).join('<br>');
        } else {
            summaryBlock.style.display = 'none';
            summarizeBtn.textContent = '⚡ AI SUMMARY';
        }

        document.getElementById('injuryModal').classList.add('open');
        InjuryManager.markRead(id);
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
            // Format the 3 lines with colored labels
            out.innerHTML = text.split('\n').filter(l => l.trim()).map(line => {
                const m = line.match(/^(INJURY|PROGNOSIS|RETURN):\s*(.*)/i);
                if (!m) return `<span style="color:#c8d8e8">${line}</span>`;
                const labelColor = { INJURY: '#e8c040', PROGNOSIS: '#7090a8', RETURN: '#40b870' }[m[1].toUpperCase()] || '#c8d8e8';
                return `<span style="color:${labelColor};font-weight:700">${m[1]}:</span> <span style="color:#c8d8e8">${m[2]}</span>`;
            }).join('<br>');
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
