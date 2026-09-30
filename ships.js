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

function validSpec(s) {
  const t = TYPES[s && s.t] ? s.t : 'halcon', T = TYPES[t];
  const a = ADDONS.map((d, i) => Math.max(0, Math.min(d.max, Math.round(Number(s && s.a && s.a[i]) || 0))));
  return { t, a, c: Number.isFinite(s && s.c) ? (s.c >>> 0) & 0xffffff : 0x4db8ff };
}
function statsOf(spec, lvA) { // lvA: puntos de nivel asignados a cada característica de LV_STATS (cada punto = +2 % del valor BASE del chasis)
  const T = TYPES[spec.t], [ar, sh, pl, mi, en, am = 0] = spec.a, [bv = 0, bh = 0, bs = 0, bd = 0, ba = 0, br = 0, bp = 0, bw = 0] = lvA || [];
  return { hp: T.hp + 30 * ar + Math.round(T.hp * LV_K * bh), sh: T.sh + 40 * sh + Math.round(T.sh * LV_K * bs), plasma: T.plasma + 60 * am + Math.round(T.plasma * LV_K * bp), pdmg: Math.round((CH_DMG * (1 + LV_K * bd) + 2 * pl) * 10) / 10, missiles: T.missiles + 2 * mi + am, flameMul: 1 + 0.3 * en, pitch: 1 - 0.1 * en, agil: Math.round(T.agil * (1 + LV_K * ba) * 100) / 100, vmax: Math.min(1500, Math.round(T.speed * (1 + 0.1 * en))) + Math.round(T.speed * LV_K * bv), warp: Math.round(T.warp * (1 + 0.5 * en)) + Math.round(T.warp * LV_K * bw), regen: CH_REGEN / (1 + LV_K * br) }; // regen: segundos por unidad de plasma recargada
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
const SHIP_COST = { halcon: null, saeta: { piedra: 12, cobre: 6 }, coloso: { plata: 12, oro: 6 }, nomada: { oro: 8, diamante: 3 } }; // cambiar de nave: se desbloquea una vez con recursos
const upgradeCost = (i, lv) => UPGRADE_COST[i](lv + 1);
const basicSpec = c => ({ t: 'halcon', a: [0, 0, 0, 0, 0, 0], c: Number.isFinite(c) ? c : 0x4db8ff }); // todos empiezan con una nave básica
function loadSpec() { try { return validSpec(JSON.parse(localStorage.getItem('spec'))); } catch { return validSpec(null); } }
function saveSpec(s) { try { localStorage.setItem('spec', JSON.stringify(s)); } catch {} }

// ---------- utilidades compartidas con base.js (kit de piezas fusionadas por material) ----------
const stdMat = (c, ei = 0.3, m = 0.2, r = 0.5) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r, emissive: c, emissiveIntensity: ei, side: THREE.DoubleSide }); // emisivo = visible en la sombra
const M = (g, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); return m; };
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylZ = (rt, rb, len, seg = 12) => new THREE.CylinderGeometry(rt, rb, len, seg).rotateX(PI / 2); // rt = radio trasero (+z)
const ball3 = r => new THREE.SphereGeometry(r, 8, 6);
const nav = c => new THREE.MeshBasicMaterial({ color: c });
// Fusión de geometrías: cada nave acumula sus piezas por material y las une en UN mesh por material (unos 8 meshes por casco en vez de cientos).
const FLIPX = new THREE.Matrix4().makeScale(-1, 1, 1);
function mergeGeos(list) { // list: [[geometría, matriz]]; los espejos invierten el orden de los triángulos para conservar las caras
  const parts = list.map(([g, m]) => { const x = g.index ? g.toNonIndexed() : g.clone(); x.applyMatrix4(m); return [x, m.determinant() < 0]; });
  let n = 0; for (const [x] of parts) n += x.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
  for (const [x, fl] of parts) {
    const pa = x.attributes.position.array, na = x.attributes.normal.array; P.set(pa, o * 3); N.set(na, o * 3);
    if (fl) for (let t = 0; t < pa.length / 9; t++) { const b = o * 3 + t * 9; for (let k = 0; k < 3; k++) { let a = P[b + 3 + k]; P[b + 3 + k] = P[b + 6 + k]; P[b + 6 + k] = a; a = N[b + 3 + k]; N[b + 3 + k] = N[b + 6 + k]; N[b + 6 + k] = a; } }
    o += x.attributes.position.count; x.dispose();
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); return out;
}
function kit() { // add(mat, geo, pos, rot, scale) · mir(...) añade también la copia espejada en x
  const map = new Map(), put = (mat, g, p, r, s, f) => { const m4 = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)); if (f) m4.premultiply(FLIPX); if (!map.has(mat)) map.set(mat, []); map.get(mat).push([g, m4]); };
  return {
    add: (mat, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => put(mat, g, p, r, s, false),
    mir: (mat, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { put(mat, g, p, r, s, false); put(mat, g, p, r, s, true); },
    parts: () => [...map].map(([mat, list]) => [mat, mergeGeos(list)]),
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
  const TX = {}, tx = k => TX[k] || (TX[k] = k === 'hull' ? mkTex(hullCanvas()) : k === 'metal' ? mkTex(metalCanvas()) : k === 'glass' ? mkTex(glassCanvas(), false) : k === 'pv' ? mkTex(pvCanvas(), false) : (() => { const t = new THREE.CanvasTexture(envCanvas()); t.mapping = THREE.EquirectangularReflectionMapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t; })());

  // ---------- materiales compartidos (caché por color de casco y de acento) ----------
  const LIGHTS = new THREE.MeshBasicMaterial({ vertexColors: true }), GLW = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const MATS = new Map();
  function getMats(hullC, accC) {
    const key = hullC + '|' + accC, hit = MATS.get(key); if (hit) return hit; if (MATS.size > 40) MATS.clear();
    const hc = new THREE.Color(hullC).multiplyScalar(1.14), ac = new THREE.Color(accC), HT = tx('hull'), MX = tx('metal'), env = tx('env');
    const std = o => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMap: env, ...o });
    const hull = (c, ei = 0.12) => std({ color: c, map: HT, metalness: 0.3, roughness: 0.52, emissive: c, emissiveIntensity: ei, envMapIntensity: 0.9 });
    const d = new THREE.Color(0x232830), mt = new THREE.Color(0x8b949e);
    const out = {
      H: hull(hc), H2: hull(hc.clone().multiplyScalar(0.58), 0.1),
      A: std({ color: ac, map: HT, metalness: 0.3, roughness: 0.42, emissive: ac, emissiveIntensity: 0.34, envMapIntensity: 0.7 }),
      D: std({ color: d, map: MX, metalness: 0.65, roughness: 0.55, emissive: d, emissiveIntensity: 0.1, envMapIntensity: 0.6 }),
      MT: std({ color: mt, map: MX, metalness: 0.9, roughness: 0.34, emissive: mt, emissiveIntensity: 0.07, envMapIntensity: 1.0 }),
      AR: std({ color: 0x59616b, map: HT, metalness: 0.5, roughness: 0.5, emissive: 0x59616b, emissiveIntensity: 0.1, envMapIntensity: 0.8 }),
      G: std({ color: 0xd8f2ff, map: tx('glass'), transparent: true, opacity: 0.8, metalness: 0.55, roughness: 0.07, emissive: 0x0a4560, emissiveIntensity: 0.55, envMapIntensity: 1.7 }),
      PV: std({ color: 0xffffff, map: tx('pv'), metalness: 0.6, roughness: 0.3, emissive: 0x143070, emissiveIntensity: 0.4, envMapIntensity: 1.3 }),
      LIGHTS, GLW,
    };
    MATS.set(key, out); return out;
  }

  // ---------- fusión de geometría con UVs proyectadas y colores por vértice ----------
  const UV_ROLES = new Set(['H', 'H2', 'A', 'D', 'MT', 'AR', 'G', 'PV']);
  function merge(list, wantUv) { // list: [[geo, matriz, color|null, modo uv]]; los espejos invierten el orden de los triángulos
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
            if (p.uvm === 'cyl') { u = Math.atan2(py, px) * UV_R; v = pz / TILE; }
            else if (ax >= ay && ax >= az) { u = pz / TILE; v = py / TILE; } else if (ay >= az) { u = X / TILE; v = pz / TILE; } else { u = X / TILE; v = py / TILE; }
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
  function skit() { // add(rol, geo, pos, rot, scale) · mir(...) añade también la copia espejada en x · addc(color, ...) piezas de un solo mesh con color por vértice
    const map = new Map(), put = (role, g, p, r, s, f, col) => {
      const al = ROLE_ALIAS[role]; if (al) { role = al[0]; col = al[1]; }
      const m4 = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)); if (f) m4.premultiply(FLIPX);
      if (!map.has(role)) map.set(role, []); map.get(role).push([g, m4, col || null, role === 'G' || role === 'PV' ? 'keep' : g.userData.uvm || 'box']);
    };
    return {
      add: (role, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => put(role, g, p, r, s, false),
      mir: (role, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { put(role, g, p, r, s, false); put(role, g, p, r, s, true); },
      addc: (col, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => put('MSL', g, p, r, s, false, CL(col)),
      parts: () => [...map].map(([role, list]) => [role, merge(list, UV_ROLES.has(role))]),
    };
  }

  // ---------- utilidades de modelado (mismas piezas de antes, ahora por rol de material) ----------
  const LR = 'LR', LG = 'LG', LW = 'LW', LY = 'LY', LT = 'LT', LC = 'LC', GL = 'GL', STW = 'STW', STR = 'STR';
  const X = { H: 'H', H2: 'H2', A: 'A', D: 'D', MT: 'MT', G: 'G', PV: 'PV' };
  const latheG = (pts, sx, sy, seg = 20, p0 = 0, pl = PI * 2) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, p0, pl).rotateX(PI / 2).scale(sx, sy, 1);
  const latheC = (pts, cols, seg = 18) => { const g = latheG(pts, 1, 1, seg), c = new Float32Array(g.attributes.position.count * 3), n = pts.length; for (let i = 0; i < c.length / 3; i++) { const k = CL(cols[i % n]); c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }; // lathe con un color por punto del perfil (degradado de la tobera)
  const discC = (r, col, seg = 14) => { const g = new THREE.CircleGeometry(r, seg), k = CL(col), c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = k.r; c[i + 1] = k.g; c[i + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const radAt = (P, z) => { for (let i = 1; i < P.length; i++) if (z <= P[i][1]) { const [r0, z0] = P[i - 1], [r1, z1] = P[i]; return r0 + (r1 - r0) * (z1 === z0 ? 0 : (z - z0) / (z1 - z0)); } return P[P.length - 1][0]; };
  function hull(K, X, P, sx, sy, seams = []) { // fuselaje de revolución: lomo claro, vientre oscuro (mapeado cilíndrico) y juntas de paneles cada cierto tramo
    const a = latheG(P, sx, sy, 22, PI / 2, PI), b = latheG(P, sx, sy, 22, -PI / 2, PI); a.userData.uvm = b.userData.uvm = 'cyl'; K.add(X.H, a); K.add(X.H2, b);
    seams.forEach(z => K.add(X.D, new THREE.TorusGeometry(radAt(P, z) * 1.012, 0.00016, 4, 26).scale(sx, sy, 1), [0, 0, z]));
  }
  const extrude = (pts, th, bev = 0.00035) => { const sh = new THREE.Shape(); pts.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y)); sh.closePath(); return new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 1 }).rotateX(PI / 2).translate(0, th / 2, 0); };
  const wing = (K, mat, pts, th, y = 0, bev) => K.mir(mat, extrude(pts, th, bev), [0, y, 0]); // ala en planta (x, z), espejada y con bordes biselados
  const strip = (K, mat, [x0, z0], [x1, z1], w, y, h = 0.00018) => K.mir(mat, bx(Math.hypot(x1 - x0, z1 - z0), h, w), [(x0 + x1) / 2, y, (z0 + z1) / 2], [0, -Math.atan2(z1 - z0, x1 - x0), 0]); // banda fina entre dos puntos
  const dots = (K, mat, [x0, y0, z0], [x1, y1, z1], n, s = 0.0003) => { const g = bx(s, s * 0.7, s); for (let i = 0; i < n; i++) { const t = n > 1 ? i / (n - 1) : 0; K.mir(mat, g, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t]); } }; // hilera de remaches
  const vents = (K, mat, x, y, z, n, dz, w, d, mir = true) => { const g = bx(w, 0.00014, d); for (let i = 0; i < n; i++) (mir ? K.mir : K.add)(mat, g, [x, y, z + i * dz]); }; // rejillas de ventilación
  const mast = (K, X, x, y, z, h, tilt = 0, tipMat = LR) => { K.add(X.MT, new THREE.CylinderGeometry(0.00009, 0.00014, h, 5), [x, y + h / 2, z], [0, 0, tilt]); K.add(tipMat === LW ? STW : tipMat === LR ? STR : tipMat, ball3(0.00028), [x - Math.sin(tilt) * h / 2, y + h / 2 + Math.cos(tilt) * h / 2 + 0.00005, z]); }; // antena con baliza intermitente en la punta
  function canopy(K, X, x, y, z, r, len, hgt = 0.9) { // cabina: cristal con marco, viga trasera, asiento y panel de instrumentos visibles por dentro, y destello
    K.add(X.G, new THREE.SphereGeometry(r, 16, 9, 0, PI * 2, 0, PI / 2), [x, y, z], [0, 0, 0], [1, hgt, len]);
    for (const k of [-0.5, 0.05, 0.55]) K.add(X.D, new THREE.TorusGeometry(r * Math.sqrt(1 - k * k) * 1.01, 0.00017, 4, 12, PI).scale(1, hgt, 1), [x, y, z + k * len * r]);
    K.add(X.D, bx(r * 1.9, 0.0003, r * 0.35), [x, y + 0.00005, z + len * r * 0.95]);
    K.add(X.D, bx(r * 0.7, r * hgt * 0.5, r * len * 0.3), [x, y + r * hgt * 0.24, z + r * len * 0.22]); K.add(X.H2, bx(r * 0.5, r * hgt * 0.34, r * len * 0.06), [x, y + r * hgt * 0.5, z + r * len * 0.06]); // asiento y reposacabezas
    K.add(LC, bx(r * 0.8, 0.00007, r * len * 0.2), [x, y + r * hgt * 0.16, z - r * len * 0.5], [0.35, 0, 0]); // pantalla del panel de instrumentos
    K.add(LW, bx(r * 0.22, 0.00008, r * len * 0.8), [x + r * 0.3, y + r * hgt * 0.93, z - r * len * 0.12], [0, 0, -0.25]);
  }
  function intake(K, X, x, y, z, w, h, d) { // toma de aire lateral: cuerpo, boca oscura y labio de color
    K.mir(X.H2, bx(w, h, d), [x, y, z + d / 2]); K.mir(X.D, bx(w * 0.7, h * 0.72, 0.0004), [x, y, z - 0.00005]); K.mir(X.A, bx(w * 1.06, h * 0.13, d * 0.35), [x, y + h * 0.5, z + d * 0.2]);
  }
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

// ---------- chasis: cada uno rellena el kit K con sus piezas y devuelve sus puntos de anclaje (motores, cañones, pilones, escudo, blindaje) ----------
const BUILD = {
  saeta(K, X) { // interceptor: aguja larga, canards y cola en V
    const P = [[0, -0.027], [0.0011, -0.023], [0.0028, -0.013], [0.0040, -0.002], [0.0043, 0.008], [0.0038, 0.016], [0.0028, 0.021], [0, 0.021]];
    hull(K, X, P, 1, 0.75, [-0.0195, -0.0125, -0.0045, 0.0035, 0.011, 0.0185]);
    K.add(X.D, latheG([[0, -0.0272], [0.00118, -0.0233], [0.00188, -0.0195]], 1, 0.75, 14)); K.add(X.A, new THREE.TorusGeometry(0.0019, 0.00019, 4, 16).scale(1, 0.75, 1), [0, 0, -0.0195]); // radomo oscuro y aro de color
    K.add(X.MT, cylZ(0.00028, 0.00013, 0.0058, 6), [0, 0, -0.0300]); K.add(LR, ball3(0.00026), [0, 0, -0.0330]); // sonda pitot
    canopy(K, X, 0, 0.0021, -0.0112, 0.0030, 2.7);
    K.add(X.H, bx(0.0015, 0.0009, 0.0115), [0, 0.0033, 0.0088]); K.add(X.A, bx(0.0005, 0.00014, 0.0100), [0, 0.00385, 0.0088]); vents(K, X.D, 0.0012, 0.0031, 0.0075, 4, 0.0018, 0.0006, 0.0008); // lomo con franja y rejillas
    wing(K, X.H, [[0.0035, -0.008], [0.021, 0.012], [0.021, 0.0155], [0.0035, 0.0125]], 0.0009, 0, 0.0003);
    strip(K, X.A, [0.0055, -0.0044], [0.0200, 0.0122], 0.0008, 0.00075); strip(K, X.H2, [0.0120, 0.0131], [0.0205, 0.0146], 0.0017, 0.00065); strip(K, X.D, [0.0120, 0.0121], [0.0120, 0.0142], 0.00015, 0.0007); strip(K, X.D, [0.0045, 0.0075], [0.0205, 0.0112], 0.00013, 0.0007); // franja del borde de ataque, alerón y juntas
    wing(K, X.A, [[0.002, -0.018], [0.009, -0.011], [0.009, -0.0095], [0.002, -0.0105]], 0.0007, 0, 0.0002); // canards
    K.mir(X.A, bx(0.0010, 0.0013, 0.0070), [0.0212, 0, 0.0132]); K.mir(X.D, bx(0.0012, 0.0004, 0.0030), [0.0212, 0.0008, 0.0100]); // raíl de la punta del ala
    for (const sx of [-1, 1]) K.add(sx < 0 ? LR : LG, ball3(0.0006), [sx * 0.0212, 0, 0.0074]);
    K.mir(X.H, bx(0.0007, 0.0095, 0.008), [0.0045, 0.0055, 0.0145], [0, 0, -0.5]); K.mir(X.A, bx(0.0008, 0.0022, 0.0060), [0.0067, 0.0093, 0.0152], [0, 0, -0.5]); K.mir(X.D, bx(0.00016, 0.0075, 0.00016), [0.0043, 0.0050, 0.0170], [0, 0, -0.5]); K.add(STW, ball3(0.00028), [0.0071, 0.0100, 0.0172]); K.add(STW, ball3(0.00028), [-0.0071, 0.0100, 0.0172]); // cola en V con timón y luz
    K.mir(X.D, bx(0.0005, 0.0030, 0.0060), [0.0030, -0.0034, 0.0120], [0, 0, 0.5]); // aletas ventrales
    intake(K, X, 0.0046, -0.0006, -0.0068, 0.0014, 0.0020, 0.0070);
    K.add(X.H2, cylZ(0.0036, 0.0042, 0.012), [0, 0, 0.015]); K.add(X.A, new THREE.TorusGeometry(0.0040, 0.00022, 4, 20), [0, 0, 0.0112]); K.add(X.D, new THREE.TorusGeometry(0.0038, 0.00016, 4, 20), [0, 0, 0.0155]); // caja del motor
    dots(K, X.D, [0.0022, 0.0022, -0.0040], [0.0026, 0.0018, 0.0090], 6, 0.00028); mast(K, X, 0, 0.0038, 0.0140, 0.0032, 0.15, LW);
    hatch(K, X, 0.0110, 0.00080, 0.0060, 0.0030, 0.0022); hatch(K, X, 0.0170, 0.00080, 0.0100, 0.0022, 0.0018); rcs(K, X, 0.0023, 0.0003, -0.0165); rcs(K, X, 0.0206, 0.0012, 0.0128, 0.8); mast(K, X, 0.0170, 0.0008, 0.0130, 0.0022, 0.3, LG); K.add(X.H2, new THREE.SphereGeometry(0.0009, 8, 5, 0, PI * 2, 0, PI / 2), [0, -0.0026, -0.0110], [PI, 0, 0]); dots(K, X.D, [0.0058, 0.0009, 0.0010], [0.0170, 0.0009, 0.0122], 6, 0.00022); // escotillas, propulsores de actitud, antena y sensor ventral
    return { eng: [{ x: 0, y: 0, z: 0.0205, r: 0.0038 }], nose: [0, -0.0012, -0.0245], guns: [[-0.008, -0.0008, -0.001], [0.008, -0.0008, -0.001], [-0.014, -0.0008, 0.005], [0.014, -0.0008, 0.005]],
      py: { x0: 0.005, dx: 0.003, y: -0.0026, z: 0.007 }, sh: { y: 0, z: -0.008, r: 0.030 }, ar: { w: 0.0043, y: 0.0033, z0: -0.012, z1: 0.016 } };
  },
  halcon(K, X) { // caza equilibrado: alas en delta con strakes y doble motor
    const P = [[0, -0.020], [0.0016, -0.0165], [0.0042, -0.009], [0.0060, 0], [0.0064, 0.008], [0.0056, 0.015], [0.0040, 0.019], [0, 0.019]];
    hull(K, X, P, 1, 0.72, [-0.0125, -0.0075, -0.002, 0.0035, 0.009, 0.0145]);
    K.add(X.D, latheG([[0, -0.0203], [0.0017, -0.0166], [0.00335, -0.0120]], 1, 0.72, 14)); K.add(X.A, new THREE.TorusGeometry(0.00338, 0.0002, 4, 16).scale(1, 0.72, 1), [0, 0, -0.0120]); K.add(X.MT, cylZ(0.00012, 0.00024, 0.0035, 6), [0, 0, -0.0218]);
    canopy(K, X, 0, 0.0029, -0.0055, 0.0038, 2.3);
    K.add(X.H, bx(0.0020, 0.0009, 0.0125), [0, 0.0043, 0.0060]); K.add(X.A, bx(0.0006, 0.00014, 0.0110), [0, 0.00490, 0.0060]); vents(K, X.D, 0.0014, 0.0043, 0.0035, 4, 0.0022, 0.0007, 0.0009); // lomo dorsal
    wing(K, X.H, [[0.004, -0.006], [0.028, 0.013], [0.028, 0.017], [0.004, 0.014]], 0.0012, 0, 0.0004);
    wing(K, X.H, [[0.0035, -0.0125], [0.0100, -0.0013], [0.0035, -0.0010]], 0.0008, 0, 0.0003); // strakes
    strip(K, X.A, [0.0100, 0.0003], [0.0265, 0.0134], 0.0010, 0.0009); strip(K, X.H2, [0.0085, 0.0135], [0.0165, 0.0146], 0.0022, 0.0008); strip(K, X.A, [0.0180, 0.0146], [0.0272, 0.0158], 0.0020, 0.0008);
    strip(K, X.D, [0.0085, 0.0125], [0.0085, 0.0148], 0.00015, 0.0008); strip(K, X.D, [0.0172, 0.0140], [0.0172, 0.0160], 0.00015, 0.0008); strip(K, X.D, [0.0050, 0.0070], [0.0276, 0.0130], 0.00014, 0.0008); // flap, alerón y juntas
    K.mir(X.A, bx(0.0022, 0.0018, 0.0090), [0.0280, 0, 0.0135]); K.mir(X.D, bx(0.0024, 0.0004, 0.0040), [0.0280, 0.0010, 0.0100]);
    for (const sx of [-1, 1]) K.add(sx < 0 ? LR : LG, ball3(0.0007), [sx * 0.0281, 0, 0.0062]);
    K.mir(X.H, bx(0.0008, 0.008, 0.009), [0.005, 0.005, 0.012], [0, 0, -0.35]); K.mir(X.A, bx(0.0009, 0.0024, 0.0060), [0.0068, 0.0086, 0.0135], [0, 0, -0.35]); K.mir(X.D, bx(0.00016, 0.0065, 0.00016), [0.0052, 0.0048, 0.0165], [0, 0, -0.35]); K.add(STW, ball3(0.0003), [0.0070, 0.0090, 0.0155]); K.add(STW, ball3(0.0003), [-0.0070, 0.0090, 0.0155]);
    K.mir(X.H2, cylZ(0.0034, 0.0042, 0.014), [0.0085, -0.0005, 0.011]); K.mir(X.A, new THREE.TorusGeometry(0.0038, 0.00022, 4, 18), [0.0085, -0.0005, 0.0075]); K.mir(X.D, new THREE.TorusGeometry(0.0036, 0.00016, 4, 18), [0.0085, -0.0005, 0.0148]); // góndolas de los motores
    intake(K, X, 0.0062, -0.0007, -0.0075, 0.0013, 0.0018, 0.0068); K.mir(X.MT, bx(0.0011, 0.0016, 0.0020), [0.0085, -0.0025, 0.0100]);
    dots(K, X.D, [0.0026, 0.0038, -0.0090], [0.0034, 0.0034, 0.0080], 7, 0.0003); mast(K, X, 0.0018, 0.0048, 0.0130, 0.0030, 0.1, LW);
    hatch(K, X, 0.0170, 0.00110, 0.0095, 0.0040, 0.0032); hatch(K, X, 0.0235, 0.00110, 0.0110, 0.0030, 0.0026); rcs(K, X, 0.0031, 0.0005, -0.0135); rcs(K, X, 0.0276, 0.0016, 0.0066, 0.9); mast(K, X, 0.0210, 0.0010, 0.0155, 0.0024, 0.3, LR); mast(K, X, -0.0060, 0.0044, 0.0120, 0.0028, -0.2, LG); dots(K, X.D, [0.0100, 0.0011, 0.0040], [0.0250, 0.0011, 0.0118], 7, 0.00024); // escotillas, RCS y antenas
    return { eng: [-1, 1].map(s => ({ x: s * 0.0085, y: -0.0005, z: 0.0187, r: 0.0034 })), nose: [0, -0.0016, -0.0185], guns: [[-0.012, -0.0012, 0], [0.012, -0.0012, 0], [-0.019, -0.0012, 0.006], [0.019, -0.0012, 0.006]],
      py: { x0: 0.008, dx: 0.0038, y: -0.0032, z: 0.006 }, sh: { y: 0, z: -0.004, r: 0.032 }, ar: { w: 0.0064, y: 0.0046, z0: -0.010, z1: 0.016 } };
  },
  coloso(K, X) { // cañonera pesada: casco grueso con placas, puente, torreta dorsal y triple motor
    const P = [[0, -0.021], [0.0035, -0.0195], [0.0068, -0.013], [0.0080, -0.004], [0.0082, 0.008], [0.0072, 0.016], [0.0050, 0.021], [0, 0.021]];
    hull(K, X, P, 1.35, 0.78, [-0.0165, -0.0100, -0.0030, 0.0045, 0.0110, 0.0175]);
    K.add(X.MT, latheG([[0, -0.0214], [0.0036, -0.0197], [0.0056, -0.0172]], 1.35, 0.78, 16)); K.add(X.MT, bx(0.0090, 0.0006, 0.0006), [0, 0.0006, -0.0199]); // proa acorazada
    K.add(X.H2, bx(0.0076, 0.0018, 0.0064), [0, 0.0058, -0.0098]); K.add(X.A, bx(0.0078, 0.0004, 0.0008), [0, 0.0069, -0.0072]); // puente
    K.add(X.G, bx(0.0064, 0.0009, 0.0030), [0, 0.0064, -0.0129], [-0.55, 0, 0]); K.mir(X.G, bx(0.0026, 0.0009, 0.0026), [0.0040, 0.0060, -0.0106], [-0.40, 0.75, 0]); K.add(X.D, bx(0.0068, 0.0003, 0.0004), [0, 0.0063, -0.0136], [-0.55, 0, 0]); K.add(X.D, bx(0.0003, 0.0010, 0.0032), [0, 0.0066, -0.0128], [-0.55, 0, 0]); // parabrisas de tres paneles con marcos
    K.add(X.H, bx(0.0100, 0.0006, 0.0075), [0, 0.0063, 0.0046]); K.add(X.H2, bx(0.0074, 0.0004, 0.0050), [0, 0.0067, 0.0062]); K.add(X.D, bx(0.0002, 0.0004, 0.0100), [0, 0.0065, 0.0100]); K.mir(X.D, bx(0.0002, 0.0005, 0.0076), [0.0050, 0.0064, 0.0046]); // placas dorsales solapadas
    K.add(X.D, new THREE.CylinderGeometry(0.0036, 0.0040, 0.0016, 16), [0, 0.0072, 0.0016]); K.add(X.A, new THREE.TorusGeometry(0.0034, 0.00022, 4, 18).rotateX(PI / 2), [0, 0.0081, 0.0016]); K.add(X.H, new THREE.SphereGeometry(0.0030, 14, 8, 0, PI * 2, 0, PI / 2), [0, 0.0082, 0.0016], [0, 0, 0], [1, 0.75, 1.1]); // torreta dorsal
    K.add(X.D, bx(0.0012, 0.0008, 0.0006), [0, 0.0094, -0.0012]);
    for (const sx of [-1, 1]) { K.add(X.MT, cylZ(0.00045, 0.00045, 0.0090, 8), [sx * 0.0011, 0.0092, -0.0035]); K.add(X.D, cylZ(0.00075, 0.00075, 0.0012, 8), [sx * 0.0011, 0.0092, -0.0016]); K.add(X.D, cylZ(0.00068, 0.00068, 0.0009, 8), [sx * 0.0011, 0.0092, -0.0075]); }
    K.add(X.MT, bx(0.0006, 0.0011, 0.0032), [0, 0.0085, -0.0006]); // manguito común de los cañones
    wing(K, X.H, [[0.008, -0.004], [0.023, 0.003], [0.023, 0.011], [0.008, 0.013]], 0.0026, 0, 0.0005);
    strip(K, X.A, [0.0090, -0.0032], [0.0225, 0.0034], 0.0012, 0.0016); strip(K, X.H2, [0.0090, 0.0102], [0.0225, 0.0098], 0.0030, 0.0016); strip(K, X.D, [0.0120, 0.0070], [0.0120, 0.0122], 0.00016, 0.0016); strip(K, X.D, [0.0175, 0.0070], [0.0175, 0.0114], 0.00016, 0.0016); // franja, flaps y juntas
    dots(K, X.D, [0.0100, 0.0016, -0.0010], [0.0220, 0.0016, 0.0010], 5, 0.00034); dots(K, X.D, [0.0100, 0.0016, 0.0126], [0.0220, 0.0016, 0.0108], 5, 0.00034);
    K.mir(X.H2, bx(0.0022, 0.0030, 0.0100), [0.0232, 0, 0.0070]); K.mir(X.A, bx(0.0023, 0.0016, 0.0030), [0.0232, 0.0006, 0.0000]); K.mir(X.D, bx(0.0024, 0.0005, 0.0060), [0.0232, 0.0018, 0.0075]); K.add(LR, ball3(0.0007), [-0.0232, 0.0018, 0.0035]); K.add(LG, ball3(0.0007), [0.0232, 0.0018, 0.0035]); // vainas de punta de ala
    K.mir(X.H2, cylZ(0.0033, 0.0038, 0.016), [0.0125, -0.001, 0.0125]); K.mir(X.A, new THREE.TorusGeometry(0.0036, 0.00025, 4, 18), [0.0125, -0.001, 0.0070]); K.mir(X.D, new THREE.TorusGeometry(0.0035, 0.00018, 4, 18), [0.0125, -0.001, 0.0140]); K.mir(X.D, cylZ(0.0026, 0.0026, 0.0006, 12), [0.0125, -0.001, 0.0044]);
    K.mir(X.MT, bx(0.0012, 0.0050, 0.0140), [0.0104, 0, 0.0030]); // puntales de las góndolas
    for (let i = 0; i < 4; i++) K.mir(X.D, bx(0.0002, 0.0030, 0.0014), [0.0111, 0.0032, 0.0090 + i * 0.0018]); // radiadores laterales
    dots(K, X.D, [0.0030, 0.0062, -0.0130], [0.0046, 0.0060, 0.0140], 8, 0.00034); mast(K, X, -0.0040, 0.0064, 0.0125, 0.0046, 0.1, LW); K.add(X.H2, new THREE.SphereGeometry(0.0010, 8, 5, 0, PI * 2, 0, PI / 2), [0.0045, 0.0064, 0.0110], [0.5, 0, 0]);
    hatch(K, X, 0.0150, 0.00190, 0.0098, 0.0044, 0.0034); hatch(K, X, 0.0190, 0.00190, 0.0060, 0.0030, 0.0026); rcs(K, X, 0.0061, 0.0008, -0.0175, 1.2); radiator(K, X, 0.0060, 0.0072, 0.0100, 0.0022, 0.0060, 6); mast(K, X, 0.0130, 0.0018, 0.0128, 0.0030, 0.3, LR); mast(K, X, -0.0130, 0.0018, -0.0010, 0.0034, -0.2, LW); // escotillas, RCS, radiadores dorsales y balizas
    return { eng: [{ x: 0, y: 0, z: 0.0215, r: 0.0046 }, { x: -0.0125, y: -0.001, z: 0.0198, r: 0.0033 }, { x: 0.0125, y: -0.001, z: 0.0198, r: 0.0033 }],
      nose: [0, -0.0030, -0.0205], guns: [[-0.011, -0.0013, -0.001], [0.011, -0.0013, -0.001], [-0.018, -0.0013, 0.004], [0.018, -0.0013, 0.004]],
      py: { x0: 0.009, dx: 0.0028, y: -0.0038, z: 0.006 }, sh: { y: 0, z: -0.004, r: 0.036 }, ar: { w: 0.0100, y: 0.0062, z0: -0.012, z1: 0.016 } };
  },
  nomada(K, X) { // explorador: plato sensor, cúpula panorámica, botes laterales y paneles solares plegables
    const P = [[0, -0.024], [0.0018, -0.0215], [0.0034, -0.012], [0.0038, 0], [0.0036, 0.012], [0.0030, 0.020], [0, 0.022]];
    hull(K, X, P, 1, 0.9, [-0.0160, -0.0080, -0.0010, 0.0050, 0.0110, 0.0170]);
    K.add(X.H2, new THREE.SphereGeometry(0.0046, 20, 6, 0, PI * 2, 0, 0.95).rotateX(PI / 2), [0, 0, -0.0245]); K.add(X.H, new THREE.SphereGeometry(0.0044, 20, 6, 0, PI * 2, 0, 0.93).rotateX(PI / 2), [0, 0, -0.0246]); // plato sensor con aro, alimentador y trípode
    K.add(X.A, new THREE.TorusGeometry(0.00372, 0.00022, 4, 24), [0, 0, -0.0245 + 0.0046 * Math.cos(0.95)]); K.add(X.MT, cylZ(0.00022, 0.00022, 0.0050, 6), [0, 0, -0.0265]); K.add(X.D, cylZ(0.0005, 0.00022, 0.0009, 8), [0, 0, -0.0291]); K.add(LY, ball3(0.0004), [0, 0, -0.0296]);
    for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3 + PI / 2; K.add(X.MT, cylZ(0.00009, 0.00009, 0.0046, 4), [Math.cos(a) * 0.0019, Math.sin(a) * 0.0019, -0.0248], [Math.sin(a) * 0.42, -Math.cos(a) * 0.42, 0]); }
    canopy(K, X, 0, 0.0024, -0.0105, 0.0043, 1.75, 1.0); K.add(X.MT, new THREE.TorusGeometry(0.0044, 0.0003, 4, 20).rotateX(PI / 2), [0, 0.0024, -0.0105]);
    K.add(X.H2, bx(0.0030, 0.0018, 0.0050), [0, 0.0040, 0.0040]); K.add(X.D, new THREE.SphereGeometry(0.0013, 10, 6, 0, PI * 2, 0, PI / 2), [0, 0.0049, 0.0040]); K.add(X.G, new THREE.SphereGeometry(0.00055, 8, 5), [0, 0.0056, 0.0034]); // torreta de sensores dorsal
    K.add(X.H2, cylZ(0.0011, 0.0011, 0.0090, 10), [0, 0.0040, 0.0140]); K.add(X.A, new THREE.TorusGeometry(0.0012, 0.0002, 4, 12), [0, 0.0040, 0.0110]); K.add(X.A, new THREE.TorusGeometry(0.0012, 0.0002, 4, 12), [0, 0.0040, 0.0170]); // bote de carga dorsal
    const panel = 'PV';
    K.mir(X.H, cylZ(0.0018, 0.0018, 0.030), [0.012, 0, 0.008]); K.mir(X.A, cylZ(0.00195, 0.00195, 0.0012), [0.012, 0, -0.0035]); K.mir(X.A, cylZ(0.00195, 0.00195, 0.0012), [0.012, 0, 0.0085]); K.mir(X.D, new THREE.TorusGeometry(0.0018, 0.00014, 4, 12), [0.012, 0, 0.0000]); K.mir(X.D, new THREE.TorusGeometry(0.0018, 0.00014, 4, 12), [0.012, 0, 0.0150]);
    K.mir(X.H, bx(0.0085, 0.0012, 0.004), [0.0078, 0, 0.004]); K.mir(X.MT, bx(0.0085, 0.0006, 0.0010), [0.0078, 0.0007, 0.0058]);
    K.mir(X.H2, new THREE.SphereGeometry(0.0016, 10, 8), [0.0128, 0.0021, 0.0130]); K.mir(X.A, new THREE.TorusGeometry(0.0016, 0.00016, 4, 12), [0.0128, 0.0021, 0.0130]); K.mir(X.MT, new THREE.CylinderGeometry(0.00012, 0.00012, 0.0020, 4), [0.0128, 0.0010, 0.0130]); // depósito esférico
    for (let s = 0; s < 3; s++) { // paneles solares plegables: 3 tramos con marco y celdas
      const cx = 0.0165 + s * 0.0048;
      K.mir(panel, bx(0.0044, 0.00034, 0.0126), [cx, 0, 0.008]); K.mir(X.H, bx(0.0046, 0.0005, 0.0003), [cx, 0, 0.0143]); K.mir(X.H, bx(0.0046, 0.0005, 0.0003), [cx, 0, 0.0017]); K.mir(X.H, bx(0.0003, 0.0005, 0.0126), [cx + 0.0023, 0, 0.008]); K.mir(X.H, bx(0.0003, 0.0005, 0.0126), [cx - 0.0023, 0, 0.008]);
    }
    K.mir(X.MT, bx(0.0034, 0.0004, 0.0006), [0.0150, 0, 0.008]); K.add(LR, ball3(0.0006), [-0.0286, 0, 0.0143]); K.add(LG, ball3(0.0006), [0.0286, 0, 0.0143]);
    mast(K, X, 0.0016, 0.0050, 0.0010, 0.0060, 0.25, LW); mast(K, X, -0.0018, 0.0050, 0.0170, 0.0040, -0.2, LR); K.add(X.H2, new THREE.SphereGeometry(0.0010, 8, 5, 0, PI * 2, 0, PI / 2), [0.0032, 0.0036, -0.0020], [0.9, 0, 0.5]);
    dots(K, X.D, [0.0018, 0.0031, -0.0060], [0.0020, 0.0032, 0.0090], 6, 0.0003);
    radiator(K, X, 0.0070, 0.0, 0.0170, 0.0050, 0.0070, 7); radiator(K, X, 0.0072, 0.0, -0.0040, 0.0044, 0.0050, 5); dish(K, X, -0.0030, 0.0046, 0.0060, 0.0014, [0.5, 0, 0.3]); rcs(K, X, 0.0029, 0.0010, -0.0170, 1.0); rcs(K, X, 0.0290, 0.0004, 0.0128, 0.8); hatch(K, X, 0.0020, 0.0038, 0.0022, 0.0018, 0.0026, false); mast(K, X, 0.0140, 0.0020, 0.0230, 0.0030, 0.2, LR); // radiadores, antena parabólica y RCS
    return { eng: [-1, 1].map(s => ({ x: s * 0.012, y: 0, z: 0.0234, r: 0.0026 })), nose: [0, -0.0015, -0.0215], guns: [[-0.012, -0.0015, -0.004], [0.012, -0.0015, -0.004], [-0.022, -0.0015, 0.002], [0.022, -0.0015, 0.002]],
      py: { x0: 0.0075, dx: 0.0033, y: -0.0026, z: 0.008 }, sh: { y: 0, z: -0.010, r: 0.032 }, ar: { w: 0.0038, y: 0.0034, z0: -0.012, z1: 0.016 } };
  },
};

  // ---------- ensamblado: geometría en caché por (tipo + mejoras); cada nave solo añade meshes, llamas y materiales propios ----------
  const fade = (g, len, pw) => { const p = g.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const k = Math.pow(Math.max(0, 1 - p.getZ(i) / len), pw); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }; // degradado de la llama: brillante en la tobera, se apaga en la punta
  const FL1 = fade(new THREE.ConeGeometry(1, 1, 12).rotateX(PI / 2).translate(0, 0, 0.5), 1, 1.1), FL2 = fade(new THREE.ConeGeometry(0.53, 0.62, 10).rotateX(PI / 2).translate(0, 0, 0.31), 0.62, 0.8); // llamas unitarias: se escalan por motor
  const glowMat = (c, op) => new THREE.MeshBasicMaterial({ vertexColors: true, color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
  let GEARP = null; const gearParts = () => GEARP || (GEARP = (() => { // tren de aterrizaje: solo visible con la nave estacionada; igual para todos los chasis
    const K = skit(); for (const [x, z] of [[-0.006, 0.008], [0.006, 0.008], [0, -0.011]]) { K.add('MT', new THREE.CylinderGeometry(0.0004, 0.0005, 0.0050, 6), [x, -0.0027, z]); K.add('D', new THREE.CylinderGeometry(0.0015, 0.0015, 0.0006, 10), [x, -0.0060, z], [0, 0, PI / 2]); K.add('H2', new THREE.CylinderGeometry(0.0008, 0.0008, 0.0007, 8), [x, -0.0060, z], [0, 0, PI / 2]); K.add('D', bx(0.0012, 0.0008, 0.0016), [x, -0.0004, z]); }
    return K.parts();
  })());
  const GEO = new Map();
  function nozzle(K, e, r, en) { // tobera: collar, campana con nervios, interior emisivo en degradado (rojo oscuro → blanco caliente) y aro de color
    const { x, y, z } = e, at = [x, y, z];
    K.add('H2', cylZ(r * 1.16, r * 1.06, 0.0009), [x, y, z - 0.0009]);
    K.add('MT', latheG([[r * 0.74, -0.0013], [r * 0.84, -0.0004], [r * 0.96, 0.0007], [r * 1.04, 0.0013]], 1, 1, 20), at);
    K.add('NZ', latheC([[r * 0.97, 0.0012], [r * 0.72, 0.0003], [r * 0.46, -0.0006], [r * 0.28, -0.0013]], [0x7a2a0a, 0xd45e18, 0xffb040, 0xfff2d0], 18), at);
    K.add('NZ', discC(r * 0.28, 0xffffff, 12), [x, y, z - 0.0013]);
    K.add('D', new THREE.TorusGeometry(r * 0.86, r * 0.05, 4, 18), [x, y, z - 0.0003]); K.add('D', new THREE.TorusGeometry(r * 0.97, r * 0.05, 4, 18), [x, y, z + 0.0007]);
    K.add('A', new THREE.TorusGeometry(r * 1.03, r * 0.07, 4, 18), [x, y, z + 0.0013]);
    for (let i = 0; i < 8; i++) { const a = i * PI / 4; K.add('D', bx(r * 0.09, r * 0.16, 0.0016), [x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, z - 0.0002], [0, 0, a - PI / 2]); } // aletas de refrigeración
    if (en >= 1) K.add('EG', new THREE.TorusGeometry(r * 1.08, r * 0.09, 6, 14), [x, y, z + 0.0006]);
  }
  function build(spec) {
    const key = spec.t + spec.a.join(''), hit = GEO.get(key); if (hit) { GEO.delete(key); GEO.set(key, hit); return hit; }
    const [ar, sh, pl, , en] = spec.a, st = statsOf(spec), K = skit(), d = BUILD[spec.t](K, X), muz = [], pyl = [];
    const eng = d.eng.map(e => ({ x: e.x, y: e.y, z: e.z, r: e.r * (1 + 0.12 * en) })); eng.forEach(e => nozzle(K, e, e.r, en));
    for (let l = 1; l <= ar; l++) { // placas de blindaje: capas con remaches
      const w = d.ar.w * (0.7 + 0.15 * l), zc = (d.ar.z0 + d.ar.z1) / 2, zl = d.ar.z1 - d.ar.z0;
      K.mir('AR', bx(w * 0.6, 0.0007, zl * (0.55 + 0.2 * l)), [w * 0.45, d.ar.y + 0.0006 * l, zc]); K.mir('AR', bx(0.0007, w * 0.9, zl * 0.5), [d.ar.w + 0.0004 * l, 0, zc + 0.002]);
      K.mir('MT', bx(w * 0.4, 0.0004, zl * (0.4 + 0.2 * l)), [w * 0.45, d.ar.y + 0.0006 * l + 0.0005, zc]); dots(K, 'D', [w * 0.3, d.ar.y + 0.0006 * l + 0.0006, zc - zl * 0.2], [w * 0.6, d.ar.y + 0.0006 * l + 0.0006, zc + zl * 0.2], 4, 0.0003);
      K.add('A', bx(w * 1.3, 0.0008, 0.005), [0, d.ar.y + 0.0007 * l, d.ar.z0 + 0.003]);
    }
    K.add('MT', cylZ(0.0005, 0.0006, 0.005, 8), d.nose); K.add('D', cylZ(0.00075, 0.00075, 0.0009, 8), [d.nose[0], d.nose[1], d.nose[2] - 0.0026]); K.add('D', cylZ(0.0007, 0.0007, 0.0004, 8), [d.nose[0], d.nose[1], d.nose[2] - 0.0006]); muz.push([d.nose[0], d.nose[1], d.nose[2] - 0.003]); // cañón central siempre, con freno de boca
    for (let i = 0; i < (pl >= 2 ? 4 : pl >= 1 ? 2 : 0); i++) { // cañones de plasma en las alas: caja de recámara, camisa con aletas disipadoras, bobinas y emisor
      const [x, y, z] = d.guns[i];
      K.add('A', bx(0.0016, 0.0016, 0.004), [x, y, z]); K.add('D', bx(0.0011, 0.0004, 0.0026), [x, y + 0.0009, z + 0.0003]); K.add('MT', cylZ(0.00055, 0.00055, 0.0075, 8), [x, y, z - 0.0055]); K.add('D', cylZ(0.0008, 0.0008, 0.0010, 8), [x, y, z - 0.0086]); K.add('LT', ball3(0.0007), [x, y, z - 0.0093]);
      for (const k of [-0.0030, -0.0045, -0.0060]) K.add('GL', new THREE.TorusGeometry(0.00072, 0.00012, 4, 10), [x, y, z + k]);
      for (const k of [-0.0022, -0.0038, -0.0054, -0.0070]) K.add('D', cylZ(0.00073, 0.00073, 0.00022, 8), [x, y, z + k]);
      muz.push([x, y, z - 0.0093]);
    }
    for (let i = 0; i < st.missiles; i++) { // pilones (el misil de cada uno es una instancia del mesh de misiles)
      const side = i % 2 ? 1 : -1, x = side * (d.py.x0 + (i >> 1) * d.py.dx), y = d.py.y, z = d.py.z;
      K.add('D', bx(0.0005, 0.0018, 0.005), [x, y + 0.0011, z]); K.add('MT', bx(0.0011, 0.0003, 0.0060), [x, y + 0.0001, z - 0.0002]); K.add('A', bx(0.00055, 0.0004, 0.0012), [x, y + 0.0018, z - 0.0018]); K.add('D', bx(0.0002, 0.0006, 0.0012), [x, y + 0.0004, z + 0.0018]); pyl.push([x, y - 0.0006, z]);
    }
    if (sh > 0) K.add('MT', new THREE.CylinderGeometry(0.0011, 0.0019, 0.0010, 10).rotateX(PI / 2), [d.nose[0], d.nose[1] - 0.0012, d.nose[2] + 0.0040]); // emisor del escudo (el resplandor solo aparece al recibir daño)
    const out = { parts: K.parts(), muz, pyl, eng }; GEO.set(key, out);
    if (GEO.size > 36) { const [k0, v0] = GEO.entries().next().value; GEO.delete(k0); v0.parts.forEach(([, g]) => g.dispose()); } // caché limitada: al expulsar una entrada se libera su geometría en GPU (si vuelve a usarse se re-sube sola)
    return out;
  }
  function make(spec, hullOverride) {
    spec = validSpec(spec);
    const T = TYPES[spec.t], st = statsOf(spec), sh = spec.a[1], root = new THREE.Group(), m = new THREE.Group(), B = build(spec), MX = getMats(hullOverride ?? 0xaeb8c3, spec.c);
    m.scale.setScalar(T.size); root.add(m);
    const at = ([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(T.size);
    Object.assign(root, { muzzles: B.muz.map(at), pylons: B.pyl.map(at), missiles: [], flames: [], shieldFx: [], flameMul: st.flameMul });
    const fx = { stw: new THREE.MeshBasicMaterial({ color: 0xffffff }), str: new THREE.MeshBasicMaterial({ color: 0xff3030 }), nz: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), ph: Math.random() * 1500, msl: null, idle: hullOverride === undefined ? 0.3 : 0.08 }; // idle: brillo del interior de la tobera con el motor parado (casco a la deriva: apagado)
    const PM = { STW: fx.stw, STR: fx.str, NZ: fx.nz }, hullMs = [];
    for (const [role, geo] of B.parts) { const ms = new THREE.Mesh(geo, PM[role] || MX[role]); m.add(ms); hullMs.push(ms); } // ~10 meshes por casco
    const f1 = glowMat(0x4fb4ff, 0.55), f2 = glowMat(0xffffff, 0.95);
    B.eng.forEach(e => { const L = e.r * 7.6, fl = new THREE.Group(), a = new THREE.Mesh(FL1, f1), b = new THREE.Mesh(FL2, f2); a.scale.set(e.r, e.r, L); b.scale.set(e.r, e.r, L); fl.position.set(e.x, e.y, e.z + 0.0011); fl.add(a, b); m.add(fl); root.flames.push(fl); }); // motores: llama doble
    if (B.pyl.length) { const im = new THREE.InstancedMesh(MSLG, mslMat(), B.pyl.length); B.pyl.forEach((p, i) => { im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2])); root.missiles.push({ visible: true }); }); im.frustumCulled = false; m.add(im); fx.msl = im; } // todos los misiles = 1 draw call
    root.shell = new THREE.Group(); { const bb = new THREE.Box3(); hullMs.forEach(ms => { ms.geometry.computeBoundingBox(); bb.union(ms.geometry.boundingBox); }); const c = bb.getCenter(new THREE.Vector3()); root.shell.scale.setScalar(1.14); root.shell.position.copy(c).multiplyScalar(1 - 1.14); // mallas del casco: el escudo las repite un poco más grandes para conservar la silueta
      const sm1 = new THREE.MeshBasicMaterial({ color: 0x55c8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), sm2 = new THREE.MeshBasicMaterial({ color: 0xbff4ff, wireframe: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      hullMs.forEach(ms => { root.shell.add(new THREE.Mesh(ms.geometry, sm1), new THREE.Mesh(ms.geometry, sm2)); }); root.shellMats = [sm1, sm2]; }
    root.shell.visible = false; m.add(root.shell); root.shieldLv = sh;
    root.gear = new THREE.Group(); root.gearH = 0.0064 * T.size; for (const [role, geo] of gearParts()) root.gear.add(new THREE.Mesh(geo, MX[role])); root.gear.visible = false; m.add(root.gear);
    root.fx = fx; return root;
  }
  const FL_BLUE = new THREE.Color(0x4fb4ff), FL_YEL = new THREE.Color(0xffa41a), IN_W = new THREE.Color(0xffffff), IN_Y = new THREE.Color(0xffe58a);
  return {
    make,
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
