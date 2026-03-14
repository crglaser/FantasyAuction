/**
 * Live Assistant logic for conversational draft tracking and advice.
 */

const Assistant = {
    /**
     * Parses a text command like "Judge to me for 45" or "Soto to t3 50"
     */
    processCommand(text) {
        text = text.toLowerCase().trim();
        
        // Patterns:
        // [name] to [team] [cost]
        // [name] [team] [cost]
        const regex = /(.+)\s+(?:to\s+)?(me|t\d|opponent\s+\d)\s+(?:\$)?(\d+)/i;
        const match = text.match(regex);

        if (!match) return "Try: '[Name] to [Team] [Cost]' e.g. 'Judge to me 45'";

        const playerName = match[1].trim();
        let teamCode = match[2].trim();
        const cost = parseInt(match[3]);

        // Normalize team code
        if (teamCode.startsWith('opponent')) {
            teamCode = 't' + teamCode.split(' ').pop();
        }

        // Find player
        const player = AppState.players.find(p => p.n.toLowerCase().includes(playerName));
        if (!player) return `Could not find player matching '${playerName}'`;

        // Log the draft
        AppState.drafted[player.id] = {
            cost: cost,
            team: teamCode,
            ts: Date.now()
        };

        StateManager.save();
        UI.render();

        return `Drafted **${player.n}** to **${LG.teamNames[teamCode]}** for **$${cost}**.`;
    },

    /**
     * Provides quick strategic advice based on current state.
     */
    getQuickAdvice() {
        const myTeam = Object.entries(AppState.drafted)
            .filter(([, pick]) => pick.team === 'me')
            .map(([id]) => AppState.players.find(p => p.id === id))
            .filter(Boolean);

        if (!myTeam.length) return "Draft hasn't started yet. Focus on elite high-Z hitters early.";

        const spent = myTeam.reduce((sum, p) => sum + (AppState.drafted[p.id]?.cost || 0), 0);
        const rem = LG.budget - spent;
        const pit = myTeam.filter(p => p.IP > 0);
        const projIP = pit.reduce((s, p) => s + (p.IP || 0), 0);

        let advice = [];
        if (rem < 20) advice.push("Budget is tight! Target $1 value guys and high-upside snake picks.");
        if (projIP < 300 && myTeam.length > 5) advice.push("Lagging in IP. Prioritize some SP floor soon.");
        
        // Find best undrafted value
        const topValue = UI.getFilteredPlayers().filter(p => !AppState.drafted[p.id])[0];
        if (topValue) advice.push(`Top value available: ${topValue.n} ($${topValue.aValAdj}).`);

        return advice.join(' ') || "Keep sticking to the Z-score board.";
    }
};
