/**
 * CSV Loading and Parsing logic for Mr. CheatSheet and generic projections.
 */

const DataLoader = {
    
    /**
     * Parses a Mr. CheatSheet CSV file (exported from the XLSM).
     * Handles the metadata rows and identifies hitter/pitcher sections.
     */
    async parseMrCheatSheet(csvText) {
        const lines = csvText.split(/\r?\n/);
        const players = [];
        
        // Find the header row (typically contains "Name" or "Tm")
        let headerIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(',Name,') || lines[i].includes('Name,Age,Tm')) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) {
            console.error("Could not find header row in CSV.");
            return [];
        }

        const headers = lines[headerIdx].split(',').map(h => h.trim());
        const dataRows = lines.slice(headerIdx + 1);

        dataRows.forEach((row, idx) => {
            const cols = this.splitCSVRow(row);
            if (cols.length < 5 || !cols[headers.indexOf('Name')]) return;

            const player = {
                id: `p-${idx}`, // temporary ID
                n: cols[headers.indexOf('Name')],
                t: cols[headers.indexOf('Tm')],
                pos: this.parsePositions(cols[headers.indexOf('Main Pos')], cols[headers.indexOf('Other Elig Pos')]),
                inj: cols[headers.indexOf('Note')] === 'Inj',
                age: parseInt(cols[headers.indexOf('Age')]) || 0,
                
                // Cheat Sheet Values (Site $)
                csValA: this.parseDollar(cols[headers.indexOf('Proj $ Value')]),
                csValS: this.parseDollar(cols[headers.indexOf('Site $ Value')]),

                // Raw Stats (used for our custom Z-scores if available)
                PA: 0, HR: 0, SB: 0, XBH: 0, OBP: 0, RP: 0,
                IP: 0, K: 0, W: 0, ERA: 0, SVH: 0, WHIP: 0
            };

            // Identify Hitter vs Pitcher based on columns
            const hrIdx = headers.indexOf('HR');
            const kIdx = headers.indexOf('K');

            if (hrIdx !== -1 && cols[hrIdx] !== '') {
                player.PA = 550; // default PA if missing
                player.HR = parseFloat(cols[hrIdx]) || 0;
                player.SB = parseFloat(cols[headers.indexOf('SB')]) || 0;
                player.XBH = parseFloat(cols[headers.indexOf('2B + 3B')]) || 0;
                player.OBP = parseFloat(cols[headers.indexOf('OBP')]) || 0;
                player.RP = parseFloat(cols[headers.indexOf('R + RBI - HR')]) || 0;
            } else if (kIdx !== -1 && cols[kIdx] !== '') {
                player.IP = 150; // default IP if missing
                player.K = parseFloat(cols[kIdx]) || 0;
                player.W = parseFloat(cols[headers.indexOf('W')]) || 0;
                player.ERA = parseFloat(cols[headers.indexOf('ERA')]) || 0;
                player.SVH = parseFloat(cols[headers.indexOf('Sv + Hld')]) || 0;
                player.WHIP = parseFloat(cols[headers.indexOf('WHIP')]) || 0;
            }

            players.push(player);
        });

        return players;
    },

    /**
     * Helper to split CSV line, respecting quoted commas.
     */
    splitCSVRow(row) {
        const result = [];
        let cur = '', inQuotes = false;
        for (let char of row) {
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
                result.push(cur.trim());
                cur = '';
            } else cur += char;
        }
        result.push(cur.trim());
        return result;
    },

    parsePositions(main, other) {
        const all = [main, other].filter(Boolean).join(',');
        return [...new Set(all.split(/[,/ ]+/).filter(p => p.length > 0 && p.length < 4))];
    },

    parseDollar(val) {
        if (!val) return 0;
        return parseInt(val.replace(/[$,]/g, '')) || 0;
    }
};
