// Mapa del sistema (tecla M): mapa 3D con los planetas (su textura), órbitas, zonas de recursos, jugadores y hangares (BASES).
// Cámara libre: se puede ir a cualquier punto del sistema. Clic en un planeta o zona: enfocarlo y ver su ficha (y fijar una zona como destino del salto luz).
// Usa bodies, remotes, S, ZONES, ZT, zoneRes, tgtObj, myName... de game.js.
const BASES = []; // { owner, name, body: nombre del planeta, lat, lon } (radianes): los rellena base.js con los hangares del servidor
const MAP = (() => {
  const root = document.createElement('div'); root.id = 'map';
  root.innerHTML = '<div class="mh"><b>MAPA DEL SISTEMA</b></div><canvas class="m2"></canvas><div class="mc" hidden></div>'; // el canvas 3D (.m3) se crea al abrir el mapa y se destruye al cerrarlo: así no queda un segundo contexto WebGL en memoria durante la partida
  document.body.append(root);
  const c2 = root.querySelector('.m2'), g = c2.getContext('2d'), card = root.querySelector('.mc');
  const RTS_PITCH = -1.0, RTS_YAW = 0, RTS_DIST = 2.2, DIST_MAX = 80; // vista RTS: cámara alta mirando en diagonal (57° sobre el plano), rumbo fijo; distancia inicial cerca de tu nave y hasta ver todo el sistema
  const st = { open: false, drag: null, btn: 0, moved: 0, mx: 0, my: 0, yaw: RTS_YAW, pitch: RTS_PITCH, pos: new THREE.Vector3(), goal: null, keys: {}, sel: null, cardSig: '', hover: [], t: 0, follow: true, dist: RTS_DIST }; // follow: la cámara sigue a tu nave hasta que la muevas a mano (C la vuelve a fijar)
  let sys = null, c3 = null, pmr = null;
  const K = 1e-6; // km -> unidades del mapa
  const accent = r => { try { return JSON.parse(r.spk).c; } catch { return 0xff6a3c; } };
  const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');
  const others = () => [...remotes.values()].filter(r => r.apos && r.hp > 0).concat(typeof BOT !== 'undefined' ? [...BOT.bots.values()].filter(B => !B.dead && B.grp.visible).map(B => ({ apos: B.pos, q: B.q, name: B.name || 'BOT', spk: '{"c":16728112}' })) : []); // en el anfitrión sus bots no son remotos

  function ensureRenderer() {
    if (pmr) return;
    c3 = document.createElement('canvas'); c3.className = 'm3'; c3.style.display = 'block'; root.insertBefore(c3, c2);
    pmr = new THREE.WebGLRenderer({ canvas: c3, antialias: true, alpha: true }); pmr.setPixelRatio(Math.min(devicePixelRatio, 1.5)); resize();
  }
  function releaseRenderer() { // destruye el contexto WebGL del mapa (y con él todo lo que subió a la GPU) hasta la próxima vez que se abra
    if (!pmr) return; pmr.dispose(); pmr.forceContextLoss(); c3.remove(); pmr = null; c3 = null; sys = null;
  }
  function open() {
    st.open = true; window.MAPOPEN = true; root.style.display = 'block'; document.exitPointerLock(); ensureRenderer(); initSys(); resize();
    st.dist = RTS_DIST; focusMe(true); st.t = performance.now(); requestAnimationFrame(loop); // al abrir: vista RTS cercana, centrada y siguiendo a tu nave
  }
  function close() { st.open = false; window.MAPOPEN = false; root.style.display = 'none'; st.keys = {}; st.drag = null; st.sel = null; card.hidden = true; releaseRenderer(); renderer.domElement.requestPointerLock(); }
  function resize() { c2.width = innerWidth; c2.height = innerHeight; if (pmr) { pmr.setSize(innerWidth, innerHeight, false); if (sys) { sys.cam.aspect = innerWidth / innerHeight; sys.cam.updateProjectionMatrix(); } } }
  addEventListener('resize', () => st.open && resize());

  // ---------- escena: planetas con su textura sobre sus órbitas (tamaños exagerados para poder verlos) y zonas de recursos ----------
  const dispR = b => b.k === 'sun' ? 1.5 : b.parent ? 0.1 + b.R / 9000 : 0.22 + b.R / 1800 * 0.09;
  function moonOrbitR(b) { const sibs = bodies.filter(m => m.parent === b.parent); return dispR(b.parent) * 2.1 + 0.32 * sibs.indexOf(b); }
  const zoneR = z => z.anchor ? 0.2 : Math.max(0.3, z.radius * K); // radio dibujado de una zona
  function initSys() {
    if (sys) return;
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.005, 3000); cam.rotation.order = 'YXZ';
    sc.add(new THREE.AmbientLight(0xffffff, 0.42)); const pl = new THREE.PointLight(0xfff2d8, 2.2, 0, 0); sc.add(pl);
    { const p = new Float32Array(3 * 1800); for (let i = 0; i < p.length; i += 3) { const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - u * u); p[i] = 900 * r * Math.cos(a); p[i + 1] = 900 * u; p[i + 2] = 900 * r * Math.sin(a); } const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(p, 3)); sc.add(new THREE.Points(gg, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, color: 0xffffff }))); }
    const sysSphere = new THREE.SphereGeometry(1, 40, 28), objs = bodies.map(b => {
      const tex = b.mesh.material.map, mat = b.k === 'sun' ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.42 });
      const m = new THREE.Mesh(sysSphere, mat); m.scale.setScalar(dispR(b)); sc.add(m);
      let orbit = null;
      if (b.a) { const seg = 128, pts = [], r = b.parent ? moonOrbitR(b) : b.a * DIST_SCALE * K; for (let i = 0; i <= seg; i++) { const a = i / seg * 6.2832; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
        orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: b.parent ? 0x4a6f88 : 0x6fa3c4, transparent: true, opacity: b.parent ? 0.45 : 0.6 })); sc.add(orbit); }
      if (b.k === 'sun') { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(4.6); m.add(s); }
      return { b, m, orbit, p: new THREE.Vector3() };
    });
    const rockGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position; let sd = 7; const rn = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296, seen = {}; for (let i = 0; i < p.count; i++) { const key = p.getX(i).toFixed(3) + p.getY(i).toFixed(3) + p.getZ(i).toFixed(3); if (!seen[key]) seen[key] = 0.72 + 0.5 * rn(); const k = seen[key]; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k); } g.computeVertexNormals(); return g; })(); // roca irregular (vértices desplazados de forma coherente)
    const rockMat = (col = 0xffffff) => new THREE.MeshStandardMaterial({ color: col, flatShading: true, roughness: 0.95, metalness: 0.08, emissive: 0x14100c, emissiveIntensity: 0.35 }), dm = new THREE.Object3D(), tc = new THREE.Color(), grey = new THREE.Color(0x6f6357);
    const zones = ZT.map(t => { // cada yacimiento es la agrupación REAL de asteroides de su zona (mismas celdas que el juego), teñida con los colores de sus recursos, con un halo suave
      const rocks = fields.zoneRocks(t.zone), d = t.zone.dominant, cA = new THREE.Color(RES[d[0].type]), cB = new THREE.Color(RES[(d[1] || d[0]).type]), g = new THREE.Group(), im = new THREE.InstancedMesh(rockGeo, rockMat(), Math.max(1, rocks.length)); let sd = 31 + t.zi * 977; const rn = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
      rocks.forEach((q, i) => { const sz = 0.03 + 0.085 * Math.pow(q[3], 0.7); dm.position.set(q[0], q[1] * 0.7, q[2]); dm.rotation.set(rn() * 6, rn() * 6, rn() * 6); dm.scale.set(sz * (0.75 + rn() * 0.6), sz * (0.6 + rn() * 0.5), sz * (0.75 + rn() * 0.6)); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
        const nug = rn() < 0.22; tc.copy(grey).lerp(rn() < 0.65 ? cA : cB, nug ? 0.85 : 0.3).multiplyScalar(nug ? 1.15 : 0.75 + rn() * 0.4); im.setColorAt(i, tc); }); im.count = rocks.length;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: cA, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32 })); halo.scale.setScalar(2.6); g.add(im, halo); g.scale.setScalar(zoneR(t.zone)); sc.add(g);
      return { t, m: g, im, halo, p: new THREE.Vector3() };
    });
    const mk = (geo, col) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col })); sc.add(m); return m; };
    const oct = new THREE.OctahedronGeometry(1, 0), neu = new THREE.InstancedMesh(oct, new THREE.MeshBasicMaterial({ color: 0xffffff }), 48), neuO = new THREE.InstancedMesh(oct, new THREE.MeshBasicMaterial({ color: 0xf4fff0, side: THREE.BackSide }), 48); // naves neutrales: rombos (2 draw calls para todas) con contorno claro
    neu.setColorAt(0, tc.setScalar(1)); neu.count = neuO.count = 0; neu.frustumCulled = neuO.frustumCulled = false; sc.add(neu, neuO);
    sys = { sc, cam, objs, zones, me: mk(new THREE.ConeGeometry(0.09, 0.3, 10), 0x4db8ff), foes: [], bases: [], mk, neu, neuO, dm, tc };
    resize();
  }
  function dpos(b, out) { // posición en el mapa: planetas y estrella en su sitio real; las lunas se acercan a su planeta para verse
    if (b.k === 'sun') return out.set(0, 0, 0);
    if (!b.parent) return out.set(b.pos[0] * K, 0, b.pos[2] * K);
    const p = b.parent, dx = b.pos[0] - p.pos[0], dz = b.pos[2] - p.pos[2], l = Math.hypot(dx, dz) || 1, r = moonOrbitR(b);
    return out.set(p.pos[0] * K + dx / l * r, 0, p.pos[2] * K + dz / l * r);
  }
  function zpos(t, out) { // zona anclada a un planeta: junto a él (fuera de su esfera exagerada, en la dirección real); del cinturón: en su sitio real
    const z = t.zone; if (!z.anchor) return out.set(t.pos[0] * K, t.pos[1] * K, t.pos[2] * K);
    const b = bodies[z.anchor], l = Math.hypot(z.off[0], z.off[1], z.off[2]) || 1; dpos(b, out); return out.add(vTmp2.set(z.off[0] / l, z.off[1] / l, z.off[2] / l).multiplyScalar(dispR(b) * 2.4));
  }
  function entityPos(P, out) { // un punto del espacio real -> mapa (junto al cuerpo más cercano si está cerca de él)
    let best = null, bd = 1e30; for (const b of bodies) { const d = Math.hypot(P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]); if (d < bd) { bd = d; best = b; } }
    if (best && bd < best.R * 40 + 5e4 && best.k !== 'sun') { const v = new THREE.Vector3(P[0] - best.pos[0], P[1] - best.pos[1], P[2] - best.pos[2]).normalize(); dpos(best, out); return out.addScaledVector(v, dispR(best) * (1.5 + Math.min(1.5, (bd - best.R) / (best.R * 40)))); }
    return out.set(P[0] * K, P[1] * K, P[2] * K);
  }
  const vTmp = new THREE.Vector3(), vTmp2 = new THREE.Vector3();

  // ---------- cámara libre ----------
  const lookAt = (target, inst) => { const d = vTmp2.copy(target).sub(st.pos), yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); if (inst) { st.yaw = yaw; st.pitch = pitch; } return { yaw, pitch }; };
  function flyTo(target, dist, inst) { // coloca la cámara delante del objetivo (con la orientación actual) mirándolo
    const fw = new THREE.Vector3(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)), pos = target.clone().addScaledVector(fw, -dist).add(new THREE.Vector3(0, dist * 0.55, 0));
    if (inst) { st.pos.copy(pos); lookAt(target, true); st.goal = null; } else st.goal = { pos, look: target.clone() };
  }
  function focusMe() { st.follow = true; st.goal = null; st.yaw = RTS_YAW; st.pitch = RTS_PITCH; } // C: recentra en tu nave y vuelve a seguirla (vista RTS)
  const vF = new THREE.Vector3();
  function follow() { // cámara RTS sobre tu nave: alta, mirando en diagonal, a st.dist de ella
    entityPos(S.pos, vF); const cp = Math.cos(st.pitch); st.pos.set(vF.x + Math.sin(st.yaw) * cp * st.dist, vF.y - Math.sin(st.pitch) * st.dist, vF.z + Math.cos(st.yaw) * cp * st.dist);
  }
  const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  function moveCam(dt) {
    const k = st.keys, fast = k.ShiftLeft || k.ShiftRight ? 4 : 1, sp = Math.max(0.4, Math.min(80, Math.abs(st.pos.y) * 1.2 + 0.4)) * fast * dt; // más alto = más rápido
    const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw), mv = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) mv.x += fx, mv.z += fz; if (k.KeyS || k.ArrowDown) mv.x -= fx, mv.z -= fz;
    if (k.KeyD || k.ArrowRight) mv.x -= fz, mv.z += fx; if (k.KeyA || k.ArrowLeft) mv.x += fz, mv.z -= fx;
    if (k.KeyE) mv.y += 1; if (k.KeyQ) mv.y -= 1;
    if (mv.lengthSq()) { st.goal = null; st.follow = false; st.pos.addScaledVector(mv.normalize(), sp); } // mover a mano: modo libre
    if (st.goal) { const a = 1 - Math.exp(-dt * 5), la = lookAt(st.goal.look); st.pos.lerp(st.goal.pos, a); st.yaw = angLerp(st.yaw, la.yaw, a); st.pitch += (la.pitch - st.pitch) * a; if (st.pos.distanceTo(st.goal.pos) < 1e-3) st.goal = null; }
    if (st.pos.length() > 600) st.pos.setLength(600);
  }

  // ---------- ficha (clic en un planeta o una zona) ----------
  const resList = res => res.filter(it => it.n > 0).map(it => `${it.n} ${it.type}`).join(', ');
  const icons = res => res.map(it => `<span class="cost${it.n ? '' : ' no'}"><i>${ICONS[it.type]}</i>${it.n}</span>`).join('');
  function zoneBlock(zi) {
    const z = ZONES[zi], res = zoneRes(zi), left = resList(res), sel = tgtObj() === ZT[zi], d = Math.max(0, Math.hypot(ZT[zi].pos[0] - S.pos[0], ZT[zi].pos[1] - S.pos[1], ZT[zi].pos[2] - S.pos[2]) - z.radius);
    return `<div class="zb"><b style="color:${RES[z.dominant[0].type]}">${z.name}</b><div>${left ? `Zona rica en ${z.dominant[0].type}: quedan ${left}` : 'Zona agotada: sus asteroides ya no dan recursos'}</div><div class="costs">${icons(res)}</div><small>${fD(d)} hasta su borde · radio ${fD(z.radius)}</small>
      <button data-z="${zi}"${sel ? ' disabled' : ''}>${sel ? 'Destino fijado ✔ (Shift: salto luz)' : 'Fijar como destino'}</button></div>`;
  }
  function renderCard() {
    const s = st.sel; if (!s) { card.hidden = true; return; }
    const sig = JSON.stringify([s.kind, s.i, ZR, S.tgt]); if (sig === st.cardSig && !card.hidden) return; st.cardSig = sig; card.hidden = false;
    if (s.kind === 'zone') { card.innerHTML = zoneBlock(s.i); return; }
    const b = bodies[s.i], d = Math.hypot(b.pos[0] - S.pos[0], b.pos[1] - S.pos[1], b.pos[2] - S.pos[2]) - b.R, zs = b.k === 'sun' ? [] : ZT.filter(t => t.zone.anchor === b.i), occ = BASES.find(x => x.body === b.n);
    card.innerHTML = `<h3>${b.n}</h3><small>${b.k === 'sun' ? 'estrella' : b.parent ? 'luna de ' + b.parent.n : (b.label || 'planeta')} · ${fD(Math.max(0, d))}${d > 1 ? ' · a 5 c: ' + fT(d / (5 * C)) : ''}${occ ? ' · hangar de ' + occ.owner : ''}</small>`
      + (zs.length ? zs.map(t => zoneBlock(t.zi)).join('') : '<div class="zb"><small>Sin zona de recursos cercana.</small></div>');
  }
  function select(p) { // p: punto del mapa bajo el cursor
    if (!p) { st.sel = null; renderCard(); return; }
    if (p.kind !== 'tú') st.follow = false;
    if (p.kind === 'zona') { const o = sys.zones[p.ref]; flyTo(o.p.clone(), Math.max(0.8, zoneR(o.t.zone) * 8)); st.sel = { kind: 'zone', i: p.ref }; }
    else if (p.body) { const o = sys.objs[p.ref]; flyTo(o.p.clone(), Math.max(1.4, dispR(o.b) * 5.5)); st.sel = { kind: 'body', i: p.ref }; }
    else if (p.kind === 'tú') { focusMe(false); st.sel = null; }
    renderCard();
  }

  function drawSys(dt) {
    ensureRenderer(); initSys(); moveCam(dt); if (st.follow) follow(); const W = c2.width, H = c2.height, cam = sys.cam, now = performance.now();
    cam.position.copy(st.pos); cam.rotation.set(st.pitch, st.yaw, 0);
    for (const o of sys.objs) { dpos(o.b, o.p); o.m.position.copy(o.p); o.m.rotation.y = o.b.k !== 'sun' ? now / 9000 + o.b.i : now / 30000; if (o.orbit && o.b.parent) o.orbit.position.set(o.b.parent.pos[0] * K, 0, o.b.parent.pos[2] * K); }
    const selZ = tgtObj() && tgtObj().zone ? tgtObj().zi : -1;
    for (const o of sys.zones) { zpos(o.t, o.p); o.m.position.copy(o.p); o.m.rotation.y = now / 4000; const res = zoneRes(o.t.zi), empty = res.every(it => !it.n); o.im.material.color.set(o.t.zi === selZ ? '#ffe27a' : empty ? '#556070' : '#ffffff'); o.halo.material.opacity = empty ? 0.08 : o.t.zi === selZ ? 0.5 : 0.32; o.m.scale.setScalar(zoneR(o.t.zone) * (o.t.zi === selZ ? 1 + 0.12 * Math.sin(now / 200) : 1)); }
    // marcadores: yo, otros jugadores y hangares
    entityPos(S.pos, sys.me.position); { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q); sys.me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f); sys.me.scale.setScalar(0.7 + 0.25 * Math.sin(now / 250)); }
    const os = others(); while (sys.foes.length < os.length) sys.foes.push(sys.mk(new THREE.ConeGeometry(0.08, 0.26, 8), 0xff6a3c));
    sys.foes.forEach((m, i) => { m.visible = i < os.length; if (i < os.length) { entityPos(os[i].apos, m.position); m.material.color.setHex(accent(os[i])); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1).applyQuaternion(os[i].q)); } });
    while (sys.bases.length < BASES.length) sys.bases.push(sys.mk(new THREE.BoxGeometry(0.06, 0.06, 0.06), 0xffffff));
    sys.bases.forEach((m, i) => { m.visible = i < BASES.length; if (i < BASES.length) { const bs = BASES[i], b = bodies.find(q => q.n === bs.body); if (!b) { m.visible = false; return; } dpos(b, m.position); m.position.add(new THREE.Vector3(Math.cos(bs.lat) * Math.cos(bs.lon), Math.sin(bs.lat), Math.cos(bs.lat) * Math.sin(bs.lon)).multiplyScalar(dispR(b) * 1.04)); } });
    const nl = typeof NEU !== 'undefined' ? [...NEU.E.values()].filter(n => n.w) : [], grs = new Map(), ngl = []; for (const n of nl) { if (!grs.has(n.g)) grs.set(n.g, []); grs.get(n.g).push(n); } // naves neutrales por grupo (estado 'nv' del servidor, o la simulación si soy el anfitrión)
    { let ni = 0; const { neu, neuO, dm, tc } = sys;
      for (const [gi, ms] of grs) {
        const c = [0, 0, 0]; for (const n of ms) for (let k = 0; k < 3; k++) c[k] += n.w[k] / ms.length;
        const cp = entityPos(c, new THREE.Vector3()), hos = ms.some(n => n.h), pul = 0.5 + 0.5 * Math.sin(now / 160), k = 0.035 * Math.max(1, cp.distanceTo(st.pos) * 0.04) * (hos ? 1 + 0.3 * pul : 1); // tamaño legible a cualquier zoom; las hostiles laten
        if (hos) tc.setRGB(1, 0.15 + 0.3 * pul, 0.12); else tc.setHSL(0.2 + (gi * 0.037) % 0.08, 0.95, 0.58); // tranquilas: verde amarillento (un matiz por grupo) · hostiles: rojo pulsante
        ms.forEach((n, i) => { if (ni >= 48) return; const a = i / ms.length * 6.2832, off = ms.length > 1 ? k * 1.8 : 0; dm.position.set(cp.x + Math.cos(a) * off, cp.y + k, cp.z + Math.sin(a) * off); dm.rotation.set(0, now / 700, 0); dm.scale.set(k, k * 1.4, k); dm.updateMatrix(); neu.setMatrixAt(ni, dm.matrix); neu.setColorAt(ni, tc); dm.scale.multiplyScalar(1.45); dm.updateMatrix(); neuO.setMatrixAt(ni, dm.matrix); ni++; });
        ngl.push({ p: cp, ms, hos, col: '#' + tc.getHexString(), k });
      }
      neu.count = neuO.count = ni; neu.instanceMatrix.needsUpdate = neuO.instanceMatrix.needsUpdate = true; if (neu.instanceColor) neu.instanceColor.needsUpdate = true;
    }
    pmr.render(sys.sc, cam); g.clearRect(0, 0, W, H);
    const pts = []; let hover = null, hd = 22; g.textAlign = 'left';
    const proj = v => { vTmp.copy(v).project(cam); if (vTmp.z > 1 || Math.abs(vTmp.x) > 1.05 || Math.abs(vTmp.y) > 1.05) return null; return [(vTmp.x * 0.5 + 0.5) * W, (-vTmp.y * 0.5 + 0.5) * H]; };
    const lab = (v, text, col, kind, pos, bold, extra) => { const s = proj(v); if (!s) return null; const [x, y] = s; g.font = `${bold ? 'bold ' : ''}12px ${MONO}`; g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(text, x + 10, y + 4); g.fillText(text, x + 10, y + 4); const p = { x, y, n: text, kind, pos, ...extra }; pts.push(p); return p; };
    sys.objs.forEach((o, i) => { const b = o.b, top = o.p.clone(); top.y += dispR(b) * 1.15; const occ = BASES.find(x => x.body === b.n); lab(top, b.n + (occ ? '  ⌂ ' + occ.owner : ''), b.k === 'sun' ? '#ffd166' : '#dff4ff', b.k === 'sun' ? 'estrella' : b.parent ? 'luna' : (b.label || 'planeta').toLowerCase(), b.pos, false, { body: true, ref: i }); });
    sys.zones.forEach((o, i) => { // zonas: nombre + iconos con lo que queda
      const res = zoneRes(o.t.zi), empty = res.every(it => !it.n), top = o.p.clone(); top.y += zoneR(o.t.zone) * 1.2;
      const p = lab(top, o.t.n + (empty ? ' · agotada' : ''), o.t.zi === selZ ? '#ffd23f' : empty ? '#8899aa' : RES[res[0].type], 'zona', o.t.pos, o.t.zi === selZ, { ref: i, res }); if (!p) return;
      let cx = p.x + 10; g.font = `bold 11px ${MONO}`; for (const it of res) { const im = icoImg(it.type); g.globalAlpha = it.n ? 1 : 0.35; if (im && im.complete && im.naturalWidth) g.drawImage(im, cx, p.y + 9, 14, 14); g.fillStyle = '#fff'; g.strokeText(String(it.n), cx + 16, p.y + 20); g.fillText(String(it.n), cx + 16, p.y + 20); cx += 26 + 7 * String(it.n).length; } g.globalAlpha = 1;
    });
    for (const q of ngl) { if (q.p.distanceTo(st.pos) > 9) continue; const lvs = q.ms.map(n => n.lv), l1 = Math.min(...lvs), l2 = Math.max(...lvs); lab(q.p.clone().add(new THREE.Vector3(0, q.k * 3.2, 0)), `${q.hos ? 'HOSTILES' : 'Neutrales'} · Nv ${l1 === l2 ? l1 : l1 + '-' + l2} · ${q.ms.length} naves`, q.hos ? '#ff5a4a' : q.col, 'grupo de naves neutrales', q.ms[0].w, q.hos); } // nivel al acercar el zoom
    lab(sys.me.position.clone().add(new THREE.Vector3(0, 0.25, 0)), myName + ' (tú)', '#4db8ff', 'tú', S.pos, true);
    os.forEach((r, i) => lab(sys.foes[i].position.clone().add(new THREE.Vector3(0, 0.22, 0)), r.name || 'Piloto', hex(accent(r)), 'jugador', r.apos, true));
    for (const p of pts) { const dd = Math.hypot(p.x - st.mx, p.y - st.my); if (dd < hd) { hd = dd; hover = p; } }
    if (hover && !st.drag) {
      const d = Math.hypot(hover.pos[0] - S.pos[0], hover.pos[1] - S.pos[1], hover.pos[2] - S.pos[2]), l2 = hover.kind === 'zona' ? (resList(hover.res) ? 'quedan ' + resList(hover.res) : 'agotada') : `${fD(d)}${d > 1 ? ' · a 5 c: ' + fT(d / (5 * C)) : ''}`;
      g.fillStyle = 'rgba(0,10,20,0.85)'; g.fillRect(hover.x + 14, hover.y + 26, 300, 48); g.fillStyle = '#fff'; g.font = `bold 12px ${MONO}`; g.fillText(`${hover.n} · ${hover.kind}`, hover.x + 20, hover.y + 42); g.font = `11px ${MONO}`; g.fillStyle = '#9fd4ee'; g.fillText(hover.body || hover.kind === 'zona' ? l2 + ' · clic: ficha' : l2, hover.x + 20, hover.y + 60);
    }
    const nz = ZT.filter(t => zoneRes(t.zi).every(it => !it.n)).length;
    g.textAlign = 'right'; g.font = `11px ${MONO}`; g.fillStyle = '#7fb6d4'; g.fillText(`Cuerpos: ${bodies.length - 1} · Zonas de recursos: ${ZT.length}${nz ? ` (${nz} agotadas)` : ''} · Jugadores aparte de ti: ${os.length} · Hangares: ${BASES.length} · Neutrales: ${nl.length}${nl.some(n => n.h) ? ` (${nl.filter(n => n.h).length} hostiles)` : ''}`, W - 24, 30);
    g.textAlign = 'center'; g.fillText(`${st.follow ? 'SIGUIENDO TU NAVE · Rueda: acercar/alejar · ' : 'Rueda: acercar al cursor · '}Arrastrar: desplazarse · Clic der. + arrastrar: mirar · WASD/flechas: mover · E/Q: subir/bajar · Shift: rápido · Clic: ficha · C: centrar y seguir tu nave · M / Esc: cerrar`, W / 2, H - 18);
    st.hover = pts; if (st.sel) renderCard();
  }
  function loop() { if (!st.open) return; requestAnimationFrame(loop); const now = performance.now(), dt = Math.min(0.1, (now - st.t) / 1000); st.t = now; drawSys(dt); }

  // ---------- entrada ----------
  addEventListener('keydown', e => { // en fase de captura: con el mapa abierto la nave no recibe teclas
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyM' && !e.repeat) { if (!st.open && ov.style.display !== 'none') return; e.preventDefault(); e.stopImmediatePropagation(); st.open ? close() : open(); return; }
    if (!st.open) return; e.stopImmediatePropagation(); if (e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Escape') close(); else if (e.code === 'KeyC') focusMe(); else st.keys[e.code] = true;
  }, true);
  addEventListener('keyup', e => { st.keys[e.code] = false; }, true);
  root.addEventListener('click', e => {
    const zb = e.target.closest('[data-z]'); if (zb) { const zi = +zb.dataset.z; S.tgt = bodies.length + zi; S.lockB = null; say(`Destino fijado: ${ZONES[zi].name} · Shift: salto luz`); st.cardSig = ''; renderCard(); return; } // fijar la zona como destino del salto luz
    if (e.target.closest('.mc, .mh') || st.moved >= 5 || !sys) return;
    let best = null, bd = 26; for (const p of st.hover) { const d = Math.hypot(p.x - e.clientX, p.y - e.clientY); if (d < bd) { bd = d; best = p; } }
    select(best);
  });
  root.addEventListener('wheel', e => { // acercar/alejar hacia el punto bajo el cursor
    e.preventDefault(); if (!sys) return; st.goal = null;
    if (st.follow) { st.dist = Math.max(0.35, Math.min(DIST_MAX, st.dist * (e.deltaY < 0 ? 0.85 : 1 / 0.85))); return; } // siguiendo tu nave: acerca/aleja sobre ella (hasta ver todo el sistema)
    const ray = new THREE.Raycaster(); ray.setFromCamera({ x: e.clientX / innerWidth * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 }, sys.cam);
    const dir = ray.ray.direction, hit = dir.y * st.pos.y < 0 ? -st.pos.y / dir.y : Math.abs(st.pos.y) + 2, step = Math.min(hit, 300) * 0.18 * (e.deltaY < 0 ? 1 : -1);
    st.pos.addScaledVector(dir, step); if (st.pos.length() > 600) st.pos.setLength(600);
  }, { passive: false });
  root.addEventListener('mousedown', e => { if (e.target.closest('.mh, .mc')) return; st.drag = [e.clientX, e.clientY]; st.btn = e.button === 2 || e.ctrlKey ? 2 : 0; st.moved = 0; });
  addEventListener('mouseup', () => st.drag = null);
  addEventListener('mousemove', e => {
    if (!st.open) return; st.mx = e.clientX; st.my = e.clientY; if (!st.drag) return;
    const dx = e.clientX - st.drag[0], dy = e.clientY - st.drag[1]; st.drag = [e.clientX, e.clientY]; st.moved += Math.abs(dx) + Math.abs(dy); if (st.moved < 5) return; st.goal = null; st.follow = false;
    if (st.btn === 2) { st.yaw -= dx * 0.005; st.pitch = Math.max(-1.55, Math.min(1.55, st.pitch - dy * 0.005)); return; } // mirar
    const k = (Math.abs(st.pos.y) + 0.5) * 0.0022, fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw); // desplazarse: se arrastra el plano del sistema
    st.pos.x += (-dx * -fz + dy * fx) * k; st.pos.z += (-dx * fx + dy * fz) * k;
  });
  return { open, close, BASES, warm: b => bodyTex(b), st }; // warm: genera la textura base del cuerpo (pantalla de carga); la comparten la esfera del espacio, el radar y este mapa
})();
