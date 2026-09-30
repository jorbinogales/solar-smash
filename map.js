// Mapa del sistema (tecla M): mapa 3D con los planetas (su textura), órbitas, zonas de recursos, jugadores y hangares (BASES).
// Cámara libre: se puede ir a cualquier punto del sistema. Clic en un planeta o zona: enfocarlo y ver su ficha (y fijar una zona como destino del salto luz).
// Usa bodies, remotes, S, ZONES, ZT, zoneRes, tgtObj, myName... de game.js.
const BASES = []; // { owner, name, body: nombre del planeta, lat, lon } (radianes): los rellena base.js con los hangares del servidor
const MAP = (() => {
  const root = document.createElement('div'); root.id = 'map';
  root.innerHTML = '<div class="mh"><b>MAPA DEL SISTEMA</b></div><canvas class="m2"></canvas><div class="mc" hidden></div><button class="mfol" hidden style="position:absolute;left:50%;bottom:46px;transform:translateX(-50%);z-index:3;padding:10px 18px;border:3px solid #050f1c;border-bottom-width:5px;border-radius:12px;background:#4db8ff;color:#050f1c;font:900 14px ui-monospace,Consolas,monospace;letter-spacing:.12em;box-shadow:4px 4px 0 #050f1c;cursor:pointer">MOSTRAR POSICIÓN ACTUAL</button>'; // el canvas 3D (.m3) se crea al abrir el mapa y se destruye al cerrarlo: así no queda un segundo contexto WebGL en memoria durante la partida
  document.body.append(root);
  const c2 = root.querySelector('.m2'), g = c2.getContext('2d'), card = root.querySelector('.mc'), fol = root.querySelector('.mfol'); // fol: botón «MOSTRAR POSICIÓN ACTUAL» (solo en modo libre)
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
  function close() { st.place = null; st.ghost = null; st.open = false; window.MAPOPEN = false; root.style.display = 'none'; st.keys = {}; st.drag = null; st.sel = null; card.hidden = true; releaseRenderer(); renderer.domElement.requestPointerLock(); }
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
    const sig = JSON.stringify([s.kind, s.i, ZR, S.tgt, s.kind === 'cz' ? [WAR.CZS[s.i], WAR.look(s.i).txt] : 0]); if (sig === st.cardSig && !card.hidden) return; st.cardSig = sig; card.hidden = false;
    if (s.kind === 'zone') { card.innerHTML = zoneBlock(s.i); return; }
    const b = bodies[s.i], d = Math.hypot(b.pos[0] - S.pos[0], b.pos[1] - S.pos[1], b.pos[2] - S.pos[2]) - b.R, zs = b.k === 'sun' || typeof WAR === 'undefined' ? [] : ZT.filter(t => t.zone.cz === czAt(SYS, WAR.CZ, b.pos)), occ = BASES.find(x => x.body === b.n);
    card.innerHTML = `<h3>${b.n}</h3><small>${b.k === 'sun' ? 'estrella' : b.parent ? 'luna de ' + b.parent.n : (b.label || 'planeta')} · ${fD(Math.max(0, d))}${d > 1 ? ' · a 5 c: ' + fT(d / (5 * C)) : ''}${occ ? ' · hangar de ' + occ.owner : ''}</small>`
      + (zs.length ? zs.map(t => zoneBlock(t.zi)).join('') : '<div class="zb"><small>Sin zona de recursos cercana.</small></div>');
  }
  function select(p) { // p: punto del mapa bajo el cursor
    if (!p) { st.sel = null; renderCard(); return; }
    if (p.kind !== 'tú') st.follow = false;
    if (p.cz !== undefined) { const z = WAR.CZ[p.cz], c = czCenter(z); flyTo(new THREE.Vector3(c[0] * K, 0, c[2] * K), Math.max(1.2, Math.min(30, (z.r1 === Infinity ? z.r0 * 0.5 : z.r1 - z.r0) * K * 2))); st.sel = { kind: 'cz', i: p.cz }; renderCard(); return; } // zona de control: su ficha
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
    pmr.render(sys.sc, cam); g.clearRect(0, 0, W, H); fol.hidden = st.follow;
    const pts = [], LQ = []; let hover = null, hd = 22; g.textAlign = 'left';
    const fs = Math.round(Math.max(10, Math.min(14, 14 - Math.log2(Math.max(1, Math.abs(st.pos.y) / 1.5))))); // tamaño de las etiquetas según el zoom
    const proj = v => { vTmp.copy(v).project(cam); if (vTmp.z > 1 || Math.abs(vTmp.x) > 1.05 || Math.abs(vTmp.y) > 1.05) return null; return [(vTmp.x * 0.5 + 0.5) * W, (-vTmp.y * 0.5 + 0.5) * H]; };
    const queue = (x, y, text, col, pri, o = {}) => { const size = o.size || fs; g.font = `${o.bold ? 'bold ' : ''}${size}px ${MONO}`; LQ.push({ x: x + (o.dx ?? 10), y: y + (o.dy ?? 4), w: g.measureText(text).width + (o.extraW || 0), h: size + 4 + (o.h2 || 0), size, text, col, pri, bold: o.bold, after: o.after, center: o.center }); }; // cola de etiquetas: se dibujan al final por prioridad y sin solaparse
    const lab = (v, text, col, kind, pos, bold, extra, pri = 5, o = {}) => { const s = proj(v); if (!s) return null; const [x, y] = s; queue(x, y, text, col, pri, { bold, ...o }); const p = { x, y, n: text, kind, pos, ...extra }; pts.push(p); return p; };
    // ---------- cursor sobre un planeta, luna, estrella o cúmulo: brillo verde pulsante y ficha junto al cursor (radio proyectado + margen; el más cercano a la cámara) ----------
    const camUp = vTmp2.set(0, 1, 0).applyQuaternion(cam.quaternion).clone(), scrR = (c, r) => { const p0 = proj(c), p1 = proj(camUp.clone().multiplyScalar(r).add(c)); return p0 && p1 ? [p0, Math.max(6, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]))] : null; };
    let hv = null;
    if (!st.drag) { // también en el modo colocación: planeta → despliegue junto al planeta · cúmulo → junto al cúmulo
      sys.objs.forEach((o, i) => { const q = scrR(o.p, dispR(o.b)); if (q && Math.hypot(q[0][0] - st.mx, q[0][1] - st.my) < q[1] + 6) { const dep = o.p.distanceTo(st.pos); if (!hv || dep < hv.dep) hv = { dep, s: q[0], r: q[1], kind: 'b', i, o }; } });
      sys.zones.forEach((o, i) => { const q = scrR(o.p, zoneR(o.t.zone) * 1.3); if (q && Math.hypot(q[0][0] - st.mx, q[0][1] - st.my) < q[1] + 6) { const dep = o.p.distanceTo(st.pos); if (!hv || dep < hv.dep) hv = { dep, s: q[0], r: q[1], kind: 'z', i, o }; } });
    }
    st.hv = hv;
    if (typeof WAR !== 'undefined') { try { czDraw(pts, now, queue); } catch (err) { if (!st.czErr) { st.czErr = 1; console.warn('mapa: zonas de control', err); } } } // un fallo en las zonas nunca debe dejar el mapa sin textos
    if (hv) { const pul = 0.5 + 0.5 * Math.sin(now / 220); g.save(); g.shadowColor = '#5dff8a'; g.shadowBlur = 12 + 12 * pul; g.strokeStyle = `rgba(93,255,138,${0.55 + 0.45 * pul})`; g.lineWidth = 3; g.beginPath(); g.arc(hv.s[0], hv.s[1], hv.r + 5, 0, 7); g.stroke(); g.lineWidth = 1.5; g.globalAlpha = 0.5; g.beginPath(); g.arc(hv.s[0], hv.s[1], hv.r + 10 + 3 * pul, 0, 7); g.stroke(); g.restore(); }
    // ---------- etiquetas ----------
    sys.objs.forEach((o, i) => { const b = o.b, top = o.p.clone(); top.y += dispR(b) * 1.15; const occ = BASES.find(x => x.body === b.n); lab(top, b.n + (occ ? '  ⌂ ' + occ.owner : ''), b.k === 'sun' ? '#ffd166' : '#dff4ff', b.k === 'sun' ? 'estrella' : b.parent ? 'luna' : (b.label || 'planeta').toLowerCase(), b.pos, !b.parent, { body: true, ref: i }, b.parent ? 4 : 7); });
    sys.zones.forEach((o, i) => { // zonas de recursos: nombre + iconos con lo que queda
      const res = zoneRes(o.t.zi), empty = res.every(it => !it.n), top = o.p.clone(); top.y += zoneR(o.t.zone) * 1.2;
      lab(top, o.t.n + (empty ? ' · agotada' : ''), o.t.zi === selZ ? '#ffd23f' : empty ? '#8899aa' : RES[res[0].type], 'zona', o.t.pos, o.t.zi === selZ, { ref: i, res }, o.t.zi === selZ ? 8 : 5, { h2: 18, after: (lx, ly) => { let cx = lx; g.font = `bold 11px ${MONO}`; g.lineWidth = 3; for (const it of res) { const im = icoImg(it.type); g.globalAlpha = it.n ? 1 : 0.35; if (im && im.complete && im.naturalWidth) g.drawImage(im, cx, ly + 5, 14, 14); g.fillStyle = '#fff'; g.strokeText(String(it.n), cx + 16, ly + 16); g.fillText(String(it.n), cx + 16, ly + 16); cx += 26 + 7 * String(it.n).length; } g.globalAlpha = 1; } });
    });
    for (const q of ngl) { if (q.p.distanceTo(st.pos) > 9) continue; const lvs = q.ms.map(n => n.lv), l1 = Math.min(...lvs), l2 = Math.max(...lvs); lab(q.p.clone().add(new THREE.Vector3(0, q.k * 3.2, 0)), `${q.hos ? 'HOSTILES' : 'Neutrales'} · Nv ${l1 === l2 ? l1 : l1 + '-' + l2} · ${q.ms.length} naves`, q.hos ? '#ff5a4a' : q.col, 'grupo de naves neutrales', q.ms[0].w, q.hos, {}, q.hos ? 6 : 4); } // nivel al acercar el zoom
    os.forEach((r, i) => lab(sys.foes[i].position.clone().add(new THREE.Vector3(0, 0.22, 0)), r.name || 'Piloto', hex(accent(r)), 'jugador', r.apos, true, {}, 8));
    { const s0 = proj(sys.me.position); if (s0) pts.push({ x: s0[0], y: s0[1], n: myName + ' (tú)', kind: 'tú', pos: S.pos }); } // la etiqueta «TÚ» la dibuja su icono
    LQ.sort((a, b) => b.pri - a.pri); const placed = [];
    for (const L of LQ) { // de mayor a menor prioridad; las que tapan a otra más importante no se dibujan (solo las de prioridad ≥ 9 se dibujan siempre)
      const rx = L.center ? L.x - L.w / 2 : L.x, ry = L.y - L.size, rw = L.w, rh = L.h;
      if (L.pri < 9 && placed.some(r => rx < r[0] + r[2] && rx + rw > r[0] && ry < r[1] + r[3] && ry + rh > r[1])) continue; placed.push([rx, ry, rw, rh]);
      g.textAlign = L.center ? 'center' : 'left'; g.font = `${L.bold ? 'bold ' : ''}${L.size}px ${MONO}`; g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = '#050f1c'; g.fillStyle = L.col; g.strokeText(L.text, L.x, L.y); g.fillText(L.text, L.x, L.y); if (L.after) L.after(L.x, L.y);
    }
    g.textAlign = 'left';
    // ---------- SIEMPRE: icono de MI BASE y de MI NAVE (con su rumbo); fuera de la vista, flecha en el borde ----------
    const pin = (v, label, icon) => {
      const cs = v.clone().applyMatrix4(cam.matrixWorldInverse); let x = 0, y = 0, on = false;
      if (cs.z < -0.01) { const q = cs.clone().applyMatrix4(cam.projectionMatrix); x = (q.x * 0.5 + 0.5) * W; y = (-q.y * 0.5 + 0.5) * H; on = x > 26 && x < W - 26 && y > 60 && y < H - 50; }
      if (on) { icon(x, y, 1); g.textAlign = 'center'; g.font = `900 12px ${MONO}`; g.lineWidth = 4; g.strokeStyle = '#050f1c'; g.fillStyle = '#9fd8ff'; g.strokeText(label, x, y + 28); g.fillText(label, x, y + 28); g.textAlign = 'left'; return; }
      let dx = cs.z < -0.01 ? x - W / 2 : cs.x, dy = cs.z < -0.01 ? y - H / 2 : -cs.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const k = Math.min((W / 2 - 50) / Math.max(1e-6, Math.abs(dx)), (H / 2 - 76) / Math.max(1e-6, Math.abs(dy))), ex = W / 2 + dx * k, ey = H / 2 + dy * k;
      g.save(); g.translate(ex, ey); g.rotate(Math.atan2(dy, dx)); g.beginPath(); g.moveTo(22, 0); g.lineTo(8, -10); g.lineTo(8, 10); g.closePath(); g.fillStyle = '#4db8ff'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#050f1c'; g.stroke(); g.restore();
      icon(ex - dx * 8, ey - dy * 8, 0.75); g.textAlign = 'center'; g.font = `900 11px ${MONO}`; g.lineWidth = 4; g.strokeStyle = '#050f1c'; g.fillStyle = '#9fd8ff'; const ty = ey - dy * 8 + (dy > 0.5 ? -22 : 26); g.strokeText(label, ex - dx * 8, ty); g.fillText(label, ex - dx * 8, ty); g.textAlign = 'left';
    };
    const mb = typeof BASE !== 'undefined' ? BASE.mine() : null, bb = mb && bodies.find(q => q.n === mb.b);
    if (bb) { const vb = dpos(bb, new THREE.Vector3()).add(new THREE.Vector3(Math.cos(mb.la) * Math.cos(mb.lo), Math.sin(mb.la), Math.cos(mb.la) * Math.sin(mb.lo)).multiplyScalar(dispR(bb) * 1.04));
      pin(vb, 'TU BASE', (x, y, k) => { g.save(); g.translate(x, y); g.scale(k, k); g.beginPath(); g.moveTo(0, -14); g.lineTo(14, -2); g.lineTo(10, -2); g.lineTo(10, 11); g.lineTo(-10, 11); g.lineTo(-10, -2); g.lineTo(-14, -2); g.closePath(); g.fillStyle = '#4db8ff'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#050f1c'; g.stroke(); g.fillStyle = '#050f1c'; g.fillRect(-3, 3, 6, 8); g.restore(); }); }
    { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q), p0 = proj(sys.me.position), p1 = proj(sys.me.position.clone().addScaledVector(f, 0.3)), ang = p0 && p1 ? Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) : -Math.PI / 2;
      pin(sys.me.position, 'TÚ', (x, y, k) => { g.save(); g.translate(x, y); g.rotate(ang); g.scale(k, k); g.beginPath(); g.moveTo(16, 0); g.lineTo(-10, -11); g.lineTo(-5, 0); g.lineTo(-10, 11); g.closePath(); g.fillStyle = '#4db8ff'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#050f1c'; g.stroke(); g.restore(); }); }
    for (const p of pts) { const dd = Math.hypot(p.x - st.mx, p.y - st.my); if (dd < hd) { hd = dd; hover = p; } }
    const panel = (x, y, lines) => { g.save(); g.font = `bold 12px ${MONO}`; const w = Math.max(...lines.map(([t]) => g.measureText(t).width)) + 22, h = lines.length * 16 + 12; x = Math.min(x, W - w - 8); y = Math.min(y, H - h - 8); g.fillStyle = '#050f1c'; g.fillRect(x + 4, y + 4, w, h); g.fillStyle = '#0b2233f0'; g.fillRect(x, y, w, h); g.lineWidth = 3; g.strokeStyle = '#050f1c'; g.strokeRect(x, y, w, h); lines.forEach(([t, c, b], i) => { g.font = `${b ? 'bold ' : ''}${b ? 12 : 11}px ${MONO}`; g.fillStyle = c; g.fillText(t, x + 11, y + 20 + i * 16); }); g.restore(); }; // ficha junto al cursor (pegatina)
    if (hv && !st.drag) {
      if (hv.kind === 'b') { const b = hv.o.b, d = Math.hypot(b.pos[0] - S.pos[0], b.pos[1] - S.pos[1], b.pos[2] - S.pos[2]) - b.R, occ = BASES.find(x => x.body === b.n), zi = typeof WAR !== 'undefined' ? czAt(SYS, WAR.CZ, b.pos) : -1;
        panel(st.mx + 18, st.my + 18, [[b.n, '#5dff8a', 1], [b.k === 'sun' ? 'Estrella' : b.parent ? 'Luna de ' + b.parent.n : (b.label || 'Planeta'), '#9fd4ee'], [`Radio ${Math.round(b.R).toLocaleString('es')} km · a ${fD(Math.max(0, d))} de ti`, '#dff4ff'], ...(occ ? [[`Hangar de ${occ.owner}`, occ.owner === myName ? '#4db8ff' : '#ff8a6a']] : []), ...(zi >= 0 ? [[`Zona: ${WAR.owner(zi)}`, WAR.look(zi).col]] : []), ['Clic: ficha', '#7fb6d4']]); }
      else { const t = hv.o.t, res = zoneRes(t.zi), left = resList(res), d = Math.max(0, Math.hypot(t.pos[0] - S.pos[0], t.pos[1] - S.pos[1], t.pos[2] - S.pos[2]) - t.zone.radius);
        panel(st.mx + 18, st.my + 18, [[t.n, '#5dff8a', 1], ['Cúmulo de recursos', '#9fd4ee'], [left ? 'Quedan: ' + left : 'Agotado: ya no da recursos', left ? '#ffd23f' : '#8899aa'], [`Radio ${fD(t.zone.radius)} · ${fD(d)} hasta su borde`, '#dff4ff'], ['Clic: ficha', '#7fb6d4']]); }
    } else if (hover && hd < 22 && !st.drag) {
      const d = Math.hypot(hover.pos[0] - S.pos[0], hover.pos[1] - S.pos[1], hover.pos[2] - S.pos[2]), l2 = hover.kind === 'zona' ? (resList(hover.res) ? 'quedan ' + resList(hover.res) : 'agotada') : `${fD(d)}${d > 1 ? ' · a 5 c: ' + fT(d / (5 * C)) : ''}`;
      panel(hover.x + 14, hover.y + 22, [[`${hover.n} · ${hover.kind}`, '#fff', 1], [hover.body || hover.kind === 'zona' || hover.cz !== undefined ? l2 + ' · clic: ficha' : l2, '#9fd4ee']]);
    }
    else if (typeof WAR !== 'undefined' && st.czHz >= 0 && !st.drag && !st.place) { const zo = WAR.owner(st.czHz), col = WAR.look(st.czHz).col; g.save(); g.font = `bold 12px ${MONO}`; const w = g.measureText(zo).width + 18; g.fillStyle = '#050f1c'; g.fillRect(st.mx + 17, st.my + 17, w, 22); g.fillStyle = '#0b2233f0'; g.fillRect(st.mx + 14, st.my + 14, w, 22); g.lineWidth = 2; g.strokeStyle = col; g.strokeRect(st.mx + 14, st.my + 14, w, 22); g.fillStyle = col; g.fillText(zo, st.mx + 23, st.my + 29); g.restore(); } // zona bajo el cursor: solo a quién pertenece
    const nz = ZT.filter(t => zoneRes(t.zi).every(it => !it.n)).length;
    g.textAlign = 'right'; g.font = `11px ${MONO}`; g.lineWidth = 3; g.strokeStyle = '#050f1c'; g.fillStyle = '#7fb6d4'; const tr = `Cuerpos: ${bodies.length - 1} · Zonas de recursos: ${ZT.length}${nz ? ` (${nz} agotadas)` : ''} · Jugadores aparte de ti: ${os.length} · Hangares: ${BASES.length} · Neutrales: ${nl.length}${nl.some(n => n.h) ? ` (${nl.filter(n => n.h).length} hostiles)` : ''}`; g.strokeText(tr, W - 24, 30); g.fillText(tr, W - 24, 30);
    g.textAlign = 'center'; const ft = `${st.follow ? 'SIGUIENDO TU NAVE · Rueda: acercar/alejar · ' : 'Rueda: acercar al cursor · '}Arrastrar: desplazarse · Clic der. + arrastrar: mirar · WASD/flechas: mover · E/Q: subir/bajar · Shift: rápido · Clic: ficha · C: centrar y seguir tu nave · M / Esc: cerrar`; g.strokeText(ft, W / 2, H - 18); g.fillText(ft, W / 2, H - 18); // leyenda / pie
    st.hover = pts; if (st.sel) renderCard();
  }
  // ---------- zonas de control (estilo mapa galáctico de Helldivers): TESELAN todo el plano orbital en sectores anulares fijos respecto a la estrella ----------
  // relleno traslúcido + borde grueso #050f1c + borde de color (fronteras compartidas continuas), etiqueta en el centroide, zona bajo el cursor resaltada · modo colocación sobre el plano
  const czRay = new THREE.Raycaster(), czV = new THREE.Vector3();
  function czPoly(z) { // contorno del sector en unidades del mapa (cacheado): arco exterior + arco interior (el núcleo es un disco); los Confines se dibujan hasta 1,6 × su radio interior
    if (z._p) return z._p; const R = WAR.CZ.rings, r1 = z.r1 === Infinity ? R[R.length - 1].r0 * 1.6 : z.r1, seg = Math.max(2, Math.ceil(z.da / (Math.PI / 36))), p = [];
    for (let i = 0; i <= seg; i++) { const a = z.a0 + z.da * i / seg; p.push(new THREE.Vector3(Math.cos(a) * r1 * K, 0, Math.sin(a) * r1 * K)); }
    if (z.r0 > 0) for (let i = seg; i >= 0; i--) { const a = z.a0 + z.da * i / seg; p.push(new THREE.Vector3(Math.cos(a) * z.r0 * K, 0, Math.sin(a) * z.r0 * K)); }
    return (z._p = p);
  }
  function projPoly(ps) { // polígono del mapa -> pantalla, recortado contra el plano cercano de la cámara (las zonas son enormes: la cámara suele estar encima de una)
    const cam = sys.cam, NZ = -0.02, cs = ps.map(p => p.clone().applyMatrix4(cam.matrixWorldInverse)), out = [];
    for (let i = 0; i < cs.length; i++) { const p = cs[i], q = cs[(i + 1) % cs.length], pin = p.z < NZ, qin = q.z < NZ; if (pin) out.push(p); if (pin !== qin) out.push(p.clone().lerp(q, (NZ - p.z) / (q.z - p.z))); }
    return out.map(v => { v.applyMatrix4(cam.projectionMatrix); return [(v.x * 0.5 + 0.5) * c2.width, (-v.y * 0.5 + 0.5) * c2.height]; });
  }
  function projU(v) { vTmp.copy(v).project(sys.cam); return vTmp.z > 1 ? null : [(vTmp.x * 0.5 + 0.5) * c2.width, (-vTmp.y * 0.5 + 0.5) * c2.height]; }
  function czMouse() { // punto del plano orbital (km, y = 0) bajo el cursor, o null
    czRay.setFromCamera({ x: st.mx / c2.width * 2 - 1, y: -(st.my / c2.height) * 2 + 1 }, sys.cam); const o = czRay.ray.origin, d = czRay.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null; const t = -o.y / d.y; return t > 0 ? [(o.x + d.x * t) / K, 0, (o.z + d.z * t) / K] : null;
  }
  function czDraw(pts, now, Q) { // Q: cola de etiquetas de drawSys
    const pl = st.place, mp = czMouse(), hv0 = st.hv, tgt = hv0 ? (hv0.kind === 'b' ? (hv0.o.b.k === 'sun' ? null : { zi: czAt(SYS, WAR.CZ, hv0.o.b.pos), at: 'p' }) : { zi: hv0.o.t.zone.cz, at: 'c' }) : null; // elemento bajo el cursor (planeta o cúmulo) manda sobre la zona
    const hz = tgt && tgt.zi != null ? tgt.zi : mp ? czAt(SYS, WAR.CZ, mp) : -1, at = tgt ? tgt.at : 'c', pd = pl && hz >= 0 ? WAR.deploy(pl.k, hz, at) : null, plOk = !!pd && !pd.why, sz = st.sel && st.sel.kind === 'cz' ? st.sel.i : -1, P = [];
    g.save(); g.lineJoin = 'round';
    WAR.CZ.forEach((z, zi) => { const sp = projPoly(czPoly(z)); if (sp.length >= 3) P.push({ zi, sp, L: WAR.look(zi), hi: zi === hz || zi === sz }); });
    const path = sp => { g.beginPath(); sp.forEach(([x, y], k) => { if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
    for (const q of P) { path(q.sp); g.globalAlpha = q.hi ? 0.3 : q.L.cap ? 0.2 + 0.08 * Math.sin(now / 250) : q.L.sun ? 0.1 : 0.11; g.fillStyle = pl && q.zi === hz ? (plOk ? '#5dff8a' : '#ff3b30') : q.L.col; g.fill(); // en colocación, la zona bajo el cursor: verde válida / roja inválida g.globalAlpha = 1; g.lineWidth = 6; g.strokeStyle = '#050f1c'; g.stroke(); // 1.ª pasada: relleno y borde negro
      if (q.L.sun) { g.save(); g.clip(); const xs = q.sp.map(p => p[0]), ys = q.sp.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); g.strokeStyle = 'rgba(255,159,28,0.18)'; g.lineWidth = 6; g.beginPath(); for (let x = x0 - (y1 - y0); x < x1; x += 22) { g.moveTo(x, y1); g.lineTo(x + (y1 - y0), y0); } g.stroke(); g.restore(); } } // zona solar: franjas de peligro, no reclamable
    P.sort((x, y) => x.hi - y.hi); for (const q of P) { path(q.sp); g.lineWidth = q.hi ? 3.5 : 2; g.strokeStyle = q.L.col; if (q.L.cap) { g.setLineDash([12, 8]); g.lineDashOffset = -now / 30; } g.stroke(); g.setLineDash([]); } // 2.ª: borde de color (la resaltada encima)
    const ring = (Date.now() / 1000 % WARCFG.gain.every) / WARCFG.gain.every; // anillo de 10 s sincronizado con el reloj real (el servidor entrega al cambiar de franja)
    for (const q of P) { // SIN textos: en el centroide, icono del recurso que entrega + «+1» + anillo de 10 s (brillante en mis zonas, atenuado en las demás) y barra fina solo mientras se reclama
      const z = WAR.CZ[q.zi]; if (z.noClaim || !z.res) continue; const c = czCenter(z), sp = projU(czV.set(c[0] * K, 0, c[2] * K)); if (!sp || sp[0] < -60 || sp[0] > c2.width + 60 || sp[1] < -60 || sp[1] > c2.height + 60) continue;
      const xs = q.sp.map(p => p[0]), sz = Math.max(22, Math.min(44, (Math.max(...xs) - Math.min(...xs)) * 0.1)), mine = WAR.CZS[q.zi].o === myId, [cx, cy] = sp, im = icoImg(z.res), r = sz * 0.72;
      g.save(); g.globalAlpha = mine ? 1 : 0.5; g.beginPath(); g.arc(cx, cy, r + 3, 0, 7); g.fillStyle = '#050f1c'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
      g.strokeStyle = mine ? '#5dff8a' : '#9fb3c4'; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (mine ? ring : 1)); g.stroke(); // reloj de 10 s
      if (im && im.complete && im.naturalWidth) g.drawImage(im, cx - sz / 2, cy - sz / 2, sz, sz);
      g.font = `900 ${Math.round(sz * 0.5)}px ${MONO}`; g.textAlign = 'left'; g.lineWidth = 4; g.strokeStyle = '#050f1c'; g.fillStyle = mine ? '#c8ff5d' : '#dfe8ee'; const t = `+${WARCFG.gain.n}`; g.strokeText(t, cx + r + 6, cy + sz * 0.18); g.fillText(t, cx + r + 6, cy + sz * 0.18);
      g.font = `bold ${Math.round(sz * 0.32)}px ${MONO}`; g.lineWidth = 3; g.fillStyle = '#9fd4ee'; g.strokeText(`${WARCFG.gain.every}s`, cx + r + 6, cy + sz * 0.18 + sz * 0.4); g.fillText(`${WARCFG.gain.every}s`, cx + r + 6, cy + sz * 0.18 + sz * 0.4);
      if (q.L.cap) { g.globalAlpha = 1; g.fillStyle = '#050f1c'; g.fillRect(cx - 30, cy + r + 8, 60, 6); g.fillStyle = q.L.col; g.fillRect(cx - 29, cy + r + 9, 58 * q.L.p / 100, 4); } // progreso solo mientras se reclama
      g.restore();
    }
    st.czHz = hz; // zona bajo el cursor: drawSys muestra solo a quién pertenece
    for (const s of WAR.all()) { // buques (rombo grande) y satélites (pequeño) en su sitio real: están anclados a la estrella · azul míos, rojo ajenos
      if (!s.w) continue; const q = projU(czV.set(s.w[0] * K, 0, s.w[2] * K)); if (!q) continue; const mine = s.o === myId, col = mine ? '#4db8ff' : '#ff3b30', r = s.k === 'W' ? 8 : 5;
      g.beginPath(); g.moveTo(q[0], q[1] - r); g.lineTo(q[0] + r, q[1]); g.lineTo(q[0], q[1] + r); g.lineTo(q[0] - r, q[1]); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 3; g.strokeStyle = '#050f1c'; g.stroke();
      Q(q[0], q[1], `${s.k === 'W' ? 'BUQUE' : 'SATÉLITE'} · ${mine ? 'TUYO' : WAR.nmOf(s.o)}`, mine ? '#9fd8ff' : '#ff8a7a', 6, { bold: true, size: 10 });
      pts.push({ x: q[0], y: q[1], n: `${s.k === 'W' ? 'Buque' : 'Satélite'} de ${WAR.nmOf(s.o)}`, kind: s.k === 'W' ? 'buque de guerra' : 'satélite defensivo', pos: s.w });
    }
    st.ghost = null;
    if (pl) { // fantasma bajo el cursor: verde = válido, rojo = inválido (con el motivo); el clic lo confirma
      if (pd) { // la posición NO se elige: el buque/satélite va junto al cúmulo de la zona (sysgen.czDeployPoint); aquí se marca dónde caerá
        const col = plOk ? '#5dff8a' : '#ff3b30'; st.ghost = { zi: hz, why: pd.why, at };
        const q = pd.off && projU(czV.set(pd.off[0] * K, 0, pd.off[2] * K));
        if (q) { g.beginPath(); g.arc(q[0], q[1], 9 + 3 * Math.sin(now / 150), 0, 7); g.globalAlpha = 0.4; g.fillStyle = col; g.fill(); g.globalAlpha = 1; g.lineWidth = 5; g.strokeStyle = '#050f1c'; g.stroke(); g.lineWidth = 2; g.strokeStyle = col; g.stroke(); g.beginPath(); g.moveTo(q[0], q[1] - 6); g.lineTo(q[0] + 6, q[1]); g.lineTo(q[0], q[1] + 6); g.lineTo(q[0] - 6, q[1]); g.closePath(); g.fillStyle = col; g.fill(); g.setLineDash([5, 5]); g.beginPath(); g.moveTo(st.mx, st.my); g.lineTo(q[0], q[1]); g.stroke(); g.setLineDash([]); }
        g.textAlign = 'center'; g.font = `bold 12px ${MONO}`; g.lineWidth = 4; g.strokeStyle = '#000'; g.fillStyle = col; const tx = pd.why || `CLIC: ${pl.k === 'W' ? 'DESPLEGAR EL BUQUE' : pl.k === 'F' ? 'DESPLEGAR LOS CAZAS' : 'CONSTRUIR EL SATÉLITE'} JUNTO AL ${at === 'p' ? 'PLANETA' : 'CÚMULO'}`; g.strokeText(tx, st.mx, st.my + 30); g.fillText(tx, st.mx, st.my + 30);
      }
      const W = c2.width, tx = `${pl.k === 'W' ? 'DESPLIEGUE · BUQUE DE GUERRA' : pl.k === 'F' ? 'DESPLIEGUE · CAZAS' : 'CONSTRUCCIÓN · SATÉLITE DEFENSIVO'} — clic en una zona AZUL (tuya): sobre su planeta, junto al planeta; si no, junto a su cúmulo · Esc: cancelar`; g.font = `bold 13px ${MONO}`; const w = g.measureText(tx).width + 36;
      g.fillStyle = '#050f1c'; g.fillRect(W / 2 - w / 2 + 4, 52, w, 34); g.fillStyle = '#0b2233'; g.fillRect(W / 2 - w / 2, 48, w, 34); g.lineWidth = 3; g.strokeStyle = '#050f1c'; g.strokeRect(W / 2 - w / 2, 48, w, 34); g.textAlign = 'center'; g.fillStyle = '#ffd23f'; g.fillText(tx, W / 2, 70);
    }
    g.restore();
  }
  function placeClick() { const gh = st.ghost; if (!gh) return say('Elige un punto dentro de una zona de control tuya (azul)'); if (gh.why) return say(gh.why); send({ t: 'wdep', k: st.place.k, zi: gh.zi, at: gh.at }); close(); }
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
    if (st.place) { if (!e.target.closest('.mc, .mh') && st.moved < 5) placeClick(); return; } // modo colocación: el clic confirma la posición
    const zb = e.target.closest('[data-z]'); if (zb) { const zi = +zb.dataset.z; S.tgt = bodies.length + zi; S.lockB = null; say(`Destino fijado: ${ZONES[zi].name} · Shift: salto luz`); st.cardSig = ''; renderCard(); return; } // fijar la zona como destino del salto luz
    if (e.target.closest('.mc, .mh, .mfol') || st.moved >= 5 || !sys) return;
    let best = null, bd = 26; for (const p of st.hover) { const d = Math.hypot(p.x - e.clientX, p.y - e.clientY); if (d < bd) { bd = d; best = p; } }
    if (st.hv) best = st.hv.kind === 'b' ? { body: true, ref: st.hv.i, kind: 'planeta' } : { kind: 'zona', ref: st.hv.i }; // el planeta o cúmulo resaltado (brillo verde)
    select(best);
  });
  root.addEventListener('wheel', e => { // acercar/alejar hacia el punto bajo el cursor
    e.preventDefault(); if (!sys) return; st.goal = null;
    if (st.follow) { st.dist = Math.max(0.35, Math.min(DIST_MAX, st.dist * (e.deltaY < 0 ? 0.85 : 1 / 0.85))); return; } // siguiendo tu nave: acerca/aleja sobre ella (hasta ver todo el sistema)
    const ray = new THREE.Raycaster(); ray.setFromCamera({ x: e.clientX / innerWidth * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 }, sys.cam);
    const dir = ray.ray.direction, hit = dir.y * st.pos.y < 0 ? -st.pos.y / dir.y : Math.abs(st.pos.y) + 2, step = Math.min(hit, 300) * 0.18 * (e.deltaY < 0 ? 1 : -1);
    st.pos.addScaledVector(dir, step); if (st.pos.length() > 600) st.pos.setLength(600);
  }, { passive: false });
  root.addEventListener('mousedown', e => { if (e.target.closest('.mh, .mc, .mfol')) return; st.drag = [e.clientX, e.clientY]; st.btn = e.button === 2 || e.ctrlKey ? 2 : 0; st.moved = 0; });
  addEventListener('mouseup', () => st.drag = null);
  addEventListener('mousemove', e => {
    if (!st.open) return; st.mx = e.clientX; st.my = e.clientY; if (!st.drag) return;
    const dx = e.clientX - st.drag[0], dy = e.clientY - st.drag[1]; st.drag = [e.clientX, e.clientY]; st.moved += Math.abs(dx) + Math.abs(dy); if (st.moved < 5) return; st.goal = null; st.follow = false;
    if (st.btn === 2) { st.yaw -= dx * 0.005; st.pitch = Math.max(-1.55, Math.min(1.55, st.pitch - dy * 0.005)); return; } // mirar
    const k = (Math.abs(st.pos.y) + 0.5) * 0.0022, fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw); // desplazarse: se arrastra el plano del sistema
    st.pos.x += (-dx * -fz + dy * fx) * k; st.pos.z += (-dx * fx + dy * fz) * k;
  });
  fol.addEventListener('click', e => { e.stopPropagation(); focusMe(); }); // recentra en tu nave y vuelve al seguimiento (igual que C)
  const place = k => { st.place = { k }; st.sel = null; card.hidden = true; if (!st.open) open(); st.dist = 14; }; // abre el mapa en modo colocación de un buque (W) o de un satélite (S)
  return { open, close, place, BASES, warm: b => bodyTex(b), st }; // warm: genera la textura base del cuerpo (pantalla de carga); la comparten la esfera del espacio, el radar y este mapa
})();
