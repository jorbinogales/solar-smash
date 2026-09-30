// Bots IA enemigos: cada planeta que se asigna a un bot en la sala tiene su base (hangar con torretas) y una nave que la defiende y ataca las bases de los humanos.
// Los simula el cliente del administrador; los demás ven sus naves como una nave más (id 2000 + índice) y sus bases como hangares (dueño 1000 + índice).
// La NAVE del bot (chasis y mejoras) la decide el servidor con su economía (fila del hangar: sp) y aquí se aplica: estadísticas reales (statsOf, ships.js) y modelo para todos (sp en 'bs').
// Táctica: reacción con retardo, puntería adelantada con error que baja con el nivel, plasma de cerca y misiles guiados a media distancia, esquiva de proyectiles (misma probabilidad
// que el jugador), persecución de quien le ataca (y ayuda a otros bots), asalto a bases por fases (reunirse fuera del alcance de las torretas → asalto a la torreta más débil → retirada al 30 %).
const BOT = (() => {
  const bots = new Map(); // idx -> { pos, q, v, hp, sh, dead, cd, grp, ang, sendT, mode, K (estadísticas), ph (fase de asalto), ev (esquiva hasta), aggr (quien le ataca) }
  const CD = 0.45, FWD = new THREE.Vector3(0, 0, -1);
  // parámetros tácticos (documentados en el informe)
  const AI = { react: [0.2, 0.4], retreat: 0.3, back: 0.9, stage: 250, regroup: 8, mCd: 7, mRange: [1.5, 6], chase: 20, chaseKm: 60, help: 50, dodgeLook: 3, dodgeR: 0.25, dodgeT: 0.5 };
  const K_HP = 1.2, K_SH = 0.75, K_DMG = 0.625; // bot = chasis de ships.js con estos factores (Halcón: 84 casco · 42 escudo · 3,5 de daño, como antes)
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const specOf = h => validSpec({ ...(h && h.sp ? h.sp : { t: 'halcon', a: [0, 0, 0, 0, 0, 0] }), c: 0xff4030 });
  function statsFor(sp) { const st = statsOf(sp), T = TYPES[sp.t]; return { HP: st.hp * K_HP, SH: st.sh * K_SH, DMG: st.pdmg * K_DMG, MIS: st.missiles, agil: T.agil, vmul: T.speed / TYPES.halcon.speed, LV: 5 + sp.a.reduce((x, y) => x + y, 0), key: JSON.stringify(sp) }; }
  const dodgeP = agil => Math.max(0.25, Math.min(0.45, 0.25 + 0.2 * agil)); // la misma que la esquiva del jugador (game.js dodgeP)
  function incoming(B, list, now) { // → dirección lateral de esquiva si un proyectil HOSTIL viene hacia el bot (predicción: punto más cercano de su trayectoria en los próximos dodgeLook km)
    for (const p of list) { if (!p.dir || !p.pos || (p.owner >= 2000 && p.owner < 3000) || p.owner <= -1000 || (p.dg && p.dg.has(B.idx))) continue;
      const rel = sub(B.pos, p.pos), al = rel[0] * p.dir[0] + rel[1] * p.dir[1] + rel[2] * p.dir[2]; if (al <= 0 || al > AI.dodgeLook) continue;
      const perp = rel.map((c, i) => c - p.dir[i] * al), pd = len(perp); if (pd > AI.dodgeR) continue;
      (p.dg = p.dg || new Set()).add(B.idx); const side = pd > 1e-6 ? perp.map(c => c / pd) : nrm([p.dir[2], 0, -p.dir[0]]); return side; }
    return null;
  }
  const phaseOf = (ph, frac, shFrac, staged) => frac < AI.retreat ? 'retirada' : ph === 'retirada' ? (shFrac >= AI.back ? 'reunir' : 'retirada') : ph === 'reunir' && staged ? 'asalto' : ph || 'reunir'; // asalto a bases por fases
  function nearest(p) { let best = null, bd = 1e30; for (const b of bodies) { if (b.k === 'sun') continue; const d = dist(p, b.pos) - b.R; if (d < bd) { bd = d; best = b; } } return { b: best, alt: bd }; }
  function respawn(B, h) { const w = BASE.worldOf(h); B.pos = w.map((c, i) => c + h.dir[i] * 0.5); B.v = 0; B.hp = B.K.HP; B.sh = B.K.SH; B.mis = B.K.MIS; B.dead = 0; B.ph = 'reunir'; B.q.copy(lookQ(nrm([h.dir[2], 0, -h.dir[0]]))); }
  function fire(B, idx, dir, kind = 'p', tgt = null) {
    const key = `${myId ?? 0}:k${idx}_${++seq}`, n = nearest(B.pos), rb = n.b && n.alt < n.b.R * 30 ? n.b.i : -1, dmg = kind === 'm' ? Math.min(30, WPN.m.dmg * K_DMG) : B.K.DMG; // misil ≤ 30 (tope del servidor al retransmitirlo)
    spawnProj(2000 + idx, key, kind, B.pos.slice(), dir, tgt, dmg, { bot: idx }); sfx(kind === 'm' ? 'misil' : 'plasma', B.pos);
    send({ t: 'fire', key, kind, pos: B.pos, dir, tgt, dmg, rb, rp: rb >= 0 ? sub(B.pos, bodies[rb].pos) : null, ow: 2000 + idx }); // ow: el disparo es del bot, no del anfitrión
  }
  const posOfId = id => id === myId ? (P.hp > 0 ? S.pos : null) : (remotes.get(id) || {}).apos || null;
  const velOf = id => id === myId ? { v: S.ve || 0, q: S.q } : { v: (remotes.get(id) || {}).v || 0, q: (remotes.get(id) || {}).q };
  function frame(dt, now) {
    const host = BASE.isHost() && BASE.started() && !BASE.loading(), tang = (up, r, ang) => { const e = new THREE.Vector3(0, 1, 0).cross(up); if (e.lengthSq() < 1e-6) e.set(1, 0, 0); e.normalize(); const n2 = up.clone().cross(e); return e.multiplyScalar(Math.cos(ang) * r).add(n2.multiplyScalar(Math.sin(ang) * r)); };
    for (const [idx, B] of [...bots]) if (!host || !BASE.HG.has(1000 + idx)) { if (B.grp) scene.remove(B.grp); bots.delete(idx); } // base destruida o ya no soy el anfitrión
    if (!host) return;
    const plist = [...projs.values()];
    for (const h of BASE.HG.values()) {
      if (h.o < 1000 || h.hp <= 0) continue; const idx = h.o - 1000, sp = specOf(h); let B = bots.get(idx);
      if (!B) { B = { idx, pos: [0, 0, 0], q: new THREE.Quaternion(), v: 0, dead: 0, cd: 0, mcd: 3, grp: null, ang: Math.random() * 6, sendT: 0, mode: 'defender', K: statsFor(sp) }; bots.set(idx, B); respawn(B, h); }
      if (!B.grp || B.K.key !== JSON.stringify(sp)) { const hp0 = B.hp / B.K.HP, sh0 = B.sh / B.K.SH; B.K = statsFor(sp); B.hp = hp0 * B.K.HP; B.sh = sh0 * B.K.SH; if (B.grp) scene.remove(B.grp); B.grp = makeShip(sp); B.grp.gear.visible = false; scene.add(B.grp); } // nave nueva o mejorada (la decide el servidor)
      B.name = 'BOT ' + h.b; if (B.dead) { B.grp.visible = false; if (now >= B.dead) respawn(B, h); else { sendState(B, idx, h, now); continue; } } // muerto: se sigue enviando (vida 0) para que nadie vea un bot congelado e invulnerable
      const nb = nearest(B.pos);
      if (nb.b && nb.alt < nb.b.R * 30 + 1000) B.pos = B.pos.map((c, i) => c + nb.b.pos[i] - nb.b.prev[i]); // en el aire de un planeta viaja con él
      B.sh = Math.min(B.K.SH, B.sh + dt * 3); B.cd -= dt; B.mcd -= dt; B.ang += dt * 0.5;
      const home = BASE.worldOf(h), frac = (B.hp + B.sh) / (B.K.HP + B.K.SH);
      // objetivo: quien le ataca (o ataca a otro bot) > humano cerca de mi base o de mí > base humana (asalto por fases) > patrulla
      let foe = null, foeId = null, fd = 1e30;
      if (B.aggr && B.aggr.t > now) { const p = posOfId(B.aggr.id); if (p && dist(p, B.pos) < AI.chaseKm) { foe = p; foeId = B.aggr.id; fd = dist(p, B.pos); } }
      if (!foe) { const cand = [...remotes.values()].filter(r => r.id < 1000 && r.hp > 0 && r.apos).map(r => [r.id, r.apos]); if (P.hp > 0) cand.push([myId, S.pos]); for (const [id, f] of cand) { const db = dist(f, B.pos); if ((dist(f, home) < 6 || db < 3) && db < fd) { fd = db; foe = f; foeId = id; } } }
      if (foe && B.foeId !== foeId) { B.foeId = foeId; B.seeT = now + 1000 * (AI.react[0] + Math.random() * (AI.react[1] - AI.react[0])); } // tiempo de reacción antes del primer disparo
      if (!foe) B.foeId = null;
      let T, vDes, aimAt = null, mTgt = null;
      if (foe) { B.mode = 'defender'; T = foe; vDes = Math.min(1.2, 0.4 + fd * 0.5) * B.K.vmul; aimAt = foe; mTgt = { k: 'p', id: foeId }; }
      else {
        let eh = null, ed = 1e30; for (const x of BASE.HG.values()) { if (x.o >= 1000 || x.hp <= 0) continue; const w = BASE.worldOf(x), d = dist(w, B.pos); if (d < ed) { ed = d; eh = { x, w }; } }
        if (eh) { // ASALTO a la base humana: reunir fuera del alcance de las torretas → asalto (torreta más débil primero, misiles al hangar) → retirada al 30 % hasta recargar el escudo
          B.mode = 'atacar'; const stage = eh.w.map((c, i) => c + eh.x.dir[i] * AI.stage), mates = [...bots.values()].filter(o => o !== B && !o.dead && o.ph === 'reunir' && dist(o.pos, stage) < 30).length;
          B.stT = B.ph === 'reunir' && dist(B.pos, stage) < 30 ? (B.stT || now) : 0; B.ph = phaseOf(B.ph, frac, B.sh / B.K.SH, B.stT && (mates >= 1 || now - B.stT > AI.regroup * 1000) && B.sh >= B.K.SH * AI.back);
          if (B.ph === 'asalto') {
            let tw = -1, tv = 1e9; (eh.x.tw || []).forEach((v, i) => { if (v > 0 && v < tv) { tv = v; tw = i; } }); const tp = tw >= 0 && BASE.towerPos ? BASE.towerPos(eh.x, tw) : null;
            const tg = tang(new THREE.Vector3(...eh.x.dir), 1.3, B.ang); T = eh.w.map((c, i) => c + eh.x.dir[i] * 0.6 + (i === 0 ? tg.x : i === 1 ? tg.y : tg.z)); vDes = Math.min(2e5, Math.max(0.8, ed * 0.35)) * B.K.vmul;
            aimAt = tp || eh.w.map((c, i) => c + eh.x.dir[i] * 0.008); mTgt = { k: 'h', id: eh.x.o };
          } else { T = B.ph === 'retirada' ? home.map((c, i) => c + h.dir[i] * 3) : stage; vDes = Math.min(2e5, Math.max(0.8, dist(T, B.pos) * 0.35)) * B.K.vmul; }
        }
        else { B.mode = 'defender'; const tg = tang(new THREE.Vector3(...h.dir), 0.9, B.ang); T = home.map((c, i) => c + h.dir[i] * 0.45 + (i === 0 ? tg.x : i === 1 ? tg.y : tg.z)); vDes = 0.5; }
      }
      // atmósfera: velocidad máxima y altura mínima sobre el suelo
      const relN = sub(B.pos, nb.b.pos), l = len(relN), upN = relN.map(c => c / l); const D = new THREE.Vector3(...nrm(sub(T, B.pos)));
      const side = incoming(B, plist, now); if (side) { B.ev = now + AI.dodgeT * 1000; B.evS = side; B.dp = dodgeP(B.K.agil); } // proyectil hostil en camino: maniobra evasiva (lateral + alabeo)
      if (B.ev > now) D.addScaledVector(new THREE.Vector3(...B.evS), 1.5).normalize();
      if (nb.alt < 300) { vDes = Math.min(vDes, 2.5); const sr = planets.surfaceR(nb.b, relN, l), alt = l - sr; if (alt < 0.7) D.addScaledVector(new THREE.Vector3(...upN), 1.2 * (0.7 - alt) / 0.7 + 0.2).normalize(); if (alt < 0.15) B.pos = nb.b.pos.map((c, i) => c + upN[i] * (sr + 0.15)); }
      { const sd = sub(B.pos, bodies[0].pos), sl = len(sd); if (sl < STAR_KILL_R * 1.2) D.addScaledVector(new THREE.Vector3(sd[0] / sl, sd[1] / sl, sd[2] / sl), 2).normalize(); } // evita la zona letal de la estrella
      B.q.rotateTowards(lookQ([D.x, D.y, D.z]), 2.2 * (0.6 + 0.6 * B.K.agil) * dt); if (B.ev > now) B.q.multiply(new THREE.Quaternion().setFromAxisAngle(FWD, 6 * dt)); B.v += (vDes - B.v) * (1 - Math.exp(-dt * 1.5)); // alabeo durante la esquiva
      const f = FWD.clone().applyQuaternion(B.q); B.pos = [B.pos[0] + f.x * B.v * dt, B.pos[1] + f.y * B.v * dt, B.pos[2] + f.z * B.v * dt];
      if (aimAt && !(B.seeT > now)) { // disparo: reacción cumplida; plasma con adelanto (error que baja con el nivel) y misil guiado a media distancia
        const ad0 = sub(aimAt, B.pos), al0 = len(ad0);
        if (mTgt && B.mcd <= 0 && B.mis > 0 && al0 > AI.mRange[0] && al0 < AI.mRange[1]) { B.mcd = AI.mCd; B.mis--; fire(B, idx, ad0.map(c => c / al0), 'm', mTgt); }
        if (B.cd <= 0) { let ap = aimAt; if (foeId != null) { const vv = velOf(foeId), ak = airK(B.pos), ps = WPN.p.speed * (1 - ak) + AIR.p * ak, fw = vv.q ? new THREE.Vector3(0, 0, -1).applyQuaternion(vv.q) : null; if (fw) { const tt = al0 / ps; ap = aimAt.map((c, i) => c + fw.getComponent(i) * vv.v * tt); } }
          const ad = sub(ap, B.pos), al = len(ad), err = 0.005 + 0.02 * Math.max(0, 1 - (B.K.LV - 5) / 15);
          if (al < 3.5 && (f.x * ad[0] + f.y * ad[1] + f.z * ad[2]) / al > Math.cos(0.14)) { B.cd = weaponCd(WEAPONS.plasma, B, CD); fire(B, idx, nrm(ad.map(c => c / al + (Math.random() - 0.5) * err * 2))); } }
      }
      const v = view(B.pos); B.grp.visible = true; B.grp.position.set(v.x, v.y, v.z); B.grp.scale.setScalar(Math.max(v.s, v.rd * 0.12)); B.grp.quaternion.copy(B.q); setThrust(B.grp, B.v, now); updateShipFx(B.grp, now, B.mis || 0);
      sendState(B, idx, h, now);
    }
  }
  function sendState(B, idx, h, now) { // estado del bot para los demás (cada 66 ms)
    if (now - B.sendT <= 66) return; B.sendT = now; const n2 = nearest(B.pos), rb = n2.b && n2.alt < n2.b.R * 30 ? n2.b.i : -1;
    send({ t: 'bs', i: idx, name: 'BOT ' + h.b, pos: B.pos, q: B.q.toArray(), v: B.dead ? 0 : B.v, hp: B.dead ? 0 : B.hp / B.K.HP * 100, sh: B.dead ? 0 : B.sh / B.K.SH * 100, sp: specOf(h), lv: B.K.LV, pk: 0, ms: B.mis || 0, rb, rp: rb >= 0 ? sub(B.pos, bodies[rb].pos) : null });
  }
  function hit(old, pos, p, key, ak) { // proyectil (de humanos o torretas de humanos) contra un bot: lo decide el administrador
    if (p.owner <= -1000) return false; // las torretas de las bases bot solo disparan a humanos
    for (const [idx, B] of bots) {
      if (B.dead || segDist(old, pos, B.pos) >= (p.hr ?? (p.spd !== undefined || ak > 0.02 ? 0.05 : HIT_R))) continue;
      if (p.nl && Math.random() >= NOLOCK_HIT) { puff(pos, 0.01, 0xffd070, 0.3, 0.006); return true; } // disparo sin bloqueo: solo cuenta el 45 % de los impactos
      const now = performance.now(), who = p.owner > 0 && p.owner < 1000 ? p.owner : p.owner < 0 && p.owner > -1000 ? -p.owner : null;
      if (who) for (const o of bots.values()) if (o === B || (!o.dead && dist(o.pos, B.pos) < AI.help)) o.aggr = { id: who, t: now + AI.chase * 1000 }; // persigue a quien le ataca; los bots cercanos acuden
      if (B.ev > now && Math.random() < (B.dp || 0.25)) { puff(pos, 0.01, 0xffd070, 0.3, 0.006); return true; } // esquiva (misma probabilidad que el jugador: 25-45 % según maniobra)
      const over = p.dmg - B.sh; B.sh = Math.max(0, B.sh - p.dmg); if (over > 0) B.hp -= over;
      const dead = B.hp <= 0; if (dead) { B.dead = now + 20000; boom(B.pos, 30); if (B.grp) B.grp.visible = false; }
      send({ t: 'hit', by: p.owner, key, dmg: p.dmg, pos: B.pos, dead, sh: B.sh, v: 2000 + idx }); // v: la víctima es el bot
      if (dead && p.owner === myId) { P.kills++; say('¡BAJA CONFIRMADA!'); gainXp(5, 'Bot enemigo derribado'); } // el anfitrión no recibe su propio evento
      return true;
    }
    return false;
  }
  function nearestTo(w, range) { let best = null, bd = range; for (const [idx, B] of bots) { if (B.dead) continue; const d = dist(B.pos, w); if (d < bd) { bd = d; best = { pos: B.pos, v: B.v, q: B.q, d, id: 2000 + idx }; } } return best; }
  function targets() { // en el anfitrión sus bots no llegan como remotos: se añaden aquí como objetivos (fijables, marcadores, Tab y recuadro)
    const out = []; if (P.hp <= 0) return out;
    for (const [idx, B] of bots) { if (B.dead || !B.grp || !B.grp.visible) continue; const v = view(B.pos), h = BASE.HG.get(1000 + idx), sp = specOf(h); out.push({ kind: 'p', id: 2000 + idx, name: B.name || 'BOT', hp: B.hp / B.K.HP * 100, sh: B.sh / B.K.SH * 100, grp: B.grp, dist: v.d, dir: [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d], lv: B.K.LV, st: sp.t, sp, pos: B.pos }); }
    return out;
  }
  const get = id => { const B = id >= 2000 && id < 3000 ? bots.get(id - 2000) : null; return B && !B.dead ? B : null; };
  return { frame, hit, nearestTo, bots, targets, pos: id => (get(id) || {}).pos || null, speed: id => (get(id) || {}).v || 0, name: id => (get(id) || {}).name || null, logic: { incoming, phaseOf, statsFor, dodgeP, AI } };
})();
