// Recuadro superior con la apariencia del objetivo que hay en la mira: enemigo, casco a la deriva, asteroide, basura espacial o planeta.
// Solo se dibuja (y solo existe el modelo en memoria) cuando hay algo bajo la mira. Usa el mismo modelo que se ve en el mundo.
const TV = (() => {
  const box = document.createElement('div'); box.id = 'tv'; box.innerHTML = '<canvas width="200" height="130"></canvas><div class="tl"></div><div class="hx"></div>'; document.body.append(box);
  const cv = box.firstChild, lab = box.querySelector('.tl'), hx = box.querySelector('.hx'), W = 200, H = 130; let hxSig = ''; // hx: hexágono con el nivel del objetivo (esquina superior izquierda)
  const rd = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }), sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, W / H, 0.05, 100);
  rd.setPixelRatio(1); rd.setSize(W, H, false); cam.position.set(1.6, 1.0, 5.2); cam.lookAt(0, 0, 0);
  sc.add(new THREE.AmbientLight(0xffffff, 0.3)); const L = new THREE.DirectionalLight(0xffffff, 0.85); L.position.set(2, 2, 3); sc.add(L);
  const pivot = new THREE.Group(), cache = new Map(); sc.add(pivot); let curKey = null;
  const ROCK = ['carbonáceo', 'rocoso', 'metálico', 'de hielo', 'alargado', 'binario'], DEB = ['satélite muerto', 'etapa de cohete', 'panel solar roto', 'cápsula quemada', 'cercha metálica', 'tanque esférico', 'placa de casco'];
  const ship = spec => { const g = makeShip(spec.spec, spec.hull); setThrust(g, 0, 0); const o = new THREE.Group(); g.scale.setScalar(42); o.add(g); return o; }; // tamaño fijo: el domo del escudo no debe encoger el casco
  const fitted = obj => { // normaliza el tamaño y centra el modelo para que siempre llene el recuadro
    const h = new THREE.Group(); h.add(obj); h.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(h), s = bx.getSize(new THREE.Vector3()), c = bx.getCenter(new THREE.Vector3()), k = 2.6 / (Math.max(s.x, s.y, s.z) || 1);
    const o = new THREE.Group(); o.add(h); h.scale.setScalar(k); h.position.copy(c.multiplyScalar(-k)); return o;
  };
  function build(a) { // modelo de vista previa según el tipo de objetivo
    if (a.type === 'p') { const r = remotes.get(a.t.id); return ship({ spec: r.grp && r.spk ? JSON.parse(r.spk) : { t: 'halcon', a: [0, 0, 0, 0, 0], c: 0xff6a3c } }); }
    if (a.type === 'n') return ship({ spec: { t: a.t.st, a: [0, 0, 0, 0, 0, 0], c: 0x9dff6a }, hull: 0x6f7b6c }); // nave neutral: mismos colores que en el mundo (neutral.js)
    if (a.type === 'w') { const w = wrecks[a.t.id]; return ship({ spec: { t: Object.keys(TYPES)[w.i % 4], a: [0, 0, 0, 0, 0], c: 0x333333 }, hull: 0x4a4f55 }); }
    if (a.type === 'h') { const g = new THREE.Group(), st = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.9 }), dk = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.6 }); g.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.12, 32), st)); const bl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.22), dk); bl.position.set(0, 0.18, -0.7); g.add(bl); for (const [x, z] of [[.62, .62], [-.62, .62], [.62, -.62], [-.62, -.62]]) { const t = new THREE.Group(), c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 8), dk); c.position.y = 0.26; const hd = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.16), dk); hd.position.y = 0.5; t.add(c, hd); t.position.set(x, 0, z); g.add(t); } return fitted(g); }
    if (a.type === 'r') return fitted(new THREE.Mesh(fields.geos[a.ob.m], a.ob.m < fields.rockCount ? fields.mats.rock : fields.mats.deb));
    const b = a.b, g = new THREE.Group(); // planeta o estrella: misma textura que en el espacio, anillos y halo de atmósfera
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), b.k === 'sun' ? new THREE.MeshBasicMaterial({ map: b.mesh.material.map }) : new THREE.MeshStandardMaterial({ map: b.mesh.material.map, roughness: 1 })));
    if (b.group.children[1] && b.group.children[1].geometry.type === 'RingGeometry') g.add(b.group.children[1].clone());
    if (ATMO[b.n]) g.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 32, 20), new THREE.MeshBasicMaterial({ color: ATMO[b.n].c, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide })));
    return fitted(g);
  }
  const key = a => a.type === 'h' ? 'h' : a.type === 'n' ? 'n:' + a.t.st : a.type === 'p' ? 'p:' + (remotes.get(a.t.id) || {}).spk : a.type === 'w' ? 'w:' + a.t.id : a.type === 'r' ? 'r:' + a.ob.m : 'b:' + a.b.n;
  const info = a => {
    if (a.type === 'n') return [`<b>${TYPES[a.t.st].name} · Nv ${a.t.lv}</b> · nave neutral`, `${a.t.hostile ? 'HOSTIL' : 'NEUTRAL'} · ESC ${Math.round(a.t.sh || 0)}% · CASCO ${Math.round(a.t.hp)}% · ${fD(a.dist)}`, a.t.hostile ? '#ff5a4a' : '#c8ff5d'];
    if (a.type === 'p') { const r = remotes.get(a.t.id), sp = r && r.spk ? JSON.parse(r.spk) : null; return [`<b>${a.t.name}</b> · ${sp ? TYPES[sp.t].name : 'nave'} · Nv ${a.t.lv || 0}`, `ESC ${Math.round(a.t.sh || 0)}% · CASCO ${Math.round(a.t.hp)}% · ${fD(a.dist)}`, '#ff6a3c']; }
    if (a.type === 'h') return [`<b>Hangar de ${a.t.name}</b>`, `ESC ${Math.round(a.t.sh || 0)}% · VIDA ${Math.round(a.t.hp)}% · ${fD(a.dist)}`, '#ff6a3c'];
    if (a.type === 'w') return ['<b>Casco a la deriva</b> · nave sin tripulación', `destrúyelo: munición y recursos · ${fD(a.dist)}`, '#5dff8a'];
    if (a.type === 'r') { const r = astInfo(a.ob), left = astLeft(a.ob), txt = resText(left) || (r.list.length ? 'zona agotada' : 'sin recursos'), hp = Math.max(0, Math.round(r.hp - ((AST.get(a.ob.id) || {}).dmg || 0))); return a.ob.m < fields.rockCount ? [`<b>Asteroide ${ROCK[a.ob.m]}</b> · ${txt}`, `radio ≈ ${a.ob.vis.toFixed(1)} km · VIDA ${hp}/${r.hp} · ${fD(a.dist)}`, '#ffb347'] : [`<b>Basura espacial</b> · ${DEB[a.ob.m - fields.rockCount]} · ${txt}`, `tamaño ≈ ${(a.ob.vis * 1000).toFixed(0)} m · VIDA ${hp}/${r.hp} · ${fD(a.dist)}`, '#ffb347']; }
    const b = a.b; return [`<b>${b.n}</b> · ${b.k === 'sun' ? 'estrella' : b.k === 'gas' ? 'gigante gaseoso' : b.parent ? 'luna' : 'planeta'}`, `radio ${Math.round(b.R).toLocaleString('es')} km · ${fD(a.dist)}`, '#4db8ff'];
  };
  return {
    update(a, now) {
      if (!a) { if (box.style.display !== 'none') box.style.display = 'none'; return; }
      if (box.style.display !== 'block') box.style.display = 'block';
      const k = key(a);
      if (k !== curKey) { pivot.clear(); let m = cache.get(k); if (!m) { m = build(a); cache.set(k, m); if (cache.size > 40) cache.delete(cache.keys().next().value); } pivot.add(m); curKey = k; }
      pivot.rotation.y = now / 1800; rd.render(sc, cam);
      const [t1, t2, col] = info(a); lab.innerHTML = `${t1}<br>${t2}`; box.style.borderColor = col + '55';
      const lv = a.type === 'p' || a.type === 'n' ? a.t.lv || 0 : null, sg = lv === null ? '' : lv + col; // nivel de naves (jugadores, bots y neutrales)
      if (sg !== hxSig) { hxSig = sg; hx.style.display = sg ? 'block' : 'none'; hx.innerHTML = sg ? hexSvg(lv, col, 42) : ''; }
    },
  };
})();
