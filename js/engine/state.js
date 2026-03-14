/**
 * Central state management for the Teddy Ballgame Draft Tool.
 * Handles localStorage persistence and provides an AI-ready data structure.
 */

const LG = {
    teams: 10,
    budget: 202,
    aSlots: 17, // Auction slots per team
    sSlots: 14, // Snake slots per team
    total: 31,
    minIP: 1000,
    teamNames: {
        me: '★ MY TEAM',
        t1: 'Opponent 1',
        t2: 'Opponent 2',
        t3: 'Opponent 3',
        t4: 'Opponent 4',
        t5: 'Opponent 5',
        t6: 'Opponent 6',
        t7: 'Opponent 7',
        t8: 'Opponent 8',
        t9: 'Opponent 9'
    }
};

let AppState = {
    players: [],      // Full list of player objects with projections and calculated values
    drafted: {},      // Map of playerID -> { cost, team, timestamp }
    settings: {
        hitSplit: 65,
        snakeDisc: true,
        snakeCutoff: 150,
        weights: {
            HR: 1, SB: 1, XBH: 1, OBP: 1, RP: 1,
            K: 1, W: 1, ERA: 1, SVH: 1, WHIP: 1
        }
    },
    ui: {
        activeTab: 'auction',
        search: '',
        posFilter: 'ALL',
        typeFilter: 'ALL',
        hideDrafted: false,
        sortCol: 'aValAdj',
        sortDir: 'desc'
    }
};

const StateManager = {
    STORAGE_KEY: 'tbg26_state',

    save() {
        try {
            const dataToSave = {
                drafted: AppState.drafted,
                settings: AppState.settings
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(dataToSave));
        } catch (e) {
            console.error('Error saving state:', e);
        }
    },

    load() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                AppState.drafted = parsed.drafted || {};
                AppState.settings = { ...AppState.settings, ...parsed.settings };
            }
        } catch (e) {
            console.error('Error loading state:', e);
        }
    },

    reset() {
        if (confirm('Are you sure you want to reset ALL draft data? This cannot be undone.')) {
            AppState.drafted = {};
            this.save();
            location.reload();
        }
    },

    /**
     * Generates a clean text summary for pasting into an AI (Gemini/Claude).
     */
    getAICategoryContext() {
        const myTeam = Object.entries(AppState.drafted)
            .filter(([, pick]) => pick.team === 'me')
            .map(([id]) => AppState.players.find(p => p.id === id))
            .filter(Boolean);

        // This is a placeholder for actual category accumulation logic
        // which will be moved to the engine later.
        return JSON.stringify({
            budgetRemaining: LG.budget - myTeam.reduce((sum, p) => sum + (AppState.drafted[p.id]?.cost || 0), 0),
            rosterSize: `${myTeam.length}/${LG.total}`,
            currentRoster: myTeam.map(p => `${p.n} (${p.pos.join(',')})`),
            message: "Analyze my team needs based on these projections..."
        }, null, 2);
    }
};

// Auto-load on init
StateManager.load();
