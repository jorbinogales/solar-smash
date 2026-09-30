// Zonas de control (estilo mapa galáctico de Helldivers), buques de guerra y satélites defensivos.
// El servidor es la autoridad (tick: cz, wb, sa · mensajes wdep / wh · evento wdead). Aquí: modelos 3D cacheados (piezas fusionadas con kit()), marcadores y aviso de captura en el HUD,
// disparos de sus torretas (cada cliente simula las ENEMIGAS contra sí mismo, como las torretas de las bases; el anfitrión, además, las propias contra neutrales hostiles a su dueño),
// impactos de mis proyectiles, reaparición en un buque y la sección BUQUES / SATÉLITES del menú BASE. Usa bodies, S, P, view, spawnProj... de game.js y MAP (colocación).
const WAR = (() => {
  const C = WARCFG, CZ = genControlZones(SYS), CZS = CZ.map(() => ({ o: 0, c: 0, p: 0 })), WS = new Map(), SA = new Map(), stock = { W: 0, S: 0 }; // stock: comprados y aún sin desplegar (los recursos ya se gastaron)
  let pref = 'base', synced = false; // pref: punto de reaparición elegido ('base' o id de uno de mis buques)
  const all = () => [...WS.values(), ...SA.values()], mineW = () => [...WS.values()].filter(s => s.o === myId), T = s => s.k === 'W' ? C.ws : C.sat;
  const nmOf = o => o === myId ? myName : ((BASE.LB.list.find(x => x.id === o) || {}).nm || (remotes.get(o) || {}).name || 'Piloto');
  const wpos = s => { const A = bodies[s.a].pos; return [A[0] + s.off[0], A[1] + s.off[1], A[2] + s.off[2]]; };
  const czPos = zi => { const z = CZ[zi], A = bodies[z.anchor].pos; return [A[0] + z.off[0], A[1] + z.off[1], A[2] + z.off[2]]; };
  const fwdOf = s => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(s.q); return [f.x, f.y, f.z]; };

  // ---------- estado de las zonas visto por mí: AZUL mía · ROJO enemiga o peligrosa · ÁMBAR reclamándose · GRIS neutral ----------
  function dangerOf(zi) { const z = CZ[zi]; return (z.planet && [...BASE.HG.values()].some(h => h.o !== myId && h.b === z.planet)) || [...WS.values()].some(s => s.o !== myId && s.zi === zi); }
  function look(zi) {
    const Z = CZS[zi], dg = dangerOf(zi);
    if (Z.c && Z.p > 0) return { col: '#ffb347', txt: `${Z.c === myId ? 'RECLAMANDO' : 'EN DISPUTA · ' + nmOf(Z.c).toUpperCase()} ${Z.p} %`, cap: true, p: Z.p };
    if (Z.o === myId) return { col: '#4db8ff', txt: dg ? 'TUYA · ENEMIGOS CERCA' : 'TUYA · SEGURA', p: 100 };
    if (Z.o) return { col: '#ff3b30', txt: 'ENEMIGA · ' + nmOf(Z.o).toUpperCase(), p: 100 };
    return dg ? { col: '#ff6a5a', txt: 'NEUTRAL · PELIGRO', p: 0 } : { col: '#dfe8ee', txt: 'NEUTRAL', p: 0 };
  }
  function check(k, zi, off) { // '' = se puede desplegar ahí (misma validación que el servidor: sysgen.czCheck)
    if (!stock[k]) return k === 'W' ? 'No tienes buques en reserva: cómpralos en la base' : 'No tienes satélites en reserva: cómpralos en la base';
    if (k === 'W' && mineW().length >= C.ws.max) return `Máximo ${C.ws.max} buques desplegados`;
    if (k === 'S' && [...SA.values()].filter(s => s.o === myId && s.zi === zi).length >= C.sat.maxZone) return `Máximo ${C.sat.maxZone} satélites por zona`;
    return czCheck(SYS, CZ, zi, off, myId, CZS[zi] ? CZS[zi].o : 0, [...BASE.HG.values()], [...WS.values()], simT);
  }

  // ---------- modelos (km; proa hacia -z). Se construyen UNA vez y todas las instancias comparten geometría y materiales ----------
  const std = (c, e = 0.12, m = 0.45, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: c, emissiveIntensity: e });
  const hullM = std(0x7d8792), darkM = std(0x2f353d, 0.1), whiteM = std(0xe8edf2, 0.15, 0.1, 0.5), panelM = std(0x1d4a8a, 0.35, 0.6, 0.35), winM = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
  const GL = {}, GA = new THREE.MeshBasicMaterial({ color: 0x4db8ff }), GE = new THREE.MeshBasicMaterial({ color: 0xff4030 }); // GL: pieza luminosa (azul si es mía, roja si es enemiga)
  const Bx = (w, h, d) => new THREE.BoxGeometry(w, h, d), Cy = (r0, r1, h, s = 12) => new THREE.CylinderGeometry(r0, r1, h, s);
  let PW = null, PS = null;
  function partsW() { // buque de guerra (~3,4 km): casco angular con proa en cuña, cubierta de vuelo, puente, costados con hangar iluminado, 6 torretas y 3 motores
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
  const model = k => mesh(k === 'W' ? partsW() : partsS(), false); // vista previa (recuadro del objetivo)
  function build(s) { const d = nrm([-s.off[0], 0, -s.off[2]]); s.q = lookQ(d[0] || d[2] ? d : [0, 0, -1]); s.g = mesh(s.k === 'W' ? partsW() : partsS(), s.o === myId); s.g.visible = false; scene.add(s.g); } // orientación fija: proa hacia su cuerpo ancla (igual en todos los clientes)
  const dropS = s => { if (s.g) scene.remove(s.g); };

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
  function sync(m) {
    if (Array.isArray(m.cz) && m.cz.length === CZ.length) m.cz.forEach((r, i) => {
      const Z = CZS[i], [o, c, p] = r;
      if (synced && Z.o !== o) { if (o === myId) say(`¡Zona ${CZ[i].name} reclamada! Ya puedes desplegar buques y satélites en ella`); else if (Z.o === myId) say(`Has perdido la zona ${CZ[i].name}`); }
      Z.o = o; Z.c = c; Z.p = p;
    });
    if (Array.isArray(m.wb)) upd(WS, m.wb, 'W'); if (Array.isArray(m.sa)) upd(SA, m.sa, 'S'); synced = BASE.started() && !BASE.loading();
  }
  function onEvent(e) { // 'wdead': buque o satélite destruido (lo decide el servidor)
    const M = e.k === 'W' ? WS : SA, s = M.get(e.i);
    if (s) { const w = s.w || wpos(s); boom(w, e.k === 'W' ? 150 : 50); if (e.k === 'W') boom([w[0], w[1] + 0.6, w[2]], 60); dropS(s); M.delete(e.i); }
    if (pref === e.i) pref = 'base';
    if (e.o === myId) say(e.k === 'W' ? '¡Tu buque de guerra ha sido destruido!' : '¡Uno de tus satélites defensivos ha sido destruido!');
    else if (e.by === myId) { say(e.k === 'W' ? '¡BUQUE DE GUERRA ENEMIGO DESTRUIDO!' : '¡SATÉLITE ENEMIGO DESTRUIDO!'); gainXp(e.k === 'W' ? 40 : 15, e.k === 'W' ? 'Buque de guerra destruido' : 'Satélite destruido'); }
  }
  function onOk(m) { if (m.wok) { stock[m.k] = Math.max(0, stock[m.k] - 1); say(m.k === 'W' ? 'Buque de guerra desplegado' : 'Satélite defensivo construido'); } else say(m.why || 'No se pudo desplegar ahí'); }

  // ---------- por cuadro: posición (origen flotante) y torretas ----------
  function blocked(a, b) { // ¿un astro entre a y b?
    const d = sub(b, a), L = len(d); if (L < 1e-6) return false; const u = d.map(c => c / L);
    for (const bd of bodies) { const oc = sub(a, bd.pos), R = bd.R * 0.999, Bq = oc[0] * u[0] + oc[1] * u[1] + oc[2] * u[2], Cq = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - R * R; if (Cq <= 0) continue; const disc = Bq * Bq - Cq; if (disc <= 0) continue; const te = -Bq - Math.sqrt(disc); if (te > 0 && te < L) return true; }
    return false;
  }
  function fire(s, t, tg) { // buque: plasma con puntería adelantada (precisión moderada) · satélite: misil guiado de largo alcance
    const homing = s.k === 'S', c = [s.w[0], s.w[1] + (homing ? 0 : 0.5), s.w[2]], d0 = nrm(sub(tg.pos, c)), mp = c.map((x, i) => x + d0[i] * (homing ? 0.5 : 0.3));
    let ap = tg.pos; if (!homing) { const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(tg.q); for (let k = 0; k < 2; k++) { const tt = len(sub(ap, mp)) / t.spd; ap = tg.pos.map((x, i) => x + fw.getComponent(i) * tg.v * tt); } }
    const l = len(sub(ap, mp)); if (l < 0.01) return; const dir = sub(ap, mp).map(x => x / l), kind = homing ? 'm' : 'p', tgt = homing ? { k: tg.id >= 3000 ? 'n' : 'p', id: tg.id } : null, key = `${myId ?? 0}:x${++seq}`, sn = (s.k === 'W' ? 'Buque de ' : 'Satélite de ') + nmOf(s.o);
    spawnProj(-s.o, key, kind, mp, dir, tgt, t.dmg, { spd: t.spd, col: homing ? 0x9fe8ff : 0xff8a3c, life: Math.min(60, l / t.spd * 1.5 + 3) }); const q = projs.get(key); if (q) q.sn = sn; // sn: nombre para el aviso de ataque
    send({ t: 'fire', key, kind, pos: mp, dir, tgt, dmg: t.dmg, tw: 1, spd: t.spd, rb: S.refB, rp: S.refB >= 0 ? sub(mp, bodies[S.refB].pos) : null });
    sfx(kind, l); s.cd = t.cd * (0.8 + 0.4 * Math.random());
    if (tg.id === myId) attackAlert('s', sn, s.w);
  }
  function frame(dt) {
    for (const s of all()) {
      s.w = wpos(s); const v = view(s.w); s.d = v.d; s.g.visible = v.d < 300000;
      if (s.g.visible) { s.g.position.set(v.x, v.y, v.z); s.g.scale.setScalar(v.s); s.g.quaternion.copy(s.q); }
    }
    if (!BASE.started() || BASE.loading() || BASE.LB.phase !== 'playing') return;
    const alive = P.hp > 0 && !S.warp.on && !S.foot.on, host = BASE.isHost() && typeof NEU !== 'undefined';
    for (const s of all()) {
      if (s.k === 'S' && !s.on) continue; const t = T(s); s.cd = (s.cd ?? Math.random() * t.cd) - dt; if (s.cd > 0) continue;
      let tg = null;
      if (s.o !== myId && alive && s.d < t.range) tg = { pos: S.pos, v: S.ve || 0, q: S.q, id: myId };
      else if (host) tg = NEU.hostileNear(s.w, t.range, s.o);
      if (!tg || blocked(s.w, tg.pos)) { s.cd = 0.5; continue; }
      fire(s, t, tg);
    }
  }
  function hit(old, pos, p) { // mi proyectil contra un buque o satélite ajeno: el daño lo decide el servidor ('wh'); aquí solo se descuenta para verlo al momento
    for (const s of all()) {
      if (s.o === myId || !s.w || segDist(old, pos, s.w) > 2.5) continue;
      let ok = s.k === 'S' && segDist(old, pos, s.w) < 0.3;
      if (s.k === 'W') { const f = fwdOf(s); for (const z of [1.35, 0.45, -0.45, -1.25]) if (segDist(old, pos, s.w.map((c, i) => c + f[i] * z)) < 0.5) ok = true; } // 4 esferas a lo largo del casco
      if (!ok) continue;
      send({ t: 'wh', k: s.k, i: s.id, dmg: p.dmg }); const a = Math.min(s.sh || 0, p.dmg); if (s.k === 'W') s.sh -= a; s.hp -= p.dmg - a; boom(pos, p.kind === 'm' ? 0.08 : 0.02); P.lastCombat = performance.now(); return true;
    }
    return false;
  }
  function targets() { // objetivos fijables (radar): buques y satélites ajenos a menos de 60 000 km
    const out = []; if (P.hp <= 0) return out;
    for (const s of all()) {
      if (s.o === myId || !s.w || s.d > 60000) continue; const v = view(s.w);
      out.push({ kind: s.k, id: s.id, name: (s.k === 'W' ? 'Buque de ' : 'Satélite de ') + nmOf(s.o), hp: s.hp / T(s).hp * 100, sh: s.k === 'W' ? s.sh / C.ws.sh * 100 : 0, grp: { position: new THREE.Vector3(v.x, v.y, v.z) }, dist: v.d, dir: [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d] });
    }
    return out;
  }

  // ---------- HUD: rombos de buques y satélites, cartel de la zona de control en la que estás y selector de reaparición ----------
  const hexP = (x, y, r) => { g2.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; if (k) g2.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g2.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g2.closePath(); };
  function banner(zi, W, now) { // estilo «pegatina»: borde grueso #050f1c y sombra sólida
    const z = CZ[zi], Z = CZS[zi], L = look(zi), x = W / 2 - 200, y = 200, p = Z.c ? Z.p / 100 : Z.o ? 1 : 0;
    g2.fillStyle = '#050f1c'; g2.beginPath(); g2.roundRect(x + 4, y + 4, 400, 58, 9); g2.fill(); g2.fillStyle = '#0b2233ee'; g2.beginPath(); g2.roundRect(x, y, 400, 58, 9); g2.fill(); g2.lineWidth = 3; g2.strokeStyle = '#050f1c'; g2.stroke();
    hexP(x + 30, y + 29, 19); g2.fillStyle = L.col; g2.fill(); g2.stroke(); if (Z.c) { hexP(x + 30, y + 29, 19 + 4 * Math.abs(Math.sin(now / 300))); g2.strokeStyle = L.col; g2.lineWidth = 2; g2.stroke(); }
    g2.textAlign = 'left'; g2.font = `bold 11px ${MONO}`; g2.fillStyle = '#9fd4ee'; g2.fillText(`ZONA DE CONTROL · ${z.name.toUpperCase()}`, x + 58, y + 18);
    g2.font = `bold 13px ${MONO}`; g2.fillStyle = L.col; g2.fillText(Z.c === myId ? `RECLAMANDO… ${Z.p} % · permanece dentro` : Z.o === myId && !Z.c ? 'RECLAMADA · despliega buques y satélites' : L.txt, x + 58, y + 35);
    g2.fillStyle = '#050f1c'; g2.fillRect(x + 58, y + 42, 328, 9); g2.fillStyle = L.col; g2.fillRect(x + 59, y + 43, 326 * p, 7); g2.textAlign = 'center';
  }
  function spawnOpts() { const o = []; if (BASE.mine()) o.push({ id: 'base', n: 'BASE' }); mineW().forEach((s, i) => o.push({ id: s.id, n: `BUQUE ${i + 1} · ${CZ[s.zi].name}` })); return o; }
  const curPref = () => { const o = spawnOpts(); return o.some(x => x.id === pref) ? pref : o[0] ? o[0].id : 'base'; };
  function hud(now) {
    if (!BASE.started() || BASE.loading()) return;
    const W = hc.width, H = hc.height; g2.save(); g2.textAlign = 'center';
    if (P.hp > 0 && !S.foot.on) {
      for (const s of all()) {
        if (!s.w) continue; const mine = s.o === myId, dl = s.d; if (s.k === 'S' && dl > (mine ? 400000 : C.sat.radar)) continue; // los satélites enemigos se ven en el radar hasta 1,5 M km
        const dd = sub(s.w, S.pos); if (dl < 0.3 || losBlocked({ kind: 'W', dir: dd.map(c => c / dl), dist: dl })) continue;
        const v = view(s.w); tv.set(v.x, v.y, v.z).project(camera); if (tv.z >= 1 || Math.abs(tv.x) > 0.97 || Math.abs(tv.y) > 0.95) continue;
        const x = (tv.x * 0.5 + 0.5) * W, y = (-tv.y * 0.5 + 0.5) * H - (dl < 40 ? 70 : 0), col = mine ? '#4db8ff' : '#ff3b30', r = s.k === 'W' ? 13 : 10, t = T(s), f = Math.max(0, Math.min(1, s.hp / t.hp));
        g2.beginPath(); g2.moveTo(x, y - r); g2.lineTo(x + r, y); g2.lineTo(x, y + r); g2.lineTo(x - r, y); g2.closePath(); g2.fillStyle = col; g2.fill(); g2.lineWidth = 3; g2.strokeStyle = '#050f1c'; g2.stroke();
        g2.fillStyle = '#050f1c'; g2.font = `900 ${r}px ${MONO}`; g2.fillText(s.k === 'W' ? 'B' : 'S', x, y + r * 0.35);
        const tx = `${s.k === 'W' ? 'BUQUE' : 'SATÉLITE'} · ${mine ? 'TUYO' : nmOf(s.o).toUpperCase()}${s.k === 'S' && !s.on ? ' · INACTIVO' : ''}`; g2.font = `bold 10px ${MONO}`; g2.lineWidth = 3; g2.strokeStyle = '#000'; g2.fillStyle = mine ? '#9fd8ff' : '#ff8a7a'; g2.strokeText(tx, x, y + r + 13); g2.fillText(tx, x, y + r + 13);
        g2.fillStyle = '#050f1c'; g2.fillRect(x - 27, y + r + 17, 54, 7); g2.fillStyle = f > 0.35 ? '#5dff8a' : '#ff5a4a'; g2.fillRect(x - 26, y + r + 18, 52 * f, 5);
        g2.font = `10px ${MONO}`; g2.fillStyle = '#dff4ff'; g2.strokeText(fD(dl), x, y + r + 36); g2.fillText(fD(dl), x, y + r + 36);
      }
      const zi = czAt(SYS, CZ, S.pos, simT); if (zi >= 0) banner(zi, W, now);
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
    const w = wpos(s), f = fwdOf(s), p = [w[0] + f[0] * 0.8, w[1] + 0.5, w[2] + f[2] * 0.8];
    S.pos = p.slice(); S.shipPos = p.slice(); S.v = 0; S.foot.on = false; S.park.on = false; S.auto = false; S.gearK = 0; S.q.copy(s.q); camQ.copy(S.q); S.w.p = S.w.y = S.w.r = 0;
    say('Despegas desde la cubierta de tu buque de guerra'); return true;
  }
  const near = () => { const p = S.foot.on ? S.shipPos : S.pos; return mineW().some(s => s.w && len(sub(s.w, p)) < C.ws.near); }; // junto a mi buque cuenta como «en base»

  // ---------- menú BASE: secciones BUQUES y SATÉLITES (doble clic = comprar; DESPLEGAR / CONSTRUIR abre el mapa en modo colocación) ----------
  const SVG_W = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M3 38 12 31h28l4-9h8l2 9h7l-2 12H10z" fill="#8a96a3" stroke="#050f1c" stroke-width="3" stroke-linejoin="round"/><rect x="45" y="13" width="6" height="9" fill="#4db8ff" stroke="#050f1c" stroke-width="2.5"/><path d="M15 37h40" stroke="#4db8ff" stroke-width="3"/><circle cx="21" cy="30" r="2.6" fill="#050f1c"/><circle cx="31" cy="30" r="2.6" fill="#050f1c"/><path d="M59 34h3" stroke="#ffb347" stroke-width="3"/></svg>';
  const SVG_S = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="26" width="18" height="12" fill="#1d4a8a" stroke="#050f1c" stroke-width="3"/><rect x="43" y="26" width="18" height="12" fill="#1d4a8a" stroke="#050f1c" stroke-width="3"/><path d="M21 32h6M37 32h6" stroke="#050f1c" stroke-width="3"/><rect x="26" y="23" width="12" height="17" rx="2" fill="#8a96a3" stroke="#050f1c" stroke-width="3"/><path d="M23 19q9-11 18 0z" fill="#e8edf2" stroke="#050f1c" stroke-width="2.5"/><path d="M32 40v16" stroke="#050f1c" stroke-width="5"/><path d="M32 41v14" stroke="#9fe8ff" stroke-width="2"/></svg>';
  const row = (n, f, g) => `<div style="display:grid;grid-template-columns:1fr 90px;gap:6px;align-items:center;font-size:11px;margin:3px 0;color:#cfe9f7"><span>${n}</span><div><div class="bar"><i style="width:${Math.max(0, Math.min(100, f * 100))}%;background:#5dff8a"></i></div>${g === undefined ? '' : `<div class="bar" style="margin-top:2px"><i style="width:${Math.max(0, Math.min(100, g * 100))}%;background:#4db8ff"></i></div>`}</div></div>`;
  function menu() {
    const eW = document.getElementById('warShips'), eS = document.getElementById('warSats'), eP = document.getElementById('warSpawn'); if (!eW) return;
    const myS = [...SA.values()].filter(s => s.o === myId), nZ = CZS.filter(Z => Z.o === myId).length;
    const card = (svg, title, small, k) => `<div class="upc"><i class="uico">${svg}</i><div><b>${title}</b><small>${small}</small><div class="ctl">${buyBtn(`data-war="${k}"`, k === 'W' ? C.ws.cost : C.sat.cost)}</div></div></div>`;
    const dep = (k, label, extra) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0 6px;font-size:11px;color:#9fd4ee"><button class="up" data-wdep="${k}"${stock[k] ? '' : ' disabled'}><b>${label}</b></button><span>En reserva: <b style="color:#fff">${stock[k]}</b> · ${extra}</span></div>`;
    eW.innerHTML = card(SVG_W, 'Buque de guerra', `Nave capital de ~3 km: ${C.ws.hp} de casco + ${C.ws.sh} de escudo, 6 torretas (${C.ws.range} km). Reapareces en su cubierta y junto a él (< ${C.ws.near} km) puedes comprar como en la base. Máx. ${C.ws.max}.`, 'W')
      + dep('W', 'DESPLEGAR', `desplegados ${mineW().length}/${C.ws.max}`) + mineW().map((s, i) => row(`Buque ${i + 1} · ${CZ[s.zi].name}`, s.hp / C.ws.hp, s.sh / C.ws.sh)).join('');
    eS.innerHTML = card(SVG_S, 'Satélite defensivo', `Base flotante estática de ~0,9 km: ${C.sat.hp} de vida, misiles guiados a ${C.sat.range} km. Solo en tus zonas reclamadas (máx. ${C.sat.maxZone} por zona); si pierdes la zona, se desactiva.`, 'S')
      + dep('S', 'CONSTRUIR', `construidos ${myS.length} · zonas tuyas ${nZ}`) + myS.map(s => row(`Satélite · ${CZ[s.zi].name}${s.on ? '' : ' (inactivo)'}`, s.hp / C.sat.hp)).join('');
    const cur = curPref(); eP.innerHTML = spawnOpts().map(o => `<button class="up" data-wsp="${o.id}" style="margin:0 6px 6px 0;${o.id === cur ? 'border-color:#5dff8a;background:#123a2a' : ''}"><b>${o.n}</b></button>`).join('') || '<div class="empty">Sin base ni buques</div>';
  }
  function buy(k) { // doble clic en la tarjeta (hangar.js ya comprobó que estás en la base)
    const cost = k === 'W' ? C.ws.cost : C.sat.cost;
    if (k === 'W' && mineW().length + stock.W >= C.ws.max) return say(`Máximo ${C.ws.max} buques (desplegados + en reserva)`);
    if (!canPay(cost)) return say('Faltan recursos');
    if (FOOT.spend(cost)) { stock[k]++; say(k === 'W' ? 'Buque de guerra comprado: pulsa DESPLEGAR y elige una zona tuya' : 'Satélite comprado: pulsa CONSTRUIR y elige una zona tuya'); refresh(); }
  }
  document.addEventListener('click', e => {
    const sp = e.target.closest && e.target.closest('[data-wsp]'), d = e.target.closest && e.target.closest('[data-wdep]');
    if (sp) { pref = sp.dataset.wsp === 'base' ? 'base' : +sp.dataset.wsp; refresh(); return; }
    if (!d || d.disabled) return;
    if (!CZS.some(Z => Z.o === myId)) return say('Primero reclama una zona de control: permanece dentro de ella hasta el 100 %');
    ov.style.display = 'none'; MAP.place(d.dataset.wdep); // el mapa se abre en modo colocación
  });
  const sig = () => JSON.stringify([stock, pref, CZS.map(Z => Z.o), all().map(s => [s.id, s.o, s.hp, s.sh, s.on])]);

  return { CZ, CZS, look, check, czPos, frame, sync, onEvent, onOk, hit, targets, pos: (k, id) => { const s = (k === 'W' ? WS : SA).get(id); return s && s.w ? s.w : null; }, hud, spawn, near, mine: mineW, menu, buy, sig, model, nmOf, all };
})();
