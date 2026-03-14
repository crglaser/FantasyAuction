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
        
        // Split and filter out totally empty lines
        const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) {
            throw new Error(`CSV too short (${lines.length} lines)`);
        }

        const players = [];
        
        // Find the header row (Search for Name/Tm/Age in any row)
        let headerIdx = -1;
        for (let i = 0; i < Math.min(lines.length, 50); i++) {
            const row = lines[i].toLowerCase();
            // A reliable header row contains name, team, and a dollar sign or rank indicator
            if (row.includes('name') && (row.includes('tm') || row.includes('team')) && (row.includes('$') || row.includes('value') || row.includes('rank'))) {
                headerIdx = i;
                console.log(`[DataLoader] Found header row at line ${i+1}`);
                break;
            }
        }

        if (headerIdx === -1) {
            console.error(`[DataLoader] Failed to find header row in ${sourceName}. Dumping first 3 rows:`, lines.slice(0, 3));
            throw new Error("Could not find the 'Name' and 'Team' column headers in the CSV. Please ensure you are exporting from the Mr. CheatSheet XLSM correctly.");
        }

        const headers = this.splitCSVRow(lines[headerIdx]).map(h => h.trim().toLowerCase());
        console.log(`[DataLoader] Headers detected:`, headers);

        // Map column indices (case insensitive aliases)
        const getCol = (aliases) => {
            for (const alias of aliases) {
                const found = headers.indexOf(alias.toLowerCase());
                if (found !== -1) return found;
            }
            return -1;
        };

        const idx = {
            n: getCol(['name', 'player']),
            t: getCol(['tm', 'team']),
            pos: getCol(['main pos', 'pos', 'position']),
            otherPos: getCol(['other elig pos', 'other pos']),
            note: getCol(['note', 'status']),
            age: getCol(['age']),
            valA: getCol(['proj $ value', 'proj $', 'auction $']),
            valS: getCol(['site $ value', 'site $', 'season $']),
            hr: getCol(['hr', 'homers']),
            sb: getCol(['sb', 'stolen bases']),
            xbh: getCol(['2b + 3b', 'xbh', 'troubles', '2b+3b']),
            obp: getCol(['obp']),
            rp: getCol(['r + rbi - hr', 'rp', 'runs produced']),
            k: getCol(['k', 'so', 'strikeouts']),
            w: getCol(['w', 'wins']),
            era: getCol(['era']),
            svh: getCol(['sv + hld', 'svh', 'saves']),
            whip: getCol(['whip'])
        };

        if (idx.n === -1) {
            throw new Error("The 'Name' column is missing from the detected header row.");
        }

        const dataRows = lines.slice(headerIdx + 1);
        dataRows.forEach((row, rowNum) => {
            const cols = this.splitCSVRow(row);
            if (cols.length < 3 || !cols[idx.n]) return;

            const name = cols[idx.n].replace(/"/g, '').trim();
            const team = idx.t !== -1 ? cols[idx.t].trim() : 'FA';
            
            const player = {
                id: name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + '-' + team.toLowerCase(),
                n: name,
                t: team,
                pos: this.parsePositions(idx.pos !== -1 ? cols[idx.pos] : '', idx.otherPos !== -1 ? cols[idx.otherPos] : ''),
                inj: idx.note !== -1 && cols[idx.note].toLowerCase().includes('inj'),
                age: idx.age !== -1 ? parseInt(cols[idx.age]) || 0 : 0,
                
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
            
            // Determine base path (helps with GitHub Pages vs local)
            const basePath = window.location.pathname.includes('FantasyAuction') ? '/FantasyAuction/assets/' : 'assets/';
            
            console.log("[DataLoader] Attempting to load auction_values.csv...");
            const aucRes = await fetch('assets/auction_values.csv'); // Try relative first
            if (!aucRes.ok) throw new Error(`HTTP ${aucRes.status} for auction_values.csv`);
            const aucText = await aucRes.text();
            results.auction = await this.parseMrCheatSheet(aucText, "Auction Default");

            console.log("[DataLoader] Attempting to load season_values.csv...");
            const sznRes = await fetch('assets/season_values.csv');
            if (!sznRes.ok) throw new Error(`HTTP ${sznRes.status} for season_values.csv`);
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
            return []; // Fail silently but log to console
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
        // Strip everything but digits and dots
        const clean = val.replace(/[^0-9.]/g, '');
        return Math.round(parseFloat(clean)) || 0;
    }
};
