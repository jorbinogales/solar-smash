// Sirve el juego y gestiona las salas (varias partidas a la vez, cada una con su código): menú principal (crear sala con vista previa del sistema, compartir enlace, lista de jugadores), lanzamiento,
// carga de la partida y retransmisión de estado y eventos de combate. El daño lo decide cada víctima; el servidor guarda hangares (vida de base y torretas).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { WebSocketServer } = require('ws');

const FILES = { '/': 'index.html', '/index.html': 'index.html', '/menu.js': 'menu.js', '/blobatar.js': 'blobatar.js', '/three.min.js': 'three.min.js', '/sw.js': 'sw.js', '/manifest.webmanifest': 'manifest.webmanifest', '/icons/icon-192.png': 'icons/icon-192.png', '/icons/icon-512.png': 'icons/icon-512.png', '/icons/icon.svg': 'icons/icon.svg', '/game': 'game.html', '/game.html': 'game.html', '/game.js': 'game.js', '/ships.js': 'ships.js', '/space.js': 'space.js', '/planets.js': 'planets.js', '/tview.js': 'tview.js', '/foot.js': 'foot.js', '/map.js': 'map.js', '/hangar.js': 'hangar.js', '/sysgen.js': 'sysgen.js', '/base.js': 'base.js', '/bot.js': 'bot.js', '/neutral.js': 'neutral.js', '/icons.js': 'icons.js', '/war.js': 'war.js', '/audio.js': 'audio.js', '/models.js': 'models.js' };
const { genSystem, genZones, wreckLoot, BASE_UP, baseStats, TOWER_STYLES, WEAPONS, WARCFG, genControlZones, czAt, czCheck, czDanger, bodyPosAt, czDeployPoint } = require('./sysgen');
const SHIPTAB = (() => { const src = fs.readFileSync(path.join(__dirname, 'ships.js'), 'utf8'), grab = re => (src.match(re) || [''])[0], vm = require('vm'), c = vm.createContext({}); // TYPES / ADDONS / UPGRADE_COST / SHIP_COST de ships.js (sin duplicarlos): los usan los bots para mejorar su nave
  vm.runInContext(grab(/const TYPES = \{[\s\S]*?\n\};/) + '\n' + grab(/const ADDONS = \[[\s\S]*?\n\];/) + '\n' + grab(/const UPGRADE_COST = .*/) + '\n' + grab(/const SHIP_COST = .*/) + '\nthis.T = { TYPES, ADDONS, UPGRADE_COST, SHIP_COST };', c); return c.T; })();
// ---------- ECONOMÍA DE LOS BOTS (solo servidor): inventario por bot, ingresos (zonas + minería de su cúmulo más cercano) y decisiones cada 8-15 s ----------
const BOT_ECO = { mineEvery: 8000, mineN: [1, 2], think: [8000, 15000], ftrMax: 6, satMax: 6, bmineEvery: 5000, bmineN: [2, 3], bmineKm: 2000, roles: [['corsario', 'saeta', 'fantasma', 'titan'], ['centinela', 'coloso', 'titan', 'nomada']] }; // roles: 0 agresivo (bots pares), 1 defensivo (impares): orden de naves que desbloquean
const HG_HP = 600, TW_HP = 150; // hangar: dueño -> { o, nm, b (planeta), la, lo (rad), hp, tw[4], bot }: un planeta = un hangar
const rooms = new Map(); // código -> sala: { code, name, seed, np, fillBots, phase, host (token), launchAt, SYS, SOLID, zones, zr, looted, members (token -> jugador), lobby (id de conexión -> jugador ya en la página del juego), hangars, botPlanets, players, bots, deadWrecks, nextBot }
// zones: zonas de recursos de la semilla (sysgen.genZones); zr[z][k]: lo que queda del recurso dominante k de la zona z (el servidor es quien lo descuenta)
const setSystem = (R, seed, np) => { R.seed = seed; R.np = np; R.t0 = Math.floor(Date.now() / 1000); R.SYS = genSystem(seed, np); R.SOLID = new Set(R.SYS.bodies.filter(b => b.k !== 'sun').map(b => b.n)); R.zones = genZones(R.SYS, R.t0); R.zr = R.zones.map(z => z.dominant.map(d => d.budget)); R.czs = genControlZones(R.SYS); R.cz = R.czs.map(() => ({ o: 0, c: 0, p: 0 })); R.wships = new Map(); R.sats = new Map(); R.wn = 0; R.fighters = new Map(); R.fn = 0; R.fs = []; }; // fighters: escuadrones de cazas id (7000+) -> { id, o, zi, off, hp[n] } · fs: posiciones de los cazas (las simula el anfitrión) // t0: instante común de la sala para los cúmulos (sin cúmulo en los sectores con planeta)
// zonas de control: cz[i] = { o: dueño (id de jugador, 0 = nadie), c: quien la está reclamando, p: progreso 0-100 } · wships/sats: id -> { id, o, zi, a (cuerpo ancla), off, hp, sh, shT, on }
const dropWar = (R, id) => { if (R.czLast) R.czLast.delete(id); for (const M of [R.wships, R.sats, R.fighters]) for (const [k, s] of [...M]) if (s.o === id) M.delete(k); for (const Z of R.cz) { if (Z.o === id) Z.o = 0; if (Z.c === id) { Z.c = 0; Z.p = 0; } } }; // el jugador se fue: sus zonas quedan libres
function claimHome(R) { // al crear las bases: la zona que contiene el planeta de cada JUGADOR queda reclamada por él y su recurso pasa a AGUA (único sitio donde se fuerza; viaja a los clientes en la fila `cz`); la de un BOT queda controlada por el bot
  const t = Date.now() / 1000; R.czRes = R.czRes || {};
  for (const h of [...R.hangars.values()].sort((a, b) => a.o - b.o)) { const bi = R.SYS.bodies.findIndex(b => b.n === h.b); if (bi < 0) continue; const zi = czAt(R.SYS, R.czs, bodyPosAt(R.SYS, bi, t)), Z = R.cz[zi]; if (!Z || R.czs[zi].noClaim || Z.o) continue; // humanos primero (ids < 1000); si dos comparten zona, el primero
    Z.o = h.o; Z.c = 0; Z.p = 0; if (h.o < 1000) { R.czs[zi].res = 'agua'; R.czRes[zi] = 'agua'; } else (R.homeZ = R.homeZ || new Set()).add(zi); }
}
function deployUnit(R, id, k, zi, at) { // despliegue de una unidad de `id` (jugador o bot): mismas reglas para todos (sysgen.czDeployPoint / czCheck). '' = hecho; si no, el motivo
  const M = k === 'W' ? R.wships : k === 'S' ? R.sats : R.fighters, mine = [...M.values()].filter(s => s.o === id), t = Date.now() / 1000;
  const idx = [...R.wships.values(), ...R.sats.values(), ...R.fighters.values()].filter(s => s.zi === zi).length, dp = czDeployPoint(R.SYS, R.czs, R.zones, zi, idx, at === 'p' ? 'p' : 'c', t, [...R.hangars.values()], id, (R.players.get(id) || {}).pos);
  const why = (k === 'W' ? (mine.length >= WARCFG.ws.max ? `Máximo ${WARCFG.ws.max} buques desplegados` : '') : k === 'F' ? (mine.length >= (id >= 1000 ? BOT_ECO.ftrMax : WARCFG.ftr.max) ? `Máximo ${WARCFG.ftr.max} escuadrones de cazas` : '') : (mine.filter(s => s.zi === zi).length >= WARCFG.sat.maxZone ? `Máximo ${WARCFG.sat.maxZone} satélites por zona` : ''))
    || (dp ? czCheck(R.SYS, R.czs, zi, dp.abs, id, R.cz[zi].o, [...R.hangars.values()], [...R.wships.values()], t, dp.a, k) : 'Zona solar: no se puede desplegar');
  if (why) return why; const sid = (k === 'W' ? 5000 : k === 'S' ? 6000 : 7000) + ((k === 'F' ? R.fn++ : R.wn++) % 1000), o3 = dp.off;
  M.set(sid, k === 'F' ? { id: sid, o: id, zi, a: dp.a, off: o3, ar: Date.now() + WARCFG.arrive * 1000, hp: Array(WARCFG.ftr.n).fill(WARCFG.ftr.hp) } : { id: sid, o: id, zi, a: dp.a, off: o3, ar: Date.now() + WARCFG.arrive * 1000, hp: k === 'W' ? WARCFG.ws.hp : WARCFG.sat.hp, sh: k === 'W' ? WARCFG.ws.sh : 0, shT: 0, on: 1 });
  return '';
}
const canPayB = (R, o, c) => R.mode === 'creative' || !c || Object.entries(c).every(([k, n]) => (R.botRes[o][k] || 0) >= n);
const payB = (R, o, c) => { if (R.mode === 'creative' || !c) return; for (const [k, n] of Object.entries(c)) R.botRes[o][k] -= n; };
function botTick(R, now) { // bots con hangar: minería de su cúmulo más cercano y una decisión cada 8-15 s (despliegue > mejora de base > mejora de nave); gastan todo lo que necesiten
  const t = now / 1000;
  for (const h of R.hangars.values()) {
    const o = h.o, E = R.botEco && R.botEco[o]; if (o < 1000 || !E || !R.botRes[o]) continue; const bi = R.SYS.bodies.findIndex(b => b.n === h.b); if (bi < 0) continue; const P = bodyPosAt(R.SYS, bi, t), res = R.botRes[o];
    const sh = R.bots.get(o - 1000); if (sh && sh.hp > 0 && !sh.wp && Array.isArray(sh.pos) && now >= (E.bmT || 0)) { // MINERÍA VISIBLE: su nave dentro de un cúmulo con recursos «destruye» un asteroide cada 5 s (lo concede y descuenta de zr; fogonazo para todos)
      const zi = R.zones.findIndex((z, i) => R.zr[i].some(n => n > 0) && Math.hypot(...[0, 1, 2].map(k => bodyPosAt(R.SYS, z.anchor, t)[k] + z.off[k] - sh.pos[k])) < z.radius + BOT_ECO.bmineKm);
      if (zi >= 0) { E.bmT = now + BOT_ECO.bmineEvery; const left = R.zr[zi], tot = left.reduce((a, b) => a + b, 0); let u = Math.random() * tot, k = 0; while (u > left[k] && k < left.length - 1) u -= left[k++]; const n = Math.min(left[k], BOT_ECO.bmineN[0] + Math.floor(Math.random() * (BOT_ECO.bmineN[1] - BOT_ECO.bmineN[0] + 1))), ty = R.zones[zi].dominant[k].type; left[k] -= n; res[ty] = (res[ty] || 0) + n;
        bcast(R, { ev: { t: 'bmine', o, pos: sh.pos.map((c, q) => c + (Math.random() - 0.5) * 6), id: 0 } }); } }
    if (now >= E.mineT) { E.mineT = now + BOT_ECO.mineEvery; // MINERÍA: el cúmulo con recursos más cercano a su planeta; tipo ponderado por lo que queda (lo escaso sale menos) y se descuenta del cúmulo (zr)
      const cl = R.zones.map((z, i) => ({ i, d: Math.hypot(bodyPosAt(R.SYS, z.anchor, t)[0] + z.off[0] - P[0], bodyPosAt(R.SYS, z.anchor, t)[2] + z.off[2] - P[2]) })).sort((a, b) => a.d - b.d).find(c => R.zr[c.i].some(n => n > 0));
      if (cl) { const left = R.zr[cl.i], tot = left.reduce((a, b) => a + b, 0); let u = Math.random() * tot, k = 0; while (u > left[k] && k < left.length - 1) u -= left[k++]; const n = Math.min(left[k], BOT_ECO.mineN[0] + Math.floor(Math.random() * (BOT_ECO.mineN[1] - BOT_ECO.mineN[0] + 1))); left[k] -= n; const ty = R.zones[cl.i].dominant[k].type; res[ty] = (res[ty] || 0) + n; } }
    if (now < E.thinkT || R.phase !== 'playing') continue; E.thinkT = now + BOT_ECO.think[0] + Math.random() * (BOT_ECO.think[1] - BOT_ECO.think[0]); E.last = botThink(R, h, bi, P, t) || E.last;
  }
}
function botThink(R, h, bi, P, t) { // → texto de la acción hecha (o '')
  const o = h.o, byDist = zi => Math.hypot(...[0, 2].map(i => { const z = R.czs[zi], a = z.a0 + z.da / 2, r = Number.isFinite(z.r1) ? (z.r0 + z.r1) / 2 : z.r0 * 1.2, c = [r * Math.cos(a), 0, r * Math.sin(a)]; return c[i] - P[i]; }));
  const free = R.czs.map((z, i) => i).filter(i => !R.czs[i].noClaim && !R.cz[i].o).sort((a, b) => byDist(a) - byDist(b)).slice(0, 8); // zonas SIN DUEÑO más cercanas a su planeta: sus unidades las reclaman
  const foes = [...R.hangars.values()].filter(x => x.o < 1000).map(x => ({ x, zi: czAt(R.SYS, R.czs, bodyPosAt(R.SYS, R.SYS.bodies.findIndex(b => b.n === x.b), t)) })).sort((a, b) => byDist(a.zi) - byDist(b.zi)); // bases humanas (ataque junto a su planeta)
  const tryDep = (k, list) => { for (const [zi, at] of list) if (!deployUnit(R, o, k, zi, at)) return `${k}@${zi}`; return ''; };
  const nW = [...R.wships.values()].filter(s => s.o === o).length, nS = [...R.sats.values()].filter(s => s.o === o).length, E = R.botEco[o];
  const dep = () => { for (const [k, cost] of [['W', WARCFG.ws.cost], ['F', WARCFG.ftr.cost], ['S', WARCFG.sat.cost]]) if (canPayB(R, o, cost) && !(k === 'S' && nS >= BOT_ECO.satMax)) { // (i) DESPLEGAR: buque > cazas > satélite
      const list = k === 'W' && nW >= 1 ? [...foes.map(f => [f.zi, 'p']), ...free.map(z => [z, 'c'])] : [...free.map(z => [z, 'c']), ...(k === 'S' ? [] : foes.map(f => [f.zi, 'p']))]; // el 2.º buque va a ATACAR una base humana
      const d = tryDep(k, list); if (d) { payB(R, o, cost); return 'despliega ' + d; } } return ''; };
  const base = () => {
    const up = Object.entries(BASE_UP).filter(([k, u]) => (h.up[k] || 0) < u.max).map(([k, u]) => [k, u.cost((h.up[k] || 0) + 1)]).filter(([, c]) => canPayB(R, o, c)).sort((a, b) => Object.values(a[1]).reduce((x, y) => x + y, 0) - Object.values(b[1]).reduce((x, y) => x + y, 0))[0]; // (ii) BASE: la mejora más barata que pueda pagar
    if (up) { payB(R, o, up[1]); h.up[up[0]]++; if (up[0] === 'hp') h.hp += 250; else if (up[0] === 'sh') h.sh += 300; else if (up[0] === 'tw') h.tw = h.tw.map(v => v > 0 ? v + 75 : v); return 'base ' + up[0]; }
    const sty = Object.entries(TOWER_STYLES).filter(([k, st]) => st.cost && !E.styles.has(k) && canPayB(R, o, st.cost)).sort((a, b) => Object.values(b[1].cost).reduce((x, y) => x + y, 0) - Object.values(a[1].cost).reduce((x, y) => x + y, 0))[0];
    if (sty) { payB(R, o, sty[1].cost); E.styles.add(sty[0]); h.ts = h.ts.map((v, i) => i % 2 ? sty[0] : v); return 'torretas ' + sty[0]; } return ''; }; // la mitad de sus torretas pasan al estilo nuevo (mezcla)
  const ship = () => {
    const role = BOT_ECO.roles[(o - 1000) % 2], nx = role.find(n => !E.ships.has(n) && SHIPTAB.SHIP_COST[n] && canPayB(R, o, SHIPTAB.SHIP_COST[n])); // (iii) NAVE: siguiente chasis de su rol
    if (nx) { payB(R, o, SHIPTAB.SHIP_COST[nx]); E.ships.add(nx); h.sp = { t: nx, a: [0, 0, 0, 0, 0, 0] }; return 'nave ' + nx; }
    const ai = SHIPTAB.ADDONS.map((d, i) => i).filter(i => h.sp.a[i] < SHIPTAB.ADDONS[i].max && canPayB(R, o, SHIPTAB.UPGRADE_COST[i](h.sp.a[i] + 1)))[0]; // o la primera mejora que pueda pagar
    if (ai !== undefined) { payB(R, o, SHIPTAB.UPGRADE_COST[ai](h.sp.a[ai] + 1)); h.sp.a[ai]++; return 'mejora ' + SHIPTAB.ADDONS[ai].id; } return ''; };
  const acts = [dep, base, ship], k0 = (E.turn = (E.turn ?? -1) + 1) % 3; // prioridad despliegue > base > nave, pero la categoría inicial rota en cada decisión: con muchos recursos también mejora
  for (let q = 0; q < 3; q++) { const r = acts[(k0 + q) % 3](); if (r) return r; }
  return '';
}
function czTick(R, now) { // captura: un único jugador (vivo) dentro de una zona que no es suya la reclama; con su buque dentro va 1,5× más rápido. Con otro jugador dentro baja a la mitad; sin nadie, a un tercio
  const dt = Math.min(0.5, (now - (R.czT || now)) / 1000), t = now / 1000, base = WARCFG.capRate, share = R.czs.map(() => new Map()); R.czT = now; R.czLast = R.czLast || new Map();
  for (const p of R.players.values()) if (p.hp > 0 && R.lobby.has(p.id) && !p.wp && !(p.v > 20000)) { const zi = czAt(R.SYS, R.czs, p.pos, t); share[zi].set(p.id, (share[zi].get(p.id) || 0) + 1); } // presencia de los jugadores: solo fuera de la velocidad luz (ni en el salto ni en su cuenta atrás: wp)
  for (const [bi, b] of R.bots) if (b.hp > 0 && !b.wp && !(b.v > 20000) && R.hangars.has(1000 + bi) && Array.isArray(b.pos)) { const zi = czAt(R.SYS, R.czs, b.pos, t); share[zi].set(1000 + bi, (share[zi].get(1000 + bi) || 0) + 1); } // la NAVE de cada bot también reclama (presencia 1 a nombre de su hangar), salvo en velocidad luz o muerta
  for (const [M, w] of [[R.wships, WARCFG.presence.W], [R.fighters, WARCFG.presence.F], [R.sats, WARCFG.presence.S]]) for (const u of M.values()) if (!(u.ar > now) && share[u.zi]) share[u.zi].set(u.o, (share[u.zi].get(u.o) || 0) + w); // las UNIDADES reclaman: presencia de su dueño aunque él no esté (no las que aún llegan)
  R.cz.forEach((Z, zi) => {
    if (R.czs[zi].noClaim) { Z.o = Z.c = Z.p = 0; return; } // zona solar: no reclamable
    if (Z.o >= 1000 && !R.hangars.has(Z.o)) Z.o = 0; // bot sin hangar: su zona queda libre
    if (Z.o >= 1000 && R.homeZ && R.homeZ.has(zi)) { Z.c = Z.p = 0; return; } // zona INICIAL de un bot: no se captura mientras exista su hangar (las que reclamen sus unidades, sí)
    const pr = [...share[zi]].sort((x, y) => y[1] - x[1]), lead = pr[0], margin = lead ? lead[1] - (pr[1] ? pr[1][1] : 0) : 0; // presencia de cada dueño; avanza el que más tiene, al ritmo de su ventaja
    if (lead && lead[0] !== Z.o && margin > 0) { const id0 = lead[0]; if (Z.c !== id0) { Z.c = id0; Z.p = 0; } Z.p += (czDanger(R.SYS, R.czs, zi, id0, [...R.hangars.values()], [...R.wships.values()], t) ? WARCFG.capRateDanger : base) * margin * dt; if (Z.p >= 100) { Z.o = Z.c; Z.c = 0; Z.p = 0; } } // solo: su presencia · disputada: la ventaja sobre el segundo // más lento en ZONA ROJA
    else if (Z.c) { Z.p -= base * (pr.length > 1 ? 0.5 : pr.length ? 1 : 1 / 3) * dt; if (Z.p <= 0) { Z.c = 0; Z.p = 0; } } // la zona ya reclamada no se pierde si queda vacía
  });
  const slot = Math.floor(now / (WARCFG.gain.every * 1000)); // recursos pasivos: al cambiar de franja (cada 10 s de reloj real, igual en todos los clientes) cada dueño conectado recibe lo de sus zonas
  if (R.czSlot !== undefined && slot !== R.czSlot) R.cz.forEach((Z, zi) => { const z = R.czs[zi]; if (!Z.o || z.noClaim || !z.res) return; if (R.botRes && R.botRes[Z.o]) R.botRes[Z.o][z.res] = (R.botRes[Z.o][z.res] || 0) + WARCFG.gain.n; for (const cl of wss.clients) if (cl.R === R && cl.pid === Z.o) send(cl, { zgain: 1, zi, type: z.res, n: WARCFG.gain.n }); });
  R.czSlot = slot;
  for (const s of R.sats.values()) s.on = !R.cz[s.zi].o || R.cz[s.zi].o === s.o || s.a > 0 ? 1 : 0; // activo en zona propia o sin dueño, y en ataque (anclado al planeta rival); se desactiva si otro reclama la zona
  for (const s of R.wships.values()) if (now - s.shT > 6000 && s.sh < WARCFG.ws.sh) s.sh = Math.min(WARCFG.ws.sh, s.sh + 25 * dt); // escudo del buque: se regenera sin recibir golpes
}
const MINE_MAX = 60, MINE_GAP_MS = 100; // anti-trampas básico: unidades máximas de un recurso por asteroide y separación mínima entre extracciones de un mismo cliente
const COLORS = [0x4db8ff, 0xff6a3c, 0x5dff8a, 0xffd23f, 0xd06bff, 0xf2f2f2, 0xff5fa2, 0x3ff0e0];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const byToken = tk => { for (const R of rooms.values()) if (tk && R.members.has(tk)) return R; return null; };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const tk = new URL(req.url, 'http://x').searchParams.get('token') || '', R = byToken(tk);
  if (u === '/api/me') return res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ok: !!(R && R.phase !== 'lobby') })); // la página del juego solo arranca si eres jugador de una partida
  if (u === '/seed.js') return res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(`const SEED = ${R ? R.seed : 1}, NPL = ${R ? R.np : 4}, T0 = ${R ? R.t0 : 0};`); // el sistema es el de TU sala
  const f = FILES[u];
  if (!f) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
});

const WRECKS = 32, WRECK_RESPAWN_MS = 90000;
const RATE = { f: [300, 450], r: [80, 120] }; // límite por conexión (eventos/s, ráfaga máx.): disparos (el anfitrión retransmite bots, neutrales, cazas y torretas-minigun) · pasos de haz
function rate(ws, k) { const [r, cap] = RATE[k], now = Date.now(), b = ws.rl || (ws.rl = {}), s = b[k] || (b[k] = { n: cap, t: now }); s.n = Math.min(cap, s.n + (now - s.t) / 1000 * r); s.t = now; if (s.n < 1) return false; s.n--; return true; } // cubo de fichas: lo que excede se descarta en silencio
const wss = new WebSocketServer({ server, maxPayload: 65536 }); let nextId = 0; // 64 KB: el estado de los cazas ('fs', hasta 30 escuadrones × 3 por jugador) cabe con margen · // 8 KB: el estado de hasta 36 naves neutrales ('ns') cabe con margen
const idInUse = id => [...wss.clients].some(c => c.pid === id) || [...rooms.values()].some(R => R.lobby.has(id) || R.hangars.has(id) || R.players.has(id));
const newPid = () => { for (let k = 0; k < 999; k++) { nextId = nextId % 999 + 1; if (!idInUse(nextId)) return nextId; } return nextId; }; // ids de jugador SIEMPRE 1-999 (reutilizando los libres): 1000+ = hangares de bots, 2000+ = bots, 3000+ = neutrales. Antes crecían sin fin y tras ~1000 conexiones un jugador pasaba por bot
const SHIPS = ['saeta', 'halcon', 'coloso', 'nomada', 'centinela', 'fantasma', 'corsario', 'titan']; // mismo orden que TYPES en ships.js (las 4 primeras las usan las naves neutrales por índice)
const spec = sp => ({ t: SHIPS.includes(sp && sp.t) ? sp.t : 'halcon', a: Array.from({ length: 6 }, (_, i) => Math.max(0, Math.min(3, Math.round(Number(sp && sp.a && sp.a[i]) || 0)))), c: Number.isFinite(sp && sp.c) ? (sp.c >>> 0) & 0xffffff : 0x4db8ff, sk: Math.max(0, Math.min(5, Math.round(Number(sp && sp.sk)) || 0)) });
const num = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (R, o) => { const s = JSON.stringify(o); for (const c of wss.clients) if (c.R === R && c.readyState === 1) c.send(s); }; // solo a los jugadores de esa sala
const relay = (R, from, ev) => { const s = JSON.stringify({ ev: { ...ev, id: from } }); for (const c of wss.clients) if (c.R === R && c.readyState === 1 && c.pid !== from) c.send(s); };
const admin = R => { const h = R.members.get(R.host); return h && h.id != null && R.lobby.has(h.id) ? h.id : Math.min(Infinity, ...R.lobby.keys()); }; // el anfitrión simula a los bots
const stateOf = (id, m, name) => ({ id, name: String(name).slice(0, 20), pos: m.pos, q: m.q, v: m.v, hp: m.hp, sh: Number.isFinite(m.sh) ? m.sh : 0, sp: spec(m.sp), lv: Number.isInteger(m.lv) ? Math.max(0, Math.min(20, m.lv)) : 0, k: Number.isInteger(m.k) ? Math.max(0, Math.min(9999, m.k)) : 0, d: Number.isInteger(m.d) ? Math.max(0, Math.min(9999, m.d)) : 0, pk: m.pk ? 1 : 0, bt: Number.isFinite(m.bt) ? Math.max(0, Math.min(1, m.bt)) : 0, rb: Number.isInteger(m.rb) ? m.rb : -1, rp: num(m.rp, 3) ? m.rp : null, ms: Number.isFinite(m.ms) ? m.ms : 0, wp: m.wp ? 1 : 0 }); // lv: nivel de la nave que pilota (0-20)
// naves neutrales (neutral.js, las simula el anfitrión): fila compacta [id, grupo, cuerpo ancla, rx, ry, rz, qx, qy, qz, qw, v, hp %, esc %, tipo (índice de SHIPS), nivel, hostil]
const LOOT_OK = ['agua', 'piedra', 'cobre', 'plata', 'oro'], clampN = (x, a, b) => Math.max(a, Math.min(b, x));
const neuRow = (R, e) => Array.isArray(e) && e.length === 16 && e.every(Number.isFinite) && e[0] >= 3000 && e[0] < 4000 && Number.isInteger(e[2]) && e[2] >= 0 && e[2] < R.SYS.bodies.length && Number.isInteger(e[13]) && e[13] >= 0 && e[13] < SHIPS.length
  ? e.map((x, i) => i === 11 || i === 12 ? clampN(Math.round(x), 0, 100) : i === 14 ? clampN(Math.round(x), 1, 20) : i === 15 ? (x ? 1 : 0) : x) : null;
const neuLoot = l => (Array.isArray(l) ? l : []).slice(0, 3).filter(it => it && LOOT_OK.includes(it.type) && Number.isInteger(it.n) && it.n >= 1 && it.n <= 20).map(it => ({ type: it.type, n: it.n }));
const planetFree = (R, b, id) => ![...R.lobby].some(([i, e]) => i !== id && e.b === b) && ![...R.hangars.values()].some(h => h.b === b && h.o !== id) && ![...R.botPlanets.values()].some(x => x.b === b);
const makeHangar = (R, id, e) => { if (id >= 1000) { R.botRes = R.botRes || {}; R.botRes[id] = { ...(R.start || {}) }; R.botEco = R.botEco || {}; R.botEco[id] = { mineT: Date.now() + BOT_ECO.mineEvery, thinkT: Date.now() + BOT_ECO.think[0], styles: new Set(['plasma']), ships: new Set(['halcon']) }; } return R.hangars.set(id, { o: id, nm: e.nm, b: e.b, la: e.la, lo: e.lo, hp: HG_HP, sh: 0, shT: 0, up: { hp: 0, sh: 0, tw: 0, td: 0 }, ts: ['plasma', 'plasma', 'plasma', 'plasma'], tw: [TW_HP, TW_HP, TW_HP, TW_HP], bot: id >= 1000, sp: id >= 1000 ? { t: 'halcon', a: [0, 0, 0, 0, 0, 0] } : undefined }); }; // sp: nave del bot (chasis y mejoras), la aplica el anfitrión
const mainPlanets = R => R.SYS.bodies.filter(b => b.k !== 'sun' && !b.parent).map(b => b.n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hk = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return h >>> 0; }; // huella corta del token (para saber quién eres sin revelarlo)
const RES_KEYS = ['agua', 'piedra', 'cobre', 'plata', 'oro', 'diamante'], START_DEF = { agua: 10, piedra: 10, cobre: 10, plata: 0, oro: 0, diamante: 0 };
const cleanStart = s => { const o = {}; for (const k of RES_KEYS) { const v = Math.round(Number(s && s[k])); o[k] = Number.isFinite(v) ? Math.max(0, Math.min(9999, v)) : START_DEF[k]; } return o; }; // recursos iniciales del modo normal (por defecto 10 de cobre, piedra y agua)
const publicRoom = R => R && { code: R.code, name: R.name, mode: R.mode, start: R.start, seed: R.seed, np: R.np, fillBots: R.fillBots, phase: R.phase, members: [...R.members.values()].map(m => ({ nm: m.nm, col: m.col, hk: hk(m.token), host: m.token === R.host, av: m.av || '', pick: m.pick || null })) };
const closeRoom = R => { rooms.delete(R.code); for (const c of wss.clients) if (c.R === R) { c.R = null; send(c, { rm: null }); } }; // avisa a quien seguía dentro
const cleanAv = s => String(s || '').replace(/[^\w\-.@ ]/g, '').slice(0, 24);
const cleanName = (s, d) => String(s || d).replace(/[<>&"]/g, '').slice(0, 16) || d;
const newMember = (ws, m, id, idx) => ({ token: ws.token, nm: cleanName(m.nm, 'Piloto'), av: cleanAv(m.av), pick: null, col: COLORS[idx % COLORS.length], id, b: null, la: null, lo: null, ld: 0, siteOk: false });
const dropMember = (R, tk) => { R.members.delete(tk); if (R.host === tk) { const nx = R.members.keys().next().value; if (nx) R.host = nx; else closeRoom(R); } }; // salir de la sala de espera (si era el anfitrión pasa al siguiente)

wss.on('connection', ws => {
  const id = ws.pid = newPid(); ws.token = null; ws.R = null;
  send(ws, { id });
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw); let R = ws.R; const e = R && R.lobby.get(id);
      // ----- menú principal: crear sala, unirse con código, ajustes, iniciar -----
      if (m.t === 'hi') { ws.token = String(m.token || '').slice(0, 40); R = byToken(ws.token); ws.R = R; const mem = R && R.members.get(ws.token); if (mem && R.phase === 'lobby') mem.id = id; return send(ws, { hi: 1, member: !!mem }); }
      if (m.t === 'create') {
        ws.token = String(m.token || '').slice(0, 40); if (!ws.token) return; const old = byToken(ws.token); if (old) { if (old.phase !== 'lobby') return send(ws, { created: 0, why: 'Ya estás en una partida.' }); dropMember(old, ws.token); }
        const np = Math.max(2, Math.min(8, Math.round(Number(m.np) || 4))), seed = Number.isInteger(m.seed) && m.seed > 0 ? m.seed : 1 + Math.floor(Math.random() * 2e9);
        let code; do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (code.length < 5 || rooms.has(code));
        R = { code, name: String(m.name || 'Sala').replace(/[<>&"]/g, '').slice(0, 28), fillBots: true, mode: m.mode === 'creative' ? 'creative' : 'normal', start: cleanStart(m.start), phase: 'lobby', host: ws.token, launchAt: 0, members: new Map(), lobby: new Map(), hangars: new Map(), botPlanets: new Map(), players: new Map(), bots: new Map(), deadWrecks: new Map(), looted: new Set(), nextBot: 0 };
        setSystem(R, seed, np); rooms.set(code, R); ws.R = R; R.members.set(ws.token, newMember(ws, m, id, 0));
        console.log(`Sala "${R.name}" (${code}) creada · ${np} planetas · semilla ${seed} · ${rooms.size} salas`); return send(ws, { created: 1, code });
      }
      if (m.t === 'join') {
        ws.token = String(m.token || '').slice(0, 40); const T = rooms.get(String(m.code || '').trim().toUpperCase()); if (!T) return send(ws, { joined: 0, why: 'No existe ninguna sala con ese código.' });
        let mem = T.members.get(ws.token);
        if (!mem) { if (T.phase !== 'lobby') return send(ws, { joined: 0, started: 1, why: 'La partida ya ha sido iniciada.' }); if (T.members.size >= T.np) return send(ws, { joined: 0, why: 'La sala está llena.' }); const old = byToken(ws.token); if (old && old !== T) { if (old.phase !== 'lobby') return send(ws, { joined: 0, why: 'Ya estás en otra partida.' }); dropMember(old, ws.token); } mem = newMember(ws, m, id, T.members.size); T.members.set(ws.token, mem); }
        ws.R = T; mem.id = id; mem.nm = cleanName(m.nm, mem.nm); if (m.av) mem.av = cleanAv(m.av); return send(ws, { joined: 1, host: T.host === ws.token });
      }
      if (!R && m.t !== 'resume') return;
      if (m.t === 'cfg' && R.phase === 'lobby' && ws.token === R.host) { // el anfitrión cambia planetas / semilla / bots antes de empezar
        if (Number.isInteger(m.np)) { const np = Math.max(Math.max(2, R.members.size), Math.min(8, m.np)); if (np !== R.np || (Number.isInteger(m.seed) && m.seed !== R.seed)) { for (const x of R.members.values()) x.pick = null; setSystem(R, Number.isInteger(m.seed) && m.seed > 0 ? m.seed : R.seed, np); } }
        if (typeof m.fillBots === 'boolean') R.fillBots = m.fillBots; return;
      }
      if (m.t === 'pf' && R.phase === 'lobby' && R.members.has(ws.token)) { const x = R.members.get(ws.token); if (typeof m.nm === 'string') x.nm = cleanName(m.nm, x.nm); if (typeof m.av === 'string') x.av = cleanAv(m.av); return; } // perfil: nombre y avatar
      if (m.t === 'pick' && R.phase === 'lobby' && R.members.has(ws.token)) { const x = R.members.get(ws.token); if (x.pick === m.b) x.pick = null; else if (mainPlanets(R).includes(m.b) && ![...R.members.values()].some(y => y !== x && y.pick === m.b)) x.pick = m.b; return; } // elegir (o soltar) un planeta
      if (m.t === 'start' && R.phase === 'lobby' && ws.token === R.host && R.members.size >= 1) { // iniciar: se reparten los planetas y todos pasan a la página del juego (allí empieza la carga)
        const taken = new Set([...R.members.values()].map(x => x.pick).filter(Boolean)), pl = [...taken, ...shuffle(mainPlanets(R).filter(n => !taken.has(n)))]; let i = 0; for (const mem of R.members.values()) if (mem.pick) { mem.b = mem.pick; i++; } for (const mem of R.members.values()) if (!mem.pick) mem.b = pl[i++]; for (const mem of R.members.values()) { mem.la = mem.lo = null; mem.siteOk = false; mem.ld = 0; mem.id = null; }
        R.botPlanets.clear(); R.nextBot = 0; if (R.fillBots) for (; i < pl.length; i++) { const k = R.nextBot++; R.botPlanets.set(k, { i: k, b: pl[i], la: null, lo: null }); }
        R.phase = 'launching'; R.launchAt = Date.now(); R.expected = new Set(R.members.keys()); R.resumed = new Set(); return bcast(R, { go: 1 });
      }
      if (m.t === 'leave' && R.phase === 'lobby') { ws.R = null; return dropMember(R, ws.token); }
      // ----- página del juego: reenganche con el mismo jugador y carga -----
      if (m.t === 'resume') {
        const tk = String(m.token || '').slice(0, 40), T = byToken(tk), mem = T && T.members.get(tk);
        if (!T || !mem || T.phase === 'lobby') return send(ws, { resumed: 0 });
        ws.token = tk; ws.R = R = T; if (mem.id != null && R.lobby.get(mem.id) === mem) R.lobby.delete(mem.id); mem.id = id; R.lobby.set(id, mem); R.resumed.add(tk); send(ws, { resumed: 1, host: R.host === tk });
        if (R.phase === 'launching' && [...R.expected].every(t => R.resumed.has(t))) R.phase = 'loading'; return;
      }
      if (m.t === 'site' && e && Number.isFinite(m.la) && Number.isFinite(m.lo) && Math.abs(m.la) < 1.6) { e.la = m.la; e.lo = m.lo; e.siteOk = true; return; } // emplazamiento de mi base (lo calcula mi cliente con el terreno)
      if (m.t === 'bsite' && id === admin(R) && [...R.botPlanets.values()].some(x => x.b === m.b) && Number.isFinite(m.la) && Number.isFinite(m.lo)) { const bp = [...R.botPlanets.values()].find(x => x.b === m.b); bp.la = m.la; bp.lo = m.lo; return; }
      // ----- partida -----
      if (m.t === 's' && num(m.pos, 3) && num(m.q, 4) && Number.isFinite(m.v) && Number.isFinite(m.hp)) R.players.set(id, stateOf(id, m, m.name));
      else if (m.t === 'bs' && id === admin(R) && Number.isInteger(m.i) && R.hangars.has(1000 + m.i) && num(m.pos, 3) && num(m.q, 4) && Number.isFinite(m.v) && Number.isFinite(m.hp)) R.bots.set(m.i, { ...stateOf(2000 + m.i, m, m.name), bot: 1 }); // estado de un bot IA (lo simula el cliente del anfitrión)
      else if (m.t === 'fire' && (m.kind === 'p' || m.kind === 'c' || m.kind === 'm' || (m.kind === 'r' && Number.isFinite(m.len) && m.len > 0 && m.len <= 2000)) && num(m.pos, 3) && num(m.dir, 3) && typeof m.key === 'string' && rate(ws, m.kind === 'r' ? 'r' : 'f')) { // 'c': bala de munición (ráfagas) · 'r': paso de un haz del cañón de riel (~10/s por haz activo, len ≤ 2000 km)
        const t = m.tgt && (m.tgt.k === 'p' || m.tgt.k === 'w' || m.tgt.k === 'h' || m.tgt.k === 'n' || m.tgt.k === 'W' || m.tgt.k === 'S' || m.tgt.k === 'F') && Number.isInteger(m.tgt.id) ? { k: m.tgt.k, id: m.tgt.id } : null;
        const ow = id === admin(R) && Number.isInteger(m.ow) && ((m.ow >= 2000 && m.ow < 4000) || (m.ow >= 7000 && m.ow < 8000)) ? m.ow : undefined; // 7000+: disparo de un escuadrón de cazas // disparo de un bot (2000+) o de una nave neutral (3000+): solo el anfitrión puede atribuirlo
        relay(R, id, { t: 'fire', key: m.key.slice(0, 24), kind: m.kind, w: WEAPONS[m.w] ? m.w : undefined, len: m.kind === 'r' ? m.len : undefined, pos: m.pos, dir: m.dir, tgt: t, dmg: Number.isFinite(m.dmg) ? Math.max(0.1, Math.min(m.tw ? 120 : 30, m.dmg)) : 8, tw: m.tw ? 1 : 0, spd: Number.isFinite(m.spd) ? Math.max(0.1, Math.min(500, m.spd)) : 0, nl: m.nl ? 1 : 0, rb: Number.isInteger(m.rb) ? m.rb : -1, rp: num(m.rp, 3) ? m.rp : null, ow });
      } else if (m.t === 'hit' && Number.isInteger(m.by) && num(m.pos, 3) && Number.isFinite(m.dmg) && typeof m.key === 'string')
        relay(R, id, { t: 'hit', by: m.by, key: m.key.slice(0, 24), dmg: m.dmg, pos: m.pos, dead: !!m.dead, sh: Number.isFinite(m.sh) ? m.sh : 0, v: Number.isInteger(m.v) ? m.v : undefined, bm: m.bm ? 1 : 0 }); // bm: daño de haz (sin explosión en los demás) // v: víctima si no es quien envía (bots del anfitrión)
      else if (m.t === 'ns' && id === admin(R) && Array.isArray(m.l) && m.l.length <= 96) R.nv = m.l.map(e => neuRow(R, e)).filter(Boolean); // estado de las naves neutrales
      else if (m.t === 'nhit' && id === admin(R) && Number.isInteger(m.n) && m.n >= 3000 && m.n < 4000 && Number.isInteger(m.by) && num(m.pos, 3) && typeof m.key === 'string') { // impacto en una nave neutral (lo decide el anfitrión); si muere, win = quien se lleva la recompensa
        if (m.dead && R.nv) R.nv = R.nv.filter(e => e[0] !== m.n);
        relay(R, id, { t: 'nhit', n: m.n, by: m.by, key: m.key.slice(0, 24), dmg: Number.isFinite(m.dmg) ? clampN(m.dmg, 0, 60) : 0, pos: m.pos, dead: !!m.dead, sh: m.sh ? 1 : 0, win: Number.isInteger(m.win) ? m.win : -1, lv: Number.isInteger(m.lv) ? clampN(m.lv, 1, 20) : 1, xp: Number.isInteger(m.xp) ? clampN(m.xp, 0, 100) : 0, loot: neuLoot(m.loot) });
      }
      else if (m.t === 'bts' && R.hangars.has(id) && Number.isInteger(m.i) && m.i >= 0 && m.i < 4 && TOWER_STYLES[m.s]) { // estilo de una torreta (el cliente ya pagó el desbloqueo)
        R.hangars.get(id).ts[m.i] = m.s;
      } else if (m.t === 'bup' && R.hangars.has(id) && BASE_UP[m.k]) { // mejora de la base (los recursos los gasta el cliente)
        const h = R.hangars.get(id), lv = h.up[m.k]; if (lv < BASE_UP[m.k].max) {
          h.up[m.k]++; if (m.k === 'hp') h.hp += 250; else if (m.k === 'sh') h.sh += 300; else if (m.k === 'tw') h.tw = h.tw.map(v => v > 0 ? v + 75 : v);
        }
      } else if (m.t === 'claim' && e && R.SOLID.has(m.b) && Number.isFinite(m.la) && Number.isFinite(m.lo) && Math.abs(m.la) < 1.6) { // tras una derrota: elegir otro planeta libre
        if (!planetFree(R, m.b, id)) send(ws, { claim: 0 });
        else { Object.assign(e, { b: m.b, la: m.la, lo: m.lo, ld: 0, siteOk: true }); if (R.phase !== 'lobby') makeHangar(R, id, e); send(ws, { claim: 1 }); }
      } else if (m.t === 'ld' && e && Number.isFinite(m.p)) { // progreso de carga de este jugador (0-100): la partida empieza cuando todos llegan a 100
        e.ld = Math.max(0, Math.min(100, m.p));
      } else if (m.t === 'hh' && Number.isInteger(m.o) && Number.isFinite(m.dmg) && R.hangars.has(m.o) && (m.ws === undefined ? m.o !== id : (() => { const st = R.wships.get(m.ws) || R.sats.get(m.ws); return !!st && st.o !== m.o && !(st.ar > Date.now()) && (id === m.o || id === admin(R)); })())) { // daño al hangar de otro jugador · ws: disparo de un buque/satélite enemigo contra esa base (lo simula su dueño o, si es de un bot, el anfitrión); el dueño no daña lo suyo
        const wsO = m.ws !== undefined ? (R.wships.get(m.ws) || R.sats.get(m.ws)).o : id;
        const h = R.hangars.get(m.o); let dm = Math.max(1, Math.min(m.ws !== undefined ? 120 : 60, m.dmg)); h.shT = Date.now();
        if (h.sh > 0) { const a = Math.min(h.sh, dm); h.sh -= a; dm -= a; } // el escudo de la base absorbe las balas
        if (dm <= 0) { /* todo absorbido */ } else if (Number.isInteger(m.tw) && m.tw >= 0 && m.tw < 4) h.tw[m.tw] = Math.max(0, h.tw[m.tw] - dm); else h.hp -= dm; // golpe a una torreta o al hangar
        if (h.hp <= 0) { R.hangars.delete(m.o); const x = R.lobby.get(m.o); if (x) { x.b = null; x.siteOk = false; } R.bots.delete(m.o - 1000); if (m.o >= 1000) dropWar(R, m.o); bcast(R, { ev: { t: 'hdead', o: m.o, by: wsO, id } }); }
      } else if (m.t === 'wdep' && e && R.phase === 'playing' && (m.k === 'W' || m.k === 'S' || m.k === 'F') && Number.isInteger(m.zi) && m.zi >= 0 && m.zi < R.czs.length) { // {k, zi, at}: el PUNTO lo calcula el servidor (sysgen.czDeployPoint: at 'p' junto al planeta de la zona, 'c' junto a su cúmulo)
        const why = deployUnit(R, id, m.k, m.zi, m.at);
        send(ws, { wok: why ? 0 : 1, k: m.k, why });
      } else if (m.t === 'wh' && e && (m.k === 'W' || m.k === 'S' || m.k === 'F') && Number.isInteger(m.i) && Number.isFinite(m.dmg)) { // daño a un buque, satélite o caza de otro jugador (lo decide el servidor, como 'hh') · nb: disparo de una nave neutral (solo lo puede enviar el anfitrión)
        const nb = !!m.nb && id === admin(R), dm0 = clampN(m.dmg, 1, m.ws !== undefined ? 120 : 60), att = m.ws !== undefined ? (R.wships.get(m.ws) || R.sats.get(m.ws)) : null; if (m.ws !== undefined && (!att || id !== admin(R))) return; const by = att ? att.o : nb ? -1 : id; // ws: disparo entre estructuras (lo simula el anfitrión); el atacante debe existir
        if (m.k === 'F') { const q = R.fighters.get(m.i), j = m.j; if (q && Number.isInteger(j) && j >= 0 && j < q.hp.length && q.hp[j] > 0 && !(q.ar > Date.now()) && (q.o !== id || nb || att) && !(att && att.o === q.o)) { q.hp[j] -= dm0; if (q.hp.every(h => h < 0.5)) { R.fighters.delete(m.i); bcast(R, { ev: { t: 'wdead', k: 'F', i: m.i, o: q.o, by, id } }); } } }
        else { const M = m.k === 'W' ? R.wships : R.sats, s = M.get(m.i);
          if (s && !(s.ar > Date.now()) && (s.o !== id || nb || att) && !(att && att.o === s.o)) { let dm = dm0; s.shT = Date.now(); if (s.sh > 0) { const a = Math.min(s.sh, dm); s.sh -= a; dm -= a; } s.hp -= dm;
            if (s.hp < 0.5) { M.delete(m.i); bcast(R, { ev: { t: 'wdead', k: m.k, i: m.i, o: s.o, by, id } }); } } } // < 0,5: el tick redondea la vida; lo que se ve como 0 está destruido
      } else if (m.t === 'walarm' && e && Number.isInteger(m.i) && R.wships.has(m.i)) { // un buque detectó a un enemigo (lo decide quien simula su torreta): alarma para todos, como mucho 1 cada alarmCd s por buque
        const now = Date.now(); R.walT = R.walT || new Map(); if (now - (R.walT.get(m.i) || 0) > WARCFG.alarmCd * 1000) { R.walT.set(m.i, now); bcast(R, { ev: { t: 'walarm', k: 'W', i: m.i, o: R.wships.get(m.i).o } }); }
      } else if (m.t === 'fs' && id === admin(R) && Array.isArray(m.l) && m.l.length <= 720) { // posiciones de los cazas (las simula el anfitrión)
        R.fs = m.l.filter(r => Array.isArray(r) && r.length === 10 && r.every(Number.isFinite) && R.fighters.has(r[0]) && Number.isInteger(r[1]) && r[1] >= 0 && r[1] < WARCFG.ftr.n);
      } else if (m.t === 'wreck' && Number.isInteger(m.id) && m.id >= 0 && m.id < WRECKS && !R.deadWrecks.has(m.id)) {
        R.deadWrecks.set(m.id, Date.now() + WRECK_RESPAWN_MS);
        relay(R, id, { t: 'wreck', w: m.id, by: id });
        const first = !R.looted.has(m.id); R.looted.add(m.id); send(ws, { mined: 1, w: m.id, got: first ? wreckLoot(m.id) : [] }); // sus recursos solo la primera vez en la sala (la munición se recarga siempre)
      } else if (m.t === 'mine' && e && R.phase !== 'lobby' && Number.isInteger(m.z) && m.z >= 0 && m.z < R.zones.length && Array.isArray(m.list) && m.list.length <= 6) { // asteroide de una zona destruido: se concede lo que quede y se descuenta
        const now = Date.now(), Z = R.zones[m.z], left = R.zr[m.z], got = [];
        if (now - (ws.mineT || 0) >= MINE_GAP_MS) {
          ws.mineT = now;
          for (const it of m.list) {
            const k = it ? Z.dominant.findIndex(d => d.type === it.type) : -1, n = Number(it && it.n);
            if (k < 0 || !Number.isInteger(n) || n < 1 || n > MINE_MAX || got.some(g => g.type === it.type)) continue;
            const g = Math.min(n, left[k]); if (g > 0) { left[k] -= g; got.push({ type: Z.dominant[k].type, n: g }); }
          }
        }
        send(ws, { mined: 1, z: m.z, got }); // solo al que minó
      }
    } catch {}
  });
  ws.on('close', () => {
    const R = ws.R, mem = R && ws.token && R.members.get(ws.token); if (!R) return; R.players.delete(id); // (R.bots va por índice de bot, no por id de jugador)
    if (mem) {
      if (R.phase === 'lobby') { if (mem.id === id) dropMember(R, ws.token); } // salir de la sala de espera
      else if (R.phase !== 'launching' && mem.id === id) { R.lobby.delete(id); R.members.delete(ws.token); dropWar(R, id); if (R.hangars.delete(id)) bcast(R, { ev: { t: 'hgone', o: id, id } }); } // desconexión durante la partida
    } else R.lobby.delete(id);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const R of [...rooms.values()]) {
    if (R.phase === 'launching' && now - R.launchAt > 240000) { for (const t of [...R.expected]) if (!R.resumed.has(t)) R.members.delete(t); R.phase = 'loading'; } // quien no llegó a la página del juego queda fuera
    if (!R.members.size) { closeRoom(R); continue; }
    if (R.phase === 'loading') {
      const need = [...R.lobby.values()].filter(x => x.b);
      if (!R.hangars.size && need.length && need.every(x => x.siteOk) && [...R.botPlanets.values()].every(x => x.la != null)) { for (const [i, x] of R.lobby) if (x.b) makeHangar(R, i, x); for (const bp of R.botPlanets.values()) makeHangar(R, 1000 + bp.i, { nm: 'BOT ' + bp.b, b: bp.b, la: bp.la, lo: bp.lo }); claimHome(R); } // + zonas iniciales ya reclamadas // todos han elegido emplazamiento: se crean las bases
      if (R.hangars.size && need.every(x => x.ld >= 100)) R.phase = 'playing'; // todos cargados al 100 %: empieza
    }
    for (const [w, t] of R.deadWrecks) if (t < now) R.deadWrecks.delete(w);
    if (R.phase === 'playing') { czTick(R, now); botTick(R, now); }
    for (const h of R.hangars.values()) { const st = baseStats(h.up || {}); if (h.up && h.up.sh && now - h.shT > 5000 && h.sh < st.shMax) h.sh = Math.min(st.shMax, h.sh + 20 * 0.066); } // el escudo de la base se regenera sin recibir golpes
    const msg = JSON.stringify({ players: [...R.players.values(), ...R.bots.values()].filter(Boolean), wd: [...R.deadWrecks.keys()], wl: [...R.looted], zr: R.zr, hg: [...R.hangars.values()].map(h => ({ o: h.o, nm: h.nm, b: h.b, la: h.la, lo: h.lo, hp: Math.round(h.hp), sh: Math.round(h.sh), up: h.up, ts: h.ts, tw: h.tw, bot: h.bot, sp: h.sp, rs: h.o >= 1000 && R.botRes && R.botRes[h.o] ? (R.mode === 'creative' ? 9999 : Object.values(R.botRes[h.o]).reduce((a, b) => a + b, 0)) : undefined })), bl: [...R.botPlanets.values()], nv: R.phase === 'playing' ? R.nv || [] : [], ph: R.phase, adm: admin(R), rm: publicRoom(R), seed: R.seed, cz: R.cz.map((z, i) => R.czRes && R.czRes[i] ? [z.o, z.c, Math.round(z.p), R.czRes[i]] : [z.o, z.c, Math.round(z.p)]), wb: [...R.wships.values()].map(s => [s.id, s.o, s.zi, s.a, ...s.off, Math.round(s.hp), Math.round(s.sh)]), sa: [...R.sats.values()].map(s => [s.id, s.o, s.zi, s.a, ...s.off, Math.round(s.hp), s.on]), fq: [...R.fighters.values()].map(q => [q.id, q.o, q.zi, q.a || 0, ...q.off, ...q.hp.map(Math.round)]), fl: R.fs, ar: [...R.wships.values(), ...R.sats.values(), ...R.fighters.values()].filter(u => u.ar > now).map(u => [u.id, u.ar - now]), lb: [...R.lobby].map(([i, e]) => ({ id: i, nm: e.nm, av: e.av || '', b: e.b, ready: true, ld: e.ld ?? 0 })) });
    for (const c of wss.clients) if (c.R === R && c.readyState === 1) c.send(msg);
  }
}, 66);

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log('Servidor listo: abre el menú principal para crear una sala.');
  console.log(`Local:  http://localhost:${port}`);
  for (const l of Object.values(os.networkInterfaces()).flat())
    if (l.family === 'IPv4' && !l.internal) console.log(`Red:    http://${l.address}:${port}   <- pasa esta URL a tu amigo (misma red)`);
});
