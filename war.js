// Zonas de control (estilo mapa galáctico de Helldivers: teselan TODO el sistema en sectores anulares fijos respecto a la estrella), buques de guerra, satélites defensivos y escuadrones de CAZAS.
// El servidor es la autoridad (tick: cz, wb, sa, fq, fl · mensajes wdep / wh / fs · evento wdead). Aquí: modelos 3D cacheados (piezas fusionadas con kit()), marcadores y aviso de captura en el HUD,
// disparos de sus torretas (cada cliente simula las ENEMIGAS contra sí mismo, como las torretas de las bases; el anfitrión, además, las de TODAS contra bots y naves neutrales), la simulación de los
// cazas (en el anfitrión, como neutral.js/bot.js), impactos, reaparición en un buque y la pestaña FLOTA del menú. Usa bodies, S, P, view, spawnProj... de game.js y MAP (colocación).
// Modelos definitivos (L.E.O.A.R.T, models.js): WAR.models.W / .S / .F = función (mine) => THREE.Object3D (en km, proa hacia -z).
const WAR = (() => {
  const C = WARCFG, CZ = genControlZones(SYS), CZS = CZ.map(() => ({ o: 0, c: 0, p: 0 })), WS = new Map(), SA = new Map(), FQ = new Map(), stock = { W: 0, S: 0, F: 0 }; // FQ: escuadrones de cazas · stock: comprados sin desplegar (los recursos ya se gastaron)
  let pref = 'base', synced = false, fsel = 'W', fsT = 0; // pref: punto de reaparición · fsel: unidad elegida en FLOTA · fsT: último envío del estado de los cazas (anfitrión)
  const RESN = ['agua', 'piedra', 'cobre', 'plata', 'oro', 'diamante'], SCW = C.ws.scale || 1, F = C.ftr, FSC = F.scale || 1, models = MODELS; // SCW: escala del buque (×4 ≈ 14 km)
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
  function check(k, zi, off, anch) { // '' = se puede desplegar ahí (misma validación que el servidor: sysgen.czCheck)
    if (!stock[k]) return `No tienes ${UN[k].toLowerCase()} en reserva: cómpralo en la base`;
    if (k === 'W' && mineW().length >= C.ws.max) return `Máximo ${C.ws.max} buques desplegados`;
    if (k === 'F' && mineF().length >= F.max) return `Máximo ${F.max} escuadrones de cazas`;
    if (k === 'S' && [...SA.values()].filter(s => s.o === myId && s.zi === zi).length >= C.sat.maxZone) return `Máximo ${C.sat.maxZone} satélites por zona`;
    return czCheck(SYS, CZ, zi, off, myId, CZS[zi] ? CZS[zi].o : 0, [...BASE.HG.values()], [...WS.values()], simT, anch, k);
  }

  // ---------- modelos (km; proa hacia -z): los construye models.js (MODELS) una vez y todas las instancias comparten geometría y materiales del bando (mine = aliado, si no enemigo) ----------
  let HALO = null;
  const unitModel = (k, mine) => models[k](mine);
  const model = (k, mine = false) => { if (k !== 'F') return unitModel(k, mine); const g = new THREE.Group(); [[0, 0, -0.04], [-0.045, 0, 0.02], [0.045, 0, 0.02]].forEach(p => { const m = unitModel('F', mine); m.position.set(...p); g.add(m); }); return g; }; // vista previa (recuadro del objetivo y FLOTA): el caza, en formación de 3
  const haloTex = () => HALO || (HALO = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })());
  function build(s) { const d = nrm([-s.off[0], 0, -s.off[2]]); // los buques y satélites se anclan a la estrella (a = 0, off absoluto); orientación fija: proa hacia la estrella (igual en todos los clientes)
    s.q = lookQ(d[0] || d[2] ? d : [0, 0, -1]); s.g = unitModel(s.k, s.o === myId); s.g.visible = false; scene.add(s.g);
    if (s.k === 'W') { s.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: s.o === myId ? 0x4db8ff : 0xff4030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false })); s.halo.scale.set(0.045, 0.045, 1); s.halo.visible = false; scene.add(s.halo); } } // halo: se ve desde cientos de miles de km
  const dropS = s => { if (s.g) scene.remove(s.g); if (s.halo) { scene.remove(s.halo); s.halo.material.dispose(); } };
  const dropF = f => { for (const c of f.c) { if (c.g) scene.remove(c.g); if (c.halo) { scene.remove(c.halo); c.halo.material.dispose(); } } };

  // ---------- red ----------
  function upd(M, rows, k) { // filas del tick: [id, dueño, zona, cuerpo ancla, x, y, z, vida, escudo (buque) | activo (satélite)]
    const seen = new Set();
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== 9 || !bodies[r[3]]) continue; const [id, o, zi, a, x, y, z, hp, e] = r; seen.add(id); let s = M.get(id);
      if (!s || s.o !== o) { if (s) dropS(s); s = { id, o, zi, a, off: [x, y, z], k }; M.set(id, s); build(s); }
      if (s.w && s.hp !== undefined && hp < s.hp) puff(s.w, (k === 'W' ? 0.4 : 0.1) * (k === 'W' ? SCW : 1), 0xffb050, 0.5, 0.02); // impacto visible a distancia
      s.hp = hp; if (k === 'W') s.sh = e; else s.on = e;
    }
    for (const [id, s] of [...M]) if (!seen.has(id)) { dropS(s); M.delete(id); if (pref === id) pref = 'base'; }
  }
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], fcen = f => add3(bodies[f.a || 0].pos, f.off); // centro de patrulla (anclado a su cuerpo: sigue al planeta)
  function updF(rows) { // escuadrones: [id, dueño, zona, cuerpo ancla, x, y, z, vida caza 1, 2, 3]
    const seen = new Set();
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== 7 + F.n || !r.every(Number.isFinite) || !bodies[r[3]]) continue; const [id, o, zi, a, x, y, z] = r, hp = r.slice(7); seen.add(id); let f = FQ.get(id);
      if (!f || f.o !== o) { if (f) dropF(f); f = { id, o, zi, a, off: [x, y, z], hp: hp.slice(), c: [] }; const c0 = add3(bodies[a].pos, [x, y, z]); for (let j = 0; j < F.n; j++) f.c.push({ pos: [c0[0] + (j - 1) * 6, c0[1] + 3 * (j % 2), c0[2] + 5], q: new THREE.Quaternion(), v: 0, cd: Math.random(), t0: 0, g: null, wp: null }); FQ.set(id, f); }
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
    if (Array.isArray(m.ar)) { const nowp = performance.now(), live = new Map(m.ar.filter(r => Array.isArray(r) && r.length === 2)); // LLEGADA: mientras el servidor la lista, la unidad está en viaje de luz (invisible, sin daño, no dispara)
      for (const u of [...all(), ...FQ.values()]) { const ms = live.get(u.id); if (ms > 0) { u.arr = true; u.arT = nowp + ms; } else if (u.arr) { u.arr = false; arrived(u, nowp); } } }
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
  function arrived(u, now) { // sale del viaje de luz: destello, estela que se contrae (el modelo se escala desde una línea larga) y estampido
    u.fxT = now; const w = u.c ? fcen(u) : wpos(u), big = u.k === 'W' ? SCW : 1, d = len(sub(w, S.pos));
    puff(w, 2.5 * big, 0x9fe8ff, 0.7, 0.02); puff(w, 1.2 * big, 0xffffff, 0.35, 0.012); sfx('warpSalida', w); // llegada: estampido en su posición (radio audible)
  }
  const stretch = (g, sc, u, now) => { const k = u.fxT ? Math.min(1, (now - u.fxT) / 800) : 1; if (k >= 1) { g.scale.setScalar(sc); return; } const e = 1 - k; g.scale.set(sc * (0.25 + 0.75 * k), sc * (0.25 + 0.75 * k), sc * (1 + 30 * e * e)); }; // llegada: de línea larga a modelo en 0,8 s
  function onAlarm(e) { // 'walarm': un buque detectó a un enemigo → sirena según la distancia y parpadeo de su icono
    const s = WS.get(e.i); if (!s || !s.w) return; s.blinkT = performance.now(); AUDIO.alarm(s.w, s.o !== myId);
  }
  function onOk(m) { if (m.wok) { stock[m.k] = Math.max(0, stock[m.k] - 1); say(`${UN[m.k] || 'Unidad'} desplegado`); } else say(m.why || 'No se pudo desplegar ahí'); }

  // ---------- por cuadro: posición (origen flotante), torretas y cazas ----------
  function blocked(a, b) { // ¿un astro entre a y b?
    const d = sub(b, a), L = len(d); if (L < 1e-6) return false; const u = d.map(c => c / L);
    for (const bd of bodies) { const oc = sub(a, bd.pos), R = bd.R * 0.999, Bq = oc[0] * u[0] + oc[1] * u[1] + oc[2] * u[2], Cq = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - R * R; if (Cq <= 0) continue; const disc = Bq * Bq - Cq; if (disc <= 0) continue; const te = -Bq - Math.sqrt(disc); if (te > 0 && te < L) return true; }
    return false;
  }
  // Bocas de los cañones en coordenadas del modelo (km, proa hacia -z; models.js). Las piezas están fusionadas por material, así que las torretas no giran: el disparo sale de la
  // boca real y el destello se estira en la dirección del tiro. Buque (× SCW): 6 torretas gemelas en x = ±0,39, z = −0,2 · 0,35 · 0,8; cañones a y = 0,128, separados ±0,02,
  // con la boca 0,26 por delante del centro de la torreta. Satélite (escala 1): boca del cañón de riel en (0, −0,01, −0,79). Caza (escala 1): vainas de las puntas de ala.
  const TZ = [-0.2, 0.35, 0.8], _v = new THREE.Vector3(), _qi = new THREE.Quaternion();
  const toWorld = (w, q, x, y, z) => { _v.set(x, y, z).applyQuaternion(q); return [w[0] + _v.x, w[1] + _v.y, w[2] + _v.z]; };
  function muzzle(s, tp, mode) { // buque: torretas del costado que mira al blanco, alternando sus dos cañones · LARGO ALCANCE: delantera y trasera (z −0,2 / 0,8) · MUNICIÓN: la central (z 0,35)
    if (s.k !== 'W') return toWorld(s.w, s.q, 0, -0.01, -0.79);
    _v.set(tp[0] - s.w[0], tp[1] - s.w[1], tp[2] - s.w[2]).applyQuaternion(_qi.copy(s.q).invert()); const sx = _v.x >= 0 ? 1 : -1, n = s.tn = (s.tn || 0) + 1, zi = mode === 'A' ? 1 : (n % 2 ? 2 : 0);
    return toWorld(s.w, s.q, (sx * 0.39 + (Math.floor(n / 2) % 2 ? 0.02 : -0.02)) * SCW, 0.128 * SCW, (TZ[zi] - 0.26) * SCW);
  }
  const flash = (p, d, r, col) => { puff(p, r, col, 0.22, 0.006); puff(p.map((c, i) => c + d[i] * r * 1.6), r * 0.55, 0xffffff, 0.14, 0.004); }; // destello en la boca, adelantado en la dirección del disparo
  function fire(s, t, tg, mode, mzp) { // mzp: boca concreta (torreta independiente del buque) // mode 'A': munición del buque (minigun) · si tg.hb: ataque a una base (tg.hb = su dueño) // buque: plasma rápido con puntería adelantada (precisión moderada) · satélite: misil guiado de largo alcance · ambos salen de la boca real del cañón
    const homing = s.k === 'S' || mode === 'M', mp = mzp || muzzle(s, tg.pos, mode);
    let ap = tg.pos; if (!homing) { const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(tg.q); for (let k = 0; k < 3; k++) { const tt = len(sub(ap, mp)) / t.spd; ap = tg.pos.map((x, i) => x + fw.getComponent(i) * tg.v * tt); } }
    const l = len(sub(ap, mp)); if (l < 0.01) return; const dir = sub(ap, mp).map(x => x / l), Wp = WEAPONS[t.w] || WEAPONS.plasma, kind = homing ? 'm' : Wp.kind, tgt = homing ? (tg.hb !== undefined ? { k: 'h', id: tg.hb } : tg.ws !== undefined ? { k: 'W', id: tg.ws } : tg.fk !== undefined ? { k: 'F', id: tg.fk } : { k: tg.id >= 3000 && tg.id < 4000 ? 'n' : 'p', id: tg.id }) : null, key = `${myId ?? 0}:x${++seq}`, sn = (s.k === 'W' ? 'Buque de ' : 'Satélite de ') + nmOf(s.o);
    spawnProj(-s.o, key, kind, mp, dir, tgt, t.dmg, { spd: t.spd, col: Wp.col, life: Math.min(60, l / t.spd * 1.5 + 3), hr: t.hr }); const q = projs.get(key); if (q) { q.sn = sn; q.col = Wp.col; if (tg.hb !== undefined) { q.hb = tg.hb; q.hw = s.id; } if (tg.ws !== undefined) q.wv = s.id; } // sn: nombre para el aviso de ataque · hb/hw: base atacada y estructura atacante ('hh' con ws)
    send({ t: 'fire', key, kind, pos: mp, dir, tgt, dmg: t.dmg, tw: 1, spd: t.spd, rb: S.refB, rp: S.refB >= 0 ? sub(mp, bodies[S.refB].pos) : null });
    flash(mp, dir, homing ? 0.05 : 0.04 * SCW, Wp.col);
    sfx(mode === 'A' || mode === 'M' ? Wp.snd : s.k === 'W' ? 'buqueDisparo' : 'satDisparo', mp); s.cd = t.cd * (0.8 + 0.4 * Math.random());
    if (tg.id === myId) attackAlert('s', sn, s.w);
  }
  // ---------- BUQUE: dos armas y prioridad de blanco (naves enemigas > torretas de base > hangar) ----------
  function wsSel(d, lrOn, ground) { // → { lr, am, mi, lrOn }: el buque solo tiene MISIL guiado (largo alcance) y METRALLETA; umbral único 300 km (closeKm, histéresis 5 %)
    const W = C.ws, far = d > W.closeKm * (lrOn ? 0.95 : 1); // > 300 km misil (hasta missileRange) contra todo · ≤ 300 metralleta; sobre tierra/atmósfera solo desde ammoMinKm (100 km)
    return { lr: false, mi: far && d <= W.missileRange, am: !far && d <= W.ammoRange && (!ground || d >= W.ammoMinKm), lrOn: far };
  }
  function basePick(sw, range, owner, bases) { // base enemiga al alcance que simulo yo → blanco: torreta viva más cercana; sin torretas, el hangar
    let best = null;
    for (const h of bases) { if (h.o === owner || !h.info || h.hp <= 0) continue; const hw = BASE.worldOf(h), dh = len(sub(hw, sw)); if (dh > range) continue;
      let tp = null, ti = -1, td = Infinity; (h.tw || []).forEach((v, i) => { if (!(v > 0)) return; const p = BASE.towerPos ? BASE.towerPos(h, i) : null; if (p) { const d = len(sub(p, sw)); if (d < td) { td = d; tp = p; ti = i; } } });
      const c = tp ? { pos: tp, d: td, tw: ti } : { pos: BASE.targetPos(h.o) || hw, d: dh, tw: -1 }; if (!best || c.d < best.d) best = { ...c, v: 0, q: new THREE.Quaternion(), id: -1, hb: h.o }; }
    return best;
  }
  function enemyWS(s, range) { // buque enemigo (otro dueño) más cercano al alcance y visible; con histéresis: mantiene el anterior si no hay otro un 20 % más cerca
    let best = null, keep = null;
    for (const o of WS.values()) { if (o.o === s.o || o.arr || !o.w) continue; const d = len(sub(o.w, s.w)); if (d > range || blocked(s.w, o.w)) continue; const c = { pos: o.w, v: 0, q: o.q, id: -1, d, ws: o.id }; if (!best || d < best.d) best = c; if (o.id === s.wtg) keep = c; }
    const r = keep && best && keep.d <= best.d * 1.2 ? keep : best; s.wtg = r ? r.ws : null; return r;
  }
  // ---------- 6 TORRETAS INDEPENDIENTES: por costado delantera (misiles), central (metralleta) y trasera (misiles); 360° salvo un cono ciego bajo el casco; blanco, cooldown y boca propios ----------
  const WT = [0, 1, 2, 3, 4, 5].map(i => ({ sx: i < 3 ? -1 : 1, zi: i % 3, w: i % 3 === 1 ? 'A' : 'M' }));
  const tKey = c => c.ws !== undefined ? 'W' + c.ws : c.fk !== undefined ? 'F' + c.fk : c.hb !== undefined ? 'h' + c.hb + '_' + c.tw : 'p' + c.id;
  function wsCands(s, alive, host) { // blancos posibles del buque (se evalúan cada 0,3 s): prioridad 1 buque enemigo · 2 naves y cazas · 3 torretas de base · 4 hangar · 5 neutrales; aliados nunca
    const out = [], R = C.ws.missileRange, add = (c, tier) => { if (c.d <= R) out.push({ ...c, tier }); };
    if (host) for (const o of WS.values()) if (o.o !== s.o && !o.arr && o.w) add({ pos: o.w, v: 0, q: o.q, id: -1, d: len(sub(o.w, s.w)), ws: o.id }, 1); // buque contra buque: lo simula el anfitrión
    if (s.o !== myId && alive) add({ pos: S.pos, v: S.ve || 0, q: S.q, id: myId, d: s.d }, 2); // yo (cada cliente se simula a sí mismo)
    if (host) { for (const fq of FQ.values()) if (fq.o !== s.o && !fq.arr) fq.c.forEach((c, j) => { const cw = c.w || c.pos; if (fq.hp[j] > 0 && cw) add({ pos: cw, v: c.v || 0, q: c.q, id: -1, d: len(sub(cw, s.w)), fk: fq.id * 10 + j }, 2); });
      if (s.o < 1000 && typeof BOT !== 'undefined') for (const [bi, B] of BOT.bots) if (!B.dead && !B.w) add({ pos: B.pos, v: B.v, q: B.q, id: 2000 + bi, d: len(sub(B.pos, s.w)) }, 2); }
    const mine = BASE.mine(), bases = [...(mine && mine.o !== s.o ? [mine] : []), ...(host ? [...BASE.HG.values()].filter(h => h.o >= 1000 && h.o !== s.o) : [])]; // bases que simulo: la mía y, en el anfitrión, las de los bots
    for (const h of bases) { if (!h.info || h.hp <= 0) continue; const hw = BASE.worldOf(h); (h.tw || []).forEach((v, i) => { const p = v > 0 && BASE.towerPos ? BASE.towerPos(h, i) : null; if (p) add({ pos: p, v: 0, q: s.q, id: -1, d: len(sub(p, s.w)), hb: h.o, tw: i }, 3); }); add({ pos: BASE.targetPos(h.o) || hw, v: 0, q: s.q, id: -1, d: len(sub(hw, s.w)), hb: h.o, tw: -1 }, 4); }
    if (host && s.o < 1000 && typeof NEU !== 'undefined') for (const n of NEU.E.values()) if (n.w) add({ pos: n.w, v: n.v, q: n.q, id: n.id, d: len(sub(n.w, s.w)) }, 5);
    return out.filter(c => !blocked(s.w, c.pos)).sort((a, b) => a.tier - b.tier || a.d - b.d);
  }
  function wsTarget(s, t, alive, host) { return wsCands(s, alive, host)[0] || null; } // blanco principal (prioridad y distancia)
  const turretC = (s, T) => toWorld(s.w, s.q, T.sx * 0.39 * SCW, 0.128 * SCW, TZ[T.zi] * SCW); // centro de la cabeza de la torreta (mundo)
  function assign(s, T, L, ord) { // blanco de UNA torreta: los válidos para su arma (alcance según distancia y suelo) y fuera del cono ciego; la mejor prioridad; se reparten por orden de torreta (con histéresis)
    const c0 = turretC(s, T), qi = _qi.copy(s.q).invert(), ok = c => { const d = len(sub(c.pos, c0)), ground = c.hb !== undefined || (typeof airK === 'function' && airK(c.pos) > 0.02) || (c.id === myId && S.park.on), sel = wsSel(d, T.lrOn, ground); _v.set(...sub(c.pos, c0)).applyQuaternion(qi); return (T.w === 'M' ? sel.mi : sel.am) && _v.y / (d || 1) > -0.9; }; // cono ciego: casi en vertical bajo el casco
    const V = L.filter(ok); if (!V.length) { T.tg = null; return; } const tb = V[0].tier, B = V.filter(c => c.tier === tb);
    T.tg = (T.tg && B.find(c => tKey(c) === tKey(T.tg))) || B[ord % B.length]; T.lrOn = len(sub(T.tg.pos, c0)) > C.ws.closeKm;
  }
  function wsTurrets(s, t, dt, alive, host, now) {
    const T6 = s.tur || (s.tur = WT.map((w, i) => ({ ...w, i, cd: Math.random() * 1.5, tg: null, b: 0 })));
    if (!(s.candT > now)) { s.candT = now + 300; const L = wsCands(s, alive, host), seen = L.length > 0; let kM = 0, kA = 0; for (const T of T6) assign(s, T, L, T.w === 'M' ? kM++ : kA++);
      if (seen) { if (!s.det && now - (s.alT || 0) > C.alarmCd * 1000) { s.alT = now; send({ t: 'walarm', i: s.id }); } s.det = now; } else if (s.det && now - s.det > 3000) s.det = 0; } // alarma al detectar un enemigo nuevo
    for (const T of T6) { T.cd -= dt; if (!T.tg || T.cd > 0) continue;
      const tg = T.tg.id === myId ? { ...T.tg, pos: S.pos, v: S.ve || 0, q: S.q } : T.tg, c0 = turretC(s, T), dir = nrm(sub(tg.pos, c0)); T.b ^= 1;
      const mz = c0.map((c, k) => c + dir[k] * 0.26 * SCW + (T.b ? 0.02 : -0.02) * SCW * (k === 0 ? 1 : 0)); // boca de SU cañón, orientada hacia su blanco (alternando los dos cañones)
      if (T.w === 'M') { const M = C.ws.missile; fire(s, { ...t, w: M.w, dmg: C.ws.dmgLong, spd: M.spd, hr: M.hr, cd: M.cd }, tg, 'M', mz); T.cd = M.cd * (0.8 + 0.4 * Math.random()); }
      else { const A = C.ws.ammo; fire(s, { ...t, w: A.w, dmg: C.ws.dmgAmmo, spd: A.spd, hr: A.hr, cd: A.cd }, { ...tg, pos: tg.pos.map(c => c + (Math.random() - 0.5) * A.spread * len(sub(tg.pos, c0))) }, 'A', mz); T.cd = typeof weaponCd === 'function' ? weaponCd(WEAPONS[A.w], T, A.cd) : A.cd; }
    }
  }
  function structNear(w, range, owner) { // (base.js) buque, satélite o caza enemigo de `owner` más cercano a w: sus torretas le responden
    let best = null, bd = range;
    for (const s of all()) if (s.o !== owner && s.w && !s.arr) { const d = len(sub(s.w, w)); if (d < bd) { bd = d; best = { pos: s.w, q: s.q, d, k: s.k, id: s.id }; } }
    for (const f of FQ.values()) if (f.o !== owner && !f.arr) f.c.forEach((c, j) => { const cw = c.w || c.pos; if (f.hp[j] > 0 && cw) { const d = len(sub(cw, w)); if (d < bd) { bd = d; best = { pos: cw, q: c.q, d, k: 'F', id: f.id * 10 + j }; } } });
    return best;
  }
  const hostT = (w, range) => (typeof BOT !== 'undefined' && BOT.nearestTo(w, range)) || (typeof NEU !== 'undefined' && NEU.nearest(w, range)) || null; // anfitrión: bots (enemigos de todos los humanos) y naves neutrales al alcance
  function fsim(dt, now) { // CAZAS (solo el anfitrión): patrullan en torno a su punto de despliegue, atacan a enemigos, bots y neutrales al alcance; su estado se envía al servidor ('fs')
    const rows = [];
    for (const f of FQ.values()) f.c.forEach((c, j) => {
      if (!(f.hp[j] > 0) || f.arr) return; const cen = fcen(f);
      let tg = null;
      if (f.o !== myId && P.hp > 0 && !S.foot.on && len(sub(S.pos, cen)) < F.engage) tg = { pos: S.pos, v: S.ve || 0, q: S.q, id: myId };
      if (!tg) for (const r of remotes.values()) if (r.id !== f.o && r.id < 2000 && r.hp > 0 && r.apos && len(sub(r.apos, cen)) < F.engage) { tg = { pos: r.apos, v: r.v || 0, q: r.q, id: r.id }; break; }
      if (!tg && f.o < 1000) { const h = hostT(c.pos, F.range * 1.5); if (h && len(sub(h.pos, cen)) < F.engage) tg = h; } // los cazas de un bot no atacan a bots
      if (!c.wp || len(sub(c.wp, c.pos)) < 300) { const a = Math.random() * 6.2832, rr = F.patrol * (0.3 + 0.7 * Math.random()); c.wp = [cen[0] + Math.cos(a) * rr, cen[1] + (Math.random() - 0.5) * 1500, cen[2] + Math.sin(a) * rr]; }
      const T0 = tg ? tg.pos : c.wp, d = sub(T0, c.pos), dl = len(d), vDes = tg ? Math.min(F.vmax, Math.max(30, (dl - 400) * 0.6)) : Math.min(F.vmax * 0.5, 20 + dl * 0.2);
      c.q.rotateTowards(lookQ(nrm(d)), (F.turn || 1.1) * dt); c.v += (vDes - c.v) * (1 - Math.exp(-dt * 0.7)); const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(c.q); // giro 1,1 rad/s (antes 2,4) y aceleración suave: no maniobran mejor que el jugador
      c.pos = [c.pos[0] + fw.x * c.v * dt, c.pos[1] + fw.y * c.v * dt, c.pos[2] + fw.z * c.v * dt]; c.cd -= dt;
      if (tg && c.cd <= 0 && dl < F.range && (fw.x * d[0] + fw.y * d[1] + fw.z * d[2]) / dl > Math.cos(0.3) && !blocked(c.pos, tg.pos)) { // plasma ligero (lo decide la víctima: el disparo se retransmite con ow = escuadrón)
        c.cd = weaponCd(WEAPONS[F.w] || WEAPONS.plasma, c, F.cd); c.mz = c.mz === 1 ? -1 : 1; const key = `${myId ?? 0}:f${++seq}`, mz = toWorld(c.pos, c.q, c.mz * 0.0197 * FSC, -0.002 * FSC, -0.011 * FSC), dir = nrm(sub(tg.pos, mz).map(x => x + (Math.random() - 0.5) * 0.03 * dl)); // vaina de punta de ala, una y otra por turnos
        spawnProj(-f.o, key, 'p', mz, dir, null, F.dmg); sfx('plasma', mz); flash(mz, dir, 0.006 * FSC, 0xffb070);
        send({ t: 'fire', key, kind: 'p', pos: mz, dir, tgt: null, dmg: F.dmg, rb: -1, rp: null, ow: f.id }); if (tg.id === myId) attackAlert('p', 'Cazas de ' + nmOf(f.o), c.pos);
      }
      rows.push([f.id, j, Math.round(c.pos[0] * 10) / 10, Math.round(c.pos[1] * 10) / 10, Math.round(c.pos[2] * 10) / 10, +c.q.x.toFixed(3), +c.q.y.toFixed(3), +c.q.z.toFixed(3), +c.q.w.toFixed(3), Math.round(c.v)]);
    });
    if (now - fsT > 100 && rows.length) { fsT = now; send({ t: 'fs', l: rows }); }
  }
  function frame(dt) {
    const now = performance.now();
    for (const s of all()) {
      s.w = wpos(s); const v = view(s.w), big = s.k === 'W'; s.d = v.d; s.g.visible = !s.arr && v.d < (big ? 5e6 : 300000);
      if (s.g.visible) { s.g.position.set(v.x, v.y, v.z); stretch(s.g, big ? Math.max(v.s * SCW, v.rd * 0.004) : v.s, s, now); s.g.quaternion.copy(s.q); } // buque: tamaño mínimo en pantalla (~10 px) a cualquier distancia
      if (s.halo) { s.halo.visible = s.g.visible && v.d > 60; s.halo.position.set(v.x, v.y, v.z); }
    }
    const host = BASE.isHost() && BASE.started() && !BASE.loading() && BASE.LB.phase === 'playing';
    if (host) fsim(dt, now);
    for (const f of FQ.values()) f.c.forEach((c, j) => { // dibujo de los cazas (los demás clientes extrapolan desde el último estado)
      if (!c.g) { c.g = unitModel('F', f.o === myId); scene.add(c.g); c.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: f.o === myId ? 0x4db8ff : 0xff4030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false })); c.halo.scale.set(0.022, 0.022, 1); scene.add(c.halo); } // halo de bando: visible a miles de km
      let w = c.pos; if (!host && c.t0) { const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(c.q), k = c.v * Math.min(1, (now - c.t0) / 1000); w = [w[0] + fw.x * k, w[1] + fw.y * k, w[2] + fw.z * k]; }
      c.w = w; const v = view(w); c.d = v.d; c.g.visible = !f.arr && f.hp[j] > 0 && v.d < 300000; c.halo.visible = c.g.visible && v.d > 20; if (!c.g.visible) return;
      c.halo.position.set(v.x, v.y, v.z); c.g.position.set(v.x, v.y, v.z); stretch(c.g, Math.max(v.s * FSC, v.rd * 0.4), f, now); c.g.quaternion.copy(c.q); setThrust(c.g, c.v, now); updateShipFx(c.g, now, 0); // modelo ×6 y tamaño mínimo en pantalla (~0,7°)
    });
    if (!BASE.started() || BASE.loading() || BASE.LB.phase !== 'playing') return;
    const alive = P.hp > 0 && !S.warp.on && !S.foot.on;
    for (const s of all()) { // torretas: a mí (si son enemigas) y, en el anfitrión, a bots y neutrales al alcance y con línea de visión
      if ((s.k === 'S' && !s.on) || s.arr) continue; const t = T(s); if (s.k === 'W') { wsTurrets(s, t, dt, alive, host, now); continue; } s.cd = (s.cd ?? Math.random() * t.cd) - dt; if (s.cd > 0) continue;
      let tg = null;
      if (s.o !== myId && alive && s.d < t.range) tg = { pos: S.pos, v: S.ve || 0, q: S.q, id: myId };
      else if (host && s.o < 1000) tg = hostT(s.w, t.range); // unidades de bots: solo contra humanos (cada humano las simula contra sí mismo)
      const seen = !!tg && !blocked(s.w, tg.pos);
      if (s.k === 'W') { if (seen) { if (!s.det && now - (s.alT || 0) > C.alarmCd * 1000) { s.alT = now; send({ t: 'walarm', i: s.id }); } s.det = now; } else if (s.det && now - s.det > 3000) s.det = 0; } // detección nueva de un enemigo: alarma (el servidor la reparte a todos)
      if (!seen) { s.cd = 0.5; continue; }
      fire(s, t, tg);
    }
  }
  function hit(old, pos, p, neu, ak) { // proyectil contra un buque, satélite o caza: mío contra ajenos, o (anfitrión) de una neutral contra cualquiera · el daño lo decide el servidor ('wh')
    for (const s of all()) {
      if ((!neu && s.o === myId) || (p.owner < 0 && s.o === -p.owner) || (p.owner >= 2000 && p.owner < 3000 && s.o === p.owner - 1000) || !s.w || s.arr || segDist(old, pos, s.w) > 2.5 * SCW) continue;
      let ok = s.k === 'S' && segDist(old, pos, s.w) < 0.3;
      if (s.k === 'W') { const f = fwdOf(s); for (const z of [1.35, 0.45, -0.45, -1.25]) if (segDist(old, pos, s.w.map((c, i) => c + f[i] * z * SCW)) < 0.5 * SCW) ok = true; } // 4 esferas a lo largo del casco (escaladas)
      if (!ok) continue;
      send({ t: 'wh', k: s.k, i: s.id, dmg: p.dmg, nb: neu ? 1 : 0, ws: p.wv }); const a = Math.min(s.sh || 0, p.dmg); if (s.k === 'W') s.sh -= a; s.hp -= p.dmg - a; boom(pos, p.kind === 'm' ? 0.08 : 0.02); if (!neu) P.lastCombat = performance.now(); return true;
    }
    const R = p.spd !== undefined || ak > 0.02 ? 0.05 * FSC : HIT_R;
    for (const f of FQ.values()) { if ((!neu && f.o === myId) || (p.owner < 0 && f.o === -p.owner) || (p.owner >= 2000 && p.owner < 3000 && f.o === p.owner - 1000) || f.arr) continue; for (let j = 0; j < F.n; j++) { const c = f.c[j]; if (!(f.hp[j] > 0) || !c.w || segDist(old, pos, c.w) > R) continue; send({ t: 'wh', k: 'F', i: f.id, j, dmg: p.dmg, nb: neu ? 1 : 0 }); f.hp[j] -= p.dmg; boom(pos, 0.02); return true; } }
    return false;
  }
  // ---------- COLISIÓN con el MODELO REAL (buque y satélite) ----------
  // Cajas alineadas con los ejes del MODELO (en el mundo son OBB: giran con s.q y escalan con la escala de dibujo), calculadas UNA vez de la geometría real de models.js: se muestrea la
  // superficie de cada triángulo sólido (sin penachos ni resplandores aditivos), se agrupa en celdas (z 0,04 · y 0,02 · x 0,01 u. del modelo) y cada fila (z, y) se reduce a tramos en x,
  // rellenando los huecos INTERIORES (con superficie encima y debajo); luego se funden filas y rodajas contiguas de extensión casi igual. Cada caja se infla ~12 m reales (validado: scratchpad colltest.js).
  // Se exportan como MODELS[k].colliders = [{ c: [x, y, z], h: [hx, hy, hz] }] (unidades del modelo, proa -z). Mi nave es una esfera de SHIP_R km.
  const COL = {}, SHIP_R = 0.035, SCALE = k => k === 'W' ? SCW : 1; // escala a la que se DIBUJA cada modelo de cerca (frame: stretch(v.s · SCW) con v.s = 1)
  function colliders(k) {
    if (COL[k]) return COL[k];
    const g = unitModel(k, true), INF = 0.012 / SCALE(k), DZ = 0.04, DY = 0.02, DX = 0.01, STEP = 0.012, TR = []; g.updateMatrixWorld(true);
    const a = new THREE.Vector3(); let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    g.traverse(o => { // triángulos sólidos (sin penachos ni resplandores aditivos) en coordenadas del modelo
      if (!o.isMesh || (o.material && o.material.blending === THREE.AdditiveBlending)) return; const pa = o.geometry.attributes.position, ix = o.geometry.index, n = ix ? ix.count : pa.count;
      for (let t = 0; t < n; t++) { a.fromBufferAttribute(pa, ix ? ix.getX(t) : t).applyMatrix4(o.matrixWorld); TR.push(a.x, a.y, a.z); x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y); z0 = Math.min(z0, a.z); z1 = Math.max(z1, a.z); }
    });
    if (!TR.length) return (COL[k] = { boxes: [], R: 0 }); // modelo vacío (pruebas sin models.js)
    const nx = Math.floor((x1 - x0) / DX) + 1, ny = Math.floor((y1 - y0) / DY) + 1, nz = Math.floor((z1 - z0) / DZ) + 1, N = nx * ny * nz, occ = new Uint8Array(N), E = new Float32Array(N * 6), id = (iz, iy, ix) => (iz * ny + iy) * nx + ix;
    for (let i = 0; i < N; i++) { E[i * 6] = E[i * 6 + 2] = E[i * 6 + 4] = Infinity; E[i * 6 + 1] = E[i * 6 + 3] = E[i * 6 + 5] = -Infinity; }
    const RW = k === 'W' ? 0.06 : -1; // pista: sus detalles planos (franja, balizas, chevrones) no se muestrean; la cubre una caja plana propia (abajo)
    const put = (x, y, z) => { if (Math.abs(x) <= RW && z > DECK.z0 - 0.012 && z < DECK.z1 + 0.06 && y > DECK.y - 0.004 && y < DECK.y + 0.006) return; const q = id(Math.min(nz - 1, Math.floor((z - z0) / DZ)), Math.min(ny - 1, Math.floor((y - y0) / DY)), Math.min(nx - 1, Math.floor((x - x0) / DX))), e = q * 6; occ[q] = 1;
      if (x < E[e]) E[e] = x; if (x > E[e + 1]) E[e + 1] = x; if (y < E[e + 2]) E[e + 2] = y; if (y > E[e + 3]) E[e + 3] = y; if (z < E[e + 4]) E[e + 4] = z; if (z > E[e + 5]) E[e + 5] = z; };
    for (let t = 0; t < TR.length; t += 9) { // muestras de la superficie (rejilla baricéntrica de paso ≤ STEP) directamente en las celdas
      const ax = TR[t], ay = TR[t + 1], az = TR[t + 2], bx = TR[t + 3] - ax, by = TR[t + 4] - ay, bz = TR[t + 5] - az, cx = TR[t + 6] - ax, cy = TR[t + 7] - ay, cz = TR[t + 8] - az;
      const m = Math.max(1, Math.ceil(Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz), Math.hypot(cx - bx, cy - by, cz - bz)) / STEP));
      for (let i = 0; i <= m; i++) for (let j = 0; j <= m - i; j++) { const u = i / m, w = j / m; put(ax + bx * u + cx * w, ay + by * u + cy * w, az + bz * u + cz * w); }
    }
    const inside = (iz, iy, ix) => { let up = false, dn = false; for (let j = 0; j < ny && !(up && dn); j++) if (j !== iy && occ[id(iz, j, ix)]) { if (j > iy) up = true; else dn = true; } return up && dn; }; // hueco interior: superficie encima y debajo en la misma rodaja
    let boxes = [], open = [];
    const fuse = (B, r) => { B.x0 = Math.min(B.x0, r.x0); B.x1 = Math.max(B.x1, r.x1); for (const q of r.cells) B.cells.push(q); };
    for (let iz = 0; iz < nz; iz++) {
      let prev = [];
      for (let iy = 0; iy < ny; iy++) {
        const runs = []; let s0 = -1;
        for (let ix = 0; ix <= nx; ix++) { const on = ix < nx && occ[id(iz, iy, ix)]; if (on && s0 < 0) s0 = ix; if (!on && s0 >= 0) { runs.push([s0, ix - 1]); s0 = -1; } }
        for (let r = runs.length - 1; r > 0; r--) { const m = (runs[r - 1][1] + runs[r][0]) >> 1; if (inside(iz, iy, m)) { runs[r - 1][1] = runs[r][1]; runs.splice(r, 1); } } // rellena el interior
        const cur = [];
        for (const [ra, rb] of runs) { const r = { x0: ra, x1: rb, cells: [] }; for (let ix = ra; ix <= rb; ix++) if (occ[id(iz, iy, ix)]) r.cells.push(id(iz, iy, ix));
          const B = prev.find(B => Math.abs(B.sx0 - ra) <= 1 && Math.abs(B.sx1 - rb) <= 1 && !B.used); // misma extensión en x que la fila SEMILLA de la caja (sin deriva): se funde en vertical
          if (B) { B.used = true; fuse(B, r); B.y1 = iy; cur.push(B); } else { const nb = { x0: ra, x1: rb, sx0: ra, sx1: rb, y0: iy, y1: iy, z0: iz, z1: iz, cells: r.cells }; cur.push(nb); boxes.push(nb); } }
        for (const B of cur) B.used = false; prev = cur;
      }
    }
    for (const B of boxes) open.push(B); boxes = []; // fusión a lo largo de z: rodajas contiguas con casi la misma sección
    open.sort((p, q) => p.z0 - q.z0);
    for (const B of open) { const A = boxes.find(A => A.z1 === B.z0 - 1 && Math.abs(A.zy0 - B.y0) <= 1 && Math.abs(A.zy1 - B.y1) <= 1 && Math.abs(A.zx0 - B.x0) <= 1 && Math.abs(A.zx1 - B.x1) <= 1); if (A) { A.z1 = B.z1; A.y0 = Math.min(A.y0, B.y0); A.y1 = Math.max(A.y1, B.y1); fuse(A, B); } else { Object.assign(B, { zx0: B.x0, zx1: B.x1, zy0: B.y0, zy1: B.y1 }); boxes.push(B); } } // se compara con la rodaja SEMILLA de cada caja: sin deriva
    const out = []; let R = 0;
    for (const B of boxes) { // extensión exacta de las muestras de sus celdas + inflado
      const m = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]; for (const q of B.cells) for (let j = 0; j < 6; j++) m[j] = j % 2 ? Math.max(m[j], E[q * 6 + j]) : Math.min(m[j], E[q * 6 + j]);
      if (!(m[0] <= m[1])) continue; const h = [(m[1] - m[0]) / 2 + INF, (m[3] - m[2]) / 2 + INF, (m[5] - m[4]) / 2 + INF], cc = [(m[0] + m[1]) / 2, (m[2] + m[3]) / 2, (m[4] + m[5]) / 2];
      out.push({ c: cc, h }); R = Math.max(R, Math.hypot(Math.abs(cc[0]) + h[0], Math.abs(cc[1]) + h[1], Math.abs(cc[2]) + h[2]));
    }
    if (k === 'W') out.push({ c: [0, DECK.y - 0.02, (DECK.z0 - 0.012 + DECK.z1 + 0.06) / 2], h: [RW, 0.02 + INF, (DECK.z1 - DECK.z0 + 0.072) / 2] }); // superficie de la pista (arriba: DECK.y + INF)
    models[k].colliders = out; return (COL[k] = { boxes: out, R, inf: INF });
  }
  const sdBox = (p, B) => { const qx = Math.abs(p[0] - B.c[0]) - B.h[0], qy = Math.abs(p[1] - B.c[1]) - B.h[1], qz = Math.abs(p[2] - B.c[2]) - B.h[2]; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0); };
  function boxN(p, B) { // normal hacia fuera de la caja en el punto p (local)
    const d = [p[0] - B.c[0], p[1] - B.c[1], p[2] - B.c[2]], q = d.map((x, i) => Math.abs(x) - B.h[i]);
    if (q.some(x => x > 0)) return nrm(q.map((x, i) => Math.max(x, 0) * Math.sign(d[i] || 1)));
    const i = q.indexOf(Math.max(...q)), n = [0, 0, 0]; n[i] = Math.sign(d[i] || 1); return n;
  }
  function sdModel(k, p) { let best = Infinity, bb = null; for (const B of colliders(k).boxes) { const d = sdBox(p, B); if (d < best) { best = d; bb = B; } } return { d: best, B: bb }; } // distancia firmada (u. del modelo) a la caja más cercana
  const toLocal = (s, p) => { _v.set(p[0] - s.w[0], p[1] - s.w[1], p[2] - s.w[2]).applyQuaternion(_qi.copy(s.q).invert()).divideScalar(SCALE(s.k)); return [_v.x, _v.y, _v.z]; };
  const toWorldS = (s, l) => toWorld(s.w, s.q, l[0] * SCALE(s.k), l[1] * SCALE(s.k), l[2] * SCALE(s.k));
  // ---------- PISTA del buque: la cubierta de vuelo de models.js (franja central, superficie y = 0,2325) libre de bloques en |x| ≤ 0,02 entre z −0,84 (proa) y 0,46 (antes de la torre); u. del modelo ----------
  const DECK = { y: 0.2325, hw: 0.02, z0: -0.84, z1: 0.46 }, LAND_KMH = 200, LAND_H = 0.15; // aterrizaje: < 200 km/h relativos y < 150 m sobre la cubierta
  const upOf = s => { _v.set(0, 1, 0).applyQuaternion(s.q); return [_v.x, _v.y, _v.z]; };
  function deck(s) { return { pos: toWorldS(s, [0, DECK.y, (DECK.z0 + DECK.z1) / 2]), dirProa: fwdOf(s), up: upOf(s), ancho: 2 * DECK.hw * SCW, largo: (DECK.z1 - DECK.z0) * SCW }; } // en el mundo (km)
  const deckRest = () => DECK.y + colliders('W').inf + SHIP_R / SCW + 0.001; // altura local (u. del modelo) del centro de mi nave apoyada en la pista, justo fuera de las cajas
  const onDeck = (l, m = 0) => Math.abs(l[0]) <= DECK.hw + m && l[2] >= DECK.z0 - m && l[2] <= DECK.z1 + m;
  function deckLanding(s, l, nL, vEff) { // contacto lento desde arriba sobre la pista de un buque propio: la nave se posa encima (sin daño ni rebote); T la estaciona
    if (nL[1] < 0.7 || !onDeck(l, 0.01) || l[1] < DECK.y - 0.01 || vEff * 3600 > LAND_KMH) return false;
    S.pos = toWorldS(s, [l[0], deckRest(), l[2]]); S.v = Math.min(S.v, 0.01); return true;
  }
  function collide(old, vEff, now) { // buques y satélites son SÓLIDOS según su modelo real: a más de 600 km/h de CIERRE te estrellas; menos, daño y rebote según la normal de la caja golpeada. El buque recibe daño leve ('wh', ≤ 2 % de su vida, cada 2 s como mucho)
    for (const s of all()) {
      if (!s.w || s.arr || !s.q) continue; const K = colliders(s.k), sc = SCALE(s.k), r = SHIP_R / sc;
      if (segDist(old, S.pos, s.w) > K.R * sc + 1) continue; // esfera envolvente generosa (radio real + 1 km): solo ahorra cálculo, no decide
      const la = toLocal(s, old), lb = toLocal(s, S.pos), n = Math.min(80, Math.ceil(len(sub(lb, la)) / 0.01)); let hitP = null, H = null; // subpasos de ≤ 0,01 u. del modelo: sin atravesar paredes delgadas
      for (let i = n ? 1 : 0; i <= n && !hitP; i++) { const f = n ? i / n : 1, p = la.map((x, j) => x + (lb[j] - x) * f); if (!K.boxes.some(B => Math.abs(p[0] - B.c[0]) < B.h[0] + r && Math.abs(p[1] - B.c[1]) < B.h[1] + r && Math.abs(p[2] - B.c[2]) < B.h[2] + r)) continue; const q = sdModel(s.k, p); if (q.d < r) { hitP = p; H = q; } }
      if (!hitP) continue;
      const nL = boxN(hitP, H.B), nW = (() => { _v.set(...nL).applyQuaternion(s.q); return [_v.x, _v.y, _v.z]; })(), mv = sub(S.pos, old), ml = len(mv), kmh = vEff * 3600 * (ml > 1e-9 ? Math.max(0, -(mv[0] * nW[0] + mv[1] * nW[1] + mv[2] * nW[2]) / ml) : 0); // velocidad de CIERRE contra la superficie
      if (s.k === 'W' && s.o === myId && deckLanding(s, hitP, nL, vEff)) return true; // pista del buque propio: contacto lento sobre la cubierta = aterrizaje, no choque
      let p = hitP; for (let it = 0; it < 4; it++) { const q = sdModel(s.k, p); if (q.d >= r) break; const nn = boxN(p, q.B); p = p.map((x, j) => x + nn[j] * (r + 0.002 - q.d)); } // fuera de la caja golpeada (y de las vecinas)
      S.pos = toWorldS(s, p); S.v = Math.min(S.v, 0.02);
      if (kmh > 600) { P.cause = 'te estrellaste contra un ' + (s.k === 'W' ? 'buque de guerra' : 'satélite'); hurt(P.hp + P.sh + 1, nW.map(v => -v), now); boom(S.pos, 60); }
      else hurt(Math.max(3, 60 * kmh / 600), nW.map(v => -v), now);
      if (s.o !== myId && s.k === 'W' && now - (s.bumpT || 0) > 2000) { s.bumpT = now; send({ t: 'wh', k: 'W', i: s.id, dmg: Math.max(1, Math.min(C.ws.hp * 0.02, C.ws.hp * 0.02 * kmh / 600)) }); }
      return true;
    }
    return false;
  }
  function units() { // unidades desplegadas (buques, satélites y cada CAZA por separado) para el HUD y el mapa
    const now = performance.now(), ap = u => u.arr ? Math.max(0, Math.min(1, 1 - (u.arT - now) / (C.arrive * 1000))) : 0; // ap: progreso de la llegada (0 = llegó)
    const out = all().filter(s => s.w).map(s => ({ k: s.k, o: s.o, w: s.w, d: s.d, id: s.id, on: s.on, arr: s.arr, ap: ap(s), bl: s.blinkT }));
    for (const f of FQ.values()) f.c.forEach((c, j) => { if (!(f.hp[j] > 0)) return; const w = c.w || c.pos; if (!w) return; out.push({ k: 'F', o: f.o, w, d: len(sub(w, S.pos)), id: f.id * 10 + j, sq: f.id, hp: f.hp[j], arr: f.arr, ap: ap(f) }); }); // cada caza por separado (id = escuadrón × 10 + caza)
    return out;
  }
  const IMG = {}; const iconImg = k => IMG[k] || (IMG[k] = Object.assign(new Image(), { src: 'data:image/svg+xml;utf8,' + encodeURIComponent(SVG[k]) })); // iconos de la tienda como imagen para los canvas
  function scrPos(w, W, H) { // posición en pantalla o, si queda fuera, punto del borde en su dirección (como el marcador «TU BASE»)
    const v = view(w); tv.set(v.x, v.y, v.z); const cm = tv.clone().applyMatrix4(camera.matrixWorldInverse); tv.project(camera);
    if (cm.z < 0 && Math.abs(tv.x) < 0.92 && Math.abs(tv.y) < 0.86) return { x: (tv.x * 0.5 + 0.5) * W, y: (-tv.y * 0.5 + 0.5) * H, edge: false };
    let dx = cm.x, dy = -cm.y; if (Math.hypot(dx, dy) < 1e-6) { dx = 0; dy = 1; } const rx = W / 2 - 52, ry = H / 2 - 62, t = 1 / Math.hypot(dx / rx, dy / ry); return { x: W / 2 + dx * t, y: H / 2 + dy * t, edge: true, ang: Math.atan2(dy, dx) };
  }
  function badge(p, k, mine, u) { // u.arr: anillo de progreso «llegando» · u.bl: parpadeo al sonar su alarma // círculo azul (mío) o rojo (enemigo) con el icono de la unidad; flecha en el borde si está fuera de la vista
    const col = mine ? '#4db8ff' : '#ff3b30', R = 17; g2.save();
    if (p.edge) { g2.translate(p.x, p.y); g2.rotate(p.ang); g2.fillStyle = col; g2.strokeStyle = '#050f1c'; g2.lineWidth = 3; g2.beginPath(); g2.moveTo(R + 15, 0); g2.lineTo(R + 3, -9); g2.lineTo(R + 3, 9); g2.closePath(); g2.fill(); g2.stroke(); g2.rotate(-p.ang); g2.translate(-p.x, -p.y); }
    g2.beginPath(); g2.arc(p.x, p.y, R + 2.5, 0, 7); g2.fillStyle = '#050f1c'; g2.fill(); g2.beginPath(); g2.arc(p.x, p.y, R, 0, 7); g2.fillStyle = mine ? 'rgba(0,26,52,0.92)' : 'rgba(52,6,0,0.92)'; g2.fill(); g2.lineWidth = 3; g2.strokeStyle = col; g2.stroke();
    if (u && u.arr) { g2.globalAlpha = 0.55; } const im = iconImg(k); if (im.complete && im.naturalWidth) g2.drawImage(im, p.x - 13, p.y - 13, 26, 26); g2.globalAlpha = 1;
    if (u && u.arr) { g2.lineWidth = 4; g2.strokeStyle = '#9fe8ff'; g2.beginPath(); g2.arc(p.x, p.y, R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * u.ap); g2.stroke(); } // llegando (viaje de luz)
    if (u && u.bl && performance.now() - u.bl < 2500 && Math.floor(performance.now() / 180) % 2) { g2.lineWidth = 3; g2.strokeStyle = mine ? '#ffd23f' : '#ff3b30'; g2.beginPath(); g2.arc(p.x, p.y, R + 9, 0, 7); g2.stroke(); } // alarma: parpadeo
    g2.restore();
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
      if (s.o === myId || !s.w || s.arr || s.d > 60000) continue; const v = view(s.w);
      out.push({ kind: s.k, id: s.id, name: (s.k === 'W' ? 'Buque de ' : 'Satélite de ') + nmOf(s.o), hp: s.hp / T(s).hp * 100, sh: s.k === 'W' ? s.sh / C.ws.sh * 100 : 0, grp: { position: new THREE.Vector3(v.x, v.y, v.z) }, dist: v.d, dir: [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d] });
    }
    for (const f of FQ.values()) if (f.o !== myId && !f.arr) f.c.forEach((c, j) => { if (!(f.hp[j] > 0) || !c.w || c.d > 60000 || !c.g) return; const v = view(c.w); out.push({ kind: 'F', id: f.id * 10 + j, name: 'Caza de ' + nmOf(f.o), hp: f.hp[j] / F.hp * 100, sh: 0, grp: c.g, dist: v.d, dir: [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d] }); });
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
      for (const u of units()) { // unidades de MI zona: las mías con flecha en el borde; las enemigas en pantalla, al alcance del radar y con línea de visión
        const mine = u.o === myId, dl = u.d; if (dl < 0.3 || (!inMyZone(u.w) && !aimedIs(u.k, u.id))) continue; // solo las de MI zona (aliadas y enemigas), salvo la fijada/apuntada
        if (!mine && (u.k === 'S' ? dl > C.sat.radar : u.k === 'F' ? dl > 60000 : dl > 5e6)) continue;
        const dd = sub(u.w, S.pos); if (!mine && losBlocked({ kind: 'W', dir: dd.map(q => q / dl), dist: dl })) continue;
        const p = scrPos(u.w, W, H); if (p.edge && !mine) continue; if (!p.edge && dl < (u.k === 'W' ? 12 * SCW : 1)) p.y -= 60; // muy cerca: el icono no tapa el modelo
        badge(p, u.k, mine, u);
        if (!p.edge && dl < (u.k === 'W' ? LABEL_KM.buque : u.k === 'S' ? LABEL_KM.satelite : LABEL_KM.nave) && !aimedIs(u.k, u.id)) hudText(p.x, p.y + 32, [[`${u.k === 'W' ? 'BUQUE' : u.k === 'S' ? 'SATÉLITE' : 'CAZA'} · ${mine ? 'TUYO' : nmOf(u.o).toUpperCase()}${u.k === 'S' && !u.on ? ' · INACTIVO' : ''} · ${fDs(dl)}`, mine ? '#9fd8ff' : '#ff8a7a', `bold 10px ${MONO}`]], 6); // texto solo cerca
      }
      for (const p of projs.values()) if (p.kind === 'm' && p.tgt && p.tgt.id === myId && (p.tgt.k === 'p' || p.tgt.k === 'h') && p.owner !== myId) { const q = scrPos(p.pos, W, H); g2.save(); g2.translate(q.x, q.y); g2.rotate(q.edge ? q.ang : -Math.PI / 2); g2.fillStyle = '#ff3b30'; g2.strokeStyle = '#050f1c'; g2.lineWidth = 3; g2.beginPath(); g2.moveTo(14, 0); g2.lineTo(-6, -9); g2.lineTo(-6, 9); g2.closePath(); g2.stroke(); g2.fill(); g2.restore(); if (!q.edge) hudText(q.x, q.y + 22, [['MISIL', '#ff8a7a', `bold 10px ${MONO}`]], 8); } // misil guiado entrante: flecha roja (en el borde si está fuera de la vista)
      const zi = czAt(SYS, CZ, S.pos, simT); if (CZS[zi].c && CZS[zi].p > 0 && !S.warp.on && !(S.warp.cd > 0)) banner(zi, W, now); // solo mientras se reclama o se disputa (al llegar al 100 % desaparece: aviso puntual en #nt)
    }
    if (P.hp <= 0 && mineW().length) { // selector de reaparición: teclas 1-3
      const o = spawnOpts(), cur = curPref(), tx = 'REAPARECER EN:  ' + o.map((x, i) => `[${i + 1}] ${x.n}${x.id === cur ? ' ◀' : ''}`).join('   ');
      g2.font = `bold 14px ${MONO}`; g2.lineWidth = 4; g2.strokeStyle = '#000'; g2.fillStyle = '#9fe8ff'; g2.strokeText(tx, W / 2, H / 2 + 16); g2.fillText(tx, W / 2, H / 2 + 16);
    }
    g2.restore();
  }
  addEventListener('keydown', e => { if (P.hp > 0 || !BASE.started()) return; const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code), o = spawnOpts(); if (i >= 0 && o[i]) { pref = o[i].id; say(`Reaparecerás en: ${o[i].n}`); } });
  function spawn(noBase) { // reaparecer ESTACIONADO sobre la pista de mi buque elegido (o del primero si no tengo base): true si lo hizo
    const my = mineW().filter(x => x.w && x.q && !x.arr); let s = my.find(x => x.id === pref); if (!s && noBase) s = my[0]; if (!s) return false;
    S.foot.on = false; S.auto = false; S.gearK = 1; park(s, [0, 0, (DECK.z0 + DECK.z1) / 2 + 0.1]); S.q.copy(s.q); camQ.copy(S.q); S.w.p = S.w.y = S.w.r = 0; parkStep(0);
    say('Reapareces en la pista de tu buque de guerra · T o W: despegar'); return true;
  }
  // ---------- ESTACIONAR en la pista de un buque PROPIO: S.park = { on, ws: id del buque, l: [x, z] punto local de la pista, dir: normal de la cubierta, h: altura extra, leaving, t } ----------
  const TAKEOFF_V = 0.15; // km/s (540 km/h) al terminar el despegue, en la dirección de proa del buque
  function landSpot() { // ¿se puede aterrizar ahora? → { s, l } si estoy sobre la pista (con margen lateral) de un buque MÍO ya llegado, a < 150 m de la cubierta y a < 200 km/h
    if (S.park.on || S.warp.on || S.warp.cd > 0 || S.foot.on || P.hp <= 0 || (S.ve || 0) * 3600 > LAND_KMH) return null;
    for (const s of mineW()) { if (!s.w || s.arr || !s.q || len(sub(s.w, S.pos)) > 3 * SCW) continue; const l = toLocal(s, S.pos), hy = (l[1] - deckRest()) * SCW; if (onDeck(l, 0.03) && hy > -0.03 && hy < LAND_H) return { s, l }; }
    return null;
  }
  function park(s, l) { // se posa (o reaparece) sobre la pista: mismo estado que en el suelo, con la cubierta como superficie
    Object.assign(S.park, { on: true, ws: s.id, b: null, l: [Math.max(-DECK.hw, Math.min(DECK.hw, l[0])), Math.max(DECK.z0 + 0.03, Math.min(DECK.z1 - 0.03, l[2]))], dir: upOf(s), h: 0, water: false, upT: null, leaving: false, t: 0, al: 0, dustT: 0 });
    S.v = 0; P.plasma = MAXA.plasma; P.missiles = MAXA.missiles; // rearme al posarse en la pista
  }
  function land() { const ls = landSpot(); if (!ls) return false; park(ls.s, ls.l); sfx('land'); say('Aterrizaje en la pista de tu buque · munición y misiles recargados · Esc: menú'); return true; }
  function parkStep(dt) { // estacionada en la pista: la nave va con el buque (su ancla puede moverse), sin temblores ni deriva; despegue: sube 100 m en 1,8 s y sale por la proa
    const pk = S.park, s = WS.get(pk.ws);
    if (!s || !s.w || !s.q || s.o !== myId) { pk.on = false; pk.ws = null; pk.leaving = false; S.v = TAKEOFF_V; say('Tu buque ya no está: despegue forzoso'); return; }
    pk.dir = upOf(s);
    if (pk.leaving) { pk.t += dt; const u = Math.min(1, pk.t / 1.8); pk.h = 0.1 * u * u * (3 - 2 * u); S.q.slerp(s.q, 1 - Math.exp(-dt * 3)); // se alinea con la proa mientras sube
      if (pk.t >= 1.8) { pk.on = false; pk.leaving = false; pk.ws = null; S.q.copy(s.q); S.v = TAKEOFF_V; say('Despegue completado · rumbo de proa'); } }
    else { pk.h = 0; if ((pk.al += dt) < 1.2) S.q.slerp(s.q, 1 - Math.exp(-dt * 4)); } // al posarse: proa según el buque
    const c = toWorldS(s, [pk.l[0], deckRest(), pk.l[1]]); S.shipPos = c.map((x, i) => x + pk.dir[i] * pk.h); S.pos = S.shipPos.slice();
  }
  function deploy(k, zi, at = 'c') { // (zona sin dueño: válida para buques y cazas; sus unidades la reclaman) // punto AUTOMÁTICO (sysgen.czDeployPoint, igual que el servidor): at 'p' junto al planeta (sobre su base si la tiene) · 'c' junto al cúmulo
    const dp = czDeployPoint(SYS, CZ, ZONES, zi, inZone(zi), at, simT, [...BASE.HG.values()], myId, S.pos); return { off: dp && dp.off, abs: dp && dp.abs, a: dp ? dp.a : 0, why: dp ? check(k, zi, dp.abs, dp.a) : 'Zona solar: no se puede desplegar', at };
  }
  const near = () => { if (S.park.on && S.park.ws && WS.has(S.park.ws)) return true; const p = S.foot.on ? S.shipPos : S.pos; return mineW().some(s => s.w && len(sub(s.w, p)) < C.ws.near); }; // en la pista o junto a mi buque cuenta como «en base»

  // ---------- pestaña FLOTA (3 columnas como NAVE): lista con COMPRAR · preview 3D + estadísticas · unidades desplegadas y reserva con DESPLEGAR ----------
  const DEF = '<defs><linearGradient id="gm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d3dd"/><stop offset=".55" stop-color="#7d8894"/><stop offset="1" stop-color="#4a535d"/></linearGradient><linearGradient id="gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fe0ff"/><stop offset="1" stop-color="#1f7fd0"/></linearGradient><radialGradient id="gf"><stop offset="0" stop-color="#fff7d0"/><stop offset="1" stop-color="#ff9a1a"/></radialGradient></defs>';
  const SVG = {
    W: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${DEF}<path d="M3 42 21 33H55L58 36V47L53 51H17z" fill="url(#gm)" stroke="#050f1c" stroke-width="3" stroke-linejoin="round"/><path d="M15 47H57V50L52 54H21z" fill="#3a434d" stroke="#050f1c" stroke-width="2.5" stroke-linejoin="round"/><path d="M22 42H55" stroke="#4db8ff" stroke-width="2.4"/><rect x="43" y="17" width="11" height="15" rx="1.8" fill="url(#gb)" stroke="#050f1c" stroke-width="2.6"/><path d="M45 23h7" stroke="#050f1c" stroke-width="2"/><path d="M48.5 17V9" stroke="#050f1c" stroke-width="2.4"/><circle cx="48.5" cy="7.5" r="2.4" fill="#4db8ff" stroke="#050f1c" stroke-width="1.5"/><rect x="24" y="29" width="16" height="4.5" rx="1" fill="#3a434d" stroke="#050f1c" stroke-width="2"/><g fill="#050f1c"><rect x="25" y="25" width="6" height="5" rx="1"/><rect x="34" y="25" width="6" height="5" rx="1"/></g><path d="M25 26.5h-6M34 26.5h-6" stroke="#050f1c" stroke-width="2"/><rect x="24" y="37" width="10" height="6" rx="1" fill="#ffe9a8" stroke="#050f1c" stroke-width="2"/><path d="M29 37v6" stroke="#050f1c" stroke-width="1.3"/><g stroke="#050f1c" stroke-width="1.2"><ellipse cx="59.5" cy="38" rx="2.6" ry="2.8" fill="url(#gf)"/><ellipse cx="59.5" cy="43.5" rx="2.6" ry="2.8" fill="url(#gf)"/><ellipse cx="59.5" cy="49" rx="2.4" ry="2.4" fill="url(#gf)"/></g></svg>`,
    S: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${DEF}<g stroke="#050f1c" stroke-width="2.5"><rect x="2" y="26" width="19" height="13" rx="1.5" fill="url(#gb)"/><rect x="43" y="26" width="19" height="13" rx="1.5" fill="url(#gb)"/></g><path d="M8 26v13M14 26v13M49 26v13M56 26v13M2 32.5h19M43 32.5h19" stroke="#0b3a66" stroke-width="1.3"/><path d="M21 32.5h5M38 32.5h5" stroke="#050f1c" stroke-width="3"/><path d="M27 22H37L43 28V37L37 43H27L21 37V28Z" fill="url(#gm)" stroke="#050f1c" stroke-width="3" stroke-linejoin="round"/><path d="M22.5 32.5H41.5" stroke="#4db8ff" stroke-width="2.4"/><path d="M21 15Q32 3 43 15Z" fill="#e8edf2" stroke="#050f1c" stroke-width="2.5" stroke-linejoin="round"/><path d="M32 15v7" stroke="#050f1c" stroke-width="2"/><circle cx="32" cy="7" r="2.2" fill="#4db8ff" stroke="#050f1c" stroke-width="1.3"/><g transform="rotate(38 36 44)"><rect x="34" y="42" width="27" height="5.5" rx="1.6" fill="url(#gm)" stroke="#050f1c" stroke-width="2.4"/><path d="M40 42v5.5M46 42v5.5M52 42v5.5" stroke="#9fe8ff" stroke-width="2"/></g><circle cx="55.5" cy="58.5" r="2.4" fill="url(#gf)" stroke="#050f1c" stroke-width="1.3"/></svg>`,
    F: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${DEF}<g stroke="#050f1c" stroke-width="2.5" stroke-linejoin="round"><path d="M28 32 6 17V25L28 44Z" fill="url(#gm)"/><path d="M36 32 58 17V25L36 44Z" fill="url(#gm)"/><path d="M28 46 20 58H27Z" fill="url(#gm)"/><path d="M36 46 44 58H37Z" fill="url(#gm)"/><path d="M32 3 36.5 14V46L35 53H29L27.5 46V14Z" fill="url(#gm)"/></g><path d="M9 20 27 33M55 20 37 33" stroke="#4db8ff" stroke-width="2.2"/><ellipse cx="32" cy="18" rx="2.6" ry="5.5" fill="url(#gb)" stroke="#050f1c" stroke-width="1.6"/><g fill="#050f1c"><rect x="14" y="27" width="2.4" height="8" rx="1"/><rect x="47.6" y="27" width="2.4" height="8" rx="1"/></g><circle cx="5.5" cy="21" r="2" fill="#ff3b30" stroke="#050f1c" stroke-width="1.2"/><circle cx="58.5" cy="21" r="2" fill="#5dff8a" stroke="#050f1c" stroke-width="1.2"/><ellipse cx="30" cy="55" rx="2.4" ry="3" fill="url(#gf)" stroke="#050f1c" stroke-width="1.2"/><ellipse cx="34" cy="55" rx="2.4" ry="3" fill="url(#gf)" stroke="#050f1c" stroke-width="1.2"/></svg>`,
  };
  const COST = { W: C.ws.cost, S: C.sat.cost, F: F.cost }, DEPL = { W: 'DESPLEGAR', S: 'CONSTRUIR', F: 'DESPLEGAR' };
  const DESC = { W: `Nave capital de ~14 km: misiles guiados de largo alcance (${C.ws.missileRange} km, ${C.ws.dmgLong} de daño) y metralleta (≤ ${C.ws.ammoRange} km, ${C.ws.dmgAmmo} por bala). Se despliega a ${C.approachKm} km de un cúmulo o sobre un planeta (también el de una base rival, para atacarla): reapareces estacionado en su pista (y puedes aterrizar en ella con T): allí y junto al buque compras como en la base.`, S: 'Base flotante estática con misiles guiados de largo alcance. En zonas tuyas o sin dueño (ayuda a reclamarla) y en ataque junto a un planeta con base rival; se desactiva si otro reclama su zona.', F: `${F.n} cazas ligeros que patrullan la zona y atacan enemigos y neutrales; en una zona sin dueño, ayudan a reclamarla. Si caen los ${F.n}, se pierde.` };
  const STATS = k => k === 'W' ? [['Casco', C.ws.hp, 3000, '#5dff8a'], ['Escudo', C.ws.sh, 1000, '#4db8ff'], ['Alcance (km)', C.ws.range, 6000, '#ffd23f'], ['Misiles largo alcance (km)', C.ws.missileRange, 6000, '#ff6a3c'], ['Misil: daño', C.ws.dmgLong, 120, '#ff6a3c'], ['Misil: recarga (s)', C.ws.missile.cd, 10, '#ff6a3c'], ['Umbral misil/metralleta (km)', C.ws.closeKm, 6000, '#9fd4ee'], ['Metralleta: alcance (km)', C.ws.ammoRange, 6000, '#ffd23f'], ['Metralleta: daño por bala', C.ws.dmgAmmo, 120, '#ffd23f'], ['Metralleta: balas/s (en ráfaga)', Math.round(1 / C.ws.ammo.cd), 20, '#ffd23f'], ['Velocidad (km/s)', 0, 400, '#f5a8ff'], ['Unidades', 1, 3, '#9fd4ee'], ['Máximo', C.ws.max, 3, '#9fd4ee']]
    : k === 'S' ? [['Vida', C.sat.hp, 3000, '#5dff8a'], ['Escudo', 0, 1000, '#4db8ff'], ['Alcance (km)', C.sat.range, 6000, '#ffd23f'], ['Daño/disparo', C.sat.dmg, 40, '#ff8a3c'], ['Disparos/s', +(1 / C.sat.cd).toFixed(2), 6, '#c8ff5d'], ['Velocidad (km/s)', 0, 400, '#f5a8ff'], ['Unidades', 1, 3, '#9fd4ee'], ['Por zona', C.sat.maxZone, 3, '#9fd4ee']]
    : [['Vida (cada caza)', F.hp, 3000, '#5dff8a'], ['Escudo', 0, 1000, '#4db8ff'], ['Alcance (km)', F.range, 6000, '#ffd23f'], ['Daño/disparo', F.dmg, 40, '#ff8a3c'], ['Disparos/s', +(F.n / F.cd).toFixed(1), 6, '#c8ff5d'], ['Velocidad (km/s)', F.vmax, 400, '#f5a8ff'], ['Unidades', F.n, 3, '#9fd4ee'], ['Escuadrones', 'sin límite', 1, '#9fd4ee']];
  const full = k => k === 'W' ? mineW().length + stock.W >= C.ws.max : k === 'F' ? mineF().length + stock.F >= F.max : false;
  function preview(k) { // FLOTA: modelo de la unidad elegida en el visor 3D (FV, hangar.js), normalizado a ~2 unidades
    if (typeof FV === 'undefined' || FV.key === k) return; FV.key = k; if (FV.obj) FV.pivot.remove(FV.obj);
    const inner = model(k, true), g = new THREE.Group(); g.add(inner); g.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(g), sz = bx.getSize(new THREE.Vector3()), c = bx.getCenter(new THREE.Vector3()), s = 2.2 / (Math.max(sz.x, sz.y, sz.z) || 1);
    inner.position.copy(c.multiplyScalar(-1)); const o = new THREE.Group(); o.add(g); g.scale.setScalar(s); FV.obj = o; FV.pivot.add(o); FV.cam.position.set(2.3, 1.2, 2.8); FV.cam.lookAt(0, 0, 0);
  }
  function menu() {
    const eL = document.getElementById('fleetList'), eS = document.getElementById('fleetStats'), eD = document.getElementById('fleetDep'); if (!eL) return;
    eL.innerHTML = ['W', 'S', 'F'].map(k => `<div class="upc fsel${k === fsel ? ' on' : ''}" data-fsel="${k}"><i class="uico">${SVG[k]}</i><div><b>${UN[k]}</b><small>${DESC[k]}</small><div class="ctl">${full(k) ? '<span class="max">MÁXIMO</span>' : buyBtn(`data-war="${k}"`, COST[k])}</div></div></div>`).join('');
    eS.innerHTML = `<span style="grid-column:1/-1;font-weight:bold;letter-spacing:.12em;color:#9fd4ee">${UN[fsel].toUpperCase()}</span>` + STATS(fsel).map(([n, v, max, col]) => `<span>${n}</span>${bar(v, max, col)}<b>${v}</b>`).join('');
    const myS = [...SA.values()].filter(s => s.o === myId), myZ = CZ.filter((z, i) => CZS[i].o === myId), inc = {}; for (const z of myZ) inc[z.res] = (inc[z.res] || 0) + C.gain.n;
    const unit = (k, t, s) => `<div class="upc"><i class="uico">${SVG[k]}</i><div><b>${t}</b><small>${s}</small></div></div>`;
    const res = ['W', 'S', 'F'].filter(k => stock[k] > 0).map(k => `<div class="upc"><i class="uico">${SVG[k]}</i><div><b>${UN[k]} · en reserva ${stock[k]}</b><div class="ctl" style="display:flex;gap:6px"><button class="up" data-wdep="${k}"><b>${DEPL[k]}</b></button></div></div></div>`).join(''); // reserva: «+» compra otra y DESPLEGAR abre el mapa
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
    if (d.dataset.wdep === 'S' && !CZS.some(Z => Z.o === myId)) return say('Los satélites solo en zonas tuyas: reclama una primero'); // buques y cazas también en zonas sin dueño (las reclaman)
    ov.style.display = 'none'; MAP.place(d.dataset.wdep); // el mapa se abre en modo colocación
  });
  // ---------- DESPLIEGUE RÁPIDO (tecla B): panel con las unidades en reserva; se despliegan en el sector donde está mi nave (mismas reglas que desde el mapa) ----------
  const qd = document.createElement('div'); qd.id = 'qd'; qd.style.cssText = 'position:fixed;left:50%;top:24%;transform:translateX(-50%);z-index:9;display:none;min-width:330px;background:#0b2233f2;border:4px solid #050f1c;box-shadow:6px 6px 0 #050f1c;border-radius:14px;padding:10px 14px;color:#dff4ff;font:600 13px ui-monospace,Consolas,monospace'; document.body.append(qd);
  let qdOn = false, qdSel = 0, qdMsg = '';
  const qdList = () => ['W', 'S', 'F'].filter(k => stock[k] > 0);
  function qdRender() {
    const L = qdList(), zi = czAt(SYS, CZ, S.pos, simT); qdSel = Math.min(qdSel, Math.max(0, L.length - 1));
    qd.innerHTML = `<div style="letter-spacing:.14em;color:#9fd4ee;margin-bottom:6px">DESPLIEGUE RÁPIDO · ${owner(zi).toUpperCase()}</div>`
      + (L.length ? L.map((k, i) => `<button data-qd="${k}" style="display:flex;align-items:center;gap:10px;width:100%;margin:4px 0;padding:6px 8px;border:3px solid #050f1c;border-radius:10px;background:${i === qdSel ? '#123a55' : '#0a1f30'};color:#dff4ff;font:inherit;cursor:pointer;text-align:left"><kbd>${i + 1}</kbd><i style="display:block;width:34px;height:34px">${SVG[k]}</i><span>${UN[k]}</span><b style="margin-left:auto">×${stock[k]}</b></button>`).join('')
        : '<div style="color:#ffd23f;margin:6px 0">Sin unidades en reserva — compra en FLOTA (Esc)</div>')
      + `<div style="margin-top:6px;font-size:11px;color:${qdMsg ? '#ff8a7a' : '#7fb6d4'}">${qdMsg || '1-9 o ↑↓ + Enter: desplegar en este sector · B / Esc: cerrar'}</div>`;
  }
  function qdOpen(on) { qdOn = on; qdMsg = ''; qd.style.display = on ? 'block' : 'none'; if (on) qdRender(); }
  function qdGo(k) { // mismo punto automático y mismas validaciones que el despliegue desde el mapa (el servidor vuelve a validar)
    if (!k) return; const zi = czAt(SYS, CZ, S.pos, simT), d = deploy(k, zi, 'c'); if (d.why) { qdMsg = d.why; return qdRender(); }
    send({ t: 'wdep', k, zi, at: 'c' }); qdOpen(false);
  }
  addEventListener('keydown', e => { // en fase de captura: con el panel abierto, los números y las flechas no llegan a la nave
    if (e.code === 'KeyB' && !e.repeat && !(e.target && e.target.tagName === 'INPUT')) {
      if (qdOn) qdOpen(false); else if (BASE.started() && !BASE.loading() && P.hp > 0 && S.warp.cd <= 0 && !S.warp.on && ov.style.display === 'none' && !window.MAPOPEN) qdOpen(true);
      e.stopImmediatePropagation(); return;
    }
    if (!qdOn) return; if (P.hp <= 0 || S.warp.cd > 0 || S.warp.on) { qdOpen(false); return; }
    const L = qdList(), i = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(e.code);
    if (e.code === 'Escape') qdOpen(false);
    else if (i >= 0) qdGo(L[i]);
    else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { const n = Math.max(1, L.length); qdSel = (qdSel + (e.code === 'ArrowDown' ? 1 : -1) + n) % n; qdRender(); }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') qdGo(L[qdSel]);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  qd.addEventListener('click', e => { const b = e.target.closest('[data-qd]'); if (b) qdGo(b.dataset.qd); });
  setInterval(() => { if (qdOn) qdRender(); }, 600);
  const sig = () => JSON.stringify([stock, pref, fsel, CZS.map(Z => Z.o), all().map(s => [s.id, s.o, s.on]), [...FQ.values()].map(f => [f.id, f.hp.map(h => h > 0)])]);
  const fOwner = id => { const f = FQ.get(id); return f ? f.o : null; };
  const creditOf = p => p.owner >= 7000 && p.owner < 8000 ? (fOwner(p.owner) ?? p.owner) : p.owner < 0 && p.owner > -1000 && p.sn ? -p.owner : p.owner; // a quién se acredita un golpe/baja: caza → dueño del escuadrón · buque/satélite (p.sn) → su dueño · resto, el propio disparador

  setTimeout(() => { colliders('W'); colliders('S'); }, 0); // se calculan durante la carga (≈ 0,6 s + 0,2 s), no en el primer roce
  return { wsTurrets, wsCands, creditOf, wsTarget, enemyWS, wsSel, basePick, structNear, CZ, CZS, look, owner, check, deploy, collide, colliders, sdModel, deck, deckRest, SHIP_R, landSpot, land, parkStep, units, iconImg, onAlarm, czPos, frame, sync, onEvent, onOk, hit, targets, pos: posOf, hud, spawn, near, mine: mineW, menu, buy, sig, model, nmOf, all, nearestOwned, fOwner, fname: id => 'Cazas de ' + nmOf(fOwner(id)), models };
})();
