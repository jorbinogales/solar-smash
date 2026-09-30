// Naves modulares: 4 chasis + 5 mejoras. Cada mejora cambia el modelo 3D (cañones, pilones con misiles, escudo frontal, placas, toberas).
const PI = Math.PI;
const glow = (c, op = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
const bolt = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(PI / 2), ball = new THREE.SphereGeometry(1, 16, 10);
const rndOf = seed => { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

const TYPES = {
  // estadísticas del chasis un 30 % por debajo de las originales (casco, escudo, plasma, misiles redondeados, maniobra, velocidad y barra luz); ver también CH_DMG y CH_REGEN
  saeta:  { name: 'Saeta',  role: 'Interceptor', hp: 49,  sh: 42, plasma: 112, missiles: 1, slots: 3, size: 0.9, agil: 0.91, speed: 910, warp: 32, desc: 'Fuselaje de aguja, canards y cola en V. Ligera y frágil.' },
  halcon: { name: 'Halcón', role: 'Caza',        hp: 70,  sh: 56, plasma: 140, missiles: 1, slots: 4, size: 1.0, agil: 0.7, speed: 770, warp: 42, desc: 'Alas en delta y doble motor. Equilibrado en todo.' },
  coloso: { name: 'Coloso', role: 'Cañonera',    hp: 112, sh: 70, plasma: 182, missiles: 3, slots: 5, size: 1.3, agil: 0.46, speed: 525, warp: 63, desc: 'Casco grueso, torreta dorsal y triple motor.' },
  nomada: { name: 'Nómada', role: 'Explorador',  hp: 56,  sh: 84, plasma: 84,  missiles: 1, slots: 4, size: 1.1, agil: 0.6, speed: 665, warp: 84, desc: 'Plato sensor, cúpula panorámica y paneles solares.' },
  // chasis nuevos (mismo orden que SHIPS en server.js; los cuatro de arriba siguen siendo los primeros: neutrales y cascos a la deriva usan solo esos) · dm: multiplicador del daño base de plasma · cam: distancia extra de la cámara del hangar para las naves grandes
  centinela: { name: 'Centinela', role: 'Blindada',  hp: 154, sh: 112, plasma: 126, missiles: 2, slots: 5, size: 1.35, agil: 0.34, speed: 420, warp: 50, dm: 0.9, cam: 1.1, desc: 'Placas cerámicas y cuernos emisores de escudo. Lenta y casi indestructible.' },
  fantasma:  { name: 'Fantasma',  role: 'Sigilo',    hp: 30,  sh: 28,  plasma: 70,  missiles: 1, slots: 3, size: 0.8,  agil: 0.98, speed: 1040, warp: 70, dm: 1, desc: 'Ala volante facetada de baja firma. La más veloz y la más frágil.' },
  corsario:  { name: 'Corsario',  role: 'Asalto',    hp: 60,  sh: 46,  plasma: 154, missiles: 4, slots: 4, size: 1.05, agil: 0.62, speed: 830, warp: 46, dm: 1.3, desc: 'Alas en flecha adelantada y pilones cargados. Golpea fuerte y rápido.' },
  titan:     { name: 'Titán',     role: 'Acorazado', hp: 132, sh: 66,  plasma: 300, missiles: 3, slots: 5, size: 1.4, agil: 0.3,  speed: 380, warp: 74, dm: 1.15, cam: 1.2, desc: 'Cañones dobles, cargadores de munición y motores gigantes.' },
};
const CH_DMG = 5.6, CH_REGEN = 2.0, LV_K = 0.02; // chasis −30 %: daño de plasma base 8 → 5,6 y recarga 1 unidad cada 1,4 s → cada 2 s · LV_K: cada punto de nivel = +2 % del valor base del chasis
const ADDONS = [
  { id: 'armor',    name: 'Blindaje', max: 2, desc: '+30 casco · placas de armadura sobre el fuselaje' },
  { id: 'shield',   name: 'Escudo',   max: 2, desc: '+40 escudo · campo resplandeciente al frente' },
  { id: 'plasma',   name: 'Daño',     max: 2, desc: '+2 daño de plasma · cañones en las alas' },
  { id: 'missiles', name: 'Misiles',  max: 3, desc: '+2 misiles · pilones con los misiles a la vista' },
  { id: 'engine',   name: 'Velocidad', max: 2, desc: '+10% velocidad, +50% barra de velocidad luz · toberas mayores' },
  { id: 'ammo',     name: 'Munición', max: 3, desc: '+60 plasma y +1 misil de capacidad máxima' },
];
const ACCENTS = [0x4db8ff, 0xff6a3c, 0x5dff8a, 0xffd23f, 0xd06bff, 0xf2f2f2];
// Skins (solo aspecto): tinte del casco, factor del vientre, acento (undefined = el color c de la nave), color del blindaje, metal/rugosidad del casco y patrón de franjas pintadas (pat / pc: color de la pintura).
// Se aplican con colores por material sobre la textura de casco compartida: cero texturas nuevas. spec.sk = índice 0-5.
const SKINS = [
  { name: 'Militar',         hull: 0xaeb8c3, bel: 0.58, ar: 0x59616b, m: 0.3,  r: 0.52 },
  { name: 'Desierto',        hull: 0xc7a56a, bel: 0.62, acc: 0x7a4a1f, ar: 0x7d6a45, m: 0.2,  r: 0.64, pat: 'bands',   pc: 0x5b4527 },
  { name: 'Ártico',          hull: 0xdbe6ee, bel: 0.72, acc: 0xff7a1a, ar: 0x8fa1b3, m: 0.25, r: 0.5,  pat: 'tips',    pc: 0xff7a1a },
  { name: 'Carbono',         hull: 0x30343b, bel: 0.55, acc: 0x22d3ee, ar: 0x1c1f24, m: 0.65, r: 0.34, pat: 'stripe',  pc: 0x22d3ee },
  { name: 'Rojo de combate', hull: 0xb5261d, bel: 0.5,  acc: 0xf4f4f4, ar: 0x3b3f45, m: 0.35, r: 0.42, pat: 'stripe',  pc: 0xf4f4f4 },
  { name: 'Dorado',          hull: 0xd6a92e, bel: 0.6,  acc: 0xfff0b8, ar: 0x9c7a1c, m: 0.85, r: 0.28, pat: 'chevron', pc: 0xfff0b8 },
];
const skinOf = v => Math.max(0, Math.min(SKINS.length - 1, Math.round(Number(v)) || 0));

function validSpec(s) {
  const t = TYPES[s && s.t] ? s.t : 'halcon', T = TYPES[t];
  const a = ADDONS.map((d, i) => Math.max(0, Math.min(d.max, Math.round(Number(s && s.a && s.a[i]) || 0))));
  return { t, a, c: Number.isFinite(s && s.c) ? (s.c >>> 0) & 0xffffff : 0x4db8ff, sk: skinOf(s && s.sk) };
}
function statsOf(spec, lvA) { // lvA: puntos de nivel asignados a cada característica de LV_STATS (cada punto = +2 % del valor BASE del chasis)
  const T = TYPES[spec.t], [ar, sh, pl, mi, en, am = 0] = spec.a, [bv = 0, bh = 0, bs = 0, bd = 0, ba = 0, br = 0, bp = 0, bw = 0] = lvA || [];
  return { sk: skinOf(spec.sk), hp: T.hp + 30 * ar + Math.round(T.hp * LV_K * bh), sh: T.sh + 40 * sh + Math.round(T.sh * LV_K * bs), plasma: T.plasma + 60 * am + Math.round(T.plasma * LV_K * bp), pdmg: Math.round((CH_DMG * (T.dm || 1) * (1 + LV_K * bd) + 2 * pl) * 10) / 10, missiles: T.missiles + 2 * mi + am, flameMul: 1 + 0.3 * en, pitch: 1 - 0.1 * en, agil: Math.round(T.agil * (1 + LV_K * ba) * 100) / 100, vmax: Math.min(1500, Math.round(T.speed * (1 + 0.1 * en))) + Math.round(T.speed * LV_K * bv), warp: Math.round(T.warp * (1 + 0.5 * en)) + Math.round(T.warp * LV_K * bw), regen: CH_REGEN / (1 + LV_K * br) }; // regen: segundos por unidad de plasma recargada
}
// ---------- niveles por nave: cada chasis tiene su propio nivel (0-20) y experiencia, independientes ----------
// XP para pasar del nivel n-1 al n: need(n) = 10 + 15(n-1) + 5(n-1)(n-2)/2 → 10, 25, 45, 70, 100, 135… (la barra muestra la XP dentro del nivel actual)
// Cada nivel da 1 punto de mejora; cada punto suma +2 % del valor base del chasis en la característica elegida (se pueden poner los 20 puntos en la misma).
const LV_MAX = 20, LV_PTMAX = LV_MAX;
const LV_STATS = [{ id: 'vel', name: 'Velocidad' }, { id: 'hp', name: 'Casco' }, { id: 'sh', name: 'Escudo' }, { id: 'dmg', name: 'Daño' }, { id: 'agil', name: 'Maniobra' }, { id: 'rec', name: 'Recarga' }, { id: 'plasma', name: 'Munición' }, { id: 'warp', name: 'Barra luz' }]; // el orden es el de los puntos guardados (no cambiar)
const lvNeed = n => 10 + 15 * (n - 1) + 5 * (n - 1) * (n - 2) / 2;
const LVL = (() => { try { return JSON.parse(localStorage.getItem('shipLv')) || {}; } catch { return {}; } })(); // { tipo: { lv, xp, a: [6 puntos asignados] } } durante la partida
function lvlOf(t) { const o = LVL[t] || (LVL[t] = {}); o.lv = Math.max(0, Math.min(LV_MAX, o.lv | 0)); o.xp = Math.max(0, o.xp | 0); o.a = LV_STATS.map((_, i) => Math.max(0, Math.min(LV_PTMAX, (o.a && o.a[i]) | 0))); return o; }
const lvPts = L => L.lv - L.a.reduce((x, y) => x + y, 0); // puntos sin gastar
function saveLv() { try { localStorage.setItem('shipLv', JSON.stringify(LVL)); } catch {} }
function resetLv() { for (const k of Object.keys(LVL)) delete LVL[k]; saveLv(); } // partida nueva: todas las naves a nivel 0
// indicador hexagonal de nivel (estilo pegatina: borde grueso y sombra sólida)
const hexSvg = (n, fill = '#ffd23f', s = 40) => `<svg width="${s}" height="${Math.round(s * 1.08)}" viewBox="0 0 43 46" aria-label="Nivel ${n}"><polygon points="20,5 36,14 36,32 20,41 4,32 4,14" transform="translate(3,3)" fill="#050f1c"/><polygon points="20,3 36,12 36,30 20,39 4,30 4,12" fill="${fill}" stroke="#050f1c" stroke-width="3.5" stroke-linejoin="round"/><text x="20" y="16" text-anchor="middle" font-family="ui-monospace,Consolas,monospace" font-weight="900" font-size="7" fill="#050f1c">NV</text><text x="20" y="30" text-anchor="middle" font-family="ui-monospace,Consolas,monospace" font-weight="900" font-size="${n > 9 ? 13 : 15}" fill="#050f1c">${n}</text></svg>`;
// Mejoras de la nave básica: se compran con los recursos del planeta (agua, piedra, cobre, plata, oro, diamante). Coste del nivel lv+1 de la mejora i.
const UPGRADE_COST = [n => ({ piedra: 6 * n, agua: 4 * n }), n => ({ cobre: 4 * n, piedra: 3 * n }), n => ({ plata: 3 * n, cobre: 3 * n }), n => ({ oro: 2 * n, plata: 2 * n }), n => ({ diamante: n, oro: 2 * n }), n => ({ plata: 2 * n, madera: 3 * n })];
const SHIP_COST = { halcon: null, saeta: { piedra: 12, cobre: 6 }, coloso: { plata: 12, oro: 6 }, nomada: { oro: 8, diamante: 3 }, centinela: { piedra: 30, cobre: 14, plata: 6 }, corsario: { cobre: 18, plata: 12, oro: 5 }, fantasma: { plata: 16, oro: 8, diamante: 4 }, titan: { plata: 24, oro: 14, diamante: 6, cobre: 20 } }; // cambiar de nave: se desbloquea una vez con recursos
const upgradeCost = (i, lv) => UPGRADE_COST[i](lv + 1);
const basicSpec = (c, sk) => ({ t: 'halcon', a: [0, 0, 0, 0, 0, 0], c: Number.isFinite(c) ? c : 0x4db8ff, sk: skinOf(sk) }); // todos empiezan con una nave básica
function loadSpec() { try { return validSpec(JSON.parse(localStorage.getItem('spec'))); } catch { return validSpec(null); } }
function saveSpec(s) { try { localStorage.setItem('spec', JSON.stringify(validSpec(s))); } catch {} }

// ---------- utilidades compartidas con base.js (kit de piezas fusionadas por material) ----------
const stdMat = (c, ei = 0.3, m = 0.2, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r, emissive: c, emissiveIntensity: ei, side: THREE.DoubleSide }); // emisivo = visible en la sombra
const M = (g, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); return m; };
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylZ = (rt, rb, len, seg = 12) => new THREE.CylinderGeometry(rt, rb, len, seg).rotateX(PI / 2); // rt = radio trasero (+z)
const ball3 = r => new THREE.SphereGeometry(r, 8, 6);
const nav = c => new THREE.MeshBasicMaterial({ color: c });
// Fusión de geometrías: cada nave acumula sus piezas por material y las une en UN mesh por material (unos 8 meshes por casco en vez de cientos).
const FLIPX = new THREE.Matrix4().makeScale(-1, 1, 1);
function mergeGeos(list, tile = 0) { // list: [[geometría, matriz]]; los espejos invierten el orden de los triángulos para conservar las caras · tile > 0: añade UVs por eje dominante (1 vuelta de textura = tile km)
  const parts = list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); x.applyMatrix4(m); return [x, m.determinant() < 0]; });
  let n = 0; for (const [x] of parts) n += x.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = tile > 0 ? new Float32Array(n * 2) : null; let o = 0;
  for (const [x, fl] of parts) {
    const pa = x.attributes.position.array, na = x.attributes.normal.array; P.set(pa, o * 3); N.set(na, o * 3);
    if (fl) for (let t = 0; t < pa.length / 9; t++) { const b = o * 3 + t * 9; for (let k = 0; k < 3; k++) { let a = P[b + 3 + k]; P[b + 3 + k] = P[b + 6 + k]; P[b + 6 + k] = a; a = N[b + 3 + k]; N[b + 3 + k] = N[b + 6 + k]; N[b + 6 + k] = a; } }
    if (U) for (let t = 0; t < pa.length / 9; t++) { // proyección por el eje dominante de la cara (paneles alineados al modelo)
      const b = o * 3 + t * 9, bu = (o + t * 3) * 2, ax = Math.abs(N[b] + N[b + 3] + N[b + 6]), ay = Math.abs(N[b + 1] + N[b + 4] + N[b + 7]), az = Math.abs(N[b + 2] + N[b + 5] + N[b + 8]);
      for (let k = 0; k < 3; k++) { const px = P[b + k * 3], py = P[b + k * 3 + 1], pz = P[b + k * 3 + 2], X = fl ? -px : px; if (ax >= ay && ax >= az) { U[bu + k * 2] = pz / tile; U[bu + k * 2 + 1] = py / tile; } else if (ay >= az) { U[bu + k * 2] = X / tile; U[bu + k * 2 + 1] = pz / tile; } else { U[bu + k * 2] = X / tile; U[bu + k * 2 + 1] = py / tile; } }
    }
    o += x.attributes.position.count; x.dispose();
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); if (U) out.setAttribute('uv', new THREE.BufferAttribute(U, 2)); return out;
}
function kit(tile = 0) { // add(mat, geo, pos, rot, scale) · mir(...) añade también la copia espejada en x
  const map = new Map(), put = (mat, g, p, r, s, f) => { const m4 = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)); if (f) m4.premultiply(FLIPX); if (!map.has(mat)) map.set(mat, []); map.get(mat).push([g, m4]); };
  return {
    add: (mat, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => put(mat, g, p, r, s, false),
    mir: (mat, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { put(mat, g, p, r, s, false); put(mat, g, p, r, s, true); },
    parts: () => [...map].map(([mat, list]) => [mat, mergeGeos(list, tile && (mat.map || mat.emissiveMap) ? tile : 0)]),
    build(parent) { for (const [mat, geo] of this.parts()) parent.add(new THREE.Mesh(geo, mat)); },
  };
}

// ============ Motor gráfico de las naves ============
// Cada chasis se construye UNA vez por (tipo + mejoras) y se guarda en caché: piezas fusionadas por "rol" de material, con UVs proyectadas
// (paneles alineados a los ejes de la nave). Los materiales y las 4 texturas procedurales (casco 256², metal 128², cristal 128², paneles solares 64×128)
// son compartidos por todas las naves; solo las llamas, el interior de las toberas y los estroboscopios son propios de cada nave.
const SHIPGFX = (() => {
  const TILE = 0.02, UV_R = 0.005 / TILE; // 1 vuelta de textura = 20 m; radio de referencia para el mapeado cilíndrico del fuselaje

  // ---------- texturas procedurales ----------
  const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const mkTex = (c, rep = true) => { const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const grain = (g, S, amp) => { const im = g.getImageData(0, 0, S, S), d = im.data, R = rndOf(31337); for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(im, 0, 0); };

  function hullCanvas() { // placas de casco: paneles irregulares con juntas biseladas, remaches, escotillas, rejillas, rótulos y desgaste
    const S = 256, c = cvs(S, S), g = c.getContext('2d'), R = rndOf(20240611), rr = (a, b) => a + R() * (b - a);
    const wrap = fn => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, S, S);
    const panels = []; let y = 0;
    for (const h of [66, 58, 78, 54]) {
      const n = 3 + (R() * 2 | 0), ws = Array.from({ length: n }, () => 0.6 + R()), tot = ws.reduce((a, b) => a + b); let x = 0;
      ws.forEach((w, i) => { const pw = i === n - 1 ? S - x : Math.round(w / tot * S); panels.push([x, y, pw, h]); x += pw; }); y += h;
    }
    for (const [x, y, w, h] of panels) { // relleno con matiz propio y degradado de luz
      const v = rr(172, 240) | 0, t = (R() - 0.5) * 8;
      g.fillStyle = `rgb(${v + t | 0},${v},${v - t | 0})`; g.fillRect(x, y, w, h);
      const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    }
    const LABELS = ['SC-07', 'A-113', 'LOX', 'FUEL', 'N2', 'K-4', 'RCS', '07-B', 'HV', 'NO STEP', 'ARM', '4471'];
    for (const [x, y, w, h] of panels) {
      const r = R();
      if (r < 0.2 && w > 52 && h > 44) { // rejilla de ventilación
        const vx = x + w * 0.2, vy = y + h * 0.28, vw = w * 0.6, vh = h * 0.44; g.fillStyle = '#30333a'; g.fillRect(vx, vy, vw, vh);
        g.fillStyle = 'rgba(205,210,218,0.6)'; for (let k = 4; k < vh - 2; k += 5) g.fillRect(vx + 2, vy + k, vw - 4, 1.6);
      } else if (r < 0.36 && w > 48 && h > 40) { // escotilla con asa y tornillos
        const hx = x + w * 0.22, hy = y + h * 0.24, hw = w * 0.56, hh = h * 0.52; g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(hx, hy, hw, hh);
        g.strokeStyle = 'rgba(25,28,34,0.85)'; g.lineWidth = 2; g.strokeRect(hx, hy, hw, hh);
        g.fillStyle = 'rgba(30,33,39,0.85)'; g.fillRect(hx + hw / 2 - 6, hy + hh / 2 - 1.5, 12, 3);
        for (const [bx_, by_] of [[hx + 4, hy + 4], [hx + hw - 4, hy + 4], [hx + 4, hy + hh - 4], [hx + hw - 4, hy + hh - 4]]) { g.beginPath(); g.arc(bx_, by_, 1.4, 0, 7); g.fill(); }
      } else if (r < 0.5 && h > 44 && w > 50) { // franja de precaución
        const cx = x + 8, cy = y + h - 18, cw = Math.min(w - 16, 34), ch = 10;
        g.save(); g.beginPath(); g.rect(cx, cy, cw, ch); g.clip();
        for (let k = -ch; k < cw; k += 8) { g.fillStyle = (k / 8 | 0) % 2 ? '#2c2f35' : '#ececec'; g.beginPath(); g.moveTo(k + cx, cy + ch); g.lineTo(k + cx + 4, cy + ch); g.lineTo(k + cx + 4 + ch, cy); g.lineTo(k + cx + ch, cy); g.fill(); }
        g.restore(); g.strokeStyle = 'rgba(25,28,34,0.7)'; g.lineWidth = 1; g.strokeRect(cx, cy, cw, ch);
      }
      if (R() < 0.4 && w > 40) { g.fillStyle = 'rgba(38,41,47,0.8)'; g.font = 'bold 9px monospace'; g.fillText(LABELS[R() * LABELS.length | 0], x + 7, y + 15); }
      if (R() < 0.65) { g.fillStyle = 'rgba(45,48,54,0.75)'; for (const yy of [y + 7, y + h - 7]) for (let xx = x + 9; xx < x + w - 6; xx += 13) { g.beginPath(); g.arc(xx, yy, 1.3, 0, 7); g.fill(); } } // remaches
    }
    wrap(() => { // juntas: surco oscuro y borde biselado
      for (const [x, y, w, h] of panels) { g.strokeStyle = 'rgba(22,25,31,0.92)'; g.lineWidth = 3; g.strokeRect(x, y, w, h); }
    });
    for (const [x, y, w, h] of panels) {
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.42)'; g.beginPath(); g.moveTo(x + 2.5, y + h - 2.5); g.lineTo(x + 2.5, y + 2.5); g.lineTo(x + w - 2.5, y + 2.5); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.moveTo(x + w - 2.5, y + 2.5); g.lineTo(x + w - 2.5, y + h - 2.5); g.lineTo(x + 2.5, y + h - 2.5); g.stroke();
    }
    // desgaste sutil: churretes de suciedad, quemaduras, arañazos y desconchones en las juntas
    const streaks = Array.from({ length: 44 }, () => ({ x: R() * S, y: R() * S, w: 1 + R() * 4, l: 20 + R() * 60, a: 0.05 + R() * 0.09 }));
    const smudges = Array.from({ length: 10 }, () => ({ x: R() * S, y: R() * S, r: 12 + R() * 18, a: 0.08 + R() * 0.1 }));
    const scr = Array.from({ length: 70 }, () => ({ x: R() * S, y: R() * S, a: R() * 6.28, l: 4 + R() * 14, light: R() < 0.6 }));
    const chips = Array.from({ length: 50 }, () => { const [x, y, w] = panels[R() * panels.length | 0]; return { x: x + R() * w, y, w: 2 + R() * 3 }; });
    wrap(() => {
      for (const s of streaks) { const gr = g.createLinearGradient(0, s.y, 0, s.y + s.l); gr.addColorStop(0, `rgba(10,10,14,${s.a})`); gr.addColorStop(1, 'rgba(10,10,14,0)'); g.fillStyle = gr; g.fillRect(s.x, s.y, s.w, s.l); }
      for (const s of smudges) { const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r); gr.addColorStop(0, `rgba(8,8,10,${s.a})`); gr.addColorStop(1, 'rgba(8,8,10,0)'); g.fillStyle = gr; g.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2); }
      g.lineWidth = 0.8; for (const s of scr) { g.strokeStyle = s.light ? 'rgba(255,255,255,0.28)' : 'rgba(10,10,14,0.22)'; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + Math.cos(s.a) * s.l, s.y + Math.sin(s.a) * s.l); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.5)'; for (const s of chips) g.fillRect(s.x, s.y + 1.5, s.w, 1.4);
    });
    grain(g, S, 14); return c;
  }
  function metalCanvas() { // chapa metálica cepillada con nervaduras y tornillería
    const S = 128, c = cvs(S, S), g = c.getContext('2d'), R = rndOf(99);
    g.fillStyle = '#a4a4a4'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 300; i++) { const x = R() * S, y = R() * S, l = 10 + R() * 50; g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'; g.fillRect(x, y, l, 1); g.fillRect(x - S, y, l, 1); }
    for (let x = 0; x < S; x += 32) { g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(x, 0, 2, S); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 2, 0, 1, S); }
    for (let y = 0; y < S; y += 64) { g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(0, y, S, 2); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, y + 2, S, 1); }
    for (let x = 16; x < S; x += 32) for (let y = 16; y < S; y += 64) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(x - 0.7, y - 0.7, 1, 0, 7); g.fill(); }
    grain(g, S, 12); return c;
  }
  function glassCanvas() { // cristal de cabina: cielo arriba, interior oscuro abajo y destellos en diagonal
    const S = 128, c = cvs(S, S), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, '#f2fbff'); gr.addColorStop(0.16, '#a6dcf5'); gr.addColorStop(0.36, '#3a8db5'); gr.addColorStop(0.5, '#0d3348'); gr.addColorStop(1, '#04121b'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.5)'; for (const [x, w] of [[14, 12], [52, 5], [90, 16]]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w - 26, S * 0.5); g.lineTo(x - 26, S * 0.5); g.fill(); }
    g.fillStyle = 'rgba(120,200,255,0.18)'; g.fillRect(0, S * 0.38, S, 3); return c;
  }
  function pvCanvas() { // paneles solares: células de silicio con barras colectoras
    const W = 64, H = 128, c = cvs(W, H), g = c.getContext('2d'); g.fillStyle = '#c3cfe0'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      const x = i * 32 + 2, y = j * 32 + 2, gr = g.createLinearGradient(x, y, x + 28, y + 28); gr.addColorStop(0, '#2a57b0'); gr.addColorStop(1, '#122f6a'); g.fillStyle = gr; g.fillRect(x, y, 28, 28);
      g.strokeStyle = 'rgba(190,210,245,0.55)'; g.lineWidth = 1; for (const k of [9, 19]) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k, y + 28); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14, y); g.lineTo(x, y + 14); g.fill();
    }
    grain(g, 128, 8); return c;
  }
  function envCanvas() { // entorno 128×64 (una sola vez): espacio oscuro, halo de planeta y un lóbulo de sol suave; da reflejos al metal sin envMap pesado
    const W = 128, H = 64, c = cvs(W, H), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#0b1020'); gr.addColorStop(0.42, '#4a6f9c'); gr.addColorStop(0.5, '#8fb0d6'); gr.addColorStop(0.58, '#2a3a55'); gr.addColorStop(1, '#080b12'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (const [x, y, r, col] of [[W * 0.3, H * 0.32, H * 0.34, '255,246,232'], [W * 0.78, H * 0.6, H * 0.4, '120,170,255'], [W * 0.05, H * 0.5, H * 0.3, '200,220,255']]) { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(${col},0.95)`); rg.addColorStop(0.4, `rgba(${col},0.4)`); rg.addColorStop(1, `rgba(${col},0)`); g.fillStyle = rg; g.fillRect(0, 0, W, H); }
    return c;
  }
  function groundCanvas() { // roca y tierra (mosaico continuo): manchas, guijarros con luz y sombra, grietas y grano; se tiñe por material (hormigón, tierra, roca)
    const S = 256, c = cvs(S, S), g = c.getContext('2d'), R = rndOf(4242), rr = (a, b) => a + R() * (b - a);
    g.fillStyle = '#8c887f'; g.fillRect(0, 0, S, S);
    const wr = fn => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };
    const blobs = Array.from({ length: 70 }, () => ({ x: R() * S, y: R() * S, r: rr(14, 46), v: R() < 0.5 ? 0 : 255, a: rr(0.05, 0.13) }));
    wr(() => { for (const b of blobs) { const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r); gr.addColorStop(0, `rgba(${b.v},${b.v},${b.v},${b.a})`); gr.addColorStop(1, `rgba(${b.v},${b.v},${b.v},0)`); g.fillStyle = gr; g.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); } });
    const peb = Array.from({ length: 150 }, () => ({ x: R() * S, y: R() * S, rx: rr(2, 7), ry: rr(1.5, 5), a: R() * 3.14, v: rr(105, 175) | 0 }));
    wr(() => { for (const p of peb) { g.fillStyle = 'rgba(20,18,16,0.32)'; g.beginPath(); g.ellipse(p.x + 1.3, p.y + 1.5, p.rx, p.ry, p.a, 0, 7); g.fill(); g.fillStyle = `rgb(${p.v},${p.v - 4},${p.v - 10})`; g.beginPath(); g.ellipse(p.x, p.y, p.rx, p.ry, p.a, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.ellipse(p.x - p.rx * 0.25, p.y - p.ry * 0.3, p.rx * 0.5, p.ry * 0.4, p.a, 0, 7); g.fill(); } });
    g.lineCap = 'round'; wr(() => { for (let i = 0; i < 9; i++) { let x = R() * S, y = R() * S, a = R() * 6.28; g.strokeStyle = 'rgba(25,22,20,0.5)'; g.lineWidth = rr(0.8, 1.8); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { a += (R() - 0.5) * 1.2; x += Math.cos(a) * rr(8, 18); y += Math.sin(a) * rr(8, 18); g.lineTo(x, y); } g.stroke(); } });
    grain(g, S, 22); return c;
  }
  function winCanvas() { // ventanas de una superestructura: rejilla de celdas con ventanas cálidas encendidas y filas de pasillo iluminadas (mapa emisivo)
    const W = 128, H = 64, c = cvs(W, H), g = c.getContext('2d'), R = rndOf(777); g.fillStyle = '#0a0f17'; g.fillRect(0, 0, W, H);
    const WARM = ['#ffe9b0', '#ffd27a', '#fff6d8', '#bfe6ff'];
    for (let j = 0; j < 8; j++) { const lit = R() < 0.22; for (let i = 0; i < 16; i++) { const x = i * 8 + 1, y = j * 8 + 2, on = lit || R() < 0.42; g.fillStyle = lit ? WARM[0] : on ? WARM[R() * WARM.length | 0] : '#131b27'; g.fillRect(x, y, 6, 4); if (on) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, y, 6, 1); } } }
    return c;
  }
  const TX = {}, tx = k => TX[k] || (TX[k] = k === 'hull' ? mkTex(hullCanvas()) : k === 'metal' ? mkTex(metalCanvas()) : k === 'glass' ? mkTex(glassCanvas(), false) : k === 'pv' ? mkTex(pvCanvas(), false) : k === 'pvr' ? (() => { const t = tx('pv').clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; })() : k === 'ground' ? mkTex(groundCanvas()) : k === 'win' ? mkTex(winCanvas()) : (() => { const t = new THREE.CanvasTexture(envCanvas()); t.mapping = THREE.EquirectangularReflectionMapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t; })());

  // ---------- materiales compartidos (caché por color de casco y de acento) ----------
  const LIGHTS = new THREE.MeshBasicMaterial({ vertexColors: true }), GLW = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const MATS = new Map();
  function getMats(hullC, accC, sk = -1) { // sk >= 0: skin del jugador (tinte, acento, metal/rugosidad y pintura) · sk = -1: casco fijo (naves neutrales, cascos a la deriva)
    const key = hullC + '|' + accC + '|' + sk, hit = MATS.get(key); if (hit) return hit; if (MATS.size > 40) MATS.clear();
    const SK = sk >= 0 ? SKINS[sk] : null, hc = new THREE.Color(hullC).multiplyScalar(1.14), ac = new THREE.Color(SK && SK.acc !== undefined ? SK.acc : accC), HT = tx('hull'), MX = tx('metal'), env = tx('env');
    const std = o => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMap: env, ...o });
    const hull = (c, ei = 0.12) => std({ color: c, map: HT, metalness: SK ? SK.m : 0.3, roughness: SK ? SK.r : 0.52, emissive: c, emissiveIntensity: ei, envMapIntensity: 0.9 });
    const d = new THREE.Color(0x232830), mt = new THREE.Color(0x8b949e), arc = SK ? SK.ar : 0x59616b;
    const out = {
      H: hull(hc), H2: hull(hc.clone().multiplyScalar(SK ? SK.bel : 0.58), 0.1),
      A: std({ color: ac, map: HT, metalness: 0.3, roughness: 0.42, emissive: ac, emissiveIntensity: 0.34, envMapIntensity: 0.7 }),
      D: std({ color: d, map: MX, metalness: 0.65, roughness: 0.55, emissive: d, emissiveIntensity: 0.1, envMapIntensity: 0.6 }),
      MT: std({ color: mt, map: MX, metalness: 0.9, roughness: 0.34, emissive: mt, emissiveIntensity: 0.07, envMapIntensity: 1.0 }),
      AR: std({ color: arc, map: HT, metalness: 0.5, roughness: 0.5, emissive: arc, emissiveIntensity: 0.1, envMapIntensity: 0.8 }),
      G: std({ color: 0xd8f2ff, map: tx('glass'), transparent: true, opacity: 0.8, metalness: 0.55, roughness: 0.07, emissive: 0x0a4560, emissiveIntensity: 0.55, envMapIntensity: 1.7 }),
      PV: std({ color: 0xffffff, map: tx('pv'), metalness: 0.6, roughness: 0.3, emissive: 0x143070, emissiveIntensity: 0.4, envMapIntensity: 1.3 }),
      LIGHTS, GLW,
    };
    if (SK && SK.pat) out.P = std({ color: SK.pc, map: HT, metalness: 0.3, roughness: 0.45, emissive: SK.pc, emissiveIntensity: 0.16, envMapIntensity: 0.7 }); // pintura de franjas (mismo mapa de casco)
    MATS.set(key, out); return out;
  }

  // ---------- fusión de geometría con UVs proyectadas y colores por vértice ----------
  const UV_ROLES = new Set(['H', 'H2', 'A', 'D', 'MT', 'AR', 'G', 'PV', 'P']);
  function merge(list, wantUv, tile = TILE) { // list: [[geo, matriz, color|null, modo uv]]; los espejos invierten el orden de los triángulos
    const parts = list.map(([g, m, col, uvm]) => { const x = g.index ? g.toNonIndexed() : g.clone(); x.applyMatrix4(m); return { x, fl: m.determinant() < 0, col, uvm, cg: !!g.attributes.color }; });
    let n = 0, useC = false; for (const p of parts) { n += p.x.attributes.position.count; if (p.col || p.cg) useC = true; }
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = wantUv ? new Float32Array(n * 2) : null, C = useC ? new Float32Array(n * 3) : null; let o = 0;
    for (const p of parts) {
      const { x, fl } = p, cnt = x.attributes.position.count, pa = x.attributes.position.array, na = x.attributes.normal.array, ua = x.attributes.uv ? x.attributes.uv.array : null, ca = p.cg ? x.attributes.color.array : null;
      P.set(pa, o * 3); N.set(na, o * 3);
      if (U) { if (p.uvm === 'keep' && ua) U.set(ua, o * 2); }
      if (C) { if (ca) C.set(ca, o * 3); else for (let i = 0; i < cnt; i++) { C[(o + i) * 3] = p.col ? p.col.r : 1; C[(o + i) * 3 + 1] = p.col ? p.col.g : 1; C[(o + i) * 3 + 2] = p.col ? p.col.b : 1; } }
      for (let t = 0; t < cnt / 3; t++) {
        const b = (o + t * 3) * 3, bu = (o + t * 3) * 2;
        if (fl) { for (let k = 0; k < 3; k++) { let a = P[b + 3 + k]; P[b + 3 + k] = P[b + 6 + k]; P[b + 6 + k] = a; a = N[b + 3 + k]; N[b + 3 + k] = N[b + 6 + k]; N[b + 6 + k] = a; if (C) { a = C[b + 3 + k]; C[b + 3 + k] = C[b + 6 + k]; C[b + 6 + k] = a; } } if (U && p.uvm === 'keep') for (let k = 0; k < 2; k++) { const a = U[bu + 2 + k]; U[bu + 2 + k] = U[bu + 4 + k]; U[bu + 4 + k] = a; } }
        if (U && p.uvm !== 'keep') { // proyección por eje dominante de la cara (o cilíndrica para el fuselaje): paneles alineados a la nave
          const ax = Math.abs(N[b] + N[b + 3] + N[b + 6]), ay = Math.abs(N[b + 1] + N[b + 4] + N[b + 7]), az = Math.abs(N[b + 2] + N[b + 5] + N[b + 8]);
          for (let k = 0; k < 3; k++) {
            const px = P[b + k * 3], py = P[b + k * 3 + 1], pz = P[b + k * 3 + 2], X = fl ? -px : px; let u, v;
            if (p.uvm === 'cyl') { u = Math.atan2(py, px) * 0.005 / tile; v = pz / tile; }
            else if (ax >= ay && ax >= az) { u = pz / tile; v = py / tile; } else if (ay >= az) { u = X / tile; v = pz / tile; } else { u = X / tile; v = py / tile; }
            U[bu + k * 2] = u; U[bu + k * 2 + 1] = v;
          }
        }
      }
      o += cnt; x.dispose();
    }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); if (U) out.setAttribute('uv', new THREE.BufferAttribute(U, 2)); if (C) out.setAttribute('color', new THREE.BufferAttribute(C, 3)); return out;
  }
  const CL = h => new THREE.Color(h);
  const ROLE_ALIAS = { LR: ['LIGHTS', CL(0xff3030)], LG: ['LIGHTS', CL(0x30ff60)], LW: ['LIGHTS', CL(0xf4fbff)], LY: ['LIGHTS', CL(0xffd23f)], LT: ['LIGHTS', CL(0x66ffd0)], LC: ['LIGHTS', CL(0x9fe8ff)], GL: ['GLW', CL(0x6fb8d6)], EG: ['GLW', CL(0x3a7fb0)] };
  function skit(tile = TILE, extraUv = null) { // tile: km por vuelta de textura · extraUv: roles extra con UV · add(rol, geo, pos, rot, scale) · mir(...) añade también la copia espejada en x · addc(color, ...) piezas de un solo mesh con color por vértice
    const map = new Map(), put = (role, g, p, r, s, f, col) => {
      const al = ROLE_ALIAS[role]; if (al) { role = al[0]; col = al[1]; }
      const m4 = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)); if (f) m4.premultiply(FLIPX);
      if (!map.has(role)) map.set(role, []); map.get(role).push([g, m4, col || null, role === 'G' || role === 'PV' ? 'keep' : g.userData.uvm || 'box']);
    };
    return {
      add: (role, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => put(role, g, p, r, s, false),
      mir: (role, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { put(role, g, p, r, s, false); put(role, g, p, r, s, true); },
      addc: (col, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => put('MSL', g, p, r, s, false, CL(col)),
      addr: (role, col, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => put(role, g, p, r, s, false, CL(col)), // pieza de un rol con color por vértice explícito
      parts: () => [...map].map(([role, list]) => [role, merge(list, UV_ROLES.has(role) || !!(extraUv && extraUv.has(role)), tile)]),
    };
  }

  // ---------- utilidades de modelado: fuselajes, góndolas y cápsulas por secciones (loft), alas con perfil, calcomanías y detalle mecánico ----------
  const LR = 'LR', LG = 'LG', LW = 'LW', LY = 'LY', LT = 'LT', LC = 'LC', GL = 'GL', STW = 'STW', STR = 'STR';
  const X = { H: 'H', H2: 'H2', A: 'A', D: 'D', MT: 'MT', G: 'G', PV: 'PV' };
  const latheG = (pts, sx, sy, seg = 20, p0 = 0, pl = PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, p0, pl).rotateX(PI / 2).scale(sx, sy, 1);
  const latheC = (pts, cols, seg = 18) => { const g = latheG(pts, 1, 1, seg), c = new Float32Array(g.attributes.position.count * 3), n = pts.length; for (let i = 0; i < c.length / 3; i++) { const k = CL(cols[i % n]); c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }; // lathe con un color por punto del perfil (degradado de la tobera)
  const discC = (r, col, seg = 14) => { const g = new THREE.CircleGeometry(r, seg), k = CL(col), c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = k.r; c[i + 1] = k.g; c[i + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const radAt = (P, z) => { for (let i = 1; i < P.length; i++) if (z <= P[i][1]) { const [r0, z0] = P[i - 1], [r1, z1] = P[i]; return r0 + (r1 - r0) * (z1 === z0 ? 0 : (z - z0) / (z1 - z0)); } return P[P.length - 1][0]; };
  const mast = (K, X, x, y, z, h, tilt = 0, tipMat = LR) => { K.add(X.MT, new THREE.CylinderGeometry(0.00009, 0.00014, h, 5), [x, y + h / 2, z], [0, 0, tilt]); K.add(tipMat === LW ? STW : tipMat === LR ? STR : tipMat, ball3(0.00028), [x - Math.sin(tilt) * h / 2, y + h / 2 + Math.cos(tilt) * h / 2 + 0.00005, z]); }; // antena con baliza intermitente en la punta
  const rcs = (K, X, x, y, z, s = 1) => { K.mir(X.A, bx(0.0009 * s, 0.0005 * s, 0.0009 * s), [x, y, z]); K.mir(X.D, bx(0.0005 * s, 0.0003 * s, 0.0005 * s), [x, y + 0.0003 * s, z]); }; // bloque de propulsores de actitud
  const hatch = (K, X, x, y, z, w, d, mir = true) => { const f = mir ? K.mir : K.add; f(X.D, bx(w, 0.00016, d), [x, y, z]); f(X.H2, bx(w * 0.8, 0.00024, d * 0.8), [x, y + 0.00003, z]); f(X.A, bx(w * 0.3, 0.00032, d * 0.1), [x, y + 0.00004, z]); }; // escotilla de mantenimiento con asa
  const radiator = (K, X, x, y, z, w, d, n) => { K.mir(X.MT, bx(w, 0.00018, d), [x, y, z]); for (let i = 0; i < n; i++) K.mir(X.D, bx(w * 0.92, 0.0003, 0.00012), [x, y + 0.00012, z - d / 2 + d * (i + 0.5) / n]); }; // panel radiador con tubos
  const dish = (K, X, x, y, z, r, rot = [0.6, 0, 0]) => { K.add(X.H2, new THREE.SphereGeometry(r, 14, 6, 0, PI * 2, 0, 1.0), [x, y, z], rot); K.add(X.MT, new THREE.CylinderGeometry(r * 0.06, r * 0.06, r * 0.9, 4), [x, y + r * 0.42, z], rot); K.add(LY, ball3(r * 0.12), [x, y + r * 0.9, z]); }; // antena parabólica
  const MSLG = (() => { // misil en miniatura: geometría única para toda la flota, con colores por vértice (cuerpo, ojiva roja, aletas)
    const K = skit(), BODY = 0xe6ebf0, RED = 0xff3b2f, DK = 0x2a2f36;
    K.addc(BODY, cylZ(0.0007, 0.0007, 0.0072, 10), [0, 0, -0.0002]); K.addc(RED, new THREE.ConeGeometry(0.0007, 0.0028, 10).rotateX(-PI / 2), [0, 0, -0.0052]); K.addc(DK, ball3(0.00022), [0, 0, -0.0066]);
    K.addc(RED, cylZ(0.00073, 0.00073, 0.0004, 10), [0, 0, -0.0012]); K.addc(DK, cylZ(0.0005, 0.0004, 0.0007, 8), [0, 0, 0.0038]);
    for (let r = 0; r < 2; r++) { K.addc(BODY, bx(0.0034, 0.00018, 0.0016), [0, 0, 0.0028], [0, 0, r * PI / 2]); K.addc(RED, bx(0.0018, 0.00014, 0.0007), [0, 0, -0.0026], [0, 0, r * PI / 2]); }
    return K.parts()[0][1];
  })();
  let MSLM = null; const mslMat = () => MSLM || (MSLM = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.45, emissive: 0x1a1a1a, envMap: tx('env'), envMapIntensity: 0.7, side: THREE.DoubleSide }));
  const sgnp = (t, n) => Math.sign(t) * Math.pow(Math.abs(t), 2 / n);
  const n7 = s => (s.length > 6 ? s : [...s, 0]);
  const secAt = (S, z) => { for (let i = 1; i < S.length; i++) if (z <= S[i][0] || i === S.length - 1) { const a = n7(S[i - 1]), b = n7(S[i]), k = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0] || 1))); return a.map((v, j) => v + (b[j] - v) * k); } };
  const subS = (S, z0, z1) => [secAt(S, z0), ...S.map(n7).filter(s => s[0] > z0 && s[0] < z1), secAt(S, z1)];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const geoOf = P => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g; }; // sin índice: caras planas
  const ringPts = (sec, seg, half) => { const [z, w, tp, bt, n, yc, xc] = n7(sec), pts = []; for (let i = 0; i <= seg; i++) { const a = half ? -PI + i * PI / seg : PI - i * PI / seg, c = Math.cos(a), s = i === 0 || i === seg ? 0 : Math.sin(a); pts.push([xc + w * sgnp(c, n), yc + (s >= 0 ? tp : bt) * sgnp(s, n), z]); } return pts; }; // anillo de una sección (de izquierda a derecha por el lomo o el vientre)
  function loft(S, seg, half, flat, caps = true) { // S: [z, semiancho, alto sup, alto inf, exponente (2 = elipse, mayor = más cuadrada), y del eje, x del eje] · half 0 = lomo, 1 = vientre · UVs por longitud de arco · caps: tapas planas en proa y popa (volumen cerrado)
    S = S.map(n7);
    const R = S.map(s => ringPts(s, seg, half));
    const arc = R.map(r => { let a = 0; return r.map((p, i) => (i ? (a += Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1])) : 0)); });
    const NA = R.map(r => r.map(() => [0, 0, 0])), T = [];
    for (let k = 0; k < R.length - 1; k++) for (let i = 0; i < seg; i++) {
      const v = [[k, i], [k, i + 1], [k + 1, i + 1], [k + 1, i]];
      for (const t of half ? [[0, 1, 2], [0, 2, 3]] : [[0, 3, 2], [0, 2, 1]]) { const q = t.map(j => v[j]), [a, b, c] = q.map(([kk, ii]) => R[kk][ii]), f = cross3(sub3(b, a), sub3(c, a)); T.push({ q, f }); for (const [kk, ii] of q) { const w = NA[kk][ii]; w[0] += f[0]; w[1] += f[1]; w[2] += f[2]; } }
    }
    const P = [], N = [], U = [], nz = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    for (const { q, f } of T) for (const [kk, ii] of q) { P.push(...R[kk][ii]); N.push(...nz(flat ? f : NA[kk][ii])); U.push(arc[kk][ii] / TILE, R[kk][ii][2] / TILE); }
    if (caps) for (const [k, sg] of [[0, -1], [R.length - 1, 1]]) { // tapas: abanico desde el eje hasta el anillo (mitad superior o inferior)
      const c = [S[k][6], S[k][5], S[k][0]], r = R[k], rev = (half === 0) === (sg > 0);
      for (let i = 0; i < seg; i++) for (const p of rev ? [c, r[i + 1], r[i]] : [c, r[i], r[i + 1]]) { P.push(...p); N.push(0, 0, sg); U.push(p[0] / TILE, p[1] / TILE); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.userData.uvm = 'keep'; g.userData.kind = 'loft'; return g;
  }
  const annulus = (o, i, seg, half, front) => { // pared anular entre el anillo exterior o y el interior i (cierra los extremos de una banda contra el casco) · front: mira hacia -z
    const A = ringPts(o, seg, half), B = ringPts(i, seg, half), P = [], N = [], U = [], sg = front ? -1 : 1; let fix = 0;
    for (let k = 0; k < seg; k++) for (const q of [[A[k], B[k], B[k + 1]], [A[k], B[k + 1], A[k + 1]]]) { // el sentido de giro depende de la mitad y del extremo: se comprueba con la normal deseada
      const f = cross3(sub3(q[1], q[0]), sub3(q[2], q[0])); if (!fix && Math.abs(f[2]) > 1e-14) fix = Math.sign(f[2]) === sg ? 1 : -1;
      for (const p of fix < 0 ? [q[0], q[2], q[1]] : q) { P.push(...p); N.push(0, 0, sg); U.push(p[0] / TILE, p[1] / TILE); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.userData.uvm = 'keep'; g.userData.kind = 'wall'; return g;
  };
  const body = (K, X, S, o = {}) => { const f = o.mir ? K.mir : K.add, p = o.p || [0, 0, 0], r = o.r || [0, 0, 0], s = o.s || [1, 1, 1]; for (const h of [0, 1]) f(h ? (o.b || X.H2) : (o.t || X.H), loft(S, o.seg || 14, h, o.flat), p, r, s); }; // lomo claro y vientre oscuro
  const bandK = (K, role, S, z0, z1, k = 1.02, seg = 12, p = [0, 0, 0]) => { const I = subS(S, z0, z1), T = I.map(s => [s[0], s[1] * k, s[2] * k, s[3] * k, s[4], s[5], s[6]]); for (const h of [0, 1]) { K.add(role, loft(T, seg, h, false, false), p); K.add(role, annulus(T[0], I[0], seg, h, true), p); K.add(role, annulus(T[T.length - 1], I[I.length - 1], seg, h, false), p); } }; // anillo ligeramente más grande que el fuselaje (juntas, radomo, franjas, blindaje) con paredes en los extremos: no deja hueco contra el casco

  // ---------- alas con perfil: secciones de raíz a punta ({x, y, zl: borde de ataque, c: cuerda, t: espesor}); ax 'x' = derivas (el espesor va en x) ----------
  const WP = [[0, 0, 0], [0.22, 0.5, -0.36], [0.62, 0.34, -0.24], [1, 0.07, -0.07]]; // [fracción de cuerda, semiespesor superior, inferior] en unidades de espesor
  const profH = (f, h) => { if (!h) return 0; const k = h > 0 ? 1 : 2; for (let i = 1; i < WP.length; i++) if (f <= WP[i][0] || i === WP.length - 1) { const a = WP[i - 1], b = WP[i], q = Math.min(1, Math.max(0, (f - a[0]) / (b[0] - a[0]))); return a[k] + (b[k] - a[k]) * q; } };
  function mkWing(S, ax = 'y') {
    const ai = ax === 'x' ? 0 : 1, last = S[S.length - 1], flip = ax === 'x' ? last.y - S[0].y > 0 : last.x - S[0].x < 0;
    const at = (u, f, h = 0) => { const i = Math.min(S.length - 2, Math.max(0, Math.floor(u))), k = u - i, a = S[i], b = S[i + 1], L = q => a[q] + (b[q] - a[q]) * k, P = [L('x'), L('y'), L('zl') + f * L('c')]; P[ai] += profH(f, h) * L('t'); return P; }; // punto de la superficie: u = sección (fraccionaria), f = cuerda 0-1, h = +1 extradós / -1 intradós / 0 línea media
    const ringAt = i => [[0, 0], [0.22, 1], [0.62, 1], [1, 1], [1, -1], [0.62, -1], [0.22, -1]].map(([f, h]) => at(i, f, h));
    const tri = (P, a, b, c) => { if (flip) P.push(...a, ...c, ...b); else P.push(...a, ...b, ...c); };
    const P = []; for (let i = 0; i < S.length - 1; i++) { const A = ringAt(i), B = ringAt(i + 1); for (let j = 0; j < 7; j++) { const j2 = (j + 1) % 7; tri(P, A[j], A[j2], B[j2]); tri(P, A[j], B[j2], B[j]); } }
    const T = ringAt(S.length - 1), R0 = ringAt(0); for (let j = 1; j < 6; j++) { tri(P, T[0], T[j], T[j + 1]); tri(P, R0[0], R0[j + 1], R0[j]); } // tapas de punta y de raíz
    const patch = (u0, u1, f0, f1, h = 1, lift = 0.00005) => { // parche pegado a la superficie (flaps, alerones, franjas, juntas): u0-u1 en secciones, f0-f1 en cuerda
      const us = [u0], fs = [f0]; for (let i = Math.floor(u0) + 1; i < u1; i++) us.push(i); us.push(u1); for (const [f] of WP) if (f > f0 && f < f1) fs.push(f); fs.push(f1);
      const pt = (u, f) => { const p = at(u, f, h); p[ai] += h * lift; return p; }, fl = flip !== (h < 0), Q = [];
      for (let a = 0; a < us.length - 1; a++) for (let b = 0; b < fs.length - 1; b++) { const p0 = pt(us[a], fs[b]), p1 = pt(us[a], fs[b + 1]), p2 = pt(us[a + 1], fs[b + 1]), p3 = pt(us[a + 1], fs[b]); if (fl) Q.push(...p0, ...p2, ...p1, ...p0, ...p3, ...p2); else Q.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3); }
      const g = geoOf(Q); g.userData.decal = true; return g;
    };
    const wg = geoOf(P); wg.userData.kind = 'wing';
    return { geo: wg, at, patch, S };
  }

  // ---------- calcomanías planas (miran hacia arriba) y remaches ----------
  const flatPoly = pts => { const sh = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z))); return new THREE.ShapeGeometry(sh).rotateX(-PI / 2); };
  const rect = (w, d) => flatPoly([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]);
  const rivets = (K, mat, a, b, n, s = 0.00024, mir = true) => { const g = rect(s, s), f = mir ? K.mir : K.add; for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) : 0; f(mat, g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); } }; // hilera de remaches (2 triángulos cada uno)
  const wRiv = (K, W, mat, u0, u1, f, n, s = 0.00022) => { const g = rect(s, s); for (let i = 0; i < n; i++) { const p = W.at(u0 + (u1 - u0) * (n > 1 ? i / (n - 1) : 0), f, 1); p[1] += 0.00005; K.mir(mat, g, p); } }; // remaches siguiendo el extradós de un ala
  const louvers = (K, mat, x, y, z, n, dz, w, d, mir = true) => { const g = rect(w, d), f = mir ? K.mir : K.add; for (let i = 0; i < n; i++) f(mat, g, [x, y, z + i * dz]); }; // rejillas de ventilación
  const domeK = (K, role, r, p, rot = [0, 0, 0], s = [1, 1, 1], seg = 14, hs = 8) => { K.add(role, new THREE.SphereGeometry(r, seg, hs, 0, PI * 2, 0, PI / 2), p, rot, s); const c = new THREE.CircleGeometry(r, seg).rotateX(PI / 2); c.userData.cap = true; K.add(role, c, p, rot, s); }; // cúpula (media esfera) con su base cerrada
  const disc = (r, seg = 14) => new THREE.CircleGeometry(r, seg).rotateX(-PI / 2);
  const insignia = (K, x, y, z, r) => { K.mir('D', disc(r, 16), [x, y, z]); K.mir('A', disc(r * 0.66, 16), [x, y + 0.00003, z]); K.mir('D', disc(r * 0.3, 10), [x, y + 0.00006, z]); }; // escarapela: borde oscuro, anillo del color de la nave y punto central
  const wIns = (K, W, u, f, r) => { const p = W.at(u, f, 1); insignia(K, p[0], p[1] + 0.00007, p[2], r); };

  function canopy(K, X, x, y, z, r, len, hgt = 0.9) { // cabina: cristal en gota con marco (aro de base, arcos y largueros), viga trasera, asiento, panel de instrumentos y destello
    const L = r * len * 0.66, P = [[0, -0.5], [0.44, -0.44], [0.84, -0.22], [1, 0.06], [0.92, 0.34], [0.58, 0.64], [0.22, 0.9], [0, 1]].map(([a, b]) => [a * r, b * L]);
    K.add(X.G, latheG(P, 1, hgt, 18, PI / 2, PI), [x, y, z]);
    for (const k of [-0.3, 0.1, 0.5]) K.add(X.D, new THREE.TorusGeometry(radAt(P, k * L) * 1.012, 0.00017, 4, 14, PI).scale(1, hgt, 1), [x, y, z + k * L]);
    K.add(X.D, flatPoly([...P.map(([a, b]) => [a * 0.98, b]), ...P.slice().reverse().map(([a, b]) => [-a * 0.98, b])]), [x, y - 0.00002, z]); // suelo de la cabina
    body(K, X, P.map(([a, b], i) => [b, Math.max(a * 1.035, 0.00012), 0.00045, 0.0006, 2.2, 0]), { t: X.D, b: X.D, p: [x, y - 0.00015, z], seg: 12 }); // falda de la cabina: tapa la unión con el fuselaje
    K.mir(X.D, bx(0.00024, 0.00022, L * 1.36), [x + r * 0.99, y, z + L * 0.2]); K.add(X.D, bx(r * 1.9, 0.0003, r * 0.3), [x, y + 0.00005, z + L * 1.02]); // largueros de base y viga trasera
    K.add(X.D, bx(r * 0.7, r * hgt * 0.5, r * len * 0.2), [x, y + r * hgt * 0.24, z + L * 0.3]); K.add(X.H2, bx(r * 0.5, r * hgt * 0.34, r * len * 0.05), [x, y + r * hgt * 0.5, z + L * 0.34]); // asiento y reposacabezas
    K.add(LC, bx(r * 0.8, 0.00007, L * 0.3), [x, y + r * hgt * 0.16, z - L * 0.42], [0.35, 0, 0]); K.add(LW, bx(r * 0.22, 0.00008, L * 0.9), [x + r * 0.3, y + r * hgt * 0.93, z - L * 0.1], [0, 0, -0.25]);
  }
  function inlet(K, X, x, y, z, w, h, d) { // toma de aire lateral: cachete (mitad superior clara, inferior oscura), boca oscura elíptica y labio de color
    body(K, X, [[z, w * 0.55, h * 0.55, h * 0.5, 2.4, 0], [z + d * 0.3, w, h * 0.55, h * 0.5, 2.4, 0], [z + d, w * 0.9, h * 0.5, h * 0.5, 2.2, 0]], { p: [x, y, 0], mir: true, seg: 10 });
    K.mir(X.D, new THREE.CircleGeometry(1, 12), [x, y, z + 0.00004], [0, 0, 0], [w * 0.5, h * 0.5, 1]); K.mir(X.A, new THREE.TorusGeometry(1, 0.09, 4, 12), [x, y, z + 0.00008], [0, 0, 0], [w * 0.56, h * 0.56, w * 0.56]);
  }
const BUILD = {
  saeta(K, X) { // interceptor: aguja con aristas, canards, alas en ojiva con flaps y alerones, cola en V y un solo motor con tobera de pétalos
    const S = [[-0.029, 0.00015, 0.00015, 0.00015, 2, 0], [-0.025, 0.0009, 0.0009, 0.0007, 2.2, 0], [-0.02, 0.0019, 0.0019, 0.0013, 2.4, 0.0001], [-0.014, 0.0029, 0.0027, 0.0017, 2.8, 0.0003], [-0.008, 0.0037, 0.0031, 0.0019, 3, 0.0004], [-0.001, 0.0043, 0.0033, 0.0022, 3.2, 0.0004], [0.006, 0.0045, 0.0033, 0.0023, 3.2, 0.0003], [0.0125, 0.0042, 0.0032, 0.0025, 2.8, 0.0002], [0.017, 0.0039, 0.0034, 0.003, 2.3, 0], [0.0191, 0.0037, 0.0036, 0.0036, 2, 0]];
    body(K, X, S, { seg: 16 });
    bandK(K, X.D, S, -0.0292, -0.0224, 1.03); bandK(K, X.A, S, -0.0226, -0.0219, 1.04); // radomo oscuro con aro de color
    for (const z of [-0.015, -0.0075, 0, 0.0075, 0.014]) bandK(K, X.D, S, z - 0.00012, z + 0.00012, 1.012, 10); // juntas de paneles
    bandK(K, X.A, S, 0.011, 0.0114, 1.03); bandK(K, X.D, S, 0.0185, 0.019, 1.03); // aros de la caja del motor
    K.add(X.MT, cylZ(0.00028, 0.0001, 0.006, 6), [0, 0, -0.0318]); K.add(LR, ball3(0.00026), [0, 0, -0.0348]); // sonda pitot
    body(K, X, [[-0.0245, 0.0004, 0.0004, 0.0004, 2, -0.0013], [-0.0225, 0.0007, 0.0007, 0.0007, 2.2, -0.0013], [-0.012, 0.0011, 0.0009, 0.0009, 2.4, -0.0011], [-0.006, 0.0004, 0.0003, 0.0003, 2, -0.0007]], { seg: 8 }); // carena del cañón de proa
    canopy(K, X, 0, 0.0027, -0.011, 0.0027, 3, 0.95);
    body(K, X, [[-0.004, 0.0004, 0.0003, 0.0002, 2, 0.0036], [0, 0.0009, 0.0011, 0.0002, 2.2, 0.0034], [0.008, 0.0011, 0.0012, 0.0002, 2.4, 0.0033], [0.017, 0.0008, 0.0008, 0.0002, 2, 0.0031]], { seg: 10 }); // lomo dorsal con franja
    K.add(X.A, rect(0.00045, 0.0095), [0, 0.00457, 0.005]); louvers(K, X.D, 0.0022, 0.00357, 0.009, 4, 0.0012, 0.0007, 0.0006);
    const W = mkWing([{ x: 0.003, y: 0, zl: -0.005, c: 0.0175, t: 0.0012 }, { x: 0.013, y: 0.0003, zl: 0.003, c: 0.01, t: 0.0007 }, { x: 0.0205, y: 0.0006, zl: 0.0105, c: 0.0045, t: 0.00035 }]);
    K.mir(X.H, W.geo); K.mir(X.A, W.patch(0.1, 1.9, 0, 0.1, 1, 0.00004)); // ala con franja del borde de ataque
    for (const h of [1, -1]) { K.mir(X.H2, W.patch(0.15, 1, 0.7, 1, h, 0.00004)); K.mir(X.H2, W.patch(1.05, 1.95, 0.72, 1, h, 0.00004)); } // flaps y alerones
    for (const [u0, u1, f] of [[0.15, 1, 0.7], [1.05, 1.95, 0.72], [0.15, 1.95, 0.35]]) K.mir(X.D, W.patch(u0, u1, f, f + 0.014, 1, 0.00005)); K.mir(X.D, W.patch(1, 1.04, 0.7, 1, 1, 0.00005)); // juntas
    wRiv(K, W, X.D, 0.15, 1.9, 0.5, 9); wRiv(K, W, X.D, 0.2, 1.7, 0.2, 7);
    const C = mkWing([{ x: 0.002, y: 0.0004, zl: -0.017, c: 0.0072, t: 0.0007 }, { x: 0.009, y: 0.0008, zl: -0.0128, c: 0.0034, t: 0.0003 }]); K.mir(X.A, C.geo); K.mir(X.D, C.patch(0.1, 0.95, 0.74, 1, 1, 0.00003)); // canards
    const T = mkWing([{ x: 0.0036, y: 0.003, zl: 0.0108, c: 0.0085, t: 0.0008 }, { x: 0.0086, y: 0.0108, zl: 0.0152, c: 0.0034, t: 0.0003 }], 'x'); // cola en V
    K.mir(X.H, T.geo); for (const h of [1, -1]) K.mir(X.H2, T.patch(0.1, 0.95, 0.66, 1, h, 0.00004)); K.mir(X.A, T.patch(0.55, 1, 0, 0.16, 1, 0.00004)); K.mir(STW, ball3(0.00028), T.at(1, 0.9, 0));
    K.mir(X.H2, mkWing([{ x: 0.003, y: -0.003, zl: 0.012, c: 0.006, t: 0.0006 }, { x: 0.0048, y: -0.0062, zl: 0.0142, c: 0.0028, t: 0.0003 }], 'x').geo); // aletas ventrales
    body(K, X, [[0.0088, 0.0003, 0.0003, 0.0003, 2, 0], [0.01, 0.0007, 0.0007, 0.0007, 2.2, 0], [0.015, 0.0007, 0.0007, 0.0007, 2.2, 0], [0.0166, 0.0003, 0.0003, 0.0003, 2, 0]], { p: [0.021, 0.0005, 0], mir: true, seg: 8 }); // vainas de punta de ala
    K.add(LR, ball3(0.0005), [-0.021, 0.0005, 0.0086]); K.add(LG, ball3(0.0005), [0.021, 0.0005, 0.0086]);
    inlet(K, X, 0.0043, -0.0006, -0.0088, 0.0013, 0.0022, 0.0075);
    domeK(K, X.H2, 0.0009, [0, -0.0026, -0.011], [PI, 0, 0], [1, 1, 1], 8, 5); rcs(K, X, 0.0023, 0.0003, -0.0165); rcs(K, X, 0.0206, 0.0012, 0.0128, 0.8);
    hatch(K, X, 0.011, 0.0008, 0.006, 0.003, 0.0022); hatch(K, X, 0.017, 0.0008, 0.01, 0.0022, 0.0018); mast(K, X, 0, 0.0043, 0.014, 0.0032, 0.15, LW); mast(K, X, 0.017, 0.0008, 0.013, 0.0022, 0.3, LG);
    wIns(K, W, 1.3, 0.5, 0.0009);
    return { eng: [{ x: 0, y: 0, z: 0.0205, r: 0.0038 }], nose: [0, -0.0016, -0.0242], guns: [[-0.008, -0.0008, -0.001], [0.008, -0.0008, -0.001], [-0.014, -0.0008, 0.005], [0.014, -0.0008, 0.005]],
      py: { x0: 0.0055, dx: 0.0028, y: -0.0023, dy: 0.06, z: 0.006, dz: 0.38 }, sh: { y: 0, z: -0.008, r: 0.03 }, ar: { w: 0.0043, y: 0.0037, z0: -0.012, z1: 0.016 },
      gear: { top: -0.0022, legs: [[-0.005, 0.008], [0.005, 0.008], [0, -0.011, 1]] }, dc: { wing: W, S, ring: [0.004, 0.0075] } };
  },
  halcon(K, X) { // caza de superioridad: fuselaje plano con aristas, alas en delta, góndolas gemelas con tomas, colas inclinadas y estabilizadores
    const S = [[-0.0205, 0.0002, 0.0002, 0.0002, 2, 0], [-0.017, 0.0016, 0.0014, 0.0009, 2.4, 0.0002], [-0.011, 0.0036, 0.0024, 0.0015, 3, 0.0003], [-0.004, 0.0056, 0.0032, 0.002, 3.4, 0.0004], [0.004, 0.0064, 0.0034, 0.0022, 3.6, 0.0004], [0.011, 0.0062, 0.0034, 0.0022, 3.6, 0.0003], [0.017, 0.0058, 0.003, 0.0022, 3.6, 0.0002], [0.0192, 0.0056, 0.0026, 0.0022, 3.6, 0]];
    body(K, X, S, { seg: 16 });
    bandK(K, X.D, S, -0.0208, -0.0152, 1.03); bandK(K, X.A, S, -0.0154, -0.0149, 1.04); // radomo
    for (const z of [-0.0105, -0.005, 0.0015, 0.0085, 0.0145]) bandK(K, X.D, S, z - 0.00012, z + 0.00012, 1.01, 10); // juntas
    K.add(X.MT, cylZ(0.00012, 0.00024, 0.0035, 6), [0, 0, -0.0222]);
    body(K, X, [[-0.0068, 0.0019, 0.0021, 0.0016, 2.6, 0], [-0.004, 0.0029, 0.0029, 0.0025, 2.4, 0], [0, 0.0034, 0.0032, 0.0031, 2.3, 0], [0.008, 0.0036, 0.0032, 0.0032, 2.2, 0], [0.0173, 0.0034, 0.0031, 0.0031, 2, 0]], { p: [0.0088, -0.0005, 0], mir: true, seg: 14 }); // góndolas de los motores
    K.mir(X.D, new THREE.CircleGeometry(1, 14), [0.0088, -0.0005, -0.00685], [0, 0, 0], [0.0016, 0.0018, 1]); K.mir(X.A, new THREE.TorusGeometry(1, 0.11, 4, 14), [0.0088, -0.0005, -0.00675], [0, 0, 0], [0.002, 0.0022, 0.002]); // bocas de las tomas
    K.mir(X.MT, bx(0.0003, 0.0022, 0.0034), [0.0058, -0.0005, -0.0058]); // divisor de capa límite
    for (const z of [0.0035, 0.0105, 0.0165]) K.mir(X.D, new THREE.TorusGeometry(0.0035, 0.00016, 4, 16), [0.0088, -0.0005, z]);
    canopy(K, X, 0, 0.003, -0.006, 0.0038, 2.3);
    body(K, X, [[-0.0035, 0.0004, 0.0003, 0.0002, 2, 0.0041], [0, 0.0026, 0.0018, 0.0003, 2.2, 0.0037], [0.006, 0.0024, 0.0012, 0.0003, 2.3, 0.0036], [0.0192, 0.0018, 0.0008, 0.0002, 2, 0.0033]], { seg: 12 }); // lomo dorsal
    K.add(X.D, rect(0.003, 0.0042), [0, 0.00482, 0.0105]); K.add(X.H2, rect(0.0024, 0.0034), [0, 0.00484, 0.0105]); K.add(X.A, rect(0.0005, 0.0086), [0, 0.00486, 0.0045]); // freno aerodinámico y franja
    const W = mkWing([{ x: 0.0055, y: 0, zl: -0.007, c: 0.0205, t: 0.0016 }, { x: 0.018, y: 0.0003, zl: 0.004, c: 0.009, t: 0.0009 }, { x: 0.0285, y: 0.0008, zl: 0.0135, c: 0.0038, t: 0.0004 }]);
    K.mir(X.H, W.geo); K.mir(X.A, W.patch(0.15, 1.95, 0, 0.08, 1, 0.00004));
    for (const h of [1, -1]) { K.mir(X.H2, W.patch(0.1, 1, 0.68, 1, h, 0.00004)); K.mir(X.A, W.patch(1.05, 1.95, 0.7, 1, h, 0.00004)); K.mir(X.H2, W.patch(0.3, 1.9, 0, 0.13, h, 0.00003)); } // flaps, alerones y flaps del borde de ataque
    for (const [u0, u1, f] of [[0.1, 1, 0.68], [1.05, 1.95, 0.7], [0.1, 1.95, 0.4], [0.3, 1.9, 0.13]]) K.mir(X.D, W.patch(u0, u1, f, f + 0.013, 1, 0.00005)); K.mir(X.D, W.patch(1, 1.04, 0.68, 1, 1, 0.00005));
    wRiv(K, W, X.D, 0.1, 1.9, 0.55, 10); wRiv(K, W, X.D, 0.2, 1.7, 0.25, 8);
    K.mir(X.H, mkWing([{ x: 0.003, y: 0.0003, zl: -0.0135, c: 0.0075, t: 0.0007 }, { x: 0.009, y: 0.0001, zl: -0.002, c: 0.0022, t: 0.0004 }]).geo); // strakes
    const T = mkWing([{ x: 0.0078, y: 0.0026, zl: 0.009, c: 0.0088, t: 0.0009 }, { x: 0.0118, y: 0.011, zl: 0.014, c: 0.0038, t: 0.0004 }], 'x'); // colas inclinadas
    K.mir(X.H, T.geo); for (const h of [1, -1]) K.mir(X.H2, T.patch(0.1, 0.95, 0.68, 1, h, 0.00004)); K.mir(X.A, T.patch(0.5, 1, 0, 0.14, 1, 0.00004)); K.mir(STW, ball3(0.0003), T.at(1, 0.95, 0));
    K.mir(X.H, mkWing([{ x: 0.0095, y: -0.0003, zl: 0.011, c: 0.0068, t: 0.0008 }, { x: 0.0168, y: -0.0004, zl: 0.016, c: 0.0032, t: 0.0004 }]).geo); // estabilizadores
    body(K, X, [[0.0088, 0.0004, 0.0004, 0.0004, 2, 0], [0.0105, 0.0011, 0.0011, 0.0011, 2.2, 0], [0.0175, 0.0011, 0.0011, 0.0011, 2.2, 0], [0.0198, 0.0004, 0.0004, 0.0004, 2, 0]], { p: [0.0285, 0.0008, 0], mir: true, seg: 8 }); // vainas de punta de ala
    K.add(LR, ball3(0.0007), [-0.0285, 0.0008, 0.0092]); K.add(LG, ball3(0.0007), [0.0285, 0.0008, 0.0092]);
    K.mir(X.MT, bx(0.0011, 0.0016, 0.002), [0.0088, -0.0034, 0.01]);
    rivets(K, X.D, [0.0026, 0.0038, -0.009], [0.0034, 0.0034, 0.008], 7, 0.0003); mast(K, X, 0.0018, 0.0048, 0.013, 0.003, 0.1, LW); mast(K, X, -0.006, 0.0044, 0.012, 0.0028, -0.2, LG);
    hatch(K, X, 0.017, 0.0011, 0.0095, 0.004, 0.0032); hatch(K, X, 0.0235, 0.0011, 0.011, 0.003, 0.0026); mast(K, X, 0.021, 0.001, 0.0155, 0.0024, 0.3, LR);
    wIns(K, W, 1.3, 0.5, 0.0013);
    return { eng: [-1, 1].map(s => ({ x: s * 0.0088, y: -0.0005, z: 0.0187, r: 0.0031 })), nose: [0, -0.0018, -0.0185], guns: [[-0.012, -0.0012, 0], [0.012, -0.0012, 0], [-0.019, -0.0012, 0.006], [0.019, -0.0012, 0.006]],
      py: { x0: 0.0125, dx: 0.0032, y: -0.0022, dy: 0.06, z: 0.0062, dz: 0.55 }, sh: { y: 0, z: -0.004, r: 0.032 }, ar: { w: 0.0064, y: 0.0046, z0: -0.01, z1: 0.016 },
      gear: { top: -0.0025, legs: [[-0.0088, 0.008], [0.0088, 0.008], [0, -0.011, 1]] }, dc: { wing: W, S, ring: [0.004, 0.0068] } };
  },
  coloso(K, X) { // cañonera pesada: casco acorazado con proa de ariete, puente, torreta dorsal de cañones gemelos, alas gruesas, góndolas de motor y triple propulsión
    const S = [[-0.021, 0.0028, 0.002, 0.0018, 2.6, 0], [-0.019, 0.006, 0.004, 0.0026, 3.2, 0], [-0.014, 0.009, 0.0056, 0.0034, 3.8, 0.0004], [-0.008, 0.0108, 0.0064, 0.0038, 4, 0.0006], [0, 0.0112, 0.0066, 0.004, 4, 0.0008], [0.009, 0.011, 0.0064, 0.004, 4, 0.0008], [0.016, 0.01, 0.0058, 0.004, 3.6, 0.0006], [0.0205, 0.0084, 0.005, 0.004, 3.2, 0.0004]];
    body(K, X, S, { seg: 12, flat: true });
    K.mir('AR', bx(0.0026, 0.0032, 0.0088), [0.0099, 0.0004, -0.0128], [0, -0.3, 0]); K.mir('AR', bx(0.0007, 0.0034, 0.013), [0.0116, 0.0006, -0.0004]); // pómulos y faldones blindados
    bandK(K, X.MT, S, -0.0214, -0.0166, 1.04); K.add(X.MT, bx(0.009, 0.0006, 0.0006), [0, 0.0006, -0.0199]); K.add(X.A, bx(0.0074, 0.0004, 0.0004), [0, 0.0016, -0.0187]); // proa acorazada de ariete
    for (const z of [-0.01, -0.003, 0.0045, 0.011, 0.0175]) bandK(K, X.D, S, z - 0.00014, z + 0.00014, 1.012, 12);
    body(K, X, [[-0.013, 0.003, 0.0008, 0.0004, 3, 0.0074], [-0.011, 0.0036, 0.0018, 0.0004, 3.4, 0.0074], [-0.007, 0.0038, 0.002, 0.0004, 3.4, 0.0074], [-0.004, 0.003, 0.0012, 0.0004, 3, 0.0074]], { seg: 10 }); // puente
    K.add(X.G, bx(0.0064, 0.0009, 0.003), [0, 0.0079, -0.0129], [-0.55, 0, 0]); K.mir(X.G, bx(0.0026, 0.0009, 0.0026), [0.004, 0.0075, -0.0106], [-0.4, 0.75, 0]); K.add(X.D, bx(0.0068, 0.0003, 0.0004), [0, 0.0078, -0.0136], [-0.55, 0, 0]); K.add(X.D, bx(0.0003, 0.001, 0.0032), [0, 0.0081, -0.0128], [-0.55, 0, 0]); K.add(X.A, bx(0.0078, 0.0004, 0.0008), [0, 0.0093, -0.0074]); // parabrisas de tres paneles con marcos
    K.add(X.H, bx(0.01, 0.0006, 0.0075), [0, 0.0077, 0.0046]); K.add(X.H2, bx(0.0074, 0.0004, 0.005), [0, 0.0081, 0.0062]); K.add(X.D, bx(0.0002, 0.0004, 0.01), [0, 0.0079, 0.01]); K.mir(X.D, bx(0.0002, 0.0005, 0.0076), [0.005, 0.0078, 0.0046]); // placas dorsales solapadas
    K.add(X.D, new THREE.CylinderGeometry(0.0036, 0.004, 0.0016, 16), [0, 0.0085, 0.0016]); K.add(X.A, new THREE.TorusGeometry(0.0034, 0.00022, 4, 18).rotateX(PI / 2), [0, 0.0094, 0.0016]); domeK(K, X.H, 0.003, [0, 0.0095, 0.0016], [0, 0, 0], [1, 0.75, 1.1], 14, 8); // torreta dorsal
    K.add(X.D, bx(0.0012, 0.0008, 0.0006), [0, 0.0107, -0.0012]);
    for (const sx of [-1, 1]) { K.add(X.MT, cylZ(0.00045, 0.00045, 0.009, 8), [sx * 0.0011, 0.0104, -0.0035]); K.add(X.H2, cylZ(0.0007, 0.0007, 0.0026, 8), [sx * 0.0011, 0.0104, -0.0016]); K.add(X.D, cylZ(0.00075, 0.00075, 0.0012, 8), [sx * 0.0011, 0.0104, -0.0016]); K.add(X.D, cylZ(0.00068, 0.00068, 0.0009, 8), [sx * 0.0011, 0.0104, -0.0075]); } // cañones gemelos con camisa y freno de boca
    K.add(X.MT, bx(0.0006, 0.0011, 0.0032), [0, 0.0097, -0.0006]);
    const W = mkWing([{ x: 0.009, y: 0, zl: -0.004, c: 0.017, t: 0.003 }, { x: 0.0158, y: 0.0002, zl: -0.0005, c: 0.013, t: 0.0022 }, { x: 0.023, y: 0.0004, zl: 0.003, c: 0.009, t: 0.0012 }]);
    K.mir(X.H, W.geo); K.mir(X.A, W.patch(0.2, 1.95, 0, 0.1, 1, 0.00004));
    for (const h of [1, -1]) { K.mir(X.H2, W.patch(0.15, 1, 0.66, 1, h, 0.00004)); K.mir(X.H2, W.patch(1.05, 1.95, 0.7, 1, h, 0.00004)); }
    for (const [u0, u1, f] of [[0.15, 1, 0.66], [1.05, 1.95, 0.7], [0.15, 1.95, 0.3]]) K.mir(X.D, W.patch(u0, u1, f, f + 0.014, 1, 0.00005)); K.mir(X.D, W.patch(1, 1.04, 0.66, 1, 1, 0.00005));
    wRiv(K, W, X.D, 0.15, 1.9, 0.5, 8, 0.00026); wRiv(K, W, X.D, 0.2, 1.7, 0.2, 6, 0.00026);
    body(K, X, [[0.004, 0.0018, 0.0018, 0.0018, 2, -0.001], [0.0058, 0.0032, 0.0031, 0.003, 2.2, -0.001], [0.01, 0.0037, 0.0035, 0.0035, 2.2, -0.001], [0.0184, 0.0035, 0.0034, 0.0034, 2, -0.001]], { p: [0.0125, 0, 0], mir: true, seg: 14 }); // góndolas de los motores laterales
    for (const z of [0.0068, 0.0122]) K.mir(X.D, new THREE.TorusGeometry(0.0036, 0.00018, 4, 16), [0.0125, -0.001, z]); K.mir(X.A, new THREE.TorusGeometry(0.0033, 0.00024, 4, 16), [0.0125, -0.001, 0.0048]); K.mir(X.D, new THREE.CircleGeometry(0.0022, 12), [0.0125, -0.001, 0.0041]);
    K.mir(X.MT, bx(0.0012, 0.005, 0.014), [0.0104, 0, 0.003]); for (let i = 0; i < 4; i++) K.mir(X.D, bx(0.0002, 0.003, 0.0014), [0.0111, 0.0034, 0.009 + i * 0.0018]); // puntales y radiadores laterales
    body(K, X, [[0.0148, 0.0044, 0.004, 0.004, 2.6, 0], [0.0175, 0.005, 0.0048, 0.0048, 2.3, 0], [0.0201, 0.0052, 0.005, 0.005, 2, 0]], { seg: 16 }); // caja del motor central
    body(K, X, [[0.002, 0.0006, 0.0006, 0.0006, 2, 0], [0.0035, 0.0013, 0.0013, 0.0013, 2.4, 0], [0.0098, 0.0013, 0.0013, 0.0013, 2.4, 0], [0.0122, 0.0005, 0.0005, 0.0005, 2, 0]], { p: [0.0234, 0.0004, 0], mir: true, seg: 8 }); // vainas de punta de ala
    K.add(LR, ball3(0.0007), [-0.0234, 0.0004, 0.0018]); K.add(LG, ball3(0.0007), [0.0234, 0.0004, 0.0018]);
    rivets(K, X.D, [0.003, 0.0075, -0.013], [0.0046, 0.0073, 0.014], 8, 0.00034); mast(K, X, -0.004, 0.0078, 0.0125, 0.0046, 0.1, LW); domeK(K, X.H2, 0.001, [0.0045, 0.0078, 0.011], [0.5, 0, 0], [1, 1, 1], 8, 5);
    hatch(K, X, 0.015, 0.0018, 0.0098, 0.0044, 0.0034); hatch(K, X, 0.019, 0.0018, 0.006, 0.003, 0.0026); radiator(K, X, 0.006, 0.0079, 0.01, 0.0022, 0.006, 6); mast(K, X, 0.013, 0.0018, 0.0128, 0.003, 0.3, LR); mast(K, X, -0.013, 0.0018, -0.001, 0.0034, -0.2, LW);
    wIns(K, W, 1.3, 0.5, 0.0016);
    return { eng: [{ x: 0, y: 0, z: 0.0215, r: 0.0046 }, { x: -0.0125, y: -0.001, z: 0.0198, r: 0.0033 }, { x: 0.0125, y: -0.001, z: 0.0198, r: 0.0033 }],
      nose: [0, -0.003, -0.0205], guns: [[-0.014, -0.0014, -0.002], [0.014, -0.0014, -0.002], [-0.019, -0.0014, 0.002], [0.019, -0.0014, 0.002]],
      py: { x0: 0.0165, dx: 0.0022, cols: 4, y: -0.0028, dy: 0.04, z: 0.005, rz: 0.0045 }, sh: { y: 0, z: -0.004, r: 0.036 }, ar: { w: 0.01, y: 0.0074, z0: -0.012, z1: 0.016 },
      gear: { top: -0.0034, legs: [[-0.0085, 0.009], [0.0085, 0.009], [0, -0.012, 1]] }, dc: { wing: W, S, ring: [0.0088, 0.0112] } };
  },
  nomada(K, X) { // explorador: plato sensor con alimentador, cúpula panorámica, botes de carga, botes laterales con paneles solares plegables y motores gemelos
    const S = [[-0.0225, 0.0012, 0.0011, 0.0011, 2, 0], [-0.0195, 0.0026, 0.0024, 0.0022, 2.2, 0], [-0.013, 0.0036, 0.0034, 0.0031, 2.4, 0], [-0.004, 0.004, 0.0036, 0.0034, 2.6, 0], [0.006, 0.0039, 0.0035, 0.0034, 2.6, 0], [0.014, 0.0036, 0.0032, 0.0031, 2.4, 0], [0.0205, 0.0032, 0.0028, 0.0028, 2.2, 0], [0.0222, 0.0026, 0.0024, 0.0024, 2, 0]];
    body(K, X, S, { seg: 16 });
    for (const z of [-0.016, -0.008, -0.001, 0.005, 0.011, 0.017]) bandK(K, X.D, S, z - 0.00013, z + 0.00013, 1.012, 12); bandK(K, X.A, S, 0.0195, 0.0201, 1.03);
    K.add(X.H2, new THREE.SphereGeometry(0.0046, 20, 6, 0, PI * 2, 0, 0.95).rotateX(PI / 2), [0, 0, -0.0245]); K.add(X.H, new THREE.SphereGeometry(0.0044, 20, 6, 0, PI * 2, 0, 0.93).rotateX(PI / 2), [0, 0, -0.0246]); // plato sensor
    K.add(X.A, new THREE.TorusGeometry(0.00372, 0.00022, 4, 24), [0, 0, -0.0245 + 0.0046 * Math.cos(0.95)]); K.add(X.MT, cylZ(0.00022, 0.00022, 0.005, 6), [0, 0, -0.0265]); K.add(X.D, cylZ(0.0005, 0.00022, 0.0009, 8), [0, 0, -0.0291]); K.add(LY, ball3(0.0004), [0, 0, -0.0296]);
    for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3 + PI / 2; K.add(X.MT, cylZ(0.00009, 0.00009, 0.0046, 4), [Math.cos(a) * 0.0019, Math.sin(a) * 0.0019, -0.0248], [Math.sin(a) * 0.42, -Math.cos(a) * 0.42, 0]); } // trípode del alimentador
    canopy(K, X, 0, 0.0024, -0.0105, 0.0043, 1.75, 1); K.add(X.MT, new THREE.TorusGeometry(0.0044, 0.0003, 4, 20).rotateX(PI / 2), [0, 0.0024, -0.0105]);
    K.add(X.D, new THREE.CircleGeometry(0.0017, 16), [0, 0, 0.02235]); K.add(X.A, new THREE.TorusGeometry(0.0019, 0.0002, 4, 16), [0, 0, 0.0222]); K.add(X.MT, new THREE.TorusGeometry(0.0011, 0.00012, 4, 12), [0, 0, 0.0223]); // puerto de acoplamiento trasero
    K.add(X.H2, bx(0.003, 0.0018, 0.005), [0, 0.004, 0.004]); domeK(K, X.D, 0.0013, [0, 0.0049, 0.004], [0, 0, 0], [1, 1, 1], 10, 6); K.add(X.G, new THREE.SphereGeometry(0.00055, 8, 5), [0, 0.0056, 0.0034]); // torreta de sensores dorsal
    body(K, X, [[0.0092, 0.0004, 0.0004, 0.0004, 2, 0.004], [0.0098, 0.0011, 0.0011, 0.0011, 2.2, 0.004], [0.018, 0.0011, 0.0011, 0.0011, 2.2, 0.004], [0.0188, 0.0004, 0.0004, 0.0004, 2, 0.004]], { seg: 12 }); K.add(X.A, new THREE.TorusGeometry(0.0012, 0.0002, 4, 12), [0, 0.004, 0.011]); K.add(X.A, new THREE.TorusGeometry(0.0012, 0.0002, 4, 12), [0, 0.004, 0.017]); // bote de carga dorsal
    body(K, X, [[-0.0075, 0.0006, 0.0006, 0.0006, 2, 0], [-0.0062, 0.0016, 0.0016, 0.0016, 2.2, 0], [-0.004, 0.0019, 0.0019, 0.0019, 2.2, 0], [0.022, 0.0019, 0.0019, 0.0019, 2.2, 0]], { p: [0.012, 0, 0], mir: true, seg: 12 }); // botes laterales
    K.mir(X.A, new THREE.TorusGeometry(0.00195, 0.0002, 4, 12), [0.012, 0, -0.0035]); K.mir(X.A, new THREE.TorusGeometry(0.00195, 0.0002, 4, 12), [0.012, 0, 0.0155]); for (const z of [0.0, 0.0075, 0.0225]) K.mir(X.D, new THREE.TorusGeometry(0.0019, 0.00014, 4, 12), [0.012, 0, z]);
    K.mir(X.H, bx(0.0085, 0.0012, 0.004), [0.0078, 0, 0.004]); K.mir(X.MT, bx(0.0085, 0.0006, 0.001), [0.0078, 0.0007, 0.0058]); K.mir(X.MT, bx(0.0085, 0.0006, 0.001), [0.0078, 0.0007, 0.0022]);
    K.mir(X.H2, new THREE.SphereGeometry(0.0016, 10, 8), [0.0128, 0.0021, 0.013]); K.mir(X.A, new THREE.TorusGeometry(0.0016, 0.00016, 4, 12), [0.0128, 0.0021, 0.013]); K.mir(X.MT, new THREE.CylinderGeometry(0.00012, 0.00012, 0.002, 4), [0.0128, 0.001, 0.013]); // depósito esférico
    K.mir(X.D, new THREE.CylinderGeometry(0.00045, 0.00045, 0.0166, 6).rotateZ(PI / 2), [0.0226, 0, 0.008]); // eje de giro de los paneles
    for (let s = 0; s < 3; s++) { // paneles solares plegables: 3 tramos con marco, celdas y bisagras
      const cx = 0.0165 + s * 0.0048;
      K.mir('PV', bx(0.0044, 0.00034, 0.0126), [cx, 0, 0.008]); K.mir(X.H, bx(0.0046, 0.0005, 0.0003), [cx, 0, 0.0143]); K.mir(X.H, bx(0.0046, 0.0005, 0.0003), [cx, 0, 0.0017]); K.mir(X.H, bx(0.0003, 0.0005, 0.0126), [cx + 0.0023, 0, 0.008]); K.mir(X.H, bx(0.0003, 0.0005, 0.0126), [cx - 0.0023, 0, 0.008]);
      K.mir(X.MT, bx(0.0004, 0.0004, 0.0126), [cx, -0.0004, 0.008]); if (s < 2) K.mir(X.D, cylZ(0.00018, 0.00018, 0.0126, 5), [cx + 0.0024, 0.0002, 0.008]);
    }
    K.mir(X.MT, bx(0.0034, 0.0004, 0.0006), [0.015, 0, 0.008]); K.add(LR, ball3(0.0006), [-0.0286, 0, 0.0143]); K.add(LG, ball3(0.0006), [0.0286, 0, 0.0143]);
    mast(K, X, 0.0016, 0.005, 0.001, 0.006, 0.25, LW); mast(K, X, -0.0018, 0.005, 0.017, 0.004, -0.2, LR); domeK(K, X.H2, 0.001, [0.0032, 0.0036, -0.002], [0.9, 0, 0.5], [1, 1, 1], 8, 5);
    rivets(K, X.D, [0.0018, 0.0033, -0.006], [0.002, 0.0034, 0.009], 7, 0.0003);
    radiator(K, X, 0.007, 0, 0.017, 0.005, 0.007, 7); radiator(K, X, 0.0072, 0, -0.004, 0.0044, 0.005, 5); dish(K, X, -0.003, 0.0046, 0.006, 0.0014, [0.5, 0, 0.3]); rcs(K, X, 0.0029, 0.001, -0.017, 1); rcs(K, X, 0.029, 0.0004, 0.0128, 0.8); hatch(K, X, 0.002, 0.0038, 0.0022, 0.0018, 0.0026, false); mast(K, X, 0.014, 0.002, 0.023, 0.003, 0.2, LR);
    return { eng: [-1, 1].map(s => ({ x: s * 0.012, y: 0, z: 0.0234, r: 0.0026 })), nose: [0, -0.0015, -0.0215], guns: [[-0.012, -0.0022, -0.004], [0.012, -0.0022, -0.004], [-0.022, -0.0004, 0.002], [0.022, -0.0004, 0.002]],
      py: { x0: 0.0105, dx: 0.003, cols: 2, y: -0.0033, z: 0, rz: 0.0056 }, sh: { y: 0, z: -0.01, r: 0.032 }, ar: { w: 0.0038, y: 0.0035, z0: -0.012, z1: 0.016 },
      gear: { top: -0.0032, legs: [[-0.0075, 0.009], [0.0075, 0.009], [0, -0.012, 1]] }, dc: { wing: null, S, ring: [0.006, 0.009] } };
  },
  centinela(K, X) { // blindada: casco ancho y bajo de placas cerámicas, visera frontal, dos «cuernos» emisores de escudo, alas cortas con cañones y doble motor
    const S = [[-0.02, 0.003, 0.0018, 0.002, 3, 0], [-0.018, 0.0075, 0.003, 0.0028, 4, 0], [-0.013, 0.01, 0.0046, 0.0034, 4.5, 0.0002], [-0.005, 0.0108, 0.0056, 0.0038, 4.5, 0.0004], [0.006, 0.0108, 0.0058, 0.004, 4.5, 0.0005], [0.014, 0.01, 0.0056, 0.004, 4.2, 0.0004], [0.021, 0.009, 0.0052, 0.004, 3.6, 0.0002]];
    body(K, X, S, { seg: 12, flat: true });
    body(K, X, [[-0.0218, 0.0074, 0.003, 0.0028, 3, 0.0002], [-0.0208, 0.0088, 0.0034, 0.003, 3, 0.0002], [-0.0192, 0.0084, 0.0032, 0.0028, 3, 0.0002]], { seg: 10, flat: true, t: 'AR', b: 'AR' }); // visera frontal blindada
    K.add(X.D, bx(0.0072, 0.0004, 0.0004), [0, 0.0016, -0.0219]); K.add(X.MT, bx(0.0058, 0.0006, 0.0005), [0, -0.0016, -0.0217]);
    for (const z of [-0.0105, -0.0035, 0.0035, 0.0105, 0.017]) bandK(K, X.D, S, z - 0.00014, z + 0.00014, 1.012, 12);
    for (let r = 0; r < 3; r++) for (let c = -2; c <= 2; c++) { K.add('AR', bx(0.0019, 0.0004, 0.0055), [c * 0.0021, 0.0064, -0.0138 + r * 0.006]); rivets(K, X.D, [c * 0.0021 - 0.0006, 0.00665, -0.0138 + r * 0.006 - 0.0018], [c * 0.0021 - 0.0006, 0.00665, -0.0138 + r * 0.006 + 0.0018], 2, 0.00022, false); } // baldosas cerámicas
    body(K, X, [[-0.0128, 0.003, 0.001, 0.0004, 3, 0.0068], [-0.0108, 0.0036, 0.0018, 0.0004, 3.2, 0.0068], [-0.007, 0.0036, 0.0018, 0.0004, 3.2, 0.0068], [-0.0048, 0.0026, 0.0009, 0.0004, 3, 0.0068]], { seg: 10, flat: true, t: 'AR' }); // cúpula del puente
    K.add(X.G, bx(0.004, 0.0004, 0.0012), [0, 0.0083, -0.0112], [-0.45, 0, 0]); K.add(X.D, bx(0.0044, 0.0003, 0.0004), [0, 0.0081, -0.0119], [-0.45, 0, 0]); K.add(X.A, bx(0.0006, 0.0005, 0.0052), [0, 0.0087, -0.0072]);
    for (const sx of [-1, 1]) { // cuernos emisores de escudo: brazos que se curvan hacia dentro y acaban en un nodo brillante
      const s = sx > 0 ? 1 : -1;
      body(K, X, [[0.006, 0.0018, 0.0026, 0.0022, 2.6, 0.0002, s * 0.0128], [-0.003, 0.002, 0.003, 0.0026, 2.6, 0.0002, s * 0.0128], [-0.013, 0.0018, 0.0026, 0.0022, 2.6, 0.0002, s * 0.0122], [-0.02, 0.0013, 0.0018, 0.0016, 2.6, 0.0002, s * 0.0112], [-0.0235, 0.0004, 0.0004, 0.0004, 2, 0.0002, s * 0.01]], { seg: 12, flat: true });
      K.add(LC, ball3(0.0006), [s * 0.0102, 0.0002, -0.0233]); for (const z of [-0.0176, -0.0106, -0.0036]) K.add(GL, new THREE.TorusGeometry(0.0022, 0.00016, 4, 14), [s * (0.0128 - (z < -0.0106 ? (-0.0106 - z) * 0.2 : 0)), 0.0002, z]);
      K.add('AR', bx(0.0008, 0.0036, 0.011), [s * 0.0146, 0.0002, -0.008]); K.add(X.A, bx(0.0004, 0.0008, 0.0068), [s * 0.0134, 0.0027, -0.0105]); // placa exterior y franja
    }
    for (const z of [-0.0105, -0.0035, 0.0035, 0.0105]) K.mir('AR', bx(0.0006, 0.0032, 0.0056), [0.011, 0.0004, z]); // placas de flanco
    const W = mkWing([{ x: 0.01, y: -0.0004, zl: 0, c: 0.015, t: 0.0026 }, { x: 0.0175, y: -0.0002, zl: 0.004, c: 0.01, t: 0.0016 }, { x: 0.023, y: 0, zl: 0.0075, c: 0.0055, t: 0.0008 }]);
    K.mir(X.H, W.geo); K.mir(X.A, W.patch(0.15, 1.95, 0, 0.1, 1, 0.00004)); for (const h of [1, -1]) { K.mir(X.H2, W.patch(0.1, 1, 0.66, 1, h, 0.00004)); K.mir(X.H2, W.patch(1.05, 1.95, 0.7, 1, h, 0.00004)); }
    for (const [u0, u1, f] of [[0.1, 1, 0.66], [1.05, 1.95, 0.7], [0.15, 1.95, 0.3]]) K.mir(X.D, W.patch(u0, u1, f, f + 0.014, 1, 0.00005)); wRiv(K, W, X.D, 0.15, 1.9, 0.5, 7, 0.00026);
    for (const sx of [-1, 1]) body(K, X, [[0.0128, 0.0032, 0.0034, 0.0034, 2.6, 0, sx * 0.0058], [0.0165, 0.0044, 0.0042, 0.0042, 2.3, 0, sx * 0.0058], [0.0199, 0.0044, 0.0042, 0.0042, 2, 0, sx * 0.0058]], { seg: 14 }); // cajas de los motores
    body(K, X, [[0.011, 0.0005, 0.0005, 0.0005, 2, 0], [0.0125, 0.0012, 0.0012, 0.0012, 2.4, 0], [0.019, 0.0012, 0.0012, 0.0012, 2.4, 0], [0.0205, 0.0005, 0.0005, 0.0005, 2, 0]], { p: [0.0232, 0, 0], mir: true, seg: 8 }); K.add(LR, ball3(0.0007), [-0.0232, 0, 0.0118]); K.add(LG, ball3(0.0007), [0.0232, 0, 0.0118]);
    inlet(K, X, 0.006, 0.0056, 0.0128, 0.0018, 0.0006, 0.004); louvers(K, X.D, 0.0058, 0.0066, 0.0125, 4, 0.0011, 0.0022, 0.0006); rivets(K, X.D, [0.0088, 0.0061, -0.014], [0.0088, 0.0061, 0.016], 9, 0.0003);
    mast(K, X, -0.0085, 0.0062, 0.012, 0.0036, 0.1, LW); mast(K, X, 0.0085, 0.0062, 0.0128, 0.003, -0.2, LR); hatch(K, X, 0.0125, 0.0016, 0.007, 0.004, 0.003); rcs(K, X, 0.0098, 0.0006, -0.0175, 1.2);
    wIns(K, W, 1.3, 0.5, 0.0013);
    return { eng: [-1, 1].map(s => ({ x: s * 0.0058, y: 0, z: 0.0213, r: 0.0038 })), nose: [0, -0.0022, -0.0212], guns: [[-0.0136, -0.0018, -0.0105], [0.0136, -0.0018, -0.0105], [-0.0165, -0.0012, -0.0005], [0.0165, -0.0012, -0.0005]],
      py: { x0: 0.0112, dx: 0.0026, cols: 4, y: -0.0038, dy: 0.03, z: 0.0072, dz: 0.35, rz: 0.005 }, sh: { y: 0, z: -0.006, r: 0.04 }, shE: [0, 0, -0.0192], ar: { w: 0.0105, y: 0.0067, z0: -0.012, z1: 0.016 },
      gear: { top: -0.0034, legs: [[-0.0075, 0.01], [0.0075, 0.01], [0, -0.013, 1]] }, dc: { wing: W, S, ring: [0.006, 0.0125] } };
  },
  fantasma(K, X) { // sigilo: ala volante facetada de aristas afiladas, cabina enrasada, colas en V, armas en bahías internas y toberas bajo una placa serrada
    const S = [[-0.026, 0.0002, 0.0002, 0.0002, 2, 0], [-0.021, 0.002, 0.001, 0.0008, 2, 0], [-0.014, 0.0046, 0.0016, 0.0012, 2, 0], [-0.006, 0.0068, 0.0022, 0.0014, 2, 0.0002], [0.004, 0.0074, 0.0022, 0.0014, 2, 0.0002], [0.012, 0.0066, 0.002, 0.0014, 2, 0.0002], [0.018, 0.005, 0.0016, 0.0014, 2, 0]];
    body(K, X, S, { seg: 6, flat: true });
    bandK(K, X.D, S, -0.0262, -0.0212, 1.04, 6); for (const z of [-0.0105, -0.002, 0.006, 0.0135]) bandK(K, X.D, S, z - 0.00012, z + 0.00012, 1.012, 6);
    K.add(X.MT, cylZ(0.00015, 0.00008, 0.0044, 5), [0, 0, -0.0282]); K.add(LR, ball3(0.0002), [0, 0, -0.0305]);
    canopy(K, X, 0, 0.0018, -0.0105, 0.0021, 3.4, 0.55); body(K, X, [[-0.004, 0.0004, 0.0004, 0.0002, 2, 0.0021], [0, 0.0014, 0.0012, 0.0002, 2, 0.002], [0.007, 0.0016, 0.0012, 0.0002, 2, 0.002], [0.0125, 0.0008, 0.0006, 0.0002, 2, 0.0019]], { seg: 6, flat: true }); // lomo tras la cabina
    const W = mkWing([{ x: 0.006, y: 0, zl: -0.01, c: 0.023, t: 0.0012 }, { x: 0.015, y: 0.0001, zl: -0.001, c: 0.016, t: 0.0008 }, { x: 0.0245, y: 0.0003, zl: 0.0085, c: 0.006, t: 0.0004 }]);
    K.mir(X.H, W.geo); K.mir(X.A, W.patch(0.1, 1.95, 0, 0.06, 1, 0.00004)); for (const h of [1, -1]) { K.mir(X.H2, W.patch(0.12, 1, 0.74, 1, h, 0.00004)); K.mir(X.H2, W.patch(1.06, 1.94, 0.74, 1, h, 0.00004)); }
    for (const [u0, u1, f] of [[0.12, 1, 0.74], [1.06, 1.94, 0.74], [0.15, 1.9, 0.4]]) K.mir(X.D, W.patch(u0, u1, f, f + 0.012, 1, 0.00005)); K.mir(X.D, W.patch(1, 1.05, 0.74, 1, 1, 0.00005)); wRiv(K, W, X.D, 0.15, 1.9, 0.55, 8, 0.00022); wRiv(K, W, X.D, 0.2, 1.7, 0.25, 6, 0.00022);
    for (let i = 0; i < 5; i++) { const u = 0.15 + i * 0.36, p = W.at(u, 1, 1), q = W.at(u + 0.18, 1, 1); K.mir(X.D, flatPoly([[p[0], p[2] - 0.0012], [q[0], q[2] - 0.0012], [(p[0] + q[0]) / 2, p[2] + 0.0008]]), [0, 0.00006, 0]); } // borde de fuga serrado (baja detectabilidad)
    const T = mkWing([{ x: 0.004, y: 0.0016, zl: 0.009, c: 0.008, t: 0.0006 }, { x: 0.009, y: 0.0072, zl: 0.013, c: 0.0035, t: 0.0003 }], 'x'); K.mir(X.H, T.geo); for (const h of [1, -1]) K.mir(X.H2, T.patch(0.1, 0.95, 0.66, 1, h, 0.00004)); K.mir(X.A, T.patch(0.55, 1, 0, 0.14, 1, 0.00004)); K.mir(STW, ball3(0.00024), T.at(1, 0.95, 0));
    body(K, X, [[0.0135, 0.0034, 0.0016, 0.0016, 2, 0], [0.0165, 0.003, 0.0017, 0.0017, 2, 0], [0.0176, 0.0028, 0.0018, 0.0018, 2, 0]], { p: [0.0035, 0, 0], mir: true, seg: 8, flat: true }); // cajas de los motores
    K.add(X.D, flatPoly([[-0.0064, 0.0172], [0.0064, 0.0172], [0.0064, 0.0234], [0.0032, 0.0214], [0, 0.0234], [-0.0032, 0.0214], [-0.0064, 0.0234]]), [0, 0.0021, 0]); // placa serrada sobre las toberas
    K.add(X.D, bx(0.009, 0.00014, 0.012), [0, -0.0013, 0.005]); K.add(X.D, bx(0.00014, 0.00016, 0.0125), [0, -0.00135, 0.005]); for (const z of [-0.001, 0.011]) K.add(X.D, bx(0.0091, 0.00016, 0.00014), [0, -0.00135, z]); // bahía de armas ventral
    for (const sx of [-1, 1]) body(K, X, [[-0.0052, 0.0002, 0.0002, 0.0002, 2, 0], [-0.0042, 0.0005, 0.0005, 0.0005, 2, 0], [0.0012, 0.0005, 0.0005, 0.0005, 2, 0]], { p: [sx * 0.0085, -0.0002, 0], seg: 6, flat: true }); // recintos de los cañones en el borde de ataque
    K.add(LR, ball3(0.0004), [-0.0245, 0.0003, 0.0092]); K.add(LG, ball3(0.0004), [0.0245, 0.0003, 0.0092]); rivets(K, X.D, [0.0022, 0.0018, -0.012], [0.0024, 0.0022, 0.012], 8, 0.00024);
    mast(K, X, 0, 0.0021, 0.013, 0.0018, 0.1, LW); hatch(K, X, 0.011, 0.0007, 0.004, 0.0034, 0.0026); hatch(K, X, 0.019, 0.0006, 0.006, 0.0024, 0.002); rcs(K, X, 0.0016, 0.0003, -0.0175, 0.8);
    wIns(K, W, 1.3, 0.5, 0.0011);
    return { eng: [-1, 1].map(s => ({ x: s * 0.0035, y: 0, z: 0.019, r: 0.0024 })), nose: [0, -0.001, -0.0262], gs: 0.55, guns: [[-0.0085, -0.0004, -0.006], [0.0085, -0.0004, -0.006], [-0.0135, -0.0004, -0.0003], [0.0135, -0.0004, -0.0003]],
      py: { x0: 0.003, dx: 0.002, cols: 3, y: -0.0031, z: 0.004, rz: 0.005 }, sh: { y: 0, z: -0.01, r: 0.03 }, shE: [0, -0.0004, -0.0225], ar: { w: 0.0074, y: 0.0024, z0: -0.012, z1: 0.014 },
      gear: { top: -0.0012, legs: [[-0.0055, 0.008], [0.0055, 0.008], [0, -0.014, 1]] }, dc: { wing: W, S, ring: [0.004, 0.011] } };
  },
  corsario(K, X) { // asalto rápido: alas en flecha adelantada, canards, gran toma ventral, cañones gemelos de proa, pilones cargados de misiles y colas gemelas
    const S = [[-0.023, 0.0002, 0.0002, 0.0002, 2, 0], [-0.0195, 0.0018, 0.0016, 0.001, 2.6, 0.0002], [-0.013, 0.004, 0.0028, 0.0018, 3.2, 0.0003], [-0.006, 0.0056, 0.0034, 0.0022, 3.6, 0.0004], [0.003, 0.0062, 0.0034, 0.0024, 3.6, 0.0004], [0.011, 0.0058, 0.0032, 0.0024, 3.4, 0.0003], [0.017, 0.005, 0.003, 0.0026, 3, 0.0002], [0.0198, 0.0044, 0.0028, 0.0028, 2.4, 0]];
    body(K, X, S, { seg: 16 });
    bandK(K, X.D, S, -0.0232, -0.0176, 1.03); bandK(K, X.A, S, -0.0178, -0.0172, 1.04); for (const z of [-0.0115, -0.005, 0.0015, 0.0085, 0.0145]) bandK(K, X.D, S, z - 0.00012, z + 0.00012, 1.012, 10);
    body(K, X, [[-0.015, 0.0014, 0.001, 0.001, 2.4, -0.002], [-0.012, 0.003, 0.0014, 0.0016, 2.4, -0.0022], [-0.004, 0.0032, 0.0014, 0.0016, 2.4, -0.0022], [0.002, 0.002, 0.001, 0.001, 2.2, -0.002]], { seg: 12 }); // gran toma de aire ventral
    K.add(X.D, new THREE.CircleGeometry(1, 14), [0, -0.0022, -0.01505], [0, 0, 0], [0.0025, 0.0016, 1]); K.add(X.A, new THREE.TorusGeometry(1, 0.09, 4, 14), [0, -0.0022, -0.01498], [0, 0, 0], [0.0029, 0.0019, 0.0029]);
    for (const sx of [-1, 1]) body(K, X, [[-0.0208, 0.0004, 0.0004, 0.0004, 2, -0.0017], [-0.0195, 0.0009, 0.0009, 0.0009, 2.2, -0.0018], [-0.0128, 0.0011, 0.0009, 0.0009, 2.4, -0.0016], [-0.0075, 0.0004, 0.0003, 0.0003, 2, -0.0012]], { p: [sx * 0.0022, 0, 0], seg: 8 }); // carenas de los cañones de proa
    canopy(K, X, 0, 0.0031, -0.0112, 0.003, 2.6, 1);
    body(K, X, [[-0.0035, 0.0004, 0.0003, 0.0002, 2, 0.004], [0, 0.0022, 0.0016, 0.0003, 2.2, 0.0037], [0.006, 0.0022, 0.0013, 0.0003, 2.3, 0.0036], [0.0198, 0.0016, 0.0008, 0.0002, 2, 0.0033]], { seg: 12 }); K.add(X.A, rect(0.0005, 0.0092), [0, 0.00515, 0.006]);
    const W = mkWing([{ x: 0.005, y: 0, zl: 0.002, c: 0.0135, t: 0.0015 }, { x: 0.015, y: 0.0003, zl: -0.0022, c: 0.0108, t: 0.001 }, { x: 0.025, y: 0.0007, zl: -0.005, c: 0.008, t: 0.0005 }]); // flecha adelantada
    K.mir(X.H, W.geo); K.mir(X.A, W.patch(0.15, 1.95, 0, 0.09, 1, 0.00004));
    for (const h of [1, -1]) { K.mir(X.H2, W.patch(0.1, 1, 0.66, 1, h, 0.00004)); K.mir(X.A, W.patch(1.05, 1.95, 0.68, 1, h, 0.00004)); }
    for (const [u0, u1, f] of [[0.1, 1, 0.66], [1.05, 1.95, 0.68], [0.15, 1.95, 0.33]]) K.mir(X.D, W.patch(u0, u1, f, f + 0.013, 1, 0.00005)); K.mir(X.D, W.patch(1, 1.04, 0.66, 1, 1, 0.00005)); wRiv(K, W, X.D, 0.12, 1.9, 0.5, 9); wRiv(K, W, X.D, 0.2, 1.7, 0.2, 7);
    const C = mkWing([{ x: 0.003, y: 0.0006, zl: -0.0155, c: 0.006, t: 0.0006 }, { x: 0.0085, y: 0.001, zl: -0.014, c: 0.003, t: 0.0003 }]); K.mir(X.A, C.geo);
    const T = mkWing([{ x: 0.0058, y: 0.003, zl: 0.01, c: 0.009, t: 0.0009 }, { x: 0.0078, y: 0.0118, zl: 0.0148, c: 0.004, t: 0.0004 }], 'x'); K.mir(X.H, T.geo); for (const h of [1, -1]) K.mir(X.H2, T.patch(0.1, 0.95, 0.66, 1, h, 0.00004)); K.mir(X.A, T.patch(0.5, 1, 0, 0.14, 1, 0.00004)); K.mir(STW, ball3(0.00028), T.at(1, 0.95, 0));
    K.mir(X.H, mkWing([{ x: 0.006, y: -0.0002, zl: 0.0128, c: 0.006, t: 0.0007 }, { x: 0.0115, y: -0.0002, zl: 0.0158, c: 0.003, t: 0.0003 }]).geo);
    body(K, X, [[0.004, 0.0026, 0.0024, 0.0024, 2.4, 0], [0.01, 0.0034, 0.003, 0.003, 2.3, 0], [0.0176, 0.0032, 0.003, 0.003, 2, 0]], { p: [0.006, 0, 0], mir: true, seg: 14 }); // góndolas gemelas
    for (const z of [0.008, 0.0145]) K.mir(X.D, new THREE.TorusGeometry(0.0031, 0.00016, 4, 16), [0.006, 0, z]); K.mir(X.A, new THREE.TorusGeometry(0.0029, 0.00022, 4, 16), [0.006, 0, 0.0042]);
    body(K, X, [[0.0002, 0.0004, 0.0004, 0.0004, 2, 0], [0.0016, 0.0011, 0.0011, 0.0011, 2.2, 0], [0.0086, 0.0011, 0.0011, 0.0011, 2.2, 0], [0.0102, 0.0004, 0.0004, 0.0004, 2, 0]], { p: [0.0255, 0.0007, 0], mir: true, seg: 8 }); K.add(LR, ball3(0.0006), [-0.0255, 0.0007, 0.0006]); K.add(LG, ball3(0.0006), [0.0255, 0.0007, 0.0006]); // vainas de punta de ala
    rivets(K, X.D, [0.0022, 0.0034, -0.01], [0.0028, 0.0032, 0.01], 8, 0.0003); mast(K, X, 0.0016, 0.0046, 0.014, 0.003, 0.1, LW); mast(K, X, -0.0058, 0.0044, 0.012, 0.0028, -0.2, LG); rcs(K, X, 0.0031, 0.0005, -0.0135); hatch(K, X, 0.0115, 0.001, 0.0065, 0.0036, 0.0028);
    wIns(K, W, 1.3, 0.5, 0.0011);
    return { eng: [-1, 1].map(s => ({ x: s * 0.006, y: 0, z: 0.019, r: 0.003 })), noses: [[-0.0022, -0.0017, -0.0206], [0.0022, -0.0017, -0.0206]], nose: [0, -0.0017, -0.0206], ns: 0.9,
      guns: [[-0.011, -0.001, -0.003], [0.011, -0.001, -0.003], [-0.0175, -0.001, -0.0046], [0.0175, -0.001, -0.0046]],
      py: { x0: 0.01, dx: 0.0026, cols: 4, y: -0.0025, dy: 0.05, z: 0.006, dz: -0.58, rz: 0.0038 }, sh: { y: 0, z: -0.006, r: 0.032 }, shE: [0, -0.0034, -0.0175], ar: { w: 0.0062, y: 0.0038, z0: -0.01, z1: 0.016 },
      gear: { top: -0.0026, legs: [[-0.0075, 0.008], [0.0075, 0.008], [0, -0.008, 1]] }, dc: { wing: W, S, ring: [0.004, 0.0075] } };
  },
  titan(K, X) { // pesada de gran tamaño: casco largo de placas, isla de mando, torreta de cañones dobles, cañones gemelos de proa, cargadores laterales de munición y motores gemelos gigantes
    const S = [[-0.027, 0.003, 0.0024, 0.002, 2.8, 0], [-0.0245, 0.0062, 0.0044, 0.0034, 3.6, 0], [-0.018, 0.0078, 0.0058, 0.0044, 4.4, 0.0004], [-0.009, 0.0082, 0.0064, 0.0048, 4.6, 0.0008], [0.002, 0.0084, 0.0066, 0.005, 4.6, 0.0009], [0.013, 0.0082, 0.0064, 0.005, 4.6, 0.0008], [0.02, 0.0078, 0.0058, 0.005, 4.2, 0.0006], [0.024, 0.007, 0.005, 0.005, 3.6, 0.0004]];
    body(K, X, S, { seg: 12, flat: true });
    bandK(K, X.MT, S, -0.0272, -0.0232, 1.04, 10); K.add(X.MT, bx(0.0082, 0.0006, 0.0006), [0, 0.0012, -0.0252]); K.add(X.A, bx(0.006, 0.0004, 0.0004), [0, 0.0022, -0.0244]);
    for (const z of [-0.0135, -0.0055, 0.0025, 0.0105, 0.018]) bandK(K, X.D, S, z - 0.00014, z + 0.00014, 1.012, 12);
    for (const [zc, zl] of [[-0.0185, 0.008], [-0.0085, 0.008], [0.0015, 0.008]]) { K.add('AR', bx(0.0122, 0.0005, zl), [0, 0.0078, zc]); rivets(K, X.D, [-0.0052, 0.00812, zc - zl * 0.4], [-0.0052, 0.00812, zc + zl * 0.4], 4, 0.00026); rivets(K, X.D, [0.0052, 0.00812, zc - zl * 0.4], [0.0052, 0.00812, zc + zl * 0.4], 4, 0.00026, false); } // placas dorsales solapadas
    K.add(X.D, new THREE.CylinderGeometry(0.0034, 0.0038, 0.0016, 16), [0, 0.0088, -0.0075]); K.add(X.A, new THREE.TorusGeometry(0.0032, 0.00022, 4, 18).rotateX(PI / 2), [0, 0.0097, -0.0075]); domeK(K, X.H, 0.0029, [0, 0.0098, -0.0075], [0, 0, 0], [1, 0.75, 1.15], 14, 8); // torreta dorsal de cañones dobles
    for (const sx of [-1, 1]) { K.add(X.MT, cylZ(0.00048, 0.00048, 0.0105, 8), [sx * 0.00125, 0.0108, -0.0121]); K.add(X.H2, cylZ(0.00075, 0.00075, 0.003, 10), [sx * 0.00125, 0.0108, -0.0092]); K.add(X.D, cylZ(0.0008, 0.0008, 0.0012, 8), [sx * 0.00125, 0.0108, -0.0169]); for (const z of [-0.0104, -0.0116, -0.0128]) K.add(X.D, cylZ(0.0006, 0.0006, 0.0002, 8), [sx * 0.00125, 0.0108, z]); }
    K.add(X.MT, bx(0.0007, 0.0012, 0.0036), [0, 0.0101, -0.0086]);
    body(K, X, [[0.004, 0.0024, 0.0012, 0.0004, 2.6, 0.0074], [0.0065, 0.0034, 0.0044, 0.0004, 3.4, 0.0074], [0.0125, 0.0034, 0.0048, 0.0004, 3.4, 0.0074], [0.0155, 0.0022, 0.0028, 0.0004, 3, 0.0074]], { seg: 10, flat: true }); // isla de mando
    K.add(X.G, bx(0.0046, 0.0009, 0.0008), [0, 0.0118, 0.0043], [-0.35, 0, 0]); K.add(X.D, bx(0.0048, 0.0003, 0.0004), [0, 0.0122, 0.0039]); for (const z of [0.0075, 0.0095, 0.0115]) K.mir(X.G, bx(0.0003, 0.0009, 0.0014), [0.0033, 0.0114, z]); K.add(X.A, bx(0.0068, 0.0004, 0.0006), [0, 0.0128, 0.0125]); mast(K, X, 0, 0.0131, 0.0105, 0.006, 0.1, LW); mast(K, X, -0.0015, 0.0131, 0.0135, 0.004, -0.3, LR); dish(K, X, 0.0016, 0.0128, 0.0125, 0.0013, [0.4, 0, 0.2]);
    for (const sx of [-1, 1]) { // cargadores de munición: cápsulas con bandas, tubo de alimentación y remaches
      body(K, X, [[-0.0112, 0.0016, 0.0016, 0.0016, 2, -0.0004, sx * 0.0112], [-0.01, 0.003, 0.003, 0.003, 2.2, -0.0004, sx * 0.0112], [0.0128, 0.003, 0.003, 0.003, 2.2, -0.0004, sx * 0.0112], [0.014, 0.0016, 0.0016, 0.0016, 2, -0.0004, sx * 0.0112]], { seg: 14 });
      for (const z of [-0.0076, -0.001, 0.0056, 0.0102]) K.add(z < 0.001 ? X.A : X.D, new THREE.TorusGeometry(0.00305, 0.00022, 4, 16), [sx * 0.0112, -0.0004, z]);
      K.add(X.MT, cylZ(0.0006, 0.0006, 0.008, 8).rotateY(PI / 2), [sx * 0.0086, 0.0034, -0.0035]); K.add(X.D, bx(0.0034, 0.0006, 0.0022), [sx * 0.0086, 0.0028, -0.0012]);
    }
    const W = mkWing([{ x: 0.0084, y: -0.0002, zl: -0.004, c: 0.021, t: 0.003 }, { x: 0.018, y: 0, zl: 0.0035, c: 0.014, t: 0.0018 }, { x: 0.025, y: 0.0002, zl: 0.0105, c: 0.0065, t: 0.0009 }]);
    K.mir(X.H, W.geo); K.mir(X.A, W.patch(0.15, 1.95, 0, 0.09, 1, 0.00004)); for (const h of [1, -1]) { K.mir(X.H2, W.patch(0.1, 1, 0.68, 1, h, 0.00004)); K.mir(X.H2, W.patch(1.05, 1.95, 0.7, 1, h, 0.00004)); }
    for (const [u0, u1, f] of [[0.1, 1, 0.68], [1.05, 1.95, 0.7], [0.15, 1.95, 0.3]]) K.mir(X.D, W.patch(u0, u1, f, f + 0.014, 1, 0.00005)); K.mir(X.D, W.patch(1, 1.04, 0.68, 1, 1, 0.00005)); wRiv(K, W, X.D, 0.12, 1.9, 0.5, 9, 0.00028); wRiv(K, W, X.D, 0.2, 1.7, 0.2, 7, 0.00028);
    for (const sx of [-1, 1]) body(K, X, [[0.011, 0.0042, 0.004, 0.004, 2.6, 0, sx * 0.0062], [0.015, 0.0056, 0.0054, 0.0054, 2.3, 0, sx * 0.0062], [0.0232, 0.006, 0.0058, 0.0058, 2, 0, sx * 0.0062]], { seg: 16 }); // cajas de los motores gigantes
    for (const z of [0.0165, 0.0205]) K.mir(X.D, new THREE.TorusGeometry(0.0059, 0.00022, 4, 20), [0.0062, 0, z]); K.mir(X.A, new THREE.TorusGeometry(0.0057, 0.0003, 4, 20), [0.0062, 0, 0.0128]);
    body(K, X, [[0.0035, 0.0005, 0.0005, 0.0005, 2, 0], [0.005, 0.0013, 0.0013, 0.0013, 2.2, 0], [0.0118, 0.0013, 0.0013, 0.0013, 2.2, 0], [0.0135, 0.0005, 0.0005, 0.0005, 2, 0]], { p: [0.0258, 0.0003, 0], mir: true, seg: 8 }); K.add(LR, ball3(0.0007), [-0.0258, 0.0003, 0.0038]); K.add(LG, ball3(0.0007), [0.0258, 0.0003, 0.0038]);
    rivets(K, X.D, [0.0045, 0.0069, -0.024], [0.0052, 0.0069, 0.022], 12, 0.00034); hatch(K, X, 0.0072, 0.0074, 0.0175, 0.0034, 0.0028); hatch(K, X, 0.0072, 0.0074, 0.0085, 0.0028, 0.0024); mast(K, X, -0.0075, 0.0076, 0.02, 0.0034, -0.2, LW); mast(K, X, 0.0075, 0.0076, -0.02, 0.003, 0.2, LG);
    wIns(K, W, 1.3, 0.5, 0.0016);
    return { eng: [-1, 1].map(s => ({ x: s * 0.0062, y: 0, z: 0.0246, r: 0.005 })), noses: [[-0.0028, -0.0026, -0.0266], [0.0028, -0.0026, -0.0266]], nose: [0, -0.0026, -0.0266], ns: 1.3,
      guns: [[-0.0136, -0.0018, -0.0035], [0.0136, -0.0018, -0.0035], [-0.0195, -0.0016, 0.0025], [0.0195, -0.0016, 0.0025]],
      py: { x0: 0.0152, dx: 0.0024, cols: 3, y: -0.0029, dy: 0.04, z: 0.0035, dz: 0.4, rz: 0.005 }, sh: { y: 0, z: -0.006, r: 0.04 }, shE: [0, -0.0004, -0.0232], ar: { w: 0.0084, y: 0.0078, z0: -0.016, z1: 0.018 },
      gear: { top: -0.0042, legs: [[-0.007, 0.009], [0.007, 0.009], [0, -0.016, 1]] }, dc: { wing: W, S, ring: [-0.006, 0.0025] } };
  },
};

  // ---------- pintura de las skins: franjas (rol P) sobre las alas y anillos en el fuselaje según el patrón; cada chasis aporta sus anclajes en dc ({wing: ala principal, S: secciones del fuselaje, ring: tramo libre}) ----------
  const PATS = { // w: [tramo de envergadura 0-1 (inicio, fin), tramo de cuerda 0-1 (borde de ataque → fuga)] · r: tramos (0-1) del segmento libre del fuselaje
    bands: { w: [[0.40, 0.56, 0, 1]], r: [[0, 0.45]] },
    tips: { w: [[0.78, 1, 0, 1]], r: [[0.55, 1]] },
    stripe: { w: [[0.06, 1, 0.10, 0.26]], r: [[0.35, 0.6]] },
    chevron: { w: [[0.30, 0.40, 0, 1], [0.55, 0.65, 0, 1]], r: [[0, 0.3], [0.6, 0.9]] },
  };
  const PAINT = new Map(); // (chasis + patrón) → [['P', geometría]]: se comparte entre todas las naves con esa skin
  function paintParts(t, pat, dc) {
    const key = t + '|' + pat, hit = PAINT.get(key); if (hit) return hit;
    const K = skit(), Pt = PATS[pat];
    if (dc.wing) { const W = dc.wing, n = W.S.length - 1; for (const [t0, t1, c0, c1] of Pt.w) for (const h of [1, -1]) K.mir('P', W.patch(t0 * n, t1 * n, c0, c1, h, 0.00006)); }
    if (dc.S) for (const [f0, f1] of Pt.r) { const z0 = dc.ring[0] + (dc.ring[1] - dc.ring[0]) * f0, z1 = dc.ring[0] + (dc.ring[1] - dc.ring[0]) * f1; bandK(K, 'P', dc.S, z0, z1, 1.014, 14); }
    const out = K.parts(); PAINT.set(key, out); return out;
  }

  // ---------- ensamblado: geometría en caché por (tipo + mejoras); cada nave solo añade meshes, llamas y materiales propios ----------
  const fade = (g, len, pw) => { const p = g.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const k = Math.pow(Math.max(0, 1 - p.getZ(i) / len), pw); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }; // degradado de la llama: brillante en la tobera, se apaga en la punta
  const FL1 = fade(new THREE.ConeGeometry(1, 1, 12).rotateX(PI / 2).translate(0, 0, 0.5), 1, 1.1), FL2 = fade(new THREE.ConeGeometry(0.53, 0.62, 10).rotateX(PI / 2).translate(0, 0, 0.31), 0.62, 0.8); // llamas unitarias: se escalan por motor
  const glowMat = (c, op) => new THREE.MeshBasicMaterial({ vertexColors: true, color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
  const GEARP = new Map(); // tren de aterrizaje por chasis (solo visible con la nave estacionada): patas con amortiguador, ruedas gemelas con cubo, puertas y riostras
  const gearParts = (t, g) => GEARP.get(t) || (GEARP.set(t, (() => {
    const K = skit(), top = g.top, L = top + 0.0058, cy = (top - 0.0058) / 2;
    for (const [x, z, nose] of g.legs) {
      const sg = x >= 0 ? 1 : -1;
      K.add('MT', new THREE.CylinderGeometry(0.00042, 0.00052, L, 8), [x, cy, z]); K.add('D', new THREE.CylinderGeometry(0.00027, 0.00027, L * 0.5, 6), [x, top - L * 0.72, z]);
      K.add('D', bx(0.0016, 0.00014, 0.0030), [x, top + 0.00008, z]); K.add('H2', bx(0.0009, 0.0006, 0.0014), [x, top - 0.0004, z]); K.add('MT', new THREE.CylinderGeometry(0.00016, 0.00016, 0.0034, 5), [x - sg * 0.0007, top - L * 0.36, z - 0.0009], [0.42, 0, sg * 0.3]);
      K.add('MT', new THREE.CylinderGeometry(0.00011, 0.00011, nose ? 0.0011 : 0.0024, 6), [x, -0.0060, z], [0, 0, PI / 2]);
      for (const wx of nose ? [x] : [x - 0.00072, x + 0.00072]) { K.add('D', new THREE.CylinderGeometry(0.0015, 0.0015, 0.0006, 12), [wx, -0.0060, z], [0, 0, PI / 2]); K.add('H2', new THREE.CylinderGeometry(0.00082, 0.00082, 0.00068, 8), [wx, -0.0060, z], [0, 0, PI / 2]); }
      K.add('D', bx(0.0002, 0.0010, 0.0002), [x + sg * (nose ? 0.0005 : 0.0011), -0.0046, z + 0.0004]);
    }
    return K.parts();
  })()), GEARP.get(t));
  const GEO = new Map();
  function nozzle(K, e, r, en) { // tobera: collar oscuro, aro de garganta al rojo, campana de pétalos solapados con actuadores, interior emisivo en degradado (rojo oscuro → blanco caliente) y aro de color
    const { x, y, z } = e, at = [x, y, z];
    K.add('D', new THREE.CylinderGeometry(r * 1.16, r * 1.06, 0.0009, 16, 1, true).rotateX(PI / 2), [x, y, z - 0.0009]); // collar: tubo abierto (deja ver el interior de la tobera)
    K.add('MT', latheG([[r * 0.74, -0.0013], [r * 0.84, -0.0004], [r * 0.96, 0.0007], [r * 1.04, 0.0013]], 1, 1, 20), at);
    K.add('NZ', latheC([[r * 0.97, 0.0012], [r * 0.72, 0.0003], [r * 0.46, -0.0006], [r * 0.28, -0.0013]], [0x7a2a0a, 0xd45e18, 0xffb040, 0xfff2d0], 18), at);
    K.add('NZ', discC(r * 0.28, 0xffffff, 12), [x, y, z - 0.0013]);
    K.addr('NZ', 0x8a5a30, new THREE.TorusGeometry(r * 0.86, r * 0.05, 4, 18), [x, y, z - 0.0003]); K.add('D', new THREE.TorusGeometry(r * 0.97, r * 0.05, 4, 18), [x, y, z + 0.0007]); K.add('A', new THREE.TorusGeometry(r * 1.03, r * 0.07, 4, 18), [x, y, z + 0.0013]);
    const pg = bx(r * 0.32, 0.0001, 0.0018).rotateX(0.05);
    for (let i = 0; i < 12; i++) { const a = i * PI / 6, rr = r * (i % 2 ? 1.0 : 1.05); K.add('MT', pg, [x + Math.cos(a) * rr, y + Math.sin(a) * rr, z + 0.0002], [0, 0, a - PI / 2]); } // pétalos de la campana
    for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2; K.add('D', cylZ(0.00011, 0.00011, 0.002, 4), [x + Math.cos(a) * r * 1.12, y + Math.sin(a) * r * 1.12, z - 0.0002]); } // actuadores
    if (en >= 1) K.add('EG', new THREE.TorusGeometry(r * 1.08, r * 0.09, 6, 14), [x, y, z + 0.0006]);
  }
  function gun(K, x, y, z, s = 1) { // cañón de plasma bajo el ala: montura, recámara con caja de munición, camisa ventilada con aletas, bobinas brillantes, freno de boca y emisor · boca en z - 0,0093·s
    const sg = x >= 0 ? 1 : -1;
    K.add('D', bx(0.0006 * s, 0.001, 0.0022 * s), [x, y + 0.001, z + 0.0002]); K.add('A', bx(0.0016 * s, 0.0014 * s, 0.0038 * s), [x, y, z]); K.add('D', bx(0.0011 * s, 0.0004, 0.0026 * s), [x, y + 0.0009 * s, z + 0.0003]);
    K.add('H2', bx(0.0007 * s, 0.0009 * s, 0.0016 * s), [x + sg * 0.0012 * s, y - 0.0002, z + 0.0006]); // caja de munición hacia fuera
    K.add('MT', cylZ(0.00055 * s, 0.00055 * s, 0.0075 * s, 8), [x, y, z - 0.0055 * s]); K.add('H2', cylZ(0.0008 * s, 0.0008 * s, 0.0026 * s, 10), [x, y, z - 0.0032 * s]); K.add('D', cylZ(0.0008 * s, 0.0008 * s, 0.001 * s, 8), [x, y, z - 0.0086 * s]); K.add('LT', ball3(0.0007 * s), [x, y, z - 0.0093 * s]);
    for (const k of [-0.003, -0.0045, -0.006]) K.add('GL', new THREE.TorusGeometry(0.00072 * s, 0.00012, 4, 10), [x, y, z + k * s]);
    for (const k of [-0.0022, -0.0038, -0.0054, -0.007]) K.add('D', cylZ(0.00073 * s, 0.00073 * s, 0.00022, 8), [x, y, z + k * s]);
    for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2; K.add('MT', bx(0.00012 * s, 0.00032 * s, 0.0011 * s), [x + Math.cos(a) * 0.0006 * s, y + Math.sin(a) * 0.0006 * s, z - 0.0088 * s], [0, 0, a - PI / 2]); } // freno de boca
  }
  function noseGun(K, p, s = 1) { // cañón de proa: cañón con camisa, aletas y freno de boca · boca en p.z - 0,003
    const [x, y, z] = p;
    K.add('MT', cylZ(0.0005 * s, 0.0006 * s, 0.005 * s, 8), p); K.add('H2', cylZ(0.0007 * s, 0.0007 * s, 0.0019 * s, 10), [x, y, z + 0.0012 * s]); K.add('D', cylZ(0.00075 * s, 0.00075 * s, 0.0009 * s, 8), [x, y, z - 0.0026 * s]); K.add('D', cylZ(0.0007 * s, 0.0007 * s, 0.0004 * s, 8), [x, y, z - 0.0006 * s]);
    for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2; K.add('MT', bx(0.0001 * s, 0.0003 * s, 0.001 * s), [x + Math.cos(a) * 0.00058 * s, y + Math.sin(a) * 0.00058 * s, z - 0.0026 * s], [0, 0, a - PI / 2]); }
  }
  function pylon(K, x, y, z) { // pilón alar: plancha vertical, carril de lanzamiento, bloque de color, borde de ataque y patines de sujeción del misil
    K.add('D', bx(0.0005, 0.0018, 0.005), [x, y + 0.0011, z]); K.add('MT', bx(0.0011, 0.0003, 0.006), [x, y + 0.0001, z - 0.0002]); K.add('A', bx(0.00055, 0.0004, 0.0012), [x, y + 0.0018, z - 0.0018]); K.add('D', bx(0.0002, 0.0006, 0.0012), [x, y + 0.0004, z + 0.0018]);
    K.add('H2', new THREE.ConeGeometry(0.00026, 0.0012, 4).rotateX(-PI / 2), [x, y + 0.0011, z - 0.0032]);
    for (const sx of [-1, 1]) K.add('MT', bx(0.00012, 0.0004, 0.0004), [x + sx * 0.0006, y + 0.0004, z - 0.0016]);
  }
  const ARZ = [[0.28, 0.68], [0.08, 0.48, 0.88]]; // posición (fracción del tramo d.ar) de los anillos de blindaje de cada nivel
  function build(spec) {
    const key = spec.t + spec.a.join(''), hit = GEO.get(key); if (hit) { GEO.delete(key); GEO.set(key, hit); return hit; }
    const [ar, sh, pl, , en] = spec.a, st = statsOf(spec), K = skit(), d = BUILD[spec.t](K, X), muz = [], pyl = [];
    const eng = d.eng.map(e => ({ x: e.x, y: e.y, z: e.z, r: e.r * (1 + 0.12 * en) })); eng.forEach(e => nozzle(K, e, e.r, en));
    for (let l = 1; l <= ar; l++) { // placas de blindaje: anillos segmentados de placas con cantos metálicos que abrazan el fuselaje (cada nivel añade más)
      const S = d.dc.S, z0 = d.ar.z0, z1 = d.ar.z1, lw = (z1 - z0) * 0.11, k = 1.05 + 0.012 * l;
      for (const f of ARZ[l - 1]) { const zc = z0 + (z1 - z0) * f; bandK(K, 'AR', S, zc - lw / 2, zc + lw / 2, k, 12); bandK(K, 'MT', S, zc - lw / 2 - 0.00025, zc - lw / 2, k + 0.008, 12); bandK(K, 'MT', S, zc + lw / 2, zc + lw / 2 + 0.00025, k + 0.008, 12); if (l === 2) bandK(K, 'A', S, zc - 0.0001, zc + 0.0001, k + 0.014, 12); }
    }
    for (const p of d.noses || [d.nose]) { noseGun(K, p, d.ns || 1); muz.push([p[0], p[1], p[2] - 0.003]); } // cañón(es) central(es) siempre
    const gs = d.gs || 1;
    for (let i = 0; i < (pl >= 2 ? 4 : pl >= 1 ? 2 : 0); i++) { const [x, y, z] = d.guns[i]; gun(K, x, y, z, gs); muz.push([x, y, z - 0.0093 * gs]); }
    for (let i = 0; i < st.missiles; i++) { // pilones (el misil de cada uno es una instancia del mesh de misiles)
      const P = d.py, side = i % 2 ? 1 : -1, n = i >> 1, cols = P.cols || 99, ax = P.x0 + (n % cols) * P.dx, row = (n / cols) | 0, x = side * ax, y = P.y + (P.dy || 0) * (ax - P.x0), z = P.z + (P.dz || 0) * (ax - P.x0) + row * (P.rz || 0.0056);
      pylon(K, x, y, z); pyl.push([x, y - 0.0006, z]);
    }
    if (sh > 0) { const q = d.shE || [d.nose[0], d.nose[1] - 0.0012, d.nose[2] + 0.004]; K.add('MT', new THREE.CylinderGeometry(0.0011, 0.0019, 0.001, 10).rotateX(PI / 2), q); } // emisor del escudo (el resplandor solo aparece al recibir daño)
    const out = { parts: K.parts(), muz, pyl, eng, dc: d.dc, gear: d.gear }; GEO.set(key, out);
    if (GEO.size > 36) { const [k0, v0] = GEO.entries().next().value; GEO.delete(k0); v0.parts.forEach(([, g]) => g.dispose()); } // caché limitada: al expulsar una entrada se libera su geometría en GPU (si vuelve a usarse se re-sube sola)
    return out;
  }
  function make(spec, hullOverride) {
    spec = validSpec(spec);
    const T = TYPES[spec.t], st = statsOf(spec), sh = spec.a[1], root = new THREE.Group(), m = new THREE.Group(), B = build(spec), SKN = hullOverride === undefined ? SKINS[spec.sk] : null, MX = getMats(hullOverride ?? SKINS[spec.sk].hull, spec.c, SKN ? spec.sk : -1);
    m.scale.setScalar(T.size); root.add(m);
    const at = ([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(T.size);
    Object.assign(root, { muzzles: B.muz.map(at), pylons: B.pyl.map(at), missiles: [], flames: [], shieldFx: [], flameMul: st.flameMul });
    const fx = { stw: new THREE.MeshBasicMaterial({ color: 0xffffff }), str: new THREE.MeshBasicMaterial({ color: 0xff3030 }), nz: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), ph: Math.random() * 1500, msl: null, idle: hullOverride === undefined ? 0.3 : 0.08 }; // idle: brillo del interior de la tobera con el motor parado (casco a la deriva: apagado)
    const PM = { STW: fx.stw, STR: fx.str, NZ: fx.nz }, hullMs = [];
    for (const [role, geo] of B.parts) { const ms = new THREE.Mesh(geo, PM[role] || MX[role]); m.add(ms); hullMs.push(ms); } // ~12 meshes por casco
    if (SKN && SKN.pat && B.dc) for (const [, geo] of paintParts(spec.t, SKN.pat, B.dc)) m.add(new THREE.Mesh(geo, MX.P)); // pintura de la skin: 1 mesh más (no entra en la malla del escudo)
    const f1 = glowMat(0x4fb4ff, 0.55), f2 = glowMat(0xffffff, 0.95);
    B.eng.forEach(e => { const L = e.r * 7.6, fl = new THREE.Group(), a = new THREE.Mesh(FL1, f1), b = new THREE.Mesh(FL2, f2); a.scale.set(e.r, e.r, L); b.scale.set(e.r, e.r, L); fl.position.set(e.x, e.y, e.z + 0.0011); fl.add(a, b); m.add(fl); root.flames.push(fl); }); // motores: llama doble
    if (B.pyl.length) { const im = new THREE.InstancedMesh(MSLG, mslMat(), B.pyl.length); B.pyl.forEach((p, i) => { im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2])); root.missiles.push({ visible: true }); }); im.frustumCulled = false; m.add(im); fx.msl = im; } // todos los misiles = 1 draw call
    root.shell = new THREE.Group(); { const bb = new THREE.Box3(); hullMs.forEach(ms => { ms.geometry.computeBoundingBox(); bb.union(ms.geometry.boundingBox); }); const c = bb.getCenter(new THREE.Vector3()); root.shell.scale.setScalar(1.14); root.shell.position.copy(c).multiplyScalar(1 - 1.14); // mallas del casco: el escudo las repite un poco más grandes para conservar la silueta
      const sm1 = new THREE.MeshBasicMaterial({ color: 0x55c8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), sm2 = new THREE.MeshBasicMaterial({ color: 0xbff4ff, wireframe: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      hullMs.forEach(ms => { root.shell.add(new THREE.Mesh(ms.geometry, sm1), new THREE.Mesh(ms.geometry, sm2)); }); root.shellMats = [sm1, sm2]; }
    root.shell.visible = false; m.add(root.shell); root.shieldLv = sh;
    root.gear = new THREE.Group(); root.gearH = 0.0064 * T.size; for (const [role, geo] of gearParts(spec.t, B.gear)) root.gear.add(new THREE.Mesh(geo, MX[role])); root.gear.visible = false; m.add(root.gear);
    root.fx = fx; return root;
  }

  const FL_BLUE = new THREE.Color(0x4fb4ff), FL_YEL = new THREE.Color(0xffa41a), IN_W = new THREE.Color(0xffffff), IN_Y = new THREE.Color(0xffe58a);
  return {
    make, tex: tx, skit, LIGHTS, // tex/skit/LIGHTS: texturas procedurales y utilidades compartidas con models.js y base.js
    setThrust(sh, v, t) { // llama proporcional a la velocidad, con parpadeo; el interior de la tobera se enciende con el empuje
      const on = v > 0.05; if (sh.fx) sh.fx.nz.color.setScalar(on ? Math.min(1.25, 0.6 + 0.35 * Math.log10(1 + v)) : sh.fx.idle); sh.flames.forEach(f => f.visible = on); if (!on) return;
      const k = (0.5 + Math.min(2.2, Math.log10(1 + v) / 2.3)) * sh.flameMul;
      for (const f of sh.flames) f.scale.set(0.85 + Math.random() * 0.3, 0.85 + Math.random() * 0.3, k * (0.85 + 0.3 * Math.random() + 0.1 * Math.sin(t / 40)));
    },
    setFlameHeat(sh, k) { for (const f of sh.flames) { f.children[0].material.color.copy(FL_BLUE).lerp(FL_YEL, k); f.children[1].material.color.copy(IN_W).lerp(IN_Y, k); } },
    fx(sh, t, missilesLeft) { // luces de posición fijas y estroboscopios (blanco doble destello / baliza roja); misiles que desaparecen del pilón al dispararse
      const f = sh.fx; if (f) { const p = (t + f.ph) % 1500, q = (t + f.ph + 700) % 2000; f.stw.color.setScalar(p < 90 || (p > 190 && p < 280) ? 1 : 0.1); f.str.color.setRGB(q < 140 ? 1 : 0.15, q < 140 ? 0.19 : 0.03, q < 140 ? 0.19 : 0.03); }
      if (missilesLeft !== undefined) { const n = Math.max(0, missilesLeft); sh.missiles.forEach((m, i) => m.visible = i < n); if (f && f.msl) { f.msl.count = Math.min(sh.missiles.length, n); f.msl.visible = f.msl.count > 0; } }
    },
  };
})();

function makeShip(spec, hullOverride) { return SHIPGFX.make(spec, hullOverride); } // NO se añade a la escena: lo hace quien lo llama
function setThrust(sh, v, t) { SHIPGFX.setThrust(sh, v, t); }
function setFlameHeat(sh, k) { SHIPGFX.setFlameHeat(sh, k); } // combustión dentro de la atmósfera (impulso): la llama pasa de azul a amarillo anaranjado
function setShieldFlash(sh, k) { // escudo alrededor de toda la nave (misma silueta): solo se ve al recibir daño de otra nave
  if (!sh.shell) return; const on = k > 0.01 && sh.shieldLv > 0; sh.shell.visible = on; if (on) { sh.shellMats[0].opacity = Math.min(0.5, k * 0.4); sh.shellMats[1].opacity = Math.min(0.85, k * 0.8); }
}
function updateShipFx(sh, t, missilesLeft) { // en la vista previa el escudo late suavemente
  if (sh.showShield) setShieldFlash(sh, 0.55 + 0.25 * Math.sin(t / 320));
  SHIPGFX.fx(sh, t, missilesLeft);
}
