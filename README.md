# Conquista Mundial — pixel art (HTML + CSS + JS vanilla)

## Ejecutar
Abre `index.html` con doble clic (no hace falta servidor: los datos van en `data/world-data.js`).
Las fuentes pixel art (Press Start 2P, VT323) se cargan de Google Fonts; sin red se usa una monoespaciada.

## Archivos
- `index.html`, `style.css`, `script.js` — interfaz, estilos y render/eventos.
- `audio.js` + `sounds/` — efectos (Kenney, MIT; ver `sounds/CREDITS.txt`) y volumen maestro (por defecto 50 %, botón OPCIONES, se guarda en localStorage).
- `engine.js` — lógica sin DOM (mapa raster, adyacencias, Poder, batalla). Separado para poder probarlo en Node.
- `data/world-data.js` — 196 países con geometría real (generado por `build_data.py`).
- `build_data.py` — fuente: `world-atlas@2.0.2` (Natural Earth 1:50m, dominio público; Tuvalu del 1:10m porque falta en el 50m).
  Regenerar: `npm pack world-atlas@2.0.2 && tar xzf world-atlas-2.0.2.tgz && python3 build_data.py package`.
- `tests/` — `node tests/test_engine.js` (mapa/adyacencias) y `node tests/test_sim.js` (batallas; tarda unos minutos), `node tests/test_sea_counter.js` (mar, contraataque, derrota, empate) y `node tests/test_power.js`.

## Criterio de los 196 países
193 miembros de la ONU + Ciudad del Vaticano + Palestina + Taiwán. Kosovo, Somalilandia y Chipre del Norte se integran en Serbia, Somalia y Chipre.
Territorios dependientes se asignan a su soberano (Groenlandia→Dinamarca, Puerto Rico→EE. UU., Hong Kong→China, etc.). **Sáhara Occidental se asigna a Marruecos** (administración de facto): es una simplificación de juego, no una posición política. Antártida y rocas deshabitadas se descartan. Lista completa en `meta.notes` del dataset.

## Cómo funciona
- **Proyección**: Natural Earth. Cada arco compartido se simplifica una vez (sin huecos entre vecinos) y se corta en el antimeridiano.
- **Rasterizado**: scanline even-odd a 1600 px de ancho → `ident` (país de cada píxel, inmutable). Estado político aparte en `owner`. Países diminutos garantizan 7 px (exageración documentada) para poder seleccionarlos.
- **Vecindad terrestre**: píxeles 4-vecinos de países distintos. **Marítima**: costas a ≤13 px (~280 km) con línea de visión sobre mar + lista explícita `SEA_EXTRA` + `SEA_BLOCK`; las islas aisladas del Pacífico/Índico se enlazan al vecino más cercano como último recurso (lista en consola: `[Mapa] … enlaces de último recurso`).
- **Disponibilidad dinámica**: se invade D si algún píxel realmente controlado toca píxeles de D (o hay mar cruzable desde píxeles controlados). Por eso una brecha abierta en Francia permite atacar a un tercer país, pero no a través de territorio enemigo intacto.
- **Poder base** de cada país: 0,30·población + 0,35·PIB + 0,15·área + 0,10·PIB per cápita + 0,10·media (log10 normalizado), Poder = 4 + 96·score². Datos aproximados y redondeados (~2023).
- **Poder del jugador** = base de su país + aportaciones guardadas: cada conquista aporta `0,30 × Poder base × 0,90^(conquistas previas)` (rendimientos decrecientes), calculado una sola vez al conquistar.
- **Rearme mundial (equilibrio de poder)**: cuando una potencia crece, los demás se alían y se rearman. Los países independientes usan Poder efectivo = base × (1 + 1,4·t), con t = crecimiento/(crecimiento + 60). Sube rápido al principio y satura. Es determinista y se muestra en el HUD y en los paneles. Todo ajustable en `CFG` (`CONTRIB_K`, `CONTRIB_DECAY`, `REARM_MAX`, `REARM_H`). `node tests/test_power.js` imprime la curva (p. ej. España tras 3 conquistas ≈ 96 vs Rusia 103; con 20 conquistas ≈ 181 vs Rusia 132 y EE. UU. 170).
- **Países conquistados desaparecen**: se pintan como parte del conquistador, sin frontera ni nombre, y cualquier clic sobre su antiguo territorio selecciona al país principal.
- **Batalla (dos bandos)**: autómata célula a cédula sobre la máscara de control, paso fijo de 1/30 s (independiente de los fps), RNG con semilla, ruido 3D para salientes/retrocesos. Jugador y defensor pelean por **cualquier píxel que toque al otro**: el jugador toma píxeles del defensor y el defensor **contraataca**, tanto recuperando lo suyo como conquistando territorio del jugador. Si el defensor es más fuerte avanza sobre tu país; si es más débil también intenta recuperar terreno. Las fronteras cambian de forma y pueden abrir brechas hacia terceros países.
- **Invasión por mar**: no hay píxeles en contacto, así que la batalla arranca con **desembarcos** (cabezas de playa) en las costas enlazadas, del atacante hacia el defensor y viceversa; después el frente crece como en tierra. Las islas o enclaves sin contacto reciben un desembarco cuando el ganador ya domina el resto del frente.
- **Fin de batalla**: conquista = el defensor deja de controlar ningún píxel (desaparece del mapa). **Derrota** = cae todo tu país inicial. Si pierdes más de la mitad de un país conquistado, deja de contar como tuyo y su aportación de Poder se retira. Cancelar conserva el frente (ganado o perdido).
- Empate exacto: probabilidad simétrica, sin bonus de frentes ni escalada, y el avance de cada bando está acotado (atacante 6–70 % del defensor; territorio ajeno arrebatado por el defensor ≤ ~35 % de su tamaño), así que nadie gana por accidente.
- Más frentes de contacto → bonus pequeño y acotado (nunca cambia el signo de la ventaja). Una sola invasión activa a la vez.

## Pruebas realizadas (Node + jsdom, sin navegador real)
Pasan: 196 países con píxeles; atacante fuerte conquista; defensor fuerte rechaza; empate 2000 s sin conquista (máx. 71 %); cancelar deja el mapa idéntico; reanudar continúa; Poder suma exactamente una vez; objetivo lejano rechazado; segunda invasión simultánea rechazada; determinismo; UI completa (menú, selección, confirmación, panel de acción, batalla, velocidad, cancelar, reinicio con panel) sin errores de consola.

## Pendiente de validar a mano en un navegador real
Rendimiento con zoom alto en móviles, gestos táctiles (pellizco), y revisión visual de ×8 y de varios frentes simultáneos. Las adyacencias marítimas por regla (≤280 km) pueden requerir ajustes de gusto en `SEA_EXTRA`/`SEA_BLOCK`.
