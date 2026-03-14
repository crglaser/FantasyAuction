/**
 * Live Assistant logic for conversational draft tracking and advice.
 */

const Assistant = {
    /**
     * Parses a text command like "Judge to me for 45" or "Soto to t3 50"
     * Supports Team Names and Owner names.
     */
    processCommand(text) {
        text = text.toLowerCase().trim();
        
        // Patterns:
        // [name] to [team/owner] [cost]
        const regex = /(.+)\s+(?:to\s+)?(me|t\d+|[\w\/\s&’]+)\s+(?:\$)?(\d+)/i;
        const match = text.match(regex);

        if (!match) return "Try: '[Player Name] to [Team/Owner] [Cost]' e.g. 'Judge to Teddy Ballgames 45'";

        const playerName = match[1].trim();
        let targetId = this.findTeamId(match[2].trim());
        const cost = parseInt(match[3]);

        if (!targetId) return `Could not find team/owner matching '${match[2]}'`;

        // Find player
        const player = AppState.players.find(p => p.n.toLowerCase().includes(playerName));
        if (!player) return `Could not find player matching '${playerName}'`;

        // Log the draft
        AppState.drafted[player.id] = {
            cost: cost,
            team: targetId,
            ts: Date.now()
        };

        StateManager.save();
        UI.render();

        const info = LG.teamsMap[targetId];
        return `Drafted **${player.n}** to **${info.team}** (${info.owner}) for **$${cost}**.`;
    },

    findTeamId(search) {
        search = search.toLowerCase();
        if (search === 'me' || search === 'my team') return 'me';
        
        // Check IDs
        if (LG.teamsMap[search]) return search;
        if (LG.teamsMap['t'+search]) return 't'+search;

        // Check Owner/Team names
        for (const [id, info] of Object.entries(LG.teamsMap)) {
            if (info.owner.toLowerCase().includes(search) || info.team.toLowerCase().includes(search)) {
                return id;
            }
        }
        return null;
    },

    /**
     * Provides quick strategic advice based on current state.
     */
    getQuickAdvice() {
        const myTeam = Object.entries(AppState.drafted)
            .filter(([, pick]) => pick.team === 'me')
            .map(([id]) => AppState.players.find(p => p.id === id))
            .filter(Boolean);

        if (!AppState.players.length) return "Data not loaded yet.";
        if (!myTeam.length) return "Draft is starting. Focus on high-Z hitters early.";

        const spent = myTeam.reduce((sum, p) => sum + (AppState.drafted[p.id]?.cost || 0), 0);
        const rem = LG.budget - spent;
        const pit = myTeam.filter(p => p.IP > 0);
        const projIP = pit.reduce((s, p) => s + (p.IP || 0), 0);

        let advice = [];
        if (rem < 20) advice.push("Budget is tight! Target $1 value guys.");
        if (projIP < 300 && myTeam.length > 5) advice.push("Prioritize SP floor (Innings).");
        
        const topValue = UI.getFilteredPlayers().filter(p => !AppState.drafted[p.id])[0];
        if (topValue) advice.push(`Top value available: ${topValue.n} ($${topValue.aValAdj}).`);

        return advice.join(' ') || "Stick to the plan.";
    }
};
