/**
 * InjuryManager — v1.1.1
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
            return this.processItems(items);
        } catch (e) {
            console.error("[InjuryManager] Error:", e);
            return -1;
        }
    },

    /**
     * Targeted search for a single player to get deep history/blurbs.
     */
    async searchForPlayer(player) {
        console.log(`[InjuryManager] Deep search for ${player.n}...`);
        const queryUrl = `https://api.rss2json.com/v1/api.json?rss_url=https://www.nbcsports.com/fantasy/baseball/player-news?search=${encodeURIComponent(player.n)}&format=rss`;
        try {
            const res = await fetch(queryUrl);
            const data = await res.json();
            if (data.status === 'ok' && data.items.length > 0) {
                this.processItems(data.items);
                return true;
            }
            return false;
        } catch (e) {
            console.error(e);
            return false;
        }
    },

    processItems(items) {
        const newCache = { ...AppState.injuryCache };
        let updatedCount = 0;

        items.forEach(item => {
            const player = this.matchPlayer(item.title);
            if (player) {
                const blurb = item.content || item.description;
                const timestamp = new Date(item.pubDate).getTime();

                if (!newCache[player.id] || newCache[player.id].ts < timestamp) {
                    newCache[player.id] = {
                        title: item.title,
                        blurb: this.cleanBlurb(blurb),
                        ts: timestamp,
                        isNew: true,
                        link: item.link
                    };
                    updatedCount++;
                }
            }
        });

        AppState.injuryCache = newCache;
        StateManager.save();
        return updatedCount;
    },

    matchPlayer(title) {
        if (!AppState.players.length) return null;
        // Exact name match or contains
        return AppState.players.find(p => title.toLowerCase().includes(p.n.toLowerCase()));
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
