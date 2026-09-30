// Hangares: cada jugador establece el suyo sobre TIERRA FIRME de un planeta libre. Plataforma de hormigón + 4 torretas que disparan a los enemigos cercanos.
// Mientras el hangar exista, al morir reapareces en él tras una cuenta atrás; si lo destruyen, quedas derrotado y debes elegir otro planeta.
// El servidor solo guarda { dueño, planeta, lat, lon, vida }. Las torretas las simula la víctima (igual que el daño de los proyectiles), así no hay retardo.
const BASE = (() => {
  const HG = new Map(), BK = 6, PAD_R = 0.055, // BK: las bases se ven y miden 6 veces más que el modelo base (km): el doble que antes
   TW_RANGE = 200, TW_RANGE_ATMO = 200, // las bases detectan y disparan a enemigos hasta 200 km (con o sin atmósfera)
   TW_CD = 0.9, TW_SPD = 1.0, TW_HP = 150, // las torretas disparan a 1 km/s (3 600 km/h): el proyectil viaja y tarda en llegar
   HG_R = 0.075, HG_HPMAX = 600, css = document.createElement('style');
  const TW = [[0.034, 0.034], [-0.034, 0.034], [0.034, -0.034], [-0.034, -0.034]]; // posición local (x, z) de las torretas, km
  css.textContent = `#pl{position:fixed;inset:0;z-index:12;display:none;background:rgba(2,8,16,.97);overflow:hidden;padding:0;color:#cfe9f7;font-family:ui-monospace,Consolas,monospace;align-items:center;justify-content:center}
  #pl .lbx{width:1040px;flex:none}#pl h1{letter-spacing:.3em;margin:0 0 4px;text-align:center}#pl .sub{color:#9fd4ee;margin-bottom:8px;text-align:center}#pl .msg{color:#ffd23f;margin-bottom:10px;min-height:18px;text-align:center}
  #pl .lbmain{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}
  #pl .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  #pl .card{display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:center;background:#08202f;border:1px solid #1d4a66;border-radius:12px;padding:12px;cursor:pointer;text-align:left;color:inherit;font:inherit}
  #pl .card:hover:not(.dis){border-color:#4db8ff;background:#0b2a3d}#pl .card.dis{opacity:.55;cursor:default}#pl .botbtn{margin-top:6px;padding:4px 8px;border-radius:6px;border:1px solid #6a3a2a;background:#2a1208;color:#ffb38a;font:inherit;font-size:11px;cursor:pointer}#pl .botbtn.on{background:#5a1a0c;border-color:#ff6a3c;color:#fff}#pl .card.mine{border-color:#5dff8a;box-shadow:0 0 14px #5dff8a55;background:#0b2f26}
  #pl .orb{width:72px;height:72px;border-radius:50%;box-shadow:inset -12px -9px 20px #000a,0 0 14px #0006}
  #pl .card b{display:block;font-size:15px}#pl .card small{display:block;color:#8fb8d0;line-height:1.35;margin-top:2px}#pl .tag{color:#ffd23f;font-size:11px}
  #pl .side{background:#08202f;border:1px solid #1d4a66;border-radius:12px;padding:14px;position:sticky;top:10px}#pl .side h3{margin:0 0 8px;font-size:12px;letter-spacing:.2em;color:#9fd4ee}
  #pl .pl{display:grid;gap:4px;margin-bottom:12px;font-size:12px}#pl .pl div{display:flex;justify-content:space-between;gap:8px;padding:5px 8px;background:#0a2233;border-radius:6px}#pl .pl .ok{color:#5dff8a}#pl .pl .me{outline:1px solid #4db8ff}
  
  #pl .side input[type=text]{width:100%;box-sizing:border-box;background:#04121e;border:1px solid #2a5a78;color:#dff4ff;border-radius:6px;padding:6px;font:inherit;margin-bottom:8px}
  #pl .side button{width:100%;margin-top:6px;padding:10px;border-radius:8px;border:1px solid #2a5a78;background:#0b2a3d;color:#dff4ff;font:inherit;font-weight:bold;cursor:pointer}#pl .side button:disabled{opacity:.4;cursor:not-allowed}
  #pl .side button.on{background:#1d7a3f;border-color:#5dff8a}#pl .side button.go{background:#c2470a;border-color:#ffb347}#pl .hint{color:#8fb8d0;font-size:11px;margin-top:8px;line-height:1.4}`;
  document.head.append(css);
  const pl = document.createElement('div'); pl.id = 'pl'; document.body.append(pl);
  const LB = { phase: 'lobby', list: [], bots: [], adm: null, pick: null, sig: '' }; let started = false, pendingPick = null;
  let pendingSpawn = false, claimT = 0, hadHangar = false, defeated = false, chooserShown = false, lastAlert = 0, lastHp = null;
  const bodyBy = n => bodies.find(b => b.n === n);
  const dirOf = (la, lo) => [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
  const Y = new THREE.Vector3(0, 1, 0);
  const owner = id => id === myId ? myName : (remotes.get(id)?.name || 'Piloto');

  // ---------- emplazamiento: tierra firme, sin lava ni agua y lo más llana posible (la plataforma cubre el resto) ----------
  function pts(b, dir) { // centro + 2 anillos de puntos de la plataforma
    const d = new THREE.Vector3(...dir), e = new THREE.Vector3(0, 1, 0).cross(d); if (e.lengthSq() < 1e-6) e.set(1, 0, 0); e.normalize(); const n = d.clone().cross(e), out = [d.clone().multiplyScalar(b.R)];
    for (const rad of [0.028 * BK, PAD_R * BK]) for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; out.push(d.clone().multiplyScalar(b.R).addScaledVector(e, Math.cos(a) * rad).addScaledVector(n, Math.sin(a) * rad)); }
    return out;
  }
  function padInfo(b, dir) { // { ok, range, top }: alturas del terreno bajo la plataforma (mismo cálculo en todos los clientes)
    const cfg = SURF[b.n], o = {}; let mn = 1e9, mx = -1e9, ok = true;
    for (const p of pts(b, dir)) { p.normalize().multiplyScalar(b.R); sample(cfg, p.x, p.y, p.z, o, 0); if (o.water >= 0 || o.lava > 0.25) ok = false; mn = Math.min(mn, o.h); mx = Math.max(mx, o.h); }
    if (cfg.kind === 'earth' && mn < 0.02) ok = false;
    return { ok, range: mx - mn, top: mx + 0.0008 };
  }
  function findSite(b) {
    let best = null, alt = null;
    for (let i = 0; i < 500; i++) {
      const la = Math.asin(Math.random() * 1.7 - 0.85), lo = Math.random() * 6.2832 - 3.1416, info = padInfo(b, dirOf(la, lo));
      if (!info.ok) { if (!alt || info.range < alt.range) alt = { la, lo, range: info.range }; continue; } if (!best || info.range < best.range) best = { la, lo, range: info.range }; if (info.range < 0.012) break;
    }
    return best || alt; // con la plataforma el doble de grande puede no haber sitio perfecto: se usa el más llano (la plataforma cubre el resto)
  }

  // ---------- modelo 3D ----------
  // ---------- modelo 3D ----------
  // Piezas y torretas se funden por material con kit() (ships.js): unos pocos meshes por hangar. Unidades: km; la cara superior de la plataforma queda a y = 0.
  const HEAD_Y = 0.0255, MUZ = { plasma: 0.0150, cannon: 0.0135, missile: 0.0125, rail: 0.0225 }; // altura del eje de la cabeza de cada torreta sobre la plataforma y distancia de la boca del cañón a ese eje (km)
  const HT = SHIPGFX.tex('hull'), MXT = SHIPGFX.tex('metal'), GT = SHIPGFX.tex('ground'), WT = SHIPGFX.tex('win'), ENV = SHIPGFX.tex('env');
  const std = (c, r = 0.7, m = 0.3, e = 0.07, map = null) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: c, emissiveIntensity: e, map, envMap: map ? ENV : null, envMapIntensity: 0.7 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xe2e4e8, map: GT, roughness: 0.95, metalness: 0.04, emissive: 0x9a9da3, emissiveIntensity: 0.07 }), dark = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.7, metalness: 0.5 });
  const rockM = new THREE.MeshStandardMaterial({ color: 0xa89c8a, map: GT, roughness: 1, metalness: 0, emissive: 0x6b6357, emissiveIntensity: 0.1 }); // roca y talud de tierra alrededor de la plataforma
  const hSteel = std(0xc6ced8, 0.5, 0.45, 0.14, HT), hArmor = std(0xa3acb8, 0.55, 0.5, 0.14, HT), hDark = std(0x555c66, 0.6, 0.5, 0.1, MXT), hAmmo = std(0x7a7038, 0.6, 0.3, 0.1), hWhite = std(0xe8edf2, 0.5, 0.1, 0.15);
  const hazY = std(0xf2c230, 0.7, 0.1, 0.25), seamM = new THREE.MeshStandardMaterial({ color: 0x6f737a, roughness: 1, metalness: 0 }), redL = new THREE.MeshBasicMaterial({ color: 0xff3030 }), whiteL = new THREE.MeshBasicMaterial({ color: 0xf4fbff });
  const winM = new THREE.MeshStandardMaterial({ color: 0x9aa8b8, map: WT, emissive: 0xffffff, emissiveMap: WT, emissiveIntensity: 1, roughness: 0.6, metalness: 0.2 }); // ventanas encendidas de la torre de control
  const pvM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: SHIPGFX.tex('pvr'), metalness: 0.6, roughness: 0.3, emissive: 0x143070, emissiveIntensity: 0.4, envMap: ENV, envMapIntensity: 1.2 });
  const GP = {}, keepAll = list => { for (const [, geo] of list) geo.userData.keep = true; return list; }; // GP: material de luz de la base (propio de cada dueño) al que se sustituye la marca; keep: geometría compartida y cacheada (no se libera)
  const cyl = (r0, r1, h, seg = 16) => new THREE.CylinderGeometry(r0, r1, h, seg), box = (w, h, d) => new THREE.BoxGeometry(w, h, d), torusH = (r, t, seg = 20) => new THREE.TorusGeometry(r, t, 4, seg).rotateX(Math.PI / 2);

  function rocks() { // 22 rocas low-poly (icosaedros de 20 caras deformados, sombreado plano) en el borde de la plataforma: una sola malla
    const K = kit(0.02), R = rndOf(913), TP = 6.2832;
    for (let i = 0; i < 22; i++) {
      const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position, j = new Map();
      for (let v = 0; v < p.count; v++) { const key = p.getX(v).toFixed(3) + p.getY(v).toFixed(3) + p.getZ(v).toFixed(3); if (!j.has(key)) j.set(key, 0.72 + R() * 0.5); p.setXYZ(v, p.getX(v) * j.get(key), p.getY(v) * j.get(key), p.getZ(v) * j.get(key)); }
      g.computeVertexNormals();
      const a = (i + R() * 0.7) / 22 * TP, r = PAD_R + 0.0046 + R() * 0.0036, sz = 0.0018 + R() * 0.0030;
      K.add(rockM, g, [Math.cos(a) * r, sz * 0.18 - 0.0012, Math.sin(a) * r], [R() * 3, R() * 3, R() * 3], [sz * 1.25, sz * 0.72, sz]);
    }
    return keepAll(K.parts());
  }
  let _sc = null; // parte estática de la plataforma (igual en todos los hangares): se construye UNA vez y se comparte; solo el cuerpo (su altura sk) y el talud son propios de cada base
  function sceneryParts() { // plataforma de hormigón con juntas y franjas de peligro, pista de aterrizaje, luces de balizamiento, paneles solares y complejo de control al norte
    if (_sc) return _sc; const K = kit(0.03), L = kit(0.008), Kp = kit(0.012), glow = GP;
    for (let i = 0; i < 32; i++) { const a = (i + 0.5) * PI / 16; K.add(i % 2 ? hDark : hazY, box(0.0102, 0.0003, 0.0017), [Math.cos(a) * 0.0538, 0.00015, Math.sin(a) * 0.0538], [0, -(a + PI / 2), 0]); } // franjas de peligro del borde
    for (let k = -4; k <= 4; k++) { const c = k * 0.0105, half = Math.sqrt(PAD_R * PAD_R - c * c) - 0.0032; if (half < 0.004) continue; K.add(seamM, box(0.00016, 0.00012, half * 2), [c, 0.00006, 0]); K.add(seamM, box(half * 2, 0.00012, 0.00016), [0, 0.00006, c]); } // juntas de dilatación del hormigón
    L.add(glow, new THREE.RingGeometry(0.020, 0.0245, 48).rotateX(-PI / 2), [0, 0.0003, 0]); L.add(glow, new THREE.RingGeometry(0.0266, 0.0276, 48).rotateX(-PI / 2), [0, 0.0003, 0]);
    for (const sx of [-1, 1]) L.add(glow, box(0.0026, 0.0002, 0.0150), [sx * 0.0048, 0.0003, 0]); L.add(glow, box(0.0070, 0.0002, 0.0026), [0, 0.0003, 0]); // "H" de la pista
    for (let i = 0; i < 24; i++) { const a = i * PI / 12; L.add(glow, box(0.0022, 0.0002, 0.0007), [Math.cos(a) * 0.0334, 0.0003, Math.sin(a) * 0.0334], [0, -(a + PI / 2), 0]); } // anillo de trazos
    for (let i = 0; i < 16; i++) { const a = (i + 0.5) * PI / 8; K.add(hDark, cyl(0.0008, 0.0009, 0.0008, 8), [Math.cos(a) * 0.0503, 0.0004, Math.sin(a) * 0.0503]); L.add(glow, new THREE.SphereGeometry(0.0006, 8, 6, 0, PI * 2, 0, PI / 2), [Math.cos(a) * 0.0503, 0.0008, Math.sin(a) * 0.0503]); } // balizas del perímetro
    for (let i = 0; i < 5; i++) L.add(glow, new THREE.SphereGeometry(0.0004 + i * 0.00004, 8, 6, 0, PI * 2, 0, PI / 2), [0, 0.0003, 0.031 + i * 0.0042]); // luces de aproximación hacia el sur
    // complejo de control (norte): hangar con puerta, torre acristalada, radar, tanques, generador y mástil
    const bz = -0.041;
    K.add(hArmor, box(0.0300, 0.0060, 0.0090), [0, 0.0030, bz]); K.add(hSteel, box(0.0306, 0.0006, 0.0096), [0, 0.0063, bz]); K.add(hDark, box(0.0124, 0.0043, 0.0006), [0, 0.0022, bz + 0.0046]); K.add(hDark, box(0.0002, 0.0043, 0.0008), [0, 0.0022, bz + 0.0047]); // nave principal, cornisa y puerta del hangar
    for (const sx of [-1, 1]) { K.add(hazY, box(0.0009, 0.0043, 0.0008), [sx * 0.0068, 0.0022, bz + 0.0047]); K.add(hDark, box(0.0050, 0.0014, 0.0007), [sx * 0.0108, 0.0032, bz + 0.0046]); } // jambas con franja amarilla y rejillas laterales
    K.add(hArmor, box(0.0140, 0.0050, 0.0080), [0, 0.0091, bz - 0.0004]); K.add(hSteel, box(0.0148, 0.0006, 0.0088), [0, 0.0119, bz - 0.0004]); L.add(winM, box(0.0142, 0.0016, 0.0082), [0, 0.0096, bz - 0.0004]); // torre de control con banda de ventanas
    for (let i = -3; i <= 3; i++) { K.add(hDark, box(0.00030, 0.0018, 0.0084), [i * 0.0021, 0.0096, bz - 0.0004]); }
    K.add(hDark, box(0.0148, 0.0003, 0.0084), [0, 0.0088, bz - 0.0004]); K.add(hDark, box(0.0148, 0.0003, 0.0084), [0, 0.0104, bz - 0.0004]);
    K.add(hWhite, new THREE.SphereGeometry(0.0030, 14, 6, 0, PI * 2, 0, 0.9), [0.0046, 0.0128, bz], [-0.8, 0, 0]); K.add(hDark, cyl(0.0003, 0.0003, 0.0036, 5), [0.0046, 0.0137, bz + 0.0006], [-0.8, 0, 0]); K.add(hArmor, cyl(0.0007, 0.0010, 0.0016, 8), [0.0046, 0.0128, bz]); // plato de radar
    K.add(hArmor, cyl(0.0005, 0.0007, 0.0300, 6), [-0.0030, 0.0270, bz]); K.add(hDark, box(0.0080, 0.0003, 0.0003), [-0.0030, 0.0250, bz]); K.add(hDark, box(0.0050, 0.0003, 0.0003), [-0.0030, 0.0290, bz]); L.add(glow, new THREE.SphereGeometry(0.0011, 10, 8), [-0.0030, 0.0425, bz]); K.add(redL, new THREE.SphereGeometry(0.0005, 6, 5), [-0.0030, 0.0345, bz]); // mástil con balizas
    K.add(hArmor, cyl(0.0030, 0.0030, 0.0090, 14), [-0.0215, 0.0030, bz], [PI / 2, 0, 0]); for (const dz of [-0.0045, 0.0045]) K.add(hArmor, new THREE.SphereGeometry(0.0030, 12, 8), [-0.0215, 0.0030, bz + dz]); for (const dz of [-0.0022, 0.0022]) K.add(glow, new THREE.TorusGeometry(0.0031, 0.00025, 4, 20), [-0.0215, 0.0030, bz + dz]); K.add(hDark, box(0.0009, 0.0036, 0.0009), [-0.0215, 0.0068, bz]); // tanque de combustible con bandas
    K.add(hArmor, box(0.0062, 0.0036, 0.0064), [0.0215, 0.0018, bz]); for (const dz of [-0.0016, 0.0016]) { K.add(hDark, cyl(0.0014, 0.0014, 0.0005, 14), [0.0215, 0.0038, bz + dz]); K.add(hSteel, cyl(0.0011, 0.0011, 0.0003, 10), [0.0215, 0.0041, bz + dz]); } K.add(hDark, box(0.0062, 0.0009, 0.0007), [0.0215, 0.0012, bz + 0.0034]); // generador con ventiladores
    for (let i = 0; i < 3; i++) { K.add(hDark, cyl(0.0003, 0.0003, 0.0040, 5), [0.0142 + i * 0.0007, 0.0056 + 0.0009 * i, bz - 0.0020]); }
    for (const [x, c] of [[-0.0125, hSteel], [-0.0068, hArmor], [0.0118, hSteel]]) { K.add(c, box(0.0054, 0.0030, 0.0026), [x, 0.0015, 0.0440]); K.add(hDark, box(0.0055, 0.0003, 0.0027), [x, 0.0022, 0.0440]); K.add(hDark, box(0.0002, 0.0030, 0.0027), [x + 0.0009, 0.0015, 0.0440]); } L.add(glow, box(0.0054, 0.0004, 0.0028), [-0.0068, 0.0031, 0.0440]); // contenedores de carga
    for (let i = 0; i < 3; i++) { const z = -0.014 + i * 0.014; Kp.add(pvM, box(0.0108, 0.0008, 0.0125), [-0.0425, 0.0036, z], [0, 0, 0.42]); K.add(hDark, box(0.0114, 0.0006, 0.0131), [-0.0425, 0.0032, z], [0, 0, 0.42]); K.add(hDark, cyl(0.0004, 0.0004, 0.0034, 5), [-0.0425, 0.0016, z]); } // campo de paneles solares (oeste)
    return (_sc = { parts: keepAll([...K.parts(), ...L.parts(), ...Kp.parts(), ...rocks()]) });
  }
  function scenery(g, glow, sk) {
    for (const [m, geo] of sceneryParts().parts) g.add(new THREE.Mesh(geo, m === GP ? glow : m));
    const K = kit(0.03), r0 = PAD_R + 0.0011, dh = sk + 0.0008;
    K.add(concrete, cyl(PAD_R, PAD_R + 0.003, dh, 40), [0, -dh / 2, 0]); K.add(hArmor, cyl(PAD_R + 0.0008, PAD_R + 0.0008, 0.0024, 40), [0, -0.0018, 0]); // cuerpo y faja de acero del borde
    K.add(rockM, new THREE.CylinderGeometry(r0, r0 + dh * 1.2 + 0.0015, dh + 0.0004, 28, 1, true), [0, -dh / 2 - 0.0002, 0]); // talud de tierra: oculta el desnivel del terreno bajo la plataforma
    K.build(g);
  }
  let _tw = null; // torreta (zócalo y columna): geometría cacheada y compartida por las 4 torretas de todas las bases
  function towerParts() {
    if (_tw) return _tw; const K = kit(0.03), C = kit(0.03), glowM = GP;
    K.add(concrete, cyl(0.0062, 0.0066, 0.0016, 18), [0, 0.0008, 0]); K.add(hArmor, cyl(0.0048, 0.0054, 0.0052, 14), [0, 0.0042, 0]); K.add(glowM, torusH(0.0051, 0.00025), [0, 0.0030, 0]); K.add(hDark, box(0.0018, 0.0026, 0.0006), [0, 0.0034, 0.0053]);
    for (let i = 0; i < 8; i++) { const a = i * PI / 4 + PI / 8; K.add(hDark, box(0.0009, 0.0006, 0.0009), [Math.cos(a) * 0.0057, 0.0019, Math.sin(a) * 0.0057]); } // pernos del zócalo
    C.add(hArmor, cyl(0.0027, 0.0034, 0.0150, 12), [0, 0.0143, 0]); C.add(hSteel, cyl(0.0050, 0.0052, 0.0010, 18), [0, 0.0217, 0]); C.add(glowM, torusH(0.0051, 0.00022), [0, 0.0222, 0]); C.add(hDark, cyl(0.0004, 0.0004, 0.0120, 5), [0.0033, 0.0143, 0.0007]);
    for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; C.add(hDark, box(0.0006, 0.0140, 0.0010), [Math.cos(a) * 0.0031, 0.0143, Math.sin(a) * 0.0031], [0, -a, 0]); } // nervios de la columna
    return (_tw = { K: keepAll(K.parts()), C: keepAll(C.parts()) });
  }
  function tower(glowM) { // base y columna de una torreta: el zócalo queda como ruina al destruirla; la columna (col) desaparece con la cabeza
    const T = towerParts(), t = new THREE.Group(), col = new THREE.Group(), fill = (parent, list) => { for (const [m, geo] of list) parent.add(new THREE.Mesh(geo, m === GP ? glowM : m)); };
    fill(t, T.K); fill(col, T.C); t.add(col); return { g: t, col };
  }
  let _bt = null; const beaconTex = () => _bt || (_bt = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })());
  function build(h) {
    const g = new THREE.Group(), col = h.o === myId ? mySpec.c : (() => { try { return JSON.parse(remotes.get(h.o).spk).c; } catch { return 0xff6a3c; } })(), glow = new THREE.MeshBasicMaterial({ color: col });
    scenery(g, glow, 0.004 + h.info.range);
    h.towers = TW.map(([x, z]) => {
      const tw = tower(glow), head = new THREE.Group(); tw.g.position.set(x, 0, z); head.position.y = HEAD_Y; tw.g.add(head); g.add(tw.g);
      return { g: tw.g, head, col: tw.col, cd: Math.random() * TW_CD };
    });
    setHeads(h);
    h.dome = new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 16), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })); h.dome.position.y = 0.01; h.dome.visible = false; g.add(h.dome);
    h.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: beaconTex(), color: h.o === myId ? 0x4db8ff : 0xff4030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false })); h.beacon.scale.set(0.065, 0.065, 1); h.beacon.visible = false; scene.add(h.beacon);
    g.visible = false; scene.add(g); h.grp = g; h.q = new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...h.dir)); h.tcd = 0;
  }
  function model(ts, tw, shield, col) { // maqueta para el menú (pestaña BASE): mismo modelo que el del juego (unidades km), con las torretas apuntando hacia arriba y afuera
    const g = new THREE.Group(), glow = new THREE.MeshBasicMaterial({ color: col ?? 0x4db8ff }); scenery(g, glow, 0.006);
    TW.forEach(([x, z], i) => { const t = tower(glow); t.g.position.set(x, 0, z); if (!(tw[i] > 0)) t.col.visible = false; else { const hd = styleHead(ts[i]); hd.position.y = HEAD_Y; hd.rotation.set(0.3, x > 0 ? -0.5 : 0.5, 0, 'YXZ'); t.g.add(hd); } g.add(t.g); });
    if (shield) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.095, 28, 18), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide })); d.position.y = 0.01; g.add(d); }
    return g;
  }
  function clearShot(bb, from, to) { // ¿el segmento torreta→objetivo queda por encima del terreno (y del planeta)?
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], L = Math.hypot(dx, dy, dz), n = Math.min(80, Math.ceil(L / 0.12));
    for (let k = 1; k < n; k++) { const t = k / n, d = [from[0] + dx * t - bb.pos[0], from[1] + dy * t - bb.pos[1], from[2] + dz * t - bb.pos[2]], l = Math.hypot(d[0], d[1], d[2]); if (l < planets.surfaceR(bb, d, l) + 0.002) return false; }
    return true;
  }
  function idle(t, i, h, now) { // cabeza de la torreta mirando de un punto a otro: cada 2-4,5 s elige una dirección nueva y gira hacia ella con suavidad
    const moved = t.yaw !== undefined && (Math.abs(t.head.rotation.y - t.yaw) > 0.02 || Math.abs(t.head.rotation.x - t.pit) > 0.02); // el bucle de tiro apuntó a un objetivo: retomar la vigilancia desde donde quedó
    if (t.next === undefined || now > t.next || moved) { t.y0 = moved || t.yaw === undefined ? t.head.rotation.y : t.yaw; t.p0 = moved || t.pit === undefined ? t.head.rotation.x : t.pit; t.y1 = t.y0 + (Math.random() - 0.5) * 3.6; t.p1 = 0.04 + Math.random() * 0.45; t.t0 = now; t.next = now + 2000 + Math.random() * 2500; }
    const k = Math.min(1, (now - t.t0) / 1100), e = k * k * (3 - 2 * k); t.yaw = t.y0 + (t.y1 - t.y0) * e; t.pit = t.p0 + (t.p1 - t.p0) * e; t.head.rotation.set(t.pit, t.yaw, 0, 'YXZ');
  }
  const _hp = {}; // piezas de cada estilo de cabeza: se construyen UNA vez (4 estilos) y las comparten todas las torretas
  function styleHead(style) { const g = new THREE.Group(); for (const [m, geo] of _hp[style] || (_hp[style] = keepAll(headKit(style)))) g.add(new THREE.Mesh(geo, m)); return g; }
  function headKit(style) { // cabeza de la torreta (eje en el origen, cañón hacia -z): plasma = dos cañones con bobinas · munición = cañón rotativo con cajas de munición · misil = dos racks de tubos con misiles · riel = dos raíles largos con bobinas y disipadores
    const K = kit(0.03), gm = new THREE.MeshBasicMaterial({ color: TOWER_STYLES[style].col });
    K.add(hSteel, new THREE.SphereGeometry(0.0048, 18, 10), [0, 0, 0.0004], [0, 0, 0], [1, 0.72, 1.12]); K.add(hDark, cyl(0.0046, 0.0050, 0.0010, 18), [0, -0.0030, 0]); K.add(hArmor, box(0.0072, 0.0034, 0.0016), [0, 0, -0.0044]); K.add(hDark, box(0.0074, 0.0006, 0.0018), [0, 0.0010, -0.0044]); // cúpula, aro y escudo frontal del cañón
    K.add(gm, new THREE.SphereGeometry(0.0004, 6, 5), [-0.0040, 0.0016, -0.0020]); K.add(gm, new THREE.SphereGeometry(0.0004, 6, 5), [0.0040, 0.0016, -0.0020]); K.add(hDark, box(0.0030, 0.0014, 0.0036), [0, 0.0025, 0.0022]); // luces de estado y caja de control
    if (style === 'plasma') {
      for (const sx of [-1, 1]) { const x = sx * 0.0027;
        K.add(hDark, cylZ(0.0011, 0.0012, 0.0090, 10), [x, 0, -0.0092]); K.add(hDark, cylZ(0.0011, 0.0017, 0.0012, 10), [x, 0, -0.0138]); K.add(gm, cylZ(0.00042, 0.00042, 0.0102, 6), [x, 0, -0.0100]); K.add(gm, new THREE.SphereGeometry(0.0007, 8, 6), [x, 0, -0.0146]);
        for (const z of [-0.0058, -0.0076, -0.0094, -0.0112]) K.add(gm, new THREE.TorusGeometry(0.00145, 0.00028, 5, 14), [x, 0, z]); // bobinas
        K.add(hSteel, cylZ(0.0016, 0.0016, 0.0008, 10), [x, 0, -0.0050]); K.add(hDark, cylZ(0.0009, 0.0009, 0.0050, 8), [sx * 0.0030, 0.0012, 0.0030]); K.add(gm, cylZ(0.0010, 0.0010, 0.0004, 8), [sx * 0.0030, 0.0012, 0.0056]); }
      K.add(hDark, box(0.0034, 0.0018, 0.0030), [0, 0.0016, 0.0040]); K.add(gm, box(0.0022, 0.0004, 0.0032), [0, 0.0027, 0.0040]); // capacitores traseros
    } else if (style === 'cannon') {
      K.add(hDark, cylZ(0.0018, 0.0018, 0.0040, 12), [0, 0, -0.0042]); K.add(hSteel, cylZ(0.0019, 0.0019, 0.0009, 12), [0, 0, -0.0068]); K.add(hSteel, cylZ(0.0017, 0.0017, 0.0007, 12), [0, 0, -0.0085]); K.add(hSteel, cylZ(0.0016, 0.0016, 0.0008, 12), [0, 0, -0.0126]); // motor y anillos del tambor
      for (let i = 0; i < 6; i++) { const a = i * PI / 3; K.add(hDark, cylZ(0.00042, 0.00042, 0.0084, 6), [Math.cos(a) * 0.0011, Math.sin(a) * 0.0011, -0.0096]); K.add(gm, ball3(0.00032), [Math.cos(a) * 0.0011, Math.sin(a) * 0.0011, -0.0138]); }
      K.add(gm, cylZ(0.00028, 0.00028, 0.0090, 5), [0, 0, -0.0096]);
      for (const sx of [-1, 1]) { K.add(hAmmo, box(0.0026, 0.0030, 0.0046), [sx * 0.0050, -0.0006, 0.0004]); K.add(gm, box(0.0027, 0.0004, 0.0030), [sx * 0.0050, 0.0010, 0.0004]); K.add(hDark, box(0.0028, 0.0004, 0.0048), [sx * 0.0050, -0.0022, 0.0004]);
        for (let i = 0; i < 5; i++) K.add(hSteel, box(0.0006, 0.0005, 0.0009), [sx * (0.0036 - i * 0.00042), 0.0012 - i * 0.00018, -0.0016 - i * 0.0006]); } // cajas de munición con cintas de alimentación
    } else if (style === 'missile') {
      for (const sx of [-1, 1]) { const cx = sx * 0.0037;
        K.add(hArmor, box(0.0044, 0.0054, 0.0064), [cx, 0.0004, -0.0037]); K.add(gm, box(0.0046, 0.0003, 0.0064), [cx, 0.0031, -0.0037]); K.add(gm, box(0.0046, 0.0004, 0.0009), [cx, 0.0028, -0.0069]); K.add(hDark, box(0.0034, 0.0030, 0.0014), [cx, 0.0004, 0.0000]); // rack y franja de color
        for (const ix of [-1, 1]) for (const iy of [-1, 1]) { const x = cx + ix * 0.0010, y = 0.0004 + iy * 0.0013;
          K.add(hSteel, cylZ(0.00085, 0.00085, 0.0072, 8), [x, y, -0.0048]); K.add(hDark, cylZ(0.00066, 0.00066, 0.0004, 8), [x, y, -0.0084]); K.add(hWhite, cylZ(0.00050, 0.00050, 0.0048, 8), [x, y, -0.0090]); K.add(gm, new THREE.ConeGeometry(0.00050, 0.0016, 8).rotateX(-PI / 2), [x, y, -0.0122]); } } // 4 tubos por rack con el misil asomando
      K.add(hSteel, new THREE.SphereGeometry(0.0014, 10, 6, 0, PI * 2, 0, PI / 2), [0, 0.0032, -0.0010]); K.add(hDark, cyl(0.00025, 0.00025, 0.0030, 5), [0.0006, 0.0048, 0.0006]); K.add(gm, new THREE.SphereGeometry(0.0003, 6, 5), [0.0006, 0.0064, 0.0006]); // sensor de guiado
    } else {
      for (const sx of [-1, 1]) { K.add(hSteel, box(0.0011, 0.0016, 0.0190), [sx * 0.0011, 0, -0.0125]); K.add(hDark, box(0.0011, 0.0004, 0.0190), [sx * 0.0011, 0.0009, -0.0125]);
        K.add(hDark, cylZ(0.0013, 0.0013, 0.0044, 10), [sx * 0.0031, 0.0019, 0.0030]); for (const z of [0.0014, 0.0046]) K.add(gm, new THREE.TorusGeometry(0.00136, 0.0002, 4, 12), [sx * 0.0031, 0.0019, z]); } // raíles y condensadores
      K.add(gm, box(0.0005, 0.0007, 0.0182), [0, 0, -0.0125]);
      for (let i = 0; i < 5; i++) { const z = -0.0058 - i * 0.0030; K.add(hArmor, box(0.0048, 0.0034, 0.0012), [0, 0, z]); K.add(gm, box(0.0030, 0.0005, 0.0014), [0, 0.0014, z]); K.add(gm, box(0.0030, 0.0005, 0.0014), [0, -0.0014, z]); } // bobinas aceleradoras
      for (let i = 0; i < 6; i++) K.add(hDark, box(0.0036, 0.0002, 0.0034), [0, 0.0032 + i * 0.0005, 0.0006]); // disipador de calor
      K.add(hDark, box(0.0052, 0.0030, 0.0018), [0, 0, -0.0216]); K.add(hSteel, box(0.0014, 0.0030, 0.0020), [0, 0, -0.0218]); K.add(gm, box(0.0009, 0.0009, 0.0004), [0, 0, -0.0228]); // freno de boca
    }
    return K.parts();
  }
  function setHeads(h) { if (!h.towers) return; h.towers.forEach((t, i) => { if (t.style === h.ts[i]) return; t.style = h.ts[i]; t.g.remove(t.head); t.head.traverse(o => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); }); const nh = styleHead(h.ts[i]); nh.position.y = HEAD_Y; nh.visible = t.head.visible; t.g.add(nh); t.head = nh; }); }
  const worldOf = h => { const b = bodyBy(h.b), r = b.R + h.info.top; return b.pos.map((c, i) => c + h.dir[i] * r); };
  const localToWorld = (h, x, y, z) => { const w = worldOf(h), v = new THREE.Vector3(x * BK, y * BK, z * BK).applyQuaternion(h.q); return [w[0] + v.x, w[1] + v.y, w[2] + v.z]; };

  function applyTw(h, tw, silent) { // vida de las 4 torretas: al caer a 0 la torreta queda destruida (sin cabeza ni columna) y deja de disparar
    if (!tw || !h.towers) return;
    tw.forEach((v, i) => { const t = h.towers[i]; if (!t) return; const was = h.tw ? h.tw[i] : TW_HP; if (was > 0 && v <= 0 && !silent && h.grp.visible) boom(localToWorld(h, t.g.position.x, HEAD_Y * 0.8, t.g.position.z), 0.03); t.head.visible = v > 0; t.col.visible = v > 0; });
    h.tw = tw.slice();
  }
  function drop(h) { if (h.beacon) { scene.remove(h.beacon); h.beacon.material.dispose(); } if (h.grp) { scene.remove(h.grp); h.grp.traverse(o => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); }); } planets.removePad(h.b, h.dir); }
  function sync(list) { // lista de hangares del servidor
    const seen = new Set();
    for (const e of list) {
      seen.add(e.o); let h = HG.get(e.o);
      if (!h) {
        const b = bodyBy(e.b); if (!b) continue; const dir = dirOf(e.la, e.lo), info = padInfo(b, dir);
        h = { o: e.o, nm: e.nm, b: e.b, la: e.la, lo: e.lo, hp: e.hp, sh: e.sh || 0, up: e.up || {}, st: baseStats(e.up || {}), ts: (e.ts || ['plasma', 'plasma', 'plasma', 'plasma']).slice(), dir, info, tw: null, bot: !!e.bot, sp: e.sp || null }; HG.set(e.o, h); planets.addPad(e.b, dir, PAD_R * BK, info.top); build(h); applyTw(h, e.tw || [h.st.twMax, h.st.twMax, h.st.twMax, h.st.twMax], true);
        if (e.o === myId) { hadHangar = true; defeated = false; if (LB.phase !== 'lobby' && !started) startGame(); else if (pendingSpawn) { pendingSpawn = false; if (P.hp > 0) { spawn(); P.deadUntil = 0; } } }
      } else { if (e.o === myId && lastHp !== null && e.hp < lastHp - 0.5 && performance.now() - lastAlert > 4000) { lastAlert = performance.now(); say('¡TU HANGAR ESTÁ BAJO ATAQUE!'); if (typeof attackAlert === 'function') attackAlert('b', '', null); } h.sp = e.sp || null; h.hp = e.hp; h.sh = e.sh || 0; h.up = e.up || h.up; h.st = baseStats(h.up); h.nm = e.nm; h.bot = !!e.bot; applyTw(h, e.tw); if (e.ts && e.ts.some((v, i) => v !== h.ts[i])) { h.ts = e.ts.slice(); setHeads(h); } }
      if (e.o === myId) lastHp = e.hp;
    }
    for (const [o, h] of [...HG]) if (!seen.has(o)) { drop(h); HG.delete(o); if (o === myId && hadHangar) lost(); }
    if (typeof BASES !== 'undefined') { BASES.length = 0; for (const h of HG.values()) BASES.push({ owner: h.nm, name: 'Hangar', body: h.b, lat: h.la, lon: h.lo }); }
  }
  function lost() { // tu hangar fue destruido: derrota
    hadHangar = false; defeated = true; lastHp = null; chooserShown = false;
    if (P.hp > 0) { P.cause = 'tu hangar fue destruido'; P.hp = 0; P.sh = 0; P.deaths = (P.deaths || 0) + 1; P.deadUntil = performance.now() + 2500; S.v = 0; boom(S.pos, 60); }
  }
  function onEvent(e) {
    if (e.t === 'hdead') { const h = HG.get(e.o); if (h) boom(worldOf(h), 80); if (e.o === myId) say('¡HANGAR DESTRUIDO!'); }
  }
  function onClaim(ok) {
    claimT = 0;
    if (ok) { LB.pick = pendingPick; if (LB.phase === 'playing') pendingSpawn = true; render(); return; }
    pendingSpawn = false; pendingPick = null; if (LB.phase === 'playing') document.exitPointerLock(); show('Ese planeta acaba de ser ocupado por otro piloto. Elige otro.');
  }
  // ---------- menú principal: crear sala (genera los planetas) o unirse; pantallas de carga ----------
  const MM = { booted: false }; let siteSent = false, siteT = 0; const bSent = new Set();
  const ldg = document.createElement('div'); ldg.id = 'ldg'; ldg.innerHTML = '<h2></h2><div class="sub"></div><div class="bar"><i></i></div><div class="pct"></div><div class="lst"></div>'; document.body.append(ldg);
  const css2 = document.createElement('style'); css2.textContent = `#mm{position:fixed;inset:0;z-index:13;display:none;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#0b2236,#02060c 70%);color:#cfe9f7;font-family:ui-monospace,Consolas,monospace}
  #mm .mmb{width:min(440px,90vw);display:grid;gap:10px}#mm h1{letter-spacing:.3em;margin:0;text-align:center;font-size:20px}#mm .sub{text-align:center;color:#9fd4ee;margin-bottom:10px}#mm label{font-size:11px;letter-spacing:.15em;color:#7fb6d4}
  #mm input{background:#04121e;border:1px solid #2a5a78;color:#dff4ff;border-radius:8px;padding:9px;font:inherit}#mm .big{padding:14px;border-radius:10px;border:1px solid #4db8ff;background:#0b3a5a;color:#fff;font:inherit;font-weight:bold;letter-spacing:.15em;cursor:pointer;margin-top:6px}#mm .big:hover{background:#125080}
  #mm .room{background:#08202f;border:1px solid #1d4a66;border-radius:10px;padding:12px;display:grid;gap:4px}#mm .room span{color:#9fd4ee;font-size:12px}#mm .hint{color:#8fb8d0;font-size:11px;text-align:center}#mm .err{color:#ffd23f;text-align:center;min-height:16px}
  #ldg{position:fixed;inset:0;z-index:35;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#02060cf2;color:#cfe9f7;font-family:ui-monospace,Consolas,monospace}#ldg h2{letter-spacing:.3em;margin:0}#ldg .sub{color:#9fd4ee;min-height:18px}
  #ldg .bar{width:min(460px,80vw);height:12px;border:1px solid #2a5a78;border-radius:7px;overflow:hidden;background:#04121e}#ldg .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#4db8ff,#5dff8a);transition:width .2s}#ldg .pct{font-size:22px;font-weight:bold}
  #ldg .lst{width:min(520px,86vw);display:grid;gap:5px;max-height:calc(100vh - 250px);overflow:hidden}#ldg .lst.two{grid-template-columns:1fr 1fr;width:min(760px,92vw)}
  #ldg .pr{position:relative;display:flex;align-items:center;gap:8px;box-sizing:border-box;border:2px solid #050f1c;border-radius:12px;background:#0a2233;overflow:hidden;padding:0 10px 0 3px;min-height:0}
  #ldg .pr .fill{position:absolute;left:0;top:0;bottom:0;width:var(--p);background:linear-gradient(90deg,#1a67a6,#4db8ff 75%,#8fe8ff);box-shadow:0 0 16px #4db8ffcc;transition:width .25s;animation:ldglow 1.1s ease-in-out infinite}#ldg .pr.done .fill{background:linear-gradient(90deg,#1c9a4e,#5dff8a);box-shadow:0 0 14px #5dff8a99;animation:none}
  @keyframes ldglow{50%{filter:brightness(1.45);box-shadow:0 0 26px #8fe8ffff}}
  #ldg .pr .av{position:relative;flex:none;height:calc(100% - 6px);aspect-ratio:1;border-radius:50%;border:2px solid #050f1c;overflow:hidden;background:#fff;box-shadow:0 2px 0 #050f1c}#ldg .pr .av svg{display:block;width:100%;height:100%}
  #ldg .pr .nm{position:relative;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;text-shadow:0 1px 3px #000}#ldg .pr b{position:relative;text-shadow:0 1px 3px #000}`; document.head.append(css2);
  function onWelcome() { let tk = ''; try { tk = sessionStorage.getItem('token') || ''; } catch {} send({ t: 'resume', token: tk }); } // la página del juego se reengancha con el mismo jugador que creó/entró a la sala en el menú
  function onRoomMsg(m) { if (m.resumed === 0) location.href = '/'; } // sin sala (o sin ser miembro): de vuelta al menú principal
  window.BOOT_DONE = async () => { // fin de la carga de módulos: se generan las texturas de todos los planetas con barra de progreso
    const bar = document.querySelector('#boot .bb i'), st = document.querySelector('#boot .bs'), list = bodies.filter(b => b.k !== 'sun'), nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    for (let i = 0; i < list.length; i++) { st.textContent = `Generando planetas… ${i + 1}/${list.length} · ${list[i].n}`; bar.style.width = (45 + 55 * i / list.length) + '%'; await nextFrame(); try { MAP.warm(list[i]); } catch {} }
    st.textContent = 'Sistema listo'; bar.style.width = '100%'; await new Promise(r => setTimeout(r, 300)); document.getElementById('boot').style.display = 'none'; MM.booted = true; ldg.style.display = 'flex'; ldg.querySelector('h2').textContent = 'PREPARANDO LA PARTIDA'; ldg.querySelector('.sub').textContent = 'Esperando a los demás jugadores…';
    if (window.__welcome) onWelcome(window.__welcome);
  };
  let loading = false, ldPct = 0, ldSend = 0, ldFrames = 0;
  function beginLoading() { loading = true; ldPct = 0; ldFrames = 0; ldg.style.display = 'flex'; ldg.querySelector('h2').textContent = 'CARGANDO PARTIDA'; }
  let BLOB = null; import('/blobatar.js').then(m => { BLOB = m.blobatar; }).catch(() => {}); // fotos de perfil (Blobatar) en la pantalla de carga
  function loadTick(now) { // precarga el terreno y los objetos alrededor de la base; la partida empieza cuando todos los jugadores llegan al 100 %
    planets.warm(S.pos, 6); const pr = planets.loadProgress(S.pos), warm = ++ldFrames > 20; ldPct = warm ? Math.min(100, Math.round(100 * (0.6 * pr.rings + 0.4 * pr.cells))) : 0;
    if (now - ldSend > 250 || ldPct >= 100 && ldSend !== -1) { ldSend = ldPct >= 100 ? -1 : now; send({ t: 'ld', p: ldPct }); }
    ldg.querySelector('.bar i').style.width = ldPct + '%'; ldg.querySelector('.pct').textContent = ldPct + ' %'; ldg.querySelector('.sub').textContent = ldPct < 100 ? 'Cargando el terreno y los recursos alrededor de tu base…' : (LB.phase === 'playing' ? '¡Todo listo!' : 'Esperando a los demás jugadores…');
    { const rows = LB.list.filter(x => x.b), lst = ldg.querySelector('.lst'), two = rows.length > 6, n = two ? Math.ceil(rows.length / 2) : rows.length, avail = Math.max(60, innerHeight - 300), rh = Math.max(20, Math.min(46, Math.floor((avail - (n - 1) * 5) / n))); // la fila se reduce si hay muchos jugadores: nunca pasa del alto disponible
      lst.classList.toggle('two', two); lst.innerHTML = rows.map(x => { const v = x.id === myId ? ldPct : (x.ld ?? 0), av = BLOB && x.av ? BLOB(x.av, { background: 'circle' }) : ''; return `<div class="pr${v >= 100 ? ' done' : ''}" style="--p:${v}%;height:${rh}px;font-size:${Math.max(10, Math.min(13, rh * 0.32))}px"><i class="fill"></i><span class="av">${av}</span><span class="nm">${x.nm || 'Piloto'}${x.id === myId ? ' (tú)' : ''}</span><b>${v} %</b></div>`; }).join(''); }
    if (ldPct >= 100 && LB.phase === 'playing') { loading = false; ldg.style.display = 'none'; say('¡Partida iniciada! Esc abre el menú de mejoras'); }
  }
  function startGame() { // el administrador inició la partida (o te uniste con ella en marcha): nave básica, inventario vacío, reaparecer en tu hangar
    started = true; chooserShown = false; pl.style.display = 'none'; myName = ($('lbName') && $('lbName').value || myName).slice(0, 16) || 'Piloto';
    FOOT.resetInv(ROOMCFG); if (typeof resetShips === 'function') resetShips(); resetLv(); const b0 = basicSpec(mySpec.c, mySpec.sk); saveSpec(b0); applyLoadout(b0, true); P.kills = 0; P.deaths = 0; P.deadUntil = 0;
    if (typeof refresh === 'function') { sel = JSON.parse(JSON.stringify(b0)); refresh(); }
    document.exitPointerLock(); ov.style.display = 'none'; say('¡Partida iniciada! Esc abre el menú de mejoras'); // el menú no se abre solo: haz clic para tomar el control
    { const pn = document.getElementById('pname'); if (pn) pn.value = myName; }
    beginLoading();
  }
  let ROOMCFG = { mode: 'normal', start: { agua: 10, piedra: 10, cobre: 10 } }; // modo y recursos iniciales de la sala (llegan en el tick)
  function onLobby(m) { // fase, lista de jugadores y administrador que envía el servidor
    if (m.rm) ROOMCFG = { mode: m.rm.mode, start: m.rm.start };
    LB.phase = m.ph; LB.list = m.lb || []; LB.bots = m.bl || []; LB.adm = m.adm; const mine = LB.list.find(x => x.id === myId); if (mine && !mine.b) LB.pick = null; else if (mine && mine.b) LB.pick = mine.b;
    if (LB.phase === 'lobby') { if (MM.booted) location.href = '/'; return; } // la sala volvió a la espera o se cerró
    if (!started && HG.has(myId)) startGame();
    const now = performance.now(); if (MM.booted && LB.phase !== 'playing' && now > siteT) { siteT = now + 1200; // cada cliente calcula el emplazamiento de su base con su terreno; el anfitrión también el de los bots
      if (mine && mine.b && !siteSent) { const s = findSite(bodyBy(mine.b)); if (s) { siteSent = true; send({ t: 'site', la: s.la, lo: s.lo }); } }
      if (LB.adm === myId) for (const x of LB.bots) if (x.la == null && !bSent.has(x.b)) { const s = findSite(bodyBy(x.b)); if (s) { bSent.add(x.b); send({ t: 'bsite', b: x.b, la: s.la, lo: s.lo }); } } }
    const sig = JSON.stringify([LB.phase, LB.list, LB.bots, LB.adm, [...HG.keys()]]); if (chooserShown && sig !== LB.sig) { LB.sig = sig; render(); }
  }

  // ---------- selector de planeta ----------
  const $ = id => document.getElementById(id);
  pl.innerHTML = `<div class="lbx"><h1>SALA DE PARTIDA</h1><div class="sub"></div><div class="msg"></div><div class="lbmain"><div><div class="grid2"></div></div><div class="side"><h3>JUGADORES</h3><div class="pl"></div>
    <div id="lbMine"><input type="text" id="lbName" maxlength="16" placeholder="Tu nombre"><button id="lbReady">LISTO</button></div>
    <button id="lbStart" class="go">INICIAR PARTIDA</button><div class="hint"></div></div></div></div>`;
  const q = sel => pl.querySelector(sel);
  const fitPl = () => { if (pl.style.display !== 'none') fitBox(q('.lbx'), 1040); };
  addEventListener('resize', fitPl);
  function show(msg) { chooserShown = true; if (msg !== undefined) q('.msg').textContent = msg; else if (!q('.msg').textContent) q('.msg').textContent = ''; pl.style.display = 'flex'; fitPl(); if (!$('lbName').value) $('lbName').value = myName === 'Piloto' ? '' : myName; render(); }
  function render() {
    const play = LB.phase === 'playing', me = LB.list.find(x => x.id === myId) || {}, isAdm = LB.adm === myId;
    q('.sub').textContent = play ? 'Elige un planeta para establecer tu hangar. Mientras exista, reaparecerás en él; si lo destruyen, quedas derrotado.' : 'Elige tu planeta de origen y márcate como LISTO. En los demás planetas puedes poner un bot IA enemigo para enfrentarte. Cuando todos estén listos, el administrador (★) inicia.';
    q('.grid2').innerHTML = bodies.filter(b => b.k !== 'sun').map(b => {
      const hum = LB.list.find(x => x.b === b.n && x.id !== myId) || [...HG.values()].find(h => h.b === b.n && h.o !== myId && h.o < 1000), bot = LB.bots.some(x => x.b === b.n) || [...HG.values()].some(h => h.b === b.n && h.o >= 1000), mineB = LB.pick === b.n, moons = bodies.filter(m => m.parent === b).length, orb = b.parent ? `luna de ${b.parent.n}` : `órbita ${(b.a * DIST_SCALE / 1e6).toFixed(1)} M km`;
      return `<div class="card${mineB ? ' mine' : ''}${hum || bot ? ' dis' : ''}" data-b="${b.n}"><div class="orb" style="background:radial-gradient(circle at 32% 30%,${b.c2},${b.c1})"></div><div><b>${b.n}</b><span class="tag">${b.label || ''}${hum ? ' · OCUPADO por ' + (hum.nm || 'otro piloto') : bot ? ' · BOT ENEMIGO' : mineB ? ' · TU PLANETA' : ''}</span><small>${b.desc || ''}</small><small>radio ${Math.round(b.R).toLocaleString('es')} km · ${orb}${moons ? ' · ' + moons + ' luna' + (moons > 1 ? 's' : '') : ''}</small>${!play && !hum && !mineB ? `<button class="botbtn${bot ? ' on' : ''}" data-bot="${b.n}">${bot ? '✕ Quitar bot' : '+ Bot IA enemigo'}</button>` : ''}</div></div>`;
    }).join('');
    q('.pl').innerHTML = LB.list.map(x => `<div class="${x.id === myId ? 'me' : ''}"><span>${x.id === LB.adm ? '★ ' : ''}${x.nm || 'Piloto'}</span><span class="${x.ready || play && x.b ? 'ok' : ''}">${x.b ? x.b : 'sin planeta'}${x.ready && !play ? ' ✔' : ''}</span></div>`).join('') + LB.bots.map(x => `<div><span>🤖 BOT</span><span>${x.b}</span></div>`).join('') || '<div>…</div>';
    const rb = $('lbReady'); rb.disabled = !me.b; rb.textContent = me.ready ? 'LISTO ✔ (quitar)' : 'LISTO'; rb.classList.toggle('on', !!me.ready); q('#lbMine').style.display = play ? 'none' : '';
    const st = $('lbStart'); st.style.display = !play && isAdm ? '' : 'none'; const all = LB.list.length && LB.list.every(x => x.b && (x.id === LB.adm || x.ready)); st.disabled = !all;
    fitPl();
    q('.hint').textContent = play ? '' : isAdm ? (all ? 'Todos listos: ya puedes iniciar.' : 'Faltan jugadores por elegir planeta y marcar LISTO.') : 'Esperando a que el administrador inicie la partida.';
  }
  pl.addEventListener('click', e => {
    if (e.target.closest('#lbReady')) { const me = LB.list.find(x => x.id === myId) || {}; return send({ t: 'lb', ready: !me.ready, nm: $('lbName').value || 'Piloto' }); }
    if (e.target.closest('#lbStart')) return send({ t: 'start' });
    const bb = e.target.closest('.botbtn'); // poner o quitar un bot IA enemigo en ese planeta
    if (bb) { const b = bodyBy(bb.dataset.bot); if (LB.bots.some(x => x.b === b.n)) return send({ t: 'botset', b: b.n, on: false }); const site = findSite(b); if (!site) return show('No se encontró tierra firme llana para la base del bot. Prueba otro planeta.'); return send({ t: 'botset', b: b.n, on: true, la: site.la, lo: site.lo }); }
    const c = e.target.closest('.card'); if (!c || c.classList.contains('dis')) return;
    const b = bodyBy(c.dataset.b), site = findSite(b);
    if (!site) return show('No se encontró tierra firme llana en ese planeta. Prueba otro.');
    myName = ($('lbName').value || myName || 'Piloto').slice(0, 16); pendingPick = b.n; claimT = 4;
    if (LB.phase === 'playing') { chooserShown = false; pl.style.display = 'none'; renderer.domElement.requestPointerLock(); } // en partida el clic captura el ratón y creas el hangar al momento
    send({ t: 'claim', b: b.n, la: site.la, lo: site.lo, nm: myName });
  });
  pl.addEventListener('change', e => { if (e.target.id === 'lbName') { myName = e.target.value.slice(0, 16) || 'Piloto'; send({ t: 'lb', nm: myName }); } });

  // ---------- aparecer sobre la plataforma ----------
  function spawnAt(h) {
    const b = bodyBy(h.b); if (!b || !h.info) return false;
    const dR = h.dir.map(c => c * b.R), r = planets.surfaceR(b, dR, b.R), up = new THREE.Vector3(...h.dir), e = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    const pos = b.pos.map((c, i) => c + h.dir[i] * (r + ship.gearH));
    S.pos = pos.slice(); S.shipPos = pos.slice(); S.v = 0; S.foot.on = false; S.gearK = 1; S.auto = false;
    Object.assign(S.park, { on: true, b, dir: h.dir.slice(), h: ship.gearH, water: false, upT: null, leaving: false, dustT: 0 });
    S.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), e.lengthSq() ? e : new THREE.Vector3(1, 0, 0), up)); camQ.copy(S.q); S.w.p = S.w.y = S.w.r = 0;
    return true;
  }

  // ---------- por cuadro: visibilidad, torretas ----------
  const clk = document.createElement('div'); clk.id = 'clk'; clk.textContent = 'HAZ CLIC PARA TOMAR EL CONTROL · Esc: menú de mejoras'; clk.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:5;display:none;background:#00121fcc;border:1px solid #4db8ff;border-radius:10px;padding:10px 18px;color:#dff4ff;font:bold 14px ui-monospace,Consolas,monospace;letter-spacing:.08em;pointer-events:none;text-shadow:0 0 6px #000'; document.body.append(clk);
  renderer.domElement.addEventListener('click', () => { if (started && !document.pointerLockElement && ov.style.display === 'none' && !window.MAPOPEN) renderer.domElement.requestPointerLock(); });
  function frame(dt, now) {
    clk.style.display = started && !loading && !document.pointerLockElement && ov.style.display === 'none' && !window.MAPOPEN && !chooserShown && P.hp > 0 ? 'block' : 'none';
    if (claimT > 0 && (claimT -= dt) <= 0) { pendingSpawn = false; if (LB.phase === 'playing') document.exitPointerLock(); show('El servidor no respondió. Inténtalo otra vez.'); }
    if (defeated && P.hp <= 0 && now >= P.deadUntil && !chooserShown && !(typeof WAR !== 'undefined' && WAR.mine().length)) { document.exitPointerLock(); show('DERROTA: tu hangar fue destruido. Elige un planeta para reconstruirlo.'); }
    if (loading) loadTick(now);
    const alive = P.hp > 0 && !S.warp.on && !loading;
    for (const h of HG.values()) {
      if (!h.grp) continue; const w = worldOf(h), d = Math.hypot(w[0] - S.pos[0], w[1] - S.pos[1], w[2] - S.pos[2]);
      h.grp.visible = d < 600; h.d = d;
      if (h.beacon) { const bw = [w[0] + h.dir[0] * 6, w[1] + h.dir[1] * 6, w[2] + h.dir[2] * 6], bv = view(bw); h.beacon.position.set(bv.x, bv.y, bv.z); h.beacon.visible = d > 12; } // a 6 km sobre la base: no la tapa el suelo
      if (h.grp.visible && h.dome) { h.dome.visible = h.sh > 0; h.dome.material.opacity = 0.09 + 0.05 * Math.sin(now / 400); }
      if (h.grp.visible) { const v = view(w); h.grp.position.set(v.x, v.y, v.z); h.grp.quaternion.copy(h.q); h.grp.scale.setScalar(v.s * BK); }
      if (h.grp.visible && h.towers) for (const [ti, t] of h.towers.entries()) idle(t, ti, h.o === myId ? null : h, now); // vigilancia: mientras no disparan, miran de un lado a otro
      if (!h.towers) continue;
      let tgt = null, tvel = 0, tq = S.q, td = d, rng = TW_RANGE, tid = myId; // cada cliente simula las torretas enemigas contra sí mismo; el anfitrión, además, las de TODAS las bases humanas (también la suya) contra bots y neutrales hostiles
      const bb = bodyBy(h.b), rangeFor = p => (Math.hypot(p[0] - bb.pos[0], p[1] - bb.pos[1], p[2] - bb.pos[2]) - bb.R < (ATMO[bb.n] ? ATMO[bb.n].H : 30) ? TW_RANGE_ATMO : TW_RANGE); // dentro de la atmósfera del planeta el alcance sube
      if (h.o !== myId && alive && d < rangeFor(S.pos) + 1) { tgt = S.pos; tvel = S.ve || 0; rng = rangeFor(S.pos); }
      else if (h.o < 1000) { // base humana: bots enemigos cercanos y, si no, neutrales hostiles a su dueño (solo existen en el anfitrión)
        const bt = (typeof BOT !== 'undefined' && BOT.nearestTo(w, TW_RANGE_ATMO + 1)) || (typeof NEU !== 'undefined' && NEU.hostileNear(w, TW_RANGE_ATMO + 1, h.o));
        if (bt && bt.d < rangeFor(bt.pos) + 1) { tgt = bt.pos; tvel = bt.v; tq = bt.q; td = bt.d; rng = rangeFor(bt.pos); tid = bt.id; }
      }
      if (!tgt) continue;
      const qi = h.q.clone().invert();
      for (const [ti, t] of h.towers.entries()) {
        if (!(h.tw && h.tw[ti] > 0)) continue;
        if (tgt) { const rel = new THREE.Vector3(tgt[0] - w[0], tgt[1] - w[1], tgt[2] - w[2]).applyQuaternion(qi).sub(t.g.position).sub(new THREE.Vector3(0, HEAD_Y, 0)); t.head.rotation.set(Math.atan2(rel.y, Math.hypot(rel.x, rel.z)), Math.atan2(-rel.x, -rel.z), 0, 'YXZ'); }
        if (!tgt || td > rng) continue; const sty = TOWER_STYLES[h.ts[ti]] || TOWER_STYLES.plasma;
        if (sty.beam) { rail(h, ti, t, sty, tgt, tid, bb, w, dt); continue; } // cañón de riel: haz continuo (sin proyectil ni cadencia)
        if ((t.cd -= dt) > 0) continue;
        const mp = localToWorld(h, t.g.position.x, HEAD_Y, t.g.position.z), fw = new THREE.Vector3(0, 0, -1).applyQuaternion(tq), vv = tvel; let ap = tgt; for (let k = 0; k < 2; k++) { const tt = Math.hypot(ap[0] - mp[0], ap[1] - mp[1], ap[2] - mp[2]) / (TOWER_STYLES[h.ts[ti]] || TOWER_STYLES.plasma).spd; ap = [tgt[0] + fw.x * vv * tt, tgt[1] + fw.y * vv * tt, tgt[2] + fw.z * vv * tt]; } // apunta por delante de tu movimiento
        const dir = [ap[0] - mp[0], ap[1] - mp[1], ap[2] - mp[2]], l = Math.hypot(...dir); if (l < 0.01) continue; dir[0] /= l; dir[1] /= l; dir[2] /= l;
        if (dir[0] * h.dir[0] + dir[1] * h.dir[1] + dir[2] * h.dir[2] < 0.03 || !clearShot(bb, mp, ap)) { t.cd = 0.25; continue; } // solo disparan hacia arriba y nunca a través del terreno o del planeta
        if (sty.spread) { for (let k = 0; k < 3; k++) dir[k] += (Math.random() - 0.5) * 2 * sty.spread; const dl = Math.hypot(...dir); dir[0] /= dl; dir[1] /= dl; dir[2] /= dl; } // munición: ligera dispersión
        const dmg = sty.dmg * h.st.dmgMul, key = `${myId ?? 0}:t${++seq}`, life = Math.min(40, l / sty.spd * 1.4 + 2), kind = sty.kind, tg = sty.homing ? { k: tid >= 3000 ? 'n' : 'p', id: tid } : null; t.cd = weaponCd(sty, t); // cadencia propia de cada arma (plasma irregular, munición en ráfagas)
        const mz = mp.map((c, i) => c + dir[i] * (MUZ[h.ts[ti]] ?? 0.012) * BK), mk = kind === 'c' ? 0.5 : 1; spawnProj(-h.o, key, kind, mz, dir, tg, dmg, { spd: sty.spd, col: sty.col, life }); send({ t: 'fire', key, kind, w: h.ts[ti], pos: mz, dir, tgt: tg, dmg, tw: 1, spd: sty.spd, rb: S.refB, rp: S.refB >= 0 ? sub(mz, bodies[S.refB].pos) : null }); sfx(sty.snd, mz); puff(mz, 0.014 * BK * mk, sty.col, kind === 'c' ? 0.08 : 0.22, 0.012 * mk); puff(mz, 0.006 * BK * mk, 0xffffff, 0.12 * mk, 0.008 * mk); // resplandor en la boca del cañón (munición: chispa corta)
        if (tid === myId && typeof attackAlert === 'function') attackAlert('t', h.nm, w); // esta torreta me apunta a mí
      }
    }
  }
  function rail(h, ti, t, sty, tgt, tid, bb, w, dt) { // CAÑÓN DE RIEL: haz instantáneo mientras vea al blanco; daño en pasos de sty.tick s y un evento 'fire' kind 'r' por paso para que los demás lo dibujen y oigan
    const mp = localToWorld(h, t.g.position.x, HEAD_Y, t.g.position.z), dir = [tgt[0] - mp[0], tgt[1] - mp[1], tgt[2] - mp[2]], l = Math.hypot(...dir); if (l < 0.01) return; dir[0] /= l; dir[1] /= l; dir[2] /= l;
    if (dir[0] * h.dir[0] + dir[1] * h.dir[1] + dir[2] * h.dir[2] < 0.03 || !clearShot(bb, mp, tgt)) { t.bt = 0; return; } // sin línea de visión: el haz se corta (caduca solo) y el siguiente contacto daña al instante
    const mz = mp.map((c, i) => c + dir[i] * MUZ.rail * BK), key = `b${myId ?? 0}_${h.o}_${ti}`, tg = { k: tid >= 3000 ? 'n' : 'p', id: tid };
    beamSet(key, mz, tgt, tg); if ((t.bt = (t.bt || 0) - dt) > 0) return; t.bt = Math.max(0, t.bt + sty.tick);
    const dmg = sty.dps * sty.tick * h.st.dmgMul; beamHit(-h.o, key, tg, dmg, mz);
    send({ t: 'fire', key, kind: 'r', w: 'rail', pos: mz, dir, len: l, tgt: tg, dmg, tw: 1, rb: S.refB, rp: S.refB >= 0 ? sub(mz, bodies[S.refB].pos) : null });
    if (tid === myId && typeof attackAlert === 'function') attackAlert('t', h.nm, w);
  }
  function hit(old, pos, p) { // proyectiles míos o de mis bots contra el hangar de otro jugador (los bots solo atacan a humanos)
    for (const h of HG.values()) {
      if (h.o === myId || (p.owner >= 2000 && h.o >= 1000)) continue; const w = worldOf(h); if (Math.abs(w[0] - pos[0]) > 6 || Math.abs(w[1] - pos[1]) > 6 || Math.abs(w[2] - pos[2]) > 6) continue;
      const c = [w[0] + h.dir[0] * 0.01 * BK, w[1] + h.dir[1] * 0.01 * BK, w[2] + h.dir[2] * 0.01 * BK];
      if (h.sh > 0 && segDist(old, pos, c) < 0.095 * BK) { send({ t: 'hh', o: h.o, dmg: p.dmg }); h.sh -= p.dmg; boom(pos, 0.012); return true; } // el escudo de la base absorbe las balas
      if (h.towers && h.tw) for (const [ti, t] of h.towers.entries()) { if (!(h.tw[ti] > 0)) continue; const tp = localToWorld(h, t.g.position.x, HEAD_Y * 0.8, t.g.position.z); if (segDist(old, pos, tp) < 0.011 * BK) { send({ t: 'hh', o: h.o, dmg: p.dmg, tw: ti }); h.tw[ti] -= p.dmg; boom(pos, 0.012); return true; } }
      if (segDist(old, pos, c) < HG_R * BK) { send({ t: 'hh', o: h.o, dmg: p.dmg }); h.hp -= p.dmg; boom(pos, p.kind === 'm' ? 0.04 : 0.01); return true; }
    }
    return false;
  }

  // ---------- HUD ----------

  // ---------- iconos rojos detallados de los enemigos (siempre visibles, con flecha en el borde de la pantalla si están fuera de vista) ----------
  const tv = new THREE.Vector3();
  const ICON_SVG = {"ship": "<svg viewBox=\"0 0 64 64\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"r1\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".5\" stop-color=\"#e8291b\"/><stop offset=\"1\" stop-color=\"#6e0a06\"/></linearGradient><linearGradient id=\"r2\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffc4b8\"/><stop offset=\"1\" stop-color=\"#c2170c\"/></linearGradient><radialGradient id=\"r3\"><stop offset=\"0\" stop-color=\"#fff7d0\"/><stop offset=\"1\" stop-color=\"#ffa41a\"/></radialGradient></defs><path d=\"M32 3 37.5 20 60 42 60.5 49 45 45.5 41 58 32 54 23 58 19 45.5 3.5 49 4 42 26.5 20z\" fill=\"url(#r1)\" stroke=\"#3a0503\" stroke-width=\"1.7\" stroke-linejoin=\"round\"/><path d=\"M32 7 35.5 21 33.6 44 32 50 30.4 44 28.5 21z\" fill=\"url(#r2)\" stroke=\"#3a0503\" stroke-width=\"1\"/><ellipse cx=\"32\" cy=\"23\" rx=\"3.3\" ry=\"6.2\" fill=\"#ffe1da\" opacity=\".9\" stroke=\"#3a0503\" stroke-width=\"1\"/><path d=\"M30.6 18.5c.6-1.2 2.2-1.2 2.8 0\" stroke=\"#fff\" stroke-width=\"1\" fill=\"none\" opacity=\".9\"/><path d=\"M7 45 24 41M57 45 40 41M12 47.5 27 30M52 47.5 37 30M20 44 25 33M44 44 39 33\" stroke=\"#3a0503\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M3.5 42v7M60.5 42v7\" stroke=\"#ffd7cf\" stroke-width=\"1.6\" stroke-linecap=\"round\"/><circle cx=\"9\" cy=\"47\" r=\"1.5\" fill=\"#ffd23f\"/><circle cx=\"55\" cy=\"47\" r=\"1.5\" fill=\"#ffd23f\"/><rect x=\"22.5\" y=\"50\" width=\"5.5\" height=\"8\" rx=\"1.8\" fill=\"#2a0402\"/><rect x=\"36\" y=\"50\" width=\"5.5\" height=\"8\" rx=\"1.8\" fill=\"#2a0402\"/><ellipse cx=\"25.2\" cy=\"59.5\" rx=\"2.2\" ry=\"3.2\" fill=\"url(#r3)\"/><ellipse cx=\"38.8\" cy=\"59.5\" rx=\"2.2\" ry=\"3.2\" fill=\"url(#r3)\"/></svg>", "hangar": "<svg viewBox=\"0 0 64 64\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"h1\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8f80\"/><stop offset=\".55\" stop-color=\"#e02a1c\"/><stop offset=\"1\" stop-color=\"#6a0905\"/></linearGradient><linearGradient id=\"h2\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffb8ac\"/><stop offset=\"1\" stop-color=\"#b3130a\"/></linearGradient></defs><ellipse cx=\"32\" cy=\"47\" rx=\"28\" ry=\"12\" fill=\"#2a0402\"/><ellipse cx=\"32\" cy=\"44.5\" rx=\"27\" ry=\"11.5\" fill=\"url(#h1)\" stroke=\"#3a0503\" stroke-width=\"1.6\"/><ellipse cx=\"32\" cy=\"44.5\" rx=\"17\" ry=\"7\" fill=\"none\" stroke=\"#ffd7cf\" stroke-width=\"1.6\" opacity=\".9\"/><path d=\"M28 41.5v6M36 41.5v6M28 44.5h8\" stroke=\"#ffd7cf\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><rect x=\"24\" y=\"22\" width=\"16\" height=\"11\" rx=\"1.5\" fill=\"url(#h2)\" stroke=\"#3a0503\" stroke-width=\"1.3\"/><path d=\"M22.5 22.5 32 17l9.5 5.5z\" fill=\"#c2170c\" stroke=\"#3a0503\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M27 26h3M34 26h3M27 29.5h3M34 29.5h3\" stroke=\"#ffe1da\" stroke-width=\"1.6\" opacity=\".9\"/><path d=\"M32 17V6\" stroke=\"#3a0503\" stroke-width=\"1.6\"/><circle cx=\"32\" cy=\"5\" r=\"2.8\" fill=\"#ffd23f\" stroke=\"#3a0503\" stroke-width=\"1\"/><g stroke=\"#3a0503\" stroke-width=\"1\"><rect x=\"8\" y=\"30\" width=\"4\" height=\"12\" rx=\"1\" fill=\"url(#h2)\"/><rect x=\"52\" y=\"30\" width=\"4\" height=\"12\" rx=\"1\" fill=\"url(#h2)\"/><rect x=\"15\" y=\"42\" width=\"4\" height=\"11\" rx=\"1\" fill=\"url(#h2)\"/><rect x=\"45\" y=\"42\" width=\"4\" height=\"11\" rx=\"1\" fill=\"url(#h2)\"/><rect x=\"5.5\" y=\"26\" width=\"9\" height=\"5\" rx=\"1.5\" fill=\"#e8291b\"/><rect x=\"49.5\" y=\"26\" width=\"9\" height=\"5\" rx=\"1.5\" fill=\"#e8291b\"/><rect x=\"12.5\" y=\"38\" width=\"9\" height=\"5\" rx=\"1.5\" fill=\"#e8291b\"/><rect x=\"42.5\" y=\"38\" width=\"9\" height=\"5\" rx=\"1.5\" fill=\"#e8291b\"/></g><path d=\"M2 27.5h4M58 27.5h4M9 39.5h4M51 39.5h4\" stroke=\"#ffd7cf\" stroke-width=\"1.8\" stroke-linecap=\"round\"/></svg>"}, ICON_IMG = {};
  const icon = k => { let im = ICON_IMG[k]; if (!im) { im = ICON_IMG[k] = new Image(); im.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(ICON_SVG[k]); } return im; };
  function screenPos(w, W, H) { // { x, y, edge, ang }: posición en pantalla o, si está fuera, punto del borde en su dirección
    const v = view(w); tv.set(v.x, v.y, v.z); const c = tv.clone().applyMatrix4(camera.matrixWorldInverse); tv.project(camera);
    if (c.z < 0 && Math.abs(tv.x) < 0.92 && Math.abs(tv.y) < 0.86) return { x: (tv.x * 0.5 + 0.5) * W, y: (-tv.y * 0.5 + 0.5) * H, edge: false };
    let dx = c.x, dy = -c.y; if (Math.hypot(dx, dy) < 1e-6) { dx = 0; dy = 1; }
    const rx = W / 2 - 52, ry = H / 2 - 62, t = 1 / Math.hypot(dx / rx, dy / ry); return { x: W / 2 + dx * t, y: H / 2 + dy * t, edge: true, ang: Math.atan2(dy, dx) };
  }
  function marker(k, w, dist, label, W, H, now, ally, sub, lv, show = true, pri = 7) { // show: con texto (solo cerca, LABEL_KM); pri: prioridad en la cola anti-solape // lv: nivel de la nave (hexágono en la esquina superior izquierda) // ally: marcador azul de mi propia base (siempre visible, también tras el planeta: indica la dirección) · sub: 3.ª línea (nave y nivel)
    const p = screenPos(w, W, H), sz = 34, y = p.edge ? p.y : p.y - 46;
    g2.save(); g2.textAlign = 'center'; const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    if (p.edge) { g2.translate(p.x, p.y); g2.rotate(p.ang); g2.fillStyle = ally ? '#4db8ff' : '#ff3b30'; g2.beginPath(); g2.moveTo(sz / 2 + 14, 0); g2.lineTo(sz / 2 + 2, -8); g2.lineTo(sz / 2 + 2, 8); g2.closePath(); g2.fill(); g2.rotate(-p.ang); g2.translate(-p.x, -p.y); }
    g2.shadowColor = ally ? '#2a9dff' : '#ff2a1a'; g2.shadowBlur = 10 + 8 * pulse; g2.fillStyle = ally ? 'rgba(0,18,38,0.8)' : 'rgba(38,2,0,0.78)'; g2.strokeStyle = ally ? '#4db8ff' : '#ff3b30'; g2.lineWidth = 2; g2.beginPath(); g2.arc(p.x, y, sz / 2 + 5, 0, 7); g2.fill(); g2.stroke(); g2.shadowBlur = 0;
    const im = icon(k); if (im.complete && im.naturalWidth) { if (ally) g2.filter = 'hue-rotate(200deg) saturate(1.4)'; g2.drawImage(im, p.x - sz / 2, y - sz / 2, sz, sz); g2.filter = 'none'; }
    if (lv !== undefined && !p.edge && typeof hexImg === 'function') { const hi = hexImg(lv, ally ? '#4db8ff' : '#ff5a4a'); if (hi.complete && hi.naturalWidth) g2.drawImage(hi, p.x - sz / 2 - 16, y - sz / 2 - 16, 24, 26); }
    if (show && typeof hudText === 'function') hudText(p.x, y + sz / 2 + 17, [[`${label} · ${fDs(dist)}`, ally ? '#9fd8ff' : '#ff8a7a', `bold 10px ${MONO}`], ...(sub ? [[sub, '#ffd23f', `bold 10px ${MONO}`]] : [])], pri); // UNA etiqueta por objeto (nombre + distancia corta; su nave/nivel solo cerca)
    g2.restore();
  }
  const tv2 = new THREE.Vector3();
  // estado de MI base, siempre visible arriba a la izquierda (vida, escudo y torretas)
  const bh = document.createElement('div'); bh.id = 'bh'; bh.style.cssText = 'position:fixed;left:16px;top:60px;z-index:4;width:210px;background:#00121fcc;border:1px solid #1d4a66;border-radius:10px;padding:6px 10px;color:#dff4ff;font:600 12px ui-monospace,Consolas,monospace;pointer-events:none;display:none;text-shadow:0 0 4px #000'; document.body.append(bh); let bhSig = '';
  function baseStatus() {
    const h = HG.get(myId), on = h && started && !loading && P.hp > -1e9; if (!on) { if (bh.style.display !== 'none') bh.style.display = 'none'; return; }
    const tw = h.tw ? h.tw.filter(v => v > 0).length : 4, sg = [Math.round(h.hp), Math.round(h.sh), tw, h.st.hpMax, h.st.shMax].join(); if (sg === bhSig) return; bhSig = sg;
    const f = Math.max(0, Math.min(1, h.hp / h.st.hpMax)), bar = (v, c) => `<div style="height:7px;background:#ffffff1f;border-radius:4px;overflow:hidden;margin:2px 0 4px"><i style="display:block;height:100%;width:${Math.max(0, Math.min(100, v * 100))}%;background:${c}"></i></div>`;
    bh.innerHTML = `<div style="display:flex;justify-content:space-between"><span style="color:#8fb8d0;letter-spacing:.12em">MI BASE</span><b style="color:${f > 0.35 ? '#5dff8a' : '#ff5a4a'}">${Math.round(h.hp)}/${h.st.hpMax}</b></div>${bar(f, f > 0.35 ? '#5dff8a' : '#ff5a4a')}${h.st.shMax ? `<div style="display:flex;justify-content:space-between"><span style="color:#8fb8d0">ESCUDO</span><b>${Math.round(h.sh)}/${h.st.shMax}</b></div>${bar(h.sh / h.st.shMax, '#4db8ff')}` : ''}<div style="color:#8fb8d0">TORRETAS <b style="color:#fff">${tw}/4</b></div>`; bh.style.display = 'block';
  }
  function hud(now) {
    baseStatus();
    const W = hc.width, H = hc.height; g2.save(); g2.textAlign = 'center';
    if (P.hp > 0 && !S.foot.on) { // enemigos: hangares y naves siempre señalados en rojo; mi base, en azul
      { const mh = HG.get(myId); if (mh && mh.grp) { const mw = worldOf(mh), md = Math.hypot(mw[0] - S.pos[0], mw[1] - S.pos[1], mw[2] - S.pos[2]); if (md > 1.2) marker('hangar', mw, md, 'TU BASE', W, H, now, true, undefined, undefined, md > 600 && md < LABEL_KM.base, 7); } }
      for (const h of HG.values()) if (h.o !== myId && h.grp) { const w = worldOf(h), dd = w.map((c, i) => c - S.pos[i]), dl = Math.hypot(...dd); if (dl > 0 && !losBlocked({ kind: 'h', dir: dd.map(c => c / dl), dist: dl })) marker('hangar', w, dl, 'HANGAR ' + h.nm.toUpperCase(), W, H, now, false, undefined, undefined, dl > 600 && dl < LABEL_KM.base && !aimedIs('h', h.o), 7); } // a < 600 km ya la muestra el recuadro del hangar // sin planeta de por medio
      for (const r of remotes.values()) if (r.hp > 0 && r.apos) { const dd = r.apos.map((c, i) => c - S.pos[i]), dl = r.dist ?? Math.hypot(...dd), hl = Math.hypot(...dd); if (hl > 0 && !losBlocked({ kind: 'p', dir: dd.map(c => c / hl), dist: hl })) marker('ship', r.apos, dl, (r.name || 'PILOTO').toUpperCase(), W, H, now, false, `${TYPES[r.st] ? TYPES[r.st].name.toUpperCase() : 'NAVE'} NV ${r.lv || 0}`, r.lv || 0, dl < (r.id >= 2000 ? LABEL_KM.nave : LABEL_KM.jugador) && !aimedIs('p', r.id), 8); } // debajo: nave que usa y su nivel
      if (typeof BOT !== 'undefined') for (const t of BOT.targets()) { const dd = t.pos.map((c, i) => c - S.pos[i]), hl = Math.hypot(...dd); if (hl > 0 && !losBlocked({ kind: 'p', dir: dd.map(c => c / hl), dist: hl })) marker('ship', t.pos, hl, t.name.toUpperCase(), W, H, now, false, `${TYPES[t.st].name.toUpperCase()} NV ${t.lv}`, t.lv, hl < LABEL_KM.nave && !aimedIs('p', t.id), 8); } // anfitrión: sus bots no son remotos
    }
    for (const h of HG.values()) { // barras de vida de las torretas de un hangar enemigo cercano
      if (h.o === myId || !h.tw || !h.towers || !h.grp.visible || h.d > 2.5 * BK) continue;
      h.towers.forEach((t, i) => { const p = localToWorld(h, t.g.position.x, HEAD_Y + 0.008, t.g.position.z); tv2.set(p[0] - S.pos[0], p[1] - S.pos[1], p[2] - S.pos[2]).project(camera); if (tv2.z >= 1 || Math.abs(tv2.x) > 1.05 || Math.abs(tv2.y) > 1.05) return;
        const x = (tv2.x * 0.5 + 0.5) * W, y = (-tv2.y * 0.5 + 0.5) * H, f = Math.max(0, h.tw[i] / h.st.twMax); g2.fillStyle = 'rgba(0,0,0,0.6)'; g2.fillRect(x - 21, y - 4, 42, 8); g2.fillStyle = f > 0.35 ? '#ff5a4a' : '#ffb347'; g2.fillRect(x - 20, y - 3, 40 * f, 6);
        g2.font = `9px ${MONO}`; g2.fillStyle = '#ffd7cf'; g2.fillText(f > 0 ? 'TORRETA' : 'DESTRUIDA', x, y - 8); });
    }
    for (const h of HG.values()) {
      if (!h.d || h.d > 600 || !h.grp.visible) continue; const w = worldOf(h);
      tv.set(w[0] - S.pos[0], w[1] - S.pos[1], w[2] - S.pos[2]).addScaledVector(new THREE.Vector3(...h.dir), 0.1).project(camera); if (tv.z >= 1 || Math.abs(tv.x) > 1.1 || Math.abs(tv.y) > 1.1) continue;
      const x = (tv.x * 0.5 + 0.5) * W, y = (-tv.y * 0.5 + 0.5) * H, mine = h.o === myId, f = Math.max(0, h.hp / h.st.hpMax);
      g2.fillStyle = 'rgba(0,10,20,0.6)'; g2.beginPath(); g2.roundRect(x - 70, y - 26, 140, 40, 7); g2.fill();
      g2.fillStyle = mine ? '#4db8ff' : '#ff8a6a'; g2.font = `bold 12px ${MONO}`; g2.fillText(`${mine ? 'TU HANGAR' : 'HANGAR · ' + h.nm}`, x, y - 11); g2.font = `11px ${MONO}`; g2.fillStyle = '#bfe8ff'; g2.fillText(fD(h.d), x, y + 2);
      g2.fillStyle = 'rgba(255,255,255,0.18)'; g2.fillRect(x - 60, y + 6, 120, 4); g2.fillStyle = f > 0.3 ? '#5dff8a' : '#ff4b3b'; g2.fillRect(x - 60, y + 6, 120 * f, 4);
    }
    if (P.hp <= 0) { const mine = HG.get(myId); g2.font = `bold 15px ${MONO}`; g2.fillStyle = mine ? '#9fe' : '#ff8a6a'; g2.fillText(mine ? `HANGAR ${Math.round(mine.hp / mine.st.hpMax * 100)} % — reapareces en él en ${Math.max(0, Math.ceil((P.deadUntil - now) / 1000))} s` : (defeated ? (typeof WAR !== 'undefined' && WAR.mine().length ? `HANGAR DESTRUIDO — reapareces en tu buque en ${Math.max(0, Math.ceil((P.deadUntil - now) / 1000))} s` : 'HANGAR DESTRUIDO — DERROTA') : ''), W / 2, H / 2 - 20); }
    g2.restore();
  }
  function targets() { // hangares enemigos como objetivos del radar (los que están por encima del horizonte y a tiro del radar)
    const out = []; if (P.hp <= 0) return out;
    for (const h of HG.values()) {
      if (h.o === myId || h.hp <= 0 || !h.grp) continue; const w = worldOf(h), c = [w[0] + h.dir[0] * 0.012, w[1] + h.dir[1] * 0.012, w[2] + h.dir[2] * 0.012];
      if (h.dir[0] * (S.pos[0] - w[0]) + h.dir[1] * (S.pos[1] - w[1]) + h.dir[2] * (S.pos[2] - w[2]) < -0.3) continue; // por debajo del horizonte del planeta: tapado
      const v = view(c); if (v.d > 60000) continue;
      out.push({ kind: 'h', id: h.o, name: h.nm, hp: h.hp / h.st.hpMax * 100, sh: h.st.shMax ? h.sh / h.st.shMax * 100 : 0, grp: { position: new THREE.Vector3(v.x, v.y, v.z) }, dist: v.d, dir: [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d] });
    }
    return out;
  }
  function atBase() { // compras, mejoras y cambios de nave solo aquí: tengo hangar y estoy a menos de 3 km de él (la plataforma mide 6 veces el modelo, BK) o estacionado en ella
    if (typeof WAR !== 'undefined' && WAR.near()) return true; // junto a uno de mis buques de guerra también se compra y mejora
    const h = HG.get(myId); if (!h || !h.info) return false; const w = worldOf(h), p = S.foot.on ? S.shipPos : S.pos;
    return Math.hypot(w[0] - p[0], w[1] - p[1], w[2] - p[2]) < AT_BASE_KM || (S.park.on && S.park.b && S.park.b.n === h.b && Math.hypot(S.park.dir[0] - h.dir[0], S.park.dir[1] - h.dir[1], S.park.dir[2] - h.dir[2]) * bodyBy(h.b).R < AT_BASE_KM);
  }
  const AT_BASE_KM = 3; // la plataforma mide el doble (BK 6)
  const targetPos = id => { const h = HG.get(id); if (!h || h.hp <= 0) return null; const w = worldOf(h); return [w[0] + h.dir[0] * 0.012, w[1] + h.dir[1] * 0.012, w[2] + h.dir[2] * 0.012]; };
  const towerPos = (h, i) => { const t = h.towers && h.towers[i]; return t ? localToWorld(h, t.g.position.x, HEAD_Y, t.g.position.z) : null; }; // (bot.js) cabeza de la torreta i de un hangar, en el mundo
  return { towerPos, model, dispose: o => o.traverse(x => { if (x.geometry && !x.geometry.userData.keep) x.geometry.dispose(); }), targets, targetPos, atBase, mine: () => HG.get(myId) || null, canRespawn: () => !!HG.get(myId) || (typeof WAR !== 'undefined' && WAR.mine().length > 0), sync, onEvent, onClaim, onLobby, LB, started: () => started, choose: show, spawnAt, frame, hit, hud, HG, worldOf, isHost: () => LB.adm === myId, booted: () => MM.booted, onWelcome, onRoomMsg, loading: () => loading };
})();
