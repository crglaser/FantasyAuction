/**
 * ShareManager — v1.2.0
 * Handles state compression and TinyURL generation for remote viewing.
 */

const ShareManager = {
    /**
     * Compresses the essential draft state into a URL-friendly string.
     */
    generateStateString() {
        const data = {
            d: AppState.drafted,     // { playerID: { cost, team } }
            s: AppState.settings,    // { hitSplit, weights, etc }
            v: APP_VERSION,
            ts: Date.now()
        };
        // Use standard btoa for Base64 (simple, no extra libs needed)
        // We URI encode first to handle any special chars in notes if we add them
        const json = JSON.stringify(data);
        return btoa(encodeURIComponent(json));
    },

    /**
     * Decompresses a state string from the URL.
     */
    loadFromStateString(str) {
        try {
            const json = decodeURIComponent(atob(str));
            const data = JSON.parse(json);
            
            // Only update drafted and settings
            if (data.d) AppState.drafted = data.d;
            if (data.s) AppState.settings = data.s;
            
            AppState.ui.isReadOnly = true; // Flag for UI
            console.log("[ShareManager] Successfully loaded shared state from URL.");
            return true;
        } catch (e) {
            console.error("[ShareManager] Failed to decompress state:", e);
            return false;
        }
    },

    /**
     * Generates a TinyURL via their free API.
     */
    async getTinyUrl() {
        const fullUrl = `${window.location.origin}${window.location.pathname}?s=${this.generateStateString()}`;
        
        // Note: TinyURL API requires an API Key for CORS. 
        // We'll use the 'is.gd' API which is more open for simple GET requests.
        const apiUrl = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(fullUrl)}`;

        try {
            const res = await fetch(apiUrl);
            if (!res.ok) throw new Error("Shortener failed");
            const shortUrl = await res.text();
            return shortUrl;
        } catch (e) {
            console.warn("[ShareManager] URL Shortener failed, returning long URL:", e);
            return fullUrl; // Fallback to long URL
        }
    },

    async copyShareLink() {
        const btn = document.getElementById('shareBtn');
        const originalText = btn.textContent;
        btn.textContent = "GENERATING...";
        
        const url = await this.getTinyUrl();
        
        navigator.clipboard.writeText(url).then(() => {
            btn.textContent = "COPIED!";
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        });
    }
};
