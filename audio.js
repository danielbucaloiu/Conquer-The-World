/* audio.js — efectos de sonido (Kenney, MIT; ver sounds/CREDITS.txt) con volumen maestro.
 * Volumen por defecto 50 %. Se guarda en localStorage (si está disponible). Los navegadores solo
 * permiten sonar tras una interacción del usuario; todos los efectos nacen de clics, así que no hay problema. */
(function (root) {
  'use strict';
  const GAIN = { click: .6, select: .7, confirm: .9, invade: .9, cancel: .8, conquest: 1, defeat: .9, error: .8 }; // mezcla relativa
  let vol = 0.5, muted = false;
  try { const v = localStorage.getItem('cm_volume'); if (v !== null && !isNaN(+v)) vol = Math.min(1, Math.max(0, +v)); muted = localStorage.getItem('cm_muted') === '1'; } catch (e) { /* sin almacenamiento */ }
  const base = {};
  for (const n of Object.keys(GAIN)) { const a = new Audio('sounds/' + n + '.mp3'); a.preload = 'auto'; base[n] = a; }
  const save = () => { try { localStorage.setItem('cm_volume', String(vol)); localStorage.setItem('cm_muted', muted ? '1' : '0'); } catch (e) { } };
  function play(n, delay) {
    if (delay) return setTimeout(() => play(n), delay);
    if (muted || vol <= 0 || !base[n]) return;
    try { const a = base[n].cloneNode(); a.volume = Math.min(1, vol * GAIN[n]); const p = a.play(); if (p && p.catch) p.catch(() => { }); } catch (e) { }
  }
  root.Sfx = {
    play, get volume() { return vol; }, get muted() { return muted; },
    setVolume(v) { vol = Math.min(1, Math.max(0, v)); save(); }, setMuted(m) { muted = !!m; save(); },
    victory() { play('conquest'); play('conquest', 200); play('conquest', 400); play('confirm', 650); }
  };
})(window);
