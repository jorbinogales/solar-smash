// Modelos 3D low-poly del CAZA (F), el BUQUE DE GUERRA (W) y el SATÉLITE DEFENSIVO (S). Se cargan antes de war.js, que los usa mediante WAR.models (= MODELS).
// Unidades: km, proa hacia -z. Cada modelo se construye UNA vez: piezas fusionadas por rol de material con skit() (ships.js: UVs proyectadas por eje dominante) y cacheadas;
// cada instancia solo añade meshes que comparten esa geometría y los materiales de su bando (aliado / enemigo). Texturas: solo las compartidas de ships.js
// (casco 256², metal 128², cristal 128², paneles solares 64×128, entorno 128×64) + 2 nuevas y pequeñas (suelo 256², ventanas 128×64).
// Roles: H casco · H2 casco oscuro · A acento de bando (pintura) · D metal oscuro · G cristal · PV paneles solares · WN ventanas emisivas · TL luz de bando · LIGHTS luces fijas por vértice · GLW resplandor aditivo.
const MODELS = (() => {
  const PI = Math.PI, G = SHIPGFX, tx = G.tex, WN = new Set(['WN']);
  const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cylY = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const cylZ = (rt, rb, len, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, len, seg, 1, open).rotateX(PI / 2); // rt = radio trasero (+z)
  const sph = (r, ws = 8, hs = 6, phi = PI * 2, th = PI) => new THREE.SphereGeometry(r, ws, hs, 0, phi, 0, th);
  const tor = (r, t, seg = 10) => new THREE.TorusGeometry(r, t, 4, seg);
  const torY = (r, t, seg = 12) => new THREE.TorusGeometry(r, t, 4, seg).rotateX(PI / 2);

  // ---------- geometría angular propia: perfiles chaflanados unidos por secciones (loft) y losas extruidas desde un polígono en planta ----------
  const geom = P => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.computeVertexNormals(); return g; }; // sin índice: normales planas por cara
  function ringPts(s, n) { // rectángulo con esquinas cortadas, en sentido antihorario visto desde +z
    const a = s.w / 2, b = s.h / 2, x = s.x || 0, y = s.y || 0, c = Math.min(s.c || 0, a * 0.98, b * 0.98), z = s.z;
    return n === 8 ? [[x + a, y - b + c, z], [x + a, y + b - c, z], [x + a - c, y + b, z], [x - a + c, y + b, z], [x - a, y + b - c, z], [x - a, y - b + c, z], [x - a + c, y - b, z], [x + a - c, y - b, z]]
      : [[x + a, y - b, z], [x + a, y + b, z], [x - a, y + b, z], [x - a, y - b, z]];
  }
  function loft(secs) { // secs: [{ z, w, h, x, y, c }] en orden de z creciente; c > 0 en todas (8 puntos) o en ninguna (4)
    const n = secs.some(s => (s.c || 0) > 0) ? 8 : 4, R = secs.map(s => ringPts(s, n)), P = [], tri = (a, b, c) => P.push(...a, ...b, ...c);
    for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < n; j++) { const k = (j + 1) % n; tri(R[i][j], R[i][k], R[i + 1][j]); tri(R[i][k], R[i + 1][k], R[i + 1][j]); }
    const cap = (Q, front) => { const c = [0, 0, Q[0][2]]; for (const p of Q) { c[0] += p[0] / n; c[1] += p[1] / n; } for (let j = 0; j < n; j++) { const k = (j + 1) % n; if (front) tri(Q[k], Q[j], c); else tri(Q[j], Q[k], c); } };
    cap(R[0], true); cap(R[R.length - 1], false); return geom(P);
  }
  function slab(poly, y0, y1) { // polígono convexo (x, z) extruido entre y0 e y1
    let A = 0; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; A += p[0] * q[1] - q[0] * p[1]; });
    const pts = A > 0 ? poly.slice().reverse() : poly, n = pts.length, P = [], tri = (a, b, c) => P.push(...a, ...b, ...c), T = i => [pts[i][0], y1, pts[i][1]], B = i => [pts[i][0], y0, pts[i][1]];
    for (let i = 1; i < n - 1; i++) { tri(T(0), T(i), T(i + 1)); tri(B(0), B(i + 1), B(i)); }
    for (let i = 0; i < n; i++) { const k = (i + 1) % n; tri(B(i), B(k), T(i)); tri(B(k), T(k), T(i)); }
    return geom(P);
  }

  // ---------- materiales por bando (compartidos por todas las instancias) ----------
  const MT = {};
  function mats(mine) {
    const k = mine ? 1 : 0; if (MT[k]) return MT[k];
    const HT = tx('hull'), MX = tx('metal'), env = tx('env'), WT = tx('win');
    const hull = new THREE.Color(mine ? 0xb6c4d2 : 0x9a8c90).multiplyScalar(1.12), acc = new THREE.Color(mine ? 0x2f8fe8 : 0xd03324), lit = new THREE.Color(mine ? 0x4db8ff : 0xff4030), glow = new THREE.Color(mine ? 0x7fcaff : 0xff7a3a);
    const std = o => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMap: env, ...o });
    const dk = new THREE.Color(mine ? 0x2a313b : 0x30282a);
    return (MT[k] = {
      H: std({ color: hull, map: HT, metalness: 0.35, roughness: 0.55, emissive: hull, emissiveIntensity: 0.12, envMapIntensity: 0.9 }),
      H2: std({ color: hull.clone().multiplyScalar(0.6), map: HT, metalness: 0.4, roughness: 0.6, emissive: hull, emissiveIntensity: 0.07, envMapIntensity: 0.8 }),
      A: std({ color: acc, map: HT, metalness: 0.3, roughness: 0.45, emissive: acc, emissiveIntensity: 0.32, envMapIntensity: 0.7 }),
      D: std({ color: dk, map: MX, metalness: 0.7, roughness: 0.5, emissive: dk, emissiveIntensity: 0.1, envMapIntensity: 0.6 }),
      G: std({ color: 0xd8f2ff, map: tx('glass'), transparent: true, opacity: 0.85, metalness: 0.55, roughness: 0.07, emissive: 0x0a4560, emissiveIntensity: 0.55, envMapIntensity: 1.7 }),
      PV: std({ color: 0xffffff, map: tx('pvr'), metalness: 0.6, roughness: 0.3, emissive: 0x143070, emissiveIntensity: 0.4, envMapIntensity: 1.3 }),
      WN: std({ color: 0x9aa8b8, map: WT, metalness: 0.2, roughness: 0.6, emissive: 0xffffff, emissiveMap: WT, emissiveIntensity: 1, envMapIntensity: 0.4 }),
      TL: new THREE.MeshBasicMaterial({ color: lit }),
      LIGHTS: G.LIGHTS,
      GLW: new THREE.MeshBasicMaterial({ vertexColors: true, color: glow, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    });
  }
  // grupo con una malla por rol (comparten la geometría cacheada y los materiales del bando)
  function inst(parts, mine) { const g = new THREE.Group(), M = mats(mine); for (const [role, geo] of parts) g.add(new THREE.Mesh(geo, M[role])); return g; }
  const glowDisc = (K, x, y, z, r, seg = 10) => K.addr('GLW', 0xffffff, new THREE.CircleGeometry(r, seg), [x, y, z]); // resplandor de tobera (mira a +z)
  const plume = (K, x, y, z, r, len, seg = 8) => { // penacho corto de una tobera: cono aditivo cuya base está en la boca y se apaga en la punta
    const g = new THREE.ConeGeometry(r, len, seg).rotateX(PI / 2).translate(0, 0, len / 2), p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const k = Math.pow(Math.max(0, 1 - p.getZ(i) / len), 1.2) * 0.75; c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); K.add('GLW', g, [x, y, z]);
  };

  // =====================================================================================================================
  // BUQUE DE GUERRA (~3,5 km × ESCALA 4 ≈ 14 km): casco de cuña con proa de cuchillo, vientre oscuro, cubierta de vuelo con pista iluminada, hangares en los costados,
  // puente con mástil y antenas, 6 torretas gemelas ANIMABLES (objetos aparte con yaw/pitch en userData.turrets; x = ±0,39; z = −0,2 · 0,35 · 0,8), bloque de motores con 3 toberas y 2 propulsores auxiliares.
  // =====================================================================================================================
  // ---------- torretas animables del buque (objetos separados del casco) ----------
  // Cada torreta: Group `yaw` (pivote en lo alto de su barbeta; gira sobre y) > [cúpula (rol H)] + Group `pitch` (pivote en el eje de los cañones; cabecea sobre x) > [cañones y frenos de boca (rol D)].
  // Geometría fundida UNA vez (turretGeo) y compartida por las 6 torretas de todos los buques; materiales = los del casco de cada bando. Coste: 2 draw calls por torreta (12 por buque).
  // Orden = el de war.js (WT): 0-2 costado izquierdo (x −), 3-5 derecho (x +); z = TUR_Z; la central (z 0,35) es la metralleta, las otras dos lanzamisiles.
  const TUR_X = 0.39, TUR_Z = [-0.2, 0.35, 0.8], TUR_Y = 0.09, TUR_PY = 0.038, TUR_MZ = -0.26, TUR_GUN = 0.02; // yaw en y = 0,09 (tope de la barbeta) · pitch a +0,038 sobre él (y = 0,128, el eje de los cañones) · boca a −0,26 en z
  const TUR_PMIN = -10 * PI / 180, TUR_PMAX = 80 * PI / 180, TUR_X_AXIS = new THREE.Vector3(1, 0, 0), TUR_Y_AXIS = new THREE.Vector3(0, 1, 0);
  let TG = null;
  function turretGeo() {
    if (TG) return TG; const Ky = G.skit(0.5), Kp = G.skit(0.5);
    Ky.add('H', loft([{ z: -0.055, w: 0.07, h: 0.035, y: 0.035, c: 0.01 }, { z: -0.02, w: 0.11, h: 0.06, y: 0.035, c: 0.02 }, { z: 0.06, w: 0.10, h: 0.05, y: 0.032, c: 0.02 }])); // cúpula (coordenadas locales de yaw)
    for (const o of [-TUR_GUN, TUR_GUN]) { Kp.add('D', cylZ(0.009, 0.009, 0.20, 6), [o, 0, -0.155]); Kp.add('D', bx(0.02, 0.02, 0.028), [o, 0, -0.245]); } // cañón (cerrado atrás: al cabecear asoma por encima de la cúpula) y freno de boca
    return (TG = { yaw: Ky.parts(), pitch: Kp.parts() });
  }
  function addTurrets(g, mine) {
    const M = mats(mine), T = turretGeo(), list = [];
    for (const sx of [-1, 1]) TUR_Z.forEach((z, zi) => {
      const yaw = new THREE.Group(), pitch = new THREE.Group(), x = sx * TUR_X;
      yaw.position.set(x, TUR_Y, z); pitch.position.set(0, TUR_PY, 0); for (const [role, geo] of T.yaw) yaw.add(new THREE.Mesh(geo, M[role])); for (const [role, geo] of T.pitch) pitch.add(new THREE.Mesh(geo, M[role])); yaw.add(pitch); g.add(yaw);
      list.push({ yaw, pitch, home: { yaw: 0, pitch: 0 }, muzzleLocal: [new THREE.Vector3(-TUR_GUN, 0, TUR_MZ), new THREE.Vector3(TUR_GUN, 0, TUR_MZ)], pos: new THREE.Vector3(x, TUR_Y + TUR_PY, z), kind: zi === 1 ? 'mg' : 'missile', limits: { pitchMin: TUR_PMIN, pitchMax: TUR_PMAX } });
    });
    g.userData.turrets = list; return g;
  }
  // boca (side 0 = cañón izquierdo · 1 = derecho) en coordenadas del modelo con el yaw/pitch ACTUALES (rota a mano, sin depender de matrixWorld). `out` opcional para no crear objetos.
  function turretMuzzle(model, i, side, out) {
    const t = model.userData.turrets[i]; return (out || new THREE.Vector3()).copy(t.muzzleLocal[side ? 1 : 0]).applyAxisAngle(TUR_X_AXIS, t.pitch.rotation.x).add(t.pitch.position).applyAxisAngle(TUR_Y_AXIS, t.yaw.rotation.y).add(t.yaw.position);
  }
  // apunta la torreta i hacia el vector d (coordenadas del modelo, desde su centro): yaw absoluto y pitch recortado a los límites. Devuelve la torreta.
  function turretAim(model, i, dx, dy, dz) {
    const t = model.userData.turrets[i]; t.yaw.rotation.y = Math.atan2(-dx, -dz); t.pitch.rotation.x = Math.min(t.limits.pitchMax, Math.max(t.limits.pitchMin, Math.atan2(dy, Math.hypot(dx, dz)))); return t;
  }

  let PW = null;
  function partsW() {
    if (PW) return PW; const K = G.skit(0.5, WN), Kw = G.skit(0.2, WN);
    // --- casco principal (H) y vientre (H2)
    K.add('H', loft([
      { z: -1.90, w: 0.03, h: 0.05, y: 0.00, c: 0.01 }, { z: -1.60, w: 0.17, h: 0.12, y: 0.02, c: 0.035 }, { z: -1.20, w: 0.38, h: 0.20, y: 0.04, c: 0.05 }, { z: -0.70, w: 0.58, h: 0.24, y: 0.06, c: 0.07 },
      { z: -0.15, w: 0.66, h: 0.26, y: 0.06, c: 0.08 }, { z: 0.60, w: 0.68, h: 0.26, y: 0.06, c: 0.08 }, { z: 1.10, w: 0.62, h: 0.26, y: 0.06, c: 0.08 }, { z: 1.32, w: 0.58, h: 0.24, y: 0.06, c: 0.07 }]));
    K.add('H2', loft([{ z: -1.50, w: 0.10, h: 0.05, y: -0.02, c: 0.015 }, { z: -1.00, w: 0.30, h: 0.14, y: -0.06, c: 0.04 }, { z: -0.40, w: 0.42, h: 0.18, y: -0.10, c: 0.05 }, { z: 1.10, w: 0.46, h: 0.18, y: -0.10, c: 0.05 }, { z: 1.30, w: 0.40, h: 0.16, y: -0.09, c: 0.04 }]));
    K.add('D', bx(0.05, 0.10, 1.30), [0, -0.24, 0.15]); K.add('D', bx(0.16, 0.02, 0.50), [0, -0.30, 0.30]); // quilla y aleta ventral
    // --- cubierta de vuelo dorsal con pista, balizas y chevrones de bando
    K.add('H', slab([[-0.19, -0.85], [0.19, -0.85], [0.235, -0.30], [0.235, 1.15], [-0.235, 1.15], [-0.235, -0.30]], 0.19, 0.23));
    K.add('D', slab([[-0.05, -0.55], [0.05, -0.55], [0.09, 0.98], [-0.09, 0.98]], 0.23, 0.2325)); // franja central de la pista
    for (const sx of [-1, 1]) { K.add('TL', bx(0.008, 0.005, 1.45), [sx * 0.155, 0.233, 0.30]); K.add('D', bx(0.012, 0.012, 1.50), [sx * 0.245, 0.236, 0.30]); }
    for (let i = 0; i < 7; i++) K.add('TL', bx(0.05, 0.004, 0.012), [0, 0.2345, -0.42 + i * 0.22]); // balizas de la línea central
    for (const sx of [-1, 1]) K.add('A', bx(0.16, 0.004, 0.035), [sx * 0.075, 0.232, -0.70], [0, sx * 0.7, 0]); // chevrón de proa
    K.add('A', bx(0.05, 0.003, 0.42), [0, 0.117, -1.35], [-0.15, 0, 0]); K.add('D', bx(0.006, 0.004, 0.30), [0, 0.121, -1.30], [-0.15, 0, 0]); // franja de la proa
    // --- costados: hangares con interior iluminado y sponsons con torretas
    for (const sx of [-1, 1]) {
      K.add('H', loft([{ z: -0.60, w: 0.03, h: 0.05, x: sx * 0.39, y: -0.02, c: 0.01 }, { z: -0.30, w: 0.15, h: 0.16, x: sx * 0.39, y: -0.02, c: 0.03 }, { z: 0.90, w: 0.15, h: 0.16, x: sx * 0.39, y: -0.02, c: 0.03 }, { z: 1.15, w: 0.11, h: 0.12, x: sx * 0.39, y: -0.02, c: 0.025 }]));
      K.add('D', bx(0.012, 0.12, 0.34), [sx * 0.463, -0.02, -0.02]); K.addr('LIGHTS', 0xffe6b0, bx(0.004, 0.05, 0.30), [sx * 0.469, 0.002, -0.02]); K.addr('LIGHTS', 0xff9d3a, bx(0.004, 0.028, 0.30), [sx * 0.469, -0.048, -0.02]); // hangar iluminado: cubierta alta cálida y suelo anaranjado
      for (let i = 0; i < 4; i++) K.add('D', bx(0.007, 0.09, 0.008), [sx * 0.471, -0.02, -0.14 + i * 0.10]); K.add('D', bx(0.007, 0.006, 0.30), [sx * 0.471, -0.022, -0.02]); // costillas de la puerta
      K.add('A', bx(0.004, 0.012, 0.80), [sx * 0.467, -0.075, 0.42]); K.add('TL', bx(0.003, 0.006, 0.60), [sx * 0.468, -0.052, 0.45]); // franja de bando y luz de costado
      for (let i = 0; i < 4; i++) K.add('D', bx(0.010, 0.05, 0.012), [sx * 0.466, 0.0, 0.10 + i * 0.22]); // costillas del casco
      Kw.add('WN', bx(0.003, 0.05, 0.36), [sx * 0.331, 0.12, 0.05]); Kw.add('WN', bx(0.003, 0.05, 0.30), [sx * 0.322, 0.12, 0.86]); // bandas de ventanas del casco
    }
    // --- 6 torretas gemelas: aquí solo el anillo fijo (barbeta) de cada una; cúpula y cañones son objetos animables (turretGeo / addTurrets)
    for (const sx of [-1, 1]) for (const z of TUR_Z) { const x = sx * TUR_X; K.add('D', cylY(0.062, 0.072, 0.03, 8), [x, 0.075, z]); K.add('TL', torY(0.058, 0.004, 8), [x, 0.092, z]); }
    // --- cresta de proa, aletas de popa y torretas antiaéreas
    K.add('H2', loft([{ z: -1.55, w: 0.04, h: 0.012, y: 0.086, c: 0.004 }, { z: -1.20, w: 0.12, h: 0.02, y: 0.145, c: 0.006 }, { z: -0.85, w: 0.19, h: 0.034, y: 0.19, c: 0.01 }]));
    K.add('A', bx(0.012, 0.003, 0.60), [0, 0.176, -1.17], [-0.10, 0, 0]);
    for (const sx of [-1, 1]) {
      K.add('H2', loft([{ z: 1.00, w: 0.014, h: 0.06, x: sx * 0.235, y: 0.26, c: 0.004 }, { z: 1.28, w: 0.014, h: 0.24, x: sx * 0.235, y: 0.35, c: 0.004 }]));
      K.add('A', bx(0.016, 0.02, 0.10), [sx * 0.235, 0.36, 1.22]); K.add('TL', sph(0.008, 5, 4), [sx * 0.235, 0.475, 1.28]);
      for (const z of [0.55, -0.10]) { K.add('D', cylY(0.024, 0.028, 0.02, 6), [sx * 0.19, 0.24, z]); K.add('H', bx(0.04, 0.03, 0.05), [sx * 0.19, 0.265, z]); for (const o of [-0.009, 0.009]) K.add('D', cylZ(0.004, 0.004, 0.07, 4, true), [sx * 0.19 + o, 0.268, z - 0.05]); }
    }
    // --- torre de mando y superestructura
    K.add('H', loft([{ z: 0.66, w: 0.14, h: 0.06, y: 0.26, c: 0.02 }, { z: 0.78, w: 0.26, h: 0.20, y: 0.33, c: 0.03 }, { z: 1.06, w: 0.26, h: 0.20, y: 0.33, c: 0.03 }]));
    K.add('H2', loft([{ z: 0.74, w: 0.10, h: 0.03, y: 0.445, c: 0.01 }, { z: 0.82, w: 0.22, h: 0.09, y: 0.475, c: 0.02 }, { z: 1.00, w: 0.22, h: 0.09, y: 0.475, c: 0.02 }]));
    K.add('G', bx(0.20, 0.045, 0.004), [0, 0.483, 0.795], [-0.62, 0, 0]);
    for (const sx of [-1, 1]) { Kw.add('WN', bx(0.003, 0.05, 0.15), [sx * 0.132, 0.34, 0.92]); Kw.add('WN', bx(0.003, 0.035, 0.15), [sx * 0.112, 0.48, 0.92]); K.add('A', bx(0.004, 0.012, 0.28), [sx * 0.133, 0.27, 0.92]); }
    Kw.add('WN', bx(0.20, 0.04, 0.003), [0, 0.34, 1.062]);
    K.add('D', bx(0.30, 0.008, 0.36), [0, 0.435, 0.92]); K.add('D', bx(0.28, 0.006, 0.10), [0, 0.525, 0.95]); // cornisas
    K.add('D', cylY(0.008, 0.010, 0.34, 6), [0, 0.69, 0.95]); K.add('D', bx(0.12, 0.006, 0.006), [0, 0.66, 0.95]); K.add('D', bx(0.07, 0.006, 0.006), [0, 0.74, 0.95]); K.add('TL', sph(0.02, 8, 6), [0, 0.87, 0.95]);
    K.add('H2', sph(0.05, 10, 5, PI * 2, 1.0), [-0.075, 0.55, 0.86], [PI - 0.7, 0, 0]); K.add('D', cylY(0.005, 0.005, 0.06, 5), [-0.075, 0.585, 0.83], [-0.7, 0, 0]); // plato de radar
    K.add('D', bx(0.10, 0.02, 0.05), [0.06, 0.545, 0.87]); K.add('D', bx(0.10, 0.045, 0.006), [0.06, 0.58, 0.87], [0, 0, 0.0]); // panel de sensores
    for (const [x, z, h] of [[-0.20, 1.10, 0.20], [0.20, 1.10, 0.16], [-0.10, 0.30, 0.13], [0.10, -0.40, 0.12]]) { K.add('D', cylY(0.004, 0.005, h, 5), [x, 0.23 + h / 2, z]); K.add('LIGHTS', sph(0.008, 6, 4), [x, 0.23 + h + 0.004, z]); }
    K.add('LR', sph(0.012, 6, 4), [0, 0.5, 1.08]);
    // bloques de cubierta: hangar de proa, contenedores y silos
    K.add('H', bx(0.16, 0.05, 0.24), [-0.12, 0.255, 0.32]); Kw.add('WN', bx(0.005, 0.03, 0.20), [-0.2025, 0.258, 0.32]); K.add('D', bx(0.17, 0.006, 0.25), [-0.12, 0.283, 0.32]);
    K.add('H2', bx(0.14, 0.04, 0.18), [0.13, 0.25, 0.18]); K.add('A', bx(0.145, 0.004, 0.05), [0.13, 0.272, 0.18]);
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) { const z = -0.10 - i * 0.075; K.add('D', bx(0.038, 0.006, 0.048), [sx * 0.19, 0.233, z]); K.add('TL', bx(0.026, 0.003, 0.036), [sx * 0.19, 0.2385, z]); }
    // --- bloque de motores: 3 toberas principales y 2 auxiliares
    K.add('H2', loft([{ z: 1.28, w: 0.58, h: 0.32, y: 0.06, c: 0.05 }, { z: 1.36, w: 0.56, h: 0.30, y: 0.05, c: 0.05 }, { z: 1.48, w: 0.52, h: 0.26, y: 0.03, c: 0.04 }]));
    K.add('D', bx(0.60, 0.03, 0.10), [0, 0.215, 1.34]); K.add('A', bx(0.40, 0.006, 0.05), [0, 0.234, 1.30]);
    for (const x of [-0.19, 0, 0.19]) {
      K.add('D', cylZ(0.12, 0.085, 0.14, 10), [x, 0.03, 1.53]);       K.add('TL', tor(0.112, 0.006, 10), [x, 0.03, 1.60]); glowDisc(K, x, 0.03, 1.598, 0.105, 10); plume(K, x, 0.03, 1.60, 0.10, 0.20, 8);
    }
    for (const sx of [-1, 1]) { K.add('D', cylZ(0.06, 0.045, 0.09, 8), [sx * 0.39, -0.02, 1.20]); glowDisc(K, sx * 0.39, -0.02, 1.246, 0.05, 8); plume(K, sx * 0.39, -0.02, 1.248, 0.05, 0.12, 6); }
    K.add('LR', sph(0.012, 6, 4), [-0.47, 0.03, 1.10]); K.add('LG', sph(0.012, 6, 4), [0.47, 0.03, 1.10]); K.add('LW', sph(0.01, 6, 4), [0, 0.30, 1.40]);

    PW = [...K.parts(), ...Kw.parts()]; return PW;
  }

  // =====================================================================================================================
  // SATÉLITE DEFENSIVO (~1,3 km de envergadura): núcleo octogonal con anillo de bando, ventanas y bridas; dos alas de paneles solares con larguero; antena parabólica sobre un mástil;
  // cañón de largo alcance (riel con bobinas luminosas y freno de boca) al frente; módulo sensor bajo el núcleo, tanques, radiadores y balizas.
  // =====================================================================================================================
  let PS = null;
  function partsS() {
    if (PS) return PS; const K = G.skit(0.3, WN), Kw = G.skit(0.12, WN);
    // --- núcleo
    K.add('H', cylY(0.095, 0.095, 0.20, 8)); K.add('D', cylY(0.104, 0.104, 0.018, 8), [0, 0.105, 0]); K.add('D', cylY(0.104, 0.104, 0.018, 8), [0, -0.105, 0]);
    K.add('H2', cylY(0.07, 0.096, 0.03, 8), [0, 0.129, 0]); K.add('H2', cylY(0.096, 0.07, 0.03, 8), [0, -0.129, 0]);
    K.add('A', cylY(0.099, 0.099, 0.032, 8), [0, 0.058, 0]); K.add('TL', cylY(0.1, 0.1, 0.008, 8), [0, -0.05, 0]); Kw.add('WN', cylY(0.097, 0.097, 0.05, 8), [0, 0.0, 0]);
    K.add('TL', torY(0.087, 0.006, 8), [0, 0.146, 0]);
    // --- antena parabólica sobre mástil (orientada hacia delante y arriba)
    K.add('D', cylY(0.010, 0.016, 0.16, 6), [0, 0.225, 0]); K.add('D', bx(0.05, 0.03, 0.05), [0, 0.31, 0.0]);
    K.add('H2', sph(0.13, 14, 5, PI * 2, 1.0), [0, 0.35, -0.02], [PI - 0.55, 0, 0]); K.add('D', torY(0.108, 0.004, 14), [0, 0.34, -0.06], [-0.55, 0, 0]);
    K.add('D', cylY(0.004, 0.004, 0.10, 4), [0, 0.40, -0.075], [-0.55, 0, 0]); K.add('TL', sph(0.014, 6, 4), [0, 0.44, -0.10]);
    // --- cañón de largo alcance
    K.add('H', loft([{ z: -0.29, w: 0.11, h: 0.11, y: -0.01, c: 0.02 }, { z: -0.15, w: 0.13, h: 0.13, y: -0.01, c: 0.03 }, { z: -0.05, w: 0.12, h: 0.12, y: -0.01, c: 0.03 }]));
    K.add('D', cylZ(0.034, 0.034, 0.44, 8), [0, -0.01, -0.51]); K.add('D', bx(0.09, 0.02, 0.10), [0, 0.06, -0.20]);
    for (const z of [-0.36, -0.45, -0.54, -0.63]) { K.add('TL', tor(0.043, 0.006, 8), [0, -0.01, z]); K.add('D', cylZ(0.040, 0.040, 0.016, 8, true), [0, -0.01, z - 0.026]); }
    for (let i = 0; i < 5; i++) K.add('D', bx(0.005, 0.024, 0.03), [0, 0.03, -0.34 - i * 0.07]);
    K.add('H2', cylZ(0.05, 0.043, 0.07, 8), [0, -0.01, -0.735]); for (const a of [0, PI / 2]) K.add('D', bx(0.11, 0.01, 0.03), [0, -0.01, -0.73], [0, 0, a]); K.add('TL', sph(0.014, 6, 4), [0, -0.01, -0.785]);
    K.add('A', bx(0.05, 0.004, 0.10), [0, 0.078, -0.24]);
    // --- alas solares: larguero y 3 tramos con dos paneles cada uno (marco de metal y celdas)
    for (const sx of [-1, 1]) {
      K.add('D', cylY(0.009, 0.009, 0.52, 6), [sx * 0.35, 0, 0], [0, 0, PI / 2]); K.add('H', bx(0.06, 0.035, 0.06), [sx * 0.125, 0, 0]); K.add('D', bx(0.03, 0.05, 0.02), [sx * 0.10, 0, 0]);
      for (const sz of [-1, 1]) K.add('D', bx(0.50, 0.006, 0.175), [sx * 0.36, 0, sz * 0.10]); // bastidor de cada fila de paneles
      for (let i = 0; i < 3; i++) for (const sz of [-1, 1]) { // celdas: un plano por panel (2 triángulos) con la textura repetida 1,5 × 1
        const pv = new THREE.PlaneGeometry(0.15, 0.165).rotateX(-PI / 2), uv = pv.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.5, uv.getY(k));
        K.add('PV', pv, [sx * (0.21 + 0.165 * i), 0.0034, sz * 0.10]);
      }
      for (const sz of [-1, 1]) K.add('D', bx(0.50, 0.006, 0.006), [sx * 0.36, 0.002, sz * 0.192]);
      for (const x of [0.13 + 0.165, 0.13 + 0.33]) K.add('A', bx(0.008, 0.008, 0.38), [sx * x, 0.002, 0]);
      K.add(sx < 0 ? 'LR' : 'LG', sph(0.011, 6, 4), [sx * 0.63, 0.005, 0.0]);
    }
    // --- módulo sensor bajo el núcleo, tanques, radiadores, RCS y antenas
    K.add('D', bx(0.10, 0.05, 0.10), [0, -0.15, 0.0]); K.add('H2', sph(0.055, 10, 5, PI * 2, PI / 2), [0, -0.175, 0], [PI, 0, 0]); K.add('G', sph(0.02, 8, 5), [0, -0.225, -0.03]); K.add('TL', sph(0.008, 6, 4), [0, -0.245, 0.0]);
    for (const sx of [-1, 1]) { K.add('H', sph(0.045, 7, 5), [sx * 0.11, -0.10, 0.09]); K.add('A', cylY(0.047, 0.047, 0.008, 7), [sx * 0.11, -0.10, 0.09]); }
    K.add('D', torY(0.13, 0.008, 10), [0, -0.075, 0]); for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; K.add('D', bx(0.012, 0.012, 0.05), [Math.cos(a) * 0.115, -0.075, Math.sin(a) * 0.115], [0, -a, 0]); }
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) K.add('D', bx(0.004, 0.09, 0.085), [sx * 0.10, 0.0, 0.105 + i * 0.006 + i * 0.0], [0, 0, sx * 0.0]);
    for (const [x, y, z] of [[0.09, 0.07, -0.09], [-0.09, 0.07, -0.09], [0.09, -0.07, 0.09], [-0.09, -0.07, 0.09]]) { K.add('D', bx(0.028, 0.02, 0.028), [x, y, z]); K.add('H2', cylY(0.007, 0.011, 0.014, 5), [x, y + Math.sign(y) * 0.016, z]); }
    for (const [x, z, h] of [[-0.06, 0.05, 0.15], [0.07, 0.06, 0.11]]) { K.add('D', cylY(0.003, 0.004, h, 4), [x, 0.14 + h / 2, z]); K.add('LIGHTS', sph(0.007, 5, 4), [x, 0.14 + h + 0.003, z]); }
    K.add('LW', sph(0.008, 6, 4), [0, -0.27, 0.0]);
    PS = [...K.parts(), ...Kw.parts()]; return PS;
  }

  // =====================================================================================================================
  // CAZA (~45 m): silueta de dardo con alas de flecha INVERSA (punta adelantada) y anhedral, dosel de burbuja, timones gemelos abiertos, tomas ventrales, raíles de misiles bajo las alas
  // y dos toberas. Solo 6 roles + 1 penacho = 7 draw calls. Distinto de las 4 naves de jugador (aguja / delta / cañonera / plato) a simple vista.
  // =====================================================================================================================
  const PF = {}; // una lista de piezas por bando: las luces de bando van en el color de los vértices (rol LIGHTS) y así se ahorra un draw call
  function partsF(mine) {
    const key = mine ? 1 : 0; if (PF[key]) return PF[key]; const K = G.skit(0.012), TC = mine ? 0x4db8ff : 0xff4030;
    K.add('H', loft([
      { z: -0.0235, w: 0.0016, h: 0.0016, y: 0.0000, c: 0.0004 }, { z: -0.0165, w: 0.0060, h: 0.0048, y: 0.0002, c: 0.0014 }, { z: -0.0060, w: 0.0100, h: 0.0072, y: 0.0006, c: 0.0020 },
      { z: 0.0060, w: 0.0112, h: 0.0076, y: 0.0006, c: 0.0020 }, { z: 0.0160, w: 0.0092, h: 0.0064, y: 0.0002, c: 0.0016 }, { z: 0.0215, w: 0.0072, h: 0.0056, y: 0.0000, c: 0.0014 }]));
    K.add('D', cylZ(0.0004, 0.0006, 0.0060, 5), [0, 0, -0.0263]); K.addr('LIGHTS', TC, sph(0.0006, 4, 3), [0, 0, -0.0296]); // sonda con punta luminosa
    K.add('G', sph(1, 8, 4, PI * 2, PI / 2), [0, 0.0034, -0.0090], [0, 0, 0], [0.0041, 0.0034, 0.0105]); // dosel de burbuja
    K.add('D', bx(0.0084, 0.0005, 0.0006), [0, 0.0035, -0.0165]); K.add('D', bx(0.0005, 0.0006, 0.0200), [0, 0.0066, -0.0090]); K.add('D', bx(0.0090, 0.0004, 0.0009), [0, 0.0035, -0.0010]); // marco del dosel
    K.add('A', bx(0.0014, 0.0004, 0.0110), [0, 0.0043, 0.0085]); // lomo con franja de bando
    // alas de flecha inversa (borde de ataque de la raíz a la punta ADELANTADA) con anhedral de 0,10 rad; todo lo pegado al ala comparte esa rotación
    const AN = [0, 0, -0.10], wy = x => -0.0004 - x * 0.10; // wy: cara inferior del ala a una distancia x del eje
    K.mir('H', slab([[0.0050, 0.0000], [0.0195, -0.0110], [0.0195, -0.0050], [0.0050, 0.0165]], -0.0004, 0.0004), [0, 0, 0], AN);
    K.mir('A', slab([[0.0058, -0.0004], [0.0192, -0.0108], [0.0192, -0.0088], [0.0058, -0.0024]], 0.0003, 0.0006), [0, 0, 0], AN); // franja de bando en el borde de ataque
    K.mir('D', slab([[0.0110, 0.0060], [0.0195, -0.0010], [0.0195, 0.0008], [0.0110, 0.0080]], 0.0003, 0.0006), [0, 0, 0], AN); // flap
    K.mir('D', bx(0.0016, 0.0016, 0.0092), [0.0197, -0.0020, -0.0062]); K.add('LR', sph(0.0006, 5, 4), [-0.0197, -0.0020, -0.0112]); K.add('LG', sph(0.0006, 5, 4), [0.0197, -0.0020, -0.0112]); // vainas de punta con luz de posición
    // timones gemelos abiertos (canto de 66° respecto a la horizontal)
    K.mir('H', slab([[0.0000, 0.0110], [0.0074, 0.0138], [0.0074, 0.0172], [0.0000, 0.0195]], -0.0003, 0.0003), [0.0038, 0.0032, 0.0], [0, 0, 1.15]);
    K.mir('A', slab([[0.0046, 0.0128], [0.0074, 0.0143], [0.0074, 0.0167], [0.0046, 0.0170]], -0.0005, 0.0005), [0.0038, 0.0032, 0.0], [0, 0, 1.15]);
    for (const sx of [-1, 1]) K.addr('LIGHTS', TC, sph(0.0004, 4, 3), [sx * 0.0069, 0.0104, 0.0186]);
    // tomas de aire ventrales y cañón inferior
    K.mir('D', bx(0.0030, 0.0032, 0.0072), [0.0056, -0.0018, -0.0040]); K.add('D', cylZ(0.0005, 0.0005, 0.0080, 5, true), [0, -0.0034, -0.0150]);
    // misiles bajo las alas (2 por ala): raíl, cuerpo y ojiva de bando
    for (const x of [0.0110, 0.0150]) { K.mir('D', bx(0.0004, 0.0010, 0.0060), [x, wy(x) - 0.0003, -0.0008]); K.mir('D', cylZ(0.0006, 0.0006, 0.0090, 5, true), [x, wy(x) - 0.0014, -0.0008]); K.mir('A', new THREE.ConeGeometry(0.0006, 0.0016, 5, 1, true).rotateX(-PI / 2), [x, wy(x) - 0.0014, -0.0062]); }
    // toberas gemelas: campana, aro de bando y brillo interior
    for (const sx of [-1, 1]) { const x = sx * 0.0034; K.add('D', cylZ(0.0033, 0.0028, 0.0052, 8, true), [x, -0.0002, 0.0236]); K.addr('LIGHTS', TC, new THREE.RingGeometry(0.0029, 0.0034, 8), [x, -0.0002, 0.0263]); glowDisc(K, x, -0.0002, 0.0261, 0.0028, 8); }
    return (PF[key] = K.parts());
  }
  const flameGeo = {};
  function flames(mine) { // penacho doble (dos toberas) en UN mesh; la vista escala su longitud con el empuje (setThrust)
    if (flameGeo[mine ? 1 : 0]) return flameGeo[mine ? 1 : 0];
    const cols = mine ? [[0.25, 0.55, 1.0], [0.75, 0.9, 1.0]] : [[1.0, 0.35, 0.1], [1.0, 0.8, 0.45]];
    const parts = []; for (const sx of [-1, 1]) for (const [r, len, ci] of [[0.0028, 0.022, 0], [0.0016, 0.014, 1]]) {
      const g = new THREE.ConeGeometry(r, len, 6, 1, true).rotateX(PI / 2).translate(sx * 0.0034, -0.0002, len / 2 + 0.0262), p = g.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const k = Math.pow(Math.max(0, 1 - (p.getZ(i) - 0.0262) / len), 1.1); c[i * 3] = cols[ci][0] * k; c[i * 3 + 1] = cols[ci][1] * k; c[i * 3 + 2] = cols[ci][2] * k; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g);
    }
    const P = [], N = []; for (const g of parts) { const ng = g.toNonIndexed(); P.push(...ng.attributes.position.array); N.push(...ng.attributes.color.array); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N), 3)); return (flameGeo[mine ? 1 : 0] = geo);
  }
  const flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  // ---------- API: mine => Object3D (los tres comparten geometría y materiales; solo cambian los del bando) ----------
  const W = mine => addTurrets(inst(partsW(), mine), mine), S = mine => inst(partsS(), mine); // W: userData.turrets[6] (ver addTurrets) · W.turretMuzzle / W.turretAim
  W.turretMuzzle = turretMuzzle; W.turretAim = turretAim;
  const F = mine => { // el caza expone .flames / .missiles / .flameMul para setThrust y updateShipFx (ships.js)
    const g = inst(partsF(mine), mine), fl = new THREE.Group(); fl.add(new THREE.Mesh(flames(mine), flameMat)); g.add(fl);
    Object.assign(g, { flames: [fl], missiles: [], flameMul: 1, muzzles: [], pylons: [] }); return g;
  };
  return { W, S, F, dev: { partsW, partsS, partsF, mats, loft, slab } }; // war.js usa W, S y F; dev solo lo usan las pruebas
})();
