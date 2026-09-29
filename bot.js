// Bots IA enemigos: cada planeta que se asigna a un bot en la sala tiene su base (hangar con torretas) y una nave que la defiende y ataca las bases de los humanos.
// Los simula el cliente del administrador; los demás ven sus naves como una nave más (id 2000 + índice) y sus bases como hangares (dueño 1000 + índice).
const BOT = (() => {
  const bots = new Map(); // idx -> { pos, q, v, hp, sh, dead, cd, grp, ang, sendT, mode }
  const HP = 120, SH = 60, DMG = 5, CD = 0.45, FWD = new THREE.Vector3(0, 0, -1);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const spec = () => ({ t: 'halcon', a: [0, 0, 0, 0, 0, 0], c: 0xff4030 });
  function nearest(p) { let best = null, bd = 1e30; for (const b of bodies) { if (b.k === 'sun') continue; const d = dist(p, b.pos) - b.R; if (d < bd) { bd = d; best = b; } } return { b: best, alt: bd }; }
  function respawn(B, h) { const w = BASE.worldOf(h); B.pos = w.map((c, i) => c + h.dir[i] * 0.5); B.v = 0; B.hp = HP; B.sh = SH; B.dead = 0; B.q.copy(lookQ(nrm([h.dir[2], 0, -h.dir[0]]))); }
  function fire(B, idx, dir) {
    const key = `${myId ?? 0}:k${idx}_${++seq}`, n = nearest(B.pos), rb = n.b && n.alt < n.b.R * 30 ? n.b.i : -1;
    spawnProj(2000 + idx, key, 'p', B.pos.slice(), dir, null, DMG, { bot: idx }); sfx('p', dist(B.pos, S.pos));
    send({ t: 'fire', key, kind: 'p', pos: B.pos, dir, tgt: null, dmg: DMG, rb, rp: rb >= 0 ? sub(B.pos, bodies[rb].pos) : null });
  }
  function frame(dt, now) {
    const host = BASE.isHost() && BASE.started() && !BASE.loading(), tang = (up, r, ang) => { const e = new THREE.Vector3(0, 1, 0).cross(up); if (e.lengthSq() < 1e-6) e.set(1, 0, 0); e.normalize(); const n2 = up.clone().cross(e); return e.multiplyScalar(Math.cos(ang) * r).addScaledVector(n2, Math.sin(ang) * r); };
    for (const [idx, B] of [...bots]) if (!host || !BASE.HG.has(1000 + idx)) { if (B.grp) scene.remove(B.grp); bots.delete(idx); } // base destruida o ya no soy el anfitrión
    if (!host) return;
    for (const h of BASE.HG.values()) {
      if (h.o < 1000 || h.hp <= 0) continue; const idx = h.o - 1000; let B = bots.get(idx);
      if (!B) { B = { pos: [0, 0, 0], q: new THREE.Quaternion(), v: 0, hp: HP, sh: SH, dead: 0, cd: 0, grp: makeShip(spec()), ang: Math.random() * 6, sendT: 0, mode: 'defender' }; B.grp.gear.visible = false; scene.add(B.grp); bots.set(idx, B); respawn(B, h); }
      if (B.dead) { B.grp.visible = false; if (now >= B.dead) respawn(B, h); else continue; }
      const nb = nearest(B.pos);
      if (nb.b && nb.alt < nb.b.R * 30 + 1000) B.pos = B.pos.map((c, i) => c + nb.b.pos[i] - nb.b.prev[i]); // en el aire de un planeta viaja con él
      B.sh = Math.min(SH, B.sh + dt * 3); B.cd -= dt; B.ang += dt * 0.5;
      const home = BASE.worldOf(h);
      // objetivo: humano cerca de mi base o de mí > hangar humano más cercano > patrulla
      const foes = [...remotes.values()].filter(r => r.id < 1000 && r.hp > 0 && r.apos).map(r => r.apos); if (P.hp > 0) foes.push(S.pos);
      let foe = null, fd = 1e30; for (const f of foes) { const db = dist(f, B.pos); if ((dist(f, home) < 6 || db < 3) && db < fd) { fd = db; foe = f; } }
      let T, vDes, aimAt = null;
      if (foe) { B.mode = 'defender'; T = foe; vDes = Math.min(1.2, 0.4 + fd * 0.5); aimAt = foe; }
      else {
        let eh = null, ed = 1e30; for (const x of BASE.HG.values()) { if (x.o >= 1000 || x.hp <= 0) continue; const w = BASE.worldOf(x), d = dist(w, B.pos); if (d < ed) { ed = d; eh = { x, w }; } }
        if (eh) { B.mode = 'atacar'; const tg = tang(new THREE.Vector3(...eh.x.dir), 1.3, B.ang); T = eh.w.map((c, i) => c + eh.x.dir[i] * 0.6 + (i === 0 ? tg.x : i === 1 ? tg.y : tg.z)); vDes = Math.min(2e5, Math.max(0.8, ed * 0.35)); aimAt = eh.w.map((c, i) => c + eh.x.dir[i] * 0.008); }
        else { B.mode = 'defender'; const tg = tang(new THREE.Vector3(...h.dir), 0.9, B.ang); T = home.map((c, i) => c + h.dir[i] * 0.45 + (i === 0 ? tg.x : i === 1 ? tg.y : tg.z)); vDes = 0.5; }
      }
      // atmósfera: velocidad máxima y altura mínima sobre el suelo
      const relN = sub(B.pos, nb.b.pos), l = len(relN), upN = relN.map(c => c / l); const D = new THREE.Vector3(...nrm(sub(T, B.pos)));
      if (nb.alt < 300) { vDes = Math.min(vDes, 2.5); const sr = planets.surfaceR(nb.b, relN, l), alt = l - sr; if (alt < 0.7) D.addScaledVector(new THREE.Vector3(...upN), 1.2 * (0.7 - alt) / 0.7 + 0.2).normalize(); if (alt < 0.15) B.pos = nb.b.pos.map((c, i) => c + upN[i] * (sr + 0.15)); }
      B.q.rotateTowards(lookQ([D.x, D.y, D.z]), 2.2 * dt); B.v += (vDes - B.v) * (1 - Math.exp(-dt * 1.5));
      const f = FWD.clone().applyQuaternion(B.q); B.pos = [B.pos[0] + f.x * B.v * dt, B.pos[1] + f.y * B.v * dt, B.pos[2] + f.z * B.v * dt];
      if (aimAt && B.cd <= 0) { const ad = sub(aimAt, B.pos), al = len(ad); if (al < 3.5 && (f.x * ad[0] + f.y * ad[1] + f.z * ad[2]) / al > Math.cos(0.14)) { B.cd = CD; fire(B, idx, [ad[0] / al + (Math.random() - 0.5) * 0.02, ad[1] / al + (Math.random() - 0.5) * 0.02, ad[2] / al + (Math.random() - 0.5) * 0.02]); } }
      const v = view(B.pos); B.grp.visible = true; B.grp.position.set(v.x, v.y, v.z); B.grp.scale.setScalar(Math.max(v.s, v.rd * 0.12)); B.grp.quaternion.copy(B.q); setThrust(B.grp, B.v, now); updateShipFx(B.grp, now, 0);
      if (now - B.sendT > 66) { B.sendT = now; const n2 = nearest(B.pos), rb = n2.b && n2.alt < n2.b.R * 30 ? n2.b.i : -1; send({ t: 'bs', i: idx, name: 'BOT ' + h.b, pos: B.pos, q: B.q.toArray(), v: B.v, hp: B.hp / HP * 100, sh: B.sh / SH * 100, sp: spec(), pk: 0, ms: 0, rb, rp: rb >= 0 ? sub(B.pos, bodies[rb].pos) : null }); }
    }
  }
  function hit(old, pos, p, key, ak) { // proyectil (de humanos o torretas de humanos) contra un bot: lo decide el administrador
    if (p.owner <= -1000) return false; // las torretas de las bases bot solo disparan a humanos
    for (const [idx, B] of bots) {
      if (B.dead || segDist(old, pos, B.pos) >= (p.spd !== undefined || ak > 0.02 ? 0.05 : HIT_R)) continue;
      const over = p.dmg - B.sh; B.sh = Math.max(0, B.sh - p.dmg); if (over > 0) B.hp -= over;
      const dead = B.hp <= 0; if (dead) { B.dead = performance.now() + 20000; boom(B.pos, 30); if (B.grp) B.grp.visible = false; }
      send({ t: 'hit', by: p.owner, key, dmg: p.dmg, pos: B.pos, dead, sh: B.sh }); return true;
    }
    return false;
  }
  function nearestTo(w, range) { let best = null, bd = range; for (const [idx, B] of bots) { if (B.dead) continue; const d = dist(B.pos, w); if (d < bd) { bd = d; best = { pos: B.pos, v: B.v, q: B.q, d, id: 2000 + idx }; } } return best; }
  return { frame, hit, nearestTo, bots };
})();
