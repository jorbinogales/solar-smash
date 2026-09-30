// Planetas procedurales. Principios de rendimiento (importante con varios jugadores: cada cliente solo procesa lo que ve):
//  - El terreno solo existe para el mundo más cercano y solo por debajo de PREBUILD km de altura; el resto son esferas.
//  - Los anillos de terreno se construyen en un generador repartido entre cuadros (presupuesto de ms), sin tirones, y se intercambian al terminar.
//  - Los objetos (árboles, flora, rocas, minerales) se generan por celdas SOLO cuando la celda entra en el campo de visión (frustum), con caché
//    determinista (todos los jugadores ven lo mismo) y solo se dibujan las celdas visibles.
// Usa fbm/vn/h3 (game.js), piece/merge/Cy/B (space.js) y rndOf (ships.js).
const HI_ALT = 80, LOWCAP = 13.89, SOFTV = 0.99, TALT = 350, // bajo 80 km de altura solo se vuela a km/h (motor de combustión, < 1 km/s); los km/s solo a partir de 80 km
   PREBUILD = 500, NG = 96, RINGS = [1.2, 10, 80, 640, 4000]; // altitud de fundido, de preconstrucción (km), celdas por lado, semitamaños (km)
const ATM_MAX = 0.85, ENTRY_MAX = 60, BRAKE_ALT = 5, LOW_ALT = 1; // ATM_MAX ≈ 3060 km/h (combustión bajo LOW_ALT km); ENTRY_MAX km/s al entrar; frenado gradual desde BRAKE_ALT km
const ATMO = { // color del cielo y altura de la atmósfera (km); Luna y Mercurio no tienen
  Tierra: { c: 0x6fb4ff, H: 120 }, Venus: { c: 0xe8c070, H: 250 }, Marte: { c: 0xd9a37a, H: 50 }, 'Júpiter': { c: 0xd6b48a, H: 400 },
  Saturno: { c: 0xe8d8a0, H: 400 }, Urano: { c: 0x8fe0e4, H: 300 }, Neptuno: { c: 0x5a82e8, H: 300 },
};
const hatm = b => (ATMO[b.n] ? ATMO[b.n].H : 30);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fb = (x, y, z, n = 4) => { let s = 0, a = 0.5, t = 0; for (let i = 0; i < n; i++) { s += a * vn(x, y, z); t += a; x *= 2; y *= 2; z *= 2; a *= 0.5; } return s / t; }; // fbm con n octavas normalizado a 0..1

// amp = altura de las cordilleras (km). Las montañas y deformaciones dominan; la vegetación y las rocas son minoritarias.
const SURF = {
  Tierra:   { kind: 'earth', amp: 16, seed: 3.1, style: { ore: 'vein', flora: null } },
  Luna:     { kind: 'rock', amp: 7, seed: 7.7, c: [0x4d4d4d, 0x9c9c9c], cr: [[180, 1], [30, 0.7], [5, 0.4]], objs: [0xb8b8b8, 0x8a8a8a], style: { ore: 'shard', flora: 'crystalTree' } },
  Mercurio: { kind: 'rock', amp: 8, seed: 5.3, c: [0x3f3a35, 0x8c847a], cr: [[220, 1], [35, 0.7], [6, 0.4]], objs: [0x9a8f84, 0x6c645b], style: { ore: 'nugget', flora: 'slag' } },
  Marte:    { kind: 'rock', amp: 20, seed: 9.1, canyon: 5, c: [0x6a2f1a, 0xd9915a], cr: [[160, 0.7], [22, 0.5]], objs: [0xc0704a, 0x8a4a2c], style: { ore: 'shard', flora: 'cactus' } },
  Venus:    { kind: 'venus', amp: 12, seed: 2.2, c: [0x6f5228, 0xd7b467], objs: [0x6a5a3a, 0x3a2c1c], style: { ore: 'vein', flora: 'coral' } },
};
const MINERALS = { gold: 0xffc22a, silver: 0xdde3ea, copper: 0xd9743a, diamond: 0xa6f3ff };
const KEYS = ['pine', 'oak', 'bush', 'rock', 'rock2', 'boulder', 'spire', 'lava', 'flora', 'gold', 'silver', 'copper', 'diamond'];

function craters(cfg, x, y, z, o, minCell) { // cráteres a varias escalas: cuenco + borde elevado
  let h = 0, dark = 0;
  for (const [cell, k] of cfg.cr) {
    if (cell < minCell) continue;
    const qx = x / cell, qy = y / cell, qz = z / cell, ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz), s = cfg.seed + cell;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      if (h3(cx + s, cy, cz) > 0.55) continue;
      const px = cx + h3(cx, cy + s, cz), py = cy + h3(cx + 3.1, cy, cz + s), pz = cz + h3(cx, cy + 7.7, cz + s * 1.3);
      const rad = 0.18 + 0.28 * h3(cx + 9.1, cy + s, cz + 1.7), d = Math.hypot(qx - px, qy - py, qz - pz) / rad;
      if (d > 1.5) continue;
      const depth = rad * cell * 0.12 * k;
      h += d < 1 ? -depth * (1 - d * d) : 0.35 * depth * Math.exp(-Math.pow((d - 1.05) / 0.2, 2));
      if (d < 1) dark = Math.max(dark, 1 - d * d);
    }
  }
  o.dark = dark; return h;
}
function sample(cfg, x, y, z, o, sp = 0, sf = sp) { // (x,y,z) = punto de la superficie (km, relativo al centro); sp = resolución del anillo (cráteres), sf = la que decide el ruido fino: los detalles finos solo se calculan si se verían
  const s = cfg.seed, w = 260; o.water = -1; o.forest = 0; o.rock = 0; o.lava = 0; o.dark = 0; o.ore = 0;
  // deformación de dominio: retuerce el mapa de alturas para que las cordilleras serpenteen y no parezcan ruido plano
  const X = x + (fb(x / 600 + s, y / 600, z / 600, 2) - 0.5) * w, Y = y + (fb(x / 600, y / 600 + s, z / 600, 2) - 0.5) * w, Z = z + (fb(x / 600, y / 600, z / 600 + s, 2) - 0.5) * w, A = cfg.amp;
  const mask = sstep(0.32, 0.55, fb(X / 1100 + s * 3, Y / 1100, Z / 1100, 3));                 // dónde hay cordilleras
  const rd = 1 - Math.abs(2 * fb(X / 240 + s, Y / 240, Z / 240, 4) - 1), ridge = rd * rd;       // crestas afiladas
  const peak = ridge * (0.5 + 0.5 * fb(X / 60 + s, Y / 60, Z / 60, 3));                        // picos irregulares
  const hills = (fb(X / 90 + s, Y / 90, Z / 90, 3) - 0.5) * 2;                                   // colinas suaves ±1
  const detail = sf < 60 ? (fb(X / 22 + s, Y / 22, Z / 22, 3) - 0.5) * 0.12 : 0;                 // rugosidad fina (solo con resolución suficiente)
  const sc = Math.max(0.4, A / 16), mid = sf < 400 ? (fb(X / 9 + s * 2, Y / 9, Z / 9, 3) - 0.5) * 2 : 0, roll = sf < 80 ? (fb(X / 2.2 + s * 4, Y / 2.2, Z / 2.2, 3) - 0.5) * 2 : 0, knoll = sf < 30 ? (fb(X / 0.55 + s * 6, Y / 0.55, Z / 0.55, 2) - 0.5) * 2 : 0, micro = (mid * 1.6 + roll * 0.5 + knoll * 0.08) * sc; // lomas de ~9 km, ondulaciones de ~2 km y montículos de ~0,5 km: el terreno se nota andando
  if (cfg.kind === 'earth') {
    const kc = 1800 * (cfg.cs || 1), cont = fb(X / kc + s, Y / kc, Z / kc, 4) - 0.5 - (cfg.sea || 0); // sea: cuánto mar tiene este mundo · cs: escala de los continentes (SYS_SCALE en los mundos generados: mismos continentes por planeta aunque sea más pequeño)
    if (cont <= 0) { o.h = 0; o.water = Math.min(1, -cont * 7); return; }
    const up = Math.pow(Math.min(1, cont * 3), 1.3);                                             // costas suaves: el relieve sube tierra adentro
    o.h = up * (mask * peak * A + mask * ridge * A * 0.22 + hills * 3 + 0.3 + micro * 1.4) + detail * up; if (o.h < 0) o.h *= 0.15; // hondonadas suavizadas para no hundir la tierra bajo el nivel del mar
    o.forest = sstep(0.47, 0.67, fb(x / 50 + s * 2, y / 50, z / 50, 3)) * sstep(3.4, 1.8, o.h) * sstep(0, 0.04, cont); // solo tierras bajas: poco bosque, mucha montaña
    o.rock = Math.min(1, sstep(1.5, 3.5, o.h) + mask * 0.3); o.ore = Math.min(1, mask * peak * 1.6);
  } else if (cfg.kind === 'rock') {
    o.h = (fb(X / 1000 + s, Y / 1000, Z / 1000, 3) - 0.5) * A * 0.5 + mask * peak * A + hills * A * 0.1 + craters(cfg, x, y, z, o, sp * 2) + detail + micro;
    if (cfg.canyon) o.h -= sstep(0.05, 0, Math.abs(fb(X / 500 + s * 5, Y / 500, Z / 500, 3) - 0.5)) * cfg.canyon; // cañones tipo Valles Marineris
    o.rock = 0.3 + mask * 0.5; o.ore = Math.min(1, mask * peak * 1.5 + o.dark * 0.25);
  } else { // venus: mesetas agrietadas, dorsales y ríos de lava
    o.h = (fb(X / 1400 + s, Y / 1400, Z / 1400, 3) - 0.45) * A * 0.6 + mask * peak * A + hills * A * 0.1 + detail + micro;
    o.lava = sstep(0.36, 0.30, fb(x / 350 + s, y / 350, z / 350, 3)); if (o.lava > 0.5) o.h -= 0.15; o.rock = 0.4 + mask * 0.4; o.ore = Math.min(1, mask * peak * 1.5);
  }
}

const K = h => new THREE.Color(h);
// ---------- color del terreno y texturas de los astros ----------
// Todo lo de esta sección son funciones puras sobre arrays [r,g,b] y typed arrays (sin THREE): las usan igual el hilo principal (terreno, textura base) y los workers
// (textura de alta resolución, nubes, cielo). El terreno cercano y la textura lejana comparten colorRGB(): por eso coinciden al acercarse.
const hx = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const CC = { deep: hx(0x03123a), mid: hx(0x0a3a78), shallow: hx(0x14879f), reef: hx(0x38c2b4), sand: hx(0xe2d09a), grass: hx(0x4c8a32), grass2: hx(0x88aa4a), forest: hx(0x1e5424), jungle: hx(0x124a20),
  taiga: hx(0x2c4a34), savanna: hx(0xae9a52), rock: hx(0x77726b), rockHi: hx(0xa59e94), rockDk: hx(0x3e3934), snow: hx(0xf2f6f8), lava: hx(0xff5a10).map(c => c * 1.6), lavaHot: hx(0xffd35a).map(c => c * 1.3),
  crust: hx(0x4a1206), desert: hx(0xd4b06e), dune: hx(0xc8844c), tundra: hx(0x7f8a70), ice: hx(0xe6f1f7), iceBlue: hx(0x8cc0e2), crack: hx(0x2a6a9c), frost: hx(0xeee4e0), basalt: hx(0x3b322e) };
CC.rock6 = CC.rock.map(c => c * 0.6);
function mixA(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; }
// Color por altura, pendiente, latitud y bioma; x,y,z = punto de la superficie (km, relativo al centro). Es la ÚNICA paleta: la usan la textura lejana (bakePlanet) y el terreno
// cercano (colorAt), así que cualquier cambio aquí se ve igual en los dos. Subtipos de los mundos rocosos (se deducen de su paleta, sin campos nuevos): con cañones = desierto
// tipo Marte; paleta clara casi blanca = helado (hielo agrietado y cuencas azules); rojo muy saturado = volcánico (basalto con mares y ríos de lava); el resto = luna/rocoso.
function colorRGB(cfg, o, up, out, x, y, z, cc) {
  const slope = 1 - up, det = fb(x / 6 + 5, y / 6, z / 6, 3), ay = Math.abs(y) / (Math.hypot(x, y, z) || 1), s = cfg.seed || 0; // ay: |seno de la latitud|
  const mv = fb(x / 90 + 2.3, y / 90, z / 90, 2); // variación de albedo a media escala (~100 km): rompe las manchas de color plano
  if (cfg.kind === 'earth') {
    const ice = sstep(0.8, 0.9, ay + (det - 0.5) * 0.1 + (mv - 0.5) * 0.08); // casquetes polares de borde irregular (sobre tierra y mar)
    if (o.water >= 0) { // océano: arrecifes turquesa junto a la costa, plataforma continental y fondo abisal
      const w = o.water + (mv - 0.5) * 0.06;
      mixA(out, CC.reef, CC.shallow, sstep(0.0, 0.1, w)); mixA(out, out, CC.mid, sstep(0.06, 0.4, w)); mixA(out, out, CC.deep, sstep(0.35, 1.0, w));
      if (ice > 0) mixA(out, out, CC.ice, ice * 0.92);
    } else {
      const cold = sstep(0.55, 0.8, ay), warm = 1 - sstep(0.12, 0.42, ay), dv = fb(x / 1300 + s * 1.7, y / 1300, z / 1300, 3) + 0.05 * Math.exp(-(ay - 0.4) * (ay - 0.4) / 0.02); // cinturones secos subtropicales
      const dry = sstep(0.54, 0.66, dv) * (1 - cold), sav = sstep(0.45, 0.56, dv) * (1 - cold), fo = o.forest;
      mixA(out, CC.grass, CC.grass2, det * 0.7 + mv * 0.3);
      mixA(out, out, CC.savanna, sav * 0.75 * (1 - fo));                                                   // pradera → sabana → desierto
      mixA(out, out, CC.forest, fo * 0.85); mixA(out, out, CC.jungle, fo * warm * 0.55); mixA(out, out, CC.taiga, fo * cold * 0.7); // selva en los trópicos, taiga hacia los polos
      mixA(out, out, CC.desert, dry * 0.88 * (1 - fo * 0.6)); mixA(out, out, CC.dune, dry * sstep(0.45, 0.75, mv) * 0.45); // campos de dunas rojizas
      mixA(out, out, CC.tundra, sstep(0.64, 0.8, ay) * 0.8); mixA(out, out, CC.sand, sstep(0.07, 0.0, o.h) * (1 - cold * 0.6)); // playas
      mixA(out, out, CC.rock, Math.max(o.rock * 0.85, sstep(0.1, 0.3, slope))); mixA(out, out, CC.rockDk, sstep(0.25, 0.6, slope) * 0.45); // laderas abruptas más oscuras
      mixA(out, out, CC.rockHi, sstep(3.5, 6, o.h) * 0.6);
      mixA(out, out, CC.snow, sstep(5.0, 6.2, o.h + (det - 0.5) * 0.8) * (0.3 + 0.7 * up * up));            // la nieve no cuaja en las paredes
      if (ice > 0) mixA(out, out, CC.snow, ice);
    }
  } else if (cfg.kind === 'venus') { // mesetas con teselas agrietadas y ríos de lava con costra oscura y núcleo incandescente
    const cr = 1 - Math.abs(2 * fb(x / 160 + s, y / 160, z / 160, 3) - 1);
    mixA(out, cc[0], cc[1], Math.max(0, Math.min(1, det * 0.9 + (mv - 0.5) * 0.9 + 0.05)));
    mixA(out, out, CC.rockDk, sstep(0.9, 0.97, cr) * 0.4 + sstep(0.1, 0.3, slope) * 0.35);
    if (o.lava > 0.05) { mixA(out, out, CC.crust, sstep(0.05, 0.3, o.lava)); mixA(out, out, CC.lava, sstep(0.3, 0.65, o.lava)); mixA(out, out, CC.lavaHot, sstep(0.8, 1, o.lava) * det); }
  } else {
    const c1 = cc[1], sub = cfg.canyon ? 0 : c1[0] > 0.9 && c1[1] > 0.9 && c1[2] > 0.9 ? 1 : c1[0] > 1.6 * c1[1] ? 2 : 0; // 1 = helado, 2 = volcánico
    const ma = fb(x / 420 + s, y / 420, z / 420, 3); // grandes regiones de albedo (mares lunares, llanuras oscuras, cuencas de hielo o de lava)
    const hk = cfg.cs || 1; mixA(out, cc[0], cc[1], Math.max(0, Math.min(1, det * 1.1 + (mv - 0.5) * 0.6 + sstep(2 * hk, 12 * hk, o.h) * 0.3))); // hk: el relieve de los mundos compactados es cs veces menor
    const dk = (0.9 + 0.2 * fb(x / 30 + 1, y / 30, z / 30, 3)) * (1 - 0.45 * o.dark); out[0] *= dk; out[1] *= dk; out[2] *= dk;
    if (sub === 1) { // hielo: cuencas azuladas, grietas largas y paredes en sombra azul
      const cr = 1 - Math.abs(2 * fb(x / 150 + s, y / 150, z / 150, 2) - 1), A = cfg.amp || 10;
      out[0] *= 0.88; out[1] *= 0.9; out[2] *= 0.92;
      mixA(out, out, CC.iceBlue, Math.min(0.7, sstep(0.54, 0.68, ma) * 0.5 + sstep(0, -0.3 * A, o.h) * 0.3 + o.dark * 0.35)); // los cráteres, cuencos de hielo azul
      mixA(out, out, CC.crack, sstep(0.955, 0.99, cr) * 0.65 + sstep(0.15, 0.45, slope) * 0.3);
    } else if (sub === 2) { // volcánico: basalto oscuro con óxidos, mares de lava en las llanuras y ríos incandescentes
      const cr = 1 - Math.abs(2 * fb(x / 150 + s, y / 150, z / 150, 2) - 1), A = cfg.amp || 10;
      mixA(out, out, CC.basalt, 0.72 - 0.3 * mv); mixA(out, out, CC.rock6, sstep(0.15, 0.4, slope) * 0.4);
      const lv = Math.max(sstep(0.62, 0.72, ma + sstep(0.1 * A, -0.3 * A, o.h) * 0.06), sstep(0.965, 0.992, cr) * 0.8);
      if (lv > 0) { mixA(out, out, CC.crust, sstep(0.0, 0.35, lv)); mixA(out, out, CC.lava, sstep(0.35, 0.85, lv) * (0.75 + 0.25 * det)); mixA(out, out, CC.lavaHot, sstep(0.93, 1, lv) * det * 0.7); }
    } else { // lunas, rocosos y desiertos: llanuras oscuras (mares) y tierras altas claras
      mixA(out, out, CC.rock6, sstep(0.15, 0.4, slope) * 0.5);
      const m = sstep(0.54, 0.68, ma) * (cfg.canyon ? 0.3 : 0.35), hl = sstep(0.45, 0.3, ma) * 0.12; // hl: tierras altas algo más claras
      out[0] *= 1 - m + hl; out[1] *= 1 - m * 1.02 + hl; out[2] *= 1 - m * 1.05 + hl;
      if (cfg.canyon) mixA(out, out, CC.frost, sstep(0.93, 0.97, ay + (det - 0.5) * 0.05) * 0.85); // mundos desérticos: casquetes polares finos
    }
  }
  // gradación final (común): +12 % de saturación y +6 % de contraste con hombro suave en las luces para no quemar (la lava puede pasar de 1: brilla)
  const L = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  for (let k = 0; k < 3; k++) { let v = 0.42 + (L + (out[k] - L) * 1.12 - 0.42) * 1.06; if (v > 0.88) v = 0.88 + (v - 0.88) * 0.45; out[k] = v < 0 ? 0 : v > 1.5 ? 1.5 : v; }
  return out;
}
const _ca = [0, 0, 0];
function colorAt(cfg, o, up, out, x, y, z) { // versión THREE de colorRGB (terreno cercano)
  colorRGB(cfg, o, up, _ca, x, y, z, cfg._cca || (cfg._cca = cfg.c ? cfg.c.map(hx) : null)); return out.setRGB(_ca[0], _ca[1], _ca[2]);
}

// Textura equirectangular por filas (se puede pedir a un worker por tiras). Filas j = v*H de abajo (sur) a arriba (norte); la fila j y la columna i corresponden a la
// dirección x = -cos(2πu)·cos(lat), y = sin(lat), z = sin(2πu)·cos(lat): es el mapeo UV de THREE.SphereGeometry.
// Planeta sólido: rgba (color, alfa 255) + ht (altura codificada en un canal: 0 = mar; sirve para el relieve y el brillo del agua).
function bakePlanet(P, j0, j1) {
  const W = P.W, H = P.H, R = P.R, cfg = P.cfg, cc = cfg.c ? cfg.c.map(hx) : null, sp = 6.283185307 * R / W, o = {}, c3 = [0, 0, 0], A = cfg.amp, earth = cfg.kind === 'earth';
  const a0 = Math.max(0, j0 - 1), a1 = Math.min(H - 1, j1), nr = a1 - a0 + 1, cs = new Float32Array(W), sn = new Float32Array(W); // filas extra arriba y abajo para calcular la pendiente
  for (let i = 0; i < W; i++) { const a = 6.283185307 * (i + 0.5) / W; cs[i] = -Math.cos(a); sn[i] = Math.sin(a); }
  const hh = new Float32Array(nr * W), wt = new Float32Array(nr * W), fo = new Float32Array(nr * W), rk = new Float32Array(nr * W), lv = new Float32Array(nr * W), dk = new Float32Array(nr * W);
  for (let j = a0; j <= a1; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), q0 = (j - a0) * W;
    for (let i = 0; i < W; i++) { sample(cfg, cs[i] * cl * R, sl * R, sn[i] * cl * R, o, sp, 1000); const q = q0 + i; hh[q] = o.h; wt[q] = o.water; fo[q] = o.forest; rk[q] = o.rock; lv[q] = o.lava; dk[q] = o.dark; }
  }
  const rgba = new Uint8ClampedArray((j1 - j0) * W * 4), ht = new Uint8Array((j1 - j0) * W), dvKm = Math.PI * R / H;
  for (let j = j0; j < j1; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), dxKm = 6.283185307 * R * Math.max(cl, 0.05) / W, qd = (Math.max(j - 1, a0) - a0) * W, qu = (Math.min(j + 1, a1) - a0) * W, q0 = (j - a0) * W;
    for (let i = 0; i < W; i++) {
      const q = q0 + i, gx = (hh[q0 + (i + 1) % W] - hh[q0 + (i + W - 1) % W]) / (2 * dxKm), gy = (hh[qu + i] - hh[qd + i]) / (2 * dvKm), up = 1 / Math.sqrt(1 + gx * gx + gy * gy);
      o.h = hh[q]; o.water = wt[q]; o.forest = fo[q]; o.rock = rk[q]; o.lava = lv[q]; o.dark = dk[q];
      colorRGB(cfg, o, up, c3, cs[i] * cl * R, sl * R, sn[i] * cl * R, cc);
      const p = ((j - j0) * W + i) * 4; rgba[p] = c3[0] * 255; rgba[p + 1] = c3[1] * 255; rgba[p + 2] = c3[2] * 255; rgba[p + 3] = 255;
      ht[(j - j0) * W + i] = earth ? (o.water >= 0 ? 0 : 12 + 243 * Math.min(1, Math.max(0, o.h / (1.15 * A)))) : 255 * Math.min(1, Math.max(0, (o.h + 0.55 * A) / (1.9 * A)));
    }
  }
  return { rgba, ht };
}
function bakeGas(P, j0, j1) { // gigante gaseoso: cinturones oscuros y cálidos, zonas claras, bandas finas, vetas a lo largo del viento y tormentas ovaladas con anillo claro
  const W = P.W, H = P.H, s = P.seed, c1 = hx(P.c1), c2 = hx(P.c2), rgba = new Uint8ClampedArray((j1 - j0) * W * 4), ht = new Uint8Array((j1 - j0) * W).fill(128), c3 = [0, 0, 0], STORM = [[1.1, 0.32, 0.16], [4.2, -0.5, 0.1], [2.6, 0.62, 0.07]];
  const dark = c1.map(c => c * 0.72), light = mixA([0, 0, 0], c2, [0.98, 0.96, 0.92], 0.2), warm = mixA([0, 0, 0], c1, [0.78, 0.42, 0.26], 0.4); // cinturón oscuro, zona clara y tono cálido de las tormentas
  for (let j = j0; j < j1; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), pole = 1 - 0.28 * sstep(0.72, 0.97, Math.abs(sl));
    for (let i = 0; i < W; i++) {
      const a = 6.283185307 * (i + 0.5) / W, x = -Math.cos(a) * cl, z = Math.sin(a) * cl, wob = fb(x * 2 + s, sl * 6, z * 2, 4), t = Math.sin(sl * 14 + wob * 5 + fb(x * 9, sl * 30 + s, z * 9, 3) * 0.8) * 0.5 + 0.5;
      const b2 = Math.sin(sl * 41 + wob * 3 + s) * 0.5 + 0.5, st = fb(x * 26 + s, sl * 90, z * 26, 2); // bandas finas y vetas estiradas por el viento
      mixA(c3, dark, light, sstep(0.12, 0.88, t)); mixA(c3, c3, warm, (1 - t) * b2 * 0.4);
      const k = (0.9 + 0.2 * st) * pole; c3[0] *= k; c3[1] *= k; c3[2] *= k;
      for (const [l0, y0, r0] of STORM) {
        let dl = a - l0; dl -= 6.283185307 * Math.round(dl / 6.283185307); const rr = Math.sqrt(dl * dl * cl * cl / (r0 * r0 * 4) + (lat - y0) * (lat - y0) / (r0 * r0)); if (rr > 2) continue;
        mixA(c3, c3, light, Math.exp(-(rr - 1.05) * (rr - 1.05) / 0.06) * 0.55); mixA(c3, c3, warm, Math.min(1, Math.exp(-rr * rr) * 0.95)); // anillo claro alrededor del óvalo cálido
      }
      const p = ((j - j0) * W + i) * 4; rgba[p] = c3[0] * 255; rgba[p + 1] = c3[1] * 255; rgba[p + 2] = c3[2] * 255; rgba[p + 3] = 255;
    }
  }
  return { rgba, ht };
}
function bakeSun(P, j0, j1) { // fotosfera: granulación, manchas solares con penumbra y fáculas brillantes
  const W = P.W, H = P.H, s = P.seed, c1 = hx(P.c1), c2 = hx(P.c2), rgba = new Uint8ClampedArray((j1 - j0) * W * 4), c3 = [0, 0, 0];
  for (let j = j0; j < j1; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), zone = 1 - sstep(0.45, 0.75, Math.abs(sl));
    for (let i = 0; i < W; i++) {
      const a = 6.283185307 * (i + 0.5) / W, x = -Math.cos(a) * cl, z = Math.sin(a) * cl, g = fb(x * 12 + s, sl * 12, z * 12, 4) * 0.6 + fb(x * 34, sl * 34 + s, z * 34, 3) * 0.4, m = fb(x * 2.4 + s * 3, sl * 2.4, z * 2.4, 3);
      mixA(c3, c2, c1, 0.5 + 0.5 * sstep(0.28, 0.72, g));
      const umbra = sstep(0.72, 0.84, m) * zone, pen = sstep(0.66, 0.76, m) * zone, fac = sstep(0.6, 0.85, fb(x * 6 + s, sl * 6, z * 6, 3)) * 0.18, k = 1 - 0.4 * pen - 0.35 * umbra + fac;
      const p = ((j - j0) * W + i) * 4; rgba[p] = c3[0] * k * 255; rgba[p + 1] = c3[1] * k * 255; rgba[p + 2] = c3[2] * k * 255; rgba[p + 3] = 255;
    }
  }
  return { rgba };
}
function bakeCloud(P, j0, j1) { // densidad de nubes (un canal, compartida por todos los mundos): frentes alargados, franjas por latitud y ciclones en espiral
  const W = P.W, H = P.H, ht = new Uint8Array((j1 - j0) * W), ST = [[0.7, 0.55, 0.26, 1], [4.0, -0.42, 0.22, -1], [2.3, 0.9, 0.2, 1], [5.4, 0.2, 0.17, -1], [1.6, -0.75, 0.18, 1]];
  for (let j = j0; j < j1; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), band = 0.5 + 0.5 * Math.cos(lat * 6.0 + 0.6);
    for (let i = 0; i < W; i++) {
      const a = 6.283185307 * (i + 0.5) / W, x = -Math.cos(a) * cl, z = Math.sin(a) * cl, q = fb(x * 2.1 + 5.2, sl * 2.1, z * 2.1, 3), q2 = fb(x * 2.1, sl * 2.1 + 3.3, z * 2.1, 3);
      let d = fb(x * 2.8 + q * 1.6, sl * 3.6 + q2 * 1.6, z * 2.8 + q * 1.6, 5) * 0.72 + fb(x * 10 + q2, sl * 10, z * 10 + q, 3) * 0.28;
      d += (band - 0.5) * 0.16;
      const bl = 1 - Math.abs(2 * fb(x * 18 + q * 2, sl * 18, z * 18 + q2 * 2, 2) - 1); d += (bl - 0.62) * 0.11 * sstep(0.35, 0.6, d); // cúmulos: bordes en coliflor solo donde ya hay nube
      for (const [l0, y0, r0, dir] of ST) { let dl = a - l0; dl -= 6.283185307 * Math.round(dl / 6.283185307); const dx = dl * cl, dy = lat - y0, rr = Math.sqrt(dx * dx + dy * dy) / r0; if (rr < 1.7) { const th = Math.atan2(dy, dx) * dir + rr * 5.5; d += (0.34 * Math.exp(-rr * rr * 1.1)) * (0.65 + 0.35 * Math.cos(th * 2)) - 0.12 * Math.exp(-rr * rr * 9); } } // ojo despejado en el centro
      ht[(j - j0) * W + i] = Math.min(255, Math.max(0, d * 255));
    }
  }
  return { ht };
}
function bakeSky(P, j0, j1) { // Vía Láctea: disco fino con bulbo cálido, vetas de polvo alargadas y nebulosas suaves (baja resolución; las estrellas son puntos aparte)
  const W = P.W, H = P.H, rgba = new Uint8ClampedArray((j1 - j0) * W * 4), GN = P.gn, A = [GN[2], 0, -GN[0]], al = Math.hypot(A[0], A[2]); A[0] /= al; A[2] /= al;
  const B = [GN[1] * A[2] - GN[2] * A[1], GN[2] * A[0] - GN[0] * A[2], GN[0] * A[1] - GN[1] * A[0]], NEB = [[0.3, 0.2, 0.9, 1.0, 0.28, 0.5], [-0.8, 0.5, -0.4, 0.25, 0.75, 0.9], [0.1, -0.6, 0.79, 0.95, 0.5, 0.3], [-0.5, -0.2, -0.85, 0.3, 0.6, 1.0]];
  for (let j = j0; j < j1; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W - 0.5) * 6.283185307, dx = cl * Math.cos(lon), dy = sl, dz = cl * Math.sin(lon), sb = Math.max(-1, Math.min(1, dx * GN[0] + dy * GN[1] + dz * GN[2])), b = Math.asin(sb);
      const u1 = dx * A[0] + dy * A[1] + dz * A[2], u2 = dx * B[0] + dy * B[1] + dz * B[2], l = Math.atan2(u2, u1); // coordenadas en el plano galáctico
      const band = Math.exp(-(b / 0.14) * (b / 0.14)), halo = Math.exp(-(b / 0.4) * (b / 0.4)), core = Math.exp(-(l / 0.9) * (l / 0.9)) * Math.exp(-(b / 0.3) * (b / 0.3));
      const n1 = fb(u1 * 2.4 + 11.3, u2 * 2.4, sb * 9, 5), n2 = fb(u1 * 7 + 3.1, u2 * 7, sb * 22, 4), wp = (fb(u1 * 2 + 7, u2 * 2, sb * 5, 3) - 0.5) * 0.8, rr = 1 - Math.abs(2 * fb(u1 * 3 + wp, u2 * 3 + wp, sb * 16, 4) - 1), lane = sstep(0.6, 0.88, rr) * Math.exp(-(b / 0.08) * (b / 0.08)); // vetas oscuras finas a lo largo del disco
      let I = (0.06 * band * (0.4 + 1.6 * (n1 - 0.25)) + 0.025 * halo * (0.5 + n1) + 0.11 * core * (0.5 + n2)) * (1 - 0.7 * lane); if (I < 0) I = 0;
      const w = Math.min(1, core * 1.7 + 0.12); let r = I * (0.72 + 0.28 * w), g = I * (0.78 + 0.06 * w), bl = I * (1.0 - 0.3 * w);
      for (const [nx, ny, nz, cr, cg, cb] of NEB) { const nl = Math.hypot(nx, ny, nz), c = (dx * nx + dy * ny + dz * nz) / nl, k = Math.exp(-Math.pow(Math.acos(Math.min(1, c)) / 0.32, 2)) * sstep(0.5, 0.8, fb(dx * 3.4 + nx * 9, dy * 3.4 + ny * 9, dz * 3.4 + nz * 9, 4)) * 0.07; r += cr * k; g += cg * k; bl += cb * k; }
      const p = ((j - j0) * W + i) * 4; rgba[p] = r * 255; rgba[p + 1] = g * 255; rgba[p + 2] = bl * 255; rgba[p + 3] = 255;
    }
  }
  return { rgba };
}
function bakeRows(P, j0, j1) { return P.kind === 'planet' ? bakePlanet(P, j0, j1) : P.kind === 'gas' ? bakeGas(P, j0, j1) : P.kind === 'sun' ? bakeSun(P, j0, j1) : P.kind === 'cloud' ? bakeCloud(P, j0, j1) : bakeSky(P, j0, j1); }

// ---------- geometrías de los objetos (altura ≈ 1, base en y=0) ----------
const I = (r, d = 1) => new THREE.IcosahedronGeometry(r, d), Co = (r, l, s = 7, hs = 1) => new THREE.ConeGeometry(r, l, s, hs);
const GCACHE = {};
function geoFor(key, b) { // los objetos con "diseño de planeta" (flora y minerales) dependen del mundo; el resto se comparte
  const id = ['flora', 'gold', 'silver', 'copper', 'diamond'].includes(key) ? key + ':' + b.n : key;
  return GCACHE[id] || (GCACHE[id] = makeGeo(key, b, SURF[b.n].style));
}
function makeGeo(key, b, st) {
  const cfg = SURF[b.n], host = cfg.objs ? cfg.objs[1] : 0x8a8580;
  switch (key) {
    case 'pine': return merge([piece(Cy(0.035, 0.35, 6), 0x5a3d22, 0, 0.175, 0), piece(Co(0.30, 0.55), 0x21562a, 0, 0.55, 0), piece(Co(0.23, 0.48), 0x2a6a32, 0, 0.82, 0), piece(Co(0.15, 0.42), 0x347a3a, 0, 1.06, 0)], 0.02, 0, 1);
    case 'oak': return merge([piece(Cy(0.05, 0.5, 6), 0x5a3d22, 0, 0.25, 0), piece(I(0.34), 0x3d7a34, 0, 0.66, 0), piece(I(0.25), 0x4a8a3a, 0.2, 0.8, 0.05), piece(I(0.23), 0x357029, -0.18, 0.74, -0.1)], 0.05, 0, 2);
    case 'bush': return merge([piece(I(0.42), 0x4b7a2f, 0, 0.3, 0), piece(I(0.28), 0x5a8a35, 0.3, 0.2, 0.1)], 0.08, 0, 3);
    case 'rock': return merge([piece(I(0.5), 0xcfcfcf, 0, 0.3, 0)], 0.12, 0, 4);
    case 'rock2': return merge([piece(I(0.5), 0xd6d6d6, 0, 0.25, 0), piece(I(0.28), 0xbdbdbd, 0.4, 0.15, 0.1)], 0.16, 0, 5);
    case 'boulder': return merge([piece(I(0.6, 2), 0xd0d0d0, 0, 0.42, 0)], 0.18, 0, 6);
    case 'spire': return merge([piece(Co(0.32, 1.6, 6, 3), 0xc4c4c4, 0, 0.8, 0)], 0.09, 0, 7);
    case 'lava': return merge([piece(I(0.5), 0x3a1a10, 0, 0.3, 0), piece(I(0.32), 0xff5a10, 0.05, 0.42, 0.02)], 0.14, 0, 8);
    case 'flora': switch (st.flora) { // "árbol" característico de cada mundo
      case 'cactus': return merge([piece(Cy(0.07, 1.0, 8, 0.09), 0x8a4a32, 0, 0.5, 0), piece(Cy(0.045, 0.2, 6), 0x8a4a32, 0.12, 0.45, 0, 0, 0, PI / 2), piece(Cy(0.05, 0.42, 6), 0x8a4a32, 0.22, 0.62, 0), piece(Cy(0.045, 0.2, 6), 0x8a4a32, -0.11, 0.6, 0, 0, 0, PI / 2), piece(Cy(0.05, 0.34, 6), 0x8a4a32, -0.21, 0.74, 0)], 0.03, 0, 9);
      case 'coral': return merge([piece(Co(0.09, 0.6, 6), 0x3a2a24, 0, 0.3, 0), piece(Co(0.05, 0.5, 5), 0x4a3630, 0.2, 0.62, 0, 0, 0, -0.7), piece(Co(0.05, 0.45, 5), 0x4a3630, -0.18, 0.6, 0.05, 0, 0, 0.7), piece(Co(0.05, 0.4, 5), 0x4a3630, 0, 0.7, 0.18, 0.7, 0, 0),
        piece(I(0.07, 0), 0xff8a30, 0.32, 0.82, 0), piece(I(0.07, 0), 0xff8a30, -0.3, 0.78, 0.05), piece(I(0.07, 0), 0xff8a30, 0, 0.92, 0.3), piece(I(0.08, 0), 0xffb040, 0, 0.66, 0)], 0.03, 0, 10);
      case 'crystalTree': return merge([0, 1, 2, 3, 4].map(i => piece(Co(0.11, 0.9 - i * 0.08, 6), i % 2 ? 0xb8c8d8 : 0xd8e4ee, Math.cos(i * 1.3) * 0.12, 0.42, Math.sin(i * 1.3) * 0.12, Math.sin(i * 1.3) * 0.35, 0, -Math.cos(i * 1.3) * 0.35)), 0.02, 0, 11);
      default: return merge([piece(Co(0.22, 0.5, 5), 0x4a4640, 0, 0.25, 0), piece(Co(0.15, 0.5, 5), 0x5c5650, 0, 0.7, 0), piece(Co(0.08, 0.45, 5), 0x8a8e94, 0, 1.1, 0)], 0.04, 0, 12); // escoria de Mercurio
    }
    default: { // gold, silver, copper, diamond: el diseño depende del estilo de yacimiento del mundo
      const c = MINERALS[key], hc = key === 'diamond' ? 0xf4ffff : c;
      if (st.ore === 'vein') return merge([piece(I(0.5), host, 0, 0.3, 0), ...[[0.4, 0.35, 0.1], [-0.3, 0.42, 0.25], [0.1, 0.55, -0.3], [0.35, 0.15, -0.35]].map(([x, y, z]) => piece(I(0.14, 0), c, x, y, z))], 0.14, 0, 13);
      if (st.ore === 'nugget') return merge([piece(I(0.3, 1), c, 0, 0.22, 0), piece(I(0.24, 1), c, 0.32, 0.16, 0.1), piece(I(0.22, 1), c, -0.26, 0.14, 0.2), piece(I(0.2, 1), c, 0.1, 0.13, -0.3)], 0.1, 0, 14);
      return merge([piece(Cy(0.4, 0.1, 8, 0.46), host, 0, 0.05, 0), ...[0, 1, 2, 3, 4].map(i => piece(Co(0.1, 0.8 - i * 0.07, 6), i ? c : hc, Math.cos(i * 1.26) * 0.2, 0.4, Math.sin(i * 1.26) * 0.2, Math.sin(i * 1.26) * 0.4, 0, -Math.cos(i * 1.26) * 0.4))], 0.03, 0, 15);
    }
  }
}

// ---------- materiales de los astros vistos desde el espacio ----------
// Esfera con shader propio: la luz viene de la estrella (dirección propia de cada cuerpo, no la de la nave), terminador suave, relieve a partir de la altura,
// brillo del sol en el mar, sombra de las nubes y dispersión atmosférica en el limbo (azul de día, rojiza al atardecer). La textura es la misma función de terreno
// que usa el suelo cercano. Nubes y aureola son cáscaras aparte: una textura de nubes compartida por todos los mundos y una esfera sin textura.
const TEX_LO = [256, 128], TEX_HI = [1024, 512], TEX_SUN = [512, 256], SUN_I = 1.5;
const mkTex = (data, W, H, fmt) => { const t = new THREE.DataTexture(data, W, H, fmt, THREE.UnsignedByteType); t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; };
const DUMMY = mkTex(new Uint8ClampedArray([110, 110, 110, 255]), 1, 1, THREE.RGBAFormat), DUMMYR = mkTex(new Uint8Array([0]), 1, 1, THREE.RedFormat), CLOUD_U = { value: DUMMYR }; // texturas mudas hasta que llegan las reales; CLOUD_U: la textura de nubes compartida
const CLOUDS = { // cobertura (umbrales sobre la densidad), opacidad y tinte por tipo de mundo
  earth: { lo: 0.47, hi: 0.7, op: 0.92, tint: [1, 1, 1] }, venus: { lo: 0.2, hi: 0.56, op: 0.97, tint: [0.98, 0.86, 0.58] }, mars: { lo: 0.62, hi: 0.8, op: 0.5, tint: [0.96, 0.88, 0.8] },
  frozen: { lo: 0.56, hi: 0.78, op: 0.75, tint: [0.9, 0.97, 1] }, red: { lo: 0.56, hi: 0.8, op: 0.5, tint: [0.36, 0.22, 0.17] },
};
const BODY_VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv; vN = mat3(modelMatrix) * normal; vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const PLANET_FS = `uniform sampler2D uMap; uniform sampler2D uHt; uniform sampler2D uCloud;
uniform vec3 uSun; uniform vec3 uAtm; uniform vec4 uCP; uniform vec2 uCU; uniform vec4 uB; uniform vec4 uK; uniform float uOp; uniform float uGl;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 N0 = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(uSun);
  float atm = uK.x, sl = sqrt(max(1.0 - N0.y * N0.y, 0.0001));
  vec3 T = vec3(N0.z, 0.0, -N0.x) / sl, Nn = cross(N0, T);
  vec3 alb = texture2D(uMap, vUv).rgb;
  float h0 = texture2D(uHt, vUv).r;
  vec2 dd = max(uB.zw, fwidth(vUv) * 1.5);
  float su = (texture2D(uHt, vUv + vec2(dd.x, 0.0)).r - h0) * uB.x / (6.2832 * uB.y * sl * dd.x) * smoothstep(0.03, 0.2, sl);
  float sv = (texture2D(uHt, vUv + vec2(0.0, dd.y)).r - h0) * uB.x / (3.1416 * uB.y * dd.y);
  vec3 N = normalize(N0 - (su * T + sv * Nn) * 2.4);
  float ndl0 = dot(N0, L), ndl = dot(N, L), wrap = mix(0.02, 0.22, min(atm, 1.0));
  float dif = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0) * smoothstep(-0.08 - 0.08 * atm, 0.1 + 0.1 * atm, ndl0);
  float csh = 1.0;
  if (uCP.z > 0.0) {
    float t = 0.012 / max(ndl0, 0.25);
    vec2 sh = vec2(dot(L, T) / (6.2832 * sl), dot(L, Nn) / 3.1416) * t, cuv = vec2(vUv.x + uCU.x, mix(vUv.y, 1.0 - vUv.y, uCU.y)), fl = vec2(1.0, 1.0 - 2.0 * uCU.y);
    csh = 1.0 - 0.5 * smoothstep(uCP.x, uCP.y, texture2D(uCloud, cuv + sh * fl).r) * uCP.z * uCP.w;
  }
  vec3 col = alb * (uK.z * dif * csh + uK.w);
  float water = uK.y * (1.0 - smoothstep(0.0, 0.045, h0)), fr = 1.0 - max(dot(N0, V), 0.0);
  float spec = pow(max(dot(reflect(-L, N0), V), 0.0), 60.0) * water * dif * csh;
  col += vec3(1.0, 0.94, 0.82) * spec * 1.1 + uAtm * pow(fr, 4.0) * 0.22 * water * dif;
  float twil = 1.0 - smoothstep(0.0, 0.4, ndl0), day = smoothstep(-0.2, 0.35, ndl0);
  col *= mix(vec3(1.0), vec3(1.0, 0.7, 0.5), twil * day * min(atm, 1.0));
  vec3 rimC = mix(uAtm, vec3(1.0, 0.5, 0.24), twil * 0.75);
  col = mix(col, uAtm * (0.22 + 0.9 * dif), pow(fr, 2.4) * atm * 0.5);
  col += rimC * pow(fr, 4.0) * atm * (0.15 + day) * 1.05 + uAtm * pow(fr, 1.6) * atm * day * 0.06;
  if (uGl > 0.0) { // mundos volcánicos: la lava (rojo intenso con poco azul en la textura) brilla con luz propia, sobre todo en la cara nocturna
    float lava = smoothstep(0.8, 0.97, alb.r) * (1.0 - smoothstep(0.1, 0.3, alb.b)) * smoothstep(0.2, 0.4, alb.g);
    col += alb * vec3(1.0, 0.75, 0.55) * lava * uGl * (0.25 + 0.9 * (1.0 - dif));
  }
  gl_FragColor = vec4(col, uOp);
}`;
const SUN_FS = `uniform sampler2D uMap; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float mu = max(dot(normalize(vN), normalize(cameraPosition - vP)), 0.0), limb = 0.4 + 0.6 * pow(mu, 0.55);
  vec3 col = texture2D(uMap, vUv).rgb * limb * 1.2;
  gl_FragColor = vec4(mix(col, vec3(1.0, 0.97, 0.88), pow(mu, 5.0) * 0.32), 1.0);
}`;
const CLOUD_FS = `uniform sampler2D uCloud; uniform vec3 uSun; uniform vec3 uCTint; uniform vec4 uCP; uniform vec2 uCU;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 N0 = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(uSun);
  vec2 cuv = vec2(vUv.x + uCU.x, mix(vUv.y, 1.0 - vUv.y, uCU.y));
  float cov = smoothstep(uCP.x, uCP.y, texture2D(uCloud, cuv).r), sl = sqrt(max(1.0 - N0.y * N0.y, 0.0001));
  vec3 T = vec3(N0.z, 0.0, -N0.x) / sl, Nn = cross(N0, T);
  vec2 sh = vec2(dot(L, T) / (6.2832 * sl), dot(L, Nn) / 3.1416) * 0.01 * vec2(1.0, 1.0 - 2.0 * uCU.y);
  float selfS = clamp(1.0 - (smoothstep(uCP.x, uCP.y, texture2D(uCloud, cuv + sh).r) - cov) * 0.8, 0.5, 1.12);
  selfS *= clamp(1.0 - (smoothstep(uCP.x, uCP.y, texture2D(uCloud, cuv + sh * 2.5).r) - cov) * 0.35, 0.8, 1.06); // segunda muestra más lejos: volumen y sombras más suaves
  float ndl = dot(N0, L), dif = smoothstep(-0.14, 0.4, ndl), twil = 1.0 - smoothstep(0.0, 0.4, ndl), fr = 1.0 - max(dot(N0, V), 0.0);
  vec3 col = uCTint * (0.05 + dif) * selfS * (0.9 + 0.18 * smoothstep(0.3, 1.0, cov)); // los núcleos densos, más blancos; los bordes deshilachados, algo grises
  col += uCTint * pow(fr, 3.0) * dif * 0.18; // borde plateado a contraluz
  col *= mix(vec3(1.0), vec3(1.0, 0.6, 0.4), twil * dif * 0.9);
  gl_FragColor = vec4(col, min(cov * uCP.z * uCP.w * (0.85 + 0.35 * fr), 1.0));
}`;
const ATM_FS = `uniform vec3 uSun; uniform vec3 uAtm; uniform vec4 uAP; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 Nb = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(uSun);
  float mu = abs(dot(Nb, V)), s = sqrt(max(1.0 - mu * mu, 0.0)), q = uAP.x;
  if (s < q) discard;
  float hgt = (s - q) / (1.0 - q), path = sqrt(max(1.0 - s * s, 0.0) / (1.0 - q * q)), glow = pow(path, 1.1) * exp(-hgt * 3.6);
  vec3 nc = normalize(Nb - V * dot(Nb, V));
  float lit = dot(nc, L), day = smoothstep(-0.4, 0.4, lit), twil = exp(-pow(lit / 0.26, 2.0)), fwd = pow(max(dot(-V, L), 0.0), 3.0);
  vec3 c = mix(uAtm, vec3(1.0, 0.48, 0.2), twil * uAP.z);
  c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.2), 0.0); // halo algo más saturado
  gl_FragColor = vec4(c * glow * (day * 0.95 + twil * 0.4 * uAP.z + fwd * 0.8) * uAP.y, 1.0);
}`;
const hashStr = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const hexOf = c => typeof c === 'string' ? parseInt(c.slice(1), 16) : c;
function reliefKm(cfg) { return cfg.kind === 'earth' ? 1.207 * cfg.amp : 1.9 * cfg.amp; } // km por unidad de la textura de altura (ver bakePlanet)
function makeBodyMat(b) { // material de la esfera lejana; conserva .map (textura activa) porque lo usan el mapa del sistema y el radar
  const sun = b.k === 'sun', cfg = SURF[b.n], at = ATMO[b.n], type = b.type || (b.k === 'earth' ? 'earth' : 'moon'), cl = CLOUDS[type], atmK = at ? Math.max(0.35, Math.min(1.4, at.H / 45)) : 0;
  const c = at ? new THREE.Color(at.c) : new THREE.Color(0x000000), h1 = hashStr(b.n), h2 = hashStr(b.n + '#'), h3c = (hashStr(b.n + '~') - 0.5) * 0.07; // h3c: cada mundo con algo más o menos nubes
  b.sunDir = new THREE.Vector3(1, 0, 0);
  b.U = { // uniformes compartidos por la esfera, las nubes y la aureola de este cuerpo
    uSun: { value: b.sunDir }, uAtm: { value: c }, uCloud: CLOUD_U, uCP: { value: new THREE.Vector4(cl ? cl.lo + h3c : 0, cl ? cl.hi + h3c : 1, cl ? cl.op : 0, 1) }, uCU: { value: new THREE.Vector2(h1, h2 < 0.5 ? 0 : 1) },
  };
  const glow = b.type === 'red' || b.type === 'venus' || (cfg && cfg.kind === 'venus') ? 1 : 0; // lava con luz propia
  const m = new THREE.ShaderMaterial({
    uniforms: sun ? { uMap: { value: DUMMY } } : Object.assign({ uMap: { value: DUMMY }, uHt: { value: DUMMYR }, uOp: { value: 1 }, uGl: { value: glow }, uCTint: { value: new THREE.Color() },
      uB: { value: new THREE.Vector4(cfg ? reliefKm(cfg) : 0, b.R, 1 / 256, 1 / 128) }, uK: { value: new THREE.Vector4(atmK, cfg && cfg.kind === 'earth' ? 1 : 0, SUN_I, at ? 0.09 : 0.04) } }, b.U),
    vertexShader: BODY_VS, fragmentShader: sun ? SUN_FS : PLANET_FS, extensions: { derivatives: true },
  });
  m.map = DUMMY; return m;
}
function bodyBake(b, W, H) { // parámetros del trabajo de textura de un cuerpo
  if (b.k === 'sun') return { kind: 'sun', W, H, c1: hexOf(b.c1), c2: hexOf(b.c2), seed: 3.7 };
  const cfg = SURF[b.n]; if (!cfg) return { kind: 'gas', W, H, c1: hexOf(b.c1), c2: hexOf(b.c2), seed: b.i * 7.3 };
  if (!cfg._plain) { const { _plain, cc, _cca, ...rest } = cfg; cfg._plain = JSON.parse(JSON.stringify(rest)); }
  return { kind: 'planet', W, H, R: b.R, cfg: cfg._plain };
}
function applyTex(b, tex, ht, W, H) {
  const m = b.mesh.material, U = m.uniforms; U.uMap.value = tex; if (U.uHt && ht) { U.uHt.value = ht; U.uB.value.z = 1 / W; U.uB.value.w = 1 / H; } if (tex === b.tex) m.map = tex; b.texW = W; // .map siempre apunta a la textura base (permanente): el radar y el mapa del sistema la reutilizan
}
function bodyTex(b) { // textura base (barata) de un cuerpo: se genera una vez, en el hilo principal, con la misma función que el terreno
  if (b.tex) return b.tex;
  const W = b.k === 'sun' ? TEX_SUN[0] : TEX_LO[0], H = W / 2, r = bakeRows(bodyBake(b, W, H), 0, H);
  b.tex = mkTex(r.rgba, W, H, THREE.RGBAFormat); b.htex = r.ht ? mkTex(r.ht, W, H, THREE.RedFormat) : null; applyTex(b, b.tex, b.htex, W, H); return b.tex;
}
function makeCorona(c1) { // resplandor de la estrella: brillo intenso junto al disco, halo amplio y algo de rayos; el radio del sprite = 3 radios estelares
  const N = 256, d = new Uint8ClampedArray(N * N * 4), tc = mixA([0, 0, 0], [1, 1, 1], hx(hexOf(c1)), 0.55), col = [0, 0, 0];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / (N / 2) - 1, dy = (y + 0.5) / (N / 2) - 1, r = Math.hypot(dx, dy), xr = r * 3, ang = Math.atan2(dy, dx);
    const rays = 0.55 + 0.45 * Math.abs(Math.sin(ang * 7 + 1.3) * Math.sin(ang * 3.1 + 0.4)), core = 0.9 * Math.exp(-Math.max(0, xr - 1) * 2.3), halo = 0.3 / (1 + Math.max(0, xr - 1) * Math.max(0, xr - 1) * 2.4), I = (core + halo * rays) * (1 - sstep(0.72, 1, r));
    mixA(col, [1, 0.96, 0.85], [1, 0.55, 0.18], Math.min(1, Math.max(0, (xr - 1) / 1.6)));
    const p = (y * N + x) * 4; d[p] = col[0] * tc[0] * 255; d[p + 1] = col[1] * tc[1] * 255; d[p + 2] = col[2] * tc[2] * 255; d[p + 3] = I * 255;
  }
  const t = mkTex(d, N, N, THREE.RGBAFormat); t.wrapS = THREE.ClampToEdgeWrapping; return t;
}

function createPlanets(scene, bodies, skyDome) {
  const tmpC = new THREE.Color();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, emissive: 0x0c0c0c });
  // oleaje: 3 ondas planas (longitudes 900/600/420 m, alturas 2,5/1,5/0,9 m) aplicadas solo a los vértices de agua. La GPU las suma en el shader de
  // vértices y la CPU usa la misma fórmula (waveH) para que la nave flote y cabecee con las olas; la fase por anillo se calcula en doble precisión.
  const WV = [[0.8, 0.2, 0.56, 0.9, 0.0025], [-0.4, 0.6, 0.69, 0.6, 0.0015], [0.3, -0.7, 0.65, 0.42, 0.0009]].map(([dx, dy, dz, lam, A]) => { const n = Math.hypot(dx, dy, dz), k = 6.2832 / lam; return { k: [dx / n * k, dy / n * k, dz / n * k], A, w: 2 * Math.sqrt(0.0098 * k) }; });
  const waveT = { value: 0 }, f6 = x => x.toFixed(6);
  const ringMats = RINGS.map((H, k) => { // solo los anillos finos (0 y 1) tienen olas; el 1 omite la onda más corta para no crear aliasing
    const m = terrainMat.clone(), wu = k === 0 ? [1, 1, 1] : k === 1 ? [1, 1, 0] : [0, 0, 0];
    m.onBeforeCompile = sh => {
      sh.uniforms.uT = waveT; sh.uniforms.uPh = { value: new THREE.Vector3() }; sh.uniforms.uW = { value: new THREE.Vector3(...wu) }; m.userData.sh = sh;
      const term = i => `uW.${'xyz'[i]} * ${f6(WV[i].A)} * sin(dot(position, vec3(${WV[i].k.map(f6).join(',')})) + uPh.${'xyz'[i]} + uT * ${f6(WV[i].w)})`;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aw; uniform float uT; uniform vec3 uPh; uniform vec3 uW;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n if (aw > 0.5) { float wv = ${term(0)} + ${term(1)} + ${term(2)}; transformed += normalize(normal) * wv; vColor.rgb *= 1.0 + wv * 60.0; }`);
    };
    return m;
  });
  const NV = (NG + 1) * (NG + 1), o = {}, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3();
  const sph = new THREE.Sphere(), MAXI = [3000, 6000], CELL = [0.09, 0.4], EMPTY = 0, TAKEN = new Set(), SPAWNED = new Map(), WOB = new Map(), _e = new THREE.Euler(); // SPAWNED: recursos que aparecieron con el tiempo; WOB: objetos que tiemblan al recibir el rayo // una celda = un objeto como máximo: celdas más grandes = recursos más escasos y más separados
  const idx = hole => { const a = []; for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) { if (hole && Math.abs(i + 0.5 - NG / 2) < hole && Math.abs(j + 0.5 - NG / 2) < hole) continue; const v = j * (NG + 1) + i; a.push(v, v + NG + 1, v + 1, v + 1, v + NG + 1, v + NG + 2); } return new Uint16Array(a); };
  const rings = RINGS.map((H, k) => {
    const geo = new THREE.BufferGeometry(), grp = new THREE.Group(), hole = k ? Math.floor(NG / 2 * RINGS[k - 1] / H) - 1 : 0;
    for (const a of ['position', 'color', 'normal']) geo.setAttribute(a, new THREE.BufferAttribute(new Float32Array(NV * 3), 3));
    geo.setAttribute('aw', new THREE.BufferAttribute(new Float32Array(NV), 1)); // 1 = vértice de agua (recibe el oleaje)
    const mesh = new THREE.Mesh(geo, ringMats[k]); mesh.frustumCulled = false; grp.add(mesh); scene.add(grp);
    const r = { k, H, sp: 2 * H / NG, geo, grp, mesh, mat: ringMats[k], ph: [0, 0, 0], idxFull: idx(0), idxHole: k ? idx(hole) : null, built: false, job: null, stage: null, aRel: new THREE.Vector3(), lon0: 0, lat0: 0, dlon: 0, dl: 0, center: new THREE.Vector3(), grids: null, objs: null, cells: null, cache: new Map() };
    geo.setIndex(new THREE.BufferAttribute(r.idxFull, 1));
    if (k < 2) {
      r.grids = { h: new Float32Array(NV), f: new Float32Array(NV), r: new Float32Array(NV), w: new Float32Array(NV), l: new Float32Array(NV), u: new Float32Array(NV), o: new Float32Array(NV) }; // r.objs sigue en null: describe() devuelve siempre EMPTY, no hay mallas instanciadas
    }
    grp.visible = false; return r;
  });
  // nubes de los gigantes gaseosos (solo se crean si el sistema tiene alguno)
  const clouds = { im: null, grp: { visible: false }, body: null, aRel: new THREE.Vector3(), dir: new THREE.Vector3() };
  if (bodies.some(b => b.k === 'gas')) {
    const puffGeo = merge([piece(new THREE.IcosahedronGeometry(1, 2), 0xffffff)], 0.22, 0, 11);
    const cloudMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, roughness: 1, emissive: 0x2a2a2a });
    clouds.im = new THREE.InstancedMesh(puffGeo, cloudMat, 2200); clouds.grp = new THREE.Group();
    clouds.im.frustumCulled = false; clouds.im.setColorAt(0, tmpC.setScalar(1)); clouds.im.count = 0; clouds.grp.add(clouds.im); clouds.grp.visible = false; scene.add(clouds.grp);
  }
  const skyColor = new THREE.Color(0, 0, 0), skyOut = { f: 0, color: skyColor, stars: 1 };
  // atmósfera y nubes vistas desde el espacio: dos cáscaras hijas del cuerpo (siguen su posición y escala), sin texturas propias
  const atmGeo = new THREE.SphereGeometry(1, 32, 20), cloudGeo = new THREE.SphereGeometry(1, 40, 26);
  for (const b of bodies) {
    if (b.k === 'sun') continue; const at = ATMO[b.n], cl = CLOUDS[b.type || (b.k === 'earth' ? 'earth' : 'moon')];
    if (at) {
      const w = Math.max(0.03, Math.min(0.1, 1.6 * at.H / b.R)), rd = at.c >> 16 & 255;
      const m = new THREE.ShaderMaterial({ uniforms: { uSun: b.U.uSun, uAtm: b.U.uAtm, uAP: { value: new THREE.Vector4(1 / (1 + w), 1.15, 0.85, 0) } }, vertexShader: BODY_VS, fragmentShader: ATM_FS, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      const sh = new THREE.Mesh(atmGeo, m); sh.scale.setScalar(1 + w); sh.renderOrder = 3; sh.userData.w = w; sh.visible = false; b.group.add(sh); b.atmo = sh;
    }
    if (cl) {
      b.U.uCTint = { value: new THREE.Color(cl.tint[0], cl.tint[1], cl.tint[2]) };
      const m = new THREE.ShaderMaterial({ uniforms: { uSun: b.U.uSun, uCloud: b.U.uCloud, uCP: b.U.uCP, uCU: b.U.uCU, uCTint: b.U.uCTint }, vertexShader: BODY_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false });
      const sh = new THREE.Mesh(cloudGeo, m); sh.scale.setScalar(1.006); sh.renderOrder = 2; sh.visible = false; b.group.add(sh); b.cloud = sh;
    }
  }

  // ---------- generador del terreno en segundos planos (Web Workers): las alturas y biomas se calculan fuera del hilo principal ----------
  const TW = (() => {
    if (typeof Worker === 'undefined') return null;
    try {
      const src = [`const h3=${h3.toString()};const sm=${sm.toString()};const hash3i=${hash3i.toString()};const lp3=${lp3.toString()};`, vn.toString(), `const fb=${fb.toString()};const sstep=${sstep.toString()};`, craters.toString(), sample.toString(),
        `const hx=${hx.toString()};const CC=${JSON.stringify(CC)};`, mixA.toString(), colorRGB.toString(), bakePlanet.toString(), bakeGas.toString(), bakeSun.toString(), bakeCloud.toString(), bakeSky.toString(), bakeRows.toString(),
        // trabajos de textura (tiras de filas) y de terreno
        `onmessage=e=>{const m=e.data;if(m.job){const out=bakeRows(m.P,m.j0,m.j1),tr=[];for(const k in out)if(out[k])tr.push(out[k].buffer);postMessage({id:m.id,out},tr);return;}` +
        `const NG=m.NG,NV=(NG+1)*(NG+1),R=m.R,out={h:new Float32Array(NV),w:new Float32Array(NV),f:new Float32Array(NV),k:new Float32Array(NV),l:new Float32Array(NV),dk:new Float32Array(NV),o:new Float32Array(NV)},oo={};for(let j=0,n=0;j<=NG;j++)for(let i=0;i<=NG;i++,n++){const lon=m.lon0+(i-NG/2)*m.dlon,lat=Math.max(-1.5,Math.min(1.5,m.lat0+(j-NG/2)*m.dl)),cl=Math.cos(lat),x=cl*Math.cos(lon)*R,y=Math.sin(lat)*R,z=cl*Math.sin(lon)*R;sample(m.cfg,x,y,z,oo,m.sp);out.h[n]=oo.h;out.w[n]=oo.water;out.f[n]=oo.forest;out.k[n]=oo.rock;out.l[n]=oo.lava;out.dk[n]=oo.dark;out.o[n]=oo.ore;}postMessage({id:m.id,out},[out.h.buffer,out.w.buffer,out.f.buffer,out.k.buffer,out.l.buffer,out.dk.buffer,out.o.buffer]);};`].join('\n');
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), pool = [new Worker(url), new Worker(url)], pending = new Map(); let nid = 1, dead = false;
      const fail = () => { dead = true; for (const q of pending.values()) { q.done = true; q.out = null; } pending.clear(); };
      for (const w of pool) { w.onmessage = e => { const q = pending.get(e.data.id); if (q) { q.out = e.data.out; q.done = true; pending.delete(e.data.id); } }; w.onerror = fail; }
      return { request(slot, msg) { if (dead) return null; const q = { done: false, out: null }; msg.id = nid++; pending.set(msg.id, q); pool[slot % pool.length].postMessage(msg); return q; } };
    } catch (err) { return null; } // sin workers: se genera en el hilo principal como antes
  })();

  // ---------- texturas por tiras: alta resolución solo para los mundos cercanos, nubes y cielo compartidos ----------
  // Cada trabajo es un generador que pide tiras de filas a los workers (dos a la vez) y las copia en la textura; sin workers las calcula en el hilo principal en trozos pequeños.
  const bakeJobs = [];
  function* stripJob(P, want, done) {
    const W = P.W, H = P.H, out = { rgba: want.rgba ? new Uint8ClampedArray(W * H * 4) : null, ht: want.ht ? new Uint8Array(W * H) : null }, pend = []; let next = 0;
    const put = (r, j0) => { if (out.rgba && r.rgba) out.rgba.set(r.rgba, j0 * W * 4); if (out.ht && r.ht) out.ht.set(r.ht, j0 * W); };
    while (next < H || pend.length) {
      while (next < H && pend.length < 2) {
        const j0 = next; let j1 = Math.min(H, j0 + 32); const q = TW ? TW.request(pend.length ? 1 : 0, { job: 1, P, j0, j1 }) : null;
        if (q) { next = j1; pend.push({ j0, j1, q }); continue; }
        j1 = Math.min(H, j0 + 2); next = j1; put(bakeRows(P, j0, j1), j0); yield; // sin workers: pocas filas por cuadro
      }
      yield;
      for (let k = 0; k < pend.length; k++) if (pend[k].q.done) { const e = pend[k]; put(e.q.out || bakeRows(P, e.j0, e.j1), e.j0); pend.splice(k--, 1); }
    }
    done(out);
  }
  const runBakes = () => { for (let k = bakeJobs.length - 1; k >= 0; k--) if (bakeJobs[k].next().done) bakeJobs.splice(k, 1); };
  const HI = new Map(); // cuerpo -> { tex, ht } de alta resolución en uso; b.hiJob: trabajo en curso
  function wantHi(b) { // ¿está este cuerpo entre los 2 más cercanos y a menos de 30 radios (12 el segundo)?
    let n = 0; for (const o of bodies) if (o !== b && o.k !== 'sun' && o.dist < b.dist) n++;
    return n === 0 ? b.dist < b.R * 30 : n === 1 ? b.dist < b.R * 12 : false;
  }
  function startHi(b) {
    const P = bodyBake(b, TEX_HI[0], TEX_HI[1]); b.hiJob = true;
    bakeJobs.push(stripJob(P, { rgba: true, ht: P.kind !== 'sun' }, out => {
      b.hiJob = false; if (!b.hiWanted) return; // ya no hace falta: se descarta
      const tex = mkTex(out.rgba, TEX_HI[0], TEX_HI[1], THREE.RGBAFormat), ht = out.ht ? mkTex(out.ht, TEX_HI[0], TEX_HI[1], THREE.RedFormat) : null; HI.set(b, { tex, ht }); b.texHi = tex; applyTex(b, tex, ht, TEX_HI[0], TEX_HI[1]);
    }));
  }
  function releaseHi(b) { // libera la textura de alta resolución (GPU y memoria) y vuelve a la base
    const h = HI.get(b); if (!h) return; HI.delete(b); b.texHi = null; applyTex(b, b.tex, b.htex, TEX_LO[0], TEX_LO[1]); h.tex.dispose(); h.tex.image.data = null; if (h.ht) { h.ht.dispose(); h.ht.image.data = null; }
  }
  function updateHi(bestAlt) { // pide/quita texturas grandes según la cercanía; con el suelo cerca se prioriza el terreno (no se lanzan trabajos nuevos)
    for (const b of bodies) {
      if (b.k === 'sun' || !b.tex) continue; const w = wantHi(b); b.hiWanted = w;
      if (w && !HI.has(b) && !b.hiJob && bestAlt > 600) startHi(b);
      else if (!w && HI.has(b) && b.dist > b.R * 60 && !window.MAPOPEN) releaseHi(b);
    }
  }
  // estáticos: densidad de nubes (compartida) y Vía Láctea; se generan en segundo plano nada más crear los planetas
  if (bodies.some(b => b.cloud)) bakeJobs.push(stripJob({ kind: 'cloud', W: 1024, H: 512 }, { ht: true }, out => { CLOUD_U.value = mkTex(out.ht, 1024, 512, THREE.RedFormat); }));
  if (skyDome) bakeJobs.push(stripJob({ kind: 'sky', W: 1024, H: 512, gn: SKY_GN }, { rgba: true }, out => skyDome.setTexture(mkTex(out.rgba, 1024, 512, THREE.RGBAFormat))));
  const PADS = []; // plataformas de hangar: { n (planeta), d (dirección), r (radio, km), top (altura sobre el radio del planeta), cosX }
  const st = { body: null, vel: new THREE.Vector3(), pv: null, pt: 0, pb: null }, _pr = new THREE.Vector3(), _v2 = new THREE.Vector3(), api = { info: { on: false, ground: Infinity, name: '', water: undefined, h: undefined } };
  const dirOf = (lon, lat, out) => out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  api.surfaceR = (b, d, l) => { // radio del suelo real bajo la nave (terreno procedural, núcleo de gas o superficie del Sol)
    if (b.k === 'sun') return b.R; if (b.k === 'gas') return b.R * 0.97;
    const cfg = SURF[b.n]; if (!cfg) return b.R;
    const s = b.R / l; sample(cfg, d[0] * s, d[1] * s, d[2] * s, o); let h = o.h;
    for (const p of PADS) if (p.n === b.n && (d[0] * p.d[0] + d[1] * p.d[1] + d[2] * p.d[2]) / l > p.cos) h = Math.max(h, p.top); // el hormigón del hangar es suelo firme
    return b.R + h;
  };
  api.addPad = (name, dir, radius, top) => { // registra una plataforma: sube el suelo y despeja la vegetación a su alrededor
    const b = bodies.find(x => x.n === name); if (!b || PADS.some(p => p.n === name && Math.abs(p.d[0] - dir[0]) + Math.abs(p.d[1] - dir[1]) + Math.abs(p.d[2] - dir[2]) < 1e-9)) return;
    PADS.push({ n: name, d: dir, r: radius, top, cos: Math.cos(radius / b.R), cosX: Math.cos((radius + 0.03) / b.R) }); rings.forEach(r => r.cache.clear());
  };
  api.removePad = (name, dir) => { const i = PADS.findIndex(p => p.n === name && Math.abs(p.d[0] - dir[0]) + Math.abs(p.d[1] - dir[1]) + Math.abs(p.d[2] - dir[2]) < 1e-9); if (i >= 0) { PADS.splice(i, 1); rings.forEach(r => r.cache.clear()); } };

  // ---------- construcción de un anillo de terreno repartida entre cuadros ----------
  function* buildJob(r, b, cfg, n3) {
    const R = b.R, lat = Math.max(-1.45, Math.min(1.45, Math.asin(n3.y))), lon = Math.atan2(n3.z, n3.x), dl = r.sp / R;
    const lat0 = Math.round(lat / dl) * dl, dlon = dl / Math.max(0.05, Math.cos(Math.round(lat0 / 0.03) * 0.03)), lon0 = Math.round(lon / dlon) * dlon;
    const dir0 = dirOf(lon0, lat0, new THREE.Vector3()), aRel = dir0.clone().multiplyScalar(R), drop = r.k ? 0.03 * r.sp : 0;
    const S = r.stage || (r.stage = { pos: new Float32Array(NV * 3), col: new Float32Array(NV * 3), nor: new Float32Array(NV * 3), ups: new Float32Array(NV * 3), h: new Float32Array(NV), w: new Float32Array(NV), f: new Float32Array(NV), k: new Float32Array(NV), l: new Float32Array(NV), dk: new Float32Array(NV), u: new Float32Array(NV), o: new Float32Array(NV), aw: new Float32Array(NV) });
    const d = new THREE.Vector3(), c = new THREE.Color(), oo = {};
    const rq = TW && TW.request(r.k, { cfg: cfg._plain || (cfg._plain = JSON.parse(JSON.stringify(cfg))), R, lon0, lat0, dlon, dl, sp: r.sp, NG }); if (rq) while (!rq.done) yield; // el worker calcula alturas y biomas mientras el juego sigue
    const wo = rq && rq.out;
    for (let j = 0, n = 0; j <= NG; j++) { // fase 1: alturas y atributos de bioma
      for (let i = 0; i <= NG; i++, n++) {
        dirOf(lon0 + (i - NG / 2) * dlon, Math.max(-1.5, Math.min(1.5, lat0 + (j - NG / 2) * dl)), d); if (wo) { oo.h = wo.h[n]; oo.water = wo.w[n]; oo.forest = wo.f[n]; oo.rock = wo.k[n]; oo.lava = wo.l[n]; oo.dark = wo.dk[n]; oo.ore = wo.o[n]; } else sample(cfg, d.x * R, d.y * R, d.z * R, oo, r.sp);
        const rr = R + oo.h - drop, n3_ = n * 3;
        S.pos[n3_] = d.x * rr - aRel.x; S.pos[n3_ + 1] = d.y * rr - aRel.y; S.pos[n3_ + 2] = d.z * rr - aRel.z; S.ups[n3_] = d.x; S.ups[n3_ + 1] = d.y; S.ups[n3_ + 2] = d.z;
        S.h[n] = oo.h; S.w[n] = oo.water; S.f[n] = oo.forest; S.k[n] = oo.rock; S.l[n] = oo.lava; S.dk[n] = oo.dark; S.o[n] = oo.ore; S.aw[n] = oo.water >= 0 ? 1 : 0;
      }
      if (j % (wo ? 24 : 6) === (wo ? 23 : 5)) yield;
    }
    for (let j = 0; j <= NG; j++) { // fase 2: normales por diferencias centrales (sin recorrer la malla dos veces)
      for (let i = 0; i <= NG; i++) {
        const n = j * (NG + 1) + i, iL = j * (NG + 1) + Math.max(i - 1, 0), iR = j * (NG + 1) + Math.min(i + 1, NG), jD = Math.max(j - 1, 0) * (NG + 1) + i, jU = Math.min(j + 1, NG) * (NG + 1) + i, P = S.pos;
        const ax = P[iR * 3] - P[iL * 3], ay = P[iR * 3 + 1] - P[iL * 3 + 1], az = P[iR * 3 + 2] - P[iL * 3 + 2], bx = P[jU * 3] - P[jD * 3], by = P[jU * 3 + 1] - P[jD * 3 + 1], bz = P[jU * 3 + 2] - P[jD * 3 + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (nx * S.ups[n * 3] + ny * S.ups[n * 3 + 1] + nz * S.ups[n * 3 + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
        S.nor[n * 3] = nx; S.nor[n * 3 + 1] = ny; S.nor[n * 3 + 2] = nz; S.u[n] = nx * S.ups[n * 3] + ny * S.ups[n * 3 + 1] + nz * S.ups[n * 3 + 2];
      }
      if (j % 24 === 23) yield;
    }
    for (let j = 0, n = 0; j <= NG; j++) { // fase 3: colores
      for (let i = 0; i <= NG; i++, n++) {
        oo.h = S.h[n]; oo.water = S.w[n]; oo.forest = S.f[n]; oo.rock = S.k[n]; oo.lava = S.l[n]; oo.dark = S.dk[n];
        colorAt(cfg, oo, S.u[n], c, S.ups[n * 3] * R, S.ups[n * 3 + 1] * R, S.ups[n * 3 + 2] * R, cfg.cc); S.col[n * 3] = c.r; S.col[n * 3 + 1] = c.g; S.col[n * 3 + 2] = c.b;
      }
      if (j % 16 === 15) yield;
    }
    const g = r.geo; // intercambio atómico: la malla antigua se ve hasta este instante
    if (g.attributes.position.array.length < NV * 3) { for (const a of ['position', 'color', 'normal']) g.setAttribute(a, new THREE.BufferAttribute(new Float32Array(NV * 3), 3)); g.setAttribute('aw', new THREE.BufferAttribute(new Float32Array(NV), 1)); } // se liberaron al alejarse
    g.attributes.position.array.set(S.pos); g.attributes.color.array.set(S.col); g.attributes.normal.array.set(S.nor);
    g.attributes.aw.array.set(S.aw); g.attributes.aw.needsUpdate = true; r.ph = WV.map(c => (c.k[0] * aRel.x + c.k[1] * aRel.y + c.k[2] * aRel.z) % 6.283185307);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.normal.needsUpdate = true; g.computeBoundingSphere();
    r.lat0 = lat0; r.lon0 = lon0; r.dlon = dlon; r.dl = dl; r.aRel.copy(aRel); r.center.copy(dir0); r.body = b; r.built = true; r.buildMs = performance.now() - (r.t0 || performance.now()); // r.buildMs: lo que tarda este anillo (para adelantarse al movimiento)
    if (r.grids) { for (const [a, s] of [['h', 'h'], ['f', 'f'], ['r', 'k'], ['w', 'w'], ['l', 'l'], ['u', 'u'], ['o', 'o']]) r.grids[a].set(S[s]); buildCells(r, b); }
  }

  // ---------- celdas de objetos: se listan al recentrar el anillo y se describen SOLO cuando entran en el campo de visión ----------
  function buildCells(r, b) {
    const R = b.R, dlc = CELL[r.k] / R, half = r.H * 0.95, skip = r.k === 1 ? RINGS[0] * 0.92 : 0, pos = [], jr = [], ir = [], d = new THREE.Vector3();
    for (let j = Math.floor((r.lat0 - half / R) / dlc); j <= Math.floor((r.lat0 + half / R) / dlc); j++) {
      const lat = (j + 0.5) * dlc; if (Math.abs(lat) > 1.4) continue;
      const cl = Math.cos(lat), dlonc = dlc / cl;
      for (let i = Math.floor((r.lon0 - half / (R * cl)) / dlonc); i <= Math.floor((r.lon0 + half / (R * cl)) / dlonc); i++) {
        const lon = (i + 0.5) * dlonc; if (Math.hypot((lon - r.lon0) * cl * R, (lat - r.lat0) * R) < skip) continue;
        const fi = Math.max(0.5, Math.min(NG - 0.5, (lon - r.lon0) / r.dlon + NG / 2)), fj = Math.max(0.5, Math.min(NG - 0.5, (lat - r.lat0) / r.dl + NG / 2)), rr = R + bil(r.grids.h, fi, fj); // a la altura real del terreno
        dirOf(lon, lat, d); pos.push(d.x * rr - r.aRel.x, d.y * rr - r.aRel.y, d.z * rr - r.aRel.z); jr.push(j); ir.push(i);
      }
    }
    r.cells = { pos: new Float32Array(pos), jr: Int32Array.from(jr), ir: Int32Array.from(ir), n: jr.length }; r.keys = new Set(jr.map((j, n) => j * 4194304 + ir[n])); // celdas que realmente se dibujan
  }
  const bil = (arr, fi, fj) => { const i0 = Math.min(NG - 1, Math.floor(fi)), j0 = Math.min(NG - 1, Math.floor(fj)), tx = fi - i0, ty = fj - j0, n = j0 * (NG + 1) + i0; return (arr[n] * (1 - tx) + arr[n + 1] * tx) * (1 - ty) + (arr[n + NG + 1] * (1 - tx) + arr[n + NG + 2] * tx) * ty; };
  function describe(r, b, cfg, jr, ir, force) {
    return EMPTY; // los planetas ya no generan recursos ni vegetación: el terreno queda limpio (los recursos están en los asteroides) // objetos de una celda (determinista por coordenadas); undefined = todavía fuera de la malla, se reintenta
    const R = b.R, bi = bodies.indexOf(b), dlc = CELL[r.k] / R, lat = (jr + 0.5) * dlc, cl = Math.cos(lat), dlonc = dlc / cl, g = r.grids;
    const rnd = rndOf((jr * 73856093) ^ (ir * 19349663) ^ (bi * 83492791) ^ (r.k * 2654435)), lonj = (ir + 0.2 + 0.6 * rnd()) * dlonc, latj = (jr + 0.2 + 0.6 * rnd()) * dlc;
    const fi = (lonj - r.lon0) / r.dlon + NG / 2, fj = (latj - r.lat0) / r.dl + NG / 2; if (fi < 0.5 || fi > NG - 0.5 || fj < 0.5 || fj > NG - 0.5) return undefined;
    const h = bil(g.h, fi, fj), fo = bil(g.f, fi, fj), rk = bil(g.r, fi, fj), w = bil(g.w, fi, fj), lv = bil(g.l, fi, fj), up = bil(g.u, fi, fj), ore = bil(g.o, fi, fj), slope = 1 - up, r1 = force !== undefined ? (rnd(), force) : rnd(), r2 = rnd(), r3 = rnd();
    let key = null, size = 0, tint = 0.9 + 0.2 * r3, big = r.k === 1;
    const oreP = (big ? 0.04 : 0.008) * (0.25 + 1.8 * ore * (0.5 + slope * 2)); // los minerales aparecen sobre todo en montañas y zonas rocosas
    const tk = bi + ':' + r.k + ':' + jr + ':' + ir; if (force === undefined) { const sp = SPAWNED.get(tk); if (sp) return sp; if (TAKEN.has(tk)) return EMPTY; } // force: intento de aparición (ignora la probabilidad normal de la celda)
    if (cfg.kind === 'earth' && w >= 0.02) return EMPTY;
    if (r1 < oreP) { key = r2 < 0.4 ? 'copper' : r2 < 0.65 ? 'silver' : r2 < 0.87 ? 'gold' : 'diamond'; size = big ? 0.03 + 0.09 * r3 : 0.004 + 0.012 * r3; tint = 1.15; }
    else if (cfg.kind === 'earth') {
      if (fo > 0.2 && r1 < 0.06 + 0.5 * fo && slope < 0.3 && h < 3.4) { key = h > 1.2 || r2 < 0.5 ? 'pine' : 'oak'; size = (big ? 0.03 : 0.014) + (big ? 0.025 : 0.02) * r3; }
      else if (r1 < (big ? 0.012 : 0.02) && slope < 0.3 && h < 3) { key = 'bush'; size = big ? 0.02 : 0.004 + 0.003 * r3; }
      else if (r1 < (big ? 0.012 : 0.01) + 0.08 * rk + 0.1 * slope) { key = big ? (h > 3 && r2 < 0.35 ? 'spire' : 'boulder') : r2 < 0.5 ? 'rock' : 'rock2'; size = big ? 0.03 + 0.09 * r3 * r3 + (key === 'spire' ? 0.1 : 0) : 0.002 + 0.008 * r3 * r3 * r3; tint = 0.75 + 0.3 * r3; }
    } else if (cfg.kind === 'venus' && lv > 0.4 && r1 < 0.12) { key = 'lava'; size = big ? 0.05 + 0.1 * r3 : 0.003 + 0.006 * r3; tint = 1; }
    else if (slope < 0.2 && r1 < (big ? 0.03 : 0.012)) { key = 'flora'; size = (big ? 0.03 : 0.012) + (big ? 0.03 : 0.02) * r3; tint = 0.85 + 0.3 * r3; }
    else if (r1 < 0.03 + 0.08 * slope + 0.04 * rk) { key = big ? (r2 < 0.12 || h > 8 ? 'spire' : 'boulder') : r2 < 0.5 ? 'rock' : 'rock2'; size = big ? 0.04 + 0.16 * r3 * r3 + (key === 'spire' ? 0.12 : 0) : 0.0015 + 0.006 * r3 * r3 * r3; tint = 0.7 + 0.5 * r3; }
    if (!key) return EMPTY;
    dirOf(lonj, latj, _u); for (const p of PADS) if (p.n === b.n && _u.x * p.d[0] + _u.y * p.d[1] + _u.z * p.d[2] > p.cosX) return EMPTY; // nada crece sobre la plataforma
    _q.setFromUnitVectors(_Y, _u); _q2.setFromAxisAngle(_Y, rnd() * 6.283); _q.multiply(_q2);
    const rr = R + h - size * 0.1 - (big ? 0.03 * r.sp : 0), isOre = MINERALS[key] !== undefined;
    if (key === 'pine' || key === 'oak' || key === 'bush' || key === 'lava' || key === 'flora' || isOre) tmpC.setScalar(tint); else tmpC.set(cfg.objs ? cfg.objs[r2 < 0.5 ? 0 : 1] : 0xaaaaaa).multiplyScalar(tint); // rocas: color del planeta
    return { k: key, p: [_u.x * rr, _u.y * rr, _u.z * rr], q: [_q.x, _q.y, _q.z, _q.w], s: size, sy: key === 'boulder' ? 0.8 : 1, c: [tmpC.r, tmpC.g, tmpC.b], v: rnd() }; // v: para aclarar la vegetación desde la nave
  }

  function buildClouds(b, nrm3) { // capas de nubes: 3 capas, celdas de 50 km, 900 km a la redonda (solo cuando se está sobre un gigante gaseoso)
    const R = b.R, dlc = 50 / R, half = 900, lat = Math.asin(nrm3.y), lon = Math.atan2(nrm3.z, nrm3.x), p1 = new THREE.Color(b.c1), p2 = new THREE.Color(b.c2), u = new THREE.Vector3();
    dirOf(lon, lat, clouds.dir); clouds.aRel.copy(clouds.dir).multiplyScalar(R); let n = 0; const bi = bodies.indexOf(b);
    for (let jr = Math.floor((lat - half / R) / dlc); jr <= Math.floor((lat + half / R) / dlc) && n < 2200; jr++) {
      const la = (jr + 0.5) * dlc, cl = Math.cos(la), dlonc = dlc / Math.max(0.05, cl);
      for (let ir = Math.floor((lon - half / (R * cl)) / dlonc); ir <= Math.floor((lon + half / (R * cl)) / dlonc) && n < 2200; ir++) for (let layer = 0; layer < 3; layer++) {
        const rnd = rndOf((jr * 73856093) ^ (ir * 19349663) ^ (bi * 83492791) ^ (layer * 2654435)), lo = (ir + rnd()) * dlonc, lt = (jr + rnd()) * dlc;
        const px = Math.cos(lt) * Math.cos(lo) * R, py = Math.sin(lt) * R, pz = Math.cos(lt) * Math.sin(lo) * R;
        if (fb(px / 400 + layer * 7, py / 400, pz / 400, 5) < 0.46 || rnd() < 0.3) continue;
        const s = 15 + 55 * rnd() * rnd(), rr = R + [30, 0, -60][layer] + (rnd() - 0.5) * 20; dirOf(lo, lt, u);
        _q.setFromUnitVectors(_Y, u); _q2.setFromAxisAngle(_Y, rnd() * 6.283); _q.multiply(_q2); _p.set(u.x * rr - clouds.aRel.x, u.y * rr - clouds.aRel.y, u.z * rr - clouds.aRel.z);
        _s.set(s * 1.6, s * 0.35, s * 1.6); _m.compose(_p, _q, _s); clouds.im.setMatrixAt(n, _m); clouds.im.setColorAt(n, tmpC.copy(p1).lerp(p2, rnd()).multiplyScalar(1.15)); n++;
      }
    }
    clouds.im.count = n; clouds.im.instanceMatrix.needsUpdate = true; if (clouds.im.instanceColor) clouds.im.instanceColor.needsUpdate = true; clouds.body = b;
  }

  api.sky = (P, sun) => { // cielo: a medida que baja hacia una atmósfera el fondo toma su color, la niebla sube y las estrellas se apagan
    let best = null, bf = 0, bd = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], at = ATMO[b.n]; if (!at) continue; const d = b.dist, f = sstep(at.H * 6, at.H * 0.15, d - b.R); // b.dist: la calcula game.js cada cuadro
      if (f > bf) { bf = f; best = b; bd = d; }
    }
    if (!best) { skyColor.setRGB(0, 0, 0); skyOut.f = 0; skyOut.stars = 1; return skyOut; }
    const up = ((P[0] - best.pos[0]) * sun.x + (P[1] - best.pos[1]) * sun.y + (P[2] - best.pos[2]) * sun.z) / bd, day = Math.max(0, Math.min(1, up * 1.5 + 0.35));
    skyColor.set(ATMO[best.n].c).multiplyScalar((0.04 + 0.96 * day) * bf); skyOut.f = bf; skyOut.stars = 1 - bf * (0.2 + 0.8 * day);
    return skyOut; // el mismo objeto cada cuadro (sin asignaciones)
  };

  const runJobs = ms => { const t0 = performance.now(); for (let k = rings.length - 1; k >= 0; k--) { const r = rings[k]; while (r.job && performance.now() - t0 < ms) if (r.job.next().done) r.job = null; if (performance.now() - t0 >= ms) return; } }; // primero los anillos gruesos (cubren todo), luego los finos
  function holeFor(r, inner) { // índice del anillo r sin los cuadros que ya cubre 'inner' (su cobertura real, no la de un hueco centrado): así nunca queda un agujero
    const key = r.lon0 + ',' + r.lat0 + ',' + inner.lon0 + ',' + inner.lat0; if (r.holeKey === key) return r.holeIdx;
    const mLon = NG / 2 * inner.dlon * 0.97, mLat = NG / 2 * inner.dl * 0.97, i0 = Math.ceil((inner.lon0 - mLon - r.lon0) / r.dlon + NG / 2) + 1, i1 = Math.floor((inner.lon0 + mLon - r.lon0) / r.dlon + NG / 2) - 1, j0 = Math.ceil((inner.lat0 - mLat - r.lat0) / r.dl + NG / 2) + 1, j1 = Math.floor((inner.lat0 + mLat - r.lat0) / r.dl + NG / 2) - 1, a = [];
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) { if (i >= i0 && i + 1 <= i1 && j >= j0 && j + 1 <= j1) continue; const v = j * (NG + 1) + i; a.push(v, v + NG + 1, v + 1, v + 1, v + NG + 1, v + NG + 2); }
    r.holeKey = key; return (r.holeIdx = Uint16Array.from(a));
  }
  function releaseRings() { // lejos de todo mundo: se liberan las mallas de terreno (GPU y buffers de trabajo); se reasignan al volver a acercarse
    for (const r of rings) {
      if (r.job) continue; r.stage = null;
      if (r.geo.attributes.position.array.length > 3) { r.geo.dispose(); for (const a of ['position', 'color', 'normal']) r.geo.setAttribute(a, new THREE.BufferAttribute(new Float32Array(3), 3)); r.geo.setAttribute('aw', new THREE.BufferAttribute(new Float32Array(1), 1)); }
    }
  }
  const resetBody = () => { rings.forEach(r => { r.built = false; r.job = null; r.grp.visible = false; r.cells = null; r.cache.clear(); if (r.objs) for (const im of Object.values(r.objs)) im.count = 0; }); };
  let ready = false, lastT = performance.now(), frameN = 0, idleT = 0; const _n3 = new THREE.Vector3(), INFO = api.info;
  api.update = (P, sun, fwd) => { // cada cuadro: elegir el mundo más cercano, encolar reconstrucciones, avanzar los generadores y fundir esfera ↔ terreno
    const tNow = performance.now(), dts = Math.min(0.1, (tNow - lastT) / 1000); lastT = tNow; frameN++;
    for (let i = 0; i < bodies.length; i++) { // por cuerpo: dirección de la estrella, cáscaras de atmósfera y nubes solo si se distinguen, deriva de las nubes
      const b = bodies[i]; if (b.k === 'sun' || !b.U) continue;
      const pl = Math.sqrt(b.pos[0] * b.pos[0] + b.pos[1] * b.pos[1] + b.pos[2] * b.pos[2]) || 1; b.sunDir.set(-b.pos[0] / pl, -b.pos[1] / pl, -b.pos[2] / pl); // la estrella está en el origen
      const alt = b.dist - b.R;
      if (b.atmo) b.atmo.visible = alt > b.R * b.atmo.userData.w && b.dist < b.R * 150; // dentro de la atmósfera se usa el cielo
      if (b.cloud) { const vis = CLOUD_U.value !== DUMMYR && alt > 8 && b.dist < b.R * 150; b.cloud.visible = vis; if (vis) { b.U.uCP.value.w = sstep(10, 60, alt); b.U.uCU.value.x += dts * 0.0004; } }
    }
    let best = null, bestAlt = Infinity;
    for (let i = 0; i < bodies.length; i++) { const b = bodies[i]; if (b.k === 'sun') continue; const alt = b.dist - b.R; if (alt < bestAlt) { bestAlt = alt; best = b; } } // b.dist: distancia al centro, calculada por game.js este mismo cuadro
    const solid = best && SURF[best.n], gasOn = best && best.k === 'gas' && bestAlt < 1500, on = !!solid && bestAlt < PREBUILD;
    INFO.on = false; INFO.ground = Infinity; INFO.name = best ? best.n : ''; INFO.water = undefined; INFO.h = undefined; // el mismo objeto cada cuadro (sin asignaciones)
    if (frameN % 12 === 0) updateHi(bestAlt); runBakes();
    const setFade = (b, t) => { const m = b.mesh.material; m.uniforms.uOp.value = 1 - t; m.transparent = t > 0; };
    const restore = () => { if (st.body && st.body.mesh) { st.body.mesh.visible = true; setFade(st.body, 0); } };
    if (st.body && st.body !== best) { restore(); resetBody(); st.body = null; ready = false; }
    clouds.grp.visible = false;
    if (gasOn) { // gigante gaseoso: campo de nubes centrado bajo la nave
      const d = _n3.set(P[0] - best.pos[0], P[1] - best.pos[1], P[2] - best.pos[2]).normalize();
      if (clouds.body !== best || Math.acos(Math.min(1, d.dot(clouds.dir))) * best.R > 250) buildClouds(best, d);
      clouds.grp.visible = true; clouds.grp.position.set(best.pos[0] + clouds.aRel.x - P[0], best.pos[1] + clouds.aRel.y - P[1], best.pos[2] + clouds.aRel.z - P[2]);
    }
    if (!on) {
      restore(); if (st.body) resetBody(); rings.forEach(r => r.grp.visible = false); st.body = null; ready = false;
      if (idleT === 0) idleT = tNow; else if (idleT > 0 && tNow - idleT > 8000) { releaseRings(); idleT = -1; } // 8 s lejos de los mundos: se liberan los anillos de terreno
      return;
    }
    idleT = 0; const b = best, cfg = SURF[b.n];
    if (st.body !== b) st.body = b; // mundo nuevo
    const nrm3 = _n3.set(P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]).normalize();
    const relV = _v2.set(P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]);
    if (st.pv && st.pb === b) { const dtv = Math.max(0.001, Math.min(0.25, (tNow - st.pt) / 1000)); st.vel.lerp(_pr.copy(relV).sub(st.pv).divideScalar(dtv), 0.15); } else st.vel.set(0, 0, 0); // velocidad respecto al suelo (km/s)
    st.pv = (st.pv || new THREE.Vector3()).copy(relV); st.pt = tNow; st.pb = b;
    const speed = st.vel.length();
    for (let k = RINGS.length - 1; k >= 0; k--) { // encolar (no construir): se reparte entre cuadros; el anillo se centra donde estarás cuando termine de construirse
      const r = rings[k], need = k >= 3 || bestAlt < 6 * r.H + (k < 2 ? cfg.amp * 1.3 : 0);
      const lead = Math.min(4, Math.max(0.6, (r.buildMs || 800) / 1000 * 1.4)), disp = speed * lead, cap = 0.5 * r.H;
      _pr.copy(relV).addScaledVector(st.vel, disp > cap ? lead * cap / disp : lead).normalize();
      const errNow = Math.acos(Math.min(1, nrm3.dot(r.center))) * b.R, errPred = Math.acos(Math.min(1, _pr.dot(r.center))) * b.R;
      if (need && !r.job && (!r.built || errNow > 0.3 * r.H || errPred > 0.45 * r.H)) { r.t0 = performance.now(); r.job = buildJob(r, b, cfg, _pr.clone()); }
    }
    const coarse = (r, k) => k >= 2 && (k >= 3 || bestAlt < 6 * r.H);
    ready = rings.every((r, k) => r.built || !coarse(r, k)); // el terreno se muestra en cuanto están los anillos gruesos; los finos aparecen al terminar
    runJobs(!ready ? 14 : rings.some(r => r.job && r.k < 2) ? 8 : 5); // más presupuesto mientras falta terreno
    const t = ready ? sstep(TALT, TALT - 80, bestAlt) : 0; // 0 lejos (esfera) → 1 cerca (terreno); solo funde cuando todo está construido
    for (const m of ringMats) { m.opacity = t; m.transparent = t < 1; }
    waveT.value = performance.now() / 1000; b.mesh.visible = t < 1; setFade(b, t);
    for (let k = 0; k < RINGS.length; k++) {
      const r = rings[k], vis = r.built && (k >= 3 || bestAlt < 6 * r.H + (k < 2 ? cfg.amp * 1.3 : 0)) && t > 0; r.grp.visible = vis;
      if (!vis) continue;
      if (k) { const inner = rings[k - 1], want = inner.grp.visible && inner.built ? holeFor(r, inner) : r.idxFull; if (r.geo.index.array !== want) r.geo.setIndex(new THREE.BufferAttribute(want, 1)); }
      r.grp.position.set(b.pos[0] + r.aRel.x - P[0], b.pos[1] + r.aRel.y - P[1], b.pos[2] + r.aRel.z - P[2]);
      const sh = r.mat.userData.sh; if (sh) sh.uniforms.uPh.value.set(r.ph[0], r.ph[1], r.ph[2]);
    }
    if (bestAlt < TALT) { const s = b.R / Math.hypot(P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]); const rx = P[0] - b.pos[0], ry = P[1] - b.pos[1], rz = P[2] - b.pos[2], rl = Math.hypot(rx, ry, rz); sample(cfg, rx * s, ry * s, rz * s, o); let hh = o.h, onPad = false;
      for (const pd of PADS) if (pd.n === b.n && (rx * pd.d[0] + ry * pd.d[1] + rz * pd.d[2]) / rl > pd.cos && pd.top > hh) { hh = pd.top; onPad = true; } // sobre la plataforma de un hangar el suelo es el hormigón
      INFO.on = true; INFO.ground = bestAlt - hh; INFO.name = b.n; INFO.water = o.water >= 0 && !onPad; INFO.h = hh; }
  };

  // ---------- visibilidad: solo se describen y se dibujan las celdas dentro del campo de visión ----------
  api.cull = (frustum) => {
    return; // sin objetos que dibujar
    if (!st.body || !ready) return;
    const b = st.body, cfg = SURF[b.n], tnow = performance.now(); let budget = 500; // celdas nuevas que se describen por cuadro
    for (const r of rings) {
      if (!r.objs || !r.grp.visible || !r.cells) continue;
      const counts = {}, ax = r.grp.position.x, ay = r.grp.position.y, az = r.grp.position.z, C = r.cells;
      sph.radius = CELL[r.k] * 1.6 + (r.k ? 0.25 : 0.05); const keep = typeof S !== 'undefined' && S.foot && S.foot.on ? 1 : r.k ? 0.2 : 0.1; // en la nave solo una fracción de los recursos (el presupuesto va al relieve); a pie, todos
      for (let c = 0; c < C.n; c++) {
        sph.center.set(ax + C.pos[c * 3], ay + C.pos[c * 3 + 1], az + C.pos[c * 3 + 2]);
        if (!frustum.intersectsSphere(sph) && !(r.k === 0 && sph.center.lengthSq() < 0.09)) continue; // fuera del campo de visión: ni se describe ni se dibuja (salvo lo que está a menos de ~300 m: eso no desaparece)
        const key = C.jr[c] * 4194304 + C.ir[c]; let list = r.cache.get(key);
        if (list === undefined) { if (budget <= 0) continue; budget--; list = describe(r, b, cfg, C.jr[c], C.ir[c]); if (list === undefined) continue; r.cache.set(key, list); }
        if (list === EMPTY || list.v > keep) continue;
        const im = r.objs[list.k], n = counts[list.k] || 0; if (n >= MAXI[r.k]) continue;
        _p.set(list.p[0] - r.aRel.x, list.p[1] - r.aRel.y, list.p[2] - r.aRel.z); _q.set(list.q[0], list.q[1], list.q[2], list.q[3]); _s.set(list.s, list.s * list.sy, list.s);
        if (WOB.size) { const wb = WOB.get(r.k + ':' + key); if (wb) { const kk = Math.exp(-(tnow - wb.last) / 220); if (kk < 0.03) WOB.delete(r.k + ':' + key); else { const a1 = 0.13 * wb.amp * kk * Math.sin(tnow / 21), a2 = 0.13 * wb.amp * kk * Math.cos(tnow / 17); _q.multiply(_q2.setFromEuler(_e.set(a1, 0, a2))); } } }
        _m.compose(_p, _q, _s); im.setMatrixAt(n, _m); im.setColorAt(n, tmpC.setRGB(list.c[0], list.c[1], list.c[2])); counts[list.k] = n + 1;
      }
      for (const [key, im] of Object.entries(r.objs)) { im.count = counts[key] || 0; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      if (r.cache.size > 60000) r.cache.clear(); // límite de memoria: se vuelve a describir lo que se necesite
    }
  };
  api.waveH = (p, t) => { let h = 0; for (const c of WV) h += c.A * Math.sin(c.k[0] * p[0] + c.k[1] * p[1] + c.k[2] * p[2] + c.w * t); return h; }; // altura del oleaje (km) en un punto de la superficie (relativo al centro)
  api.water = (b, d) => { const cfg = SURF[b.n]; if (!cfg) return false; sample(cfg, d[0], d[1], d[2], o); return o.water >= 0; };
  api.pick = (b, P, aim, reach) => { // recurso más cercano a la línea de mira dentro del alcance (solo celdas vecinas a la posición del jugador)
    if (st.body !== b) return null; const cfg = SURF[b.n], R = b.R; let best = null, bestD = Infinity;
    const rel = [P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]], l = Math.hypot(rel[0], rel[1], rel[2]), lat = Math.asin(rel[1] / l), lon = Math.atan2(rel[2], rel[0]);
    for (const r of rings) {
      if (r.k > 1 || !r.built) continue; const dlc = CELL[r.k] / R, j0 = Math.floor(lat / dlc), sp = Math.min(3, Math.ceil(reach / CELL[r.k])); // celdas vecinas hasta el alcance de la herramienta
      for (let dj = -sp; dj <= sp; dj++) {
        const j = j0 + dj, cl = Math.cos((j + 0.5) * dlc), dlonc = dlc / cl, i0 = Math.floor(lon / dlonc);
        for (let di = -sp; di <= sp; di++) {
          const i = i0 + di, key = j * 4194304 + i; if (r.keys && !r.keys.has(key)) continue; let d = r.cache.get(key);
          if (d === undefined) { d = describe(r, b, cfg, j, i); if (d === undefined) continue; r.cache.set(key, d); }
          if (d === EMPTY) continue;
          const pl = Math.hypot(d.p[0], d.p[1], d.p[2]), ux = d.p[0] / pl, uy = d.p[1] / pl, uz = d.p[2] / pl, h = d.s * 0.4;
          const ox = b.pos[0] + d.p[0] + ux * h - P[0], oy = b.pos[1] + d.p[1] + uy * h - P[1], oz = b.pos[2] + d.p[2] + uz * h - P[2], dist = Math.hypot(ox, oy, oz);
          if (dist > reach + d.s * 0.6) continue;
          const along = ox * aim.x + oy * aim.y + oz * aim.z; if (along < -d.s) continue;
          const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
          if (perp < d.s * 0.7 + 0.003 && dist < bestD) { bestD = dist; best = { d, r, key, pos: [b.pos[0] + d.p[0], b.pos[1] + d.p[1], b.pos[2] + d.p[2]], dist }; }
        }
      }
    }
    return best;
  };
  api.spawnNear = (b, P, avoid) => { // hace aparecer UN recurso al azar cerca de P si el entorno no está ya cargado de recursos (nunca agrupados)
    if (st.body !== b) return null; const r = rings[0]; if (!r.built || !r.keys) return null;
    const cfg = SURF[b.n], R = b.R, bi = bodies.indexOf(b), rel = [P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]], l = Math.hypot(rel[0], rel[1], rel[2]), lat = Math.asin(rel[1] / l), lon = Math.atan2(rel[2], rel[0]), dlc = CELL[0] / R, j0 = Math.floor(lat / dlc);
    const cand = [], taken = []; let dens = 0;
    for (let dj = -3; dj <= 3; dj++) {
      const j = j0 + dj, cl = Math.cos((j + 0.5) * dlc), dlonc = dlc / cl, i0 = Math.floor(lon / dlonc);
      for (let di = -3; di <= 3; di++) {
        const i = i0 + di, key = j * 4194304 + i; if (!r.keys.has(key)) continue; let d = r.cache.get(key);
        if (d === undefined) { d = describe(r, b, cfg, j, i); if (d === undefined) continue; r.cache.set(key, d); }
        if (d === EMPTY) cand.push({ j, i, key }); else { dens++; taken.push(d.p); }
      }
    }
    if (dens > 9 || !cand.length) return null; // ya hay demasiados recursos alrededor
    for (let n = cand.length - 1; n > 0; n--) { const m = (Math.random() * (n + 1)) | 0; [cand[n], cand[m]] = [cand[m], cand[n]]; }
    for (const c of cand.slice(0, 10)) {
      let obj = EMPTY; for (let t = 0; t < 4 && obj === EMPTY; t++) obj = describe(r, b, cfg, c.j, c.i, Math.pow(Math.random(), 2) * 0.4); if (!obj) continue;
      const dx = obj.p[0] + b.pos[0] - P[0], dy = obj.p[1] + b.pos[1] - P[1], dz = obj.p[2] + b.pos[2] - P[2], dist = Math.hypot(dx, dy, dz);
      if (dist < 0.03 || dist > 0.16) continue; if (avoid && (dx * avoid.x + dy * avoid.y + dz * avoid.z) / dist > 0.35) continue; // no aparece delante de tus ojos
      if (taken.some(p => Math.hypot(p[0] - obj.p[0], p[1] - obj.p[1], p[2] - obj.p[2]) < 0.045)) continue; // separados: nada de racimos
      SPAWNED.set(bi + ':0:' + c.j + ':' + c.i, obj); r.cache.set(c.key, obj); return obj;
    }
    return null;
  };
  api.loadProgress = P => { // ¿cuánto terreno y objetos hay ya listos alrededor de P? (anillos construidos y celdas de ~350 m descritas)
    const b = st.body; if (!b) return { rings: 0, cells: 0 }; let got = 0; for (const r of rings) if (r.built) got++;
    const r0 = rings[0]; let tot = 0, done = 0;
    if (r0.built && r0.cells) { const C = r0.cells, ax = b.pos[0] + r0.aRel.x - P[0], ay = b.pos[1] + r0.aRel.y - P[1], az = b.pos[2] + r0.aRel.z - P[2];
      for (let c = 0; c < C.n; c++) { const x = ax + C.pos[c * 3], y = ay + C.pos[c * 3 + 1], z = az + C.pos[c * 3 + 2]; if (x * x + y * y + z * z > 0.1225) continue; tot++; if (r0.cache.get(C.jr[c] * 4194304 + C.ir[c]) !== undefined) done++; } }
    return { rings: got / rings.length, cells: tot ? done / tot : (r0.built ? 1 : 0) };
  };
  api.warm = (P, ms) => { // describe por adelantado (sin esperar a verlas) los objetos a menos de 350 m: así el contenido de la base ya está cargado al empezar
    const b = st.body, r0 = rings[0]; if (!b || !r0.built || !r0.cells) return; const cfg = SURF[b.n], C = r0.cells, t0 = performance.now(), ax = b.pos[0] + r0.aRel.x - P[0], ay = b.pos[1] + r0.aRel.y - P[1], az = b.pos[2] + r0.aRel.z - P[2];
    for (let c = 0; c < C.n; c++) { const x = ax + C.pos[c * 3], y = ay + C.pos[c * 3 + 1], z = az + C.pos[c * 3 + 2]; if (x * x + y * y + z * z > 0.1225) continue; const key = C.jr[c] * 4194304 + C.ir[c]; if (r0.cache.get(key) !== undefined) continue; const d = describe(r0, b, cfg, C.jr[c], C.ir[c]); if (d !== undefined) r0.cache.set(key, d); if (performance.now() - t0 > ms) break; }
  };
  api.wobble = (pk, amp = 1) => WOB.set(pk.r.k + ':' + pk.key, { last: performance.now(), amp }); // el objeto tiembla mientras recibe el rayo
  // niebla a lo lejos (no desde el cielo): oculta lo que el terreno detallado aún no ha cargado
  api.fogDensity = P => {
    const b = st.body; if (!b || !ready) return 0; const rx = P[0] - b.pos[0], ry = P[1] - b.pos[1], rz = P[2] - b.pos[2], alt = Math.hypot(rx, ry, rz) - b.R, w = sstep(30, 8, alt); if (w <= 0) return 0;
    let V = 0.3; for (const k of [1, 0]) { const r = rings[k]; if (r.built && r.grp.visible) { V = Math.max(V, r.H * 0.9 - Math.hypot(rx - r.aRel.x, ry - r.aRel.y, rz - r.aRel.z)); break; } }
    return Math.min(8, 1.7 / Math.max(V, 0.2)) * w;
  };
  api.ghost = pk => ({ geo: pk.r.objs[pk.d.k].geometry, mat: pk.r.objs[pk.d.k].material, q: pk.d.q, sy: pk.d.sy, c: pk.d.c }); // datos para animar la destrucción del objeto extraído
  api.body = () => (ready ? st.body : null); // mundo con terreno activo
  api.impact = (o, n) => { // ¿el tramo o→n de un proyectil cruzó el suelo del mundo activo? bisección sobre el tramo: devuelve el punto real de impacto
    const b = st.body; if (!b || !ready) return null;
    const at = t => { const d = [o[0] + (n[0] - o[0]) * t - b.pos[0], o[1] + (n[1] - o[1]) * t - b.pos[1], o[2] + (n[2] - o[2]) * t - b.pos[2]], l = Math.hypot(d[0], d[1], d[2]); return { d, l, gap: l - api.surfaceR(b, d, l) }; };
    const a1 = at(1); if (a1.gap >= 0 || Math.hypot(o[0] - b.pos[0], o[1] - b.pos[1], o[2] - b.pos[2]) - b.R > 200 && a1.l - b.R > 200) return null;
    let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (at(m).gap < 0) hi = m; else lo = m; }
    const h = at(hi), k = (h.l - h.gap) / h.l; return [b.pos[0] + h.d[0] * k, b.pos[1] + h.d[1] * k, b.pos[2] + h.d[2] * k];
  };
  api.near = (b, P, radius) => { // objetos (árboles, rocas, minerales) a menos de 'radius' km de un punto: para el daño de área
    const out = []; if (st.body !== b) return out; const cfg = SURF[b.n], R = b.R, rel = [P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]], l = Math.hypot(rel[0], rel[1], rel[2]), lat = Math.asin(rel[1] / l), lon = Math.atan2(rel[2], rel[0]);
    for (const r of rings) {
      if (r.k > 1 || !r.built) continue; const dlc = CELL[r.k] / R, span = Math.ceil(radius / CELL[r.k]) + 1, j0 = Math.floor(lat / dlc);
      for (let dj = -span; dj <= span; dj++) {
        const j = j0 + dj, cl = Math.cos((j + 0.5) * dlc), dlonc = dlc / cl, i0 = Math.floor(lon / dlonc);
        for (let di = -span; di <= span; di++) {
          const i = i0 + di, key = j * 4194304 + i; if (r.keys && !r.keys.has(key)) continue; let d = r.cache.get(key);
          if (d === undefined) { d = describe(r, b, cfg, j, i); if (d === undefined) continue; r.cache.set(key, d); }
          if (d === EMPTY) continue;
          const pos = [b.pos[0] + d.p[0], b.pos[1] + d.p[1], b.pos[2] + d.p[2]], dist = Math.hypot(pos[0] - P[0], pos[1] - P[1], pos[2] - P[2]);
          if (dist < radius + d.s) out.push({ d, r, key, pos, dist });
        }
      }
    }
    return out;
  };
  api.take = pk => { pk.r.cache.set(pk.key, EMPTY); SPAWNED.delete(bodies.indexOf(st.body) + ':' + pk.r.k + ':' + Math.round(pk.key / 4194304) + ':' + (pk.key - Math.round(pk.key / 4194304) * 4194304)); TAKEN.add(bodies.indexOf(st.body) + ':' + pk.r.k + ':' + Math.round(pk.key / 4194304) + ':' + (pk.key - Math.round(pk.key / 4194304) * 4194304)); }; // recurso extraído: desaparece (se regenera si se descarta la caché)
  api.cover = P => { const b = st.body; if (!b) return null; const v = new THREE.Vector3(P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]).normalize(); return rings.map(r => r.built ? +(Math.acos(Math.min(1, v.dot(r.center))) * b.R / r.H).toFixed(2) : null); }; // depuración: distancia al centro de cada anillo / su radio (>0,95 = fuera de cobertura)
  api.dbg = () => rings.map(r => r.objs && Object.fromEntries(Object.entries(r.objs).map(([k, im]) => [k, im.count]))); // depuración: instancias visibles por tipo
  return api;
}
