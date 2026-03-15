/**
 * InjuryManager — v1.1.1
 * Handles fetching, diffing, and caching live injury news.
 */

const InjuryManager = {
    // rss2json proxy — inner URL must be fully encoded as a single param value
    RSS_BASE: 'https://api.rss2json.com/v1/api.json?rss_url=',
    NBC_BASE: 'https://www.nbcsports.com/fantasy/baseball/player-news',

    async refreshNews() {
        const url = this.RSS_BASE + encodeURIComponent(this.NBC_BASE + '?format=rss');
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.status !== 'ok') throw new Error('Feed unavailable');
            return this.processItems(data.items || []);
        } catch (e) {
            console.error('[InjuryManager] refreshNews:', e.message);
            return -1;
        }
    },

    async searchForPlayer(player) {
        const innerUrl = `${this.NBC_BASE}?search=${encodeURIComponent(player.n)}&format=rss`;
        const url = this.RSS_BASE + encodeURIComponent(innerUrl);
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.status === 'ok' && data.items?.length > 0) {
                this.processItems(data.items);
                return true;
            }
            return false;
        } catch (e) {
            console.error('[InjuryManager] searchForPlayer:', e.message);
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
