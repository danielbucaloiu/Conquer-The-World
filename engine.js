/* ============================================================================
 * engine.js — lógica pura (sin DOM): mapa raster, adyacencias, Poder y batalla.
 *
 * Idea central: la GEOMETRÍA real (polígonos GeoJSON proyectados con Natural Earth) se
 * rasteriza UNA sola vez en `ident` (qué país es cada píxel; nunca cambia). El estado
 * político vive aparte en `owner` (quién controla cada píxel). Las invasiones solo
 * cambian `owner`, así que la silueta nunca se destruye y cancelar conserva el estado.
 * ========================================================================== */
(function (root) {
  'use strict';

  const CFG = {
    W: 1600,              // resolución interna del mapa (píxeles de anchura)
    MIN_PX: 7,            // píxeles mínimos por país (Vaticano, Mónaco, Nauru...) para que sea seleccionable
    SEA_MAX_PX: 13,       // alcance marítimo máximo (~280 km con W=1600)
    SEA_EXTRA: [['ISL', 'DNK'], ['ISL', 'GBR'], ['JPN', 'KOR'], ['AUS', 'IDN'], ['AUS', 'PNG'], ['AUS', 'NZL'], ['LKA', 'IND'], ['CUB', 'USA'], ['CUB', 'MEX'], ['MDG', 'MOZ'], ['MUS', 'MDG'], ['CYP', 'TUR'], ['CYP', 'SYR'], ['CYP', 'LBN']],
    SEA_BLOCK: [],        // pares prohibidos, p. ej. ['ESP','ITA']
    SEA_BRIDGE_MAX_PX: 140, // último recurso: islas aisladas se enlazan con el vecino más cercano
    STEP_DT: 1 / 30,      // paso fijo de simulación (s): la batalla NO depende de los fps
    BASE_RATE: 0.12,      // probabilidad base de conversión de un píxel de frente por paso
    NOISE_SCALE: 0.05,    // tamaño de los "sectores" del frente
    NOISE_SPEED: 0.15,
    LOCAL_SWING: 0.35,    // cuánto varía localmente la presión (salientes y retrocesos)
    P_SPAN: 0.42,         // cuánto pesa la diferencia de Poder en la tendencia global
    REL_GAIN: 3.0,
    P_MAX: 0.9,
    TIE_CAP: 0.7, TIE_FLOOR: 0.06, // en empate el atacante nunca pasa de 70 % ni cae de 6 %
    T_SOFT: 100, T_ESC: 100, ESC_MAX: 0.3, // si dura demasiado, la tendencia se acentúa (solo si hay diferencia)
    LAND_P: 0.12,         // prob. de desembarco por muestra de costa cada 10 pasos (invasiones por mar)
    FRONT_BONUS: 0.035, FRONT_BONUS_MAX: 0.15, // presión extra por frente adicional (configurable)
    // --- Poder del jugador y "rearme mundial" (equilibrio de poder) ---
    CONTRIB_K: 0.30,      // aportación de un país conquistado = K x su Poder base ...
    CONTRIB_DECAY: 0.90,  // ... x DECAY^(conquistas previas): rendimientos decrecientes (cuesta gestionar un imperio)
    REARM_MAX: 1.4,       // los países independientes pueden llegar a multiplicar su Poder hasta (1 + REARM_MAX)
    REARM_H: 60           // amenaza t = crecimiento/(crecimiento + H): sube rápido al principio y satura
  };

  // ---------- utilidades ----------
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash3(x, y, z, s) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; }
  function noise3(x, y, z, s) { // value noise suave 3D en [0,1]
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let fx = x - xi, fy = y - yi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), fx), l(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), fx), fy),
      l(l(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), fx), l(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), fx), fy), fz);
  }
  function naturalEarth(lon, lat) { // proyección Natural Earth (Šavrič et al. 2015)
    const l = lon * Math.PI / 180, p = lat * Math.PI / 180, p2 = p * p, p4 = p2 * p2;
    return [l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
      -p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))];
  }

  // ---------- Poder inicial (determinista) ----------
  // score = 0.30·pob + 0.35·PIB + 0.15·área + 0.10·PIB per cápita + 0.10·equilibrio, todo en log10 y
  // normalizado a [0,1] (ninguna variable domina). "equilibrio" = media de las demás: suaviza extremos.
  // Poder = 4 + 96·score². Los datos de población/PIB son aproximaciones redondeadas (ver build_data.py).
  function computePowers(cs) {
    const f = {
      pop: cs.map(c => Math.log10(c.pop * 1e6)), gdp: cs.map(c => Math.log10(c.gdp * 1e9)),
      area: cs.map(c => Math.log10(Math.max(c.area, 1))), pc: cs.map(c => Math.log10(c.gdp * 1e9 / (c.pop * 1e6)))
    };
    const nz = a => { const lo = Math.min(...a), hi = Math.max(...a); return a.map(v => (v - lo) / (hi - lo)); };
    const n = { pop: nz(f.pop), gdp: nz(f.gdp), area: nz(f.area), pc: nz(f.pc) };
    return cs.map((_, i) => {
      const base = .30 * n.pop[i] + .35 * n.gdp[i] + .15 * n.area[i] + .10 * n.pc[i];
      const score = base / .90 * .9 + .10 * ((n.pop[i] + n.gdp[i] + n.area[i] + n.pc[i]) / 4);
      return Math.round(4 + 96 * Math.pow(Math.min(1, score), 2));
    });
  }
  // k = nº de conquistas previas. Se calcula UNA vez al conquistar y se guarda (nunca se suma dos veces).
  const contribOf = (P, k, cfg) => { cfg = cfg || CFG; return Math.max(1, Math.round(cfg.CONTRIB_K * P * Math.pow(cfg.CONTRIB_DECAY, k || 0))); };

  // ---------- construcción del mundo ----------
  function build(data, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const W = cfg.W, list = data.countries.slice().sort((a, b) => a.id < b.id ? -1 : 1);
    const N = list.length;
    const byIso = {}; list.forEach((c, i) => { c.idx = i + 1; byIso[c.id] = c.idx; });
    const power = [0].concat(computePowers(list));
    // proyección y ajuste al lienzo
    const proj = list.map(c => c.rings.map(r => r.map(p => naturalEarth(p[0], p[1]))));
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (const cr of proj) for (const r of cr) for (const p of r) { if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; }
    const pad = 6, scale = (W - 2 * pad) / (mxx - mnx), H = Math.ceil((mxy - mny) * scale + 2 * pad);
    const kmPerPx = 7325 / scale;
    const px = proj.map(cr => cr.map(r => { const a = new Float32Array(r.length * 2); r.forEach((p, k) => { a[2 * k] = (p[0] - mnx) * scale + pad; a[2 * k + 1] = (p[1] - mny) * scale + pad; }); return a; }));
    // 1) rasterizado por scanline (even-odd; países grandes primero para que enclaves pequeños queden encima)
    const ident = new Uint16Array(W * H);
    const order = list.map((_, i) => i).sort((a, b) => list[b].area - list[a].area);
    for (const i of order) fillCountry(ident, W, H, i + 1, px[i]);
    // 2) mínimo de píxeles para países diminutos
    const cnt = new Int32Array(N + 2); for (let i = 0; i < ident.length; i++) cnt[ident[i]]++;
    for (let c = 1; c <= N; c++) {
      if (cnt[c] >= cfg.MIN_PX) continue;
      let sx = 0, sy = 0, n = 0; for (const r of px[c - 1]) for (let k = 0; k < r.length; k += 2) { sx += r[k]; sy += r[k + 1]; n++; }
      const cx = sx / n, cy = sy / n, cand = [];
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; cand.push([(x + .5 - cx) ** 2 + (y + .5 - cy) ** 2, y * W + x]); }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, i] of cand) { if (cnt[c] >= cfg.MIN_PX) break; const o = ident[i]; if (o === c || (o && cnt[o] <= cfg.MIN_PX)) continue; if (o) cnt[o]--; ident[i] = c; cnt[c]++; }
    }
    // 3) componentes conexas (islas) + centroides/etiquetas
    const comp = new Int32Array(W * H), compIdent = [0], compCount = [0], compSx = [0], compSy = [0], compFirst = [0];
    const stack = new Int32Array(W * H);
    for (let s = 0; s < ident.length; s++) {
      if (!ident[s] || comp[s]) continue;
      const id = compIdent.length; let sp = 0, n = 0, sx = 0, sy = 0; stack[sp++] = s; comp[s] = id;
      while (sp) {
        const i = stack[--sp], x = i % W, y = (i - x) / W; n++; sx += x; sy += y;
        if (x > 0 && !comp[i - 1] && ident[i - 1] === ident[s]) { comp[i - 1] = id; stack[sp++] = i - 1; }
        if (x < W - 1 && !comp[i + 1] && ident[i + 1] === ident[s]) { comp[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && !comp[i - W] && ident[i - W] === ident[s]) { comp[i - W] = id; stack[sp++] = i - W; }
        if (y < H - 1 && !comp[i + W] && ident[i + W] === ident[s]) { comp[i + W] = id; stack[sp++] = i + W; }
      }
      compIdent.push(ident[s]); compCount.push(n); compSx.push(sx / n); compSy.push(sy / n); compFirst.push(s);
    }
    const compsOf = Array.from({ length: N + 1 }, () => []);
    for (let c = 1; c < compIdent.length; c++) compsOf[compIdent[c]].push(c);
    const countries = [null];
    for (const c of list) {
      const cs = compsOf[c.idx].slice().sort((a, b) => compCount[b] - compCount[a]), m = cs[0];
      let lx = Math.round(compSx[m]), ly = Math.round(compSy[m]);
      if (ident[ly * W + lx] !== c.idx) { const f = compFirst[m]; lx = f % W; ly = (f - lx) / W; }
      countries.push({ idx: c.idx, id: c.id, name: c.name, pop: c.pop, gdp: c.gdp, area: c.area, power: power[c.idx], total: cnt[c.idx], comps: cs, labelX: lx + .5, labelY: ly + .5, mainCount: compCount[m] });
    }
    // lista de píxeles por país (counting sort)
    const start = new Int32Array(N + 2); for (let i = 0; i < ident.length; i++) if (ident[i]) start[ident[i] + 1]++;
    for (let c = 1; c <= N + 1; c++) start[c] += start[c - 1];
    const fillp = start.slice(), pxList = new Int32Array(start[N + 1]);
    for (let i = 0; i < ident.length; i++) if (ident[i]) pxList[fillp[ident[i]]++] = i;
    // 4) adyacencia terrestre: pares de píxeles 4-vecinos de países distintos
    const KEY = 1024, land = new Map(), landNbr = Array.from({ length: N + 1 }, () => new Set());
    const addLand = (i, j) => {
      const a = ident[i], b = ident[j]; if (!a || !b || a === b) return;
      const k = a < b ? a * KEY + b : b * KEY + a; let e = land.get(k); if (!e) land.set(k, e = { lo: [], hi: [] });
      if (a < b) { e.lo.push(i); e.hi.push(j); } else { e.lo.push(j); e.hi.push(i); }
      landNbr[a].add(b); landNbr[b].add(a);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x < W - 1) addLand(i, i + 1); if (y < H - 1) addLand(i, i + W); }
    // 5) adyacencia marítima: regla geométrica (costas a ≤ SEA_MAX_PX con línea de visión sobre mar) + lista explícita
    const sea = new Map(), seaNbr = Array.from({ length: N + 1 }, () => new Set()), blocked = new Set();
    const pk = (a, b) => a < b ? a * KEY + b : b * KEY + a;
    for (const [a, b] of cfg.SEA_BLOCK) blocked.add(pk(byIso[a], byIso[b]));
    const coast = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!ident[i]) continue; if ((x > 0 && !ident[i - 1]) || (x < W - 1 && !ident[i + 1]) || (y > 0 && !ident[i - W]) || (y < H - 1 && !ident[i + W]) || x === 0 || y === 0 || x === W - 1 || y === H - 1) coast.push(i); }
    const R = cfg.SEA_MAX_PX, R2 = R * R, cells = new Map();
    for (const i of coast) { const x = i % W, y = (i - x) / W; if ((x + y) & 1) continue; const k = (y / R | 0) * 4096 + (x / R | 0); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(i); }
    const cand = new Map();
    const clear = (i, j, a, b) => { // la recta i→j solo cruza mar (o los dos países)
      const x0 = i % W, y0 = (i - x0) / W, x1 = j % W, y1 = (j - x1) / W, n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 1; s < n; s++) { const id = ident[Math.round(y0 + (y1 - y0) * s / n) * W + Math.round(x0 + (x1 - x0) * s / n)]; if (id && id !== a && id !== b) return false; }
      return true;
    };
    for (const [, arr] of cells) for (const i of arr) {
      const x = i % W, y = (i - x) / W, cx = x / R | 0, cy = y / R | 0, a = ident[i];
      for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) {
        const o = cells.get((cy + ddy) * 4096 + cx + ddx); if (!o) continue;
        for (const j of o) {
          const b = ident[j]; if (b <= a) continue; const k = a * KEY + b; if (land.has(k) || blocked.has(k)) continue;
          const jx = j % W, jy = (j - jx) / W, d2 = (jx - x) ** 2 + (jy - y) ** 2; if (d2 > R2 || !clear(i, j, a, b)) continue;
          let c = cand.get(k); if (!c) cand.set(k, c = []); c.push([d2, i, j]);
        }
      }
    }
    const addSea = (a, b, samples) => { // samples: [[d2, pa, pb], ...] con pa∈a<b∋pb
      samples.sort((p, q) => p[0] - q[0]); const keep = [];
      for (const s of samples) { if (keep.length >= 14) break; const sx = s[1] % W, sy = (s[1] - sx) / W; if (keep.every(t => { const tx = t[1] % W, ty = (t[1] - tx) / W; return (tx - sx) ** 2 + (ty - sy) ** 2 >= 36; })) keep.push(s); }
      sea.set(pk(a, b), { lo: keep.map(s => s[1]), hi: keep.map(s => s[2]), d: Math.sqrt(keep[0][0]) }); seaNbr[a].add(b); seaNbr[b].add(a);
    };
    for (const [k, v] of cand) addSea(Math.floor(k / KEY), k % KEY, v);
    const closest = (a, b, stride) => { // par de costas más cercano entre dos países (sin límite)
      const ca = coast.filter(i => ident[i] === a).filter((_, n) => n % stride === 0), cb = coast.filter(i => ident[i] === b).filter((_, n) => n % stride === 0);
      let best = null; for (const i of ca) { const x = i % W, y = (i - x) / W; for (const j of cb) { const jx = j % W, d2 = (jx - x) ** 2 + ((j - jx) / W - y) ** 2; if (!best || d2 < best[0]) best = [d2, i, j]; } }
      return best;
    };
    const addPair = (a, b, bests) => { if (a > b) { bests = bests.map(s => [s[0], s[2], s[1]]); [a, b] = [b, a]; } if (sea.has(pk(a, b))) return; addSea(a, b, bests); };
    for (const [A, B] of cfg.SEA_EXTRA) { const a = byIso[A], b = byIso[B]; if (!a || !b || land.has(pk(a, b)) || blocked.has(pk(a, b))) continue; const s = closest(a, b, 1); if (s) addPair(a, b, [s]); }
    // 6) conectividad global: enlaza de "último recurso" las islas aisladas con el país más cercano
    const bridges = [];
    for (let guard = 0; guard < 60; guard++) {
      const seen = new Uint8Array(N + 1), comps = [];
      for (let s = 1; s <= N; s++) { if (seen[s]) continue; const q = [s], g = []; seen[s] = 1; while (q.length) { const u = q.pop(); g.push(u); for (const v of landNbr[u]) if (!seen[v]) { seen[v] = 1; q.push(v); } for (const v of seaNbr[u]) if (!seen[v]) { seen[v] = 1; q.push(v); } } comps.push(g); }
      if (comps.length === 1) break;
      comps.sort((a, b) => a.length - b.length); const small = comps[0], inSmall = new Set(small); let best = null;
      for (const a of small) for (let b = 1; b <= N; b++) { if (inSmall.has(b)) continue; const s = closest(a, b, 3); if (s && (!best || s[0] < best[1][0])) best = [[a, b], s]; }
      if (!best || Math.sqrt(best[1][0]) > cfg.SEA_BRIDGE_MAX_PX) break;
      addPair(best[0][0], best[0][1], [best[1]]); bridges.push(countries[best[0][0]].id + '–' + countries[best[0][1]].id + ' (' + Math.round(Math.sqrt(best[1][0]) * kmPerPx) + ' km)');
    }
    // 7) colores de los países independientes: coloreado voraz sobre el grafo terrestre (vecinos distintos)
    const NCOL = 8, colorOf = new Uint8Array(N + 1), ordc = countries.slice(1).sort((a, b) => landNbr[b.idx].size - landNbr[a.idx].size);
    for (const c of ordc) { const used = new Set(); for (const n of landNbr[c.idx]) if (colorOf[n] !== undefined && n !== c.idx && colorOf[n] > 0) used.add(colorOf[n] - 1); let k = 0; while (used.has(k) && k < NCOL - 1) k++; colorOf[c.idx] = k + 1; }
    for (let c = 1; c <= N; c++) colorOf[c]--;
    return { W, H, N, kmPerPx, cfg, ident, comp, compCount, compFirst, compIdent, compsOf: compsOf, countries, byIso, pxStart: start, pxList, land, landNbr, sea, seaNbr, colorOf, bridges, report: { landPairs: land.size, seaPairs: sea.size, bridges, meta: data.meta } };
  }

  function fillCountry(ident, W, H, id, rings) {
    let ymin = 1e9, ymax = -1e9;
    for (const r of rings) for (let k = 1; k < r.length; k += 2) { if (r[k] < ymin) ymin = r[k]; if (r[k] > ymax) ymax = r[k]; }
    const y0 = Math.max(0, Math.ceil(ymin - .5)), y1 = Math.min(H - 1, Math.floor(ymax - .5)); if (y1 < y0) return;
    const rows = new Array(y1 - y0 + 1);
    for (const r of rings) {
      const n = r.length / 2;
      for (let j = 0; j < n; j++) {
        let ax = r[2 * j], ay = r[2 * j + 1], bx = r[2 * ((j + 1) % n)], by = r[2 * ((j + 1) % n) + 1];
        if (ay === by) continue; if (ay > by) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }
        const ys = Math.max(y0, Math.ceil(ay - .5)), ye = Math.min(y1, Math.ceil(by - .5) - 1), sl = (bx - ax) / (by - ay);
        for (let y = ys; y <= ye; y++) (rows[y - y0] || (rows[y - y0] = [])).push(ax + (y + .5 - ay) * sl);
      }
    }
    for (let y = y0; y <= y1; y++) {
      const xs = rows[y - y0]; if (!xs) continue; xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.max(0, Math.ceil(xs[k] - .5)), xb = Math.min(W - 1, Math.ceil(xs[k + 1] - .5) - 1); for (let x = xa; x <= xb; x++) ident[y * W + x] = id; }
    }
  }

  // ---------- partida ----------
  function createGame(world, playerIdx) {
    const { W, H, ident, countries } = world, N = world.N, cfg = world.cfg;
    const owner = Uint16Array.from(ident), partial = new Int32Array(N + 1), compCap = new Int32Array(world.compCount.length), own = new Int32Array(N + 1);
    for (let i = 0; i < owner.length; i++) if (owner[i]) own[owner[i]]++; // own[o] = píxeles que controla hoy el país o (cualquiera sea su origen)
    for (let c = 1; c <= N; c++) partial[c] = 0;
    for (let i = 0; i < ident.length; i++) if (ident[i] === playerIdx) { partial[playerIdx]++; compCap[world.comp[i]]++; }
    const g = {
      world, player: playerIdx, owner, partial, own, compCap, alive: N - 1, defeated: false, lost: false, conquered: new Set(), conqList: [], growth: 0, trackD: 0, compD: new Int32Array(world.compCount.length), dirty: [], speed: 1, invasion: null, invCount: 0, won: false,
      fflag: new Uint8Array(W * H),
      /** Estado guardable (JSON). El control se codifica como tramos [inicio, largo, dueño] donde owner ≠ ident. Una invasión activa no se guarda: al cargar equivale a cancelarla. */
      serialize() {
        const runs = []; let i = 0; const n = owner.length;
        while (i < n) {
          if (owner[i] === ident[i]) { i++; continue; }
          const o = owner[i], s = i; while (i < n && owner[i] === o && ident[i] !== o) i++;
          runs.push(s, i - s, o);
        }
        return { v: 1, player: playerIdx, runs, conqList: this.conqList, invCount: this.invCount, speed: this.speed };
      },
      /** Poder del jugador = Poder base de su país + aportaciones guardadas de cada conquista. */
      playerPower() { return countries[playerIdx].power + this.growth; },
      /** Amenaza mundial t∈[0,1): cuanto más crece el imperio, más se rearman los demás (alianzas defensivas). */
      threat() { return this.growth / (this.growth + cfg.REARM_H); },
      rearmPct() { return Math.round(cfg.REARM_MAX * this.threat() * 100); },
      /** Poder efectivo de un país independiente = base x (1 + REARM_MAX·t). Entero y determinista. */
      powerOf(c) { return c === playerIdx ? this.playerPower() : Math.round(countries[c].power * (1 + cfg.REARM_MAX * this.threat())); },
      conquer(D) { if (this.conquered.has(D)) return 0; const add = contribOf(countries[D].power, this.conqList.length, cfg); this.conquered.add(D); this.conqList.push([D, add]); this.growth += add; return add; },
      /** Si el defensor te arrebata más de la mitad de un país conquistado, deja de contar como tuyo (y su aportación de Poder se pierde). */
      revoke(c) { const k = this.conqList.findIndex(x => x[0] === c); if (k < 0) return; this.growth -= this.conqList[k][1]; this.conqList.splice(k, 1); this.conquered.delete(c); },
      isFull(c) { return partial[c] === countries[c].total; },
      /** Único punto donde cambia el control de un píxel: mantiene contadores, conquistas y derrota. */
      setOwner(i, o) {
        const old = owner[i]; if (old === o) return; const id = ident[i];
        if (old === playerIdx) { partial[id]--; compCap[world.comp[i]]--; } if (o === playerIdx) { partial[id]++; compCap[world.comp[i]]++; }
        own[old]--; own[o]++; owner[i] = o; this.dirty.push(i);
        if (this.trackD) { if (old === this.trackD) this.compD[world.comp[i]]--; if (o === this.trackD) this.compD[world.comp[i]]++; } // píxeles del defensor por isla
        if (own[old] === 0 && old !== playerIdx) this.alive--; // un país sin ningún píxel ha dejado de existir
        if (old === playerIdx) {
          if (this.conquered.has(id) && partial[id] * 2 < countries[id].total) this.revoke(id);
          if (id === playerIdx && partial[id] === 0) this.defeated = true; // cae el país inicial: derrota
        }
      },
      stateOf(c) { if (c === playerIdx || this.conquered.has(c)) return 'propio'; if (partial[c] > 0) return 'parcial'; return 'independiente'; },
      /** Píxeles que D controla fuera de su propio territorio (zonas que ha arrebatado en contraataques). */
      foreignOf(D) { return own[D] - (countries[D].total - partial[D]); },
      /** ¿Se puede invadir D desde el territorio realmente controlado? Devuelve {land,sea,partial} o null. */
      availability(D) {
        if (D === playerIdx || own[D] === 0) return null;
        const r = { land: false, sea: false, partial: partial[D] > 0 };
        const test = (map, E) => { const e = map.get(E < D ? E * 1024 + D : D * 1024 + E); if (!e) return false; const A = E < D ? e.lo : e.hi, B = E < D ? e.hi : e.lo; for (let k = 0; k < A.length; k++) if (owner[A[k]] === playerIdx && owner[B[k]] === D) return true; return false; };
        for (const E of world.landNbr[D]) { if (partial[E] > 0 && test(world.land, E)) { r.land = true; break; } }
        for (const E of world.seaNbr[D]) { if (partial[E] > 0 && test(world.sea, E)) { r.sea = true; break; } }
        if (!r.land && !r.partial && this.foreignOf(D) > 0) { // D se ha expandido sobre tu territorio: puede haber contacto fuera de las listas estáticas
          for (let i = 0; i < owner.length; i++) if (owner[i] === D && ident[i] !== D && this.touches(i, playerIdx)) { r.land = true; break; }
        }
        return (r.land || r.sea || r.partial) ? r : null;
      },
      touches(i, o) { const x = i % W; return (x > 0 && owner[i - 1] === o) || (x < W - 1 && owner[i + 1] === o) || (i >= W && owner[i - W] === o) || (i < W * (H - 1) && owner[i + W] === o); },
      invadables() { const out = []; for (let c = 1; c <= N; c++) if (this.availability(c)) out.push(c); return out; },
      /** Contactos actuales atacante→defensor. Escanea los píxeles de D: refleja el territorio REAL controlado. */
      contacts(D) {
        const pairs = [], src = new Set(), s0 = world.pxStart[D], s1 = world.pxStart[D + 1];
        const scan = i => {
          const x = i % W;
          if (x > 0 && owner[i - 1] === playerIdx) { pairs.push([i - 1, i]); src.add(ident[i - 1]); }
          if (x < W - 1 && owner[i + 1] === playerIdx) { pairs.push([i + 1, i]); src.add(ident[i + 1]); }
          if (i >= W && owner[i - W] === playerIdx) { pairs.push([i - W, i]); src.add(ident[i - W]); }
          if (i < W * (H - 1) && owner[i + W] === playerIdx) { pairs.push([i + W, i]); src.add(ident[i + W]); }
        };
        if (this.foreignOf(D) > 0) { for (let i = 0; i < owner.length; i++) if (owner[i] === D) scan(i); } // incluye lo arrebatado
        else for (let k = s0; k < s1; k++) { const i = world.pxList[k]; if (owner[i] === D) scan(i); }
        const seaPairs = [];
        for (const E of world.seaNbr[D]) {
          if (partial[E] === 0) continue; const e = world.sea.get(E < D ? E * 1024 + D : D * 1024 + E), A = E < D ? e.lo : e.hi, B = E < D ? e.hi : e.lo;
          for (let k = 0; k < A.length; k++) if (owner[A[k]] === playerIdx && owner[B[k]] === D) { seaPairs.push([A[k], B[k]]); src.add(E); }
        }
        return { pairs, seaPairs, fronts: Math.max(1, src.size) };
      },
      /** Agrupa los contactos en flechas (sectores de ataque) en coordenadas de píxel del mapa. */
      arrows(D, maxArrows) {
        const { pairs, seaPairs, fronts } = this.contacts(D), CL = 11, cell = new Map(), out = [];
        for (const [a, d] of pairs) {
          const ax = a % W, ay = (a - ax) / W, dx = d % W, dy = (d - dx) / W, k = ((ay / CL) | 0) * 4096 + ((ax / CL) | 0);
          let c = cell.get(k); if (!c) cell.set(k, c = { n: 0, vx: 0, vy: 0, x: 0, y: 0 }); c.n++; c.vx += dx - ax; c.vy += dy - ay; c.x += (ax + dx) / 2 + .5; c.y += (ay + dy) / 2 + .5;
        }
        const land = [...cell.values()].sort((p, q) => q.n - p.n).slice(0, maxArrows || 28);
        for (const c of land) { const l = Math.hypot(c.vx, c.vy) || 1; out.push({ x: c.x / c.n, y: c.y / c.n, dx: c.vx / l, dy: c.vy / l, sea: false }); }
        const sc = new Map();
        for (const [a, d] of seaPairs) { const ax = a % W, ay = (a - ax) / W, k = ((ay / 18) | 0) * 4096 + ((ax / 18) | 0); if (!sc.has(k)) sc.set(k, [a, d]); }
        for (const [a, d] of [...sc.values()].slice(0, 6)) { const ax = a % W, ay = (a - ax) / W, dx = d % W, dy = (d - dx) / W; out.push({ x: ax + .5, y: ay + .5, x2: dx + .5, y2: dy + .5, dx: dx - ax, dy: dy - ay, sea: true }); }
        return { arrows: out, fronts };
      },
      startInvasion(D) {
        if (this.invasion && this.invasion.state === 'active') return { ok: false, msg: 'Ya hay una invasión en curso. Cancélala antes de iniciar otra.' };
        if (this.won) return { ok: false, msg: 'La partida ha terminado.' };
        const av = this.availability(D); if (!av) return { ok: false, msg: 'No existe una conexión terrestre o marítima válida con ese país.' };
        this.invCount++; this.invasion = new Invasion(this, D, D * 7919 + this.invCount * 104729); return { ok: true };
      },
      cancelInvasion() { const inv = this.invasion; if (!inv || inv.state !== 'active') return false; inv.state = 'cancelled'; inv.release(); return true; }
    };
    return g;
  }

  // ---------- invasión: autómata celular sobre la máscara de control ----------
  /* Dos bandos (jugador P y defensor D) pelean por cualquier píxel que toque al otro, sin importar su origen:
   *  - P toma píxeles de D (su territorio o lo que D haya arrebatado); D toma píxeles de P (¡contraataque!).
   *  - Por mar no hay píxeles en contacto: se producen DESEMBARCOS en las costas enlazadas (cabezas de playa).
   * La tendencia (quién gana terreno) depende de la diferencia de Poder; el ruido da la forma orgánica. */
  class Invasion {
    constructor(g, D, seed) {
      this.g = g; this.D = D; this.state = 'active'; this.t = 0; this.acc = 0; this.rng = mulberry32(seed); this.seed = seed & 0xffff;
      this.front = []; this.steps = 0; this.fronts = 1; this.total = g.world.countries[D].total; this.pBase = 0.5; this.lastDiff = 0; this.gain = 0;
      const w = g.world, W = w.W, M = W * w.H, ow = g.owner, P = g.player, f = g.fflag;
      for (let i = 0; i < M; i++) { // frente inicial: parejas de píxeles vecinos P|D en todo el mapa
        if (ow[i] !== D) continue; const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < M - W ? i + W : -1]) if (j >= 0 && ow[j] === P) { if (!f[i]) { f[i] = 1; this.front.push(i); } if (!f[j]) { f[j] = 1; this.front.push(j); } }
      }
      g.trackD = D; g.compD.fill(0); for (let i = 0; i < M; i++) if (ow[i] === D) g.compD[w.comp[i]]++;
      this.d0 = g.own[D]; this.p0 = g.own[P]; this.fronts = g.contacts(D).fronts;
    }
    get progress() { return Math.min(1, this.g.partial[this.D] / this.total); }
    /** Píxeles de otros países que el defensor ha arrebatado al jugador (contraataque). */
    get lostOutside() { return Math.max(0, this.g.foreignOf(this.D)); }
    contested(i) {
      const g = this.g, w = g.world, W = w.W, M = W * w.H, ow = g.owner, o = ow[i], D = this.D, P = g.player;
      if (o !== P && o !== D) return false; const t = o === P ? D : P, x = i % W;
      return (x > 0 && ow[i - 1] === t) || (x < W - 1 && ow[i + 1] === t) || (i >= W && ow[i - W] === t) || (i < M - W && ow[i + W] === t);
    }
    release() { for (const i of this.front) this.g.fflag[i] = 0; this.front = []; this.g.trackD = 0; }
    /** Avanza `dt` segundos (ya multiplicados por la velocidad) con pasos de simulación FIJOS. */
    advance(dt) { this.acc += dt; let n = 0; while (this.acc >= this.g.world.cfg.STEP_DT && this.state === 'active' && n < 400) { this.acc -= this.g.world.cfg.STEP_DT; this.step(); n++; } }
    attackProb() {
      const g = this.g, cfg = g.world.cfg, A = g.playerPower(), Dp = g.powerOf(this.D), diff = A - Dp; this.lastDiff = diff;
      if (diff === 0) return 0.5; // EMPATE: simétrico exacto; sin bonus de frentes ni escalada
      // sesgo mínimo del 5 %: cualquier diferencia real (≠0) inclina SIEMPRE la balanza hacia el más fuerte
      let p = 0.5 + Math.sign(diff) * Math.max(0.05, cfg.P_SPAN * Math.tanh(Math.abs(diff) / (A + Dp) * cfg.REL_GAIN));
      p += Math.min(cfg.FRONT_BONUS_MAX, cfg.FRONT_BONUS * (this.fronts - 1)); // más frentes empujan hacia el atacante
      if (diff < 0) p = Math.min(p, 0.45); else p = Math.max(p, 0.55);
      if (this.t > cfg.T_SOFT) p += Math.sign(diff) * Math.min(cfg.ESC_MAX, (this.t - cfg.T_SOFT) / cfg.T_ESC * cfg.ESC_MAX);
      return Math.max(0.03, Math.min(cfg.P_MAX, p));
    }
    step() {
      const g = this.g, w = g.world, cfg = w.cfg, W = w.W, H = w.H, M = W * H, id = w.ident, ow = g.owner, D = this.D, P = g.player, rng = this.rng;
      const pBase = this.attackProb(), tie = this.lastDiff === 0, total = this.total, frac = g.partial[D] / total, lost = this.lostOutside;
      const lossCap = Math.max(30, cfg.TIE_CAP * total * 0.5); // en empate, ni el atacante ni el defensor pasan de estos límites
      this.pBase = pBase;
      const toP = [], toD = [], f = this.front, tt = this.t * cfg.NOISE_SPEED;
      for (let k = 0; k < f.length; k++) {
        const i = f[k]; if (!g.fflag[i]) continue; const x = i % W, y = (i - x) / W, o = ow[i];
        const n = noise3(x * cfg.NOISE_SCALE, y * cfg.NOISE_SCALE, tt, this.seed);
        const pl = Math.max(0.03, Math.min(0.97, pBase + (n - 0.5) * 2 * cfg.LOCAL_SWING));
        const L = x > 0 ? ow[i - 1] : 0, R = x < W - 1 ? ow[i + 1] : 0, U = i >= W ? ow[i - W] : 0, B = i < M - W ? ow[i + W] : 0;
        if (o === D) { // el jugador avanza sobre un píxel del defensor
          const c = (L === P) + (R === P) + (U === P) + (B === P); if (!c || (tie && frac >= cfg.TIE_CAP)) continue;
          if (rng() < cfg.BASE_RATE * 2 * pl * c / 4) toP.push(i);
        } else if (o === P) { // el defensor contraataca: recupera lo suyo o conquista territorio del jugador
          const c = (L === D) + (R === D) + (U === D) + (B === D); if (!c) continue;
          if (tie && ((id[i] === D && frac <= cfg.TIE_FLOOR) || (id[i] !== D && lost >= lossCap))) continue;
          if (rng() < cfg.BASE_RATE * 2 * (1 - pl) * c / 4) toD.push(i);
        }
      }
      // desembarcos marítimos: cabezas de playa en las costas enlazadas (atacante hacia D, y D hacia el jugador)
      if (this.steps % 10 === 0) {
        for (const E of w.seaNbr[D]) {
          if (g.partial[E] === 0) continue; const e = w.sea.get(E < D ? E * 1024 + D : D * 1024 + E), A = E < D ? e.lo : e.hi, Bk = E < D ? e.hi : e.lo;
          for (let k = 0; k < A.length; k++) {
            const pa = A[k], pd = Bk[k]; if (ow[pa] !== P || ow[pd] !== D) continue;
            if (!(tie && frac >= cfg.TIE_CAP) && rng() < cfg.LAND_P * 2 * pBase) this.blob(pd, D, toP);
            else if (!(tie && lost >= lossCap) && rng() < cfg.LAND_P * 2 * (1 - pBase)) this.blob(pa, P, toD);
          }
        }
      }
      // islas/enclaves sin contacto (tuyos o del defensor): cabeza de playa cuando el ganador ya domina el resto del frente
      if (!tie && this.steps % 15 === 0) {
        const touched = new Set(); for (const i of f) if (g.fflag[i]) touched.add(w.comp[i]);
        let dT = 0, pT = 0; for (const c of touched) { dT += g.compD[c]; pT += g.compCap[c]; }
        const att = this.lastDiff > 0;
        if (att ? dT <= Math.max(40, 0.15 * this.d0) : pT <= Math.max(40, 0.15 * this.p0)) {
          for (let c = 1; c < w.compCount.length; c++) {
            if (touched.has(c) || (att ? g.compD[c] : g.compCap[c]) <= 0) continue;
            const idn = w.compIdent[c], want = att ? D : P; // píxel de la isla que aún es del perdedor
            for (let k = w.pxStart[idn]; k < w.pxStart[idn + 1]; k++) { const i = w.pxList[k]; if (w.comp[i] === c && ow[i] === want) { (att ? toP : toD).push(i); break; } }
          }
        }
      }
      for (const i of toP) g.setOwner(i, P); for (const i of toD) g.setOwner(i, D);
      // actualizar el frente alrededor de lo cambiado
      const touch = j => { if (j < 0 || j >= M) return; const is = this.contested(j); if (is && !g.fflag[j]) { g.fflag[j] = 1; f.push(j); } else if (!is && g.fflag[j]) g.fflag[j] = 0; };
      for (const arr of [toP, toD]) for (const i of arr) { const x = i % W; touch(i); if (x > 0) touch(i - 1); if (x < W - 1) touch(i + 1); touch(i - W); touch(i + W); }
      if (this.steps % 3 === 0) { const nf = []; for (const i of f) if (g.fflag[i] === 1) { g.fflag[i] = 3; nf.push(i); } for (const i of nf) g.fflag[i] = 1; this.front = nf; }
      this.t += cfg.STEP_DT; this.steps++;
      if (this.steps % 45 === 0) this.fronts = g.contacts(D).fronts;
      // fin de batalla: el defensor desaparece (conquista) o cae el país inicial del jugador (derrota)
      if (g.own[D] === 0) this.finish('conquered');
      else if (g.defeated) this.finish('lost');
    }
    /** Cabeza de playa: el píxel `c` y algunos vecinos del mismo bando `from` pasan al contrario (cola `out`). */
    blob(c, from, out) {
      const g = this.g, W = g.world.W, M = W * g.world.H, ow = g.owner, x = c % W; out.push(c);
      for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < M - W ? c + W : -1]) if (j >= 0 && ow[j] === from && this.rng() < 0.6) out.push(j);
    }
    finish(state) {
      const g = this.g; this.state = state; this.release();
      if (state === 'conquered') { this.gain = g.conquer(this.D); if (g.alive === 0) g.won = true; }
      else if (state === 'lost') g.lost = true;
    }
  }

  /** Reconstruye una partida desde `serialize()`. Lanza Error si los datos no son válidos. */
  function restoreGame(world, data) {
    const N = world.N, n = world.W * world.H;
    if (!data || data.v !== 1 || !(data.player >= 1 && data.player <= N) || !Array.isArray(data.runs) || data.runs.length % 3 || !Array.isArray(data.conqList)) throw new Error('Partida guardada no válida');
    const g = createGame(world, data.player), { owner, partial, own, compCap } = g, ident = world.ident, r = data.runs;
    for (let k = 0; k < r.length; k += 3) {
      const s = r[k], len = r[k + 1], o = r[k + 2];
      if (!(s >= 0 && len > 0 && s + len <= n && o >= 1 && o <= N)) throw new Error('Partida guardada no válida');
      owner.fill(o, s, s + len);
    }
    own.fill(0); partial.fill(0); compCap.fill(0);
    for (let i = 0; i < n; i++) {
      const o = owner[i]; if (o) own[o]++;
      if (o === data.player) { partial[ident[i]]++; compCap[world.comp[i]]++; }
    }
    g.alive = 0; for (let c = 1; c <= N; c++) if (c !== data.player && own[c] > 0) g.alive++;
    for (const [c, add] of data.conqList) { g.conquered.add(c); g.conqList.push([c, add]); g.growth += add; }
    g.invCount = data.invCount | 0; g.speed = [1, 2, 4, 8].includes(data.speed) ? data.speed : 1;
    g.defeated = partial[data.player] === 0; g.won = g.alive === 0;
    return g;
  }
  const api = { CFG, build, createGame, restoreGame, computePowers, contribOf, naturalEarth, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
