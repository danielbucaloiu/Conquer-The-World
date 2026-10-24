/* ============================================================================
 * script.js — interfaz, renderizado Canvas 2D y bucle principal.
 * La lógica (mapa, adyacencias, Poder, batalla) vive en engine.js; aquí solo se dibuja y se
 * gestionan eventos. Un ÚNICO bucle requestAnimationFrame; los listeners se registran una vez.
 * ========================================================================== */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), E = window.Engine, DPR = Math.min(2, window.devicePixelRatio || 1);
  const PAL = ['#e6a23c', '#6cbf6a', '#4f8fd1', '#a26fd0', '#e07a52', '#4fbcb5', '#cfc66a', '#d9648b'], PLAYER = '#e03045';
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const PALRGB = PAL.map(hex), PLRGB = hex(PLAYER), SEA = [[22, 48, 79], [24, 52, 84], [20, 44, 74]], EDGE = [11, 13, 20], YEL = [255, 207, 74];
  const pack = (r, g, b) => (255 << 24) | (Math.max(0, Math.min(255, b | 0)) << 16) | (Math.max(0, Math.min(255, g | 0)) << 8) | Math.max(0, Math.min(255, r | 0));

  let world, game = null, W, H, ident, owner, hl, img, px32, mapCv, mapCtx;
  let terr = 0, phase = 'loading', selected = 0, pickOwner, arrowSt = null, needsDraw = true, dirtyRect = null;
  const view = { x: 0, y: 0, k: 1, fit: 1 };
  const canvas = $('map'), ctx = canvas.getContext('2d');
  let cw = 0, ch = 0;

  // ---------- arranque ----------
  function boot() {
    setTimeout(() => {
      try { world = E.build(window.WORLD_DATA); } catch (e) { $('loadmsg').textContent = 'Error al construir el mapa: ' + e.message; console.error(e); return; }
      W = world.W; H = world.H; ident = world.ident; hl = new Uint8Array(world.N + 1);
      mapCv = document.createElement('canvas'); mapCv.width = W; mapCv.height = H; mapCtx = mapCv.getContext('2d');
      img = mapCtx.createImageData(W, H); px32 = new Uint32Array(img.data.buffer);
      pickOwner = Uint16Array.from(ident); owner = pickOwner;
      paintAll(); resize(); fitView(); $('loading').classList.add('hidden'); $('menu').classList.remove('hidden'); updateContinue();
      console.info('[Mapa] países:', world.N, '· adyacencias terrestres:', world.report.landPairs, '· marítimas:', world.report.seaPairs, '· enlaces de último recurso:', world.bridges.join('; ') || 'ninguno');
      requestAnimationFrame(frame);
    }, 30);
  }

  // ---------- pintado del mapa (máscara de control → píxeles) ----------
  function colorAt(i) {
    const id = ident[i], x = i % W;
    if (!id) { const s = SEA[((x * 7 + (i / W | 0) * 13) >> 2) % 3]; return pack(s[0], s[1], s[2]); }
    const o = owner[i], P = game ? game.player : -1, h = hl[id];
    // borde duro (costa / frontera entre países) en negro; borde blando = frente de batalla dentro de un mismo país
    let hard = false, soft = false;
    const nb = (j) => { if (owner[j] === o) return; if (ident[j] === id) soft = true; else hard = true; };
    if (x > 0) nb(i - 1); if (x < W - 1) nb(i + 1); if (i >= W) nb(i - W); if (i < W * (H - 1)) nb(i + W);
    if (hard) { const c = h === 2 ? YEL : EDGE; return pack(c[0], c[1], c[2]); }
    if (soft) { const q = o === P ? PLRGB : PALRGB[world.colorOf[o]]; return pack(q[0] * .42, q[1] * .42, q[2] * .42); }
    const b = o === P ? PLRGB : PALRGB[world.colorOf[o]];
    let f = 1 + (((i * 2654435761) >>> 28) - 8) * 0.006; // textura sutil de "pintura"
    let r = b[0] * f, g = b[1] * f, bl = b[2] * f;
    if (h === 1 && o !== P) { r += (255 - r) * .3; g += (255 - g) * .3; bl += (255 - bl) * .3; }
    else if (h === 2 && o !== P) { r += (255 - r) * .22; g += (255 - g) * .22; bl += (255 - bl) * .22; }
    return pack(r, g, bl);
  }
  function paintAll() { for (let i = 0; i < px32.length; i++) px32[i] = colorAt(i); mapCtx.putImageData(img, 0, 0); needsDraw = true; }
  function repaintCountry(c) {
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let k = world.pxStart[c]; k < world.pxStart[c + 1]; k++) { const i = world.pxList[k]; px32[i] = colorAt(i); const x = i % W, y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= x0) { mapCtx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1); needsDraw = true; }
  }
  function applyDirty() {
    const d = game.dirty; if (!d.length) return; let x0 = W, x1 = 0, y0 = H, y1 = 0;
    const up = j => { if (j < 0 || j >= W * H) return; px32[j] = colorAt(j); const x = j % W, y = (j - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const i of d) { up(i); if (i % W > 0) up(i - 1); if (i % W < W - 1) up(i + 1); up(i - W); up(i + W); }
    d.length = 0; mapCtx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1); needsDraw = true;
  }
  /** Recalcula qué países se resaltan (invadibles / objetivo / invadido) y repinta solo los que cambian. */
  function refreshHighlights() {
    const nh = new Uint8Array(world.N + 1);
    if (game && phase === 'play') {
      for (const c of game.invadables()) nh[c] = 1;
      if (game.invasion && game.invasion.state === 'active') { nh.fill(0); nh[game.invasion.D] = 3; }
    }
    if (selected && nh[selected] !== 3 && !(game && game.stateOf(selected) === 'propio')) nh[selected] = 2;
    for (let c = 1; c <= world.N; c++) if (nh[c] !== hl[c]) { hl[c] = nh[c]; repaintCountry(c); }
  }

  // ---------- vista (zoom/desplazamiento) ----------
  function resize() { cw = innerWidth; ch = innerHeight; canvas.width = cw * DPR; canvas.height = ch * DPR; needsDraw = true; }
  function fitView() { const top = 64, bot = 16; view.fit = Math.min(cw / W, (ch - top - bot) / H); view.k = view.fit; view.x = (cw - W * view.k) / 2; view.y = top + (ch - top - bot - H * view.k) / 2; needsDraw = true; }
  function clampView() { view.k = Math.max(view.fit * .8, Math.min(28, view.k)); const m = 90; view.x = Math.max(m - W * view.k, Math.min(cw - m, view.x)); view.y = Math.max(m - H * view.k, Math.min(ch - m, view.y)); }
  function zoomAt(sx, sy, f) { const wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k; view.k *= f; clampView(); view.x = sx - wx * view.k; view.y = sy - wy * view.k; clampView(); needsDraw = true; }

  // ---------- dibujo ----------
  const drawnLabels = [];
  function draw(ts) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0f1b2d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(mapCv, view.x * DPR, view.y * DPR, W * view.k * DPR, H * view.k * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); drawLabels(); if (arrowSt) drawArrows(ts || 0);
  }
  function drawLabels() {
    drawnLabels.length = 0; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 4;
    const cs = world.countries, order = view._lblOrder || (view._lblOrder = cs.slice(1).sort((a, b) => b.mainCount - a.mainCount));
    for (const c of order) {
      if (game && game.own[c.idx] === 0) continue; // sin territorio = ya no existe: su nombre desaparece
      const cnt = game && c.idx === game.player ? terr : c.mainCount; // el país principal crece con lo conquistado
      const sx = view.x + c.labelX * view.k, sy = view.y + c.labelY * view.k; if (sx < -80 || sx > cw + 80 || sy < -20 || sy > ch + 20) continue;
      const fs = Math.min(26, Math.sqrt(cnt) * view.k * 1.25 / (c.name.length * .44)); if (fs < 11) continue;
      ctx.font = `${Math.round(fs)}px VT323, "Courier New", monospace`; const tw = ctx.measureText(c.name).width, r = [sx - tw / 2, sy - fs / 2, sx + tw / 2, sy + fs / 2];
      if (drawnLabels.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue; drawnLabels.push(r);
      ctx.strokeStyle = 'rgba(8,10,18,.92)'; ctx.strokeText(c.name, sx, sy); ctx.fillStyle = '#f4efe0'; ctx.fillText(c.name, sx, sy);
    }
  }
  // Flechas pixel art: chevrones "»" cuyo tamaño de píxel es fijo en pantalla y la dirección se ajusta a 8 rumbos.
  function chevron(sx, sy, ang, u, fill, off) {
    const ca = Math.cos(ang), sa = Math.sin(ang), cells = [[0, -2], [1, -1], [2, 0], [1, 1], [0, 2], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0]], pts = [];
    for (const [cx, cy] of cells) pts.push([Math.round((cx + off) * ca - cy * sa), Math.round((cx + off) * sa + cy * ca)]);
    const X = p => Math.round(sx) + p[0] * u - (u >> 1), Y = p => Math.round(sy) + p[1] * u - (u >> 1);
    ctx.fillStyle = '#090b12'; for (const p of pts) ctx.fillRect(X(p) - 2, Y(p) - 2, u + 4, u + 4);
    ctx.fillStyle = fill; for (const p of pts) ctx.fillRect(X(p), Y(p), u, u);
  }
  function drawArrows(ts) {
    const u = Math.max(3, Math.min(6, Math.round(view.k * 1.2 + 1))), ph = Math.floor(ts / 160) % 4, act = game && game.invasion && game.invasion.state === 'active';
    for (const a of arrowSt.arrows) {
      const ang = Math.round(Math.atan2(a.dy, a.dx) / (Math.PI / 4)) * (Math.PI / 4), sx = view.x + a.x * view.k, sy = view.y + a.y * view.k;
      if (sx < -40 || sx > cw + 40 || sy < -40 || sy > ch + 40) continue;
      if (a.sea) { // trayecto marítimo punteado hasta la costa del defensor
        const ex = view.x + a.x2 * view.k, ey = view.y + a.y2 * view.k, n = Math.max(2, Math.floor(Math.hypot(ex - sx, ey - sy) / (u * 5)));
        for (let s = 1; s < n; s++) { if ((s + ph) % 2) continue; const t = s / n; ctx.fillStyle = '#090b12'; ctx.fillRect(Math.round(sx + (ex - sx) * t) - u, Math.round(sy + (ey - sy) * t) - u, u * 2, u * 2); ctx.fillStyle = '#bfe6ff'; ctx.fillRect(Math.round(sx + (ex - sx) * t) - u / 2 | 0, Math.round(sy + (ey - sy) * t) - u / 2 | 0, u, u); }
        chevron(ex, ey, ang, u, '#bfe6ff', 0);
      } else chevron(sx, sy, ang, u, act ? '#ffe9a8' : '#ffffff', act ? -(ph % 3) + 1 : 0);
    }
  }

  // ---------- interacción con el mapa ----------
  const ptrs = new Map(); let drag = null, pinch = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; else { drag = null; pinch = dist2(); } });
  canvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) { const d = dist2(), m = mid2(); if (pinch) zoomAt(m.x, m.y, d / pinch); pinch = d; return; }
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; canvas.classList.add('drag'); } if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; clampView(); needsDraw = true; } }
  });
  const endPtr = e => { const was = drag; ptrs.delete(e.pointerId); canvas.classList.remove('drag'); if (ptrs.size < 2) pinch = 0; if (e.type === 'pointerup' && was && !was.moved && ptrs.size === 0) clickAt(e.clientX, e.clientY); if (ptrs.size === 0) drag = null; };
  canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY)); }, { passive: false });
  const dist2 = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }, mid2 = () => { const [a, b] = [...ptrs.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  function pick(sx, sy) { // píxel del mapa → país (con tolerancia para islas y países diminutos)
    const wx = Math.floor((sx - view.x) / view.k), wy = Math.floor((sy - view.y) / view.k), r = Math.max(1, Math.min(4, Math.ceil(7 / view.k)));
    // se elige por quién CONTROLA el píxel (no por su país de origen)
    let best = 0, bd = 1e9; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = wx + dx, y = wy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; const id = owner[y * W + x]; if (id && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = id; } }
    return best; // un país conquistado ya no existe: sus píxeles pertenecen al conquistador
  }
  function clickAt(sx, sy) { if (phase === 'loading' || phase === 'menu' || phase === 'won' || phase === 'lost' || !$('modal').classList.contains('hidden')) return; const id = pick(sx, sy); if (!id) { if (phase === 'play' && !(game.invasion && game.invasion.state === 'active')) select(0); return; } onCountry(id); }

  // ---------- flujo de juego ----------
  const cname = c => world.countries[c].name;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || 3200); }
  // ---------- guardado (localStorage) ----------
  const SAVE_KEY = 'cm_save';
  function saveGame() {
    if (!game || phase !== 'play') return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize())); } catch (e) { console.warn('[Guardado] no se pudo guardar:', e); }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* sin almacenamiento */ } updateContinue(); }
  function readSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function updateContinue() { $('btn-continue').classList.toggle('hidden', !readSave()); }
  function continueGame() {
    let g; try { g = E.restoreGame(world, readSave()); } catch (e) { console.warn('[Guardado]', e); clearSave(); toast('La partida guardada no es válida y se ha descartado.'); return; }
    if (g.won || g.defeated) { clearSave(); toast('La partida guardada ya había terminado.'); return; }
    Sfx.play('confirm'); game = g; owner = game.owner; selected = 0; hl.fill(0); phase = 'play'; arrowSt = null;
    paintAll(); ['menu', 'info', 'action', 'battle', 'pickhint', 'btn-confirm'].forEach(i => $(i).classList.add('hidden')); $('hud').classList.remove('hidden'); $('zoom').classList.remove('hidden'); $('legend').classList.remove('hidden');
    syncSpeed(); hud(); refreshHighlights(); updateBottom(); fitView(); toast(`Partida recuperada: controlas ${cname(game.player)}.`, 3500);
  }
  function startPick() {
    clearSave();
    if (game && game.invasion && game.invasion.state === 'active') game.cancelInvasion();
    game = null; pickOwner = Uint16Array.from(ident); owner = pickOwner; selected = 0; arrowSt = null; phase = 'pick'; hl.fill(0);
    paintAll(); ['menu', 'hud', 'info', 'action', 'battle'].forEach(i => $(i).classList.add('hidden')); $('pickhint').classList.remove('hidden'); $('zoom').classList.remove('hidden'); $('legend').classList.add('hidden'); $('btn-confirm').classList.add('hidden'); fitView(); updateBottom();
  }
  function onCountry(id) {
    if (phase === 'pick') { select(id); return; }
    const act = game.invasion && game.invasion.state === 'active';
    if (act) { select(id, true); if (id !== game.invasion.D) { Sfx.play('error'); toast('Cancela la invasión en curso para atacar otro objetivo.'); } return; }
    select(id);
  }
  function select(id, infoOnly) {
    const prev = selected; selected = id; if (prev && prev !== id) { hl[prev] = 0; repaintCountry(prev); }
    if (!game || !(game.invasion && game.invasion.state === 'active')) arrowSt = null;
    if (!id) { $('info').classList.add('hidden'); $('action').classList.add('hidden'); $('btn-confirm').classList.add('hidden'); refreshHighlights(); updateBottom(); return; }
    Sfx.play('select');
    if (phase === 'pick') { hl[id] = 2; repaintCountry(id); const c = world.countries[id]; $('info-name').textContent = c.name.toUpperCase(); $('info-power').textContent = c.power; $('info-state').textContent = 'Independiente'; $('info-ctrl').textContent = c.name; $('info').classList.remove('hidden'); $('btn-confirm').classList.remove('hidden'); $('pickhint').classList.add('hidden'); needsDraw = true; return; }
    refreshHighlights(); fillInfo(id);
    const st = game.stateOf(id), act = game.invasion && game.invasion.state === 'active';
    if (infoOnly || act || st === 'propio') { $('action').classList.add('hidden'); updateBottom(); return; }
    fillAction(id);
  }
  function fillInfo(id) {
    const c = world.countries[id], st = game.stateOf(id); $('info-name').textContent = c.name.toUpperCase(); const eff = game.powerOf(id); $('info-power').textContent = id !== game.player && eff !== c.power ? `${eff} (base ${c.power})` : eff;
    const pct = Math.round(game.partial[id] / c.total * 100), pn = cname(game.player);
    $('info-state').textContent = id === game.player ? 'Tu país' : st === 'propio' ? 'Conquistado' : st === 'parcial' ? `En disputa (${pct}% tuyo)` : 'Independiente';
    $('info-ctrl').textContent = st === 'propio' ? pn : st === 'parcial' ? `${pn} / ${c.name}` : c.name; $('info').classList.remove('hidden'); $('btn-confirm').classList.add('hidden');
  }
  function fillAction(id) {
    const av = game.availability(id), A = game.playerPower(), D = game.powerOf(id), base = world.countries[id].power, diff = A - D;
    $('act-name').textContent = cname(id); $('act-att').textContent = A; $('act-def').textContent = D !== base ? `${D} (base ${base})` : D;
    $('act-diff').textContent = diff > 0 ? '+' + diff + ' (ventaja)' : diff < 0 ? diff + ' (desventaja)' : '0 (empate)';
    const m = $('act-msg'); m.className = 'act-msg';
    if (av) {
      const conn = av.land && av.sea ? 'Terrestre y marítima' : av.land ? 'Terrestre' : av.sea ? 'Marítima' : 'Frente ya abierto';
      $('act-conn').textContent = conn; arrowSt = game.arrows(id); $('btn-invade').disabled = false;
      m.textContent = diff === 0 ? 'Mismo Poder: la frontera quedará en conflicto permanente.' : diff < 0 ? '¡PELIGRO! El defensor es más fuerte: contraatacará, te quitará territorio y podría conquistar tu país. Puedes cancelar para retirarte.' : arrowSt.fronts > 1 ? `Atacarás por ${arrowSt.fronts} frentes a la vez.` : '';
      if (diff > 0) m.classList.add('ok');
    } else {
      Sfx.play('error'); $('act-conn').textContent = 'Ninguna'; arrowSt = null; $('btn-invade').disabled = true;
      m.textContent = `No existe una conexión terrestre o marítima válida con ${cname(id)}. Conquista países vecinos para abrir camino.`;
    }
    $('action').classList.remove('hidden'); updateBottom(); needsDraw = true;
  }
  function updateBottom() { document.body.classList.toggle('has-bottom', !$('action').classList.contains('hidden') || !$('battle').classList.contains('hidden')); }
  function hud() {
    $('hud-name').textContent = cname(game.player); $('hud-power').textContent = game.playerPower(); $('hud-conq').textContent = `${game.conquered.size}/${world.N - 1}`; $('hud-alarm').textContent = '+' + game.rearmPct() + '%';
    terr = game.own[game.player]; needsDraw = true;
  }
  function confirmStart() {
    if (phase !== 'pick' || !selected) return;
    Sfx.play('confirm'); game = E.createGame(world, selected); owner = game.owner; selected = 0; hl.fill(0); phase = 'play'; arrowSt = null;
    paintAll(); $('info').classList.add('hidden'); $('btn-confirm').classList.add('hidden'); $('pickhint').classList.add('hidden'); $('hud').classList.remove('hidden'); $('legend').classList.remove('hidden');
    hud(); refreshHighlights(); saveGame(); toast(`Controlas ${cname(game.player)}. Elige un país resaltado para invadirlo.`, 4200);
  }
  function startInvasion() {
    if (!selected || !game) return; const D = selected, r = game.startInvasion(D);
    if (!r.ok) { $('act-msg').className = 'act-msg'; $('act-msg').textContent = r.msg; return; }
    Sfx.play('invade'); game.speed = 1; syncSpeed(); $('action').classList.add('hidden'); $('battle').classList.remove('hidden'); $('bat-name').textContent = cname(D); hl.fill(0); selected = 0; refreshHighlightsInv(D); arrowSt = game.arrows(D); updateBottom(); battleUI(true);
  }
  function refreshHighlightsInv(D) { for (let c = 1; c <= world.N; c++) { const v = c === D ? 3 : 0; if (hl[c] !== v) { hl[c] = v; repaintCountry(c); } } }
  function cancelInvasion() {
    if (!game || !game.cancelInvasion()) return; Sfx.play('cancel'); arrowSt = null; $('battle').classList.add('hidden'); updateBottom(); applyDirty(); refreshHighlights(); hud();
    toast('Invasión cancelada: se conserva el frente tal y como está.'); lastProg = 0; saveGame();
  }
  function onInvasionEnd(inv) {
    arrowSt = null; $('battle').classList.add('hidden'); selected = 0; $('action').classList.add('hidden'); updateBottom(); applyDirty(); refreshHighlights(); hud();
    if (inv.state === 'conquered') { toast(`¡${cname(inv.D)} se une a ${cname(game.player)}! Poder +${inv.gain} → ${game.playerPower()}. Rearme mundial: +${game.rearmPct()}%.`, 5000); if (game.won) { phase = 'won'; clearSave(); victory(); } else { Sfx.play('conquest'); saveGame(); } }
    else if (inv.state === 'lost') { phase = 'lost'; clearSave(); defeat(inv); }
  }
  function defeat(inv) {
    Sfx.play('defeat'); Sfx.play('defeat', 350);
    modal('DERROTA', `<p><b>${cname(inv.D)}</b> ha contraatacado y ha conquistado <b>${cname(game.player)}</b>.</p><p>Tu imperio llegó a ${game.conquered.size} países conquistados. Para evitarlo, cancela las invasiones contra un rival más fuerte y gana Poder en otro frente.</p>`, [['NUEVA PARTIDA', startPick, 'go'], ['VER MAPA', null]]);
  }
  function syncSpeed() { document.querySelectorAll('.spd').forEach(b => b.classList.toggle('on', +b.dataset.speed === game.speed)); }
  let lastProg = 0;
  let warned = false;
  function battleUI(force) {
    const inv = game.invasion; if (!inv) return; const A = game.playerPower(), D = game.powerOf(inv.D), diff = A - D;
    $('bat-pct').textContent = Math.round(inv.progress * 100) + '%'; $('bat-att').textContent = A; $('bat-def').textContent = D; $('bat-fr').textContent = inv.fronts;
    $('bat-tend').textContent = diff > 0 ? 'Atacante' : diff < 0 ? 'Defensor: contraataca' : 'Empate';
    hud(); // el Poder puede cambiar durante la batalla (p. ej. si pierdes un país conquistado)
    if (force) warned = false;
    if (!warned && inv.lostOutside >= 25) { warned = true; Sfx.play('error'); toast(`¡${cname(inv.D)} contraataca y avanza sobre tu territorio! Cancela para retirarte.`, 4500); }
  }

  // ---------- modales ----------
  function modal(title, html, buttons) {
    $('modal-title').textContent = title; $('modal-body').innerHTML = html; const b = $('modal-btns'); b.innerHTML = '';
    for (const [txt, fn, cls] of buttons) { const el = document.createElement('button'); el.className = 'btn ' + (cls || ''); el.textContent = txt; el.onclick = () => { $('modal').classList.add('hidden'); if (fn) fn(); }; b.appendChild(el); }
    $('modal').classList.remove('hidden');
  }
  const closeBtn = [['ENTENDIDO', null, 'go']];
  function guide() {
    modal('CÓMO JUGAR', `<ol>
      <li><b>Elige tu país:</b> toca cualquier país del mapa, mira su Poder y pulsa CONFIRMAR. Puedes cambiar de elección antes de confirmar.</li>
      <li><b>Selecciona un enemigo:</b> los países que puedes invadir aparecen resaltados. Los demás no tienen conexión terrestre ni marítima con tu territorio.</li>
      <li><b>Poder:</b> es la fuerza de un país (población, economía, tamaño…). El tuyo sube al conquistar, pero cada conquista aporta menos que la anterior. Además hay <b>rearme mundial</b>: cuanto más crece tu imperio, más se rearman los países independientes (equilibrio de poder), así que las grandes potencias seguirán siendo rivales serios.</li>
      <li><b>Países conquistados:</b> dejan de existir y pasan a ser parte de tu país: sin fronteras ni nombre propio.</li>
      <li><b>Invadir:</b> pulsa INVADIR. Las flechas muestran los puntos de ataque; la pintura roja avanza y la del defensor contraataca. Más frentes (varios países tuyos rodeándolo) aumentan la presión.</li>
      <li><b>Velocidad:</b> ×1, ×2, ×4 y ×8 aceleran la batalla de verdad, no solo el efecto.</li>
      <li><b>Contraataque:</b> el defensor no se limita a resistir: también te invade. Si es más fuerte, avanzará sobre tu territorio (puedes perder tierras o países conquistados) y, si cae tu país inicial, <b>pierdes la partida</b>. Si es más débil, también intentará recuperar terreno.</li>
      <li><b>Cancelar:</b> detiene la invasión y <b>conserva el frente</b> tal como esté (incluidas las tierras ganadas o perdidas). Es tu forma de retirarte.</li>
      <li><b>Por mar:</b> la invasión marítima empieza con desembarcos en la costa enemiga (cabezas de playa) que luego se expanden.</li>
      <li><b>Aprovecha las brechas:</b> si tu avance toca un tercer país, cancela y ataca por ahí; con más Poder, vuelve y termina el trabajo.</li>
      <li><b>Empate permanente:</b> con el mismo Poder, la frontera avanza y retrocede sin que nadie conquiste al otro. Rompe el empate ganando Poder en otro lugar.</li>
      <li><b>Moverse:</b> arrastra para desplazar, rueda o pellizco para el zoom.</li></ol>
      <p>Solo se mueven los países que tú invades: el resto es pasivo. Ganas al controlar los 196.</p>`, closeBtn);
  }
  function victory() { Sfx.victory(); modal('¡VICTORIA!', `<p>Has conquistado el mundo.</p><p>Países conquistados: <b>${game.conquered.size}</b> (más tu país inicial, <b>${cname(game.player)}</b>: ${game.conquered.size + 1} en total).</p><p>Poder final: <b>${game.playerPower()}</b></p>`, [['NUEVA PARTIDA', startPick, 'go'], ['VER MAPA', null]]); }
  function options() {
    const v = Math.round(Sfx.volume * 100);
    modal('OPCIONES', `<p>Volumen de efectos: <b id="vol-val">${v}%</b></p><input id="vol" type="range" min="0" max="100" step="5" value="${v}" aria-label="Volumen"><p><label><input id="mute" type="checkbox" ${Sfx.muted ? 'checked' : ''}>Silenciar efectos</label></p>`, [['LISTO', null, 'go']]);
    const r = $('vol'); r.oninput = () => { Sfx.setVolume(r.value / 100); $('vol-val').textContent = r.value + '%'; }; r.onchange = () => Sfx.play('confirm');
    $('mute').onchange = e => { Sfx.setMuted(e.target.checked); if (!e.target.checked) Sfx.play('click'); };
  }
  function askReset() { modal('REINICIAR', '<p>Se borrará la partida guardada y volverás a elegir el país inicial.</p>', [['SÍ, REINICIAR', startPick, 'danger'], ['NO', null]]); }

  // ---------- bucle principal único ----------
  let last = 0, tUi = 0, tArr = 0, tHl = 0, tSave = 0;
  function frame(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
    if (game && game.invasion && game.invasion.state === 'active') {
      const inv = game.invasion; inv.advance(dt * game.speed); applyDirty(); tUi += dt; tArr += dt; tHl += dt;
      tSave += dt;
      if (inv.state !== 'active') onInvasionEnd(inv);
      else { if (tSave > 5) { tSave = 0; saveGame(); } if (tUi > .15) { tUi = 0; battleUI(); } if (tArr > .45) { tArr = 0; arrowSt = game.arrows(inv.D); } }
    }
    if (needsDraw || arrowSt) { draw(ts); needsDraw = false; }
    requestAnimationFrame(frame);
  }

  // ---------- eventos de la interfaz (registrados una sola vez) ----------
  $('btn-new').onclick = startPick; $('btn-continue').onclick = continueGame; $('btn-guide0').onclick = guide; $('btn-opt0').onclick = options; $('btn-opt').onclick = options;
  // clic genérico en botones (los que tienen sonido propio se excluyen)
  ['btn-confirm', 'btn-invade', 'btn-cancel-inv'].forEach(i => $(i).dataset.nosound = '1');
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.btn'); if (b && !b.dataset.nosound && !b.disabled) Sfx.play('click'); }); $('btn-guide').onclick = guide; $('btn-reset').onclick = askReset;
  $('btn-confirm').onclick = confirmStart; $('btn-invade').onclick = startInvasion; $('btn-close').onclick = () => select(0); $('btn-cancel-inv').onclick = cancelInvasion;
  document.querySelectorAll('.spd').forEach(b => b.onclick = () => { if (game) { game.speed = +b.dataset.speed; syncSpeed(); } });
  $('z-in').onclick = () => zoomAt(cw / 2, ch / 2, 1.5); $('z-out').onclick = () => zoomAt(cw / 2, ch / 2, 1 / 1.5); $('z-fit').onclick = fitView;
  addEventListener('resize', () => { const a = view.k === view.fit; resize(); const keep = a; fitView(); if (!keep) needsDraw = true; });
  addEventListener('keydown', e => { if (e.key === 'Escape' && phase === 'play' && !(game.invasion && game.invasion.state === 'active')) select(0); });
  addEventListener('pagehide', saveGame); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveGame(); });
  window.__game = { get world() { return world; }, get game() { return game; }, view, pick, clickAt }; // utilidades para depurar en consola
  boot();
})();
