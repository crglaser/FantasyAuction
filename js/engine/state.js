/**
 * Central state management for the Teddy Ballgame Draft Tool.
 * Handles localStorage persistence and provides an AI-ready data structure.
 */

const APP_VERSION = '1.8.5';
const ADMIN_PASS = 'chathams26'; // Change this to your preferred password

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
        t10: { owner: 'Derek Carlin & Justin Hurson', team: 'Velvet Thunder' }
    }
};

let AppState = {
    players: [],      // Full list of player objects with projections and calculated values
    drafted: {},      // Map of playerID -> { cost, team, ts, sim?:true }
    draftLog: [],     // Ordered array of all picks: { id, cost, team, ts, sim?:true }
    injuryCache: {},  // Map of playerID -> { title, blurb, ts, isNew, link }
    playerNotes: {},  // Map of playerID -> "Custom scouting/injury notes"
    aiHistory: [],    // Array of { q, a, ts } AI advisor exchanges
    snakeOrder: [],   // Array of 10 team IDs in snake draft order (slot 1 → slot 10)
    snakePick: 0,     // Current pick index (0-based); auto-advances on snake pick confirm
    undoStack: [],    // Not persisted; snapshots for undo (max 10)
    settings: {
        hitSplit: 65,
        snakeDisc: true,
        snakeCutoff: 150,
        backupInterval: 10,  // Auto-backup every N real picks (0 = disabled)
        snakePlannerN: 5,    // Top N players per position in snake planner
        rosterTargets: {},   // Per-position target overrides for Roster Scout
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
        hideSubRep: true,
        sortCol: 'csValA',
        sortDir: 'desc',
        hiddenCols: [],   // column keys toggled off by user
        arbOutlierOnly: false,
        arbMinVal: 0,
        myteamView: 'me',
        myteamSearch: '',
        leagueSearch: '',
        leagueTeamFilter: null,
        catExpanded: null,
        uiZoom: 1.0,
        hideInjured: false,
        scoutOnly: false,
        watchOnly: false,
        plOnly: false,
        snakeScoutOnly: true,
        snakePosFilter: ['C','1B','2B','SS','3B','OF','SP','RP'],
        rosterScoutOnly: false,
        rosterPosFilter: ['C','1B','2B','SS','3B','OF','SP','RP']
    }
};

const StateManager = {
    STORAGE_KEY: 'tbg26_state',

    save() {
        try {
            const dataToSave = {
                drafted: AppState.drafted,
                draftLog: AppState.draftLog,
                settings: AppState.settings,
                injuryCache: AppState.injuryCache,
                playerNotes: AppState.playerNotes,
                aiHistory: AppState.aiHistory,
                snakeOrder: AppState.snakeOrder,
                snakePick: AppState.snakePick,
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
                AppState.draftLog = parsed.draftLog || [];
                AppState.settings = { ...AppState.settings, ...parsed.settings };
                AppState.injuryCache = parsed.injuryCache || {};
                AppState.playerNotes = parsed.playerNotes || {};
                AppState.aiHistory = parsed.aiHistory || [];
                AppState.snakeOrder = parsed.snakeOrder || [];
                AppState.snakePick  = parsed.snakePick  || 0;
            }
        } catch (e) {
            console.error('Error loading state:', e);
        }
    },

    reset() {
        if (confirm('Are you sure you want to reset ALL draft data? This cannot be undone.')) {
            AppState.drafted = {};
            AppState.draftLog = [];
            AppState.undoStack = [];
            this.save();
            location.reload();
        }
    },

    /**
     * Push a snapshot of current draft state onto the undo stack (max 10).
     * Call this BEFORE mutating AppState.drafted / draftLog.
     */
    pushUndo() {
        AppState.undoStack.push({
            drafted:   JSON.parse(JSON.stringify(AppState.drafted)),
            draftLog:  JSON.parse(JSON.stringify(AppState.draftLog)),
            snakePick: AppState.snakePick
        });
        if (AppState.undoStack.length > 10) AppState.undoStack.shift();
    },

    /** Revert the most recent pick. */
    undoLastPick() {
        const snap = AppState.undoStack.pop();
        if (!snap) { alert('Nothing to undo.'); return; }
        AppState.drafted  = snap.drafted;
        AppState.draftLog = snap.draftLog;
        AppState.snakePick = snap.snakePick;
        this.save();
        UI.render();
    },

    /**
     * Called after every new real pick. Triggers an auto-backup download
     * when the configured interval is reached.
     */
    checkAutoBackup() {
        const interval = AppState.settings.backupInterval || 0;
        if (!interval) return;
        AppState._backupPickCount = (AppState._backupPickCount || 0) + 1;
        if (AppState._backupPickCount >= interval) {
            AppState._backupPickCount = 0;
            this._doAutoBackup();
        }
    },

    _doAutoBackup() {
        const realPicks = Object.entries(AppState.drafted).filter(([, v]) => !v.sim).length;
        const ts = new Date().toISOString().replace('T', '_').replace(/[:.]/g, '-').slice(0, 16);
        const data = {
            version: APP_VERSION,
            backupTime: new Date().toISOString(),
            totalRealPicks: realPicks,
            drafted:     Object.fromEntries(Object.entries(AppState.drafted).filter(([, v]) => !v.sim)),
            draftLog:    AppState.draftLog.filter(e => !e.sim),
            settings:    AppState.settings,
            playerNotes: AppState.playerNotes,
            snakeOrder:  AppState.snakeOrder,
            snakePick:   AppState.snakePick
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `tbg26_backup_${ts}_${realPicks}picks.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/**
 * Returns the team ID whose turn it is in the snake draft, based on
 * AppState.snakeOrder and AppState.snakePick. Returns null if order not set.
 * Snake alternates: odd rounds reverse order (picks 10→1).
 */
function currentSnakeTeam() {
    const order = AppState.snakeOrder;
    if (!order.length) return null;
    const n    = order.length;
    const pick = AppState.snakePick;
    const round = Math.floor(pick / n);
    const pos   = pick % n;
    const idx   = round % 2 === 0 ? pos : (n - 1 - pos);
    return order[idx] || null;
}

/** Returns all drafted picks. Sim picks (sim:true) live in the same map. */
function effectiveDrafted() {
    return AppState.drafted;
}
