/**
 * TradeEngine — roto-simulation based trade analysis.
 *
 * Depends on FaabEngine (faab_engine.js) and global AppState/LG.
 * All methods pure (no DOM, no AppState mutation) except suggestTrades/computeAllAssetValues
 * which write to AppState caches — only called on explicit user action.
 */

const TradeEngine = {

    // ─────────────────────────────────────────────
    // CATEGORY NEEDS
    // ─────────────────────────────────────────────

    /**
     * Return which categories a team is strong/weak in.
     * surplusCats: ranked 8+ (top 3) — categories to sell
     * weakCats:    ranked 3 or below (bottom 3) — categories to buy
     */
    getCategoryNeeds(tid, teamStats, ranks) {
        const cats = ['HR','SB','XBH','OBP','RP','K','W','SVH','ERA','WHIP'];
        const surplusCats = cats.filter(c => (ranks[tid] && ranks[tid][c] || 0) >= 8);
        const weakCats    = cats.filter(c => (ranks[tid] && ranks[tid][c] || 0) <= 3);
        return { surplusCats, weakCats };
    },

    // ─────────────────────────────────────────────
    // ASSET VALUATION
    // ─────────────────────────────────────────────

    /**
     * For every rostered player on every team, compute their marginal roto contribution:
     * how much does the owning team's total rank points drop if this player is removed?
     *
     * Returns: { [playerId]: { tid, marginalPts, catContrib: { [cat]: pts } } }
     *
     * EXPENSIVE — O(N_drafted) stat computations. Cache result in AppState.tradeAssets.
     * Only call from explicit user action (COMPUTE ASSETS button).
     */
    computeAllAssetValues(drafted, players, opts) {
        opts = opts || {};
        const baseStats = FaabEngine.computeAllTeamStats(drafted, players, opts);
        const baseRanks = FaabEngine.computeRotoRanks(baseStats);
        const result = {};
        const cats = ['HR','SB','XBH','OBP','RP','K','W','SVH','ERA','WHIP'];
        const teams = Object.keys(LG.teamsMap);

        teams.forEach(tid => {
            const roster = FaabEngine._getRosterByTid(tid, drafted, players);
            roster.forEach(player => {
                const pid = player.id;
                const rosterWithout = roster.filter(p => p.id !== pid);
                const newStats = FaabEngine.computeAllTeamStats(drafted, players, opts, { [tid]: rosterWithout });
                const newRanks = FaabEngine.computeRotoRanks(newStats);
                const marginalPts = +(baseRanks[tid].total - newRanks[tid].total).toFixed(2);
                const catContrib = {};
                cats.forEach(cat => {
                    catContrib[cat] = +((baseRanks[tid][cat] || 0) - (newRanks[tid][cat] || 0)).toFixed(2);
                });
                result[pid] = { tid, marginalPts, catContrib };
            });
        });

        return result;
    },

    // ─────────────────────────────────────────────
    // TRADE EVALUATION
    // ─────────────────────────────────────────────

    /**
     * Evaluate a proposed 1-or-more-for-1-or-more trade.
     * give:    array of player objects from myTid to trade away
     * receive: array of player objects from otherTid to receive
     *
     * Accepts optional precomputed baseStats/baseRanks for batch use (suggestTrades).
     * Returns: { myDelta, otherDelta, myNewRank, otherNewRank, myOldRank, otherOldRank, summary,
     *            myStatsBefore, myStatsAfter, theirStatsBefore, theirStatsAfter }
     */
    evaluateTrade(give, receive, myTid, otherTid, drafted, players, opts, baseStats, baseRanks) {
        opts = opts || {};
        if (!baseStats) baseStats = FaabEngine.computeAllTeamStats(drafted, players, opts);
        if (!baseRanks) baseRanks = FaabEngine.computeRotoRanks(baseStats);

        const myOldRank    = FaabEngine._rankFromRanks(baseRanks, myTid);
        const otherOldRank = FaabEngine._rankFromRanks(baseRanks, otherTid);

        // Build swapped rosters
        const giveIds = new Set(give.map(p => p.id));
        const recvIds = new Set(receive.map(p => p.id));
        const myRoster    = FaabEngine._getRosterByTid(myTid,    drafted, players);
        const otherRoster = FaabEngine._getRosterByTid(otherTid, drafted, players);

        const newMyRoster    = [...myRoster.filter(p => !giveIds.has(p.id)), ...receive];
        const newOtherRoster = [...otherRoster.filter(p => !recvIds.has(p.id)), ...give];

        const newStats = FaabEngine.computeAllTeamStats(drafted, players, opts, {
            [myTid]:    newMyRoster,
            [otherTid]: newOtherRoster,
        });
        const newRanks = FaabEngine.computeRotoRanks(newStats);

        const myDelta    = +(newRanks[myTid].total    - baseRanks[myTid].total).toFixed(2);
        const otherDelta = +(newRanks[otherTid].total - baseRanks[otherTid].total).toFixed(2);
        const myNewRank    = FaabEngine._rankFromRanks(newRanks, myTid);
        const otherNewRank = FaabEngine._rankFromRanks(newRanks, otherTid);

        let summary;
        if (myDelta > 0 && otherDelta > 0) {
            summary = 'Win-win: you +' + myDelta + 'pts (' + myOldRank + '→' + myNewRank + '), they +' + otherDelta + 'pts';
        } else if (myDelta > 0) {
            summary = 'You gain ' + myDelta + 'pts (' + myOldRank + '→' + myNewRank + '), they lose ' + Math.abs(otherDelta).toFixed(2) + 'pts';
        } else if (otherDelta > 0) {
            summary = 'You lose ' + Math.abs(myDelta).toFixed(2) + 'pts, they gain ' + otherDelta + 'pts';
        } else {
            summary = 'Neither team improves (' + myDelta + ' / ' + otherDelta + 'pts)';
        }

        return {
            myDelta, otherDelta,
            myNewRank, otherNewRank,
            myOldRank, otherOldRank,
            summary,
            myStatsBefore:    baseStats[myTid],
            myStatsAfter:     newStats[myTid],
            theirStatsBefore: baseStats[otherTid],
            theirStatsAfter:  newStats[otherTid],
        };
    },

    // ─────────────────────────────────────────────
    // TRADE SUGGESTIONS
    // ─────────────────────────────────────────────

    /**
     * Find 1-for-1 trades that improve my roto standing.
     * Uses category-need matching to prune the search space before brute-force eval.
     *
     * EXPENSIVE — only call from explicit "FIND TRADES" button click.
     * Returns array sorted by myDelta desc, capped at 30 suggestions.
     */
    suggestTrades(myTid, drafted, players, opts) {
        opts = opts || {};
        const baseStats = FaabEngine.computeAllTeamStats(drafted, players, opts);
        const baseRanks = FaabEngine.computeRotoRanks(baseStats);
        const myNeeds   = this.getCategoryNeeds(myTid, baseStats, baseRanks);
        const teams     = Object.keys(LG.teamsMap).filter(t => t !== myTid);
        const myRoster  = FaabEngine._getRosterByTid(myTid, drafted, players);
        const profiles  = AppState.ownerProfiles || {};
        const suggestions = [];

        teams.forEach(otherTid => {
            const otherNeeds  = this.getCategoryNeeds(otherTid, baseStats, baseRanks);
            const otherRoster = FaabEngine._getRosterByTid(otherTid, drafted, players);

            // Skip pairs with no plausible category synergy
            const hasSynergy =
                myNeeds.surplusCats.some(c => otherNeeds.weakCats.includes(c)) ||
                otherNeeds.surplusCats.some(c => myNeeds.weakCats.includes(c));
            if (!hasSynergy) return;

            myRoster.forEach(give => {
                otherRoster.forEach(receive => {
                    if (give.id === receive.id) return;
                    const result = this.evaluateTrade(
                        [give], [receive], myTid, otherTid,
                        drafted, players, opts, baseStats, baseRanks
                    );
                    if (result.myDelta <= 0) return;
                    suggestions.push({
                        give,
                        receive,
                        receiveTid:   otherTid,
                        myDelta:      result.myDelta,
                        otherDelta:   result.otherDelta,
                        myNewRank:    result.myNewRank,
                        myOldRank:    result.myOldRank,
                        summary:      result.summary,
                        reason:       this._tradeReason(give, receive, myNeeds, otherNeeds),
                        profile:      profiles[otherTid] || null,
                    });
                });
            });
        });

        return suggestions.sort((a, b) => b.myDelta - a.myDelta).slice(0, 30);
    },

    /**
     * Build a human-readable reason string for a suggested trade.
     */
    _tradeReason(give, receive, myNeeds, otherNeeds) {
        const hitCats = ['HR','SB','XBH','OBP','RP'];
        const pitCats = ['K','W','SVH','ERA','WHIP'];
        const giveCats  = (give.PA  || 0) > 0 ? hitCats : pitCats;
        const recvCats  = (receive.PA || 0) > 0 ? hitCats : pitCats;
        const fills = recvCats.filter(c => myNeeds.weakCats.includes(c));
        const costs = giveCats.filter(c => myNeeds.surplusCats.includes(c));
        const parts = [];
        if (fills.length) parts.push('fills your ' + fills.join('/') + ' need');
        if (costs.length) parts.push('trade surplus ' + costs.join('/'));
        if (!parts.length) parts.push('net roto gain');
        return parts.join(', ');
    },

    // ─────────────────────────────────────────────
    // STAT DELTA TABLE (for evaluate view)
    // ─────────────────────────────────────────────

    /**
     * Build per-category stat comparison rows for the evaluate UI.
     * Returns array of { cat, before, after, delta, inv } for each roto category.
     */
    buildStatDelta(statsBefore, statsAfter) {
        const cats = ['HR','SB','XBH','OBP','RP','K','W','SVH','ERA','WHIP'];
        const inv  = new Set(['ERA','WHIP']);
        return cats.map(cat => {
            const before = statsBefore ? statsBefore[cat] : 0;
            const after  = statsAfter  ? statsAfter[cat]  : 0;
            const delta  = after - before;
            return { cat, before, after, delta, inv: inv.has(cat) };
        });
    },
};
