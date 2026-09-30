// Naves NEUTRALES: grupos de 2-4 naves (casco gris verdoso) que vagan alrededor de las zonas de recursos y de los planetas (fuera de sus atmósferas y lejos de las bases).
// No atacan a nadie; si alguien (jugador, bot o torreta de una base) daña a una, TODO su grupo persigue y dispara a ese agresor (puntería imperfecta, cadencia baja) hasta que muere o se aleja mucho.
// Las simula el cliente del anfitrión (como bot.js) y las envía al servidor ('ns'); todos las reciben en el tick ('nv'). Los impactos y la recompensa los decide el anfitrión ('nhit').
// Nivel 1-10 (mayor lejos de la estrella): más vida, daño y velocidad, y más XP y botín. Recompensa (para quien más daño hizo): XP, munición llena y unos pocos recursos (no salen de las zonas).
const NEU = (() => {
  const TT = ['saeta', 'halcon', 'coloso', 'nomada'], HULL = 0x6f7b6c, ACC = 0x9dff6a, FWD = new THREE.Vector3(0, 0, -1); // TT: mismo orden que SHIPS en server.js
  const MAINS = bodies.filter(b => b.k !== 'sun' && !b.parent), MAXG = Math.min(9, 4 + MAINS.length); // grupos vivos a la vez: 4 + planetas principales (tope 9 → ≤ 36 naves, 'ns' ≈ 3 KB)
  const CALM = 60000, FIRE_R = 3500, SPREAD = 0.012, SEND_MS = 100, VIS = 300000, NEAR_MIN = 15000, RESPAWN = [12000, 30000]; // VIS: más lejos no se dibujan (ni son objetivo) · NEAR_MIN: nunca aparecen a menos de esto de un jugador · RESPAWN: ms tras aniquilar un grupo
  const E = new Map(), G = new Map(), pend = []; // E: id -> nave (simulada si soy el anfitrión, o recibida del servidor) · G: grupo -> { g, s (punto de encuentro), wp, host: agresor } · pend: reapariciones programadas
  let wasHost = false, sendT = 0, nid = 3000, gid = 1;
  const stOf = (t, lv) => { const T = TYPES[t]; return { hp: Math.round(T.hp * 0.3 + 5.6 * lv), sh: Math.round(T.sh * 0.15 + 2.1 * lv), dmg: Math.round((1.4 + 0.28 * lv) * 10) / 10, cd: 1.3 - 0.04 * lv, vmax: 40 + 6 * lv, vh: 105 + 17.5 * lv, turn: 1.3 * T.agil + 0.04 * lv }; }; // −30 % como los jugadores · vmax: crucero (km/s) · vh: persecución
  const nameOf = n => `${TYPES[n.t].name} neutral`;
  const world = n => { const A = bodies[n.a].pos; return [A[0] + n.r[0], A[1] + n.r[1], A[2] + n.r[2]]; }; // posición relativa a su cuerpo ancla: viaja con él
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1e3) / 1e3;
  function model(n) { if (n.grp) scene.remove(n.grp); n.grp = makeShip({ t: n.t, a: [0, 0, 0, 0, 0, 0], c: ACC }, HULL); n.grp.gear.visible = false; n.grp.visible = false; scene.add(n.grp); } // geometría compartida (caché de ships.js); oculta hasta que frame() la coloque
  function drop(id) { const n = E.get(id); if (n && n.grp) scene.remove(n.grp); E.delete(id); }
  const safeAlt = b => b.k === 'sun' ? 3 * b.R : Math.max(2500, 6 * (ATMO[b.n] ? ATMO[b.n].H : 0)); // nunca bajan a la atmósfera (así tampoco se acercan a las bases)
  // puntos de encuentro: cada zona de recursos y cada planeta principal (rutas habituales de los jugadores); c: centro relativo al cuerpo ancla a, r: radio por el que vagan
  const SPOTS = [...ZONES.map(z => ({ a: z.anchor, c: z.off, r: z.radius + 8000 })), ...MAINS.map(b => ({ a: b.i, c: [0, 0, 0], r: b.R + safeAlt(b) + 25000 }))];
  const spotPos = s => { const A = bodies[s.a].pos; return [A[0] + s.c[0], A[1] + s.c[1], A[2] + s.c[2]]; };
  function keepOut(n, w, D) { // desvía el rumbo hacia fuera al acercarse a un astro y, si aun así entra en la zona prohibida, la saca
    for (const b of bodies) {
      const d = sub(w, b.pos), l = len(d), alt = l - b.R, s = safeAlt(b); if (alt > s + 3000) continue; const up = d.map(c => c / l);
      D.addScaledVector(new THREE.Vector3(up[0], up[1], up[2]), 1.5 * Math.min(1, (s + 3000 - alt) / 3000)).normalize();
      if (alt < s) n.r = n.r.map((c, i) => c + up[i] * (s - alt));
    }
  }
  const rndDir = () => { const u = rnd(-1, 1), th = rnd(0, 6.2832), s = Math.sqrt(1 - u * u); return [s * Math.cos(th), u, s * Math.sin(th)]; };
  function wpOf(si) { // punto de paso al azar en torno a un punto de encuentro, relativo a su cuerpo ancla y fuera de la zona prohibida de ese cuerpo
    const s = SPOTS[si], d = rndDir(), k = rnd(0.2, 1) * s.r; let wp = s.c.map((c, i) => c + d[i] * k);
    const b = bodies[s.a]; if (b.k !== 'sun') { const l = len(wp) || 1, mn = b.R + safeAlt(b) + 2000; if (l < mn) wp = wp.map(c => c * (mn + rnd(0, 5000)) / l); }
    return wp;
  }
  function newId() { let k = 0; do { nid = nid >= 3999 ? 3000 : nid + 1; } while (E.has(nid) && ++k < 1000); return nid; }
  function spawnGroup() { // en un punto de encuentro (zonas y planetas), sin otro grupo si se puede y nunca a menos de NEAR_MIN de un jugador
    const foes = [S.pos, ...[...remotes.values()].filter(r => r.apos).map(r => r.apos)], used = new Set([...G.values()].map(g => g.s));
    const cand = SPOTS.map((s, si) => ({ si, d: Math.min(...foes.map(f => dist(f, spotPos(s)))) }));
    let pool = cand.filter(c => c.d > NEAR_MIN && !used.has(c.si)); if (!pool.length) pool = cand.filter(c => c.d > NEAR_MIN); if (!pool.length) pool = [cand.sort((a, b) => b.d - a.d)[0]];
    const si = pool[(Math.random() * pool.length) | 0].si, s = SPOTS[si], far = len(spotPos(s)) / Math.max(...SPOTS.map(q => len(spotPos(q)))), lv0 = Math.max(1, Math.min(10, 1 + Math.floor(Math.random() * 5 + far * 5))); // nivel: al azar y mayor cuanto más lejos de la estrella
    const g = gid++, size = [2, 3, 3, 3, 4][(Math.random() * 5) | 0], c0 = wpOf(si);
    G.set(g, { g, s: si, wp: wpOf(si), host: null });
    for (let i = 0; i < size; i++) {
      const t = TT[(Math.random() * TT.length) | 0], lv = Math.max(1, Math.min(10, lv0 + (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0))), st = stOf(t, lv), id = newId(), off = [(i - (size - 1) / 2) * 2.5, (i % 2) * 1.2, (i % 2 ? 1 : -1) * 1.5];
      const n = { id, g, t, lv, a: s.a, r: c0.map((c, k) => c + off[k]), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd(0, 6.28), 0)), v: st.vmax * 0.5, hp: 100, sh: 100, h: 0, st, hpA: st.hp, shA: st.sh, cd: rnd(0, 1), dmg: new Map(), off };
      model(n); E.set(id, n);
    }
  }
  function adopt() { // paso a ser el anfitrión: sigo simulando las naves que ya existían (último estado recibido del servidor), sin duplicarlas
    for (const n of E.values()) {
      if (!n.st) { n.st = stOf(n.t, n.lv); n.hpA = n.hp / 100 * n.st.hp; n.shA = n.sh / 100 * n.st.sh; n.cd = rnd(0, 1); n.dmg = new Map(); n.off = [rnd(-2, 2), rnd(-1, 1), rnd(-2, 2)]; n.t0 = 0; }
      if (!G.has(n.g)) { const w = world(n); let si = 0, bd = Infinity; SPOTS.forEach((s, i) => { const d = dist(spotPos(s), w); if (d < bd) { bd = d; si = i; } }); G.set(n.g, { g: n.g, s: si, wp: wpOf(si), host: null }); }
      const sa = SPOTS[G.get(n.g).s].a; if (sa !== n.a) { const w = world(n); n.a = sa; n.r = sub(w, bodies[sa].pos); } // mismo ancla que su punto de encuentro
      nid = Math.max(nid, n.id); gid = Math.max(gid, n.g + 1);
    }
  }
  function foe(id) { // agresor: posición, velocidad (km/s) y orientación; null si murió o ya no está
    if (id === myId) return P.hp > 0 ? { pos: S.pos, v: S.ve || 0, q: S.q } : null;
    if (id >= 2000 && id < 3000) { const B = typeof BOT !== 'undefined' && BOT.bots.get(id - 2000); return B && !B.dead ? { pos: B.pos, v: B.v, q: B.q } : null; }
    const r = remotes.get(id); return r && r.hp > 0 && r.apos ? { pos: r.apos, v: r.v || 0, q: r.q } : null;
  }
  function fire(n, pos, dir) {
    const key = `${myId ?? 0}:n${n.id}_${++seq}`, rb = n.a > 0 ? n.a : -1;
    spawnProj(n.id, key, 'p', pos, dir, null, n.st.dmg); sfx('p', dist(pos, S.pos));
    send({ t: 'fire', key, kind: 'p', pos, dir, tgt: null, dmg: n.st.dmg, rb, rp: rb >= 0 ? sub(pos, bodies[rb].pos) : null, ow: n.id });
  }
  function step(n, gr, F, dt) {
    const st = n.st, w = world(n); let T, vDes;
    if (F) { const d = dist(F.pos, w); T = F.pos; vDes = Math.max(20, Math.min(st.vh, (d - 600) * 0.6)); } // hostil: persigue al agresor
    else { const A = bodies[n.a].pos; T = gr.wp.map((c, i) => A[i] + c + n.off[i]); vDes = Math.min(st.vmax, 5 + dist(T, w) * 0.2); } // neutral: en formación hacia el punto de paso
    const D = new THREE.Vector3(...nrm(sub(T, w))); keepOut(n, w, D);
    n.q.rotateTowards(lookQ([D.x, D.y, D.z]), st.turn * dt); n.v += (vDes - n.v) * (1 - Math.exp(-dt * 1.2));
    const f = FWD.clone().applyQuaternion(n.q); n.r = [n.r[0] + f.x * n.v * dt, n.r[1] + f.y * n.v * dt, n.r[2] + f.z * n.v * dt];
    n.shA = Math.min(st.sh, n.shA + dt * 2); n.hp = n.hpA / st.hp * 100; n.sh = n.shA / st.sh * 100; n.h = F ? 1 : 0; n.cd -= dt;
    if (!F || n.cd > 0) return;
    const mp = world(n), d = dist(F.pos, mp); if (d > FIRE_R) return;
    const fv = FWD.clone().applyQuaternion(F.q), tt = d / WPN.p.speed, ap = F.pos.map((c, i) => c + fv.getComponent(i) * F.v * tt), ad = nrm(sub(ap, mp)); // apunta por delante del agresor
    if (f.x * ad[0] + f.y * ad[1] + f.z * ad[2] > Math.cos(0.3)) { n.cd = st.cd * rnd(0.8, 1.3); fire(n, mp, nrm(ad.map(c => c + rnd(-SPREAD, SPREAD)))); } // con dispersión: puntería imperfecta
  }
  function sim(dt, now) {
    for (const g of [...G.keys()]) if (![...E.values()].some(n => n.g === g)) { G.delete(g); pend.push(now + rnd(RESPAWN[0], RESPAWN[1])); } // grupo aniquilado: otro aparecerá en 12-30 s
    if (G.size + pend.length < MAXG) spawnGroup(); else { const i = pend.findIndex(t => t <= now); if (i >= 0) { pend.splice(i, 1); spawnGroup(); } } // al empezar se reponen todos (uno por cuadro)
    for (const gr of G.values()) {
      const ms = [...E.values()].filter(n => n.g === gr.g), lead = ms[0]; if (!lead) continue;
      let F = gr.host != null ? foe(gr.host) : null;
      if (gr.host != null && (!F || dist(F.pos, world(lead)) > CALM)) { gr.host = null; F = null; } // el agresor murió o se alejó mucho: el grupo se calma
      if (!F && dist(world(lead), bodies[lead.a].pos.map((c, i) => c + gr.wp[i] + lead.off[i])) < 300) gr.wp = wpOf(gr.s);
      for (const n of ms) step(n, gr, F, dt);
    }
    if (now - sendT > SEND_MS) { sendT = now; send({ t: 'ns', l: [...E.values()].map(n => [n.id, n.g, n.a, r1(n.r[0]), r1(n.r[1]), r1(n.r[2]), r3(n.q.x), r3(n.q.y), r3(n.q.z), r3(n.q.w), Math.round(n.v), Math.round(n.hp), Math.round(n.sh), TT.indexOf(n.t), n.lv, n.h]) }); }
  }
  function frame(dt, now) {
    const host = BASE.isHost() && BASE.started() && !BASE.loading() && BASE.LB.phase === 'playing';
    if (host && !wasHost) adopt(); if (!host && wasHost) { G.clear(); pend.length = 0; } wasHost = host;
    if (host) sim(dt, now);
    for (const n of E.values()) { // dibujo (los demás clientes extrapolan con la velocidad desde el último tick); más allá de VIS no se dibujan
      if (!n.grp) model(n);
      let w = world(n); if (!host && n.t0) { const f = FWD.clone().applyQuaternion(n.q), k = n.v * Math.min(1, (now - n.t0) / 1000); w = [w[0] + f.x * k, w[1] + f.y * k, w[2] + f.z * k]; }
      const v = view(w); n.w = w; n.dist = v.d; n.dir = [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d]; n.grp.visible = v.d < VIS; if (!n.grp.visible) continue;
      n.grp.position.set(v.x, v.y, v.z); n.grp.scale.setScalar(Math.max(v.s, v.rd * 0.12)); n.grp.quaternion.copy(n.q); setThrust(n.grp, n.v, now); updateShipFx(n.grp, now, 0);
    }
  }
  function sync(nv) { // estado del servidor (solo lo usa quien no simula)
    if (wasHost || !Array.isArray(nv)) return; const seen = new Set();
    for (const e of nv) {
      const [id, g, a, rx, ry, rz, qx, qy, qz, qw, v, hp, sh, ti, lv, h] = e, t = TT[ti]; if (!t || !bodies[a]) continue; seen.add(id);
      let n = E.get(id); if (!n || n.t !== t) { if (n) drop(id); n = { id, t, q: new THREE.Quaternion() }; E.set(id, n); model(n); }
      Object.assign(n, { g, a, r: [rx, ry, rz], v, hp, sh, lv, h, t0: performance.now() }); n.q.set(qx, qy, qz, qw).normalize();
    }
    for (const id of [...E.keys()]) if (!seen.has(id)) drop(id);
  }
  function lootOf(lv) { // botín pequeño: 1-2 recursos comunes; oro (raro) solo desde el nivel 6
    const pool = ['cobre', 'plata', 'piedra', 'agua'], a = pool[(Math.random() * 4) | 0], out = [{ type: a, n: 2 + Math.floor(lv / 2) + ((Math.random() * 3) | 0) }];
    if (Math.random() < 0.5) { const b = pool.filter(x => x !== a)[(Math.random() * 3) | 0]; out.push({ type: b, n: 1 + Math.floor(lv / 3) + ((Math.random() * 2) | 0) }); }
    if (lv >= 6 && Math.random() < 0.15 + 0.05 * (lv - 6)) out.push({ type: 'oro', n: lv >= 9 ? 2 : 1 });
    return out;
  }
  function hit(old, pos, p, key, ak) { // proyectil contra una nave neutral: lo decide el anfitrión (los demás solo hacen desaparecer su propio disparo)
    if (p.owner >= 3000 || p.owner <= -1000) return false; // ni otras neutrales ni torretas de bases bot (las de bases humanas, dueño -id, sí)
    const R = p.spd !== undefined || ak > 0.02 ? 0.05 : HIT_R, who = p.owner < 0 ? -p.owner : p.owner; // who: el jugador (o bot) responsable
    for (const n of E.values()) {
      const w = n.w || world(n); if (segDist(old, pos, w) >= R) continue; // sin mirar si se dibuja aquí: el anfitrión decide aunque esa nave quede lejos de su cámara
      if (!wasHost) { if (p.owner !== myId) return false; puff(pos, 0.02, 0xffd070, 0.4, 0.012); return true; }
      const gr = G.get(n.g), dm = p.dmg, had = n.shA > 0, over = dm - n.shA; n.shA = Math.max(0, n.shA - dm); if (over > 0) n.hpA -= over;
      n.dmg.set(who, (n.dmg.get(who) || 0) + dm);
      if (gr && (gr.host == null || !foe(gr.host))) gr.host = who; // TODO el grupo pasa a hostil contra el agresor
      const dead = n.hpA <= 0; let win = -1, xp = 0, loot = [];
      if (dead) { let best = 0; for (const [o, d] of n.dmg) if (o < 1000 && d > best) { best = d; win = o; } xp = 4 + 3 * n.lv; loot = lootOf(n.lv); drop(n.id); } // recompensa para el jugador que más daño hizo
      else { n.hp = n.hpA / n.st.hp * 100; n.sh = n.shA / n.st.sh * 100; }
      const e = { t: 'nhit', n: n.id, by: who, key, dmg: dm, pos: w, dead, sh: had && over <= 0 ? 1 : 0, win, lv: n.lv, xp, loot };
      send(e); onHit(e); return true;
    }
    return false;
  }
  function onHit(e) { // evento de impacto (del anfitrión, o local si lo soy)
    killProj(e.key);
    if (e.dead) { boom(e.pos, 40); if (!wasHost) drop(e.n); if (e.win === myId) reward(e); }
    else if (e.sh) { sfx('shield', dist(e.pos, S.pos)); puff(e.pos, 0.02, 0x55c8ff, 0.4, 0.012); }
    else boom(e.pos, 6);
  }
  function reward(e) { // derribo propio: recursos (fuera del presupuesto de las zonas), munición y misiles llenos, y experiencia
    for (const it of e.loot || []) if (RES[it.type] && it.n > 0) FOOT.add(it.type, it.n);
    P.plasma = MAXA.plasma; P.missiles = MAXA.missiles; P.kills++; say('¡NAVE NEUTRAL DERRIBADA! MUNICIÓN RECARGADA');
    if (e.xp > 0) gainXp(e.xp, `Nave neutral Nv ${e.lv} derribada`);
  }
  function targets() { // objetivos del radar: TODAS las que se dibujan (se pueden fijar, marcar y elegir con Tab)
    const out = []; if (P.hp <= 0) return out;
    for (const n of E.values()) if (n.grp && n.grp.visible && n.dir) out.push({ kind: 'n', id: n.id, name: nameOf(n), hp: n.hp, sh: n.sh, grp: n.grp, dist: n.dist, dir: n.dir, lv: n.lv, st: n.t, hostile: !!n.h, g: n.g });
    return out;
  }
  function hostileNear(w, range, owner) { // (anfitrión) la neutral más cercana hostil a ese jugador: las torretas de su base le disparan
    if (!wasHost) return null; let best = null, bd = range;
    for (const n of E.values()) { const gr = G.get(n.g); if (!gr || gr.host !== owner || !n.w) continue; const d = dist(n.w, w); if (d < bd) { bd = d; best = { pos: n.w, v: n.v, q: n.q, d, id: n.id }; } }
    return best;
  }
  return { frame, sync, hit, onHit, targets, hostileNear, E, G, MAXG, SPOTS, pos: id => (E.get(id) || {}).w || null, speed: id => (E.get(id) || {}).v || 0, name: id => { const n = E.get(id); return n ? nameOf(n) : 'Nave neutral'; } };
})();
