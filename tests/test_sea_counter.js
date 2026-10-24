global.window = global; require('../data/world-data.js'); const E = require('../engine.js'); const w = E.build(window.WORLD_DATA), by = i => w.byIso[i];
function run(att, def, maxT, label, tweak, every) {
  const g = E.createGame(w, by(att)); if (tweak) tweak(g); const r = g.startInvasion(by(def)); if (!r.ok) return console.log(label, 'NO INICIA', r.msg);
  const inv = g.invasion, snaps = []; let next = 0;
  while (inv.state === 'active' && inv.t < maxT) { inv.advance(1 / 30); if (inv.t >= next) { snaps.push(`${next}s:${(inv.progress * 100).toFixed(0)}%/pierdeEnE=${inv.lostOutside}/frente=${inv.front.length}`); next += every; } }
  console.log(label, att + '(' + g.playerPower() + ') → ' + def + '(' + g.powerOf(by(def)) + ')', 'estado', inv.state, 't=' + inv.t.toFixed(0) + 's | ' + snaps.join(' '));
  return g;
}
console.log('--- INVASIONES POR MAR (antes se congelaban) ---');
run('ESP', 'MAR', 600, 'ESP→MAR mar ', null, 20);
run('JPN', 'KOR', 600, 'JPN→KOR mar ', null, 30);
run('GBR', 'IRL', 600, 'GBR→IRL mar+tierra', null, 20);
run('AUS', 'NZL', 900, 'AUS→NZL mar ', null, 30);
run('CUB', 'HTI', 900, 'CUB→HTI mar ', null, 30);
console.log('--- DEFENSOR MÁS FUERTE: CONTRAATACA ---');
const g = run('ESP', 'FRA', 1500, 'ESP(60)→FRA(65 débil sesgo)', null, 150);
console.log('   país inicial perdido (derrota):', g.defeated, '| píxeles de España que conserva:', g.partial[by('ESP')], '/', w.countries[by('ESP')].total);
run('ITA', 'FRA', 400, 'ITA→FRA', null, 40);
console.log('--- EMPATE EXACTO ---');
const g2 = run('ESP', 'FRA', 1500, 'EMPATE', () => { w.countries[by('FRA')].power = w.countries[by('ESP')].power; }, 300);
console.log('   estado final', g2.invasion.state, '| derrota:', g2.defeated, '| conquistado:', g2.conquered.has(by('FRA')));
