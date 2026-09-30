// Zonas de control (estilo mapa galáctico de Helldivers: teselan TODO el sistema en sectores anulares fijos respecto a la estrella), buques de guerra, satélites defensivos y escuadrones de CAZAS.
// El servidor es la autoridad (tick: cz, wb, sa, fq, fl · mensajes wdep / wh / fs · evento wdead). Aquí: modelos 3D cacheados (piezas fusionadas con kit()), marcadores y aviso de captura en el HUD,
// disparos de sus torretas (cada cliente simula las ENEMIGAS contra sí mismo, como las torretas de las bases; el anfitrión, además, las de TODAS contra bots y naves neutrales), la simulación de los
// cazas (en el anfitrión, como neutral.js/bot.js), impactos, reaparición en un buque y la pestaña FLOTA del menú. Usa bodies, S, P, view, spawnProj... de game.js y MAP (colocación).
// Ganchos para los modelos definitivos (L.E.O.A.R.T): WAR.models.W / .S / .F = función (mine) => THREE.Object3D (en km, proa hacia -z); si no existen se usan los provisionales de aquí.
const WAR = (() => {
  const C = WARCFG, CZ = genControlZones(SYS), CZS = CZ.map(() => ({ o: 0, c: 0, p: 0 })), WS = new Map(), SA = new Map(), FQ = new Map(), stock = { W: 0, S: 0, F: 0 }; // FQ: escuadrones de cazas · stock: comprados sin desplegar (los recursos ya se gastaron)
  let pref = 'base', synced = false, fsel = 'W', fsT = 0; // pref: punto de reaparición · fsel: unidad elegida en FLOTA · fsT: último envío del estado de los cazas (anfitrión)
  const RESN = ['agua', 'piedra', 'cobre', 'plata', 'oro', 'diamante'], SCW = C.ws.scale || 1, F = C.ftr, models = {}; // SCW: escala del buque (×4 ≈ 14 km)
  const all = () => [...WS.values(), ...SA.values()], mineW = () => [...WS.values()].filter(s => s.o === myId), mineF = () => [...FQ.values()].filter(f => f.o === myId), T = s => s.k === 'W' ? C.ws : C.sat;
  const nmOf = o => o >= 1000 ? ((BASE.HG.get(o) || {}).nm || 'BOT') : o === myId ? myName : ((BASE.LB.list.find(x => x.id === o) || {}).nm || (remotes.get(o) || {}).name || 'Piloto');
  const wpos = s => { const A = bodies[s.a].pos; return [A[0] + s.off[0], A[1] + s.off[1], A[2] + s.off[2]]; };
  const czPos = zi => czCenter(CZ[zi]); // zonas fijas respecto a la estrella (en el origen)
  const fwdOf = s => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(s.q); return [f.x, f.y, f.z]; };
  const inZone = zi => all().filter(s => s.zi === zi).length + [...FQ.values()].filter(f => f.zi === zi).length; // estructuras ya desplegadas en la zona (índice del punto automático: igual que el servidor)

  // ---------- estado de las zonas visto por mí: AZUL mía · ROJO enemiga o peligrosa · ÁMBAR reclamándose · GRIS neutral ----------
  const dangerOf = zi => czDanger(SYS, CZ, zi, myId, [...BASE.HG.values()], [...WS.values()], simT); // ZONA ROJA: contiene (o roza) un planeta con hangar enemigo o un buque enemigo
  function look(zi) {
    if (CZ[zi].noClaim) return { col: '#ff9f1c', txt: 'ZONA SOLAR', sun: true, p: 0 };
    const Z = CZS[zi], dg = dangerOf(zi);
    if (Z.c && Z.p > 0) return { col: '#ffb347', txt: `${Z.c === myId ? 'RECLAMANDO' : 'EN DISPUTA · ' + nmOf(Z.c).toUpperCase()} ${Z.p} %`, cap: true, p: Z.p };
    if (Z.o === myId) return { col: '#4db8ff', txt: dg ? 'TUYA · ZONA ROJA' : 'TUYA · SEGURA', p: 100 };
    if (Z.o) return { col: '#ff3b30', txt: 'ENEMIGA · ' + nmOf(Z.o).toUpperCase(), p: 100 };
    return dg ? { col: '#ff6a5a', txt: 'NEUTRAL · PELIGRO', p: 0 } : { col: '#dfe8ee', txt: 'NEUTRAL', p: 0 };
  }
  const owner = zi => { const z = CZ[zi], Z = CZS[zi]; return z.noClaim ? 'Zona solar · no reclamable' : Z.c && Z.p > 0 ? (Z.c === myId ? `Reclamando (tú) · ${Z.p} %` : `En disputa · ${nmOf(Z.c)} ${Z.p} %`) : Z.o === myId ? 'Tuya' : Z.o ? nmOf(Z.o) : 'Sin dueño'; }; // a quién pertenece (lo único que se muestra al pasar el ratón por una zona)
  const UN = { W: 'Buque de guerra', S: 'Satélite defensivo', F: 'Escuadrón de cazas' };
  function check(k, zi, off) { // '' = se puede desplegar ahí (misma validación que el servidor: sysgen.czCheck)
    if (!stock[k]) return `No tienes ${UN[k].toLowerCase()} en reserva: cómpralo en la base`;
    if (k === 'W' && mineW().length >= C.ws.max) return `Máximo ${C.ws.max} buques desplegados`;
    if (k === 'F' && mineF().length >= F.max) return `Máximo ${F.max} escuadrones de cazas`;
    if (k === 'S' && [...SA.values()].filter(s => s.o === myId && s.zi === zi).length >= C.sat.maxZone) return `Máximo ${C.sat.maxZone} satélites por zona`;
    return czCheck(SYS, CZ, zi, off, myId, CZS[zi] ? CZS[zi].o : 0, [...BASE.HG.values()], [...WS.values()], simT);
  }

  // ---------- modelos (km; proa hacia -z). Se construyen UNA vez y todas las instancias comparten geometría y materiales ----------
  const std = (c, e = 0.12, m = 0.45, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: c, emissiveIntensity: e });
  const hullM = std(0x7d8792), darkM = std(0x2f353d, 0.1), whiteM = std(0xe8edf2, 0.15, 0.1, 0.5), panelM = std(0x1d4a8a, 0.35, 0.6, 0.35), winM = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
  const GL = {}, GA = new THREE.MeshBasicMaterial({ color: 0x4db8ff }), GE = new THREE.MeshBasicMaterial({ color: 0xff4030 }); // GL: pieza luminosa (azul si es mía, roja si es enemiga)
  const Bx = (w, h, d) => new THREE.BoxGeometry(w, h, d), Cy = (r0, r1, h, s = 12) => new THREE.CylinderGeometry(r0, r1, h, s);
  let PW = null, PS = null, HALO = null;
  function partsW() { // buque de guerra (modelo de 3,46 km × SCW): casco angular con proa en cuña, cubierta de vuelo, puente, costados con hangar iluminado, 6 torretas y 3 motores
    if (PW) return PW; const K = kit();
    K.add(hullM, Bx(0.62, 0.34, 2.3), [0, 0, 0.15]); K.add(hullM, Cy(0.001, 0.44, 0.9, 4).rotateX(-PI / 2).rotateZ(PI / 4), [0, 0, -1.45], [0, 0, 0], [1, 0.55, 1]); // casco y proa
    K.add(darkM, Bx(0.3, 0.14, 1.9), [0, -0.23, 0.1]); K.add(hullM, Bx(0.46, 0.12, 1.7), [0, 0.23, 0.35]); K.add(darkM, Bx(0.4, 0.02, 1.5), [0, 0.3, 0.35]); // quilla, cubierta y pista
    K.mir(GL, Bx(0.012, 0.012, 1.5), [0.2, 0.315, 0.35]); for (let i = 0; i < 6; i++) K.add(winM, Bx(0.05, 0.01, 0.02), [0, 0.312, -0.3 + i * 0.25]); // balizas de la pista
    K.add(hullM, Bx(0.2, 0.34, 0.34), [0, 0.46, 0.85]); K.add(winM, Bx(0.205, 0.04, 0.345), [0, 0.55, 0.85]); K.add(darkM, Cy(0.012, 0.012, 0.3, 5), [0, 0.78, 0.9]); K.add(GL, new THREE.SphereGeometry(0.025, 8, 6), [0, 0.94, 0.9]); // puente y mástil
    K.mir(hullM, Bx(0.16, 0.2, 1.3), [0.39, -0.02, 0.3]); K.mir(darkM, Bx(0.02, 0.05, 1.2), [0.47, 0.02, 0.3]); K.mir(GL, Bx(0.01, 0.015, 1.25), [0.475, -0.07, 0.3]); // costados con franja luminosa
    K.mir(darkM, Bx(0.02, 0.15, 0.36), [0.465, -0.01, -0.2]); K.mir(winM, Bx(0.006, 0.12, 0.32), [0.477, -0.01, -0.2]); // bocas del hangar iluminadas
    for (const x of [-0.2, 0, 0.2]) { K.add(darkM, cylZ(0.11, 0.13, 0.28, 12), [x, -0.02, 1.4]); K.add(GL, cylZ(0.09, 0.09, 0.02, 12), [x, -0.02, 1.55]); } // motores
    for (const z of [-0.2, 0.35, 0.8]) for (const x of [-0.39, 0.39]) { K.add(darkM, Cy(0.06, 0.07, 0.04, 10), [x, 0.1, z]); K.add(hullM, Bx(0.09, 0.05, 0.1), [x, 0.145, z]); for (const bx of [-0.018, 0.018]) K.add(darkM, cylZ(0.008, 0.008, 0.18, 6), [x + bx, 0.15, z - 0.13]); } // torretas
    return (PW = K.parts());
  }
  function partsS() { // satélite defensivo (~0,9 km de envergadura): cuerpo hexagonal, dos alas de paneles solares, antena parabólica y cañón largo con bobinas
    if (PS) return PS; const K = kit();
    K.add(hullM, Cy(0.09, 0.09, 0.16, 6), [0, 0, 0]); for (const y of [-0.09, 0.09]) K.add(darkM, Cy(0.095, 0.095, 0.02, 6), [0, y, 0]); K.add(GL, new THREE.TorusGeometry(0.1, 0.008, 4, 6).rotateX(PI / 2), [0, 0, 0]);
    K.mir(hullM, Bx(0.14, 0.015, 0.015), [0.16, 0, 0]); K.mir(panelM, Bx(0.32, 0.006, 0.14), [0.39, 0, 0]); for (const x of [0.29, 0.39, 0.49]) K.mir(darkM, Bx(0.004, 0.009, 0.142), [x, 0, 0]); // paneles solares
    K.add(whiteM, new THREE.SphereGeometry(0.1, 14, 6, 0, PI * 2, 0, 0.8), [0, 0.25, 0], [PI, 0, 0]); K.add(darkM, Cy(0.008, 0.008, 0.08, 5), [0, 0.12, 0]); K.add(darkM, Cy(0.004, 0.004, 0.1, 4), [0, 0.22, 0]); K.add(GL, new THREE.SphereGeometry(0.012, 8, 6), [0, 0.28, 0]); // antena parabólica
    K.add(darkM, Bx(0.08, 0.08, 0.12), [0, -0.12, 0]); K.add(hullM, cylZ(0.022, 0.03, 0.42, 10), [0, -0.12, -0.25]); K.add(darkM, cylZ(0.03, 0.03, 0.04, 10), [0, -0.12, -0.46]); for (const z of [-0.12, -0.22, -0.32]) K.add(GL, new THREE.TorusGeometry(0.03, 0.005, 4, 10), [0, -0.12, z]); // cañón de largo alcance
    return (PS = K.parts());
  }
  function mesh(parts, mine) { const g = new THREE.Group(); for (const [m, geo] of parts) g.add(new THREE.Mesh(geo, m === GL ? (mine ? GA : GE) : m)); return g; }
  const unitModel = (k, mine) => models[k] ? models[k](mine) : k === 'F' ? (() => { const g = makeShip({ t: 'saeta', a: [0, 0, 0, 0, 0, 0], c: mine ? 0x4db8ff : 0xff4030 }); if (g.gear) g.gear.visible = false; setThrust(g, 0, 0); return g; })() : mesh(k === 'W' ? partsW() : partsS(), mine); // modelo PROVISIONAL (los definitivos, en models)
  const model = k => { if (k !== 'F') return unitModel(k, false); const g = new THREE.Group(); [[0, 0, -0.03], [-0.035, 0, 0.02], [0.035, 0, 0.02]].forEach(p => { const m = unitModel('F', false); m.position.set(...p); g.add(m); }); return g; }; // vista previa (recuadro del objetivo y FLOTA): el caza, en formación de 3
  const haloTex = () => HALO || (HALO = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })());
  function build(s) { const d = nrm([-s.off[0], 0, -s.off[2]]); // los buques y satélites se anclan a la estrella (a = 0, off absoluto); orientación fija: proa hacia la estrella (igual en todos los clientes)
    s.q = lookQ(d[0] || d[2] ? d : [0, 0, -1]); s.g = unitModel(s.k, s.o === myId); s.g.visible = false; scene.add(s.g);
    if (s.k === 'W') { s.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: s.o === myId ? 0x4db8ff : 0xff4030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false })); s.halo.scale.set(0.045, 0.045, 1); s.halo.visible = false; scene.add(s.halo); } } // halo: se ve desde cientos de miles de km
  const dropS = s => { if (s.g) scene.remove(s.g); if (s.halo) { scene.remove(s.halo); s.halo.material.dispose(); } };
  const dropF = f => { for (const c of f.c) if (c.g) scene.remove(c.g); };

  // ---------- red ----------
  function upd(M, rows, k) { // filas del tick: [id, dueño, zona, cuerpo ancla, x, y, z, vida, escudo (buque) | activo (satélite)]
    const seen = new Set();
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== 9 || !bodies[r[3]]) continue; const [id, o, zi, a, x, y, z, hp, e] = r; seen.add(id); let s = M.get(id);
      if (!s || s.o !== o) { if (s) dropS(s); s = { id, o, zi, a, off: [x, y, z], k }; M.set(id, s); build(s); }
      s.hp = hp; if (k === 'W') s.sh = e; else s.on = e;
    }
    for (const [id, s] of [...M]) if (!seen.has(id)) { dropS(s); M.delete(id); if (pref === id) pref = 'base'; }
  }
  function updF(rows) { // escuadrones: [id, dueño, zona, x, y, z, vida caza 1, 2, 3]
    const seen = new Set();
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== 6 + F.n || !r.every(Number.isFinite)) continue; const [id, o, zi, x, y, z] = r, hp = r.slice(6); seen.add(id); let f = FQ.get(id);
      if (!f || f.o !== o) { if (f) dropF(f); f = { id, o, zi, off: [x, y, z], hp: hp.slice(), c: [] }; for (let j = 0; j < F.n; j++) f.c.push({ pos: [x + (j - 1) * 6, y + 3 * (j % 2), z + 5], q: new THREE.Quaternion(), v: 0, cd: Math.random(), t0: 0, g: null, wp: null }); FQ.set(id, f); }
      for (let j = 0; j < F.n; j++) { if (f.hp[j] > 0 && !(hp[j] > 0)) boom(f.c[j].w || f.c[j].pos, 25); f.hp[j] = hp[j]; } // caza derribado
    }
    for (const [id, f] of [...FQ]) if (!seen.has(id)) { dropF(f); FQ.delete(id); }
  }
  function syncFl(rows) { // posiciones de los cazas (las simula el anfitrión): [id, caza, x, y, z, qx, qy, qz, qw, v]
    if (BASE.isHost()) return;
    for (const r of rows) { if (!Array.isArray(r) || r.length !== 10) continue; const f = FQ.get(r[0]), c = f && f.c[r[1]]; if (!c) continue; c.pos = [r[2], r[3], r[4]]; c.q.set(r[5], r[6], r[7], r[8]).normalize(); c.v = r[9]; c.t0 = performance.now(); }
  }
  function sync(m) {
    if (Array.isArray(m.cz) && m.cz.length === CZ.length) m.cz.forEach((r, i) => {
      const Z = CZS[i], [o, c, p, rs] = r; if (typeof rs === 'string' && RESN.includes(rs)) CZ[i].res = rs; // recurso forzado por el servidor (zona del planeta inicial: agua)
      if (synced && Z.o !== o) { if (o === myId) say(`¡Zona reclamada! Da +${C.gain.n} ${CZ[i].res} cada ${C.gain.every} s y ya puedes desplegar en ella`); else if (Z.o === myId) say('Has perdido una zona de control'); }
      Z.o = o; Z.c = c; Z.p = p;
    });
    if (Array.isArray(m.wb)) upd(WS, m.wb, 'W'); if (Array.isArray(m.sa)) upd(SA, m.sa, 'S'); if (Array.isArray(m.fq)) updF(m.fq); if (Array.isArray(m.fl)) syncFl(m.fl);
    synced = BASE.started() && !BASE.loading();
  }
  function onEvent(e) { // 'wdead': buque, satélite o escuadrón destruido (lo decide el servidor)
    if (e.k === 'F') { const f = FQ.get(e.i); if (f) { for (const c of f.c) boom(c.w || c.pos, 25); dropF(f); FQ.delete(e.i); } if (e.o === myId) say('¡Tu escuadrón de cazas ha sido destruido!'); else if (e.by === myId) { say('¡ESCUADRÓN DE CAZAS ENEMIGO DESTRUIDO!'); gainXp(12, 'Escuadrón de cazas destruido'); } return; }
    const M = e.k === 'W' ? WS : SA, s = M.get(e.i);
    if (s) { const w = s.w || wpos(s); boom(w, e.k === 'W' ? 300 : 50); if (e.k === 'W') boom([w[0], w[1] + 2, w[2]], 120); dropS(s); M.delete(e.i); }
    if (pref === e.i) pref = 'base';
    if (e.o === myId) say(e.k === 'W' ? '¡Tu buque de guerra ha sido destruido!' : '¡Uno de tus satélites defensivos ha sido destruido!');
    else if (e.by === myId) { say(e.k === 'W' ? '¡BUQUE DE GUERRA ENEMIGO DESTRUIDO!' : '¡SATÉLITE ENEMIGO DESTRUIDO!'); gainXp(e.k === 'W' ? 40 : 15, e.k === 'W' ? 'Buque de guerra destruido' : 'Satélite destruido'); }
  }
  function onOk(m) { if (m.wok) { stock[m.k] = Math.max(0, stock[m.k] - 1); say(`${UN[m.k] || 'Unidad'} desplegado`); } else say(m.why || 'No se pudo desplegar ahí'); }

  // ---------- por cuadro: posición (origen flotante), torretas y cazas ----------
  function blocked(a, b) { // ¿un astro entre a y b?
    const d = sub(b, a), L = len(d); if (L < 1e-6) return false; const u = d.map(c => c / L);
    for (const bd of bodies) { const oc = sub(a, bd.pos), R = bd.R * 0.999, Bq = oc[0] * u[0] + oc[1] * u[1] + oc[2] * u[2], Cq = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - R * R; if (Cq <= 0) continue; const disc = Bq * Bq - Cq; if (disc <= 0) continue; const te = -Bq - Math.sqrt(disc); if (te > 0 && te < L) return true; }
    return false;
  }
  function fire(s, t, tg) { // buque: plasma con puntería adelantada (precisión moderada) · satélite: misil guiado de largo alcance
    const homing = s.k === 'S', c = [s.w[0], s.w[1] + (homing ? 0 : 0.5 * SCW), s.w[2]], d0 = nrm(sub(tg.pos, c)), mp = c.map((x, i) => x + d0[i] * (homing ? 0.5 : 0.3 * SCW)); // bocas: sobre la cubierta del buque (escalado)
    let ap = tg.pos; if (!homing) { const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(tg.q); for (let k = 0; k < 2; k++) { const tt = len(sub(ap, mp)) / t.spd; ap = tg.pos.map((x, i) => x + fw.getComponent(i) * tg.v * tt); } }
    const l = len(sub(ap, mp)); if (l < 0.01) return; const dir = sub(ap, mp).map(x => x / l), kind = homing ? 'm' : 'p', tgt = homing ? { k: tg.id >= 3000 && tg.id < 4000 ? 'n' : 'p', id: tg.id } : null, key = `${myId ?? 0}:x${++seq}`, sn = (s.k === 'W' ? 'Buque de ' : 'Satélite de ') + nmOf(s.o);
    spawnProj(-s.o, key, kind, mp, dir, tgt, t.dmg, { spd: t.spd, col: homing ? 0x9fe8ff : 0xff8a3c, life: Math.min(60, l / t.spd * 1.5 + 3) }); const q = projs.get(key); if (q) q.sn = sn; // sn: nombre para el aviso de ataque
    send({ t: 'fire', key, kind, pos: mp, dir, tgt, dmg: t.dmg, tw: 1, spd: t.spd, rb: S.refB, rp: S.refB >= 0 ? sub(mp, bodies[S.refB].pos) : null });
    sfx(kind, l); s.cd = t.cd * (0.8 + 0.4 * Math.random());
    if (tg.id === myId) attackAlert('s', sn, s.w);
  }
  const hostT = (w, range) => (typeof BOT !== 'undefined' && BOT.nearestTo(w, range)) || (typeof NEU !== 'undefined' && NEU.nearest(w, range)) || null; // anfitrión: bots (enemigos de todos los humanos) y naves neutrales al alcance
  function fsim(dt, now) { // CAZAS (solo el anfitrión): patrullan en torno a su punto de despliegue, atacan a enemigos, bots y neutrales al alcance; su estado se envía al servidor ('fs')
    const rows = [];
    for (const f of FQ.values()) f.c.forEach((c, j) => {
      if (!(f.hp[j] > 0)) return; const cen = f.off;
      let tg = null;
      if (f.o !== myId && P.hp > 0 && !S.foot.on && len(sub(S.pos, cen)) < F.engage) tg = { pos: S.pos, v: S.ve || 0, q: S.q, id: myId };
      if (!tg) for (const r of remotes.values()) if (r.id !== f.o && r.id < 2000 && r.hp > 0 && r.apos && len(sub(r.apos, cen)) < F.engage) { tg = { pos: r.apos, v: r.v || 0, q: r.q, id: r.id }; break; }
      if (!tg) { const h = hostT(c.pos, F.range * 1.5); if (h && len(sub(h.pos, cen)) < F.engage) tg = h; }
      if (!c.wp || len(sub(c.wp, c.pos)) < 300) { const a = Math.random() * 6.2832, rr = F.patrol * (0.3 + 0.7 * Math.random()); c.wp = [cen[0] + Math.cos(a) * rr, cen[1] + (Math.random() - 0.5) * 1500, cen[2] + Math.sin(a) * rr]; }
      const T0 = tg ? tg.pos : c.wp, d = sub(T0, c.pos), dl = len(d), vDes = tg ? Math.min(F.vmax, Math.max(30, (dl - 400) * 0.6)) : Math.min(F.vmax * 0.5, 20 + dl * 0.2);
      c.q.rotateTowards(lookQ(nrm(d)), 2.4 * dt); c.v += (vDes - c.v) * (1 - Math.exp(-dt * 1.5)); const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(c.q);
      c.pos = [c.pos[0] + fw.x * c.v * dt, c.pos[1] + fw.y * c.v * dt, c.pos[2] + fw.z * c.v * dt]; c.cd -= dt;
      if (tg && c.cd <= 0 && dl < F.range && (fw.x * d[0] + fw.y * d[1] + fw.z * d[2]) / dl > Math.cos(0.3) && !blocked(c.pos, tg.pos)) { // plasma ligero (lo decide la víctima: el disparo se retransmite con ow = escuadrón)
        c.cd = F.cd * (0.8 + 0.4 * Math.random()); const key = `${myId ?? 0}:f${++seq}`, dir = nrm(d.map(x => x + (Math.random() - 0.5) * 0.02 * dl)); spawnProj(-f.o, key, 'p', c.pos, dir, null, F.dmg); sfx('p', len(sub(c.pos, S.pos)));
        send({ t: 'fire', key, kind: 'p', pos: c.pos, dir, tgt: null, dmg: F.dmg, rb: -1, rp: null, ow: f.id }); if (tg.id === myId) attackAlert('p', 'Cazas de ' + nmOf(f.o), c.pos);
      }
      rows.push([f.id, j, Math.round(c.pos[0] * 10) / 10, Math.round(c.pos[1] * 10) / 10, Math.round(c.pos[2] * 10) / 10, +c.q.x.toFixed(3), +c.q.y.toFixed(3), +c.q.z.toFixed(3), +c.q.w.toFixed(3), Math.round(c.v)]);
    });
    if (now - fsT > 100 && rows.length) { fsT = now; send({ t: 'fs', l: rows }); }
  }
  function frame(dt) {
    const now = performance.now();
    for (const s of all()) {
      s.w = wpos(s); const v = view(s.w), big = s.k === 'W'; s.d = v.d; s.g.visible = v.d < (big ? 5e6 : 300000);
      if (s.g.visible) { s.g.position.set(v.x, v.y, v.z); s.g.scale.setScalar(big ? Math.max(v.s * SCW, v.rd * 0.004) : v.s); s.g.quaternion.copy(s.q); } // buque: tamaño mínimo en pantalla (~10 px) a cualquier distancia
      if (s.halo) { s.halo.visible = s.g.visible && v.d > 60; s.halo.position.set(v.x, v.y, v.z); }
    }
    const host = BASE.isHost() && BASE.started() && !BASE.loading() && BASE.LB.phase === 'playing';
    if (host) fsim(dt, now);
    for (const f of FQ.values()) f.c.forEach((c, j) => { // dibujo de los cazas (los demás clientes extrapolan desde el último estado)
      if (!c.g) { c.g = unitModel('F', f.o === myId); scene.add(c.g); }
      let w = c.pos; if (!host && c.t0) { const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(c.q), k = c.v * Math.min(1, (now - c.t0) / 1000); w = [w[0] + fw.x * k, w[1] + fw.y * k, w[2] + fw.z * k]; }
      c.w = w; const v = view(w); c.d = v.d; c.g.visible = f.hp[j] > 0 && v.d < 300000; if (!c.g.visible) return;
      c.g.position.set(v.x, v.y, v.z); c.g.scale.setScalar(Math.max(v.s, v.rd * 0.12)); c.g.quaternion.copy(c.q); setThrust(c.g, c.v, now); updateShipFx(c.g, now, 0);
    });
    if (!BASE.started() || BASE.loading() || BASE.LB.phase !== 'playing') return;
    const alive = P.hp > 0 && !S.warp.on && !S.foot.on;
    for (const s of all()) { // torretas: a mí (si son enemigas) y, en el anfitrión, a bots y neutrales al alcance y con línea de visión
      if (s.k === 'S' && !s.on) continue; const t = T(s); s.cd = (s.cd ?? Math.random() * t.cd) - dt; if (s.cd > 0) continue;
      let tg = null;
      if (s.o !== myId && alive && s.d < t.range) tg = { pos: S.pos, v: S.ve || 0, q: S.q, id: myId };
      else if (host) tg = hostT(s.w, t.range);
      if (!tg || blocked(s.w, tg.pos)) { s.cd = 0.5; continue; }
      fire(s, t, tg);
    }
  }
  function hit(old, pos, p, neu, ak) { // proyectil contra un buque, satélite o caza: mío contra ajenos, o (anfitrión) de una neutral contra cualquiera · el daño lo decide el servidor ('wh')
    for (const s of all()) {
      if ((!neu && s.o === myId) || !s.w || segDist(old, pos, s.w) > 2.5 * SCW) continue;
      let ok = s.k === 'S' && segDist(old, pos, s.w) < 0.3;
      if (s.k === 'W') { const f = fwdOf(s); for (const z of [1.35, 0.45, -0.45, -1.25]) if (segDist(old, pos, s.w.map((c, i) => c + f[i] * z * SCW)) < 0.5 * SCW) ok = true; } // 4 esferas a lo largo del casco (escaladas)
      if (!ok) continue;
      send({ t: 'wh', k: s.k, i: s.id, dmg: p.dmg, nb: neu ? 1 : 0 }); const a = Math.min(s.sh || 0, p.dmg); if (s.k === 'W') s.sh -= a; s.hp -= p.dmg - a; boom(pos, p.kind === 'm' ? 0.08 : 0.02); if (!neu) P.lastCombat = performance.now(); return true;
    }
    const R = p.spd !== undefined || ak > 0.02 ? 0.05 : HIT_R;
    for (const f of FQ.values()) { if (!neu && f.o === myId) continue; for (let j = 0; j < F.n; j++) { const c = f.c[j]; if (!(f.hp[j] > 0) || !c.w || segDist(old, pos, c.w) > R) continue; send({ t: 'wh', k: 'F', i: f.id, j, dmg: p.dmg, nb: neu ? 1 : 0 }); f.hp[j] -= p.dmg; boom(pos, 0.02); return true; } }
    return false;
  }
  function nearestOwned(o, w, range) { // (neutral.js) la estructura o caza del jugador o más cercano: las neutrales hostiles a él también los atacan
    let best = null, bd = range; const q = new THREE.Quaternion();
    for (const s of all()) if (s.o === o && s.w) { const d = len(sub(s.w, w)); if (d < bd) { bd = d; best = { pos: s.w, v: 0, q, id: -1 }; } }
    for (const f of FQ.values()) if (f.o === o) f.c.forEach((c, j) => { if (f.hp[j] > 0 && c.w) { const d = len(sub(c.w, w)); if (d < bd) { bd = d; best = { pos: c.w, v: c.v, q: c.q, id: -1 }; } } });
    return best;
  }
  function targets() { // objetivos fijables (radar): buques, satélites y cazas ajenos a menos de 60 000 km
    const out = []; if (P.hp <= 0) return out;
    for (const s of all()) {
      if (s.o === myId || !s.w || s.d > 60000) continue; const v = view(s.w);
      out.push({ kind: s.k, id: s.id, name: (s.k === 'W' ? 'Buque de ' : 'Satélite de ') + nmOf(s.o), hp: s.hp / T(s).hp * 100, sh: s.k === 'W' ? s.sh / C.ws.sh * 100 : 0, grp: { position: new THREE.Vector3(v.x, v.y, v.z) }, dist: v.d, dir: [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d] });
    }
    for (const f of FQ.values()) if (f.o !== myId) f.c.forEach((c, j) => { if (!(f.hp[j] > 0) || !c.w || c.d > 60000 || !c.g) return; const v = view(c.w); out.push({ kind: 'F', id: f.id * 10 + j, name: 'Caza de ' + nmOf(f.o), hp: f.hp[j] / F.hp * 100, sh: 0, grp: c.g, dist: v.d, dir: [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d] }); });
    return out;
  }
  const posOf = (k, id) => { if (k === 'F') { const f = FQ.get(Math.floor(id / 10)), c = f && f.c[id % 10]; return c && f.hp[id % 10] > 0 ? c.w || c.pos : null; } const s = (k === 'W' ? WS : SA).get(id); return s && s.w ? s.w : null; };

  // ---------- HUD: rombos de buques y satélites (sin vida: solo el recuadro del objetivo la muestra), cartel de captura y selector de reaparición ----------
  const hexP = (x, y, r) => { g2.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; if (k) g2.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g2.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g2.closePath(); };
  function banner(zi, W, now) { // estilo «pegatina»: borde grueso #050f1c y sombra sólida
    const Z = CZS[zi], L = look(zi), x = W / 2 - 200, y = 200, p = Z.c ? Z.p / 100 : Z.o ? 1 : 0;
    g2.fillStyle = '#050f1c'; g2.beginPath(); g2.roundRect(x + 4, y + 4, 400, 58, 9); g2.fill(); g2.fillStyle = '#0b2233ee'; g2.beginPath(); g2.roundRect(x, y, 400, 58, 9); g2.fill(); g2.lineWidth = 3; g2.strokeStyle = '#050f1c'; g2.stroke();
    hexP(x + 30, y + 29, 19); g2.fillStyle = L.col; g2.fill(); g2.stroke(); if (Z.c) { hexP(x + 30, y + 29, 19 + 4 * Math.abs(Math.sin(now / 300))); g2.strokeStyle = L.col; g2.lineWidth = 2; g2.stroke(); }
    g2.textAlign = 'left'; g2.font = `bold 11px ${MONO}`; g2.fillStyle = '#9fd4ee'; g2.fillText('ZONA DE CONTROL', x + 58, y + 18);
    g2.font = `bold 13px ${MONO}`; g2.fillStyle = L.col; g2.fillText(Z.c === myId ? `RECLAMANDO… ${Z.p} % · permanece dentro` : `EN DISPUTA · ${nmOf(Z.c).toUpperCase()} ${Z.p} %`, x + 58, y + 35);
    g2.fillStyle = '#050f1c'; g2.fillRect(x + 58, y + 42, 328, 9); g2.fillStyle = L.col; g2.fillRect(x + 59, y + 43, 326 * p, 7); g2.textAlign = 'center';
  }
  function spawnOpts() { const o = []; if (BASE.mine()) o.push({ id: 'base', n: 'BASE' }); mineW().forEach((s, i) => o.push({ id: s.id, n: `BUQUE ${i + 1}` })); return o; }
  const curPref = () => { const o = spawnOpts(); return o.some(x => x.id === pref) ? pref : o[0] ? o[0].id : 'base'; };
  function hud(now) {
    if (!BASE.started() || BASE.loading()) return;
    const W = hc.width, H = hc.height; g2.save(); g2.textAlign = 'center';
    if (P.hp > 0 && !S.foot.on) {
      for (const s of all()) {
        if (!s.w) continue; const mine = s.o === myId, dl = s.d; if (s.k === 'S' && dl > (mine ? 400000 : C.sat.radar)) continue; // los satélites enemigos se ven en el radar hasta 1,5 M km
        const dd = sub(s.w, S.pos); if (dl < 0.3 || losBlocked({ kind: 'W', dir: dd.map(c => c / dl), dist: dl })) continue;
        const v = view(s.w); tv.set(v.x, v.y, v.z).project(camera); if (tv.z >= 1 || Math.abs(tv.x) > 0.97 || Math.abs(tv.y) > 0.95) continue;
        const x = (tv.x * 0.5 + 0.5) * W, y = (-tv.y * 0.5 + 0.5) * H - (dl < 160 ? 90 : 0), col = mine ? '#4db8ff' : '#ff3b30', r = s.k === 'W' ? 13 : 10;
        g2.beginPath(); g2.moveTo(x, y - r); g2.lineTo(x + r, y); g2.lineTo(x, y + r); g2.lineTo(x - r, y); g2.closePath(); g2.fillStyle = col; g2.fill(); g2.lineWidth = 3; g2.strokeStyle = '#050f1c'; g2.stroke();
        g2.fillStyle = '#050f1c'; g2.font = `900 ${r}px ${MONO}`; g2.fillText(s.k === 'W' ? 'B' : 'S', x, y + r * 0.35);
        if (dl < (s.k === 'W' ? LABEL_KM.buque : LABEL_KM.satelite) && !aimedIs(s.k, s.id)) hudText(x, y + r + 16, [[`${s.k === 'W' ? 'BUQUE' : 'SATÉLITE'} · ${mine ? 'TUYO' : nmOf(s.o).toUpperCase()}${s.k === 'S' && !s.on ? ' · INACTIVO' : ''} · ${fDs(dl)}`, mine ? '#9fd8ff' : '#ff8a7a', `bold 10px ${MONO}`]], 6); // solo nombre y distancia, cerca
      }
      const zi = czAt(SYS, CZ, S.pos, simT); if (CZS[zi].c && CZS[zi].p > 0) banner(zi, W, now); // solo mientras se reclama o se disputa (al llegar al 100 % desaparece: aviso puntual en #nt)
    }
    if (P.hp <= 0 && mineW().length) { // selector de reaparición: teclas 1-3
      const o = spawnOpts(), cur = curPref(), tx = 'REAPARECER EN:  ' + o.map((x, i) => `[${i + 1}] ${x.n}${x.id === cur ? ' ◀' : ''}`).join('   ');
      g2.font = `bold 14px ${MONO}`; g2.lineWidth = 4; g2.strokeStyle = '#000'; g2.fillStyle = '#9fe8ff'; g2.strokeText(tx, W / 2, H / 2 + 16); g2.fillText(tx, W / 2, H / 2 + 16);
    }
    g2.restore();
  }
  addEventListener('keydown', e => { if (P.hp > 0 || !BASE.started()) return; const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code), o = spawnOpts(); if (i >= 0 && o[i]) { pref = o[i].id; say(`Reaparecerás en: ${o[i].n}`); } });
  function spawn(noBase) { // reaparecer en la cubierta de mi buque elegido (o en el primero si no tengo base): true si lo hizo
    const my = mineW(); let s = my.find(x => x.id === pref); if (!s && noBase) s = my[0]; if (!s) return false;
    const w = wpos(s), f = fwdOf(s), p = [w[0] + f[0] * 0.8 * SCW, w[1] + 0.5 * SCW, w[2] + f[2] * 0.8 * SCW]; // cubierta del buque (escalado)
    S.pos = p.slice(); S.shipPos = p.slice(); S.v = 0; S.foot.on = false; S.park.on = false; S.auto = false; S.gearK = 0; S.q.copy(s.q); camQ.copy(S.q); S.w.p = S.w.y = S.w.r = 0;
    say('Despegas desde la cubierta de tu buque de guerra'); return true;
  }
  function deploy(k, zi, at = 'c') { // punto AUTOMÁTICO (sysgen.czDeployPoint, igual que el servidor): at 'p' junto al planeta de la zona · 'c' junto a su cúmulo; y si es válido
    const off = czDeployPoint(SYS, CZ, ZONES, zi, inZone(zi), at, simT); return { off, why: off ? check(k, zi, off) : 'Zona solar: no se puede desplegar', at };
  }
  const near = () => { const p = S.foot.on ? S.shipPos : S.pos; return mineW().some(s => s.w && len(sub(s.w, p)) < C.ws.near); }; // junto a mi buque cuenta como «en base»

  // ---------- pestaña FLOTA (3 columnas como NAVE): lista con COMPRAR · preview 3D + estadísticas · unidades desplegadas y reserva con DESPLEGAR ----------
  const DEF = '<defs><linearGradient id="gm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d3dd"/><stop offset=".55" stop-color="#7d8894"/><stop offset="1" stop-color="#4a535d"/></linearGradient><linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fe0ff"/><stop offset="1" stop-color="#1f7fd0"/></linearGradient><radialGradient id="gf"><stop offset="0" stop-color="#fff7d0"/><stop offset="1" stop-color="#ff9a1a"/></radialGradient></defs>';
  const SVG = {
    W: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${DEF}<path d="M2 40 11 32h27l4-10h9l3 10h7l-3 13H9z" fill="url(#gm)" stroke="#050f1c" stroke-width="3" stroke-linejoin="round"/><path d="M12 45h45l-2 5H14z" fill="#3a434d" stroke="#050f1c" stroke-width="2.5" stroke-linejoin="round"/><rect x="43" y="13" width="8" height="9" rx="1.5" fill="url(#gb)" stroke="#050f1c" stroke-width="2.5"/><path d="M47 13V6" stroke="#050f1c" stroke-width="2.5"/><circle cx="47" cy="5" r="2.2" fill="#4db8ff" stroke="#050f1c" stroke-width="1.5"/><path d="M14 38h40" stroke="#4db8ff" stroke-width="2.5"/><g fill="#050f1c"><rect x="17" y="27" width="7" height="5" rx="1"/><rect x="28" y="27" width="7" height="5" rx="1"/></g><path d="M20 27l6-4M31 27l6-4" stroke="#050f1c" stroke-width="2"/><ellipse cx="60" cy="41" rx="3" ry="4" fill="url(#gf)"/><path d="M16 34h4M24 34h4M32 34h4" stroke="#fff" stroke-width="1.5" opacity=".6"/></svg>`,
    S: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${DEF}<g stroke="#050f1c" stroke-width="2.5"><rect x="2" y="25" width="19" height="14" rx="1.5" fill="url(#gb)"/><rect x="43" y="25" width="19" height="14" rx="1.5" fill="url(#gb)"/></g><path d="M8 25v14M15 25v14M49 25v14M56 25v14M2 32h19M43 32h19" stroke="#0b3a66" stroke-width="1.3"/><path d="M21 32h6M37 32h6" stroke="#050f1c" stroke-width="3"/><path d="M26 22h12l4 10-4 10H26l-4-10z" fill="url(#gm)" stroke="#050f1c" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="32" r="3.5" fill="#4db8ff" stroke="#050f1c" stroke-width="1.5"/><path d="M22 17q10-12 20 0z" fill="#e8edf2" stroke="#050f1c" stroke-width="2.5" stroke-linejoin="round"/><path d="M32 17v5" stroke="#050f1c" stroke-width="2"/><rect x="29" y="42" width="6" height="14" rx="1" fill="#3a434d" stroke="#050f1c" stroke-width="2.5"/><path d="M32 44v10" stroke="#9fe8ff" stroke-width="1.8"/><circle cx="32" cy="58" r="2.4" fill="url(#gf)" stroke="#050f1c" stroke-width="1.2"/></svg>`,
    F: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${DEF}<g stroke="#050f1c" stroke-width="2.5" stroke-linejoin="round"><path d="M32 4l5 15 15 12v5l-13-3-3 10h-8l-3-10-13 3v-5l15-12z" fill="url(#gm)"/><path d="M14 44l4 10 5-8zM50 44l-4 10-5-8z" fill="url(#gm)"/></g><path d="M32 8l2.5 12h-5z" fill="url(#gb)" stroke="#050f1c" stroke-width="1.5"/><path d="M19 32l9-5M45 32l-9-5" stroke="#4db8ff" stroke-width="2.2"/><ellipse cx="32" cy="48" rx="3" ry="4" fill="url(#gf)" stroke="#050f1c" stroke-width="1.3"/><circle cx="18" cy="56" r="2" fill="url(#gf)"/><circle cx="46" cy="56" r="2" fill="url(#gf)"/></svg>`,
  };
  const COST = { W: C.ws.cost, S: C.sat.cost, F: F.cost }, DEPL = { W: 'DESPLEGAR', S: 'CONSTRUIR', F: 'DESPLEGAR' };
  const DESC = { W: 'Nave capital de ~14 km: reapareces en su cubierta y junto a ella compras como en la base.', S: 'Base flotante estática con misiles guiados de largo alcance. Se desactiva si pierdes su zona.', F: `${F.n} cazas ligeros que patrullan la zona y atacan enemigos y neutrales. Si caen los ${F.n}, se pierde.` };
  const STATS = k => k === 'W' ? [['Casco', C.ws.hp, 3000, '#5dff8a'], ['Escudo', C.ws.sh, 1000, '#4db8ff'], ['Alcance (km)', C.ws.range, 3000, '#ffd23f'], ['Daño/disparo', C.ws.dmg, 40, '#ff8a3c'], ['Disparos/s', +(6 / C.ws.cd).toFixed(1), 6, '#c8ff5d'], ['Velocidad (km/s)', 0, 400, '#f5a8ff'], ['Unidades', 1, 3, '#9fd4ee'], ['Máximo', C.ws.max, 3, '#9fd4ee']]
    : k === 'S' ? [['Vida', C.sat.hp, 3000, '#5dff8a'], ['Escudo', 0, 1000, '#4db8ff'], ['Alcance (km)', C.sat.range, 3000, '#ffd23f'], ['Daño/disparo', C.sat.dmg, 40, '#ff8a3c'], ['Disparos/s', +(1 / C.sat.cd).toFixed(2), 6, '#c8ff5d'], ['Velocidad (km/s)', 0, 400, '#f5a8ff'], ['Unidades', 1, 3, '#9fd4ee'], ['Por zona', C.sat.maxZone, 3, '#9fd4ee']]
    : [['Vida (cada caza)', F.hp, 3000, '#5dff8a'], ['Escudo', 0, 1000, '#4db8ff'], ['Alcance (km)', F.range, 3000, '#ffd23f'], ['Daño/disparo', F.dmg, 40, '#ff8a3c'], ['Disparos/s', +(F.n / F.cd).toFixed(1), 6, '#c8ff5d'], ['Velocidad (km/s)', F.vmax, 400, '#f5a8ff'], ['Unidades', F.n, 3, '#9fd4ee'], ['Máximo', F.max, 3, '#9fd4ee']];
  const full = k => k === 'W' ? mineW().length + stock.W >= C.ws.max : k === 'F' ? mineF().length + stock.F >= F.max : false;
  function preview(k) { // FLOTA: modelo de la unidad elegida en el visor 3D (FV, hangar.js), normalizado a ~2 unidades
    if (typeof FV === 'undefined' || FV.key === k) return; FV.key = k; if (FV.obj) FV.pivot.remove(FV.obj);
    const inner = model(k), g = new THREE.Group(); g.add(inner); g.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(g), sz = bx.getSize(new THREE.Vector3()), c = bx.getCenter(new THREE.Vector3()), s = 2.2 / (Math.max(sz.x, sz.y, sz.z) || 1);
    inner.position.copy(c.multiplyScalar(-1)); const o = new THREE.Group(); o.add(g); g.scale.setScalar(s); FV.obj = o; FV.pivot.add(o); FV.cam.position.set(2.3, 1.2, 2.8); FV.cam.lookAt(0, 0, 0);
  }
  function menu() {
    const eL = document.getElementById('fleetList'), eS = document.getElementById('fleetStats'), eD = document.getElementById('fleetDep'); if (!eL) return;
    eL.innerHTML = ['W', 'S', 'F'].map(k => `<div class="upc fsel${k === fsel ? ' on' : ''}" data-fsel="${k}"><i class="uico">${SVG[k]}</i><div><b>${UN[k]}</b><small>${DESC[k]}</small><div class="ctl">${full(k) ? '<span class="max">MÁXIMO</span>' : buyBtn(`data-war="${k}"`, COST[k])}</div></div></div>`).join('');
    eS.innerHTML = `<span style="grid-column:1/-1;font-weight:bold;letter-spacing:.12em;color:#9fd4ee">${UN[fsel].toUpperCase()}</span>` + STATS(fsel).map(([n, v, max, col]) => `<span>${n}</span>${bar(v, max, col)}<b>${v}</b>`).join('');
    const myS = [...SA.values()].filter(s => s.o === myId), myZ = CZ.filter((z, i) => CZS[i].o === myId), inc = {}; for (const z of myZ) inc[z.res] = (inc[z.res] || 0) + C.gain.n;
    const unit = (k, t, s) => `<div class="upc"><i class="uico">${SVG[k]}</i><div><b>${t}</b><small>${s}</small></div></div>`;
    const res = ['W', 'S', 'F'].filter(k => stock[k] > 0).map(k => `<div class="upc"><i class="uico">${SVG[k]}</i><div><b>${UN[k]} · en reserva ${stock[k]}</b><div class="ctl" style="display:flex;gap:6px">${full(k) ? '' : `<button class="buy kbuy" data-war="${k}"${atBase() && canPay(COST[k]) ? '' : ' disabled'} title="Comprar otro"><b>+</b></button>`}<button class="up" data-wdep="${k}"><b>${DEPL[k]}</b></button></div></div></div>`).join(''); // reserva: «+» compra otra y DESPLEGAR abre el mapa
    eD.innerHTML = res + mineW().map((s, i) => unit('W', `Buque ${i + 1}`, 'Desplegado')).join('') + myS.map((s, i) => unit('S', `Satélite ${i + 1}`, s.on ? 'Activo' : 'Inactivo: su zona no es tuya')).join('') + mineF().map((f, i) => unit('F', `Cazas ${i + 1}`, `${f.hp.filter(h => h > 0).length}/${F.n} en patrulla`)).join('')
      + (!res && !mineW().length && !myS.length && !mineF().length ? '<div class="empty">Nada desplegado: compra una unidad y pulsa DESPLEGAR.</div>' : '')
      + `<div class="upc" style="display:block"><b class="ph" style="margin:0 0 4px">REAPARICIÓN</b>${spawnOpts().map(o => `<button class="up" data-wsp="${o.id}" style="margin:0 6px 4px 0;${o.id === curPref() ? 'border-color:#5dff8a;background:#123a2a' : ''}"><b>${o.n}</b></button>`).join('')}<div class="fnote">Zonas tuyas: <b style="color:#4db8ff">${myZ.length}</b> · ${Object.entries(inc).map(([k, n]) => `+${n} ${k}`).join(' · ') || 'sin ingresos'} cada ${C.gain.every} s</div></div>`;
    preview(fsel);
  }
  function buy(k) { // botón COMPRAR (hangar.js ya comprobó que estás en la base)
    if (full(k)) return say(`Máximo alcanzado (desplegados + en reserva)`);
    if (!canPay(COST[k])) return say('Faltan recursos');
    if (FOOT.spend(COST[k])) { stock[k]++; fsel = k; say(`${UN[k]} comprado: pulsa ${DEPL[k]} y elige una zona tuya`); refresh(); }
  }
  document.addEventListener('click', e => {
    const sp = e.target.closest && e.target.closest('[data-wsp]'), d = e.target.closest && e.target.closest('[data-wdep]'), fs = e.target.closest && e.target.closest('[data-fsel]');
    if (sp) { pref = sp.dataset.wsp === 'base' ? 'base' : +sp.dataset.wsp; refresh(); return; }
    if (fs && !e.target.closest('.buy')) { fsel = fs.dataset.fsel; refresh(); return; }
    if (!d || d.disabled || !atBase()) return; // fuera de la base: atenuado, sin mensaje
    if (!CZS.some(Z => Z.o === myId)) return say('Primero reclama una zona de control: permanece dentro de ella hasta el 100 %');
    ov.style.display = 'none'; MAP.place(d.dataset.wdep); // el mapa se abre en modo colocación
  });
  const sig = () => JSON.stringify([stock, pref, fsel, CZS.map(Z => Z.o), all().map(s => [s.id, s.o, s.on]), [...FQ.values()].map(f => [f.id, f.hp.map(h => h > 0)])]);
  const fOwner = id => { const f = FQ.get(id); return f ? f.o : null; };

  return { CZ, CZS, look, owner, check, deploy, czPos, frame, sync, onEvent, onOk, hit, targets, pos: posOf, hud, spawn, near, mine: mineW, menu, buy, sig, model, nmOf, all, nearestOwned, fOwner, fname: id => 'Cazas de ' + nmOf(fOwner(id)), models };
})();
