# CONQUISTA MUNDIAL — Contexto técnico del proyecto

> Documento pensado para que otra instancia de Claude (extensión de VS Code) entienda el proyecto completo y pueda continuar. Estado a **24-10-2026**. Todo lo que aquí se afirma como "probado" se probó con **Node + jsdom**, **no en un navegador real**.

---

## 1. Qué es

Juego de estrategia para navegador, pixel art, **HTML + CSS + JavaScript vanilla** (sin frameworks). El jugador elige uno de **196 países** sobre un mapa mundial con geometría real y conquista el mundo invadiendo vecinos (por tierra o por mar). Las invasiones se animan como una batalla de píxeles entre dos "capas de pintura" con frente irregular, referenciado a un vídeo del usuario (Francia vs España).

Interfaz y mensajes **100 % en español**. Sin `alert()`: todo con paneles integrados.

### Vídeo de referencia (1000141945.mp4, 864×1920, ~7,6 s)
Mapa Francia/España pixelado, frente irregular morado vs naranja que avanza y retrocede, bordes negros gruesos escalonados, etiquetas inclinadas con contorno, flechitas pequeñas (chevrones) en los puntos de contacto, barra inferior (Pausa / Parar / Velocidad ×1 / **Resistencia Sí/No**). El botón "Resistencia" **no se implementó** como control (el usuario no lo pidió); ahora el defensor siempre contraataca (ver §7).

### Especificación original
El prompt completo del usuario (20 secciones) es la especificación. Requisitos clave que siguen vigentes: separar geometría / control político / máscara de píxeles / Poder / frentes / conexiones / velocidad; simulación determinista con semilla y **paso fijo** (no depender de fps); empate exacto = empate permanente; cancelar conserva el estado; no hay "habilidad de brecha": la estrategia emerge de la mecánica; los países no invadidos son pasivos. **Prioridad absoluta del usuario: funcional y honesto antes que demo vistosa; si algo no se puede, decirlo.**

---

## 2. Cómo ejecutar

- Abrir `index.html` con doble clic (no hace falta servidor: los datos van en `data/world-data.js`, no se usa `fetch`).
- Fuentes Press Start 2P y VT323 desde Google Fonts (sin red cae a monoespaciada).
- Orden de scripts en `index.html`: `data/world-data.js` → `engine.js` → `audio.js` → `script.js`.
- Consola: al arrancar imprime `[Mapa] países … adyacencias terrestres … marítimas … enlaces de último recurso`.
- Depuración: `window.__game` expone `{world, game, view, pick, clickAt}`.

### Regenerar datos
```
npm pack world-atlas@2.0.2 && tar xzf world-atlas-2.0.2.tgz      # crea ./package
python3 build_data.py package                                     # escribe data/world-data.js
```

### Tests (Node, desde la raíz del proyecto)
- `node tests/test_engine.js` — construye el mundo, imprime adyacencias/poderes.
- `node tests/test_power.js` — curva de Poder tras N conquistas.
- `node tests/test_sea_counter.js` — **vigente**: mar, contraataque, derrota, empate.
- `node tests/test_sim.js` — **parcialmente obsoleto**: se escribió para el modelo anterior (estado `repelled`, defensor pasivo). Úsalo solo como referencia o reescríbelo.
- Las pruebas de interfaz (jsdom + `canvas`, simulan clics, comprueban paneles/sonido/volumen) vivían en `/home/claude/smoke/` en el sandbox web y **no están en el proyecto**. Habría que recrearlas si se quiere regresión de UI.

---

## 3. Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Estructura: canvas `#map`, menú, HUD, panel info `#info`, panel acción `#action`, panel batalla `#battle`, zoom, leyenda, toast, modal genérico. |
| `style.css` | Estética pixel art: paneles con borde escalonado vía `box-shadow`, botones retro (hover/active/disabled), paleta limitada en variables CSS, responsive (≤900 px y ≤640 px). |
| `script.js` | UI + render Canvas 2D + bucle `requestAnimationFrame` único + eventos (se registran una sola vez). Sin lógica de juego. |
| `engine.js` | **Lógica pura sin DOM** (exporta `Engine` en `window` o `module.exports`): rasterizado, adyacencias, Poder, partida, invasión. Testeable en Node. |
| `audio.js` | `window.Sfx`: efectos, volumen maestro (def. 50 %), mute, persistencia en `localStorage`. |
| `data/world-data.js` | `window.WORLD_DATA` generado (551 KB): 196 países con anillos lon/lat, población, PIB, área. **No editar a mano.** |
| `build_data.py` | Genera el dataset desde `world-atlas@2.0.2`. |
| `sounds/*.mp3` + `CREDITS.txt` | 8 efectos de Kenney (MIT). |
| `README.md` | Resumen de usuario. Este documento es más completo. |
| `tests/` | Ver §2. |

El usuario pidió "exactamente tres archivos principales"; el propio prompt permitía separar JS extra. Se añadieron `engine.js`, `audio.js` y `data/` por organización y para poder testear en Node.

---

## 4. Datos y mapa

### Fuente
`world-atlas@2.0.2` (Natural Earth, dominio público), TopoJSON `countries-50m`; `countries-10m` solo para **Tuvalu** (falta en 50m).

### Criterio de los 196 países
193 miembros ONU + **Ciudad del Vaticano + Palestina + Taiwán**. Se asignan a un soberano (la tabla `ABSORB` de `build_data.py`): Kosovo→Serbia, Somalilandia→Somalia, Chipre del Norte→Chipre, **Sáhara Occidental→Marruecos** (simplificación de juego, no postura política), Groenlandia/Feroe→Dinamarca, territorios de EE. UU./RU/Francia/NL/NZ/AU/China a su soberano, Siachen→India. **Descartados:** Antártida y Ashmore & Cartier. El log completo está en `WORLD_DATA.meta.notes`. Tabla `TABLE` de `build_data.py` = ISO numérico | ISO3 | nombre ES | población (M) | PIB (miles de M USD), valores **aproximados ~2023**. Hay un `assert len == 196`.

### Pipeline (`build_data.py`)
1. Decodifica TopoJSON.
2. **Simplifica cada ARCO compartido** (Douglas-Peucker, `TOL=0.035°`) → los vecinos no se separan ni se solapan.
3. Anillos con <4 puntos tras simplificar (islotes) se reconstruyen desde el arco **sin simplificar**.
4. **Antimeridiano**: desenrolla longitudes y corta con Sutherland-Hodgman en ±180° (Rusia, EE. UU./Alaska, Fiyi, Kiribati…). Anillos polares descartados.
5. Calcula área (esférica) para el Poder.
Resultado: 196 países, 1531 anillos, 36 727 vértices.

### Rasterizado (`Engine.build`)
- Proyección **Natural Earth** (Šavrič 2015), lienzo interno **W=1600, H=715** (`CFG.W`).
- Scanline even-odd; países grandes primero para que enclaves pequeños queden encima.
- `ident` (Uint16Array W·H): país de cada píxel, **inmutable**. `MIN_PX=7`: países diminutos (Vaticano, Mónaco, Nauru, Tuvalu…) se ensanchan hasta 7 píxeles para poder seleccionarse (exageración documentada).
- Componentes conexas (islas) en `comp`, con `compCount`, `compFirst`, `compIdent`, `compsOf[país]`.
- `labelX/Y` = centroide de la isla mayor (forzado a caer dentro del país).
- `pxStart/pxList`: píxeles por país (counting sort) para repintar/escanear rápido.
- `kmPerPx ≈ 7325/scale` (~22 km/px aprox.).
- Coloreado voraz sobre el grafo terrestre con 8 colores (`colorOf`).
- Build ≈ 450–480 ms en Node.

### Adyacencias
- **Terrestre**: pares de píxeles 4-vecinos con `ident` distintos → `world.land` (Map clave `a*1024+b` con `a<b`, valor `{lo:[], hi:[]}`; `lo[k]` pertenece al país menor) y `landNbr[c]` (Set). 317 pares.
- **Marítima** (regla configurable + explícita): costas a ≤ `SEA_MAX_PX=13` px (~280 km) con **línea de visión solo sobre mar**; más lista `SEA_EXTRA` (ISL–DNK, ISL–GBR, JPN–KOR, AUS–IDN/PNG/NZL, LKA–IND, CUB–USA/MEX, MDG–MOZ, MUS–MDG, CYP–TUR/SYR/LBN) y `SEA_BLOCK` (vacío). Cada par guarda hasta 14 muestras de costa `{lo,hi,d}`. 122 pares.
- **Enlaces de último recurso** (`bridges`): islas aisladas del Pacífico/Índico se enlazan al país más cercano hasta que el grafo sea conexo (tope `SEA_BRIDGE_MAX_PX=140`). Actualmente 13: COM–MOZ, CPV–SEN, FJI–VUT, FSM–PNG, MDV–IND, MHL–NRU, PLW–IDN, SYC–MDG, TON–WSM, TUV–FJI, NRU–SLB, WSM–NZL, VUT–SLB. Se listan en consola.

---

## 5. Modelo de estado (engine.js)

`Engine.build(data, cfg)` → **world** (estático): `W,H,N,kmPerPx,cfg,ident,comp,compCount,compFirst,compIdent,compsOf,countries[1..N],byIso,pxStart,pxList,land,landNbr,sea,seaNbr,colorOf,bridges,report`. `countries[i]`: `idx,id(ISO3),name,pop,gdp,area,power(base),total(px),comps,labelX,labelY,mainCount`.

`Engine.createGame(world, playerIdx)` → **game** (mutable):
- `owner` (Uint16Array): **quién controla cada píxel hoy** (la máscara dinámica). `ident` nunca cambia.
- `partial[c]`: píxeles del territorio de `c` que controla el jugador. `own[o]`: píxeles que controla hoy el país `o` (de cualquier origen). `compCap[comp]`: píxeles del jugador por isla. `compD`/`trackD`: píxeles del defensor por isla (solo durante invasión).
- `conquered` (Set), `conqList` [[país, aportación]], `growth` (suma de aportaciones), `alive` (países con ≥1 píxel, sin contar al jugador), flags `won`, `lost`, `defeated`.
- `dirty[]` (píxeles cambiados para repintar), `fflag` (marca de frente), `speed`, `invasion`, `invCount`.
- Métodos: `playerPower, threat, rearmPct, powerOf, conquer, revoke, isFull, setOwner, stateOf, foreignOf, availability, touches, invadables, contacts, arrows, startInvasion, cancelInvasion`.
- **`setOwner(i,o)` es el único punto donde cambia el control**: mantiene `partial/own/compCap/compD`, decrementa `alive` cuando un país llega a 0 píxeles, revoca conquistas perdidas y marca derrota.

Estados de invasión: `null` (sin invasión) · `active` · `cancelled` · `conquered` · `lost`. (`repelled` **ya no existe**).

Una sola invasión activa a la vez (`startInvasion` rechaza otra con mensaje).

### Disponibilidad dinámica (clave de la estrategia emergente)
`availability(D)` es true si algún píxel **realmente controlado** por el jugador toca píxeles de `D` (tierra), o hay muestra de costa marítima con `owner[pa]==jugador && owner[pd]==D`, o `partial[D]>0` (frente ya abierto). Si `D` ha capturado territorio ajeno se escanea el mapa entero. Por eso una brecha abierta en un país abre acceso a un tercero, pero **no** a través de territorio enemigo intacto.

---

## 6. Sistema de Poder

- **Base** (`computePowers`): variables en log10 normalizadas a [0,1]; `base = 0.30·pob + 0.35·PIB + 0.15·área + 0.10·PIBpc`; `score = base/0.90·0.9 + 0.10·media(4 variables)`; **`Poder = round(4 + 96·score²)`**. Ej.: EE. UU. 88, China 86, Rusia 68, Brasil 68, Alemania 67, Francia 65, Italia 62, España 60, Portugal 46, Marruecos 45, Andorra 17, Vaticano 7, Tuvalu 6. Determinista. Hay empates exactos naturales (p. ej. NRU/VAT = 7).
- **Poder del jugador** = base de su país + `growth`. Cada conquista aporta `max(1, round(0.30·PoderBase·0.90^(conquistas previas)))`, calculado **una sola vez** y guardado en `conqList`.
- **Rearme mundial** (decisión de diseño tras queja del usuario): Poder efectivo de los independientes = `round(base·(1 + 1.4·t))`, `t = growth/(growth+60)`. Se muestra en HUD ("REARME MUNDIAL +x %") y paneles ("97 (base 79)").
  - Tras 3 conquistas (ESP: PRT, AND, FRA): España ≈ 96 vs Rusia ≈ 86–103 según parámetros; con 20 conquistas ≈ 181–201 vs Rusia ≈ 108–132. Valores finales: `CONTRIB_DECAY 0.90, REARM_MAX 1.4, REARM_H 60, CONTRIB_K 0.30`.
- `revoke(c)`: si el defensor te quita más de la mitad de un país conquistado, deja de contar como tuyo y se resta su aportación.
- Limitación conocida: el Poder de un defensor **no** sube por el territorio que absorbe.

---

## 7. Batalla (clase `Invasion`)

Autómata celular sobre `owner`, **paso fijo `STEP_DT=1/30 s`**, `advance(dt)` acumula tiempo y ejecuta hasta 400 pasos; la velocidad ×1/×2/×4/×8 multiplica `dt` (simulación real, no efecto). RNG `mulberry32` con semilla `D*7919 + invCount*104729` ⇒ determinista. Ruido de valor 3D (`noise3`) modula la presión local (salientes y retrocesos).

- **Dos bandos**: jugador P y defensor D pelean por **cualquier píxel que toque al otro**, sea cual sea su origen. P convierte píxeles de D (`toP`); D **contraataca** convirtiendo píxeles de P (`toD`), tanto los suyos como territorio del jugador. Si D es más fuerte avanza sobre tu país; si es más débil también intenta recuperar terreno.
- **Probabilidad** (`attackProb`): `diff = A − D`. Si `diff===0` → exactamente 0.5 (sin bonus de frentes ni escalada). Si no: `p = 0.5 + sign·max(0.05, P_SPAN·tanh(|diff|/(A+D)·REL_GAIN))` + bonus de frentes `min(FRONT_BONUS_MAX, FRONT_BONUS·(frentes−1))`, `p` forzado a ≥0.55 o ≤0.45 según signo, escalada si dura > `T_SOFT` (100 s), y clamp [0.03, 0.9]. Cualquier diferencia ≠0 inclina siempre la balanza. `BASE_RATE=0.12` calibra la velocidad (era 0.5 y las conquistas duraban 1–2 s).
- **Empate exacto**: simétrico; el avance está acotado (jugador sobre D: `TIE_CAP=0.7` / `TIE_FLOOR=0.06` del territorio de D; territorio ajeno arrebatado por D ≤ `max(30, 0.35·total)`). Probado: 2000 s sin conquista ni derrota.
- **Invasión por mar**: no hay píxeles en contacto, así que cada 10 pasos se intentan **desembarcos** (`blob`: píxel + vecinos con prob. 0.6) en las muestras de costa enlazadas, de P hacia D y de D hacia P, con probabilidad `LAND_P·2·p`. Luego el frente crece como en tierra.
- **Islas sin contacto**: cada 15 pasos, si el bando ganador ya domina lo tocado, recibe una cabeza de playa en islas/enclaves del perdedor sin contacto (usa `compD`/`compCap`).
- **Frentes múltiples**: `contacts(D).fronts` = nº de países fuente distintos en contacto; da el bonus acotado. `arrows(D)` agrupa contactos en celdas de 11 px (máx. 28 flechas) + hasta 6 flechas marítimas con trayecto punteado.
- **Fin**: `own[D]===0` → `conquered` (suma Poder una vez, `g.alive===0` ⇒ victoria). `g.defeated` (cae el país inicial) → `lost` (pantalla de DERROTA). Cancelar → `cancelled`, conserva el mapa tal cual.
- Tiempos orientativos simulados a ×1 (tras reescritura): JPN→KOR ≈ 23 s, GBR→IRL ≈ 20 s, ESP→MAR ≈ 42 s, AUS→NZL ≈ 103 s, CUB→HTI ≈ 10 s. ESP(60)→FRA(65): **derrota total en ≈ 105 s** simulados (≈ 13 s a ×8).

---

## 8. Interfaz y render (script.js)

- **Render**: `mapCv` (canvas fuera de pantalla W×H) con `ImageData`/`Uint32Array`; se escala con `imageSmoothingEnabled=false` al canvas visible. **Repintado incremental**: `applyDirty()` solo reescribe el rectángulo cambiado; `repaintCountry(c)` al cambiar resaltados. Un único `requestAnimationFrame`; se redibuja si `needsDraw` o hay flechas.
- **Bordes**: *duro* (negro, costa/frontera entre países distintos) vs *blando* (oscurecido del color del dueño, frente de batalla dentro de un mismo país). Textura de ruido sutil por píxel. Resaltados (`hl`): 1 invadible, 2 seleccionado, 3 en invasión; **no se aclara territorio del jugador**.
- **Etiquetas**: se dibujan por tamaño decreciente, evitando solapes; **un país sin ningún píxel (`own===0`) desaparece**; el país del jugador escala con `terr = own[player]`.
- **Flechas**: chevrones/flechas de píxel de tamaño fijo en pantalla, dirección cuantizada a 8 rumbos, animación por fases.
- **Selección** (`pick`): por quién **controla** el píxel (`owner`), con tolerancia ≤4 px para islas pequeñas. Un país conquistado ya no existe: su antiguo territorio pertenece al conquistador.
- **Zoom/pan**: pointer events (arrastre, pellizco de 2 dedos, rueda), botones +/−/⌖, límites de vista.
- **Flujo**: fases `loading → pick → play → (won|lost)`. Paneles: info (país, Poder, estado, quién controla), acción (Poder atacante/defensor, diferencia, conexión, INVADIR/CANCELAR con avisos de peligro/empate/frentes), batalla (%, Poder, frentes, tendencia, ×1/×2/×4/×8, CANCELAR INVASIÓN), modales (guía, opciones, reiniciar con confirmación, victoria, derrota). Aviso de contraataque cuando `lostOutside ≥ 25`.
- **Sonido** (`audio.js`): `click, select, confirm, invade, cancel, conquest, defeat, error` + `Sfx.victory()` (secuencia de `conquest`+`confirm`; no se encontró una fanfarria). Volumen por defecto **50 %**, mute, `localStorage` (`cm_volume`, `cm_muted`). Botón OPCIONES en menú y HUD. Los botones con sonido propio llevan `data-nosound`.

---

## 9. Historial de decisiones y errores resueltos

1. **Mapa**: raster de máscara en vez de vectores en canvas → permite control por píxel, selección barata y la animación pedida. Natural Earth elegida por reconocibilidad.
2. **Bandas horizontales** de Rusia/Alaska/Fiyi (anillos cruzando ±180°) → desenrollar + recortar en `build_data.py`.
3. **Crash del script de datos** (`assert` en Vaticano id 336) → anillos de <4 puntos tras simplificar se reconstruyen sin simplificar.
4. **Batallas casi instantáneas** (1–2 s) → `BASE_RATE` 0.5 → 0.12 y comprobación de que la ventaja ≠0 siempre decide (sesgo mínimo 5 %).
5. **Rendimiento del motor**: `contested()` sin alocaciones; compactación de frente deduplicada; coste ~0.05–0.25 ms/paso.
6. **Aspecto del frente**: borde duro/blando; flechas rediseñadas (primer chevron no se leía → flecha con asta).
7. **Tras 1.ª entrega, 3 correcciones del usuario**:
   - *Países conquistados desaparecen*: se pintan como parte del conquistador, sin nombre ni frontera; clic sobre ellos = país principal.
   - *Poder desbalanceado* (España 131 tras 3 conquistas, 196 en la frontera rusa) → rendimientos decrecientes + **rearme mundial** (equilibrio de poder). Se descartó la suma lineal `0.4·Poder`; se hizo barrido numérico de parámetros antes de fijarlos.
   - *Sonidos + opciones de volumen*: efectos Kenney (MIT) de repos Starter Kit en GitHub, convertidos a MP3 mono 22 kHz; volumen 50 %.
8. **Bug de invasión marítima congelada**: el frente solo contenía parejas de píxeles en contacto; por mar no existen, así que no se movía nada → desembarcos (`blob`) + tratamiento de islas sin contacto.
9. **Cambio de mecánica "el defensor contraataca"**: se reescribió `Invasion` como lucha simétrica por propiedad de píxel; se añadieron `own[]`, `foreignOf`, `revoke`, `alive`, derrota y pantalla de DERROTA. `pick`/etiquetas/`availability`/`contacts` pasaron a usar `owner` y no `ident`.
10. **Error de sintaxis** en `script.js` causado por un comentario insertado en medio de una línea de `pick()` (corregido).
11. **Fallo de la prueba de humo** "invasiones incompatibles": era de la prueba (Portugal ya conquistado a ×8 antes de comprobar). El comportamiento del motor era correcto; se reordenó la prueba.
12. Se limpiaron `tests/` (eliminados scripts de tuning) y `test_engine.js` ya no exporta el mundo.

---

## 10. Limitaciones conocidas / deuda técnica

- **No validado en navegador real**: rendimiento con zoom alto en móvil, gestos táctiles, ×8 con varios frentes, fuentes web. Las pruebas de UI fueron con jsdom.
- **Rendimiento potencial**: si `foreignOf(D) > 0`, `availability` y `contacts` recorren los 1,14 M de píxeles; `refreshHighlights()` llama a `invadables()` (196 países) en cada cambio. Conviene vigilar/optimizar (p. ej. índice de píxeles arrebatados).
- **Velocidad de derrota** alta con rival ligeramente más fuerte; se regula con `BASE_RATE` (afecta también a conquistas).
- Un defensor que absorbe territorio no gana Poder.
- Adyacencias marítimas por regla (≤280 km) y puentes de último recurso: criterio mío, ajustar con `SEA_EXTRA`/`SEA_BLOCK`. Sáhara Occidental→Marruecos es simplificación de juego.
- Datos de población/PIB aproximados y redondeados.
- `tests/test_sim.js` obsoleto; no hay tests de UI en el proyecto.
- No hay botón Pausa/Parar ni conmutador "Resistencia" como en el vídeo (no pedidos). No hay guardado de partida.
- Victoria: la fanfarria reutiliza el sonido de conquista.
- Guía del juego (modal AYUDA) cubre: elegir país, enemigo, Poder y rearme, países conquistados, invadir, velocidad, contraataque, cancelar, mar, brechas, empate, controles.

## 11. Ideas de siguiente paso

1. Probar en Chrome/Firefox y móvil; revisar consola y rendimiento (§10).
2. Reescribir `tests/test_sim.js` para el modelo de dos bandos y añadir tests de UI recreando el flujo de jsdom.
3. Afinar equilibrio (`BASE_RATE`, `P_SPAN`, `REARM_*`) jugando partidas completas con distintos países iniciales (países pequeños pueden sufrir mucho rearme).
4. Optimizar escaneos globales de `availability/contacts`.
5. Opcional: pausa, indicador de dificultad, guardado, minimapa, ajustes de sonido separados.

---

## 12. Convenciones

- Todo texto de UI en español; comentarios de código en español.
- Un solo bucle de render; listeners registrados una vez; la simulación nunca depende de los fps.
- Cambios de control **siempre** por `game.setOwner`.
- No tocar `world.ident` ni la geometría tras `build`.
- Parámetros de balance centralizados en `CFG` (`engine.js`); no hardcodear en `script.js`.
