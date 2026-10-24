global.window = global; require('../data/world-data.js'); const E = require('../engine.js');
let t0 = Date.now(); const w = E.build(window.WORLD_DATA); console.log('build ms', Date.now() - t0, 'W,H', w.W, w.H, 'N', w.N);
console.log('land pairs', w.report.landPairs, 'sea pairs', w.report.seaPairs, 'bridges', w.report.bridges);
const miss = w.countries.slice(1).filter(c => c.total < 1); console.log('países sin píxeles:', miss.length);
const small = w.countries.slice(1).sort((a, b) => a.total - b.total).slice(0, 8).map(c => c.id + ':' + c.total); console.log('menores', small.join(' '));
const P = w.countries.slice(1).map(c => c.id + '=' + c.power); const by = id => w.byIso[id];
console.log(['ESP', 'FRA', 'USA', 'CHN', 'DEU', 'ITA', 'PRT', 'TUV', 'VAT', 'RUS', 'BRA', 'MAR', 'AND'].map(i => i + '=' + w.countries[by(i)].power).join(' '));
const nm = i => w.countries[i].id; const nb = id => [...w.landNbr[by(id)]].map(nm).sort().join(','); const sb = id => [...w.seaNbr[by(id)]].map(nm).sort().join(',');
for (const id of ['ESP', 'DNK', 'JPN', 'GBR', 'AUS', 'TUV', 'ISL', 'CUB', 'ITA']) console.log(id, 'tierra:', nb(id), '| mar:', sb(id));
// empates naturales
const pw = {}; for (const c of w.countries.slice(1)) (pw[c.power] = pw[c.power] || []).push(c.id); console.log('empates ejemplo', Object.entries(pw).filter(([, v]) => v.length > 1).slice(0, 4).map(([k, v]) => k + ':' + v.join('/')).join('  '));

