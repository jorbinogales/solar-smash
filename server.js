// Sirve el juego y gestiona la sala: menú principal (crear sala con vista previa del sistema, compartir enlace, lista de jugadores), lanzamiento,
// carga de la partida y retransmisión de estado y eventos de combate. El daño lo decide cada víctima; el servidor guarda hangares (vida de base y torretas).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { WebSocketServer } = require('ws');

const FILES = { '/': 'index.html', '/index.html': 'index.html', '/menu.js': 'menu.js', '/blobatar.js': 'blobatar.js', '/game': 'game.html', '/game.html': 'game.html', '/game.js': 'game.js', '/ships.js': 'ships.js', '/space.js': 'space.js', '/planets.js': 'planets.js', '/tview.js': 'tview.js', '/foot.js': 'foot.js', '/map.js': 'map.js', '/hangar.js': 'hangar.js', '/sysgen.js': 'sysgen.js', '/base.js': 'base.js', '/bot.js': 'bot.js', '/icons.js': 'icons.js' };
const { genSystem, BASE_UP, baseStats, TOWER_STYLES } = require('./sysgen');
let SEED = 1 + Math.floor(Math.random() * 2e9), NPL = 4, SYS = genSystem(SEED, NPL), SOLID = new Set(SYS.bodies.filter(b => b.k !== 'sun').map(b => b.n));
const setSystem = (seed, np) => { SEED = seed; NPL = np; SYS = genSystem(SEED, NPL); SOLID = new Set(SYS.bodies.filter(b => b.k !== 'sun').map(b => b.n)); };
const hangars = new Map(), HG_HP = 600, TW_HP = 150; // dueño -> { o, nm, b (planeta), la, lo (rad), hp, tw[4], bot }: un planeta = un hangar
const members = new Map(), lobby = new Map(), botPlanets = new Map(); // members: token -> jugador de la sala; lobby: id de conexión -> jugador (ya en la página del juego); botPlanets: i -> { i, b, la, lo }
let room = null, nextBot = 0, phase = 'lobby'; // room: { code, name, seed, np, fillBots, phase, host (token), launchAt }; phase espeja room.phase
const COLORS = [0x4db8ff, 0xff6a3c, 0x5dff8a, 0xffd23f, 0xd06bff, 0xf2f2f2, 0xff5fa2, 0x3ff0e0];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/me') { const tk = new URL(req.url, 'http://x').searchParams.get('token') || ''; return res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ok: !!(room && room.phase !== 'lobby' && members.has(tk)) })); } // la página del juego solo arranca si eres jugador de una partida
  if (u === '/seed.js') return res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(`const SEED = ${SEED}, NPL = ${NPL};`);
  const f = FILES[u];
  if (!f) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
});

const WRECKS = 32, WRECK_RESPAWN_MS = 90000;
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const players = new Map(), bots = new Map(), deadWrecks = new Map(); let nextId = 1;
const SHIPS = ['saeta', 'halcon', 'coloso', 'nomada'];
const spec = sp => ({ t: SHIPS.includes(sp && sp.t) ? sp.t : 'halcon', a: Array.from({ length: 6 }, (_, i) => Math.max(0, Math.min(3, Math.round(Number(sp && sp.a && sp.a[i]) || 0)))), c: Number.isFinite(sp && sp.c) ? (sp.c >>> 0) & 0xffffff : 0x4db8ff });
const num = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = o => { const s = JSON.stringify(o); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };
const relay = (from, ev) => { const s = JSON.stringify({ ev: { ...ev, id: from } }); for (const c of wss.clients) if (c.readyState === 1 && c.pid !== from) c.send(s); };
const hostMember = () => (room ? members.get(room.host) : null);
const admin = () => { const h = hostMember(); return h && h.id != null && lobby.has(h.id) ? h.id : Math.min(Infinity, ...lobby.keys()); }; // el anfitrión simula a los bots
const stateOf = (id, m, name) => ({ id, name: String(name).slice(0, 20), pos: m.pos, q: m.q, v: m.v, hp: m.hp, sh: Number.isFinite(m.sh) ? m.sh : 0, sp: spec(m.sp), pk: m.pk ? 1 : 0, bt: Number.isFinite(m.bt) ? Math.max(0, Math.min(1, m.bt)) : 0, rb: Number.isInteger(m.rb) ? m.rb : -1, rp: num(m.rp, 3) ? m.rp : null, ms: Number.isFinite(m.ms) ? m.ms : 0 });
const planetFree = (b, id) => ![...lobby].some(([i, e]) => i !== id && e.b === b) && ![...hangars.values()].some(h => h.b === b && h.o !== id) && ![...botPlanets.values()].some(x => x.b === b);
const makeHangar = (id, e) => hangars.set(id, { o: id, nm: e.nm, b: e.b, la: e.la, lo: e.lo, hp: HG_HP, sh: 0, shT: 0, up: { hp: 0, sh: 0, tw: 0, td: 0 }, ts: ['plasma', 'plasma', 'plasma', 'plasma'], tw: [TW_HP, TW_HP, TW_HP, TW_HP], bot: id >= 1000 });
const mainPlanets = () => SYS.bodies.filter(b => b.k !== 'sun' && !b.parent).map(b => b.n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hk = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return h >>> 0; }; // huella corta del token (para saber quién eres sin revelarlo)
const publicRoom = () => room && { code: room.code, name: room.name, seed: room.seed, np: room.np, fillBots: room.fillBots, phase: room.phase, members: [...members.values()].map(m => ({ nm: m.nm, col: m.col, hk: hk(m.token), host: m.token === room.host, av: m.av || '', pick: m.pick || null })) };
const closeRoom = () => { room = null; phase = 'lobby'; members.clear(); lobby.clear(); hangars.clear(); botPlanets.clear(); bots.clear(); deadWrecks.clear(); nextBot = 0; };
const cleanAv = s => String(s || '').replace(/[^\w\-.@ ]/g, '').slice(0, 24);
const cleanName = (s, d) => String(s || d).replace(/[<>&"]/g, '').slice(0, 16) || d;

wss.on('connection', ws => {
  const id = ws.pid = nextId++; players.set(id, null); ws.token = null;
  send(ws, { id, room: publicRoom(), seed: SEED });
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw), e = lobby.get(id);
      // ----- menú principal: crear sala, unirse, ajustes, iniciar -----
      if (m.t === 'hi') { ws.token = String(m.token || '').slice(0, 40); const mem = members.get(ws.token); if (mem && room && room.phase === 'lobby') mem.id = id; return send(ws, { hi: 1, member: !!mem, host: !!(room && room.host === ws.token) }); }
      if (m.t === 'create') {
        if (room) return send(ws, { created: 0 });
        const np = Math.max(2, Math.min(8, Math.round(Number(m.np) || 4))), seed = Number.isInteger(m.seed) && m.seed > 0 ? m.seed : 1 + Math.floor(Math.random() * 2e9); ws.token = String(m.token || '').slice(0, 40); if (!ws.token) return;
        setSystem(seed, np); const code = Math.random().toString(36).slice(2, 7).toUpperCase();
        room = { code, name: String(m.name || 'Sala').replace(/[<>&"]/g, '').slice(0, 28), seed, np, fillBots: true, phase: 'lobby', host: ws.token, launchAt: 0 }; phase = 'lobby';
        members.set(ws.token, { token: ws.token, nm: cleanName(m.nm, 'Piloto'), av: cleanAv(m.av), pick: null, col: COLORS[0], id, b: null, la: null, lo: null, ld: 0, siteOk: false });
        console.log(`Sala "${room.name}" (${code}) creada · ${np} planetas · semilla ${seed}`); return send(ws, { created: 1, code });
      }
      if (m.t === 'join') {
        ws.token = String(m.token || '').slice(0, 40); if (!room || room.phase !== 'lobby') return send(ws, { joined: 0, why: room ? 'La partida ya empezó.' : 'La sala no existe.' });
        if (m.code && String(m.code).toUpperCase() !== room.code) return send(ws, { joined: 0, why: 'Ese enlace es de otra sala.' });
        let mem = members.get(ws.token); if (!mem) { if (members.size >= room.np) return send(ws, { joined: 0, why: 'La sala está llena.' }); mem = { token: ws.token, nm: cleanName(m.nm, 'Piloto'), av: cleanAv(m.av), pick: null, col: COLORS[members.size % COLORS.length], id, b: null, la: null, lo: null, ld: 0, siteOk: false }; members.set(ws.token, mem); }
        mem.id = id; mem.nm = cleanName(m.nm, mem.nm); if (m.av) mem.av = cleanAv(m.av); return send(ws, { joined: 1, host: room.host === ws.token });
      }
      if (m.t === 'cfg' && room && room.phase === 'lobby' && ws.token === room.host) { // el anfitrión cambia planetas / semilla / nombre / bots antes de empezar
        if (Number.isInteger(m.np)) { const np = Math.max(Math.max(2, members.size), Math.min(8, m.np)); if (np !== room.np || (Number.isInteger(m.seed) && m.seed !== room.seed)) { for (const x of members.values()) x.pick = null; room.np = np; if (Number.isInteger(m.seed) && m.seed > 0) room.seed = m.seed; setSystem(room.seed, room.np); } }
        if (typeof m.name === 'string') room.name = m.name.replace(/[<>&"]/g, '').slice(0, 28) || room.name; if (typeof m.fillBots === 'boolean') room.fillBots = m.fillBots; return;
      }
      if (m.t === 'pf' && room && room.phase === 'lobby' && members.has(ws.token)) { const x = members.get(ws.token); if (typeof m.nm === 'string') x.nm = cleanName(m.nm, x.nm); if (typeof m.av === 'string') x.av = cleanAv(m.av); return; } // perfil: nombre y avatar
      if (m.t === 'pick' && room && room.phase === 'lobby' && members.has(ws.token)) { const x = members.get(ws.token); if (x.pick === m.b) x.pick = null; else if (mainPlanets().includes(m.b) && ![...members.values()].some(y => y !== x && y.pick === m.b)) x.pick = m.b; return; } // elegir (o soltar) un planeta
      if (m.t === 'start' && room && room.phase === 'lobby' && ws.token === room.host && members.size >= 1) { // iniciar: se reparten los planetas y todos pasan a la página del juego (allí empieza la carga)
        const taken = new Set([...members.values()].map(x => x.pick).filter(Boolean)), pl = [...taken, ...shuffle(mainPlanets().filter(n => !taken.has(n)))]; let i = 0; for (const mem of members.values()) if (mem.pick) { mem.b = mem.pick; i++; } for (const mem of members.values()) if (!mem.pick) mem.b = pl[i++]; for (const mem of members.values()) { mem.la = mem.lo = null; mem.siteOk = false; mem.ld = 0; mem.id = null; }
        botPlanets.clear(); nextBot = 0; if (room.fillBots) for (; i < pl.length; i++) { const k = nextBot++; botPlanets.set(k, { i: k, b: pl[i], la: null, lo: null }); }
        room.phase = phase = 'launching'; room.launchAt = Date.now(); room.expected = new Set(members.keys()); room.resumed = new Set(); return bcast({ go: 1 });
      }
      if (m.t === 'leave' && room && room.phase === 'lobby') { members.delete(ws.token); if (room.host === ws.token) { const nx = members.keys().next().value; if (nx) room.host = nx; else closeRoom(); } return; }
      // ----- página del juego: reenganche con el mismo jugador y carga -----
      if (m.t === 'resume') {
        const tk = String(m.token || '').slice(0, 40), mem = members.get(tk);
        if (!room || !mem || room.phase === 'lobby') return send(ws, { resumed: 0 });
        ws.token = tk; if (mem.id != null && lobby.get(mem.id) === mem) lobby.delete(mem.id); mem.id = id; lobby.set(id, mem); room.resumed.add(tk); send(ws, { resumed: 1, host: room.host === tk });
        if (room.phase === 'launching' && [...room.expected].every(t => room.resumed.has(t))) room.phase = phase = 'loading'; return;
      }
      if (m.t === 'site' && e && Number.isFinite(m.la) && Number.isFinite(m.lo) && Math.abs(m.la) < 1.6) { e.la = m.la; e.lo = m.lo; e.siteOk = true; return; } // emplazamiento de mi base (lo calcula mi cliente con el terreno)
      if (m.t === 'bsite' && id === admin() && [...botPlanets.values()].some(x => x.b === m.b) && Number.isFinite(m.la) && Number.isFinite(m.lo)) { const bp = [...botPlanets.values()].find(x => x.b === m.b); bp.la = m.la; bp.lo = m.lo; return; }
      // ----- partida -----
      if (m.t === 's' && num(m.pos, 3) && num(m.q, 4) && Number.isFinite(m.v) && Number.isFinite(m.hp)) players.set(id, stateOf(id, m, m.name));
      else if (m.t === 'bs' && id === admin() && Number.isInteger(m.i) && hangars.has(1000 + m.i) && num(m.pos, 3) && num(m.q, 4) && Number.isFinite(m.v) && Number.isFinite(m.hp)) bots.set(m.i, { ...stateOf(2000 + m.i, m, m.name), bot: 1 }); // estado de un bot IA (lo simula el cliente del anfitrión)
      else if (m.t === 'fire' && (m.kind === 'p' || m.kind === 'm') && num(m.pos, 3) && num(m.dir, 3) && typeof m.key === 'string') {
        const t = m.tgt && (m.tgt.k === 'p' || m.tgt.k === 'w' || m.tgt.k === 'h') && Number.isInteger(m.tgt.id) ? { k: m.tgt.k, id: m.tgt.id } : null;
        relay(id, { t: 'fire', key: m.key.slice(0, 24), kind: m.kind, pos: m.pos, dir: m.dir, tgt: t, dmg: Number.isFinite(m.dmg) ? Math.max(1, Math.min(30, m.dmg)) : 8, tw: m.tw ? 1 : 0, spd: Number.isFinite(m.spd) ? Math.max(0.1, Math.min(50, m.spd)) : 0, rb: Number.isInteger(m.rb) ? m.rb : -1, rp: num(m.rp, 3) ? m.rp : null });
      } else if (m.t === 'hit' && Number.isInteger(m.by) && num(m.pos, 3) && Number.isFinite(m.dmg) && typeof m.key === 'string')
        relay(id, { t: 'hit', by: m.by, key: m.key.slice(0, 24), dmg: m.dmg, pos: m.pos, dead: !!m.dead, sh: Number.isFinite(m.sh) ? m.sh : 0 });
      else if (m.t === 'bts' && hangars.has(id) && Number.isInteger(m.i) && m.i >= 0 && m.i < 4 && TOWER_STYLES[m.s]) { // estilo de una torreta (el cliente ya pagó el desbloqueo)
        hangars.get(id).ts[m.i] = m.s;
      } else if (m.t === 'bup' && hangars.has(id) && BASE_UP[m.k]) { // mejora de la base (los recursos los gasta el cliente)
        const h = hangars.get(id), lv = h.up[m.k]; if (lv < BASE_UP[m.k].max) {
          h.up[m.k]++; if (m.k === 'hp') h.hp += 250; else if (m.k === 'sh') h.sh += 300; else if (m.k === 'tw') h.tw = h.tw.map(v => v > 0 ? v + 75 : v);
        }
      } else if (m.t === 'claim' && e && SOLID.has(m.b) && Number.isFinite(m.la) && Number.isFinite(m.lo) && Math.abs(m.la) < 1.6) { // tras una derrota: elegir otro planeta libre
        if (!planetFree(m.b, id)) send(ws, { claim: 0 });
        else { Object.assign(e, { b: m.b, la: m.la, lo: m.lo, ld: 0, siteOk: true }); if (phase !== 'lobby') makeHangar(id, e); send(ws, { claim: 1 }); }
      } else if (m.t === 'ld' && e && Number.isFinite(m.p)) { // progreso de carga de este jugador (0-100): la partida empieza cuando todos llegan a 100
        e.ld = Math.max(0, Math.min(100, m.p));
      } else if (m.t === 'hh' && Number.isInteger(m.o) && m.o !== id && Number.isFinite(m.dmg) && hangars.has(m.o)) { // daño al hangar de otro jugador
        const h = hangars.get(m.o); let dm = Math.max(1, Math.min(60, m.dmg)); h.shT = Date.now();
        if (h.sh > 0) { const a = Math.min(h.sh, dm); h.sh -= a; dm -= a; } // el escudo de la base absorbe las balas
        if (dm <= 0) { /* todo absorbido */ } else if (Number.isInteger(m.tw) && m.tw >= 0 && m.tw < 4) h.tw[m.tw] = Math.max(0, h.tw[m.tw] - dm); else h.hp -= dm; // golpe a una torreta o al hangar
        if (h.hp <= 0) { hangars.delete(m.o); const x = lobby.get(m.o); if (x) { x.b = null; x.siteOk = false; } bots.delete(m.o - 1000); bcast({ ev: { t: 'hdead', o: m.o, by: id, id } }); }
      } else if (m.t === 'wreck' && Number.isInteger(m.id) && m.id >= 0 && m.id < WRECKS && !deadWrecks.has(m.id)) {
        deadWrecks.set(m.id, Date.now() + WRECK_RESPAWN_MS);
        relay(id, { t: 'wreck', w: m.id, by: id });
      }
    } catch {}
  });
  ws.on('close', () => {
    players.delete(id); bots.delete(id); const mem = ws.token && members.get(ws.token);
    if (room && mem) {
      if (room.phase === 'lobby') { if (mem.id === id) { members.delete(ws.token); if (room.host === ws.token) { const nx = members.keys().next().value; if (nx) room.host = nx; else closeRoom(); } } } // salir de la sala de espera
      else if (room.phase !== 'launching' && mem.id === id) { lobby.delete(id); members.delete(ws.token); if (hangars.delete(id)) bcast({ ev: { t: 'hgone', o: id, id } }); } // desconexión durante la partida
    } else lobby.delete(id);
  });
});

setInterval(() => {
  const now = Date.now();
  if (room && room.phase === 'launching' && now - room.launchAt > 240000) { for (const t of [...room.expected]) if (!room.resumed.has(t)) members.delete(t); room.phase = phase = 'loading'; } // quien no llegó a la página del juego queda fuera
  if (room && !members.size) closeRoom();
  if (room && room.phase === 'loading') {
    const need = [...lobby.values()].filter(x => x.b);
    if (!hangars.size && need.length && need.every(x => x.siteOk) && [...botPlanets.values()].every(x => x.la != null)) { for (const [i, x] of lobby) if (x.b) makeHangar(i, x); for (const bp of botPlanets.values()) makeHangar(1000 + bp.i, { nm: 'BOT ' + bp.b, b: bp.b, la: bp.la, lo: bp.lo }); } // todos han elegido emplazamiento: se crean las bases
    if (hangars.size && need.every(x => x.ld >= 100)) room.phase = phase = 'playing'; // todos cargados al 100 %: empieza
  }
  for (const [w, t] of deadWrecks) if (t < now) deadWrecks.delete(w);
  for (const h of hangars.values()) { const st = baseStats(h.up || {}); if (h.up && h.up.sh && now - h.shT > 5000 && h.sh < st.shMax) h.sh = Math.min(st.shMax, h.sh + 20 * 0.066); } // el escudo de la base se regenera sin recibir golpes
  const msg = JSON.stringify({ players: [...players.values(), ...bots.values()].filter(Boolean), wd: [...deadWrecks.keys()], hg: [...hangars.values()].map(h => ({ o: h.o, nm: h.nm, b: h.b, la: h.la, lo: h.lo, hp: Math.round(h.hp), sh: Math.round(h.sh), up: h.up, ts: h.ts, tw: h.tw, bot: h.bot })), bl: [...botPlanets.values()], ph: phase, adm: admin(), rm: publicRoom(), seed: SEED, lb: [...lobby].map(([i, e]) => ({ id: i, nm: e.nm, b: e.b, ready: true, ld: e.ld ?? 0 })) });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}, 66);

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log('Servidor listo: abre el menú principal para crear una sala.');
  console.log(`Local:  http://localhost:${port}`);
  for (const l of Object.values(os.networkInterfaces()).flat())
    if (l.family === 'IPv4' && !l.internal) console.log(`Red:    http://${l.address}:${port}   <- pasa esta URL a tu amigo (misma red)`);
});
