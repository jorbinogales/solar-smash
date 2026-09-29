// Generador procedural del sistema (determinista por semilla; lo usan el servidor y todos los clientes, así todos ven lo mismo).
// Solo planetas habitables (sin gigantes gaseosos): templados, tipo Marte, tipo Venus, helados y rojos volcánicos, más lunas rocosas. Órbitas compactas.
(function (root) {
  const DS = 0.06, AU_GAME = 149597870.7 * DS; // igual que DIST_SCALE de game.js: 'a' se guarda sin escalar
  const mulberry = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');

  const TYPES = { // etiqueta legible y descripción para el selector de hangar
    earth: { label: 'Templado', desc: 'Océanos, bosques y cordilleras. Aire respirable.' },
    mars: { label: 'Desierto rojo', desc: 'Cañones y polvo rojizo. Atmósfera muy fina.' },
    venus: { label: 'Infernal', desc: 'Mesetas agrietadas y ríos de lava bajo una atmósfera densa.' },
    frozen: { label: 'Helado', desc: 'Llanuras de hielo y cristales, montañas blancas.' },
    red: { label: 'Volcánico rojo', desc: 'Roca oscura, cráteres y crestas incandescentes.' },
    moon: { label: 'Luna rocosa', desc: 'Sin atmósfera: cráteres y silencio.' },
  };
  const SYL_A = ['Ka', 'Vel', 'Or', 'Zan', 'Thy', 'Mer', 'Xa', 'Lo', 'Ny', 'Cor', 'Ar', 'Eb', 'Sil', 'Dra', 'Pho', 'Ta', 'Ul', 'Ke'];
  const SYL_B = ['ion', 'ara', 'ex', 'oth', 'una', 'eris', 'ia', 'os', 'yn', 'ax', 'ur', 'ell', 'ora', 'ith'];
  const ROMAN = ['I', 'II', 'III'];

  function genSystem(seed, nPlan) { // nPlan (2-8): número de planetas elegido al crear la sala (= jugadores); si no se da, se sortea 4-7
    const r = mulberry((seed >>> 0) || 1), used = new Set();
    const name = () => { for (let i = 0; i < 50; i++) { const n = SYL_A[(r() * SYL_A.length) | 0] + SYL_B[(r() * SYL_B.length) | 0]; if (!used.has(n)) { used.add(n); return n; } } return 'Cuerpo' + used.size; };
    const tint = (c, amt) => { const ch = s => Math.max(0, Math.min(255, ((c >> s) & 255) + Math.round((r() - 0.5) * amt))); return (ch(16) << 16) | (ch(8) << 8) | ch(0); };
    const R = (a, b) => a + r() * (b - a), SC = 0.28, HS = 0.45; // SC: escala de los mundos; HS: escala de las atmósferas

    const STARS = [[0xffcf5a, 0xff6a00], [0xffe9b0, 0xffb347], [0xffb070, 0xe04a10]], sc = STARS[(r() * STARS.length) | 0];
    const star = { n: name() + ' (estrella)', R: 250000, a: 0, T: 0, k: 'sun', c1: hex(sc[0]), c2: hex(sc[1]), type: 'sun', label: 'Estrella' };
    const surf = {}, atmo = {}, bodies = [star];

    const nRand = 4 + ((r() * 4) | 0), nP = nPlan ? Math.max(2, Math.min(8, nPlan)) : nRand; // con lunas nunca más de 10 cuerpos
    let a = R(5e6, 6.2e6); // primer planeta fuera de la turbulencia de la estrella (16 radios = 4e6 km)
    const orbits = [];
    for (let i = 0; i < nP; i++) { orbits.push(a); a += R(1.3e6, 2.4e6); }

    const pick = t => { // tipo según la zona: infernales y rojos por dentro, templados y desiertos en medio, helados por fuera
      const w = { venus: 1.3 * (1 - t) * (1 - t) + 0.05, red: 0.7, earth: Math.max(0.25, 1.6 - Math.abs(t - 0.4) * 3), mars: t > 0.15 ? 1 : 0.2, frozen: 1.6 * t * t + 0.05 };
      let s = 0; for (const k in w) s += w[k]; let x = r() * s; for (const k in w) { x -= w[k]; if (x <= 0) return k; } return 'earth';
    };
    const types = orbits.map((_, i) => pick(nP > 1 ? i / (nP - 1) : 0.4));
    if (!types.includes('earth')) types[Math.min(nP - 1, 1 + ((r() * 2) | 0))] = 'earth'; // siempre hay un mundo templado
    while (new Set(types).size < Math.min(3, nP)) types[(r() * nP) | 0] = ['mars', 'frozen', 'red', 'venus'][(r() * 4) | 0];

    const make = (type, n) => { // devuelve datos del cuerpo y registra su terreno/atmósfera
      const seedN = 1 + r() * 9; let d, s, at = null;
      if (type === 'earth') { d = { R: R(5200 * SC, 7500 * SC), c1: hex(tint(0x0b3a7a, 40)), c2: hex(tint(0x3f7d3a, 40)) }; s = { kind: 'earth', amp: R(12, 20), seed: seedN, sea: (r() - 0.5) * 0.1, style: { ore: 'vein', flora: null } }; at = { c: tint(0x6fb4ff, 40), H: R(100 * HS, 140 * HS) }; }
      else if (type === 'mars') { d = { R: R(2800 * SC, 4300 * SC), c1: hex(tint(0x7a3a1e, 30)), c2: hex(tint(0xd98a57, 30)) }; s = { kind: 'rock', amp: R(16, 24), seed: seedN, canyon: R(3, 6), c: [tint(0x6a2f1a, 30), tint(0xd9915a, 30)], cr: [[160, 0.7], [22, 0.5]], objs: [tint(0xc0704a, 30), tint(0x8a4a2c, 30)], style: { ore: 'shard', flora: 'cactus' } }; at = { c: tint(0xd9a37a, 30), H: R(40 * HS, 60 * HS) }; }
      else if (type === 'venus') { d = { R: R(5400 * SC, 6600 * SC), c1: hex(tint(0xb58d4c, 30)), c2: hex(tint(0xefd9a0, 30)) }; s = { kind: 'venus', amp: R(10, 16), seed: seedN, c: [tint(0x6f5228, 30), tint(0xd7b467, 30)], objs: [tint(0x6a5a3a, 20), tint(0x3a2c1c, 20)], style: { ore: 'vein', flora: 'coral' } }; at = { c: tint(0xe8c070, 30), H: R(220 * HS, 280 * HS) }; }
      else if (type === 'frozen') { d = { R: R(3000 * SC, 6000 * SC), c1: hex(tint(0x9fc3d8, 30)), c2: hex(tint(0xf4fbff, 20)) }; s = { kind: 'rock', amp: R(10, 18), seed: seedN, c: [tint(0xa9c6d8, 30), 0xf5fbff], cr: [[200, 0.5], [40, 0.35]], objs: [0xdff0fa, tint(0xa9c8dc, 20)], style: { ore: 'shard', flora: 'crystalTree' } }; at = { c: tint(0xbfe3ff, 30), H: R(50 * HS, 80 * HS) }; }
      else if (type === 'red') { d = { R: R(3200 * SC, 6000 * SC), c1: hex(tint(0x3a1410, 20)), c2: hex(tint(0xd0502c, 40)) }; s = { kind: 'rock', amp: R(18, 26), seed: seedN, c: [tint(0x3a1410, 20), tint(0xc2452a, 40)], cr: [[180, 0.6], [28, 0.5], [6, 0.3]], objs: [tint(0x8a3a28, 30), 0x4a1c14], style: { ore: 'nugget', flora: 'slag' } }; at = { c: tint(0xc26040, 30), H: R(45 * HS, 70 * HS) }; }
      else { const g = (r() * 3) | 0, base = [[0x4d4d4d, 0x9c9c9c], [0x5a4c40, 0xb09a86], [0x44505a, 0xa0b0bc]][g]; d = { R: R(800 * SC, 2200 * SC), c1: hex(base[0]), c2: hex(base[1]) }; s = { kind: 'rock', amp: R(5, 9), seed: seedN, c: base, cr: [[180, 1], [30, 0.7], [5, 0.4]], objs: [0xb8b8b8, 0x8a8a8a], style: { ore: 'shard', flora: 'crystalTree' } }; }
      surf[n] = s; if (at) atmo[n] = at;
      return { n, k: type === 'earth' ? 'earth' : 'rock', type, label: TYPES[type].label, desc: TYPES[type].desc, ...d };
    };

    const planets = orbits.map((ag, i) => { const b = make(types[i], name()); b.a = ag / DS; b.T = 365.25 * Math.pow(ag / AU_GAME, 1.5); b.ph = r() * 6.2832; return b; });
    const moons = []; let total = nP;
    planets.forEach(p => {
      if (total >= 10 || r() > 0.45 || p.R < 900) return;
      const m = make('moon', p.n + ' ' + ROMAN[0]); m.parent = p.n; total++;
      const far = r() < 0.4; m.a = p.R * (far ? R(18, 32) : R(3.2, 8)); m.T = Math.max(0.3, 27.32 * Math.pow(m.a / 384400, 1.5)); m.ph = r() * 6.2832;
      moons.push(m);
    });
    planets.forEach(p => { bodies.push(p); moons.filter(m => m.parent === p.n).forEach(m => bodies.push(m)); });

    // cinturón de asteroides en el mayor hueco entre órbitas
    let gi = 0, gap = 0; for (let i = 0; i < nP - 1; i++) if (orbits[i + 1] - orbits[i] > gap) { gap = orbits[i + 1] - orbits[i]; gi = i; }
    const bi = orbits[gi] + gap * 0.3, bo = orbits[gi + 1] - gap * 0.3, belt = { i: bi, o: bo, h: Math.min(0.3e6, (bo - bi) * 0.35) };
    return { seed, star, bodies, surf, atmo, belt, types: TYPES };
  }
  // Mejoras de la base (máx. 4 niveles): vida, escudo que absorbe las balas, vida y daño de las torres. Coste del nivel lv+1 = COST[k](lv+1).
  const BASE_UP = {
    hp: { name: 'Vida de la base', max: 4, cost: n => ({ piedra: 8 * n, madera: 6 * n }) },
    sh: { name: 'Escudo de la base', max: 4, cost: n => ({ cobre: 6 * n, plata: 3 * n }) },
    tw: { name: 'Vida de las torres', max: 4, cost: n => ({ piedra: 6 * n, cobre: 4 * n }) },
    td: { name: 'Daño de las torres', max: 4, cost: n => ({ oro: 3 * n, plata: 3 * n }) },
  };
  const baseStats = up => ({ hpMax: 600 + 250 * (up.hp || 0), shMax: 300 * (up.sh || 0), twMax: 150 + 75 * (up.tw || 0), dmgMul: 1 + 0.4 * (up.td || 0) });
  // Estilos de torreta: daño por disparo (× mejora de daño), cadencia (s), velocidad del proyectil (km/s), color y si el proyectil es un misil guiado
  const TOWER_STYLES = {
    plasma:  { name: 'Plasma',       dmg: 4,  cd: 0.9,  spd: 12, col: 0xff5040, homing: false, cost: null },
    cannon:  { name: 'Munición',     dmg: 1.6, cd: 0.22, spd: 16, col: 0xffd23f, homing: false, cost: { piedra: 10, cobre: 6 } },
    missile: { name: 'Misil guiado', dmg: 14, cd: 3.2,  spd: 6, col: 0xff8a3c, homing: true,  cost: { oro: 6, plata: 6 } },
    rail:    { name: 'Cañón de riel', dmg: 22, cd: 4.2, spd: 30, col: 0x9fe8ff, homing: false, cost: { diamante: 3, oro: 8 } },
  };
  root.genSystem = genSystem; root.BASE_UP = BASE_UP; root.baseStats = baseStats; root.TOWER_STYLES = TOWER_STYLES;
  if (typeof module !== 'undefined') module.exports = { genSystem, BASE_UP, baseStats, TOWER_STYLES };
})(typeof window !== 'undefined' ? window : globalThis);
