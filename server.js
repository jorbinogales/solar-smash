// Sirve el juego y gestiona las salas (varias partidas a la vez, cada una con su código): menú principal (crear sala con vista previa del sistema, compartir enlace, lista de jugadores), lanzamiento,
// carga de la partida y retransmisión de estado y eventos de combate. El daño lo decide cada víctima; el servidor guarda hangares (vida de base y torretas).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { WebSocketServer } = require('ws');

const FILES = { '/': 'index.html', '/index.html': 'index.html', '/menu.js': 'menu.js', '/blobatar.js': 'blobatar.js', '/three.min.js': 'three.min.js', '/game': 'game.html', '/game.html': 'game.html', '/game.js': 'game.js', '/ships.js': 'ships.js', '/space.js': 'space.js', '/planets.js': 'planets.js', '/tview.js': 'tview.js', '/foot.js': 'foot.js', '/map.js': 'map.js', '/hangar.js': 'hangar.js', '/sysgen.js': 'sysgen.js', '/base.js': 'base.js', '/bot.js': 'bot.js', '/icons.js': 'icons.js' };
const { genSystem, BASE_UP, baseStats, TOWER_STYLES } = require('./sysgen');
const HG_HP = 600, TW_HP = 150; // hangar: dueño -> { o, nm, b (planeta), la, lo (rad), hp, tw[4], bot }: un planeta = un hangar
const rooms = new Map(); // código -> sala: { code, name, seed, np, fillBots, phase, host (token), launchAt, SYS, SOLID, members (token -> jugador), lobby (id de conexión -> jugador ya en la página del juego), hangars, botPlanets, players, bots, deadWrecks, nextBot }
const setSystem = (R, seed, np) => { R.seed = seed; R.np = np; R.SYS = genSystem(seed, np); R.SOLID = new Set(R.SYS.bodies.filter(b => b.k !== 'sun').map(b => b.n)); };
const COLORS = [0x4db8ff, 0xff6a3c, 0x5dff8a, 0xffd23f, 0xd06bff, 0xf2f2f2, 0xff5fa2, 0x3ff0e0];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const byToken = tk => { for (const R of rooms.values()) if (tk && R.members.has(tk)) return R; return null; };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const tk = new URL(req.url, 'http://x').searchParams.get('token') || '', R = byToken(tk);
  if (u === '/api/me') return res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ok: !!(R && R.phase !== 'lobby') })); // la página del juego solo arranca si eres jugador de una partida
  if (u === '/seed.js') return res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(`const SEED = ${R ? R.seed : 1}, NPL = ${R ? R.np : 4};`); // el sistema es el de TU sala
  const f = FILES[u];
  if (!f) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
});

const WRECKS = 32, WRECK_RESPAWN_MS = 90000;
const wss = new WebSocketServer({ server, maxPayload: 4096 }); let nextId = 1;
const SHIPS = ['saeta', 'halcon', 'coloso', 'nomada'];
const spec = sp => ({ t: SHIPS.includes(sp && sp.t) ? sp.t : 'halcon', a: Array.from({ length: 6 }, (_, i) => Math.max(0, Math.min(3, Math.round(Number(sp && sp.a && sp.a[i]) || 0)))), c: Number.isFinite(sp && sp.c) ? (sp.c >>> 0) & 0xffffff : 0x4db8ff });
const num = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (R, o) => { const s = JSON.stringify(o); for (const c of wss.clients) if (c.R === R && c.readyState === 1) c.send(s); }; // solo a los jugadores de esa sala
const relay = (R, from, ev) => { const s = JSON.stringify({ ev: { ...ev, id: from } }); for (const c of wss.clients) if (c.R === R && c.readyState === 1 && c.pid !== from) c.send(s); };
const admin = R => { const h = R.members.get(R.host); return h && h.id != null && R.lobby.has(h.id) ? h.id : Math.min(Infinity, ...R.lobby.keys()); }; // el anfitrión simula a los bots
const stateOf = (id, m, name) => ({ id, name: String(name).slice(0, 20), pos: m.pos, q: m.q, v: m.v, hp: m.hp, sh: Number.isFinite(m.sh) ? m.sh : 0, sp: spec(m.sp), pk: m.pk ? 1 : 0, bt: Number.isFinite(m.bt) ? Math.max(0, Math.min(1, m.bt)) : 0, rb: Number.isInteger(m.rb) ? m.rb : -1, rp: num(m.rp, 3) ? m.rp : null, ms: Number.isFinite(m.ms) ? m.ms : 0 });
const planetFree = (R, b, id) => ![...R.lobby].some(([i, e]) => i !== id && e.b === b) && ![...R.hangars.values()].some(h => h.b === b && h.o !== id) && ![...R.botPlanets.values()].some(x => x.b === b);
const makeHangar = (R, id, e) => R.hangars.set(id, { o: id, nm: e.nm, b: e.b, la: e.la, lo: e.lo, hp: HG_HP, sh: 0, shT: 0, up: { hp: 0, sh: 0, tw: 0, td: 0 }, ts: ['plasma', 'plasma', 'plasma', 'plasma'], tw: [TW_HP, TW_HP, TW_HP, TW_HP], bot: id >= 1000 });
const mainPlanets = R => R.SYS.bodies.filter(b => b.k !== 'sun' && !b.parent).map(b => b.n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hk = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return h >>> 0; }; // huella corta del token (para saber quién eres sin revelarlo)
const publicRoom = R => R && { code: R.code, name: R.name, seed: R.seed, np: R.np, fillBots: R.fillBots, phase: R.phase, members: [...R.members.values()].map(m => ({ nm: m.nm, col: m.col, hk: hk(m.token), host: m.token === R.host, av: m.av || '', pick: m.pick || null })) };
const closeRoom = R => { rooms.delete(R.code); for (const c of wss.clients) if (c.R === R) { c.R = null; send(c, { rm: null }); } }; // avisa a quien seguía dentro
const cleanAv = s => String(s || '').replace(/[^\w\-.@ ]/g, '').slice(0, 24);
const cleanName = (s, d) => String(s || d).replace(/[<>&"]/g, '').slice(0, 16) || d;
const newMember = (ws, m, id, idx) => ({ token: ws.token, nm: cleanName(m.nm, 'Piloto'), av: cleanAv(m.av), pick: null, col: COLORS[idx % COLORS.length], id, b: null, la: null, lo: null, ld: 0, siteOk: false });
const dropMember = (R, tk) => { R.members.delete(tk); if (R.host === tk) { const nx = R.members.keys().next().value; if (nx) R.host = nx; else closeRoom(R); } }; // salir de la sala de espera (si era el anfitrión pasa al siguiente)

wss.on('connection', ws => {
  const id = ws.pid = nextId++; ws.token = null; ws.R = null;
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
        R = { code, name: String(m.name || 'Sala').replace(/[<>&"]/g, '').slice(0, 28), fillBots: true, phase: 'lobby', host: ws.token, launchAt: 0, members: new Map(), lobby: new Map(), hangars: new Map(), botPlanets: new Map(), players: new Map(), bots: new Map(), deadWrecks: new Map(), nextBot: 0 };
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
      else if (m.t === 'fire' && (m.kind === 'p' || m.kind === 'm') && num(m.pos, 3) && num(m.dir, 3) && typeof m.key === 'string') {
        const t = m.tgt && (m.tgt.k === 'p' || m.tgt.k === 'w' || m.tgt.k === 'h') && Number.isInteger(m.tgt.id) ? { k: m.tgt.k, id: m.tgt.id } : null;
        relay(R, id, { t: 'fire', key: m.key.slice(0, 24), kind: m.kind, pos: m.pos, dir: m.dir, tgt: t, dmg: Number.isFinite(m.dmg) ? Math.max(1, Math.min(30, m.dmg)) : 8, tw: m.tw ? 1 : 0, spd: Number.isFinite(m.spd) ? Math.max(0.1, Math.min(50, m.spd)) : 0, rb: Number.isInteger(m.rb) ? m.rb : -1, rp: num(m.rp, 3) ? m.rp : null });
      } else if (m.t === 'hit' && Number.isInteger(m.by) && num(m.pos, 3) && Number.isFinite(m.dmg) && typeof m.key === 'string')
        relay(R, id, { t: 'hit', by: m.by, key: m.key.slice(0, 24), dmg: m.dmg, pos: m.pos, dead: !!m.dead, sh: Number.isFinite(m.sh) ? m.sh : 0 });
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
      } else if (m.t === 'hh' && Number.isInteger(m.o) && m.o !== id && Number.isFinite(m.dmg) && R.hangars.has(m.o)) { // daño al hangar de otro jugador
        const h = R.hangars.get(m.o); let dm = Math.max(1, Math.min(60, m.dmg)); h.shT = Date.now();
        if (h.sh > 0) { const a = Math.min(h.sh, dm); h.sh -= a; dm -= a; } // el escudo de la base absorbe las balas
        if (dm <= 0) { /* todo absorbido */ } else if (Number.isInteger(m.tw) && m.tw >= 0 && m.tw < 4) h.tw[m.tw] = Math.max(0, h.tw[m.tw] - dm); else h.hp -= dm; // golpe a una torreta o al hangar
        if (h.hp <= 0) { R.hangars.delete(m.o); const x = R.lobby.get(m.o); if (x) { x.b = null; x.siteOk = false; } R.bots.delete(m.o - 1000); bcast(R, { ev: { t: 'hdead', o: m.o, by: id, id } }); }
      } else if (m.t === 'wreck' && Number.isInteger(m.id) && m.id >= 0 && m.id < WRECKS && !R.deadWrecks.has(m.id)) {
        R.deadWrecks.set(m.id, Date.now() + WRECK_RESPAWN_MS);
        relay(R, id, { t: 'wreck', w: m.id, by: id });
      }
    } catch {}
  });
  ws.on('close', () => {
    const R = ws.R, mem = R && ws.token && R.members.get(ws.token); if (!R) return; R.players.delete(id); R.bots.delete(id);
    if (mem) {
      if (R.phase === 'lobby') { if (mem.id === id) dropMember(R, ws.token); } // salir de la sala de espera
      else if (R.phase !== 'launching' && mem.id === id) { R.lobby.delete(id); R.members.delete(ws.token); if (R.hangars.delete(id)) bcast(R, { ev: { t: 'hgone', o: id, id } }); } // desconexión durante la partida
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
      if (!R.hangars.size && need.length && need.every(x => x.siteOk) && [...R.botPlanets.values()].every(x => x.la != null)) { for (const [i, x] of R.lobby) if (x.b) makeHangar(R, i, x); for (const bp of R.botPlanets.values()) makeHangar(R, 1000 + bp.i, { nm: 'BOT ' + bp.b, b: bp.b, la: bp.la, lo: bp.lo }); } // todos han elegido emplazamiento: se crean las bases
      if (R.hangars.size && need.every(x => x.ld >= 100)) R.phase = 'playing'; // todos cargados al 100 %: empieza
    }
    for (const [w, t] of R.deadWrecks) if (t < now) R.deadWrecks.delete(w);
    for (const h of R.hangars.values()) { const st = baseStats(h.up || {}); if (h.up && h.up.sh && now - h.shT > 5000 && h.sh < st.shMax) h.sh = Math.min(st.shMax, h.sh + 20 * 0.066); } // el escudo de la base se regenera sin recibir golpes
    const msg = JSON.stringify({ players: [...R.players.values(), ...R.bots.values()].filter(Boolean), wd: [...R.deadWrecks.keys()], hg: [...R.hangars.values()].map(h => ({ o: h.o, nm: h.nm, b: h.b, la: h.la, lo: h.lo, hp: Math.round(h.hp), sh: Math.round(h.sh), up: h.up, ts: h.ts, tw: h.tw, bot: h.bot })), bl: [...R.botPlanets.values()], ph: R.phase, adm: admin(R), rm: publicRoom(R), seed: R.seed, lb: [...R.lobby].map(([i, e]) => ({ id: i, nm: e.nm, b: e.b, ready: true, ld: e.ld ?? 0 })) });
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
