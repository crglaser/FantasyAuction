/**
 * ShareManager — v1.2.1
 * Compact bit-packed share URLs: seedIndex.cost.teamNum per pick, joined by '_'
 * Example: "42.10.1_15.45.0" = player at index 42 drafted for $10 by team t1, etc.
 * Falls back to long URL if is.gd shortener fails (CORS or rate limit).
 */

const ShareManager = {
    // Team ID ↔ compact integer (0=me, 1=t1 … 10=t10)
    TEAM_TO_IDX: { me:0, t1:1, t2:2, t3:3, t4:4, t5:5, t6:6, t7:7, t8:8, t9:9, t10:10 },
    IDX_TO_TEAM: ['me','t1','t2','t3','t4','t5','t6','t7','t8','t9','t10'],

    generateStateString() {
        const idToIdx = {};
        AppState.players.forEach((p, i) => { idToIdx[p.id] = i; });

        const picks = Object.entries(AppState.drafted)
            .map(([pid, pick]) => {
                const idx = idToIdx[pid];
                if (idx == null) return null;
                const teamNum = this.TEAM_TO_IDX[pick.team] ?? 0;
                return `${idx}.${pick.cost}.${teamNum}`;
            })
            .filter(Boolean);

        return picks.join('_');
    },

    loadFromStateString(str) {
        try {
            // Compact format: digits, dots, underscores only
            if (/^[\d._]+$/.test(str)) {
                return this._loadCompact(str);
            }
            // Legacy base64 format (backwards compat)
            const json = decodeURIComponent(atob(str));
            const data = JSON.parse(json);
            if (data.d) AppState.drafted = data.d;
            if (data.s) AppState.settings = { ...AppState.settings, ...data.s };
            AppState.ui.isReadOnly = true;
            return true;
        } catch (e) {
            console.error('[ShareManager] Failed to load state:', e);
            return false;
        }
    },

    _loadCompact(str) {
        const drafted = {};
        str.split('_').forEach(pick => {
            const parts = pick.split('.');
            if (parts.length !== 3) return;
            const [idxStr, costStr, teamStr] = parts;
            const player = AppState.players[parseInt(idxStr)];
            const team   = this.IDX_TO_TEAM[parseInt(teamStr)] || 'me';
            if (player) drafted[player.id] = { cost: parseInt(costStr), team, ts: 0 };
        });
        AppState.drafted = drafted;
        AppState.ui.isReadOnly = true;
        console.log(`[ShareManager] Loaded ${Object.keys(drafted).length} picks from compact share.`);
        return true;
    },

    async getTinyUrl(longUrl) {
        try {
            const res = await fetch(
                `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`,
                { mode: 'cors' }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const short = (await res.text()).trim();
            if (short.startsWith('http')) return short;
            throw new Error('Unexpected response');
        } catch (e) {
            console.warn('[ShareManager] Shortener failed, using long URL:', e.message);
            return null;
        }
    },

    async copyShareLink() {
        const btn = document.getElementById('shareBtn');
        const orig = btn.textContent;
        btn.textContent = 'GENERATING...';

        const stateStr = this.generateStateString();
        const longUrl  = `${window.location.origin}${window.location.pathname}?s=${stateStr}`;
        const url      = await this.getTinyUrl(longUrl) || longUrl;

        navigator.clipboard.writeText(url).then(() => {
            btn.textContent = 'COPIED!';
            setTimeout(() => { btn.textContent = orig; }, 2000);
        });
    }
};
