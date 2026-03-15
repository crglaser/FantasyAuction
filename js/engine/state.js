/**
 * Central state management for the Teddy Ballgame Draft Tool.
 * Handles localStorage persistence and provides an AI-ready data structure.
 */

const APP_VERSION = '1.1.0';

const LG = {
    name: 'Teddy Ballgame Fantasy Baseball League 2026',
    teams: 10,
    budget: 202,
    aSlots: 17, // Auction slots per team
    sSlots: 14, // Snake slots per team
    total: 31,
    minIP: 1000,
    categories: {
        hitting: ['HR', 'OBP', 'RP', 'SB', 'XBH'], // RP = Runs Produced, XBH = Troubles
        pitching: ['W', 'K', 'ERA', 'SVH', 'WHIP']
    },
    roster: {
        active: {
            C: 1, '1B': 1, '3B': 1, CI: 1, '2B': 1, SS: 1, MI: 1, OF: 5, UT: 1,
            SP: 5, RP: 3, P: 2
        },
        bench: 8,
        il: 'Unlimited'
    },
    // Map of ID -> { owner, team }
    teamsMap: {
        t1: { owner: 'Brian Garber & Andrew Lombardi', team: 'Spew' },
        t2: { owner: 'Joe Achille', team: 'Village Idiots' },
        t3: { owner: 'Barry Carlin', team: 'Happy Recap' },
        me: { owner: 'Terry Lyons & Craig Glaser', team: 'Chathams' },
        t5: { owner: 'Andrew & Susan Grossman', team: 'Widowmakers' },
        t6: { owner: 'Andy Korbak', team: 'Dirt Dogs' },
        t7: { owner: 'Alex Tarshis', team: 'Let’s Deal' },
        t8: { owner: 'Bryan Boardman', team: 'Los Pollos Hermanos' },
        t9: { owner: 'Andy Enzweiler & Ed O’Brien', team: 'Diamond Hacks' },
        t10: { owner: 'Derek Carlin & Justin Hurson', team: 'The Rookies' }
    }
};

let AppState = {
    players: [],      // Full list of player objects with projections and calculated values
    drafted: {},      // Map of playerID -> { cost, team, timestamp }
    injuryCache: {},  // Map of playerID -> { title, blurb, ts, isNew, link }
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
        sortCol: 'csValAAdj',
        sortDir: 'desc'
    }
};

const StateManager = {
    STORAGE_KEY: 'tbg26_state',

    save() {
        try {
            const dataToSave = {
                drafted: AppState.drafted,
                settings: AppState.settings,
                injuryCache: AppState.injuryCache,
                version: APP_VERSION
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
                AppState.injuryCache = parsed.injuryCache || {};
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

        const spent = myTeam.reduce((sum, p) => sum + (AppState.drafted[p.id]?.cost || 0), 0);

        return JSON.stringify({
            league: LG.name,
            version: APP_VERSION,
            budgetRemaining: LG.budget - spent,
            rosterSize: `${myTeam.length}/${LG.total}`,
            currentRoster: myTeam.map(p => `${p.n} (${p.pos.join(',')}) - $${AppState.drafted[p.id].cost}`),
            rules: "10 Teams, 17 Auction/14 Snake, $202 Budget, 1000 IP Min.",
            categories: LG.categories,
            message: "Analyze my team needs based on these projections and league rules..."
        }, null, 2);
    },

    /**
     * Export all configuration and state to a JSON file.
     * This makes the tool "season-reusable".
     */
    exportConfig() {
        const data = {
            config: LG,
            state: {
                version: APP_VERSION,
                settings: AppState.settings,
                drafted: AppState.drafted,
                injuryCache: AppState.injuryCache
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `teddy_ballgame_config_${new Date().getFullYear()}.json`;
        a.click();
    }
};

// Auto-load on init
StateManager.load();
