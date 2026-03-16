/**
 * Core Z-Score and Valuation Engine.
 * Implements the Teddy Ballgame methodology: 10 categories, dual-pool sizes, dynamic replacement level.
 */

const ValEngine = {
    
    /**
     * Main calculation entry point.
     * Updates AppState.players with z-scores and dollar values.
     */
    calculateAll() {
        if (!AppState.players.length) return;

        const players = AppState.players;
        const hitters = players.filter(p => p.PA > 0);
        const pitchers = players.filter(p => p.IP > 0);

        const totalBudget = LG.budget * LG.teams;
        const hitBudget = totalBudget * (AppState.settings.hitSplit / 100);
        const pitBudget = totalBudget * (1 - AppState.settings.hitSplit / 100);

        // Pool sizes
        const aucH = Math.round(LG.aSlots * LG.teams * 0.62); // ~105 hitters
        const aucP = LG.aSlots * LG.teams - aucH;           // ~65 pitchers
        const sznH = Math.round(LG.total * LG.teams * 0.62); // ~192 hitters
        const sznP = LG.total * LG.teams - sznH;            // ~118 pitchers

        // 1. Initial rough value for replacement level sorting
        const getRoughVal = (p) => {
            if (p.PA) return p.HR * 3 + p.SB * 2.5 + p.XBH * 1.5 + p.OBP * 200 + p.RP;
            return p.K * 0.5 + p.W * 5 - p.ERA * 20 + p.SVH * 4 - p.WHIP * 30 + p.IP * 0.3;
        };

        const sortedH = [...hitters].sort((a, b) => getRoughVal(b) - getRoughVal(a));
        const sortedP = [...pitchers].sort((a, b) => getRoughVal(b) - getRoughVal(a));

        // 2. Calculate means, stddevs, and replacement levels for each pool
        const getStats = (list, n, key) => {
            const top = list.slice(0, n);
            const vals = top.map(p => p[key] || 0);
            const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
            const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
            const rpl = list[Math.min(n - 1, list.length - 1)][key] || 0;
            return { mean, std, rpl };
        };

        // Auction Pool Stats
        const HA = {
            HR: getStats(sortedH, aucH, 'HR'),
            SB: getStats(sortedH, aucH, 'SB'),
            XBH: getStats(sortedH, aucH, 'XBH'),
            OBP: getStats(sortedH, aucH, 'OBP'),
            RP: getStats(sortedH, aucH, 'RP')
        };
        const PA = {
            K: getStats(sortedP, aucP, 'K'),
            W: getStats(sortedP, aucP, 'W'),
            ERA: getStats(sortedP, aucP, 'ERA'),
            SVH: getStats(sortedP, aucP, 'SVH'),
            WHIP: getStats(sortedP, aucP, 'WHIP')
        };

        // Full Season Pool Stats
        const HF = {
            HR: getStats(sortedH, sznH, 'HR'),
            SB: getStats(sortedH, sznH, 'SB'),
            XBH: getStats(sortedH, sznH, 'XBH'),
            OBP: getStats(sortedH, sznH, 'OBP'),
            RP: getStats(sortedH, sznH, 'RP')
        };
        const PF = {
            K: getStats(sortedP, sznP, 'K'),
            W: getStats(sortedP, sznP, 'W'),
            ERA: getStats(sortedP, sznP, 'ERA'),
            SVH: getStats(sortedP, sznP, 'SVH'),
            WHIP: getStats(sortedP, sznP, 'WHIP')
        };

        const avgPA_a = sortedH.slice(0, aucH).reduce((s, p) => s + p.PA, 0) / aucH;
        const avgPA_f = sortedH.slice(0, sznH).reduce((s, p) => s + p.PA, 0) / sznH;
        const avgIP_a = sortedP.slice(0, aucP).reduce((s, p) => s + p.IP, 0) / aucP;

        const z = (val, stats, invert = false) => {
            const score = (val - stats.rpl) / stats.std;
            return invert ? -score : score;
        };

        // 3. Apply Z-scores to every player
        players.forEach(p => {
            const w = AppState.settings.weights;
            if (p.PA) {
                const wa = p.PA / avgPA_a, wf = p.PA / avgPA_f;
                p.zA = (z(p.HR, HA.HR)*w.HR + z(p.SB, HA.SB)*w.SB + z(p.XBH, HA.XBH)*w.XBH + 
                        z(p.OBP, HA.OBP)*wa*w.OBP + z(p.RP, HA.RP)*w.RP);
                p.zF = (z(p.HR, HF.HR)*w.HR + z(p.SB, HF.SB)*w.SB + z(p.XBH, HF.XBH)*w.XBH + 
                        z(p.OBP, HF.OBP)*wf*w.OBP + z(p.RP, HF.RP)*w.RP);
            } else {
                const wi = p.IP / avgIP_a;
                p.zA = (z(p.K, PA.K)*w.K + z(p.W, PA.W)*w.W + z(p.ERA, PA.ERA, true)*wi*w.ERA + 
                        z(p.SVH, PA.SVH)*w.SVH + z(p.WHIP, PA.WHIP, true)*wi*w.WHIP);
                p.zF = (z(p.K, PF.K)*w.K + z(p.W, PF.W)*w.W + z(p.ERA, PF.ERA, true)*wi*w.ERA + 
                        z(p.SVH, PF.SVH)*w.SVH + z(p.WHIP, PF.WHIP, true)*wi*w.WHIP);
            }
            p.arb = (p.zF || 0) - (p.zA || 0);
        });

        // 4. Positional Scarcity (Dynamic based on pool)
        const getScarcity = (posList, slots) => {
            const scores = players.filter(p => posList.some(x => p.pos.includes(x)))
                .map(p => p.zA || 0).sort((a, b) => b - a);
            const n = slots * LG.teams;
            const top = scores.slice(0, n);
            const avg = top.reduce((a, b) => a + b, 0) / n || 0;
            const rpl = scores[n - 1] || 0;
            return Math.max(0, (avg - rpl) * 0.25);
        };

        const scC = getScarcity(['C'], 1);
        const scMI = getScarcity(['2B', 'SS'], 2);

        // 5. Final Dollar Values
        const posZA = (p) => {
            const sc = p.pos.includes('C') ? scC : (p.pos.includes('SS') || p.pos.includes('2B')) ? scMI : 0;
            return (p.zA || 0) + sc;
        };
        const posZF = (p) => {
            const sc = p.pos.includes('C') ? scC : (p.pos.includes('SS') || p.pos.includes('2B')) ? scMI : 0;
            return (p.zF || 0) + sc;
        };

        const totalHitZA = hitters.filter(p => posZA(p) > 0).reduce((s, p) => s + posZA(p), 0) || 1;
        const totalPitZA = pitchers.filter(p => posZA(p) > 0).reduce((s, p) => s + posZA(p), 0) || 1;
        const totalHitZF = hitters.filter(p => posZF(p) > 0).reduce((s, p) => s + posZF(p), 0) || 1;
        const totalPitZF = pitchers.filter(p => posZF(p) > 0).reduce((s, p) => s + posZF(p), 0) || 1;

        players.forEach(p => {
            const isH = !!p.PA;
            const za = posZA(p), zf = posZF(p);
            const budget = isH ? hitBudget : pitBudget;
            
            p.aVal = za > 0 ? Math.max(1, Math.round((za / (isH ? totalHitZA : totalPitZA)) * budget)) : 1;
            p.fVal = zf > 0 ? Math.max(1, Math.round((zf / (isH ? totalHitZF : totalPitZF)) * budget)) : 1;
        });

        // 6. Ranks and Snake Discount (our z-score based)
        const byZA = [...players].sort((a, b) => (b.zA || 0) - (a.zA || 0));
        const byZF = [...players].sort((a, b) => (b.zF || 0) - (a.zF || 0));

        players.forEach(p => {
            p.aRank = byZA.findIndex(x => x.id === p.id) + 1;
            p.fRank = byZF.findIndex(x => x.id === p.id) + 1;

            if (AppState.settings.snakeDisc && p.aRank > AppState.settings.snakeCutoff) {
                const t = Math.min(1, (p.aRank - AppState.settings.snakeCutoff) / (200 - AppState.settings.snakeCutoff));
                p.aValAdj = Math.max(1, Math.round(p.aVal * (1 - t * 0.9)));
            } else {
                p.aValAdj = p.aVal;
            }
        });

        // 7. CheatSheet-based values (primary display) with snake discount applied
        // csRank is computed among official (seed) players only — unofficial steamer_extras
        // should not push real CheatSheet-ranked players past the snake discount cliff.
        const byCSA = [...players].sort((a, b) => (b.csValA || 0) - (a.csValA || 0));
        const officialByCSA = byCSA.filter(p => !p.unofficial);
        players.forEach(p => {
            p.csRank = p.unofficial
                ? byCSA.findIndex(x => x.id === p.id) + 1          // extras ranked in full pool
                : officialByCSA.findIndex(x => x.id === p.id) + 1; // seed players ranked among seeds only
            p.csArb  = Math.round((p.csValS || 0) - (p.csValA || 0));
            if (AppState.settings.snakeDisc && p.csRank > AppState.settings.snakeCutoff) {
                const t = Math.min(1, (p.csRank - AppState.settings.snakeCutoff) / (200 - AppState.settings.snakeCutoff));
                p.csValAAdj = Math.max(1, Math.round((p.csValA || 1) * (1 - t * 0.9)));
            } else {
                p.csValAAdj = p.csValA || 1;
            }
        });
    }
};
