/**
 * FaabEngine — pure roto-simulation computation for FAAB analysis.
 *
 * Depends on (global scope, available at call time):
 *   AppState, LG                     (state.js)
 *   optimalLineup, projStats          (templates.js — loaded after, called at runtime)
 *   effectiveDrafted                  (state.js)
 *
 * All methods are pure (no DOM, no AppState mutation) except where noted.
 * Loaded before ui/ scripts; called only at user interaction time.
 */

const FaabEngine = {

    // ─────────────────────────────────────────────
    // ROSTER HELPERS
    // ─────────────────────────────────────────────

    /**
     * Apply live injury cache to a roster, overriding stale inj flags and
     * reducing projected IP/PA for players confirmed on IL.
     * This ensures the roto simulation doesn't count injured players as fully healthy.
     *
     * IP/PA reduction logic (triggers projStats replacement-level padding):
     *   60-day IL:       SP → 80 IP,  RP → 25 IP,  Hitter → 150 PA
     *   Opening-day IL:  SP → 110 IP, RP → 35 IP,  Hitter → 380 PA
     * projStats padding threshold: SP < 120 IP, RP < 40 IP (from _REPL constants)
     */
    _applyInjuryCache(roster) {
        const cache = AppState.injuryCache;
        if (!cache) return roster;
        return roster.map(p => {
            const news = cache[p.id];
            if (!news) return p;
            const text = ((news.title || '') + ' ' + (news.blurb || '')).toLowerCase();
            const on60  = /60-day (il|injured list|disabled)/.test(text);
            const onIL  = on60
                || /placed on the (il|injured list)/.test(text)
                || /begin.{0,20}(season|year).{0,20}(il|injured list)/.test(text)
                || /begin.{0,5}the.{0,20}(il|injured list)/.test(text);
            if (!onIL) return { ...p, inj: true };  // day-to-day — flag inj but keep stats
            const isSP = (p.pos || []).includes('SP') && !(p.PA > 0);
            const isRP = (p.pos || []).includes('RP') && !(p.PA > 0) && !isSP;
            const isHitter = (p.PA || 0) > 0;
            const overrides = { inj: true };
            if (on60) {
                if (isSP)     overrides.IP = Math.min(p.IP || 0, 80);
                else if (isRP) overrides.IP = Math.min(p.IP || 0, 25);
                else if (isHitter) overrides.PA = Math.min(p.PA || 0, 150);
            } else {
                if (isSP)     overrides.IP = Math.min(p.IP || 0, 110);
                else if (isRP) overrides.IP = Math.min(p.IP || 0, 35);
                else if (isHitter) overrides.PA = Math.min(p.PA || 0, 380);
            }
            return { ...p, ...overrides };
        });
    },

    /**
     * Get the current roster for a team.
     * Prefers AppState.fantraxRosters (live Fantrax data) over effectiveDrafted() fallback.
     * Filters out _unmatched entries, then applies live injury cache overrides.
     */
    _getRosterByTid(tid, drafted, players) {
        let roster;
        if (AppState.fantraxRosters && AppState.fantraxRosters[tid]) {
            roster = AppState.fantraxRosters[tid].filter(p => !p._unmatched);
        } else {
            roster = Object.entries(drafted)
                .filter(([, v]) => v.team === tid)
                .map(([id]) => players.find(p => p.id === id))
                .filter(Boolean);
        }
        return this._applyInjuryCache(roster);
    },

    /**
     * Compute roster needs (how many more of each position are needed to hit targets).
     */
    _computeRosterNeeds(myPicks) {
        const DEFAULT_TARGETS = { C: 3, '1B': 2, '2B': 2, '3B': 2, SS: 2, OF: 7, SP: 7, RP: 5 };
        const overrides = (AppState.settings && AppState.settings.rosterTargets) || {};
        const targets = { ...DEFAULT_TARGETS, ...overrides };
        const haveCounts = myPicks.reduce((acc, p) => {
            (p.pos || []).forEach(pos => {
                if (targets[pos] != null) acc[pos] = (acc[pos] || 0) + 1;
            });
            return acc;
        }, {});
        return Object.fromEntries(
            Object.entries(targets).map(([pos, t]) => [pos, Math.max(0, t - (haveCounts[pos] || 0))])
        );
    },

    /**
     * Build a role/news string for a player from available data sources.
     * Priority: AI injury summary > injury title > CM_Role > closerStatus > injury flag
     */
    _buildRoleNews(player) {
        const parts = [];
        const news = AppState.injuryCache && AppState.injuryCache[player.id];
        if (news) {
            if (news.summary) {
                const lines = news.summary.split('\n').filter(Boolean);
                parts.push(lines.slice(0, 2).join(' · '));
            } else if (news.title) {
                parts.push(news.title.substring(0, 90));
            }
        }
        if (player.CM_Role) {
            parts.push('CM: ' + player.CM_Role);
        } else if (player.closerStatus) {
            parts.push('Status: ' + player.closerStatus);
        }
        if (player.inj && !parts.length) parts.push('INJ');
        return parts.join(' · ') || '—';
    },

    // ─────────────────────────────────────────────
    // CORE STAT COMPUTATION
    // ─────────────────────────────────────────────

    /**
     * Compute projected stats for all 10 teams.
     * rosterOverrides: { [tid]: [player, ...] } — use instead of default roster for specified teams.
     * opts: { useOptimal: bool, useRepl: bool }
     * Returns: { [tid]: { HR, SB, XBH, OBP, RP, K, W, SVH, ERA, WHIP, IP, n } }
     */
    computeAllTeamStats(drafted, players, opts, rosterOverrides) {
        opts = opts || {};
        rosterOverrides = rosterOverrides || {};
        const useOptimal = opts.useOptimal !== false;
        const useRepl    = opts.useRepl    !== false;
        const teams = Object.keys(LG.teamsMap);
        const stats = {};
        teams.forEach(tid => {
            const picks = rosterOverrides[tid] !== undefined
                ? rosterOverrides[tid]
                : this._getRosterByTid(tid, drafted, players);
            // If Fantrax slot data is available, use actual active roster;
            // otherwise fall back to optimalLineup heuristic.
            const hasSlotData = picks.length > 0 && picks[0].slot !== undefined;
            let active;
            if (hasSlotData) {
                active = picks.filter(p => p.slot === 'ACTIVE');
            } else {
                active = useOptimal ? optimalLineup(picks).starters : picks;
            }
            stats[tid] = Object.assign({}, projStats(active, useRepl), { n: picks.length });
        });
        return stats;
    },

    /**
     * Compute roto rank points per team — identical algorithm to Templates.standings().
     * Extracted here as the single source of truth; standings calls this too.
     * Returns: { [tid]: { HR: pts, SB: pts, ..., total: pts } }
     */
    computeRotoRanks(teamStats) {
        const teams = Object.keys(teamStats);
        const cats = ['HR','SB','XBH','OBP','RP','K','W','SVH','ERA','WHIP'];
        const inv = new Set(['ERA','WHIP']);
        const ranks = {};
        teams.forEach(tid => { ranks[tid] = { total: 0 }; });
        cats.forEach(cat => {
            const sorted = [...teams].sort((a, b) =>
                inv.has(cat) ? teamStats[a][cat] - teamStats[b][cat]
                             : teamStats[b][cat] - teamStats[a][cat]
            );
            let i = 0;
            while (i < sorted.length) {
                let j = i;
                const val = teamStats[sorted[i]][cat];
                while (j < sorted.length && teamStats[sorted[j]][cat] === val) j++;
                let pts = 0;
                for (let k = i; k < j; k++) pts += (teams.length - k);
                const avg = pts / (j - i);
                for (let k = i; k < j; k++) {
                    ranks[sorted[k]][cat] = avg;
                    ranks[sorted[k]].total += avg;
                }
                i = j;
            }
        });
        return ranks;
    },

    /**
     * Compute 1-based standings rank for a team (1 = highest total).
     */
    _rankFromRanks(ranks, tid) {
        const sorted = Object.entries(ranks).sort((a, b) => b[1].total - a[1].total);
        return sorted.findIndex(([t]) => t === tid) + 1;
    },

    // ─────────────────────────────────────────────
    // SIMULATION
    // ─────────────────────────────────────────────

    /**
     * Compute roto delta if player is added to myTid's roster.
     * Accepts optional precomputed baseStats/baseRanks to avoid redundant computation.
     * Returns: { delta, newTotal, oldTotal, newRank, oldRank }
     */
    computeROTODelta(player, myTid, drafted, players, opts, baseStats, baseRanks) {
        if (!baseStats) baseStats = this.computeAllTeamStats(drafted, players, opts);
        if (!baseRanks) baseRanks = this.computeRotoRanks(baseStats);
        const oldTotal = baseRanks[myTid] ? baseRanks[myTid].total : 0;
        const oldRank  = this._rankFromRanks(baseRanks, myTid);

        const myRoster = this._getRosterByTid(myTid, drafted, players);
        const newStats = this.computeAllTeamStats(drafted, players, opts, {
            [myTid]: [...myRoster, player]
        });
        const newRanks = this.computeRotoRanks(newStats);
        const newTotal = newRanks[myTid].total;
        const newRank  = this._rankFromRanks(newRanks, myTid);

        return {
            delta:    +(newTotal - oldTotal).toFixed(2),
            newTotal: +newTotal.toFixed(2),
            oldTotal: +oldTotal.toFixed(2),
            newRank,
            oldRank,
        };
    },

    /**
     * For every team: compute roto delta if they added this player.
     * Returns: { [tid]: { delta, newRank, oldRank } }
     */
    computeTradeMap(player, drafted, players, opts, baseStats, baseRanks) {
        if (!baseStats) baseStats = this.computeAllTeamStats(drafted, players, opts);
        if (!baseRanks) baseRanks = this.computeRotoRanks(baseStats);
        const teams = Object.keys(LG.teamsMap);
        const result = {};
        teams.forEach(tid => {
            const roster = this._getRosterByTid(tid, drafted, players);
            const newStats = this.computeAllTeamStats(drafted, players, opts, {
                [tid]: [...roster, player]
            });
            const newRanks = this.computeRotoRanks(newStats);
            result[tid] = {
                delta:   +(newRanks[tid].total - baseRanks[tid].total).toFixed(2),
                newRank: this._rankFromRanks(newRanks, tid),
                oldRank: this._rankFromRanks(baseRanks, tid),
            };
        });
        return result;
    },

    // ─────────────────────────────────────────────
    // FAAB ENRICHMENT
    // ─────────────────────────────────────────────

    /**
     * Full enrichment pipeline for the FAAB tab.
     *
     * recs: array from AppState.faab.recommendations OR AppState.fantraxRosters.fa
     *   — normalized to handle both shapes (Player/n, Score/ftxScore, ADP/ftxAdp, etc.)
     *
     * Returns enriched array with:
     *   _player, _deltaROTO, _newRank, _oldRank, _teamFit, _tradeMap,
     *   _bestTradeTo, _roleNews, _alreadyDrafted, _aVal, _fVal, _csVal
     */
    enrichFaabCandidates(recs, drafted, players, opts, myTid) {
        myTid = myTid || 'me';
        opts = opts || {};
        const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const playersByName = new Map(players.map(p => [norm(p.n), p]));

        const myPicks = this._getRosterByTid(myTid, drafted, players);
        const rosterNeeds = this._computeRosterNeeds(myPicks);

        // Compute baseline once
        const baseStats = this.computeAllTeamStats(drafted, players, opts);
        const baseRanks = this.computeRotoRanks(baseStats);
        const oldTotal  = baseRanks[myTid] ? baseRanks[myTid].total : 0;
        const oldRank   = this._rankFromRanks(baseRanks, myTid);

        const draftedNow = effectiveDrafted();

        const POS_WEIGHTS = { C:0.5,'1B':0.6,'2B':1,'3B':1,SS:1,OF:0.6,SP:1,RP:1.2,DH:0.1 };

        return recs.map(r => {
            // Normalize rec fields — handle both sources
            const playerName = r.Player || r.n || '';
            const pos        = r.Position || (Array.isArray(r.pos) ? r.pos.join(',') : (r.pos || ''));
            const score      = r.Score  != null ? r.Score  : (r.ftxScore || 0);
            const adp        = r.ADP    != null ? r.ADP    : (r.ftxAdp   || 999);
            const rank       = r.Rank   != null ? r.Rank   : (r.ftxRank  || 9999);
            const posWeight  = r.pos_weight != null ? r.pos_weight : 0;

            const base = playersByName.get(norm(playerName));
            if (!base) {
                return Object.assign({}, r, {
                    _player: null, _deltaROTO: 0, _newRank: oldRank, _oldRank: oldRank,
                    _teamFit: 0, _tradeMap: {}, _bestTradeTo: null,
                    _roleNews: 'Not in player pool', _alreadyDrafted: false,
                    _aVal: 0, _fVal: 0, _csVal: 0,
                    Player: playerName, Position: pos, Score: score, ADP: adp, Rank: rank,
                });
            }

            const alreadyDrafted = !!draftedNow[base.id];

            // ROTO+
            const myRoster = this._getRosterByTid(myTid, drafted, players);
            const newStats = this.computeAllTeamStats(drafted, players, opts, {
                [myTid]: [...myRoster, base]
            });
            const newRanks = this.computeRotoRanks(newStats);
            const delta    = +(newRanks[myTid].total - oldTotal).toFixed(2);
            const newRank  = this._rankFromRanks(newRanks, myTid);

            // Who gets bumped off the active lineup to make room?
            const beforeActive = new Set(optimalLineup(myRoster).starters.map(p => p.id));
            const afterActive  = new Set(optimalLineup([...myRoster, base]).starters.map(p => p.id));
            const replacedPlayer = myRoster.find(p => beforeActive.has(p.id) && !afterActive.has(p.id)) || null;
            const fillsOpenSlot  = afterActive.has(base.id) && !replacedPlayer;

            // Trade map
            const tradeMap = this.computeTradeMap(base, drafted, players, opts, baseStats, baseRanks);

            // Best team to trade to (highest delta, not myTid)
            const bestTrade = Object.entries(tradeMap)
                .filter(([tid]) => tid !== myTid)
                .sort((a, b) => b[1].delta - a[1].delta)[0];
            const bestTradeTo = bestTrade
                ? { tid: bestTrade[0], team: LG.teamsMap[bestTrade[0]] && LG.teamsMap[bestTrade[0]].team, delta: bestTrade[1].delta }
                : null;

            // Team fit score
            const posList   = base.pos || [];
            const needScore = posList.reduce((s, p2) => s + (rosterNeeds[p2] || 0), 0);
            const bestPosW  = posList.length
                ? Math.max(...posList.map(p2 => POS_WEIGHTS[p2] || 0.2))
                : (posWeight || 0.2);
            const teamFit   = +(needScore + bestPosW).toFixed(2);

            return Object.assign({}, r, {
                // Normalize display fields
                Player: playerName, Position: pos, Score: score, ADP: adp, Rank: rank,
                // Enrichment
                _player:         base,
                _deltaROTO:      delta,
                _newRank:        newRank,
                _oldRank:        oldRank,
                _teamFit:        teamFit,
                _tradeMap:       tradeMap,
                _bestTradeTo:    bestTradeTo,
                _roleNews:        this._buildRoleNews(base),
                _alreadyDrafted:  alreadyDrafted,
                _replacedPlayer:  replacedPlayer,
                _fillsOpenSlot:   fillsOpenSlot,
                _aVal:           base.aValAdj  || base.aVal  || 0,
                _fVal:           base.fVal      || 0,
                _csVal:          base.csValAAdj || base.csValA || 0,
            });
        });
    },
};
