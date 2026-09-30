// Generador procedural del sistema (determinista por semilla; lo usan el servidor y todos los clientes, así todos ven lo mismo).
// Solo planetas habitables (sin gigantes gaseosos): templados, tipo Marte, tipo Venus, helados y rojos volcánicos, más lunas rocosas. Órbitas compactas.
(function (root) {
  const DS = 0.06, AU_GAME = 149597870.7 * DS; // igual que DIST_SCALE de game.js: 'a' se guarda sin escalar
  // SYS_SCALE: COMPACTACIÓN del sistema (única fuente; la leen space.js, map.js, game.js y neutral.js). Multiplica: semiejes de las órbitas (y por tanto anillos y
  // sectores de las zonas de control, cinturón, núcleo/zona letal de la estrella), radios de planetas y lunas, atmósferas (H), relieve (amp, cañones, cráteres) y tamaño de los continentes (cs, planets.js),
  // radios y celdas de los cúmulos, y los márgenes de despliegue/exclusión derivados (orbitClear, exclHg, exclWs...). NO toca: la estrella (R★ y su radiación),
  // approachKm (300 km absolutos), alcances de armas/radar ni los periodos orbitales (T se calcula con la órbita SIN compactar: mismas vueltas, trayectorias más cortas).
  // El generador consume exactamente los mismos números aleatorios que con 1: cada semilla da el mismo sistema, a escala.
  const SYS_SCALE = 0.5;
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
    const R = (a, b) => a + r() * (b - a), SC = 0.28 * SYS_SCALE, HS = 0.45 * SYS_SCALE; // SC: escala de los mundos; HS: escala de las atmósferas (ambas compactadas)

    const STARS = [[0xffcf5a, 0xff6a00], [0xffe9b0, 0xffb347], [0xffb070, 0xe04a10]], sc = STARS[(r() * STARS.length) | 0];
    const star = { n: name() + ' (estrella)', R: 250000, a: 0, T: 0, k: 'sun', c1: hex(sc[0]), c2: hex(sc[1]), type: 'sun', label: 'Estrella' };
    const surf = {}, atmo = {}, bodies = [star];

    const nRand = 4 + ((r() * 4) | 0), nP = nPlan ? Math.max(2, Math.min(8, nPlan)) : nRand; // con lunas nunca más de 10 cuerpos
    let a = R(5e6, 6.2e6) * SYS_SCALE; // primer planeta fuera de la turbulencia de la estrella (16·SYS_SCALE radios, game.js) y de su zona letal (≤ la mitad de esta órbita)
    const orbits = [];
    for (let i = 0; i < nP; i++) { orbits.push(a); a += R(1.3e6, 2.4e6) * SYS_SCALE; }

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
      s.amp *= SYS_SCALE; s.cs = SYS_SCALE; if (s.canyon) s.canyon *= SYS_SCALE; if (s.cr) s.cr = s.cr.map(([c, k]) => [c * SYS_SCALE, k]); // relieve compactado como el radio (tras sortear: no altera la secuencia aleatoria)
      surf[n] = s; if (at) atmo[n] = at;
      return { n, k: type === 'earth' ? 'earth' : 'rock', type, label: TYPES[type].label, desc: TYPES[type].desc, ...d };
    };

    const planets = orbits.map((ag, i) => { const b = make(types[i], name()); b.a = ag / DS; b.T = 365.25 * Math.pow(ag / SYS_SCALE / AU_GAME, 1.5); b.ph = r() * 6.2832; return b; });
    const moons = []; let total = nP;
    planets.forEach(p => {
      if (total >= 10 || r() > 0.45 || p.R < 900 * SYS_SCALE) return;
      const m = make('moon', p.n + ' ' + ROMAN[0]); m.parent = p.n; total++;
      const far = r() < 0.4; m.a = p.R * (far ? R(18, 32) : R(3.2, 8)); m.T = Math.max(0.3, 27.32 * Math.pow(m.a / SYS_SCALE / 384400, 1.5)); m.ph = r() * 6.2832;
      moons.push(m);
    });
    planets.forEach(p => { bodies.push(p); moons.filter(m => m.parent === p.n).forEach(m => bodies.push(m)); });

    // cinturón de asteroides en el mayor hueco entre órbitas
    let gi = 0, gap = 0; for (let i = 0; i < nP - 1; i++) if (orbits[i + 1] - orbits[i] > gap) { gap = orbits[i + 1] - orbits[i]; gi = i; }
    const bi = orbits[gi] + gap * 0.3, bo = orbits[gi + 1] - gap * 0.3, belt = { i: bi, o: bo, h: Math.min(0.3e6 * SYS_SCALE, (bo - bi) * 0.35) };
    return { seed, star, bodies, surf, atmo, belt, types: TYPES };
  }
  // Zonas de recursos: el sistema tiene un presupuesto FINITO de cada recurso repartido en cúmulos de asteroides con 1-2 recursos dominantes.
  // Una zona por planeta principal (anclada a él: se mueve con su órbita) y 3 fijas en el cinturón (ancladas a la estrella). Determinista por semilla: el servidor lleva lo que queda.
  const ZONE_THEME = { oro: ['Cinturón Áureo', 'Veta Dorada'], plata: ['Nube Argéntea', 'Campo de Plata'], cobre: ['Escombros Cobrizos', 'Deriva de Cobre'], diamante: ['Cúmulo Diamantino', 'Geoda Estelar'], piedra: ['Pedregal', 'Campo de Rocas'], agua: ['Cometas de Hielo', 'Nube Helada'] };
  const ZONE_BUDGET = { agua: [250, 400], piedra: [300, 500], cobre: [150, 250], plata: [90, 150], oro: [60, 100], diamante: [20, 40] }; // recurso dominante principal; el secundario lleva la mitad
  const ZONE_SEC_W = { agua: 3, piedra: 3, cobre: 3, plata: 2, oro: 1.2, diamante: 0.6 }; // probabilidad relativa de cada recurso como dominante secundario
  // UN cúmulo por cada zona de control reclamable SIN PLANETA (ni la solar ni el sector que ocupa un planeta principal en t0, ni el siguiente al que llegará en 12 h), fijo respecto a la estrella (ancla 0),
  // dentro de su sector y lejos de las órbitas. t0 (s de reloj real): instante común de la sala (el servidor lo fija al crearla y lo envía a los clientes en seed.js como T0)
  function genZones(sys, t0 = 0) {
    const all = genControlZones(sys), withP = new Set(); sys.bodies.forEach((b, i) => { if (b.k !== 'sun' && !b.parent) for (const dt of [0, 43200]) withP.add(czAt(sys, all, bodyPosAt(sys, i, t0 + dt))); });
    const r = mulberry((((sys.seed >>> 0) || 1) ^ 0x2f6b1d3) >>> 0 || 7), RT = Object.keys(ZONE_BUDGET), czs = all.filter(z => !z.noClaim && !withP.has(z.id)), zones = [];
    const mains = sys.bodies.filter(b => b.k !== 'sun' && !b.parent), orbs = mains.map(b => b.a * DS), f = Math.max(0.15, (mains.length + 3) / czs.length * 1.15); // f: el presupuesto TOTAL queda algo mayor que el de antes (nPlanetas + 3 cúmulos grandes) pero repartido entre muchos más
    const bud = (t, k) => Math.max(5, Math.round(k * f * (ZONE_BUDGET[t][0] + r() * (ZONE_BUDGET[t][1] - ZONE_BUDGET[t][0])) / 5) * 5);
    const order = RT.slice(); for (let i = order.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    for (const cz of czs) {
      const k = zones.length, t = order[k % order.length], dom = [{ type: t, budget: bud(t, 1) }];
      if (r() < 0.55) { let sw = 0; for (const q of RT) if (q !== t) sw += ZONE_SEC_W[q]; let x = r() * sw; for (const q of RT) { if (q === t) continue; x -= ZONE_SEC_W[q]; if (x <= 0) { dom.push({ type: q, budget: bud(q, 0.5) }); break; } } }
      const M = 20000 * SYS_SCALE, radius = Math.round((2500 + r() * 2500) * SYS_SCALE), clear = WARCFG.orbitClear + 3 * radius + M, lo = cz.r0 + 2 * radius + M, hi = (cz.r1 === Infinity ? cz.r0 * 1.35 : cz.r1) - 2 * radius - M; // radio y celda ×SYS_SCALE: mismas rocas por cúmulo, la mitad de separadas
      let best = null, bd = -1; // radio en el sector: lejos de TODAS las órbitas (el planeta y sus lunas pasan por ahí); se reintenta con el mismo generador (determinista)
      for (let i = 0; i < 40; i++) { const rr = lo + r() * Math.max(0, hi - lo), dd = Math.min(...orbs.map(o => Math.abs(rr - o))); if (dd > bd) { bd = dd; best = rr; } if (dd >= clear) break; }
      const a = cz.a0 + cz.da * (0.2 + 0.6 * r()), th = ZONE_THEME[t][(r() * 2) | 0];
      zones.push({ id: k, name: `${th} · ${cz.name.replace('Anillo ', '')}`, anchor: 0, off: [Math.round(best * Math.cos(a)), 0, Math.round(best * Math.sin(a))], radius, dominant: dom, cz: cz.id, cell: Math.round(radius / 3.2) }); // cell: celda de asteroides (misma densidad con radios menores)
    }
    const has = new Set(zones.flatMap(z => z.dominant.map(d => d.type))); // todos los recursos deben existir en algún sitio
    for (const q of RT) if (!has.has(q)) { const z = zones.find(x => x.dominant.length < 2) || zones[zones.length - 1]; z.dominant[1] = { type: q, budget: bud(q, 0.5) }; has.add(q); }
    return zones;
  }
  function wreckLoot(i) { // recursos de un casco a la deriva (determinista): 1-2 tipos; el servidor los concede solo la primera vez que se destruye cada casco en la sala
    const rr = mulberry(i * 7919 + 13), tb = [['cobre', 4], ['plata', 3], ['oro', 2], ['piedra', 3], ['agua', 3]], pick = () => { let x = rr() * 15; for (const [k, wt] of tb) { x -= wt; if (x <= 0) return k; } return 'cobre'; }, a = pick(), b = pick(), n = 5 + Math.floor(rr() * 8);
    return a === b || rr() < 0.4 ? [{ type: a, n }] : [{ type: a, n: Math.ceil(n * 0.6) }, { type: b, n: Math.max(1, Math.floor(n * 0.4)) }];
  }
  // Mejoras de la base (máx. 4 niveles): vida, escudo que absorbe las balas, vida y daño de las torres. Coste del nivel lv+1 = COST[k](lv+1).
  const BASE_UP = {
    hp: { name: 'Vida de la base', max: 4, cost: n => ({ piedra: 8 * n, agua: 6 * n }) },
    sh: { name: 'Escudo de la base', max: 4, cost: n => ({ cobre: 6 * n, plata: 3 * n }) },
    tw: { name: 'Vida de las torres', max: 4, cost: n => ({ piedra: 6 * n, cobre: 4 * n }) },
    td: { name: 'Daño de las torres', max: 4, cost: n => ({ oro: 3 * n, plata: 3 * n }) },
  };
  const baseStats = up => ({ hpMax: 600 + 250 * (up.hp || 0), shMax: 300 * (up.sh || 0), twMax: 150 + 75 * (up.tw || 0), dmgMul: 1 + 0.4 * (up.td || 0) });
  // ARMAS: tabla única (cliente y servidor). kind: tipo de proyectil en la red ('p' plasma · 'c' munición · 'm' misil · 'r' haz) · type: 'proj' | 'homing' | 'beam'
  // spd km/s · cd s entre disparos (jit: ± fracción aleatoria; dbl/gap: probabilidad de disparo doble / pausa larga; burst/pause: ráfaga de n tiros y pausa en s)
  // dmg por impacto (× mejora de daño) o dps (haz, aplicado en pasos de `tick` s) · range km (torretas; buques, satélites y cazas usan el suyo de WARCFG)
  // col / core: color del proyectil y de su núcleo · trail: estela · snd: familia de sonido (audio.js) · ship: valores de las naves (clic izq. plasma, clic der./Espacio misil)
  const WEAPONS = {
    plasma:  { name: 'Plasma', kind: 'p', type: 'proj', spd: 12, cd: 0.9, jit: 0.45, dbl: 0.14, gap: 0.1, dmg: 4, range: 200, col: 0xff5a28, core: 0xffffff, trail: 'rayo', snd: 'plasma', desc: 'Rayo de energía rojo-anaranjado de cadencia irregular', ship: { spd: 6000, cd: 0.12, dmg: 8, life: 5 } },
    cannon:  { name: 'Munición', kind: 'c', type: 'proj', spd: 40, cd: 0.075, jit: 0.15, burst: 24, pause: 0.9, spread: 0.006, dmg: 0.9, range: 200, col: 0xffd23f, core: 0xfff6c8, trail: 'trazadora', snd: 'municion', desc: 'Minigun: ráfagas de balas trazadoras muy rápidas' },
    missile: { name: 'Misil guiado', kind: 'm', type: 'homing', spd: 6, cd: 3.5, jit: 0.12, dmg: 14, turn: 3, range: 200, col: 0xff8a3c, core: 0xffe0a0, trail: 'fuego', snd: 'misil', desc: 'Persigue al blanco dejando una estela de fuego', ship: { spd: 2500, cd: 3, dmg: 60, life: 20, turn: 6 } },
    rail:    { name: 'Cañón de riel', kind: 'r', type: 'beam', dps: 7, tick: 0.1, range: 200, col: 0x3d9bff, core: 0xe6f4ff, trail: 'haz', snd: 'riel', desc: 'Láser continuo instantáneo mientras vea al blanco' },
  };
  function weaponCd(w, st = {}, cd = w.cd) { // próxima espera (s) de un arma; st: estado del tirador (cuenta de la ráfaga) · cd: base propia (naves, buques, cazas)
    const j = 1 + (w.jit || 0) * (2 * Math.random() - 1), r = Math.random();
    if (w.burst) { st.bn = (st.bn || 0) + 1; if (st.bn >= w.burst) { st.bn = 0; return w.pause * j; } return cd * j; } // munición: ráfaga y pausa (el cañón rotativo se detiene)
    if (w.dbl && r < w.dbl) return cd * 0.18; // plasma: a veces un disparo doble...
    if (w.gap && r > 1 - w.gap) return cd * (2 + Math.random()); // ...y a veces una pausa larga
    return cd * j;
  }
  // Estilos de torreta: las 4 armas con su coste de desbloqueo; homing: misil guiado · beam: haz continuo (dps en vez de dmg + cd)
  const TOWER_STYLES = {
    plasma:  { ...WEAPONS.plasma, homing: false, cost: null },
    cannon:  { ...WEAPONS.cannon, homing: false, cost: { piedra: 10, cobre: 6 } },
    missile: { ...WEAPONS.missile, homing: true, cost: { oro: 6, plata: 6 } },
    rail:    { ...WEAPONS.rail, homing: false, beam: true, cost: { diamante: 3, oro: 8 } },
  };
  // ---------- ZONAS DE CONTROL (estilo mapa galáctico de Helldivers): TESELAN TODO EL PLANO ORBITAL, sin huecos, y cada una hace frontera con otras ----------
  // Anillos concéntricos alrededor de la estrella cuyos bordes son los puntos medios entre órbitas: núcleo (1 zona) · un anillo por planeta principal (4-6 sectores
  // angulares con desfase determinista) · «Confines» (6 sectores, sin límite exterior: cubre todo lo que queda fuera). Fijas respecto a la estrella (no siguen a los planetas,
  // que además apenas se mueven en una partida: sus años duran meses reales). Se reclaman permaneciendo dentro; reclamadas permiten desplegar buques y construir satélites.
  const WARCFG = {
    capRate: 100 / 15, capRateDanger: 100 / 30, // %/s de captura por unidad de presencia (≈ 15 s con presencia 1; ≈ 30 s en ZONA ROJA); el decaimiento guarda la misma proporción (½ disputada · 1 con el rival · ⅓ vacía)
    exclHg: 150000 * SYS_SCALE, exclWs: 100000 * SYS_SCALE, // ZONA ROJA (no se despliega): la zona que contiene un planeta con hangar enemigo o un buque enemigo, y las vecinas a las que llega ese radio
    starClear: 1000000, orbitClear: 80000 * SYS_SCALE, // no se despliega a menos de esto de la estrella (sin compactar: la estrella no cambia; el Núcleo, no reclamable, ya lo cubre) ni de la órbita de un planeta principal (sus lunas quedan dentro de ese margen)
    sectors: [4, 4, 5, 5, 6, 6, 6, 6], outerSectors: 6,
    starKill: { k: 3, tMax: 8, tMin: 1.5, reset: 1 }, // ZONA LETAL de la estrella: radio = máx(R★·(1+k), radio del Núcleo estelar); cuenta atrás clamp(tMax·d_superficie/(R_letal−R★), tMin, tMax) s; fuera se cancela tras `reset` s
    arrive: 6, alarmCd: 20, // s que tarda en LLEGAR una unidad desplegada (sale del viaje de luz) · s mínimos entre dos alarmas de un mismo buque
    approachKm: 300, // km a los que se despliegan/aproximan las unidades: sobre el borde del cúmulo y de altitud sobre el planeta (si su atmósfera es más alta, 6H + 30 km)
    presence: { W: 1, F: 0.5, S: 0.25 }, // presencia para reclamar zonas: un jugador dentro = 1 · cada buque desplegado = 1 · cada escuadrón de cazas = 0,5 (cuentan aunque su dueño no esté)
    gain: { n: 1, every: 10 }, // recursos pasivos: cada zona reclamada da a su dueño n unidades de su recurso cada `every` s (no salen de los cúmulos) // sectores de cada anillo de planeta (de dentro afuera) y de los Confines
    // buque de guerra (modelo de 3,46 km × scale = ~14 km); near: km junto a él que cuentan como «en base». Es la unidad de MÁS alcance del juego (cubre grandes espacios):
    // range 6000 km de detección y disparo (satélite 1200, cazas 3000, torres de base mucho menos) · spd 300 km/s (el servidor admite hasta 500) → a 6000 km tarda 20 s y el
    // proyectil vive l/spd·1,5 + 3 s (≤ 60) · hr 0,25 km: radio de espoleta de proximidad del proyectil (las demás torretas, 0,04-0,05) · cd 1,1 s entre disparos del buque,
    // que alternan entre las 3 torretas gemelas del costado que mira al blanco (cada torreta dispara cada 3,3 s, cañón izquierdo y derecho por turnos)
    ws: { max: 2, hp: 3000, sh: 1000, scale: 4, near: 32, range: 6000, dmg: 6, cd: 1.1, spd: 300, hr: 0.25, w: 'plasma', closeKm: 300, ammoRange: 300, ammoMinKm: 100, missileRange: 6000, ammo: { w: 'cannon', dmg: 1, cd: 0.09, spd: 400, hr: 0.1, spread: 0.004 }, missile: { w: 'missile', dmg: 20, cd: 4, spd: 150, hr: 0.25 }, cost: { oro: 40, diamante: 8, plata: 60, cobre: 100, piedra: 150 } },
    ftr: { max: 30, n: 3, hp: 60, dmg: 4, cd: 0.8, range: 3000, w: 'plasma', engage: 8000, patrol: 6000, vmax: 200, turn: 1.1, scale: 6, cost: { plata: 15, cobre: 30, piedra: 30 } }, // escuadrón de CAZAS: n cazas de hp cada uno (cada caza es una UNIDAD: icono, objetivo y daño propios), plasma ligero; vmax 200 km/s (< las naves de jugador), giro 1,1 rad/s, modelo ×6; patrullan patrol km en torno a su punto y atacan hasta engage km de él
    sat: { maxZone: 3, hp: 800, range: 1200, dmg: 20, cd: 4, spd: 50, w: 'missile', radar: 1500000, cost: { oro: 8, plata: 20, cobre: 40, piedra: 60 } }, // satélite defensivo (~1 km): misiles guiados de largo alcance
  };
  const TAU = Math.PI * 2;
  function genControlZones(sys) { // zonas: { id, name, ring, r0, r1 (Infinity en los Confines), a0 (ángulo inicial), da (amplitud), n (sectores del anillo), planet, res (recurso pasivo), noClaim (zona solar) } · zs.rings: [{ r0, r1, a0, n, first }]
    const r = mulberry((((sys.seed >>> 0) || 1) ^ 0x51c3a7) >>> 0 || 11), zs = [], rings = [], mains = sys.bodies.filter(b => b.k !== 'sun' && !b.parent), orb = mains.map(b => b.a * DS); // órbitas de dentro afuera
    const edges = [0, orb[0] / 2, ...orb.slice(1).map((o, k) => (orb[k] + o) / 2), orb[orb.length - 1] + (orb.length > 1 ? orb[orb.length - 1] - orb[orb.length - 2] : 1.5e6 * SYS_SCALE) / 2, Infinity];
    const ring = (k, n, name) => {
      const a0 = n > 1 ? r() * TAU / n : 0, da = TAU / n; rings.push({ r0: edges[k], r1: edges[k + 1], a0, n, first: zs.length });
      for (let j = 0; j < n; j++) zs.push({ id: zs.length, name: n > 1 ? `${name} · Sector ${j + 1}` : name, ring: k, r0: edges[k], r1: edges[k + 1], a0: a0 + j * da, da, n, planet: k >= 1 && k <= mains.length ? mains[k - 1].n : null });
    };
    ring(0, 1, 'Núcleo estelar'); zs[0].noClaim = true; // la zona del SOL no se puede reclamar (ni dar recursos, ni desplegar)
    mains.forEach((b, k) => ring(k + 1, WARCFG.sectors[Math.min(k, WARCFG.sectors.length - 1)], 'Anillo ' + b.n));
    ring(mains.length + 1, WARCFG.outerSectors, 'Confines');
    const r2 = mulberry((((sys.seed >>> 0) || 1) ^ 0x7e11a5) >>> 0 || 13), RW = ZONE_SEC_W, tot = Object.values(RW).reduce((a, b) => a + b, 0); // generador aparte: no altera la geometría
    for (const z of zs) if (!z.noClaim) { let x = r2() * tot; z.res = 'agua'; for (const k in RW) { x -= RW[k]; if (x <= 0) { z.res = k; break; } } } // recurso pasivo (los raros, menos frecuentes)
    zs.rings = rings; return zs;
  }
  function bodyPosAt(sys, i, t) { // posición de un cuerpo en el instante t (s de reloj real: igual que simT en game.js); la usa el servidor, que no simula las órbitas
    const b = sys.bodies[i]; if (!b || !b.a) return [0, 0, 0];
    const th = b.ph + 2 * Math.PI * t / (b.T * 86400);
    if (b.parent) { const o = bodyPosAt(sys, sys.bodies.findIndex(x => x.n === b.parent), t); return [o[0] + b.a * Math.cos(th), 0, o[2] + b.a * Math.sin(th)]; }
    return [b.a * DS * Math.cos(th), 0, b.a * DS * Math.sin(th)];
  }
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), angU = (x, z, a0) => ((Math.atan2(z, x) - a0) % TAU + TAU) % TAU; // ángulo relativo a a0 en [0, 2π)
  function czAt(sys, zs, pos) { // zona que contiene ese punto: SIEMPRE una (anillo por el radio en el plano x-z, sector por el ángulo; se ignora y)
    const R = zs.rings, rr = Math.hypot(pos[0], pos[2]); let k = 0; while (k < R.length - 1 && rr >= R[k].r1) k++;
    const g = R[k]; return g.n === 1 ? g.first : g.first + Math.min(g.n - 1, Math.floor(angU(pos[0], pos[2], g.a0) / (TAU / g.n)) || 0);
  }
  function czDist(z, P) { // distancia (plano x-z) de un punto a una zona (0 = dentro)
    const rr = Math.hypot(P[0], P[2]), rad = Math.max(0, z.r0 - rr, rr - z.r1); if (z.n === 1 || angU(P[0], P[2], z.a0) < z.da) return rad;
    let best = Infinity; for (const a of [z.a0, z.a0 + z.da]) { const dx = Math.cos(a), dz = Math.sin(a), t = Math.max(z.r0, Math.min(z.r1, P[0] * dx + P[2] * dz)); best = Math.min(best, Math.hypot(P[0] - dx * t, P[2] - dz * t)); } // fuera del sector: al borde radial más cercano
    return best;
  }
  const czCenter = z => { const rm = z.n === 1 ? 0 : z.r1 === Infinity ? z.r0 * 1.25 : (z.r0 + z.r1) / 2, am = z.a0 + z.da / 2; return [rm * Math.cos(am), 0, rm * Math.sin(am)]; }; // punto representativo (etiqueta, distancias)
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // Punto AUTOMÁTICO de despliegue (lo usan el mapa y el servidor) -> { a: cuerpo ancla, off: posición relativa a él, abs: posición absoluta en el instante t } o null.
  // at 'p': junto al planeta de la zona. Si el planeta tiene bases, sobre la vertical de la base (la mía; si solo hay rivales, la rival; con ambas, la más cercana a myPos),
  //   a WARCFG.approachKm (300 km) de altitud (si 6·H + 30 km es mayor, sobre la exosfera), ANCLADO AL PLANETA (viaja con él), en abanico de 60 km (> 3 × los 14 km del buque).
  //   Sin bases: igual, del lado de la estrella. · at 'c' (defecto): a 300 km del BORDE del cúmulo de la zona (anclado a la estrella).
  function czOrbitPoint(sys, z, idx) { // punto de reserva en un sector sin cúmulo ni planeta: en el ángulo central del sector, fuera del margen de la órbita de su planeta (anclado a la estrella)
    const b = sys.bodies.find(x => x.n === z.planet), am = z.a0 + z.da / 2 + ((idx % 8) - 3.5) * 0.02, rr = b ? b.a * DS + WARCFG.orbitClear + 20000 * SYS_SCALE + Math.floor(idx / 8) * 6000 : czCenter(z)[0] ? Math.hypot(...czCenter(z)) : z.r0 * 1.2;
    const o = [Math.round(rr * Math.cos(am)), 0, Math.round(rr * Math.sin(am))]; return { a: 0, off: o, abs: o };
  }
  function czDeployPoint(sys, czs, zones, zi, idx, at, t, bases, me, myPos) {
    const z = czs[zi]; if (!z || z.noClaim) return null; const j = idx % 8, sg = (j % 2 ? 1 : -1) * Math.ceil(j / 2); t = t || 0;
    if (at === 'p') { const bi = sys.bodies.findIndex((b, i) => b.k !== 'sun' && !b.parent && czAt(sys, czs, bodyPosAt(sys, i, t)) === zi); if (bi >= 0) {
      const b = sys.bodies[bi], P = bodyPosAt(sys, bi, t), hs = (bases || []).filter(h => h.b === b.n && Number.isFinite(h.la) && Number.isFinite(h.lo));
      if (hs.length) {
        const dirOf = h => [Math.cos(h.la) * Math.cos(h.lo), Math.sin(h.la), Math.cos(h.la) * Math.sin(h.lo)], mine = hs.filter(h => h.o === me), riv = hs.filter(h => h.o !== me), q = myPos || P;
        const h = mine.length && !riv.length ? mine[0] : riv.length && !mine.length ? riv[0] : hs.reduce((a, x) => d3(q, add3(P, dirOf(x).map(v => v * b.R))) < d3(q, add3(P, dirOf(a).map(v => v * b.R))) ? x : a);
        const u = dirOf(h), H = sys.atmo[b.n] ? sys.atmo[b.n].H : 0, rr = b.R + Math.max(WARCFG.approachKm, H ? 6 * H + 30 : 0), // 300 km de altitud (o sobre la exosfera si es más alta)
          e1 = nrm3(cross3(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross3(u, e1);
        const ring = idx ? Math.ceil(idx / 6) : 0, th = (idx - 1) * Math.PI / 3 + ring * 0.5, sp = 60 * ring; // abanico alrededor de la vertical de la base
        const pt = [0, 1, 2].map(i => u[i] * rr + (idx ? (e1[i] * Math.cos(th) + e2[i] * Math.sin(th)) * sp : 0)), L = Math.hypot(pt[0], pt[1], pt[2]), off = pt.map(v => Math.round(v / L * rr * 10) / 10);
        return { a: bi, off, abs: add3(P, off) };
      }
      const H = sys.atmo[b.n] ? sys.atmo[b.n].H : 0, rr = b.R + Math.max(WARCFG.approachKm, H ? 6 * H + 30 : 0), L0 = Math.hypot(P[0], P[2]) || 1, am = Math.atan2(-P[2] / L0, -P[0] / L0) + sg * 60 / rr; // sin bases: a 300 km de altitud del lado de la estrella, en abanico ecuatorial de 60 km, anclado al planeta
      const off = [Math.round(Math.cos(am) * rr * 10) / 10, Math.round(((Math.floor(idx / 8) % 2 ? -1 : 1) * Math.ceil(Math.floor(idx / 8) / 2) * 60) * 10) / 10, Math.round(Math.sin(am) * rr * 10) / 10];
      return { a: bi, off, abs: add3(P, off) }; } }
    const cl = zones.find(q => q.cz === zi); if (!cl) return at !== 'p' ? czDeployPoint(sys, czs, zones, zi, idx, 'p', t, bases, me, myPos) : czOrbitPoint(sys, z, idx); // zona sin cúmulo: junto a su planeta; si aún no ha llegado a ella, hacia fuera de la órbita de su anillo
    const cc = cl ? cl.off : czCenter(z), rad = cl ? cl.radius : 0;
    const a = Math.atan2(-cc[2], -cc[0]) + sg * 0.8, d = rad + WARCFG.approachKm + Math.floor(idx / 8) * 60, o = [Math.round(cc[0] + Math.cos(a) * d), 0, Math.round(cc[2] + Math.sin(a) * d)]; // del lado de la estrella y abriéndose a ambos lados
    return { a: 0, off: o, abs: o };
  }
  function czDanger(sys, zs, zi, me, hangars, ships, t, skipB) { // skipB: cuerpo cuyos hangares no cuentan (despliegue sobre la base rival para atacarla) // '' = segura; si no, por qué es ZONA ROJA. hangars: [{ o, b (nombre del planeta) }] · ships: [{ o, a, off }]
    const z = zs[zi];
    for (const h of hangars) if (h.o !== me) { const bi = sys.bodies.findIndex(x => x.n === h.b); if (bi >= 0 && bi !== skipB && czDist(z, bodyPosAt(sys, bi, t)) < WARCFG.exclHg) return 'ZONA ROJA: hangar enemigo en esta zona o junto a ella'; }
    for (const s of ships) if (s.o !== me && czDist(z, add3(bodyPosAt(sys, s.a, t), s.off)) < WARCFG.exclWs) return 'ZONA ROJA: buque de guerra enemigo en esta zona o junto a ella';
    return '';
  }
  // ¿Se puede desplegar en la zona zi en el punto off (km, ABSOLUTO respecto a la estrella, en el plano orbital)? '' = sí; si no, el motivo
  function czCheck(sys, zs, zi, off, me, owner, hangars, ships, t, anch, kind) { // buques, satélites y cazas: zonas propias o SIN DUEÑO (sus unidades la reclaman) y, en ataque, junto a un planeta con base rival · kind: reservado · off: posición ABSOLUTA · anch > 0: desplegado junto a ese planeta (anclado a él): sin la regla de órbita, fuera de su atmósfera
    const z = zs[zi]; if (!z || !Array.isArray(off) || off.length !== 3 || !off.every(Number.isFinite) || Math.abs(off[1]) > 5000) return 'Zona no válida';
    if (z.noClaim) return 'Zona solar: no se puede desplegar';
    const attack = (anch > 0 && hangars.some(h => h.o !== me && h.b === (sys.bodies[anch] || {}).n)) || (ships || []).some(s => s.o !== me && czDist(z, add3(bodyPosAt(sys, s.a, t), s.off)) < WARCFG.exclWs); // ATAQUE: junto a un planeta con base rival (o de bot) o donde hay un buque enemigo // ATAQUE: junto a un planeta con base rival (o de bot): vale aunque la zona sea suya o roja
    if (owner && owner !== me && !attack) return 'Zona de otro jugador: solo junto a su planeta con base (ataque)';
    if (czAt(sys, zs, off) !== zi && !(anch > 0 && czAt(sys, zs, bodyPosAt(sys, anch, t)) === zi)) return 'Fuera de la zona'; // anclado a un planeta: cuenta la zona del PLANETA (a 300 km de altitud el punto puede asomar al sector vecino si el planeta está junto al borde)
    const rr = Math.hypot(off[0], off[2]); if (rr < WARCFG.starClear) return 'Demasiado cerca de la estrella';
    if (anch > 0) { const b = sys.bodies[anch], H = sys.atmo[b.n] ? sys.atmo[b.n].H : 0; if (d3(off, bodyPosAt(sys, anch, t)) < b.R + 5.5 * H + 5) return 'Dentro de la atmósfera'; return attack ? '' : czDanger(sys, zs, zi, me, hangars, [], t, anch); }
    for (const b of sys.bodies) if (b.k !== 'sun' && !b.parent && Math.abs(rr - b.a * DS) < WARCFG.orbitClear) return `Demasiado cerca de la órbita de ${b.n}`;
    return attack ? '' : czDanger(sys, zs, zi, me, hangars, [], t); // los buques (propios o enemigos) ya no impiden desplegar
  }
  root.SYS_SCALE = SYS_SCALE; root.genSystem = genSystem; root.genZones = genZones; root.wreckLoot = wreckLoot; root.BASE_UP = BASE_UP; root.baseStats = baseStats; root.TOWER_STYLES = TOWER_STYLES; root.WEAPONS = WEAPONS; root.weaponCd = weaponCd;
  root.WARCFG = WARCFG; root.genControlZones = genControlZones; root.bodyPosAt = bodyPosAt; root.czAt = czAt; root.czCheck = czCheck; root.czDist = czDist; root.czCenter = czCenter; root.czDanger = czDanger; root.czDeployPoint = czDeployPoint;
  if (typeof module !== 'undefined') module.exports = { SYS_SCALE, genSystem, genZones, wreckLoot, BASE_UP, baseStats, TOWER_STYLES, WEAPONS, weaponCd, WARCFG, genControlZones, bodyPosAt, czAt, czCheck, czDist, czCenter, czDanger, czDeployPoint };
})(typeof window !== 'undefined' ? window : globalThis);
