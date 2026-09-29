// Cielo, asteroides y basura espacial procedurales. Todo es determinista: todos los jugadores ven los mismos objetos.
// Depende de fbm() (game.js), rndOf() (ships.js), AU, ZONES y zoneLeft() (game.js), que se resuelven en tiempo de ejecución.

// ---------- cielo: campo de estrellas (magnitudes y tipos espectrales) + banda de la Vía Láctea en una textura equirectangular de baja resolución ----------
const SKY_GN = (() => { const g = [0.3, 0.86, 0.41], l = Math.hypot(g[0], g[1], g[2]); return g.map(c => c / l); })(); // normal del plano de la galaxia (la textura de la Vía Láctea se hornea en planets.js con la misma)
function createSky(scene) {
  const uVis = { value: 1 }, uPx = { value: Math.min(window.devicePixelRatio || 1, 1.5) }, GN = SKY_GN, N = 9000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), siz = new Float32Array(N), r = rndOf(9317);
  const SPEC = [[0.62, 0.74, 1], [0.78, 0.86, 1], [1, 0.98, 0.94], [1, 0.92, 0.78], [1, 0.78, 0.55], [1, 0.62, 0.45]], CUM = [0.07, 0.2, 0.37, 0.54, 0.8, 1]; // B, A, F, G, K, M
  for (let n = 0; n < N;) {
    const u = r() * 2 - 1, a = r() * 6.2832, sn = Math.sqrt(1 - u * u), x = sn * Math.cos(a), y = u, z = sn * Math.sin(a), sb = x * GN[0] + y * GN[1] + z * GN[2];
    if (r() > 0.2 + 0.8 * Math.exp(-(sb / 0.3) * (sb / 0.3))) continue; // más estrellas hacia el plano de la galaxia
    const m = 2 * Math.log10(Math.pow(10, -0.6) + r() * (Math.pow(10, 3.15) - Math.pow(10, -0.6))), lg = -0.4 * (m - 6.3), q = r(); let k = 0; while (q > CUM[k]) k++; // magnitud aparente: pocas brillantes, muchas débiles
    const I = 0.3 + 0.7 * Math.min(1, lg / 2.2), w = 0.12 + 0.3 * lg / 3; // las brillantes se ven más blancas
    pos[n * 3] = x * 8e6; pos[n * 3 + 1] = y * 8e6; pos[n * 3 + 2] = z * 8e6; siz[n] = 1.6 + 2.6 * lg / 3;
    for (let c = 0; c < 3; c++) col[n * 3 + c] = (SPEC[k][c] * (1 - w) + w) * I;
    n++;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  const pm = new THREE.ShaderMaterial({
    uniforms: { uVis, uPx }, transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aCol; attribute float aSize; uniform float uPx; varying vec3 vC;
      void main() { float px = max(aSize, 1.6); vC = aCol * (aSize * aSize) / (px * px); gl_PointSize = px * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, // las débiles se dibujan más grandes pero menos brillantes (sin parpadeo por submuestreo)
    fragmentShader: `uniform float uVis; varying vec3 vC; void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vC * exp(-d * d * 3.2) * uVis, 1.0); }`,
  });
  const points = new THREE.Points(g, pm); points.frustumCulled = false; points.renderOrder = -9; scene.add(points);
  const dm = new THREE.ShaderMaterial({
    uniforms: { uVis, uTex: { value: null }, uOn: { value: 0 } }, side: THREE.BackSide, transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vT; void main() { vT = vec2(1.0 - uv.x, uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, // uv de la esfera -> uv equirectangular de la textura (sin trigonometría por píxel)
    fragmentShader: `uniform sampler2D uTex; uniform float uVis, uOn; varying vec2 vT;
      void main() { gl_FragColor = vec4(texture2D(uTex, vT).rgb * uVis * uOn, 1.0); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), dm); dome.scale.setScalar(8e6); dome.frustumCulled = false; dome.renderOrder = -10; dome.visible = false; scene.add(dome);
  return {
    points, dome,
    set(v) { uVis.value = v; points.visible = v > 0.004; dome.visible = v > 0.004 && dm.uniforms.uOn.value > 0; }, // v: visibilidad (0 bajo una atmósfera de día)
    follow(p) { points.position.copy(p); dome.position.copy(p); },
    setTexture(t) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; dm.uniforms.uTex.value = t; dm.uniforms.uOn.value = 1; dome.visible = points.visible; },
  };
}
const ROCKS = [ // tipos espectrales: carbonáceo, rocoso, metálico, hielo, alargado, binario (dos lóbulos)
  { c: [0x2b2a28, 0x4a4640], el: [1, 0.85, 0.8], cr: 9 },
  { c: [0x6b5a45, 0xa8916f], el: [1.2, 0.9, 0.8], cr: 8 },
  { c: [0x55585c, 0x9aa0a6], el: [1, 0.9, 0.9], cr: 5 },
  { c: [0x9fb6c4, 0xe7f0f5], el: [1, 1, 0.9], cr: 6 },
  { c: [0x5a4b3a, 0x8d7a5f], el: [1.9, 0.8, 0.7], cr: 7 },
  { c: [0x3d3833, 0x7a6d5c], el: [1, 0.9, 0.9], cr: 6, lobes: true },
];

function weld(g) { // icosfera sin índice -> indexada: un vértice por posición (menos memoria y menos trabajo de vértices)
  const p = g.attributes.position, map = new Map(), pos = [], idx = new Uint16Array(p.count);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4); let j = map.get(k); if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(x, y, z); } idx[i] = j; }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); o.setIndex(new THREE.BufferAttribute(idx, 1)); g.dispose(); return o;
}

function makeRock(seed, K, detail) { // icosfera desplazada por ruido fractal + cráteres con borde elevado + color por albedo; detail: subdivisiones (LOD)
  const g = weld(new THREE.IcosahedronGeometry(1, detail)), p = g.attributes.position, rnd = rndOf(seed), n = p.count, cols = new Float32Array(n * 3), o = seed * 7.13;
  const craters = Array.from({ length: K.cr }, () => ({ v: new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(), r: 0.22 + rnd() * 0.42, d: 0.05 + rnd() * 0.13 }));
  const c1 = new THREE.Color(K.c[0]), c2 = new THREE.Color(K.c[1]), v = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let r = 1 + 0.30 * (fbm(v.x * 1.4 + o, v.y * 1.4, v.z * 1.4) - 0.5) * 2 + 0.07 * (fbm(v.x * 5 + o, v.y * 5, v.z * 5) - 0.5) * 2;
    if (K.lobes) { let best = 0; for (const cx of [-0.5, 0.5]) { const b = v.x * cx; best = Math.max(best, b + Math.sqrt(Math.max(0, b * b - cx * cx + 0.62))); } r *= best; }
    let dark = 0;
    for (const c of craters) {
      const a = Math.acos(Math.min(1, v.dot(c.v))) / c.r;
      if (a < 1.5) { const bowl = Math.max(0, 1 - a * a); r += -c.d * bowl + 0.3 * c.d * Math.exp(-Math.pow((a - 1.05) / 0.16, 2)); dark = Math.max(dark, bowl); }
    }
    p.setXYZ(i, v.x * r * K.el[0], v.y * r * K.el[1], v.z * r * K.el[2]);
    const t = fbm(v.x * 2.5 + o * 3, v.y * 2.5, v.z * 2.5), k = (0.85 + 0.3 * fbm(v.x * 12, v.y * 12 + o, v.z * 12)) * (1 - 0.4 * dark);
    col.copy(c1).lerp(c2, t).multiplyScalar(k * 0.75); cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
  return g;
}
// Detalle de superficie de los asteroides sin subir la geometría: ruido 3D en el shader (relieve fino que se desvanece cuando el píxel abarca demasiado) y variación de albedo
const ROCK_NOISE = `float hash31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y), mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float rockH(vec3 p) { return vnoise(p * 7.0) * 0.55 + vnoise(p * 17.0) * 0.3 + vnoise(p * 41.0) * 0.15; }
vec3 perturbRock(vec3 pos, vec3 n, vec2 dH) {
  vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1);
  return normalize(abs(det) * n - sign(det) * (dH.x * r1 + dH.y * r2));
}`;
function rockPatch(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying float vRS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; mat4 mm = modelViewMatrix;\n#ifdef USE_INSTANCING\nmm = mm * instanceMatrix;\n#endif\nvRS = length(mm[0].xyz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying float vRS;\n' + ROCK_NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.78 + 0.5 * rockH(vOP * 1.7 + 3.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ float hn = rockH(vOP), fp = length(fwidth(vOP)); normal = perturbRock(-vViewPosition, normal, vec2(dFdx(hn), dFdy(hn)) * (0.06 * vRS * smoothstep(0.08, 0.015, fp))); }');
  };
  return mat;
}

// ---------- basura espacial: piezas primitivas fusionadas, dobladas y arrugadas ----------
function piece(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(), c = new THREE.Color(color), a = new Float32Array(g.attributes.position.count * 3);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
}
function merge(list, crumple = 0, bend = 0, seed = 1) {
  const total = list.reduce((s, g) => s + g.attributes.position.count, 0), pos = new Float32Array(total * 3), col = new Float32Array(total * 3); let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  for (let i = 0; i < total; i++) { // arruga/dobla según la posición: los vértices repetidos se mueven igual y no se abren grietas
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    pos[i * 3] += (fbm(x * 3 + seed, y * 3, z * 3) - 0.5) * 2 * crumple;
    pos[i * 3 + 1] += (fbm(x * 3, y * 3 + seed, z * 3) - 0.5) * 2 * crumple + bend * Math.sin(x * 2.2);
    pos[i * 3 + 2] += (fbm(x * 3, y * 3, z * 3 + seed) - 0.5) * 2 * crumple;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
const B = (w, h, d, sw = 1, sh = 1, sd = 1) => new THREE.BoxGeometry(w, h, d, sw, sh, sd), Cy = (r, l, s = 10, r2 = r) => new THREE.CylinderGeometry(r, r2, l, s);
const DEBRIS = [
  () => merge([ // satélite muerto: cuerpo con foil dorado, panel roto, plato y antena
    piece(B(0.42, 0.34, 0.42), 0xb8963a), piece(B(0.46, 0.06, 0.46), 0x30343a, 0, 0.2, 0), piece(B(0.9, 0.02, 0.4, 6, 1, 3), 0x1c3f7a, 0.68, 0, 0),
    piece(B(0.7, 0.02, 0.4, 5, 1, 3), 0x1c3f7a, -0.62, 0.05, 0.02, 0, 0, 0.35), piece(new THREE.SphereGeometry(0.22, 12, 6, 0, 6.283, 0, 1.0), 0xe8e6de, 0, 0.32, 0, PI, 0, 0), piece(Cy(0.012, 0.5, 6), 0x9a9a9a, 0.1, 0.5, 0.1, 0.2, 0, 0.3)], 0.02, 0, 1),
  () => merge([ // etapa de cohete con la tobera y el extremo desgarrado
    piece(Cy(0.16, 1.3, 12), 0xd9d4c7, 0, 0, 0, 0, 0, PI / 2), piece(Cy(0.165, 0.12, 12), 0x1a1a1a, 0.3, 0, 0, 0, 0, PI / 2), piece(Cy(0.165, 0.1, 12), 0xd06a1f, -0.25, 0, 0, 0, 0, PI / 2),
    piece(Cy(0.1, 0.3, 12, 0.22), 0x2a2a2a, -0.78, 0, 0, 0, 0, PI / 2), ...[0, 1, 2, 3, 4, 5].map(i => piece(B(0.03, 0.22, 0.02), 0x888078, 0.68, Math.sin(i) * 0.14, Math.cos(i) * 0.14, i, 0, 0.6))], 0.04, 0, 2),
  () => merge([ // fragmento de panel solar con marco
    piece(B(1.6, 0.03, 0.7, 10, 1, 5), 0x143a75), piece(B(1.64, 0.04, 0.05), 0x9aa0a8, 0, 0, 0.35), piece(B(1.64, 0.04, 0.05), 0x9aa0a8, 0, 0, -0.35), piece(B(0.05, 0.04, 0.7), 0x9aa0a8, 0.8, 0, 0)], 0.05, 0.12, 3),
  () => merge([ // cápsula de reentrada quemada con paracaídas destrozado
    piece(new THREE.SphereGeometry(0.42, 14, 10, 0, 6.283, 0, 2.0), 0x3a3532), piece(new THREE.SphereGeometry(0.43, 14, 6, 0, 6.283, 0, 0.7), 0x1c1917, 0, -0.01, 0, PI, 0, 0),
    piece(new THREE.SphereGeometry(0.08, 8, 6), 0x0a0a0c, 0.2, 0.3, 0.1), ...[0, 1, 2].map(i => piece(Cy(0.008, 0.8, 5), 0x9a9a9a, Math.cos(i * 2.1) * 0.15, 0.7, Math.sin(i * 2.1) * 0.15, 0.3 * i, 0, 0.2))], 0.04, 0, 4),
  () => merge([ // cercha metálica doblada
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => piece(Cy(0.012, 1.5, 5), 0x8a8f96, 0, a * 0.09, b * 0.09, 0, 0, PI / 2)),
    ...Array.from({ length: 8 }, (_, i) => [piece(B(0.012, 0.18, 0.012), 0x8a8f96, -0.7 + i * 0.2, 0, 0.09), piece(B(0.012, 0.18, 0.012), 0x8a8f96, -0.7 + i * 0.2, 0, -0.09), piece(B(0.012, 0.012, 0.18), 0x8a8f96, -0.7 + i * 0.2, 0.09, 0), piece(B(0.012, 0.25, 0.012), 0x9a8f80, -0.6 + i * 0.2, 0, 0.09, 0, 0, 0.6)]).flat()], 0.03, 0.18, 5),
  () => merge([ // tanque esférico con tuberías
    piece(new THREE.SphereGeometry(0.32, 14, 10), 0xc9c3b5), piece(new THREE.TorusGeometry(0.33, 0.02, 6, 20), 0x777777, 0, 0, 0, PI / 2, 0, 0),
    ...[0, 1, 2].map(i => piece(Cy(0.03, 0.6, 6), 0x9a9488, Math.cos(i * 2.1) * 0.3, 0.3, Math.sin(i * 2.1) * 0.3, 0.3, 0, 0.3 * i)), piece(B(0.1, 0.08, 0.1), 0x555555, 0.3, 0.1, 0)], 0.02, 0, 6),
  () => merge([ // placa de casco arrancada, con franja de pintura y varillas
    piece(B(1, 0.09, 0.7, 8, 1, 6), 0x4b4f55), piece(B(1.01, 0.092, 0.12), 0xd06a1f, 0, 0, 0.15), ...[0, 1, 2].map(i => piece(Cy(0.015, 0.5, 5), 0x6b6f75, -0.3 + i * 0.3, 0.2, 0.1 * i - 0.1, 0.4 * i, 0, 0.2))], 0.14, 0.2, 7),
];

function createFields(scene, bodies) {
  const CELL = 6000, RA = 24000, MAXI = 1000, dummy = new THREE.Object3D(), tint = new THREE.Color(), active = [];
  const rockMat = rockPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, emissive: 0x0f0d0b }));
  const debMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4, emissive: 0x20232b, flatShading: true, side: THREE.DoubleSide });
  // el buffer de color se crea con 'count': hay que pedirlo antes de poner count = 0
  const mk = (g, mat) => { const im = new THREE.InstancedMesh(g, mat, MAXI); im.frustumCulled = false; im.setColorAt(0, tint.setScalar(1)); im.count = 0; scene.add(im); return im; };
  const meshes = [...ROCKS.map((K, i) => mk(makeRock(11 + i * 17, K, 12), rockMat)), ...DEBRIS.map(f => mk(f(), debMat))]; // rocas: detalle alto (para los cercanos)
  const meshesLo = ROCKS.map((K, i) => mk(makeRock(11 + i * 17, K, 3), rockMat)), NM = meshes.length, cnt = new Int32Array(NM + ROCKS.length), LOD_ANG = 0.012; // versión de pocos triángulos para los que se ven pequeños (radio angular < 0,7°)
  // pepitas de los minerales que lleva cada asteroide de zona (oro, plata, cobre, diamante): pequeñas piezas brillantes sobre la roca; desaparecen cuando su zona agota ese recurso
  const NUGC = { oro: 0xffc22a, plata: 0xe6ebf2, cobre: 0xe0783c, diamante: 0x9fefff }, nugMat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.75, emissive: 0x33291a, flatShading: true });
  const nug = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), nugMat, 4000), dummy2 = new THREE.Object3D(), tcol = new THREE.Color(), _nv = new THREE.Vector3(); nug.frustumCulled = false; nug.setColorAt(0, tint.setScalar(1)); nug.count = 0; scene.add(nug);
  function nuggets(o) { // posiciones fijas sobre la superficie (deterministas por asteroide y mineral)
    if (o.ng) return o.ng; const out = [];
    for (const it of astInfo(o).list) { const col = NUGC[it.type]; if (!col) continue; let h = 2166136261; for (const ch of o.id + it.type) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); const r = rndOf(h >>> 0), cnt = Math.min(9, 3 + Math.ceil(it.n / 3));
      for (let i = 0; i < cnt; i++) { const u = r() * 2 - 1, a = r() * 6.2832, sn = Math.sqrt(1 - u * u); out.push({ d: new THREE.Vector3(sn * Math.cos(a), u, sn * Math.sin(a)), s: 0.06 + 0.08 * r(), c: col, t: it.type, n: it.n }); } }
    return (o.ng = out);
  }
  const fixed = []; // basura en órbita de los planetas: [cuerpo, nº de piezas]
  for (const [bi, count] of [[1, 150], [2, 100], [3, 150], [4, 80], [5, 80], [6, 80], [7, 80], [8, 60], [9, 60], [10, 60]].filter(x => x[0] < bodies.length)) { // basura orbital (el doble de antes) alrededor de cada mundo
    const b = bodies[bi], r = rndOf(bi * 97 + 3), centers = Array.from({ length: 3 }, () => new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize());
    for (let j = 0; j < count; j++) {
      const dir = centers[j % 3].clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.7)).normalize(), dist = b.R * (1.4 + 3.5 * r()), size = 0.06 + r() * r() * 0.6;
      fixed.push({ parent: b, off: [dir.x * dist, dir.y * dist, dir.z * dist], m: ROCKS.length + ((r() * DEBRIS.length) | 0), size, r: size * 0.55, ax: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), rate: 0.1 + r() * 0.5, a0: r() * 6.28, tint: 0.8 + r() * 0.4 });
    }
  }
  for (const [bi, count] of [[1, 30], [2, 25], [3, 30], [4, 20], [5, 20], [6, 20], [7, 20], [8, 15], [9, 15], [10, 15]].filter(x => x[0] < bodies.length)) { // asteroides pequeños en órbita de cada mundo (recursos a mano)
    const b = bodies[bi], r = rndOf(bi * 131 + 7);
    for (let j = 0; j < count; j++) { const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.7, r() - 0.5).normalize(), dist = b.R * (1.8 + 5 * r()), size = 1 + r() * r() * 14; fixed.push({ parent: b, off: [dir.x * dist, dir.y * dist, dir.z * dist], m: (r() * ROCKS.length) | 0, size, r: size * 0.9, ax: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), rate: 0.02 + r() * 0.12, a0: r() * 6.28, tint: 0.85 + r() * 0.3 }); }
  }
  const SYS_R = Math.max(...bodies.filter(b => !b.parent).map(b => (b.a || 0) * DIST_SCALE)) + 3e6; // radio del sistema: fuera del cinturón hay asteroides sueltos
  let last = null; const sph = new THREE.Sphere(), gone = new Set(); fixed.forEach((f, n) => f.id = 'f' + n);
  const ZCELL = 2000, ZROCK = { agua: 3, piedra: 1, cobre: 2, plata: 2, oro: 2, diamante: 3 }; // celda del cúmulo de una zona (km) y tipo de roca preferido según su recurso principal
  const push = (im, n) => { // solo se sube a la GPU la parte usada de los buffers y las mallas vacías no se dibujan
    im.count = n; im.visible = n > 0; if (!n) return; im.instanceMatrix.updateRange.count = n * 16; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) { im.instanceColor.updateRange.count = n * 3; im.instanceColor.needsUpdate = true; }
  };
  const zoneCache = {};
  function zoneRocks(z) { // rocas del cúmulo de una zona en coordenadas normalizadas (radio de la zona = 1): [x, y, z, tamaño 0-1, tipo de roca]; mismas celdas y semillas que el juego
    if (zoneCache[z.id]) return zoneCache[z.id]; const out = [], n = Math.ceil(z.radius / ZCELL), rt = ZROCK[z.dominant[0].type];
    for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) for (let k = -n; k < n; k++) {
      const r = rndOf(((i * 73856093) ^ (j * 19349663) ^ (k * 83492791) ^ Math.imul(z.id + 1, 668265263)) >>> 0); if (r() > 0.5) continue;
      const ox = (i + r()) * ZCELL, oy = (j + r()) * ZCELL, oz = (k + r()) * ZCELL, u = r(), size = 1.5 + 45 * u * u * u; if (Math.hypot(ox, oy, oz) > z.radius) continue;
      out.push([ox / z.radius, oy / z.radius, oz / z.radius, u, r() < 0.6 ? rt : (r() * ROCKS.length) | 0]);
    }
    return (zoneCache[z.id] = out);
  }
  const api = {
    zoneRocks,
    gone, active, near: Infinity, zone: false, geos: meshes.map(m => m.geometry), mats: { rock: rockMat, deb: debMat }, rockCount: ROCKS.length,
    update(P) { // la lista solo se regenera si te moviste >3000 km (la basura orbital sigue a su planeta); cada cuadro solo se actualizan posiciones y la distancia mínima
      const hr = Math.hypot(P[0], P[2]); api.zone = hr > BELT.i && hr < BELT.o && Math.abs(P[1]) < BELT.h; // BELT: cinturón del sistema generado (game.js)
      if (last && Math.hypot(P[0] - last[0], P[1] - last[1], P[2] - last[2]) < 3000) {
        let nr = Infinity;
        for (let i = 0; i < active.length; i++) { // se actualiza el mismo array de posición (sin asignaciones por cuadro)
          const o = active[i], op = o.pos; if (o.parent) { const pp = o.parent.pos, of = o.off; op[0] = pp[0] + of[0]; op[1] = pp[1] + of[1]; op[2] = pp[2] + of[2]; }
          const dx = op[0] - P[0], dy = op[1] - P[1], dz = op[2] - P[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) - o.r; if (d < nr) nr = d;
        }
        api.near = nr;
        return;
      }
      last = [...P]; active.length = 0; api.near = Infinity;
      if (hr < SYS_R + RA && Math.abs(P[1]) < 1.5e6) {
        for (let i = Math.floor((P[0] - RA) / CELL); i <= Math.floor((P[0] + RA) / CELL); i++)
          for (let j = Math.floor((P[1] - RA) / CELL); j <= Math.floor((P[1] + RA) / CELL); j++)
            for (let k = Math.floor((P[2] - RA) / CELL); k <= Math.floor((P[2] + RA) / CELL); k++) {
              const r = rndOf((i * 73856093) ^ (j * 19349663) ^ (k * 83492791));
              const ch = Math.hypot((i + 0.5) * CELL, (k + 0.5) * CELL), inB = ch > BELT.i && ch < BELT.o && Math.abs((j + 0.5) * CELL) < BELT.h; // cinturón: denso (60 % de las celdas); resto del sistema: asteroides sueltos (12 %)
              if (r() > (inB ? 0.6 : 0.12)) continue; const id = i + ':' + j + ':' + k; if (gone.has(id)) continue; // los destruidos no vuelven a aparecer en esta sesión
              const pos = [(i + r()) * CELL, (j + r()) * CELL, (k + r()) * CELL], h = Math.hypot(pos[0], pos[2]), u = r();
              if (Math.abs(pos[1]) > 1.5e6 || Math.hypot(pos[0] - P[0], pos[1] - P[1], pos[2] - P[2]) > RA || bodies.some(b => Math.hypot(pos[0] - b.pos[0], pos[1] - b.pos[1], pos[2] - b.pos[2]) < b.R * 1.5 + 200)) continue;
              const size = 2 + 140 * u * u * u;
              active.push({ id, pos, r: size * 0.9, vis: size, m: (r() * ROCKS.length) | 0, ax: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), rate: 0.02 + r() * 0.15, a0: r() * 6.28, tint: 0.85 + r() * 0.3 });
            }
      }
      for (const z of ZONES) { // cúmulo denso de cada zona de recursos (ZONES, game.js): mismas celdas deterministas, pero en coordenadas de la zona, que sigue a su planeta
        const par = bodies[z.anchor], lx = P[0] - par.pos[0] - z.off[0], ly = P[1] - par.pos[1] - z.off[1], lz = P[2] - par.pos[2] - z.off[2];
        if (Math.hypot(lx, ly, lz) > RA + z.radius) continue;
        const n = Math.ceil(z.radius / ZCELL), lo = v => Math.max(-n, Math.floor((v - RA) / ZCELL)), hi = v => Math.min(n - 1, Math.floor((v + RA) / ZCELL)), rt = ZROCK[z.dominant[0].type];
        for (let i = lo(lx); i <= hi(lx); i++) for (let j = lo(ly); j <= hi(ly); j++) for (let k = lo(lz); k <= hi(lz); k++) {
          const r = rndOf(((i * 73856093) ^ (j * 19349663) ^ (k * 83492791) ^ Math.imul(z.id + 1, 668265263)) >>> 0);
          if (r() > 0.5) continue; const id = 'z' + z.id + ':' + i + ':' + j + ':' + k; if (gone.has(id)) continue;
          const ox = (i + r()) * ZCELL, oy = (j + r()) * ZCELL, oz = (k + r()) * ZCELL, u = r(), size = 1.5 + 45 * u * u * u;
          if (Math.hypot(ox, oy, oz) > z.radius || Math.hypot(ox - lx, oy - ly, oz - lz) > RA) continue;
          const off = [z.off[0] + ox, z.off[1] + oy, z.off[2] + oz], pos = [par.pos[0] + off[0], par.pos[1] + off[1], par.pos[2] + off[2]];
          if (bodies.some(b => Math.hypot(pos[0] - b.pos[0], pos[1] - b.pos[1], pos[2] - b.pos[2]) < b.R * 1.5 + 200)) continue;
          active.push({ id, z: z.id, pos, parent: par, off, r: size * 0.9, vis: size, m: r() < 0.6 ? rt : (r() * ROCKS.length) | 0, ax: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), rate: 0.02 + r() * 0.15, a0: r() * 6.28, tint: 0.85 + r() * 0.3 });
        }
      }
      for (const f of fixed) {
        const pos = [f.parent.pos[0] + f.off[0], f.parent.pos[1] + f.off[1], f.parent.pos[2] + f.off[2]];
        if (!gone.has(f.id) && Math.hypot(pos[0] - P[0], pos[1] - P[1], pos[2] - P[2]) < RA) active.push({ id: f.id, pos, parent: f.parent, off: f.off, r: f.r, vis: f.size, m: f.m, ax: f.ax, rate: f.rate, a0: f.a0, tint: f.tint });
      }
      for (const o of active) api.near = Math.min(api.near, Math.hypot(o.pos[0] - P[0], o.pos[1] - P[1], o.pos[2] - P[2]) - o.r);
    },
    render(P, t, fr) { // solo se dibuja lo que está en el campo de visión; el tamaño visual nunca baja de ~0.17°; los que se ven pequeños usan la malla de pocos triángulos
      cnt.fill(0); let nc = 0;
      for (let ai = 0; ai < active.length; ai++) {
        const o = active[ai], rx = o.pos[0] - P[0], ry = o.pos[1] - P[1], rz = o.pos[2] - P[2], d = Math.sqrt(rx * rx + ry * ry + rz * rz), sc = Math.max(o.vis, d * 0.003);
        if (fr) { sph.center.set(rx, ry, rz); sph.radius = sc * 2; if (!fr.intersectsSphere(sph)) continue; }
        const lo = o.m < ROCKS.length && sc / d < LOD_ANG, mi = lo ? NM + o.m : o.m, c = cnt[mi]; if (c >= MAXI) continue;
        const im = lo ? meshesLo[o.m] : meshes[o.m];
        dummy.position.set(rx, ry, rz); dummy.quaternion.setFromAxisAngle(o.ax, o.a0 + o.rate * t / 1000); dummy.scale.setScalar(sc); dummy.updateMatrix();
        im.setMatrixAt(c, dummy.matrix); im.setColorAt(c, tint.setScalar(o.tint)); cnt[mi]++;
        if (sc / d > 0.0035 && nc < 3900 && o.z != null) { for (const g of nuggets(o)) { if (!zoneLeft(o.z, g.t)) continue; _nv.copy(g.d).multiplyScalar(0.95 * sc).applyQuaternion(dummy.quaternion); const gs = Math.max(g.s * sc, d * 0.0009); dummy2.position.set(rx + _nv.x, ry + _nv.y, rz + _nv.z); dummy2.quaternion.copy(dummy.quaternion); dummy2.scale.set(gs, gs * (g.t === 'diamante' ? 1.7 : 1), gs); dummy2.updateMatrix(); nug.setMatrixAt(nc, dummy2.matrix); nug.setColorAt(nc, tcol.setHex(g.c)); nc++; } } // pepitas que se ven desde lejos como destellos
      }
      push(nug, nc); for (let i = 0; i < NM; i++) push(meshes[i], cnt[i]); for (let i = 0; i < meshesLo.length; i++) push(meshesLo[i], cnt[NM + i]);
    },
  };
  return api;
}
