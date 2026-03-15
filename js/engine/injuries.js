/**
 * InjuryManager — v1.1.0
 * Handles fetching, diffing, and caching live injury news.
 */

const InjuryManager = {
    // We use a public RSS-to-JSON proxy for Rotoworld (NBC Sports)
    FEED_URL: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.nbcsports.com/fantasy/baseball/player-news?format=rss',

    async refreshNews() {
        console.log("[InjuryManager] Fetching latest news...");
        try {
            const res = await fetch(this.FEED_URL);
            const data = await res.json();
            
            if (data.status !== 'ok') throw new Error("Feed unavailable");

            const items = data.items || [];
            const newCache = { ...AppState.injuryCache };
            let updatedCount = 0;

            items.forEach(item => {
                // Find matching player in our database
                const player = this.matchPlayer(item.title);
                if (player) {
                    const blurb = item.content || item.description;
                    const timestamp = new Date(item.pubDate).getTime();

                    // Check for diff
                    if (!newCache[player.id] || newCache[player.id].ts < timestamp) {
                        newCache[player.id] = {
                            title: item.title,
                            blurb: this.cleanBlurb(blurb),
                            ts: timestamp,
                            isNew: true,
                            link: item.link
                        };
                        updatedCount++;
                        console.log(`[InjuryManager] Updated news for ${player.n}`);
                    }
                }
            });

            AppState.injuryCache = newCache;
            StateManager.save();
            return updatedCount;
        } catch (e) {
            console.error("[InjuryManager] Error:", e);
            return -1;
        }
    },

    /**
     * Attempts to match a news headline (e.g., "Aaron Judge (hand) went 2-for-3") 
     * to a player in our SEED list.
     */
    matchPlayer(title) {
        if (!AppState.players.length) return null;
        // Search for full names within the title
        return AppState.players.find(p => title.includes(p.n));
    },

    cleanBlurb(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || "";
    },

    getLatestFor(playerId) {
        return AppState.injuryCache[playerId] || null;
    },

    markRead(playerId) {
        if (AppState.injuryCache[playerId]) {
            AppState.injuryCache[playerId].isNew = false;
            StateManager.save();
        }
    }
};
