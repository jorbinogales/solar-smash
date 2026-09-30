// Naves NEUTRALES: grupos de 2-4 naves (casco gris verdoso) que vagan alrededor de las zonas de recursos y de los planetas (fuera de sus atmósferas y lejos de las bases).
// No atacan a nadie; si alguien (jugador, bot o torreta de una base) daña a una, TODO su grupo persigue y dispara a ese agresor (puntería imperfecta, cadencia baja) hasta que muere o se aleja mucho.
// Las simula el cliente del anfitrión (como bot.js) y las envía al servidor ('ns'); todos las reciben en el tick ('nv'). Los impactos y la recompensa los decide el anfitrión ('nhit').
// Nivel 1-10 (mayor lejos de la estrella): más vida, daño y velocidad, y más XP y botín. Recompensa (para quien más daño hizo): XP, munición llena y unos pocos recursos (no salen de las zonas).
const NEU = (() => {
  const TT = ['saeta', 'halcon', 'coloso', 'nomada'], HULL = 0x6f7b6c, ACC = 0x9dff6a, FWD = new THREE.Vector3(0, 0, -1); // TT: las 4 primeras de SHIPS (server.js), en el mismo orden: el índice viaja por la red
  const MAINS = bodies.filter(b => b.k !== 'sun' && !b.parent); // la población se reparte por zonas (POP, más abajo)
  const CALM = 60000, FIRE_R = 3500, SPREAD = 0.012, SEND_MS = 100, VIS = 300000, NEAR_MIN = 15000; // VIS: más lejos no se dibujan (ni son objetivo) · NEAR_MIN: nunca aparecen a menos de esto de un jugador (si hay otro punto en su zona)
  const E = new Map(), G = new Map(); // E: id -> nave (simulada si soy el anfitrión, o recibida del servidor) · G: grupo -> { g, s (punto de encuentro), wp, host: agresor } · pend: reapariciones programadas
  let wasHost = false, sendT = 0, nid = 3000, gid = 1;
  const stOf = (t, lv) => { const T = TYPES[t]; return { hp: Math.round(T.hp * 0.3 + 5.6 * lv), sh: Math.round(T.sh * 0.15 + 2.1 * lv), dmg: Math.round((1.4 + 0.28 * lv) * 10) / 10, cd: 1.3 - 0.04 * lv, vmax: 40 + 6 * lv, vh: 105 + 17.5 * lv, turn: 1.3 * T.agil + 0.04 * lv }; }; // −30 % como los jugadores · vmax: crucero (km/s) · vh: persecución
  const nameOf = n => `${TYPES[n.t].name} neutral`;
  const world = n => { const A = bodies[n.a].pos; return [A[0] + n.r[0], A[1] + n.r[1], A[2] + n.r[2]]; }; // posición relativa a su cuerpo ancla: viaja con él
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1e3) / 1e3;
  function model(n) { if (n.grp) scene.remove(n.grp); n.grp = makeShip({ t: n.t, a: [0, 0, 0, 0, 0, 0], c: ACC }, HULL); n.grp.gear.visible = false; n.grp.visible = false; scene.add(n.grp); } // geometría compartida (caché de ships.js); oculta hasta que frame() la coloque
  function drop(id) { const n = E.get(id); if (n && n.grp) scene.remove(n.grp); E.delete(id); }
  const NEAR = [200, 300]; // km sobre la superficie de un planeta o sobre el BORDE de un cúmulo: ahí aparecen y patrullan
  const safeAlt = b => b.k === 'sun' ? STAR_KILL_R - b.R + 20000 : Math.max(NEAR[0], ATMO[b.n] ? 6 * ATMO[b.n].H + 20 : 0); // nunca bajan a la atmósfera: ≥ 200 km (o 6H + 20 si su atmósfera es más alta)
  // puntos de encuentro: cada zona de recursos y cada planeta principal (rutas habituales de los jugadores); c: centro relativo al cuerpo ancla a, r: radio por el que vagan (compactado con el sistema)
  const SPOTS = [...ZONES.map(z => ({ a: z.anchor, c: z.off, R: z.radius, k: 'c' })), ...MAINS.map(b => ({ a: b.i, c: [0, 0, 0], R: b.R, k: 'p' }))]; // cúmulos y planetas (nada en el centro vacío de un sector)
  const CZN = genControlZones(SYS);
  // ---------- POBLACIÓN POR ZONA: 5 grupos de 3 por zona de control (menos la solar). Solo se instancian y simulan los de zonas cercanas a alguien (ACT_KM), con un tope de naves activas;
  // las demás quedan «dormidas» (solo el estado de sus 5 plazas). Grupo aniquilado: reaparece a los 60-120 s (la mitad si su zona está activa). ----------
  const PER_ZONE = 5, GSIZE = 3, ACT_KM = 1.5e6 * SYS_SCALE, MAX_ACTIVE = 90, RESP_Z = [60000, 120000], ACT_MS = 1000;
  const POP = CZN.map(z => z.noClaim ? [] : Array.from({ length: PER_ZONE }, (_, k) => ({ zi: z.id, k, g: null, respT: 0 })));
  let actT = 0, ACTIVE = new Set();
  const spotPos = s => { const A = bodies[s.a].pos; return [A[0] + s.c[0], A[1] + s.c[1], A[2] + s.c[2]]; };
  function keepOut(n, w, D) { // desvía el rumbo hacia fuera al acercarse a un astro y, si aun así entra en la zona prohibida, la saca
    for (const b of bodies) {
      const d = sub(w, b.pos), l = len(d), alt = l - b.R, s = safeAlt(b), M = b.k === 'sun' ? 3000 : 40; if (alt > s + M) continue; const up = d.map(c => c / l); // margen: 40 km sobre planetas (patrullan a 200-300 km)
      D.addScaledVector(new THREE.Vector3(up[0], up[1], up[2]), 1.5 * Math.min(1, (s + M - alt) / M)).normalize();
      if (alt < s) n.r = n.r.map((c, i) => c + up[i] * (s - alt));
    }
  }
  const rndDir = () => { const u = rnd(-1, 1), th = rnd(0, 6.2832), s = Math.sqrt(1 - u * u); return [s * Math.cos(th), u, s * Math.sin(th)]; };
  const prng = seed => { let a = (seed * 2654435761) >>> 0 || 1; return () => { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; }; }; // sorteo determinista por grupo
  function homeOf(si, g) { // punto de encuentro del grupo: a 200-300 km de la superficie del planeta (lejos de la vertical de sus bases) o del borde del cúmulo, relativo al cuerpo ancla, + 3 puntos de patrulla (≤ 30 km)
    const s = SPOTS[si], r = prng(g * 7919 + si), hd = NEAR[0] + r() * (NEAR[1] - NEAR[0]), b = bodies[s.a], bases = s.k === 'p' && typeof BASE !== 'undefined' ? [...BASE.HG.values()].filter(h => h.b === b.n && h.dir && h.hp > 0).map(h => h.dir) : [];
    const ud = () => { const u = r() * 2 - 1, th = r() * 6.2832, q = Math.sqrt(1 - u * u); return [q * Math.cos(th), u * 0.35, q * Math.sin(th)]; }; let u = nrm(ud());
    for (let k = 0; k < 30 && bases.some(bd => u[0] * bd[0] + u[1] * bd[1] + u[2] * bd[2] > 0.5); k++) u = nrm(ud()); // lejos de la vertical de sus bases (sus torretas alcanzan 200 km)
    if (bases.some(bd => u[0] * bd[0] + u[1] * bd[1] + u[2] * bd[2] > 0.5)) { const m = nrm(bases.reduce((a, bd) => a.map((c, i) => c - bd[i]), [0, 0, 0])); if (len(m) > 0.5) u = m; } // último recurso: el lado opuesto a las bases
    const R = s.k === 'p' ? s.R + Math.max(hd, safeAlt(b) + (hd - NEAR[0])) : s.R + hd, home = s.c.map((c, i) => c + u[i] * R);
    const e1 = nrm([u[2], 0, -u[0]].every(x => !x) ? [1, 0, 0] : [u[2], 0, -u[0]]), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const pts = [0, 1, 2].map(k => { const a = k * 2.1 + r(), o = 10 + r() * 20, p = home.map((c, i) => c + (e1[i] * Math.cos(a) + e2[i] * Math.sin(a)) * o), q = sub(p, s.c), L = len(q) || 1; return s.c.map((c, i) => c + q[i] / L * R); }); // a la misma distancia del centro
    return { home, pts, R, hd };
  }
  const wpOf = gr => gr.pts[(Math.random() * gr.pts.length) | 0]; // siguiente punto de patrulla del grupo
  function newId() { let k = 0; do { nid = nid >= 3999 ? 3000 : nid + 1; } while (E.has(nid) && ++k < 1000); return nid; }
  function spawnGroup(zi, slot) { // junto a un planeta o cúmulo de SU zona (sin ninguno, el más cercano a ella), a 200-300 km; sin otro grupo si se puede y nunca a menos de NEAR_MIN de un jugador si hay alternativa
    const foes = [S.pos, ...[...remotes.values()].filter(r => r.apos).map(r => r.apos)], used = new Set([...G.values()].map(g => g.s));
    let cand = SPOTS.map((s, si) => ({ si, d: Math.min(...foes.map(f => dist(f, spotPos(s)))) })).filter(c => czAt(SYS, CZN, spotPos(SPOTS[c.si])) === zi); if (!cand.length) { const zc = czCenter(CZN[zi]); let bi = 0, bd = Infinity; SPOTS.forEach((sp, k) => { const d = dist(spotPos(sp), zc); if (d < bd) { bd = d; bi = k; } }); cand = [{ si: bi, d: Infinity }]; } // sector vacío: al planeta o cúmulo más cercano
    let pool = cand.filter(c => c.d > NEAR_MIN && !used.has(c.si)); if (!pool.length) pool = cand.filter(c => c.d > NEAR_MIN); if (!pool.length) pool = [cand.sort((a, b) => b.d - a.d)[0]];
    const si = pool[(Math.random() * pool.length) | 0].si, s = SPOTS[si], far = len(spotPos(s)) / Math.max(...SPOTS.map(q => len(spotPos(q)))), lv0 = Math.max(1, Math.min(10, 1 + Math.floor(Math.random() * 5 + far * 5))); // nivel: al azar y mayor cuanto más lejos de la estrella
    const g = gid++, size = GSIZE, hm = homeOf(si, g), c0 = hm.home;
    G.set(g, { g, s: si, ...hm, wp: hm.pts[0], host: null, zi, slot }); if (slot) slot.g = g;
    for (let i = 0; i < size; i++) {
      const t = TT[(Math.random() * TT.length) | 0], lv = Math.max(1, Math.min(10, lv0 + (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0))), st = stOf(t, lv), id = newId(), off = [(i - (size - 1) / 2) * 2.5, (i % 2) * 1.2, (i % 2 ? 1 : -1) * 1.5];
      const n = { id, g, t, lv, a: s.a, r: c0.map((c, k) => c + off[k]), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd(0, 6.28), 0)), v: st.vmax * 0.5, hp: 100, sh: 100, h: 0, st, hpA: st.hp, shA: st.sh, cd: rnd(0, 1), dmg: new Map(), off };
      model(n); E.set(id, n);
    }
  }
  function adopt() { // paso a ser el anfitrión: sigo simulando las naves que ya existían (último estado recibido del servidor), sin duplicarlas
    for (const n of E.values()) {
      if (!n.st) { n.st = stOf(n.t, n.lv); n.hpA = n.hp / 100 * n.st.hp; n.shA = n.sh / 100 * n.st.sh; n.cd = rnd(0, 1); n.dmg = new Map(); n.off = [rnd(-2, 2), rnd(-1, 1), rnd(-2, 2)]; n.t0 = 0; }
      if (!G.has(n.g)) { const w = world(n); let si = 0, bd = Infinity; SPOTS.forEach((s, i) => { const d = dist(spotPos(s), w); if (d < bd) { bd = d; si = i; } }); const zi = czAt(SYS, CZN, w), sl = (POP[zi] || []).find(q => q.g == null); const hm = homeOf(si, n.g); G.set(n.g, { g: n.g, s: si, ...hm, wp: hm.pts[0], host: null, zi, slot: sl || null }); if (sl) sl.g = n.g; }
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
    spawnProj(n.id, key, 'p', pos, dir, null, n.st.dmg); sfx('plasma', pos);
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
    if (f.x * ad[0] + f.y * ad[1] + f.z * ad[2] > Math.cos(0.3)) { n.cd = weaponCd(WEAPONS.plasma, n, st.cd); fire(n, mp, nrm(ad.map(c => c + rnd(-SPREAD, SPREAD)))); } // con dispersión: puntería imperfecta
  }
  function sim(dt, now) {
    for (const [g, gr] of [...G]) if (![...E.values()].some(n => n.g === g)) { G.delete(g); if (gr.slot) { gr.slot.g = null; gr.slot.respT = now + rnd(RESP_Z[0], RESP_Z[1]) * (ACTIVE.has(gr.zi) ? 0.5 : 1); } } // grupo aniquilado: su plaza reaparece en 60-120 s (30-60 s si hay alguien cerca)
    if (now >= actT) { actT = now + ACT_MS; population(now); }
    for (const gr of G.values()) {
      const ms = [...E.values()].filter(n => n.g === gr.g), lead = ms[0]; if (!lead) continue;
      let F = gr.host != null ? foe(gr.host) : null;
      if (gr.host != null && typeof WAR !== 'undefined') { const SF = WAR.nearestOwned(gr.host, world(lead), CALM); if (SF && (!F || dist(SF.pos, world(lead)) < dist(F.pos, world(lead)))) F = SF; } // también atacan sus buques, satélites y cazas
      if (gr.host != null && (!F || dist(F.pos, world(lead)) > CALM)) { gr.host = null; F = null; } // el agresor murió o se alejó mucho: el grupo se calma
      if (!F && dist(world(lead), bodies[lead.a].pos.map((c, i) => c + gr.wp[i] + lead.off[i])) < 5) { if (Math.random() < 0.08) { const alt = SPOTS.map((sp, k) => k).filter(k => k !== gr.s && czAt(SYS, CZN, spotPos(SPOTS[k])) === gr.zi); if (alt.length) { gr.s = alt[(Math.random() * alt.length) | 0]; Object.assign(gr, homeOf(gr.s, gr.g + Math.floor(Math.random() * 1e6))); for (const n of ms) if (n.a !== SPOTS[gr.s].a) { const w = world(n); n.a = SPOTS[gr.s].a; n.r = sub(w, bodies[n.a].pos); } } } gr.wp = wpOf(gr); } // de vez en cuando cambia de planeta/cúmulo dentro de su zona
      for (const n of ms) step(n, gr, F, dt);
    }
    if (now - sendT > SEND_MS) { sendT = now; send({ t: 'ns', l: [...E.values()].map(n => [n.id, n.g, n.a, r1(n.r[0]), r1(n.r[1]), r1(n.r[2]), r3(n.q.x), r3(n.q.y), r3(n.q.z), r3(n.q.w), Math.round(n.v), Math.round(n.hp), Math.round(n.sh), TT.indexOf(n.t), n.lv, n.h]) }); }
  }
  const watchers = () => [S.pos, ...[...remotes.values()].filter(r => r.apos && r.hp > 0).map(r => r.apos), ...(typeof BOT !== 'undefined' ? [...BOT.bots.values()].filter(B => !B.dead).map(B => B.pos) : [])]; // jugadores y bots
  function population(now, W = watchers()) { // activa las zonas cercanas (por distancia), duerme las lejanas y repone plazas hasta el tope de naves activas (≤ 3 grupos nuevos por segundo)
    const dz = CZN.map((z, zi) => ({ zi, d: z.noClaim ? Infinity : Math.min(...W.map(p => czDist(z, p))) })).filter(x => x.d < ACT_KM).sort((a, b) => a.d - b.d); ACTIVE = new Set(dz.map(x => x.zi));
    for (const [g, gr] of [...G]) if (gr.zi !== undefined && !ACTIVE.has(gr.zi) && gr.host == null) { for (const n of [...E.values()]) if (n.g === g) drop(n.id); G.delete(g); if (gr.slot) gr.slot.g = null; } // se duerme: la plaza queda viva (reaparece al volver)
    let n = E.size, made = 0;
    for (const { zi } of dz) for (const sl of POP[zi]) { if (made >= 3 || n + GSIZE > MAX_ACTIVE) return; if (sl.g != null || now < sl.respT) continue; spawnGroup(zi, sl); n += GSIZE; made++; }
  }
  const popStats = () => ({ zones: POP.filter(p => p.length).length, perZone: PER_ZONE, gsize: GSIZE, active: E.size, groups: G.size, activeZones: ACTIVE.size, dormant: POP.reduce((a, p) => a + p.filter(sl => sl.g == null).length, 0) });
  function frame(dt, now) {
    const host = BASE.isHost() && BASE.started() && !BASE.loading() && BASE.LB.phase === 'playing';
    if (host && !wasHost) adopt(); if (!host && wasHost) { G.clear(); for (const p of POP) for (const sl of p) sl.g = null; } wasHost = host;
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
    const R = p.hr ?? (p.spd !== undefined || ak > 0.02 ? 0.05 : HIT_R), who = p.owner < 0 ? -p.owner : p.owner; // who: el jugador (o bot) responsable
    for (const n of E.values()) {
      const w = n.w || world(n); if (segDist(old, pos, w) >= R) continue; // sin mirar si se dibuja aquí: el anfitrión decide aunque esa nave quede lejos de su cámara
      if (!wasHost) { if (p.owner !== myId) return false; puff(pos, 0.02, 0xffd070, 0.4, 0.012); return true; }
      if (p.nl && Math.random() >= NOLOCK_HIT) { puff(pos, 0.01, 0xffd070, 0.3, 0.006); return true; } // disparo sin bloqueo: solo cuenta el 45 % de los impactos
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
    else if (e.sh) { sfx('escudo', e.pos); puff(e.pos, 0.02, 0x55c8ff, 0.4, 0.012); }
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
  function nearest(w, range) { // (anfitrión) la neutral más cercana al alcance, cualquiera: buques, satélites y cazas también les disparan (y se vuelven hostiles al dueño)
    if (!wasHost) return null; let best = null, bd = range; for (const n of E.values()) { if (!n.w) continue; const d = dist(n.w, w); if (d < bd) { bd = d; best = { pos: n.w, v: n.v, q: n.q, d, id: n.id }; } } return best;
  }
  return { NEAR, homeOf, population, popStats, POP, ACTIVE: () => ACTIVE, frame, sync, hit, onHit, targets, hostileNear, nearest, E, G, MAXG: MAX_ACTIVE / GSIZE, SPOTS, pos: id => (E.get(id) || {}).w || null, speed: id => (E.get(id) || {}).v || 0, name: id => { const n = E.get(id); return n ? nameOf(n) : 'Nave neutral'; } };
})();
