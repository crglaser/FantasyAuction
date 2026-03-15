/**
 * Modal logic for the Teddy Ballgame Draft Tool.
 * Handles opening/closing of Draft, Injury, and Rules modals.
 */

const Modals = {

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
        
        AppState.drafted[id] = {
            cost: parseInt(document.getElementById('mCost').value) || 0,
            team: document.getElementById('mTeam').value,
            ts: Date.now()
        };
        
        StateManager.save();
        this.closeModal();
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
            UI.render();
        }
    }
};
