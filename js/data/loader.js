/**
 * CSV Loading and Parsing logic for Mr. CheatSheet and generic projections.
 * Includes robust error handling and diagnostics.
 */

const DataLoader = {
    
    /**
     * Parses a Mr. CheatSheet CSV file (exported from the XLSM).
     */
    async parseMrCheatSheet(csvText, sourceName = "Unknown") {
        console.log(`[DataLoader] Parsing source: ${sourceName} (${csvText.length} bytes)`);
        
        const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length < 5) {
            throw new Error(`CSV too short (${lines.length} lines)`);
        }

        const players = [];
        
        // Find the header row (flexible matching)
        let headerIdx = -1;
        const targetHeaders = ['Name', 'Tm', 'Age', 'Main Pos', 'Proj $ Value'];
        
        for (let i = 0; i < lines.length; i++) {
            const row = lines[i].toLowerCase();
            if (row.includes('name') && row.includes('tm') && (row.includes('proj $') || row.includes('site $'))) {
                headerIdx = i;
                console.log(`[DataLoader] Found header at line ${i+1}`);
                break;
            }
        }

        if (headerIdx === -1) {
            console.warn(`[DataLoader] Warning: Could not find exact header row. Trying row 11 as fallback.`);
            headerIdx = 10; // 0-based index for row 11
        }

        const headers = this.splitCSVRow(lines[headerIdx]).map(h => h.trim());
        console.log(`[DataLoader] Headers detected:`, headers);

        // Map column indices (case insensitive)
        const getCol = (names) => {
            for (const name of names) {
                const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
                if (idx !== -1) return idx;
            }
            return -1;
        };

        const idx = {
            n: getCol(['Name']),
            t: getCol(['Tm', 'Team']),
            pos: getCol(['Main Pos']),
            otherPos: getCol(['Other Elig Pos']),
            note: getCol(['Note']),
            age: getCol(['Age']),
            valA: getCol(['Proj $ Value', 'Proj $']),
            valS: getCol(['Site $ Value', 'Site $']),
            hr: getCol(['HR']),
            sb: getCol(['SB']),
            xbh: getCol(['2B + 3B', 'XBH', 'Troubles']),
            obp: getCol(['OBP']),
            rp: getCol(['R + RBI - HR', 'RP']),
            k: getCol(['K']),
            w: getCol(['W']),
            era: getCol(['ERA']),
            svh: getCol(['Sv + Hld', 'SVH']),
            whip: getCol(['WHIP'])
        };

        console.log(`[DataLoader] Column Mapping:`, idx);

        if (idx.n === -1) {
            throw new Error("Missing critical 'Name' column in CSV");
        }

        const dataRows = lines.slice(headerIdx + 1);
        dataRows.forEach((row, rowNum) => {
            const cols = this.splitCSVRow(row);
            if (cols.length < 3 || !cols[idx.n]) return;

            const name = cols[idx.n];
            const team = idx.t !== -1 ? cols[idx.t] : 'FA';
            
            const player = {
                id: name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '-' + team.toLowerCase(),
                n: name,
                t: team,
                pos: this.parsePositions(cols[idx.pos], cols[idx.otherPos]),
                inj: idx.note !== -1 && cols[idx.note] === 'Inj',
                age: idx.age !== -1 ? parseInt(cols[idx.age]) : 0,
                
                csValA: idx.valA !== -1 ? this.parseDollar(cols[idx.valA]) : 0,
                csValS: idx.valS !== -1 ? this.parseDollar(cols[idx.valS]) : 0,

                PA: 0, HR: 0, SB: 0, XBH: 0, OBP: 0, RP: 0,
                IP: 0, K: 0, W: 0, ERA: 0, SVH: 0, WHIP: 0
            };

            // Hitter stats
            if (idx.hr !== -1 && cols[idx.hr] !== '') {
                player.PA = 550;
                player.HR = parseFloat(cols[idx.hr]) || 0;
                player.SB = idx.sb !== -1 ? parseFloat(cols[idx.sb]) || 0 : 0;
                player.XBH = idx.xbh !== -1 ? parseFloat(cols[idx.xbh]) || 0 : 0;
                player.OBP = idx.obp !== -1 ? parseFloat(cols[idx.obp]) || 0 : 0;
                player.RP = idx.rp !== -1 ? parseFloat(cols[idx.rp]) || 0 : 0;
            } 
            // Pitcher stats
            else if (idx.k !== -1 && cols[idx.k] !== '') {
                player.IP = 150;
                player.K = parseFloat(cols[idx.k]) || 0;
                player.W = idx.w !== -1 ? parseFloat(cols[idx.w]) || 0 : 0;
                player.ERA = idx.era !== -1 ? parseFloat(cols[idx.era]) || 0 : 0;
                player.SVH = idx.svh !== -1 ? parseFloat(cols[idx.svh]) || 0 : 0;
                player.WHIP = idx.whip !== -1 ? parseFloat(cols[idx.whip]) || 0 : 0;
            }

            players.push(player);
        });

        console.log(`[DataLoader] Successfully parsed ${players.length} players from ${sourceName}`);
        return players;
    },

    /**
     * Loads default CSVs with robust path handling.
     */
    async loadDefaultData() {
        try {
            const results = { auction: [], season: [] };
            
            console.log("[DataLoader] Attempting to load auction_values.csv...");
            const aucRes = await fetch('assets/auction_values.csv');
            if (!aucRes.ok) throw new Error(`HTTP error! status: ${aucRes.status} for auction_values.csv`);
            const aucText = await aucRes.text();
            results.auction = await this.parseMrCheatSheet(aucText, "Auction Default");

            console.log("[DataLoader] Attempting to load season_values.csv...");
            const sznRes = await fetch('assets/season_values.csv');
            if (!sznRes.ok) throw new Error(`HTTP error! status: ${sznRes.status} for season_values.csv`);
            const sznText = await sznRes.text();
            results.season = await this.parseMrCheatSheet(sznText, "Season Default");

            // Merge Logic
            if (results.auction.length > 0) {
                results.auction.forEach(p => {
                    const sp = results.season.find(s => s.id === p.id);
                    if (sp) {
                        p.csValS = sp.csValA || sp.csValS;
                        if (sp.PA > 0 && p.PA === 0) {
                            ['PA', 'HR', 'SB', 'XBH', 'OBP', 'RP'].forEach(k => p[k] = sp[k]);
                        }
                        if (sp.IP > 0 && p.IP === 0) {
                            ['IP', 'K', 'W', 'ERA', 'SVH', 'WHIP'].forEach(k => p[k] = sp[k]);
                        }
                    }
                });
                return results.auction;
            }
            return [];
        } catch (e) {
            console.error("[DataLoader] CRITICAL ERROR:", e);
            alert(`Error loading default data: ${e.message}`);
            return [];
        }
    },

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
        return Math.abs(parseInt(val.replace(/[$,]/g, ''))) || 0;
    }
};
