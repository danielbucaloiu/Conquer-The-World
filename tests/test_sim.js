const E = require('../engine.js'); global.window = global; require('../data/world-data.js');
const w = E.build(window.WORLD_DATA); const by = id => w.byIso[id];
function run(att, def, maxT, label, tweak) {
  const g = E.createGame(w, by(att)); if (tweak) tweak(g);
  const r = g.startInvasion(by(def)); if (!r.ok) return console.log(label, 'NO INICIA:', r.msg);
  const inv = g.invasion; let minF = 1, maxF = 0;
  while (inv.state === 'active' && inv.t < maxT) { inv.advance(1 / 30); const f = inv.progress; minF = Math.min(minF, f); maxF = Math.max(maxF, f); }
  console.log(label, att + '(' + g.playerPower() + ') → ' + def + '(' + w.countries[by(def)].power + ')', 'estado:', inv.state, 't=' + inv.t.toFixed(1) + 's', 'progreso final', (inv.progress * 100).toFixed(1) + '%', 'rango', (minF * 100).toFixed(0) + '-' + (maxF * 100).toFixed(0) + '%', 'frentes', inv.fronts, 'poder jugador', g.playerPower());
  return g;
}
const t0 = Date.now();
run('ESP', 'PRT', 900, 'T5 atacante fuerte  ');
run('ESP', 'AND', 900, 'T5b país pequeño     ');
run('ESP', 'FRA', 900, 'T6 defensor fuerte   ');
run('DEU', 'POL', 900, 'T5c grande vs medio  ');
run('USA', 'MEX', 900, 'T5d USA→México       ');
run('RUS', 'KAZ', 1200, 'T5e Rusia→Kazajistán ');
// empate exacto: igualar poderes de ESP y FRA
run('ESP', 'FRA', 1500, 'T7 EMPATE 1500s      ', () => { w.countries[by('FRA')].power = w.countries[by('ESP')].power; });
w.countries[by('FRA')].power = 65;
// cancelar y conservar
{ const g = E.createGame(w, by('ESP')); g.startInvasion(by('FRA')); const inv = g.invasion; inv.advance(30);
  const before = g.partial[by('FRA')]; const snap = Uint16Array.from(g.owner); g.cancelInvasion(); inv.advance(10);
  let same = true; for (let i = 0; i < snap.length; i++) if (snap[i] !== g.owner[i]) { same = false; break; }
  console.log('T9 cancelar: estado', inv.state, 'píxeles capturados', before, '→', g.partial[by('FRA')], 'mapa idéntico tras cancelar:', same, 'conquistado:', g.conquered.has(by('FRA')));
  // T10 nueva conexión: ¿hay objetivos nuevos?
  const a0 = new Set(g.invadables().map(i => w.countries[i].id)); console.log('invadibles con ESP parcial en FRA:', [...a0].join(','));
}
// conquista encadenada + poder exactamente una vez + highlight
{ const g = E.createGame(w, by('ESP')); const p0 = g.playerPower(); for (const d of ['PRT', 'AND']) { g.startInvasion(by(d)); const inv = g.invasion; while (inv.state === 'active' && inv.t < 900) inv.advance(1 / 30); console.log('conquista', d, inv.state, 'poder', g.playerPower()); }
  console.log('poder esperado', p0 + E.contribOf(w.countries[by('PRT')].power, 0, w.cfg) + E.contribOf(w.countries[by('AND')].power, 1, w.cfg), 'segunda invasión sobre PRT:', JSON.stringify(g.startInvasion(by('PRT'))));
  console.log('FRA invadible ahora?', !!g.availability(by('FRA')), 'MAR por mar?', JSON.stringify(g.availability(by('MAR')))); }
// no vecino
{ const g = E.createGame(w, by('ESP')); console.log('ESP→JPN:', JSON.stringify(g.startInvasion(by('JPN')))); }
// determinismo
{ const sig = () => { const g = E.createGame(w, by('ESP')); g.startInvasion(by('PRT')); g.invasion.advance(20); let h = 0; for (let i = 0; i < g.owner.length; i++) h = (h * 31 + g.owner[i]) | 0; return h; }; console.log('determinismo', sig() === sig()); }
console.log('total ms', Date.now() - t0);
