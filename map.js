// Mapas (tecla M): mapa 3D del sistema (planetas esféricos con su textura, órbitas, cámara orbital) y mapa del planeta (globo giratorio con el terreno real).
// Muestran a los demás jugadores y los hangares (BASES). Usa bodies, remotes, S, mySpec... de game.js.
const BASES = []; // { owner, name, body: nombre del planeta, lat, lon } (radianes): los rellena base.js con los hangares del servidor
const MAP = (() => {
  const root = document.createElement('div'); root.id = 'map';
  root.innerHTML = '<div class="mh"><b>MAPA</b><span class="tab" data-t="sys">Sistema</span><span class="tab" data-t="pl">Planeta</span><span class="hint"></span></div><canvas class="m2"></canvas>'; // el canvas 3D (.m3) se crea al abrir el mapa y se destruye al cerrarlo: así no queda un segundo contexto WebGL en memoria durante la partida
  document.body.append(root);
  const c2 = root.querySelector('.m2'), g = c2.getContext('2d'), hint = root.querySelector('.hint'), tabs = [...root.querySelectorAll('.tab')];
  const st = { open: false, tab: 'sys', dist: 3.6, drag: null, moved: 0, mx: 0, my: 0, planet: null, yaw: 0.5, pitch: 0.75, sd: 30, focus: new THREE.Vector3(), ft: new THREE.Vector3(), fr: 1, fname: '' };
  let pmr = null, pms, pmc, globe, marks = [], sys = null, c3 = null;
  const markGeo = new THREE.SphereGeometry(1, 10, 8);
  const K = 1e-6; // km -> unidades del mapa del sistema
  const accent = r => { try { return JSON.parse(r.spk).c; } catch { return 0xff6a3c; } };
  const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');
  const near = () => { let best = null, ba = 1e30; for (const b of bodies) { if (b.k === 'sun') continue; const alt = Math.hypot(S.pos[0] - b.pos[0], S.pos[1] - b.pos[1], S.pos[2] - b.pos[2]) - b.R; if (alt < ba) { ba = alt; best = b; } } return { b: best, alt: ba }; };
  const others = () => [...remotes.values()].filter(r => r.apos && r.hp > 0);

  function ensureRenderer() {
    if (pmr) return;
    c3 = document.createElement('canvas'); c3.className = 'm3'; c3.style.display = 'block'; root.insertBefore(c3, c2);
    pmr = new THREE.WebGLRenderer({ canvas: c3, antialias: true, alpha: true }); pmr.setPixelRatio(Math.min(devicePixelRatio, 1.5)); resize();
  }
  function releaseRenderer() { // destruye el contexto WebGL del mapa (y con él todo lo que subió a la GPU) hasta la próxima vez que se abra
    if (!pmr) return; pmr.dispose(); pmr.forceContextLoss(); c3.remove(); pmr = null; c3 = null; pms = pmc = globe = null; sys = null; marks = [];
  }
  function setTab(t) {
    if (t === 'pl') { const n = near(); if (n.alt > 60000) { hint.textContent = 'Estás muy lejos de un planeta para abrir su mapa'; return; } st.planet = n.b; }
    st.tab = t; tabs.forEach(x => x.classList.toggle('on', x.dataset.t === t)); hint.textContent = '';
    ensureRenderer(); if (t === 'pl') initPlanet(); else initSys();
  }
  function open() {
    st.open = true; window.MAPOPEN = true; root.style.display = 'block'; document.exitPointerLock(); ensureRenderer();
    const n = near(); if (n.alt >= 20000) { st.fname = ''; } setTab(n.alt < 20000 ? 'pl' : 'sys'); resize(); if (st.tab === 'sys') focusMe(); requestAnimationFrame(loop);
  }
  function close() { st.open = false; window.MAPOPEN = false; root.style.display = 'none'; releaseRenderer(); renderer.domElement.requestPointerLock(); }
  function resize() { c2.width = innerWidth; c2.height = innerHeight; if (pmr) { pmr.setSize(innerWidth, innerHeight, false); if (pmc) { pmc.aspect = innerWidth / innerHeight; pmc.updateProjectionMatrix(); } if (sys) { sys.cam.aspect = innerWidth / innerHeight; sys.cam.updateProjectionMatrix(); } } }
  addEventListener('resize', () => st.open && resize());

  // ---------- mapa del planeta: globo giratorio con la misma textura que la esfera del espacio (terreno real de sysgen; la grande si el mundo está cerca) ----------
  const planetTex = b => b.texHi || bodyTex(b);
  function initPlanet() {
    if (!pms) {
      pms = new THREE.Scene(); pmc = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 50);
      pms.add(new THREE.AmbientLight(0xffffff, 0.9)); const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(2, 2, 4); pms.add(dl); globe = new THREE.Group(); pms.add(globe);
    }
    while (globe.children.length) { const c = globe.children[0]; globe.remove(c); if (c.geometry !== markGeo) c.geometry.dispose(); c.material.dispose(); } marks = [];
    const b = st.planet, ball_ = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), new THREE.MeshBasicMaterial({ map: planetTex(b) })); globe.add(ball_);
    if (ATMO[b.n]) globe.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 40, 24), new THREE.MeshBasicMaterial({ color: ATMO[b.n].c, transparent: true, opacity: 0.16, side: THREE.BackSide })));
    center();
  }
  function center() { // gira el globo para dejar tu posición de cara al mapa
    if (!globe) return; const b = st.planet, v = new THREE.Vector3(S.pos[0] - b.pos[0], S.pos[1] - b.pos[1], S.pos[2] - b.pos[2]).normalize(); globe.quaternion.setFromUnitVectors(v, new THREE.Vector3(0, 0, 1));
  }
  function marker(color, size) { const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color })); m.scale.setScalar(size); globe.add(m); return m; }

  function drawPlanet() {
    const b = st.planet, W = c2.width, H = c2.height; pmc.position.set(0, 0, st.dist); pmc.lookAt(0, 0, 0); pmr.render(pms, pmc);
    g.clearRect(0, 0, W, H);
    const items = []; // yo, otros jugadores del mismo mundo y hangares
    const rel = p => { const v = new THREE.Vector3(p[0] - b.pos[0], p[1] - b.pos[1], p[2] - b.pos[2]); const l = v.length(); return { dir: v.divideScalar(l), alt: l - b.R }; };
    const me = rel(S.pos); items.push({ n: myName + ' (tú)', col: 0x4db8ff, ...me, self: true, sz: 0.022 });
    for (const r of others()) { const e = rel(r.apos); if (e.alt < 60000) items.push({ n: r.name, col: accent(r), ...e, sz: 0.018 }); }
    for (const bs of BASES) if (bs.body === b.n) items.push({ n: `Hangar · ${bs.owner || ''}`, col: 0xffffff, dir: new THREE.Vector3(Math.cos(bs.lat) * Math.cos(bs.lon), Math.sin(bs.lat), Math.cos(bs.lat) * Math.sin(bs.lon)), alt: 0, base: true, sz: 0.02 });
    while (marks.length < items.length) marks.push(marker(0xffffff, 1));
    marks.forEach((m, i) => m.visible = i < items.length);
    const v = new THREE.Vector3(); let hover = null, hd = 22;
    items.forEach((it, i) => {
      const m = marks[i]; m.position.copy(it.dir).multiplyScalar(1.012); m.scale.setScalar(it.sz * (1 + 0.25 * Math.sin(performance.now() / 300 + i))); m.material.color.setHex(it.col);
      m.getWorldPosition(v); const facing = v.z > 0.02; v.project(pmc); const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      if (!facing) return;
      g.fillStyle = hex(it.col); g.strokeStyle = '#000'; g.lineWidth = 3; g.font = `bold 12px ${MONO}`; g.textAlign = 'left'; g.strokeText(it.n, x + 12, y + 4); g.fillText(it.n, x + 12, y + 4);
      if (it.base) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x - 7, y - 7, 14, 14); }
      const dd = Math.hypot(x - st.mx, y - st.my); if (dd < hd) { hd = dd; hover = { it, x, y }; }
    });
    g.fillStyle = 'rgba(0,10,20,0.6)'; g.beginPath(); g.roundRect(W - 300, 80, 280, 60 + items.length * 20, 10); g.fill();
    g.fillStyle = '#7fb6d4'; g.font = `11px ${MONO}`; g.textAlign = 'left'; g.fillText(`${b.n.toUpperCase()} · JUGADORES Y HANGARES`, W - 286, 102);
    items.forEach((it, i) => { g.fillStyle = hex(it.col); g.beginPath(); g.arc(W - 282, 122 + i * 20, 5, 0, 7); g.fill(); g.fillStyle = '#dff4ff'; g.font = `12px ${MONO}`; g.fillText(`${it.n}${it.base ? '' : ' · alt ' + fD(Math.max(0, it.alt))}`, W - 270, 126 + i * 20); });
    if (hover) { g.fillStyle = 'rgba(0,10,20,0.8)'; g.fillRect(hover.x + 14, hover.y - 30, 230, 34); g.fillStyle = '#fff'; g.font = `12px ${MONO}`; g.fillText(hover.it.n, hover.x + 20, hover.y - 14); g.fillStyle = '#9fd4ee'; g.fillText(hover.it.base ? 'hangar' : `altitud ${fD(Math.max(0, hover.it.alt))}`, hover.x + 20, hover.y); }
    g.fillStyle = '#7fb6d4'; g.textAlign = 'center'; g.fillText('Arrastra: girar el planeta · Rueda: zoom · C: centrar en ti · Tab: sistema · M / Esc: cerrar', W / 2, H - 18);
  }

  // ---------- mapa 3D del sistema: planetas con su textura sobre sus órbitas; los tamaños se exageran para poder verlos ----------
  const dispR = b => b.k === 'sun' ? 1.5 : b.parent ? 0.1 + b.R / 9000 : 0.22 + b.R / 1800 * 0.09;
  function moonOrbitR(b) { const sibs = bodies.filter(m => m.parent === b.parent); return dispR(b.parent) * 2.1 + 0.32 * sibs.indexOf(b); }
  function initSys() {
    if (sys) return;
    const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.02, 2000);
    sc.add(new THREE.AmbientLight(0xffffff, 0.42)); const pl = new THREE.PointLight(0xfff2d8, 2.2, 0, 0); sc.add(pl);
    { const p = new Float32Array(3 * 1800); for (let i = 0; i < p.length; i += 3) { const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - u * u); p[i] = 900 * r * Math.cos(a); p[i + 1] = 900 * u; p[i + 2] = 900 * r * Math.sin(a); } const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(p, 3)); sc.add(new THREE.Points(gg, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, color: 0xffffff }))); }
    const sysSphere = new THREE.SphereGeometry(1, 40, 28), objs = bodies.map(b => {
      const tex = b.mesh.material.map, mat = b.k === 'sun' ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.42 });
      const m = new THREE.Mesh(sysSphere, mat); m.scale.setScalar(dispR(b)); sc.add(m);
      let orbit = null;
      if (b.a) { const seg = 128, pts = [], r = b.parent ? moonOrbitR(b) : b.a * DIST_SCALE * K; for (let i = 0; i <= seg; i++) { const a = i / seg * 6.2832; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
        orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: b.parent ? 0x4a6f88 : 0x6fa3c4, transparent: true, opacity: b.parent ? 0.45 : 0.6 })); sc.add(orbit); }
      if (b.k === 'sun') { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(7); m.add(s); s.scale.setScalar(4.6 / 1.5 * 1.5); }
      return { b, m, orbit, p: new THREE.Vector3() };
    });
    const belt = (() => { const n = 900, pos = new Float32Array(n * 3), r0 = BELT.i * K, r1 = BELT.o * K; for (let i = 0; i < n; i++) { const a = Math.random() * 6.2832, r = r0 + Math.random() * (r1 - r0); pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (Math.random() - 0.5) * 0.3; pos[i * 3 + 2] = Math.sin(a) * r; } const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); const pts = new THREE.Points(gg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xb8a58a })); sc.add(pts); return pts; })();
    const mk = (geo, col) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col })); sc.add(m); return m; };
    sys = { sc, cam, objs, belt, me: mk(new THREE.ConeGeometry(0.09, 0.3, 10), 0x4db8ff), foes: [], bases: [], mk };
    resize();
  }
  function dpos(b, out) { // posición en el mapa: planetas y estrella en su sitio real; las lunas se acercan a su planeta para verse
    if (b.k === 'sun') return out.set(0, 0, 0);
    if (!b.parent) return out.set(b.pos[0] * K, 0, b.pos[2] * K);
    const p = b.parent, dx = b.pos[0] - p.pos[0], dz = b.pos[2] - p.pos[2], l = Math.hypot(dx, dz) || 1, r = moonOrbitR(b);
    return out.set(p.pos[0] * K + dx / l * r, 0, p.pos[2] * K + dz / l * r);
  }
  function entityPos(P, out) { // un punto del espacio real -> mapa (junto al cuerpo más cercano si está cerca de él)
    let best = null, bd = 1e30; for (const b of bodies) { const d = Math.hypot(P[0] - b.pos[0], P[1] - b.pos[1], P[2] - b.pos[2]); if (d < bd) { bd = d; best = b; } }
    if (best && bd < best.R * 40 + 5e4 && best.k !== 'sun') { const v = new THREE.Vector3(P[0] - best.pos[0], P[1] - best.pos[1], P[2] - best.pos[2]).normalize(); dpos(best, out); return out.addScaledVector(v, dispR(best) * (1.5 + Math.min(1.5, (bd - best.R) / (best.R * 40)))); }
    return out.set(P[0] * K, P[1] * K, P[2] * K);
  }
  const vTmp = new THREE.Vector3();
  function focusMe() { entityPos(S.pos, st.ft); st.fr = 0.3; st.sd = 2.4; st.fname = myName; }
  function focusBody(b) { dpos(b, st.ft); st.fr = dispR(b); st.sd = Math.max(1.4, dispR(b) * 5.5); st.fname = b.n; }

  function drawSys() {
    ensureRenderer(); initSys(); const W = c2.width, H = c2.height, cam = sys.cam, now = performance.now();
    for (const o of sys.objs) { dpos(o.b, o.p); o.m.position.copy(o.p); if (o.b.k !== 'sun') o.m.rotation.y = now / 9000 + o.b.i; else o.m.rotation.y = now / 30000; if (o.orbit && o.b.parent) o.orbit.position.set(o.b.parent.pos[0] * K, 0, o.b.parent.pos[2] * K); }
    // marcadores: yo, otros jugadores y hangares
    entityPos(S.pos, sys.me.position); { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q); sys.me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f); sys.me.scale.setScalar(0.7 + 0.25 * Math.sin(now / 250)); }
    const os = others(); while (sys.foes.length < os.length) sys.foes.push(sys.mk(new THREE.ConeGeometry(0.08, 0.26, 8), 0xff6a3c));
    sys.foes.forEach((m, i) => { m.visible = i < os.length; if (i < os.length) { entityPos(os[i].apos, m.position); m.material.color.setHex(accent(os[i])); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1).applyQuaternion(os[i].q)); } });
    while (sys.bases.length < BASES.length) sys.bases.push(sys.mk(new THREE.BoxGeometry(0.06, 0.06, 0.06), 0xffffff));
    sys.bases.forEach((m, i) => { m.visible = i < BASES.length; if (i < BASES.length) { const bs = BASES[i], b = bodies.find(q => q.n === bs.body); if (!b) { m.visible = false; return; } dpos(b, m.position); m.position.add(new THREE.Vector3(Math.cos(bs.lat) * Math.cos(bs.lon), Math.sin(bs.lat), Math.cos(bs.lat) * Math.sin(bs.lon)).multiplyScalar(dispR(b) * 1.04)); } });
    // cámara orbital con seguimiento suave del foco
    st.focus.lerp(st.ft, 0.12); st.dist += (st.sd - st.dist) * 0.12;
    const cd = Math.cos(st.pitch); cam.position.set(st.focus.x + Math.sin(st.yaw) * cd * st.dist, st.focus.y + Math.sin(st.pitch) * st.dist, st.focus.z + Math.cos(st.yaw) * cd * st.dist); cam.lookAt(st.focus);
    pmr.render(sys.sc, cam); g.clearRect(0, 0, W, H);
    const pts = []; let hover = null, hd = 22; g.textAlign = 'left';
    const lab = (v, text, col, kind, pos, bold, dy) => { vTmp.copy(v).project(cam); if (vTmp.z > 1 || Math.abs(vTmp.x) > 1.05 || Math.abs(vTmp.y) > 1.05) return; const x = (vTmp.x * 0.5 + 0.5) * W, y = (-vTmp.y * 0.5 + 0.5) * H; g.font = `${bold ? 'bold ' : ''}12px ${MONO}`; g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(text, x + 10, y + (dy || 4)); g.fillText(text, x + 10, y + (dy || 4)); pts.push({ x, y, n: text, kind, pos }); };
    for (const o of sys.objs) { const b = o.b, top = o.p.clone(); top.y += dispR(b) * 1.15; const occ = BASES.find(x => x.body === b.n); lab(top, b.n + (occ ? '  ⌂ ' + occ.owner : ''), b.k === 'sun' ? '#ffd166' : '#dff4ff', b.k === 'sun' ? 'estrella' : b.parent ? 'luna' : (b.label || 'planeta').toLowerCase(), b.pos); }
    lab(sys.me.position.clone().add(new THREE.Vector3(0, 0.25, 0)), myName + ' (tú)', '#4db8ff', 'tú', S.pos, true);
    os.forEach((r, i) => lab(sys.foes[i].position.clone().add(new THREE.Vector3(0, 0.22, 0)), r.name || 'Piloto', hex(accent(r)), 'jugador', r.apos, true));
    for (const p of pts) { const dd = Math.hypot(p.x - st.mx, p.y - st.my); if (dd < hd) { hd = dd; hover = p; } }
    if (hover) { const d = Math.hypot(hover.pos[0] - S.pos[0], hover.pos[1] - S.pos[1], hover.pos[2] - S.pos[2]); g.fillStyle = 'rgba(0,10,20,0.85)'; g.fillRect(hover.x + 14, hover.y + 8, 270, 48); g.fillStyle = '#fff'; g.font = `bold 12px ${MONO}`; g.fillText(`${hover.n} · ${hover.kind}`, hover.x + 20, hover.y + 24); g.font = `11px ${MONO}`; g.fillStyle = '#9fd4ee'; g.fillText(`${fD(d)}${d > 1 ? ' · a 5 c: ' + fT(d / (5 * C)) : ''}`, hover.x + 20, hover.y + 42); }
    g.textAlign = 'right'; g.font = `11px ${MONO}`; g.fillStyle = '#7fb6d4'; g.fillText(`Cuerpos: ${bodies.length - 1} · Jugadores aparte de ti: ${os.length} · Hangares: ${BASES.length}`, W - 24, 82);
    g.textAlign = 'center'; g.fillText('Arrastra: girar · Rueda: zoom · Clic en un cuerpo: enfocar · C: centrar en ti · Tab: mapa del planeta · M / Esc: cerrar (tamaños exagerados)', W / 2, H - 18);
    st.hover = pts;
  }
  function loop() { if (!st.open) return; requestAnimationFrame(loop); if (st.tab === 'pl') drawPlanet(); else drawSys(); }

  // ---------- entrada ----------
  addEventListener('keydown', e => { // en fase de captura: con el mapa abierto la nave no recibe teclas
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyM' && !e.repeat) { if (!st.open && ov.style.display !== 'none') return; e.preventDefault(); e.stopImmediatePropagation(); st.open ? close() : open(); return; }
    if (!st.open) return; e.stopImmediatePropagation();
    if (e.code === 'Escape') close(); else if (e.code === 'Tab') { e.preventDefault(); setTab(st.tab === 'sys' ? 'pl' : 'sys'); } else if (e.code === 'KeyC') { if (st.tab === 'sys') focusMe(); else center(); }
  }, true);
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'); if (t) return setTab(t.dataset.t);
    if (st.tab === 'sys' && st.moved < 5 && sys) { // clic sobre un cuerpo: enfocarlo
      let best = null, bd = 26; for (const p of st.hover || []) { const d = Math.hypot(p.x - e.clientX, p.y - e.clientY); if (d < bd) { bd = d; best = p; } }
      if (best) { const b = bodies.find(x => best.n.startsWith(x.n)); if (b) focusBody(b); else if (best.kind === 'tú') focusMe(); }
    }
  });
  root.addEventListener('wheel', e => { e.preventDefault(); if (st.tab === 'sys') st.sd = Math.max(Math.max(0.5, st.fr * 2.6), Math.min(160, st.sd * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); else st.dist = Math.max(1.6, Math.min(5, st.dist * (e.deltaY > 0 ? 1.08 : 1 / 1.08))); }, { passive: false });
  root.addEventListener('mousedown', e => { if (e.target.closest('.mh')) return; st.drag = [e.clientX, e.clientY]; st.moved = 0; });
  addEventListener('mouseup', () => st.drag = null);
  addEventListener('mousemove', e => {
    if (!st.open) return; st.mx = e.clientX; st.my = e.clientY; if (!st.drag) return;
    const dx = e.clientX - st.drag[0], dy = e.clientY - st.drag[1]; st.drag = [e.clientX, e.clientY]; st.moved += Math.abs(dx) + Math.abs(dy);
    if (st.tab === 'sys') { st.yaw -= dx * 0.006; st.pitch = Math.max(0.05, Math.min(1.5, st.pitch + dy * 0.006)); }
    else if (globe) { globe.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.006)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.006)); } // girar el planeta
  });
  return { open, close, BASES, warm: b => bodyTex(b) }; // warm: genera la textura base del cuerpo (pantalla de carga); la comparten la esfera del espacio, el radar y este mapa
})();
