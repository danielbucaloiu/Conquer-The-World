global.window = global; require('../data/world-data.js'); const E = require('../engine.js'); const w = E.build(window.WORLD_DATA), by = i => w.byIso[i];
const g = E.createGame(w, by('ESP'));
const top = () => ['USA', 'CHN', 'RUS', 'DEU', 'FRA', 'BRA', 'ITA'].filter(i => !g.conquered.has(by(i))).map(i => i + '=' + g.powerOf(by(i))).join(' ');
const take = d => { for (let k = w.pxStart[by(d)]; k < w.pxStart[by(d) + 1]; k++) g.setOwner(w.pxList[k], g.player); const add = g.conquer(by(d)); console.log(('+' + d).padEnd(5), 'aporta', String(add).padStart(2), '→ Poder', String(g.playerPower()).padStart(3), '| rearme +' + g.rearmPct() + '% |', top()); };
console.log('Inicio ESP', g.playerPower(), '|', top());
for (const d of ['PRT', 'AND', 'FRA']) take(d);
console.log('Poder de España tras 3 conquistas vs RUS:', g.playerPower(), 'vs', g.powerOf(by('RUS')));
for (const d of ['MCO', 'BEL', 'LUX', 'CHE', 'DEU', 'NLD', 'ITA', 'AUT', 'POL', 'CZE', 'DNK', 'SWE', 'NOR', 'FIN', 'UKR', 'BLR', 'TUR']) take(d);
console.log('Con 20 conquistas: Poder', g.playerPower(), 'vs RUS', g.powerOf(by('RUS')), 'USA', g.powerOf(by('USA')), 'CHN', g.powerOf(by('CHN')));
