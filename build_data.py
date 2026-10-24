#!/usr/bin/env python3
"""Genera data/world-data.js a partir de world-atlas@2.0.2 (Natural Earth, dominio público).
Uso: npm pack world-atlas@2.0.2 && tar xzf world-atlas-2.0.2.tgz  (crea ./package)
     python3 build_data.py package
Pasos: 1) decodifica TopoJSON (50m; Tuvalu viene del 10m) 2) simplifica cada ARCO compartido
(Douglas-Peucker) para no abrir huecos entre vecinos 3) asigna territorios dependientes a su
soberano 4) añade nombre en español, población y PIB aproximados 5) calcula el área."""
import json, math, sys
SRC = sys.argv[1] if len(sys.argv) > 1 else 'package'
TOL = 0.035  # grados (~4 km); el píxel del juego es ~22 km

# num|ISO3|nombre|población (M, ~2023)|PIB (miles de M USD, ~2023, aprox.)
TABLE = """004|AFG|Afganistán|41|17;008|ALB|Albania|2.8|22;012|DZA|Argelia|45|190;020|AND|Andorra|0.08|3.3;024|AGO|Angola|36|85;028|ATG|Antigua y Barbuda|0.1|1.9;032|ARG|Argentina|46|640;051|ARM|Armenia|2.8|24;036|AUS|Australia|26|1700;040|AUT|Austria|9|470;031|AZE|Azerbaiyán|10.2|78;044|BHS|Bahamas|0.4|14;048|BHR|Baréin|1.5|44;050|BGD|Bangladés|172|460;052|BRB|Barbados|0.28|6;112|BLR|Bielorrusia|9.2|72;056|BEL|Bélgica|11.6|630;084|BLZ|Belice|0.4|3;204|BEN|Benín|13|19;064|BTN|Bután|0.78|3;068|BOL|Bolivia|12|46;070|BIH|Bosnia y Herzegovina|3.2|28;072|BWA|Botsuana|2.6|20;076|BRA|Brasil|216|2170;096|BRN|Brunéi|0.45|16;100|BGR|Bulgaria|6.4|100;854|BFA|Burkina Faso|23|20;108|BDI|Burundi|13|3;132|CPV|Cabo Verde|0.6|2.4;116|KHM|Camboya|17|31;120|CMR|Camerún|28|48;124|CAN|Canadá|40|2140;140|CAF|R. Centroafricana|5.5|2.6;148|TCD|Chad|18|13;152|CHL|Chile|19.6|340;156|CHN|China|1410|17900;170|COL|Colombia|52|360;174|COM|Comoras|0.85|1.3;178|COG|Congo|6|15;180|COD|R. D. del Congo|102|66;188|CRI|Costa Rica|5.2|86;384|CIV|Costa de Marfil|28|79;191|HRV|Croacia|3.9|82;192|CUB|Cuba|11|100;196|CYP|Chipre|1.3|32;203|CZE|Chequia|10.8|330;208|DNK|Dinamarca|5.9|400;262|DJI|Yibuti|1.1|3.5;212|DMA|Dominica|0.07|0.6;214|DOM|R. Dominicana|11.3|120;218|ECU|Ecuador|18|119;818|EGY|Egipto|112|400;222|SLV|El Salvador|6.3|34;226|GNQ|Guinea Ecuatorial|1.7|12;232|ERI|Eritrea|3.7|2.5;233|EST|Estonia|1.4|41;748|SWZ|Esuatini|1.2|4.5;231|ETH|Etiopía|126|160;242|FJI|Fiyi|0.93|5;246|FIN|Finlandia|5.6|300;250|FRA|Francia|68|3030;266|GAB|Gabón|2.4|20;270|GMB|Gambia|2.7|2.3;268|GEO|Georgia|3.7|30;276|DEU|Alemania|84|4450;288|GHA|Ghana|34|76;300|GRC|Grecia|10.4|240;308|GRD|Granada|0.12|1.2;320|GTM|Guatemala|17.6|104;324|GIN|Guinea|14|21;624|GNB|Guinea-Bisáu|2.1|2;328|GUY|Guyana|0.8|16;332|HTI|Haití|11.7|20;340|HND|Honduras|10.6|34;348|HUN|Hungría|9.6|210;352|ISL|Islandia|0.38|28;356|IND|India|1430|3550;360|IDN|Indonesia|277|1370;364|IRN|Irán|89|400;368|IRQ|Irak|45|270;372|IRL|Irlanda|5.2|550;376|ISR|Israel|9.8|520;380|ITA|Italia|59|2250;388|JAM|Jamaica|2.8|19;392|JPN|Japón|124|4210;400|JOR|Jordania|11.3|50;398|KAZ|Kazajistán|19.6|260;404|KEN|Kenia|55|108;296|KIR|Kiribati|0.13|0.25;408|PRK|Corea del Norte|26|18;410|KOR|Corea del Sur|51.7|1670;414|KWT|Kuwait|4.3|160;417|KGZ|Kirguistán|7|12;418|LAO|Laos|7.6|15;428|LVA|Letonia|1.9|39;422|LBN|Líbano|5.4|20;426|LSO|Lesoto|2.3|2;430|LBR|Liberia|5.4|4;434|LBY|Libia|6.9|40;438|LIE|Liechtenstein|0.04|7;440|LTU|Lituania|2.8|70;442|LUX|Luxemburgo|0.66|85;450|MDG|Madagascar|30|15;454|MWI|Malaui|21|13;458|MYS|Malasia|34|400;462|MDV|Maldivas|0.52|6;466|MLI|Malí|23|19;470|MLT|Malta|0.54|20;584|MHL|Islas Marshall|0.04|0.26;478|MRT|Mauritania|4.9|10;480|MUS|Mauricio|1.3|14;484|MEX|México|128|1790;583|FSM|Micronesia|0.11|0.43;498|MDA|Moldavia|2.6|14;492|MCO|Mónaco|0.04|8.6;496|MNG|Mongolia|3.4|19;499|MNE|Montenegro|0.62|7;504|MAR|Marruecos|37|134;508|MOZ|Mozambique|33|18;104|MMR|Myanmar|54|65;516|NAM|Namibia|2.6|12;520|NRU|Nauru|0.012|0.14;524|NPL|Nepal|30|40;528|NLD|Países Bajos|17.6|1120;554|NZL|Nueva Zelanda|5.2|250;558|NIC|Nicaragua|6.9|17;562|NER|Níger|26|17;566|NGA|Nigeria|224|450;807|MKD|Macedonia del Norte|1.8|14;578|NOR|Noruega|5.5|580;512|OMN|Omán|4.6|105;586|PAK|Pakistán|240|340;585|PLW|Palaos|0.018|0.25;591|PAN|Panamá|4.4|83;598|PNG|Papúa Nueva Guinea|10|31;600|PRY|Paraguay|6.8|42;604|PER|Perú|34|267;608|PHL|Filipinas|117|440;616|POL|Polonia|37.7|810;620|PRT|Portugal|10.4|290;634|QAT|Catar|2.7|220;642|ROU|Rumanía|19|350;643|RUS|Rusia|144|2020;646|RWA|Ruanda|14|14;659|KNA|San Cristóbal y Nieves|0.05|1.1;662|LCA|Santa Lucía|0.18|2.4;670|VCT|San Vicente y las Granadinas|0.1|1;882|WSM|Samoa|0.22|0.9;674|SMR|San Marino|0.034|1.8;678|STP|Santo Tomé y Príncipe|0.23|0.6;682|SAU|Arabia Saudita|36|1070;686|SEN|Senegal|18|28;688|SRB|Serbia|6.7|75;690|SYC|Seychelles|0.1|2;694|SLE|Sierra Leona|8.6|4;702|SGP|Singapur|5.9|500;703|SVK|Eslovaquia|5.4|130;705|SVN|Eslovenia|2.1|68;090|SLB|Islas Salomón|0.74|1.6;706|SOM|Somalia|18|11;710|ZAF|Sudáfrica|60|380;728|SSD|Sudán del Sur|11|6;724|ESP|España|48|1580;144|LKA|Sri Lanka|22|75;729|SDN|Sudán|48|34;740|SUR|Surinam|0.62|3.5;752|SWE|Suecia|10.5|590;756|CHE|Suiza|8.8|880;760|SYR|Siria|23|11;762|TJK|Tayikistán|10|12;764|THA|Tailandia|71.8|500;626|TLS|Timor Oriental|1.4|2;768|TGO|Togo|9|9;776|TON|Tonga|0.1|0.5;780|TTO|Trinidad y Tobago|1.5|28;788|TUN|Túnez|12|48;792|TUR|Turquía|85|1110;795|TKM|Turkmenistán|6.5|60;798|TUV|Tuvalu|0.011|0.06;800|UGA|Uganda|48|49;804|UKR|Ucrania|37|160;784|ARE|Emiratos Árabes Unidos|9.5|510;826|GBR|Reino Unido|67|3340;834|TZA|Tanzania|67|79;840|USA|Estados Unidos|335|27360;858|URY|Uruguay|3.4|77;860|UZB|Uzbekistán|36|90;548|VUT|Vanuatu|0.33|1.1;336|VAT|Ciudad del Vaticano|0.0008|0.3;862|VEN|Venezuela|28|100;704|VNM|Vietnam|99|430;887|YEM|Yemen|34|21;894|ZMB|Zambia|20|27;716|ZWE|Zimbabue|16.3|35;275|PSE|Palestina|5.4|18;158|TWN|Taiwán|23.4|790"""
STATS = {}
for row in TABLE.split(';'):
    n, iso, name, pop, gdp = row.split('|')
    STATS[n] = dict(iso=iso, name=name, pop=float(pop), gdp=float(gdp))
assert len(STATS) == 196, len(STATS)

# Territorios / regiones sin entrada propia -> soberano (por nombre del dataset). None = se descarta.
ABSORB = {
 'Kosovo':'688','Somaliland':'706','N. Cyprus':'196','W. Sahara':'504',
 'Greenland':'208','Faeroe Is.':'208','Åland':'246',
 'American Samoa':'840','Guam':'840','N. Mariana Is.':'840','Puerto Rico':'840','U.S. Virgin Is.':'840',
 'Bermuda':'826','British Virgin Is.':'826','Cayman Is.':'826','Falkland Is.':'826','Montserrat':'826',
 'Pitcairn Is.':'826','Saint Helena':'826','Turks and Caicos Is.':'826','Anguilla':'826','Guernsey':'826',
 'Jersey':'826','Isle of Man':'826','S. Geo. and the Is.':'826','Br. Indian Ocean Ter.':'826',
 'Hong Kong':'156','Macao':'156','Aruba':'528','Curaçao':'528','Sint Maarten':'528',
 'Fr. Polynesia':'250','New Caledonia':'250','St-Barthélemy':'250','St-Martin':'250',
 'St. Pierre and Miquelon':'250','Wallis and Futuna Is.':'250','Fr. S. Antarctic Lands':'250',
 'Cook Is.':'554','Niue':'554','Norfolk Island':'036','Heard I. and McDonald Is.':'036',
 'Indian Ocean Ter.':'036','Siachen Glacier':'356',
 'Antarctica':None,'Ashmore and Cartier Is.':None,
}

def decode(topo):
    sx, sy = topo['transform']['scale']; tx, ty = topo['transform']['translate']
    arcs = []
    for a in topo['arcs']:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy; pts.append((x*sx+tx, y*sy+ty))
        arcs.append(pts)
    return arcs

def dp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False]*len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts)-1)]
    while st:
        a, b = st.pop(); (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx-ax, by-ay; L = math.hypot(dx, dy); md = -1; mi = -1
        for i in range(a+1, b):
            px, py = pts[i]
            d = math.hypot(px-ax, py-ay) if L == 0 else abs(dy*(px-ax)-dx*(py-ay))/L
            if d > md: md, mi = d, i
        if md > tol: keep[mi] = True; st += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]

def build_ring(ring, arcs):
    pts = []
    for ai in ring:
        seg = arcs[ai] if ai >= 0 else arcs[~ai][::-1]
        pts += seg if not pts else seg[1:]
    return pts

def rings_of(geom, arcs, raw):
    polys = geom['arcs'] if geom['type'] == 'MultiPolygon' else [geom['arcs']]
    out = []
    for poly in polys:
        for ring in poly:
            pts = build_ring(ring, arcs)
            if len(pts) < 4: pts = build_ring(ring, raw)  # islotes diminutos: conservar sin simplificar
            if len(pts) >= 4: out.append(pts)
    return out

def area_km2(ring):
    R = 6371.0; s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]+ring[:1]):
        s += math.radians(x2-x1)*(2+math.sin(math.radians(y1))+math.sin(math.radians(y2)))
    return s*R*R/2

def unwrap(r):
    out = [r[0]]
    for x, y in r[1:]:
        px = out[-1][0]
        while x - px > 180: x -= 360
        while x - px < -180: x += 360
        out.append((x, y))
    return out

def clip(ring, lim, keep_less):
    # Sutherland-Hodgman contra la recta vertical x = lim
    inside = (lambda p: p[0] <= lim) if keep_less else (lambda p: p[0] >= lim)
    def cut(a, b):
        t = (lim - a[0]) / (b[0] - a[0]); return (lim, a[1] + t * (b[1] - a[1]))
    out = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if inside(a):
            out.append(a)
            if not inside(b): out.append(cut(a, b))
        elif inside(b): out.append(cut(a, b)); 
    return out

def split_antimeridian(r):
    u = unwrap(r)
    if abs(u[-1][0] - u[0][0]) > 1: return []  # anillo polar (Antártida): descartado
    pieces = [u]
    if max(p[0] for p in u) > 180:
        pieces = [q for p in pieces for q in (clip(p, 180, True), [(x-360, y) for x, y in clip(p, 180, False)])]
    if min(p[0] for p in u) < -180:
        pieces = [q for p in pieces for q in (clip(p, -180, False), [(x+360, y) for x, y in clip(p, -180, True)])]
    return [p for p in pieces if len(p) >= 4]

def load(name):
    t = json.load(open(f'{SRC}/countries-{name}.json')); raw = decode(t)
    return t['objects']['countries']['geometries'], [dp(a, TOL) for a in raw], raw

g50, a50, r50 = load('50m'); g10, a10, r10 = load('10m')
bucket = {k: [] for k in STATS}; log = []
def put(key, rings, label):
    bucket[key] += rings
for g in g50:
    nm = g['properties']['name']; gid = g.get('id'); rr = rings_of(g, a50, r50)
    if nm in ABSORB:
        if ABSORB[nm]: put(ABSORB[nm], rr, nm); log.append(f'{nm} -> {STATS[ABSORB[nm]]["iso"]}')
        else: log.append(f'{nm} descartado')
    elif gid in STATS and not (gid == '036' and nm != 'Australia'): put(gid, rr, nm)
    else: log.append(f'SIN CLASIFICAR: {gid} {nm}')
for g in g10:
    if g['properties']['name'] == 'Tuvalu': put('798', rings_of(g, a10, r10), 'Tuvalu'); log.append('Tuvalu <- 10m (falta en 50m)')
out = []
for n, st in sorted(STATS.items(), key=lambda kv: kv[1]['iso']):
    rr = bucket[n]; assert rr, n
    ar = abs(sum(area_km2(unwrap(r)) for r in rr))
    rr = [q for r in rr for q in split_antimeridian(r)]
    out.append(dict(id=st['iso'], name=st['name'], pop=st['pop'], gdp=st['gdp'], area=round(ar),
                    rings=[[[round(x, 2), round(y, 2)] for x, y in r] for r in rr]))
meta = dict(source='world-atlas@2.0.2 (Natural Earth 1:50m, 1:10m solo Tuvalu)', criterion='193 miembros de la ONU + Ciudad del Vaticano + Palestina + Taiwán = 196; territorios dependientes y regiones en disputa se asignan a un país (ver notas)', notes=log)
open('data/world-data.js', 'w', encoding='utf-8').write('/* Generado por build_data.py - no editar a mano */\nwindow.WORLD_DATA=' + json.dumps(dict(meta=meta, countries=out), ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(out), 'países;', sum(len(c['rings']) for c in out), 'anillos;', sum(len(r) for c in out for r in c['rings']), 'vértices')
print('\n'.join(l for l in log if 'SIN' in l) or 'sin clasificar: ninguno')
