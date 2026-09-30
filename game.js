// Unidades: km. Posiciones en doubles (JS); la nave siempre se renderiza en el origen (floating origin).
const DIST_SCALE = 0.06, C = 299792.458, AU = 149597870.7 * DIST_SCALE, DAY = 86400, RMAX = 2e6; // DIST_SCALE: las órbitas de los planetas se acercan (tamaños reales); AU = 1 UA del juego. RMAX: distancia a la que se comprime el render

// Sistema procedural (sysgen.js) a partir de la semilla del servidor (seed.js): solo mundos habitables, compactos; hasta 10 cuerpos.
const SYS = genSystem(SEED, NPL); Object.assign(SURF, SYS.surf); Object.assign(ATMO, SYS.atmo); const DATA = SYS.bodies, BELT = SYS.belt;
// Zonas de recursos (sysgen.genZones, las mismas que calcula el servidor): solo sus asteroides dan recursos y lo que queda (ZR) lo dicta el servidor en cada tick
const ZONES = genZones(SYS); let ZR = ZONES.map(z => z.dominant.map(d => d.budget)), LOOTED = new Set(); // LOOTED: cascos ya saqueados en la sala
const ZT = ZONES.map((z, i) => ({ zi: i, zone: z, n: z.name, R: z.radius, pos: [0, 0, 0] })); // destinos de zona (N, mapa, salto luz); pos se actualiza cada cuadro
const zoneLeft = (zi, type) => { const k = ZONES[zi] ? ZONES[zi].dominant.findIndex(d => d.type === type) : -1; return k < 0 || !ZR[zi] ? 0 : ZR[zi][k] || 0; };
const zoneRes = zi => ZONES[zi].dominant.map((d, k) => ({ type: d.type, n: (ZR[zi] && ZR[zi][k]) || 0 })); // [{type, n}] con lo que queda
const ZONE_ARR = 3000; // el salto luz hacia una zona se corta a esta distancia de su borde

// ---------- ruido 3D (sin costura); las texturas de los astros se generan en planets.js con la misma función que el terreno ----------
const h3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
const sm = t => t * t * (3 - 2 * t);
const hash3i = (x, y, z) => { let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }; // hash entero: el terreno se genera unas 5-10 veces más rápido que con senos
const lp3 = (a, b, t) => a + (b - a) * t;
function vn(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
  return lp3(lp3(lp3(hash3i(xi, yi, zi), hash3i(xi + 1, yi, zi), fx), lp3(hash3i(xi, yi + 1, zi), hash3i(xi + 1, yi + 1, zi), fx), fy),
             lp3(lp3(hash3i(xi, yi, zi + 1), hash3i(xi + 1, yi, zi + 1), fx), lp3(hash3i(xi, yi + 1, zi + 1), hash3i(xi + 1, yi + 1, zi + 1), fx), fy), fz);
}
const fbm = (x, y, z) => { let s = 0, a = 0.5; for (let i = 0; i < 5; i++) { s += a * vn(x, y, z); x *= 2; y *= 2; z *= 2; a *= 0.5; } return s; };

function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d'), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.15, 'rgba(255,190,90,.6)'); g.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

// ---------- escena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // 1,5 como tope: a 2 la GPU pinta un 78 % más de píxeles sin diferencia apreciable
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x000000, 0); // niebla atmosférica (densidad 0 en el espacio)
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.0005, 3e7);
addEventListener('resize', () => { renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const ambLight = new THREE.AmbientLight(0xffffff, 0.22); scene.add(ambLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.6); scene.add(sunLight);

// cielo: estrellas con magnitud y color espectral + banda de la Vía Láctea (space.js); siguen a la cámara
const SKY = createSky(scene);

// cuerpos
const sphere = new THREE.SphereGeometry(1, 48, 32), glowTex = glowTexture(), labelsEl = [];
const bodies = DATA.map((d, i) => {
  const b = { ...d, i, pos: [0, 0, 0], prev: [0, 0, 0], ph: d.ph ?? (i * 2.399) % (2 * Math.PI) };
  b.parent = d.parent ? null : undefined; b.parentName = d.parent;
  const g = new THREE.Group();
  b.mesh = new THREE.Mesh(sphere, makeBodyMat(b)); if (d.k === 'sun') bodyTex(b); // planetas: la textura base se genera en la pantalla de carga (MAP.warm); la estrella, ya
  g.add(b.mesh);
  if (d.ring) {
    const r = new THREE.Mesh(new THREE.RingGeometry(d.ring[0] / d.R, d.ring[1] / d.R, 96), new THREE.MeshBasicMaterial({ color: 0xc9b98a, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }));
    r.rotation.x = -Math.PI / 2 + 0.47; g.add(r);
  }
  b.group = g; scene.add(g);
  if (d.k === 'sun') { b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeCorona(d.c1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); scene.add(b.glow); }
  const el = document.createElement('div'); el.className = 'lb'; document.body.append(el); b.el = el;
  return b;
});
bodies.forEach(b => { if (b.parentName) b.parent = bodies.find(x => x.n === b.parentName); b.mesh.material.fog = false; }); // los astros del cielo no se pierden en la niebla del suelo

let simT = Date.now() / 1000; // reloj real compartido: todos ven los planetas en el mismo sitio
function updateBodies() {
  for (const b of bodies) {
    b.prev = b.pos;
    if (!b.a) { b.pos = [0, 0, 0]; continue; }
    const th = b.ph + 2 * Math.PI * simT / (b.T * DAY), o = b.parent ? b.parent.pos : [0, 0, 0];
    const a = b.parent ? b.a : b.a * DIST_SCALE; b.pos = [o[0] + a * Math.cos(th), 0, o[2] + a * Math.sin(th)];
  }
  for (const t of ZT) { const p = bodies[t.zone.anchor].pos, f = t.zone.off; t.pos = [p[0] + f[0], p[1] + f[1], p[2] + f[2]]; } // las zonas siguen a su planeta
}
const tgtObj = () => S.tgt < bodies.length ? bodies[S.tgt] : ZT[S.tgt - bodies.length]; // destino seleccionado con N o desde el mapa: cuerpo o zona
const lockObj = () => S.lockB == null ? null : S.lockB < bodies.length ? bodies[S.lockB] : ZT[S.lockB - bodies.length]; // rumbo fijado con G: cuerpo o cúmulo (mismo índice que S.tgt)
let lastTargets = []; const SEL_R = 60000; // objetivos del último cuadro (para B) y alcance de B para elegir naves (km)
const shipTag = t => `${TYPES[t.st] ? TYPES[t.st].name : 'Nave'} · Nv ${t.lv || 0}`; // «Halcón · Nv 7»
function nextShip() { // B: siguiente nave enemiga o neutral visible y cercana (de la más cercana a la más lejana); tras la última, ninguna. Su nave y nivel se ven en el recuadro del objetivo
  const ships = lastTargets.filter(t => (t.kind === 'p' || t.kind === 'n') && t.dist < SEL_R && !losBlocked(t)).sort((a, b) => a.dist - b.dist).slice(0, 8);
  const i = S.tship ? ships.findIndex(t => t.kind === S.tship.kind && t.id === S.tship.id) : -1;
  if (i + 1 < ships.length) { const t = ships[i + 1]; S.tship = { kind: t.kind, id: t.id }; return say(`Objetivo: ${t.kind === 'n' ? 'nave neutral' : t.name} · ${shipTag(t)}`); }
  S.tship = null; say(ships.length ? 'Sin nave elegida' : 'No hay naves cerca');
}
function nextDest() { S.tgt = (S.tgt + 1) % (bodies.length + ZT.length); const t = tgtObj(); say(`Destino: ${t.n} · Shift: salto luz`); } // N: siguiente destino (planetas y zonas de recursos)

// ---------- nave ----------
let mySpec = loadSpec(), ship = makeShip(mySpec); scene.add(ship); // modelo según el hangar (ships.js)
const S = { refB: -1, canFloat: false, foot: { on: false, b: null, up: null, hd: null, pitch: -0.15, walk: 0, aim: null, mine: null, q: new THREE.Quaternion() }, shipPos: [0, 0, 0], w: { p: 0, y: 0, r: 0 }, gearK: 0, canPark: false, park: { on: false, b: null, dir: [0, 1, 0] }, assist: false, pos: [0, 0, 0], q: new THREE.Quaternion(), v: 300, tgt: 1, lockB: null, boost: 0, auto: false, warp: { cd: 0, n: 6, goT: 0, on: false, bar: 60, v: 0, lock: false, fx: 0, dir: [0, 0, -1] } }; // v: km/s objetivo
const camQ = new THREE.Quaternion();

const lookQ = (dir) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(...dir), new THREE.Vector3(0, 1, 0)));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

updateBodies();
function spawn() { // en la plataforma de tu hangar; sin hangar (menú inicial), junto al primer planeta mirándolo
  const hg = typeof BASE !== 'undefined' && BASE.mine(); if (hg && BASE.spawnAt(hg)) return;
  const e = bodies[1], sd = nrm([-e.pos[0], 0, -e.pos[2]]), r = e.R * 3.5;
  S.pos = [e.pos[0] + sd[0] * r, e.pos[1] + e.R * 0.6, e.pos[2] + sd[2] * r];
  S.pos = S.pos.map(c => c + (Math.random() - 0.5) * 2000);
  S.q.copy(lookQ(nrm(sub(e.pos, S.pos)))); camQ.copy(S.q);
}
spawn();

// ---------- ajuste a pantalla: las interfaces ocupan siempre el 100 % de la ventana sin scroll (se escalan según su contenido y el tamaño de la ventana) ----------
function fitBox(box, W) { if (!box) return; box.style.zoom = 1; box.style.width = W + 'px'; const h = box.offsetHeight || 1, s = Math.max(0.3, Math.min(innerHeight / h, innerWidth / W, 1.6)) * 0.985; box.style.zoom = s; }

// ---------- entrada ----------
const keys = {}; let mdx = 0, mdy = 0;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) scoreboard(true); } // Tab mantenida: estadísticas de los jugadores
  if (e.code === 'KeyN' && !e.repeat) nextDest();
  if (e.code === 'KeyB' && !e.repeat) nextShip();
  if (e.code === 'KeyX') { S.v = 0; S.auto = false; }
  if (e.code === 'KeyG' && !S.foot.on && !S.warp.on && P.hp > 0) { // G: fija el rumbo (y el salto luz) hacia el planeta o el cúmulo bajo la mira (otra vez: libera)
    if (S.lockB != null) { S.lockB = null; say('Vuelo directo cancelado'); }
    else if (aimT && (aimT.type === 'b' || aimT.type === 'z')) { S.lockB = aimT.type === 'b' ? aimT.b.i : bodies.length + aimT.z.zi; S.tgt = S.lockB; say(`Vuelo directo hacia ${lockObj().n}: solo W/S`); }
  }
  if (e.code === 'KeyT' && ((S.park.on && !S.park.water) || S.canPark)) togglePark();
  if (e.code === 'KeyV' && !e.repeat && P.hp > 0) { S.scanT = S.scanT ? 0 : performance.now(); say(S.scanT ? 'Escáner de recursos activado (V: apagar)' : 'Escáner apagado'); } // V: muestra los recursos alrededor con flechas
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat && !S.foot.on && !S.entry) toggleWarp(); // dentro de la atmósfera, Shift es el impulso de combustión (se mantiene pulsado)
  if (e.code === 'KeyH') document.exitPointerLock(); // volver al hangar
  if (e.code === 'Space') { e.preventDefault(); fireMissile(); }
  const gi = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code); // en la atmósfera las marchas son km/h
  if (gi >= 0 && !S.warp.on) S.v = Math.min(S.atm || S.low ? [100, 500, 1000, 2000, 3500][gi] / 3600 : [10, 100, 500, 1000, P.vmax][gi], P.vmax);
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') scoreboard(false); });
addEventListener('blur', () => scoreboard(false));
addEventListener('mousedown', e => { if (!document.pointerLockElement) return; if (e.button === 0) firing = true; if (e.button === 2) fireMissile(); });
addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => { if (document.pointerLockElement) { mdx += e.movementX; mdy += e.movementY; } });
const ov = document.getElementById('ov');
document.addEventListener('pointerlockchange', () => ov.style.display = document.pointerLockElement || window.MAPOPEN ? 'none' : 'flex'); // con el mapa abierto no se muestra el hangar

// ---------- formato ----------
const fT = s => s < 60 ? s.toFixed(1) + ' s' : s < 3600 ? Math.floor(s / 60) + ' min ' + Math.floor(s % 60) + ' s' : s < 172800 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : (s / 86400).toFixed(1) + ' días';
const fD = km => km < 1e4 ? km.toFixed(1) + ' km' : km < 1e7 ? Math.round(km).toLocaleString('es') + ' km' : (km / 1e6).toFixed(1) + ' M km (' + fT(km / C) + '-luz)';
const fV = v => v < C * 0.1 ? v.toFixed(v < 10 ? 2 : 0) + ' km/s' : (v / C).toFixed(1) + ' c';

// ---------- red ----------
let myName = 'Piloto'; try { myName = (localStorage.getItem('pname') || 'Piloto').slice(0, 16); } catch {} const remotes = new Map();
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
let myId = null, lastSend = 0, firing = false, lockT = null, seq = 0;
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
const send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));

// ---------- sonido (Web Audio, sin archivos) ----------
let audio = null, noiseBuf = null;
function ac() {
  if (!audio) { audio = new AudioContext(); const n = audio.sampleRate; noiseBuf = audio.createBuffer(1, n, n); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
['mousedown', 'keydown', 'click'].forEach(t => addEventListener(t, ac));
function tone(type, f0, f1, dur, vol) {
  const a = ac(), t = a.currentTime, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
}
function noise(dur, vol, f0, f1) {
  const a = ac(), t = a.currentTime, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur);
}
let eng = null;
function engine(v, thrusting) { // zumbido continuo: tono y volumen suben con la velocidad; más fuerte al acelerar (W)
  if (!audio) return;
  if (!eng) {
    const a = audio, o1 = a.createOscillator(), o2 = a.createOscillator(), n = a.createBufferSource(), nf = a.createBiquadFilter(), lp = a.createBiquadFilter(), g = a.createGain();
    const gA = a.createGain(), gB = a.createGain(), gC = a.createGain(); gA.gain.value = 0.5; gB.gain.value = 0.25; gC.gain.value = 0.6;
    o1.type = 'sawtooth'; o2.type = 'square'; n.buffer = noiseBuf; n.loop = true; nf.type = 'lowpass'; lp.type = 'lowpass'; g.gain.value = 0;
    o1.connect(gA).connect(lp); o2.connect(gB).connect(lp); n.connect(nf).connect(gC).connect(lp); lp.connect(g).connect(a.destination);
    o1.start(); o2.start(); n.start(); eng = { o1, o2, nf, lp, g };
  }
  const t = audio.currentTime, s = Math.log10(1 + v), on = v > 0.05 && ov.style.display === 'none' && !document.hidden, f = (45 + 14 * s + (thrusting ? 12 : 0)) * P.engMul;
  eng.g.gain.setTargetAtTime(on ? 0.05 + 0.012 * Math.min(s, 6) + (thrusting ? 0.03 : 0) : 0, t, 0.15);
  eng.o1.frequency.setTargetAtTime(f, t, 0.1); eng.o2.frequency.setTargetAtTime(f * 1.5, t, 0.1);
  eng.nf.frequency.setTargetAtTime(300 + 250 * s, t, 0.2); eng.lp.frequency.setTargetAtTime(500 + 300 * s, t, 0.2);
}
function sfx(kind, dist = 0) { // el volumen cae con la distancia
  const v = 1 / (1 + dist / 3000);
  if (kind === 'p') tone('square', 1400, 200, 0.12, 0.05 * v);
  else if (kind === 'm') { noise(0.9, 0.14 * v, 2500, 300); tone('sawtooth', 140, 50, 0.6, 0.07 * v); }
  else if (kind === 'boom') { noise(1.1, 0.3 * v, 1200, 50); tone('sine', 90, 28, 0.8, 0.25 * v); }
  else if (kind === 'hit') { noise(0.15, 0.12 * v, 3000, 400); tone('square', 220, 60, 0.15, 0.08 * v); }
  else if (kind === 'shield') tone('sine', 700, 1800, 0.22, 0.09 * v);
  else if (kind === 'empty') tone('square', 150, 140, 0.08, 0.05);
  else if (kind === 'tick') tone('square', 520 + dist * 110, 520 + dist * 110, 0.12, 0.08);
  else if (kind === 'warp') { tone('sawtooth', 70, 1200, 0.9, 0.12); noise(0.9, 0.15, 400, 5000); }
  else if (kind === 'vent') { noise(1.5, 0.24, 7500, 450); setTimeout(() => noise(1.0, 0.16, 5500, 350), 380); tone('sine', 75, 38, 1.3, 0.12); tone('sawtooth', 200, 60, 0.5, 0.04); } // expulsión de gases al despegar
  else if (kind === 'warpEnd') { tone('sawtooth', 900, 60, 0.6, 0.1); noise(0.5, 0.12, 4000, 200); }
}

// ---------- combate ----------
const MAXA = { plasma: 200, missiles: 4 }, HIT_R = 20, WRECK_R = 30, RANGE = 30000, CONE = 3 * Math.PI / 180;
const WPN = { p: { speed: 6000, life: 5, dmg: 8, cd: 0.12, size: 3, min: 0.012, color: 0x66ffd0, turn: 10 },   // plasma: cadencia alta
              m: { speed: 2500, life: 20, dmg: 60, cd: 3, size: 10, min: 0.025, color: 0xffaa33, turn: 6 } }; // misil: teledirigido, recarga lenta
let lastRumble = 0, aimT = null, lastAimB = null; const _fogC = new THREE.Color();
function occluded(b) { // ¿lo tapa el disco de otro cuerpo más cercano (o el propio planeta bajo tus pies)? Usa b.rel/b.dist del cuadro
  for (const o of bodies) {
    if (o === b || !(o.dist < b.dist) || !o.rel || o.dist <= o.R) continue;
    const c = (b.rel[0] * o.rel[0] + b.rel[1] * o.rel[1] + b.rel[2] * o.rel[2]) / (b.dist * o.dist);
    if (Math.acos(Math.max(-1, Math.min(1, c))) < Math.asin(Math.min(1, o.R / o.dist)) * 0.985) return true;
  }
  return false;
}
const P = { lastCombat: -1e9, agil: 1, turb: 0, heat: 0, vmax: 1100, warpMax: 60, hp: 100, hpMax: 100, sh: 100, shMax: 100, rockT: 0, engMul: 1, sf: 0, shake: 0, smoke: 0, shT: 0, fc: '255,0,0', plasma: MAXA.plasma, missiles: MAXA.missiles, kills: 0, deadUntil: 0, cdP: 0, cdM: 0, flash: 0, msg: '', msgT: 0 };
const rsEl = document.createElement('div'); rsEl.id = 'rs'; document.body.append(rsEl); let rsSig = '';
const ntEl = document.getElementById('nt'), ntRes = {}; let lastSay = '', lastSayT = 0;
function notifyEl(html, ms, cls = '') { // panel de notificaciones (derecha): entradas que se apilan y se desvanecen
  const el = document.createElement('div'); el.className = 'ni ' + cls; el.innerHTML = html; ntEl.append(el); while (ntEl.children.length > 7) ntEl.firstChild.remove();
  setTimeout(() => el.classList.add('out'), ms - 500); setTimeout(() => el.remove(), ms); return el;
}
function notifyRes(type, n) { // recurso obtenido: icono + cantidad (las ganancias seguidas del mismo recurso se suman)
  const now = performance.now(), r = ntRes[type];
  if (r && r.el.isConnected && now - r.t < 1600) { r.n += n; r.t = now; r.el.querySelector('b').textContent = '+' + r.n; return; }
  ntRes[type] = { el: notifyEl(`<i class="ico">${typeof ICONS !== 'undefined' ? ICONS[type] : ''}</i><b>+${n}</b><span>${type}</span>`, 6500, 'res'), n, t: now };
}
const QUIET = /luz|salto|atmósfera|exosfera|planeta|Ruedas|estacionada|Amerizaje|flota|despegar|impulso|despeg|aterriz|Partida iniciada|toma(r)? el control|preparando|Escáner|BAJO ATAQUE|atacando|te disparan/i; // planeta, velocidad luz, despegue/aterrizaje, inicio de partida, escáner y ataques: solo texto central, sin notificación
const say = t => { const now = performance.now(); P.msg = t; P.msgT = now + 2500; if ((t !== lastSay || now - lastSayT > 3000) && !QUIET.test(t)) notifyEl(`<span>${t}</span>`, 5500); lastSay = t; lastSayT = now; };
// ---------- experiencia y niveles de la nave actual (datos y fórmula en ships.js: LVL, lvNeed, LV_MAX) ----------
function gainXp(n, why) { // XP para la nave que pilotas ahora; cada nivel da 1 punto de mejora para esa nave
  const L = lvlOf(mySpec.t); if (!(n > 0) || L.lv >= LV_MAX) return; L.xp += n; let up = 0;
  while (L.lv < LV_MAX && L.xp >= lvNeed(L.lv + 1)) { L.xp -= lvNeed(L.lv + 1); L.lv++; up++; }
  if (L.lv >= LV_MAX) L.xp = 0; saveLv();
  notifyEl(`<i class="ico">★</i><span><b>+${n} XP</b> ${why}</span>`, 5000, 'xp');
  if (up) { notifyEl(`<i class="ico">★</i><span><b>¡Nivel ${L.lv}!</b> Ve a tu base para mejorar</span>`, 9000, 'xp'); [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone('square', f, f * 1.01, 0.18, 0.06), i * 110)); } // aviso normal (sin banner) y sonido
}
// ---------- Tab mantenida: estadísticas por jugador (humanos primero y luego bots; por nivel y bajas) sin soltar el ratón ----------
const sbEl = document.createElement('div'); sbEl.id = 'sb'; document.body.append(sbEl); let sbOn = false, sbT = 0;
function scoreboard(on) { sbOn = on; sbEl.style.display = on ? 'block' : 'none'; if (on) { sbT = 0; scoreboardTick(performance.now()); } }
function scoreboardTick(now) {
  if (!sbOn || now - sbT < 300) return; sbT = now;
  const hg = id => (typeof BASE !== 'undefined' ? BASE.HG.get(id) : null) || null, hex = c => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0'), rows = [];
  rows.push({ me: true, bot: false, nm: myName, col: mySpec.c, t: mySpec.t, lv: lvlOf(mySpec.t).lv, k: P.kills, d: P.deaths || 0, h: hg(myId), alive: P.hp > 0 });
  for (const r of remotes.values()) { const bot = r.id >= 2000; let c = 0xff6a3c; try { c = JSON.parse(r.spk).c; } catch {} rows.push({ bot, nm: r.name || 'Piloto', col: c, t: r.st, lv: r.lv || 0, k: bot ? null : r.k || 0, d: bot ? null : r.d || 0, h: hg(bot ? r.id - 1000 : r.id), alive: r.hp > 0 }); } // un bot (2000+i) tiene su base en 1000+i
  if (typeof BOT !== 'undefined') for (const [i, B] of BOT.bots) rows.push({ bot: true, nm: B.name || 'BOT', col: 0xff4030, t: 'halcon', lv: 5, k: null, d: null, h: hg(1000 + i), alive: !B.dead }); // en el anfitrión sus bots no son remotos
  rows.sort((a, b) => (a.bot - b.bot) || (b.lv - a.lv) || ((b.k || 0) - (a.k || 0)));
  const bar = h => { if (!h) return '<span class="sbn">—</span>'; const f = Math.max(0, Math.min(1, h.hp / h.st.hpMax)); return `<div class="sbb"><i style="width:${f * 100}%;background:${f > 0.35 ? '#5dff8a' : '#ff5a4a'}"></i></div>`; };
  sbEl.innerHTML = `<div class="sbx"><h3>JUGADORES DE LA SALA · ${rows.length}</h3><table><tr><th></th><th>Piloto</th><th>Nave</th><th>Nivel</th><th>Bajas</th><th>Muertes</th><th>Base</th><th>Estado</th></tr>${rows.map(r => `<tr class="${r.me ? 'me' : ''}${r.bot ? ' bot' : ''}"><td><span class="sbav" style="background:${hex(r.col)}">${(r.nm || '?').replace(/^BOT /, '').charAt(0).toUpperCase()}</span></td><td>${r.nm}${r.me ? ' <small>(tú)</small>' : ''}${r.bot ? ' <small>BOT</small>' : ''}</td><td>${TYPES[r.t] ? TYPES[r.t].name : '—'}</td><td>${hexSvg(r.lv, r.me ? '#4db8ff' : '#ffd23f', 26)}</td><td>${r.k ?? '—'}</td><td>${r.d ?? '—'}</td><td>${bar(r.h)}</td><td class="${r.alive ? 'ok' : r.h ? 'rs' : 'ko'}">${r.alive ? 'EN VUELO' : r.h ? 'REAPARECE' : 'DERROTADO'}</td></tr>`).join('')}</table><small>Suelta Tab para cerrar</small></div>`;
}
let CARRY = [0, 0, 0]; // desplazamiento orbital del planeta cercano en este cuadro (lo que está en su aire viaja con él)
const AST = new Map(), ZONE_PER = { agua: 12, piedra: 14, cobre: 8, plata: 5, oro: 4, diamante: 2 }; // unidades medias por asteroide de zona del recurso dominante principal (el secundario, el 60 %)
const ROCKN = ['carbonáceo', 'rocoso', 'metálico', 'de hielo', 'alargado', 'binario'], ICOIMG = {};
function astInfo(o) { // recursos que carga un asteroide (determinista por su identificador). Solo los de una zona (o.z) llevan recursos: los de sus dominantes. Fuera de las zonas son obstáculos sin recursos
  if (o.res) return o.res;
  let h = 2166136261; for (const ch of String(o.id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = rndOf(h >>> 0), base = o.m < fields.rockCount ? Math.max(3, Math.round(3 + o.vis * 0.33)) : 2 + Math.round(o.vis * 8), list = [];
  if (o.z != null && ZONES[o.z]) ZONES[o.z].dominant.forEach((d, k) => list.push({ type: d.type, n: Math.max(1, Math.round(ZONE_PER[d.type] * (k ? 0.6 : 1) * (0.6 + 0.8 * r()) * (0.7 + Math.min(o.vis, 40) / 40))) }));
  const tot = list.reduce((a, b) => a + b.n, 0);
  return (o.res = { list, n: tot, hp: 10 * Math.max(base, tot), type: list[0] ? list[0].type : null });
}
function astLeft(o) { return astInfo(o).list.map(it => ({ type: it.type, n: Math.min(it.n, zoneLeft(o.z, it.type)) })).filter(it => it.n > 0); } // lo que aún daría: nunca más de lo que le queda a su zona
function hitAsteroid(o, dmg) { // mi disparo golpea un asteroide; al destruirlo se piden sus recursos al servidor, que concede lo que quede en la zona (se suman al llegar la respuesta 'mined')
  const r = astInfo(o), st = AST.get(o.id) || { dmg: 0 }; AST.set(o.id, st); st.dmg += dmg;
  if (st.dmg >= r.hp) {
    const got = astLeft(o); if (o.z != null && got.length) send({ t: 'mine', z: o.z, list: got });
    fields.gone.add(o.id); const i = fields.active.indexOf(o); if (i >= 0) fields.active.splice(i, 1); AST.delete(o.id); boom(o.pos, Math.min(40, Math.max(3, o.vis * 0.5)));
  }
}
const icoImg = k => { let im = ICOIMG[k]; if (!im && typeof ICONS !== 'undefined') { im = ICOIMG[k] = new Image(); im.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(ICONS[k]); } return im; };
const projs = new Map(), fx = [], dusts = [], AIR = { p: 14, m: 4.5 }; // dentro de la atmósfera (km/s): llegan rápido al blanco
function airK(pos) { let k = 0; for (const b of bodies) { const a = ATMO[b.n]; if (a) k = Math.max(k, sstep(0.9, 0.5, (Math.hypot(pos[0] - b.pos[0], pos[1] - b.pos[1], pos[2] - b.pos[2]) - b.R) / a.H)); } return k; }
function view(p) { const rel = sub(p, S.pos), d = len(rel) || 1e-9, rd = d > RMAX ? RMAX * (2 - RMAX / d) : d, s = rd / d; return { rel, d, rd, s, x: rel[0] * s, y: rel[1] * s, z: rel[2] * s }; }
function makeMissile() {
  const g = new THREE.Group(), body = new THREE.MeshBasicMaterial({ color: 0xdfe6ee });
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8).rotateX(Math.PI / 2), body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b2f })); nose.position.z = -0.62;
  const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.25), body), f2 = f1.clone(); f1.position.z = f2.position.z = 0.35; f2.rotation.z = Math.PI / 2;
  g.flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1, 8).rotateX(Math.PI / 2), glow(0xffa030, 0.9)); g.flame.position.z = 0.95;
  g.add(b, nose, f1, f2, g.flame); return g;
}
function spawnProj(owner, key, kind, pos, dir, tgt, dmg, o = {}) { // o: { spd (km/s fija), col, life, bot } para proyectiles especiales (torretas, bots)
  let obj;
  if (kind === 'p') { obj = new THREE.Group(); const core = new THREE.Mesh(bolt, glow(0xffffff)); core.scale.set(0.35, 0.35, 1); obj.add(new THREE.Mesh(bolt, glow(o.col ?? WPN.p.color, 0.6)), core); }
  else obj = makeMissile();
  scene.add(obj); projs.set(key, { o0: [...pos], owner, kind, fromSpace: o.spd === undefined && airK(pos) < 0.02, spd: o.spd, bot: o.bot, pos: [...pos], dir: [...dir], tgt, life: o.life ?? WPN[kind].life, dmg: dmg ?? WPN[kind].dmg, sp: obj, puff: 0 });
}
function killProj(key) { const p = projs.get(key); if (p) { scene.remove(p.sp); projs.delete(key); } }
function puff(pos, size, color, dur, min) { const sp = new THREE.Mesh(ball, glow(color)); scene.add(sp); fx.push({ pos: [...pos], size, t: 0, dur, min, sp }); }
const DUST0 = new THREE.Color(0xa08c70); let dustAcc = 0;
function dustBurst(n, str) { // nube de polvo bajo la nave: sale del suelo en anillo y se expande
  const b = S.park.b || bodies.find(x => x.n === planets.info.name); if (!b || S.park.water || planets.info.water) return;
  const up = new THREE.Vector3(S.pos[0] - b.pos[0], S.pos[1] - b.pos[1], S.pos[2] - b.pos[2]).normalize(), e = new THREE.Vector3(0, 1, 0).cross(up); if (e.lengthSq() < 1e-6) e.set(1, 0, 0); e.normalize(); const nn = up.clone().cross(e);
  const gh = S.park.on ? S.park.h : Math.max(0, planets.info.ground), col = new THREE.Color(b.c1 ?? 0x9c8a70).lerp(DUST0, 0.6);
  for (let i = 0; i < n && dusts.length < 260; i++) {
    const a = Math.random() * 6.283, dir = e.clone().multiplyScalar(Math.cos(a)).addScaledVector(nn, Math.sin(a)), r = Math.random() * 0.008;
    const m = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.75 + 0.35 * Math.random()), transparent: true, opacity: 0, depthWrite: false })); scene.add(m);
    const p = [S.pos[0] - up.x * gh + dir.x * r, S.pos[1] - up.y * gh + dir.y * r, S.pos[2] - up.z * gh + dir.z * r], sp = (0.004 + 0.014 * str * Math.random()), vu = 0.0015 + 0.004 * Math.random();
    dusts.push({ m, p, v: [dir.x * sp + up.x * vu, dir.y * sp + up.y * vu, dir.z * sp + up.z * vu], t: 0, dur: 2 + 2.2 * Math.random(), size: 0.003 + 0.005 * Math.random() });
  }
}
function dustTick(dt) { // emisión continua cerca del suelo (motores) y actualización de las partículas
  const pk = S.park; let rate = 0;
  if (!S.foot.on && P.hp > 0) {
    if (pk.on && pk.leaving) rate = 8 * Math.max(0, 1 - pk.t / 1.2); else if (pk.on && pk.dustT > 0) { pk.dustT -= dt; rate = 12 * Math.min(1, pk.dustT); }
    else if (!pk.on && planets.info.on && !planets.info.water && planets.info.ground < 0.03 && S.ve > 0.0005) rate = 18 * (1 - planets.info.ground / 0.03); // volando bajo: los motores levantan polvo
  }
  dustAcc += rate * dt; if (dustAcc >= 1) { const n = Math.floor(dustAcc); dustAcc -= n; dustBurst(n, 0.8); }
  for (let i = dusts.length - 1; i >= 0; i--) {
    const q = dusts[i]; q.t += dt; const u = q.t / q.dur;
    if (u >= 1) { scene.remove(q.m); q.m.material.dispose(); dusts.splice(i, 1); continue; }
    const k = Math.exp(-dt * 0.9); q.v = q.v.map(c => c * k); q.p = q.p.map((c, j) => c + q.v[j] * dt + CARRY[j]);
    q.m.position.set(q.p[0] - S.pos[0], q.p[1] - S.pos[1], q.p[2] - S.pos[2]); q.m.scale.setScalar(q.size * (1 + 3.5 * u)); q.m.material.opacity = 0.32 * (1 - u) * Math.min(1, u * 12);
  }
}
function boom(pos, size) { puff(pos, size, size >= 20 ? 0xffb060 : 0xffe0a0, 0.9, size >= 20 ? 0.012 : 0.004); sfx(size >= 20 ? 'boom' : 'hit', len(sub(pos, S.pos))); }
function segDist(a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-9;
  const t = Math.max(0, Math.min(1, (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / l2));
  return len([ac[0] - ab[0] * t, ac[1] - ab[1] * t, ac[2] - ab[2] * t]);
}
let muz = 0;
function losBlocked(t) { // ¿hay un planeta (o luna o estrella) entre mi nave y ese objetivo? Entonces no se marca ni se fija
  const d = t.dir, end = t.dist - (t.kind === 'h' ? 1.5 : 0); // una base apoyada en su propio planeta queda a ras de la esfera
  for (const b of bodies) {
    const oc = [S.pos[0] - b.pos[0], S.pos[1] - b.pos[1], S.pos[2] - b.pos[2]], R = b.R * 0.999 - 0.5, B = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2], C = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - R * R;
    if (C <= 0) continue; const disc = B * B - C; if (disc <= 0) continue; const te = -B - Math.sqrt(disc); if (te > 0 && te < end) return true;
  }
  return false;
}
function shoot(kind, tgt) {
  P.lastCombat = performance.now();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q), dir = [f.x, f.y, f.z];
  const o = kind === 'p' ? ship.muzzles[muz++ % ship.muzzles.length] : ship.pylons[P.missiles] || ship.pylons[0]; // cañón alterno / pilón del misil que sale
  const off = o.clone().applyQuaternion(S.q), pos = S.pos.map((c, i) => c + off.getComponent(i)), dmg = WPN[kind].dmg;
  const key = `${myId ?? 0}:${++seq}`; spawnProj(myId, key, kind, pos, dir, tgt, dmg); sfx(kind);
  send({ t: 'fire', key, kind, pos, dir, tgt, dmg, rb: S.refB, rp: S.refB >= 0 ? sub(pos, bodies[S.refB].pos) : null });
}
// ---------- estacionar: cerca del suelo y despacio la nave se posa sobre el terreno (tren de aterrizaje) ----------
function togglePark() { if (S.foot.on) return; // T cerca del suelo: despliega las ruedas y estaciona; T otra vez despega
  const pk = S.park; if (pk.on) { if (pk.water || pk.leaving) return; Object.assign(pk, { leaving: true, t: 0, h0: pk.h }); sfx('vent'); dustBurst(5, 0.5); P.shake = Math.max(P.shake, 0.15); return say('Despegando…'); }
  if (!S.canPark) return;
  const info = planets.info, b = bodies.find(x => x.n === info.name), d = sub(S.pos, b.pos), l = len(d);
  Object.assign(pk, { on: true, b, dir: d.map(c => c / l), h: Math.max(ship.gearH, info.ground), water: !!info.water, upT: null, leaving: false, dustT: 1.0 }); if (!info.water) { dustBurst(22, 0.6); noise(0.5, 0.08, 3000, 300); } S.v = 0; say(info.water ? 'Nave sobre el agua: flota con las olas · W para despegar' : 'Ruedas desplegadas · nave estacionada');
}
function parkStep(dt) { // en tierra: desciende sobre las ruedas y sigue el terreno; en el agua: se hunde un poco y flota cabeceando con las olas
  const pk = S.park, b = pk.b, R = b.R, dR = pk.dir.map(c => c * R);
  if (pk.water) {
    const t = performance.now() / 1000, up = new THREE.Vector3(...pk.dir), e = new THREE.Vector3(0, 1, 0).cross(up).normalize(), nn = up.clone().cross(e), d = 0.03, wh = v => planets.waveH([dR[0] + v.x, dR[1] + v.y, dR[2] + v.z], t);
    const hs = wh(new THREE.Vector3()), gx = (wh(e.clone().multiplyScalar(d)) - wh(e.clone().multiplyScalar(-d))) / (2 * d), gz = (wh(nn.clone().multiplyScalar(d)) - wh(nn.clone().multiplyScalar(-d))) / (2 * d);
    pk.h += (0.0006 - pk.h) * (1 - Math.exp(-dt * 1.5)); pk.upT = up.clone().addScaledVector(e, -gx).addScaledVector(nn, -gz).normalize(); // se inclina según la pendiente de la ola
    S.shipPos = b.pos.map((c, i) => c + pk.dir[i] * (R + hs + pk.h));
  } else {
    if (pk.leaving) { pk.t += dt; const u = Math.min(1, pk.t / 1.8); pk.h = pk.h0 + 0.1 * u * u * (3 - 2 * u); if (pk.t >= 1.8) { pk.on = false; pk.leaving = false; S.v = 0.02; say('Despegue completado · control de la nave'); } } // sube 100 m solo, con arranque y frenada suaves
    else pk.h += (ship.gearH - pk.h) * (1 - Math.exp(-dt * 3));
    S.shipPos = b.pos.map((c, i) => c + pk.dir[i] * (planets.surfaceR(b, dR, R) + pk.h));
  }
  if (!S.foot.on) S.pos = S.shipPos.slice(); // a pie, S.pos es el astronauta
}
function burn(dmg, now) { // daño por calor (sin destello): el escudo primero, luego el casco
  const over = dmg - P.sh; P.sh = Math.max(0, P.sh - dmg); if (over > 0) P.hp -= over; P.shT = now;
  if (P.hp <= 0) { P.cause = P.cause || (P.heatStar ? 'la radiación de la estrella destruyó la nave' : 'te desintegraste al entrar a la atmósfera a demasiada velocidad'); P.deaths = (P.deaths || 0) + 1; P.deadUntil = now + 10000; S.v = 0; boom(S.pos, 60); }
}

// ---------- velocidad luz: 5 c en línea recta, con barra de motor; se corta a 5000 km de cualquier cuerpo ----------
function endWarp(msg) { const w = S.warp; if (!w.on) return; w.on = false; w.tb = null; w.ex = null; S.lockB = null; S.v = Math.min(P.vmax, 400); if (msg) say(msg); sfx('warpEnd'); }
const inCombat = now => now - P.lastCombat < 10000 || [...remotes.values()].some(r => r.hp > 0 && r.dist < 30000); // combate: disparos o daño recientes, o un enemigo cerca
function warpBlock() { // null = se puede saltar; si no, el cuerpo que lo impide. Cerca de un planeta se permite si ya saliste de su exosfera y tanto tu nave como el rumbo miran hacia fuera de él (llena S.warp.ex con los que se dejan atrás)
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q), tb = warpTarget(), ex = new Set();
  for (const b of bodies) {
    const d = sub(S.pos, b.pos), l = len(d), alt = l - b.R, lim = b.k === 'sun' ? 2.6 * b.R : 5000; if (alt >= lim) continue;
    if (b.k === 'sun') return b;
    const up = d.map(c => c / l), away = f.x * up[0] + f.y * up[1] + f.z * up[2] > 0.2, td = tb ? nrm(sub(tb.pos, S.pos)) : null, tAway = td ? td[0] * up[0] + td[1] * up[1] + td[2] * up[2] > 0.2 : false, out = alt > (ATMO[b.n] ? 6 * ATMO[b.n].H : 200);
    if (!(away && tAway && out)) return b; ex.add(b.i);
  }
  S.warp.ex = ex; return null;
}
function toggleWarp() {
  const w = S.warp; if (w.on) return endWarp('Velocidad luz desactivada');
  if (w.cd > 0) { w.cd = 0; return say('Cuenta atrás cancelada'); }
  if (P.hp <= 0 || S.park.on) return;
  if (inCombat(performance.now())) return say('No puedes activar la velocidad luz en combate');
  if (w.lock || w.bar < 2) return say('Motor de velocidad luz recargando…');
  { const blk = warpBlock(); if (blk) return say(blk.k === 'sun' ? `Demasiado cerca de ${blk.n} para velocidad luz` : `Cerca de ${blk.n}: sal de su atmósfera y mira hacia fuera del planeta para saltar`); }
  if (!warpTarget()) return say('Sin destino para el salto'); w.pick = warpTarget(); say(`Salto hacia ${w.pick.n}`); // el destino queda fijado durante la cuenta atrás
  w.cd = 5; w.n = 6; // cuenta atrás de 5 s con pitido por número; al llegar a 0 se activa el salto (ver startWarp)
}
function warpTarget() { // destino del salto: el rumbo fijado con G, el elegido al empezar la cuenta atrás, el cúmulo bajo la mira, la zona elegida con N o en el mapa (si aún no estás en ella) o, si no, el cuerpo más cercano a la dirección de la mira (nunca sales del sistema)
  if (S.lockB != null) return lockObj();
  if (S.warp.cd > 0 && S.warp.pick) return S.warp.pick;
  const far = t => t && t.zone && len(sub(t.pos, S.pos)) > t.R + ZONE_ARR + 500;
  if (aimT && aimT.type === 'z' && far(aimT.z)) return aimT.z;
  { const t = tgtObj(); if (far(t)) return t; }
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q); let best = null, ba = 9;
  for (const b of bodies) { const d = sub(b.pos, S.pos), l = len(d); if (l - b.R < 5000) continue; const a = Math.acos(Math.max(-1, Math.min(1, (f.x * d[0] + f.y * d[1] + f.z * d[2]) / l))); if (a < ba) { ba = a; best = b; } }
  return best;
}
function startWarp() { const w = S.warp, tb = w.pick || warpTarget(); w.pick = null; if (!tb) { w.cd = 0; return say('Sin destino para el salto'); } { const blk = warpBlock(); if (blk) { w.cd = 0; return say(`Cerca de ${blk.n}: mira hacia fuera del planeta para saltar`); } } w.tb = tb; const dd = nrm(sub(tb.pos, S.pos)); w.on = true; w.dir = dd; w.v = Math.max(S.v, 1000); w.goT = performance.now(); sfx('warp'); }
function warpStep(dt) { // avanza en tramos de 2500 km para no saltarse un planeta a 1,5 millones de km/s
  const w = S.warp; let left = w.v * dt; if (w.tb) w.dir = nrm(sub(w.tb.pos, S.pos)); // la trayectoria sigue al destino (los planetas orbitan)
  while (left > 0) {
    const st = Math.min(2500, left); S.pos = [S.pos[0] + w.dir[0] * st, S.pos[1] + w.dir[1] * st, S.pos[2] + w.dir[2] * st]; left -= st;
    if (w.tb && w.tb.zone && len(sub(w.tb.pos, S.pos)) < w.tb.R + ZONE_ARR) return endWarp(`Has llegado a ${w.tb.n}`); // destino de zona: se corta cerca de su borde
    for (const b of bodies) if (!(w.ex && w.ex.has(b.i)) && Math.hypot(S.pos[0] - b.pos[0], S.pos[1] - b.pos[1], S.pos[2] - b.pos[2]) - b.R < (b.k === 'sun' ? 2.6 * b.R : 5000)) return endWarp(b.k === 'sun' ? '¡Zona de radiación del Sol! Velocidad luz desactivada' : `¡${b.n} a 5000 km! Velocidad luz desactivada`);
  }
}
function fireMissile() {
  if (P.hp <= 0 || P.cdM > 0 || S.warp.on || S.foot.on || S.warp.cd > 0) return;
  if (P.missiles <= 0) { sfx('empty'); return say('SIN MISILES — destruye cascos a la deriva'); }
  P.missiles--; P.cdM = WPN.m.cd; shoot('m', lockT ? { k: lockT.kind, id: lockT.id } : null);
}
applyLoadout(mySpec, false);
const targetSpeed = t => t.k === 'p' ? (t.id === myId ? S.ve : remotes.get(t.id)?.v || (typeof BOT !== 'undefined' ? BOT.speed(t.id) : 0)) : t.k === 'n' && typeof NEU !== 'undefined' ? NEU.speed(t.id) : 0;
function targetPos(t) { if (t.k === 'h') return typeof BASE !== 'undefined' ? BASE.targetPos(t.id) : null; if (t.k === 'p') return t.id === myId ? S.pos : remotes.get(t.id)?.apos || (typeof BOT !== 'undefined' ? BOT.pos(t.id) : null); if (t.k === 'n') return typeof NEU !== 'undefined' ? NEU.pos(t.id) : null; const w = wrecks[t.id]; return w && !dead.has(w.i) ? w.pos : null; }

function applyLoadout(spec, reset = true) {
  mySpec = spec; const st = statsOf(spec, lvlOf(spec.t).a); scene.remove(ship); ship = makeShip(spec); scene.add(ship); // con los puntos de nivel de ESTA nave
  Object.assign(MAXA, { plasma: st.plasma, missiles: st.missiles }); WPN.p.dmg = st.pdmg;
  Object.assign(P, { hpMax: st.hp, shMax: st.sh, hp: st.hp, sh: st.sh, plasma: st.plasma, missiles: st.missiles, engMul: st.pitch, agil: st.agil, vmax: st.vmax, warpMax: st.warp, regen: st.regen });
  Object.assign(S.warp, { on: false, lock: false, bar: st.warp, fx: 0 }); S.v = Math.min(S.v, st.vmax);
  if (reset) spawn();
}

// cascos a la deriva: naves sin tripulación fijas respecto a un planeta; destruirlos recarga la munición
const WRECK_HP = 16, dead = new Set(), wrecks = [], fields = createFields(scene, bodies), planets = createPlanets(scene, bodies, SKY);
{
  const rng = seed => { let a = seed * 2654435761 >>> 0; return () => { a = a + 0x6D2B79F5 >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  Array.from({ length: 32 }, (_, i) => 1 + (i * 3 + 1) % (bodies.length - 1)).forEach((bi, i) => { // 32 cascos: 18 junto a los mundos y 14 repartidos por el cinturón
    const r = rng(i + 1), b = i >= 18 ? bodies[0] : bodies[bi], d = i >= 18 ? BELT.i + r() * (BELT.o - BELT.i) : b.R * (2 + r() * 3), th = r() * 6.283, ph = i >= 18 ? 0 : (r() - 0.5) * 1.2, grp = makeShip({ t: Object.keys(TYPES)[i % 4], a: [0, 0, 0, 0, 0], c: 0x333333 }, 0x4a4f55); scene.add(grp); setThrust(grp, 0, 0);
    wrecks.push({ i, parent: b, off: [d * Math.cos(th) * Math.cos(ph), d * Math.sin(ph), d * Math.sin(th) * Math.cos(ph)], hp: WRECK_HP, grp, pos: [0, 0, 0], ax: new THREE.Vector3(r(), r(), r()).normalize(), ang: r() * 6 });
  });
}

ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id) { myId = m.id; window.__welcome = m; if (typeof BASE !== 'undefined' && BASE.booted()) BASE.onWelcome(m); return; }
  if ((m.created !== undefined || m.joined !== undefined || m.mismatch !== undefined || m.room !== undefined || m.resumed !== undefined) && typeof BASE !== 'undefined') return void BASE.onRoomMsg(m);
  if (m.claim !== undefined) return void (typeof BASE !== 'undefined' && BASE.onClaim(m.claim));
  if (m.mined) { // respuesta del servidor a una extracción (asteroide de zona o casco): solo ahora se suman los recursos concedidos
    const got = Array.isArray(m.got) ? m.got : []; for (const it of got) if (RES[it.type] && it.n > 0) FOOT.add(it.type, it.n);
    if (Number.isInteger(m.z) && ZR[m.z]) { for (const it of got) { const k = ZONES[m.z].dominant.findIndex(d => d.type === it.type); if (k >= 0) ZR[m.z][k] = Math.max(0, ZR[m.z][k] - it.n); } if (!got.length) say(`${ZONES[m.z].name}: ya no queda nada de eso`); } // se descuenta ya; el tick lo confirma
    if (Number.isInteger(m.w)) LOOTED.add(m.w);
    return;
  }
  if (m.ev) {
    const e = m.ev;
    if (e.t === 'fire') { if (e.rb >= 0 && e.rp) e.pos = bodies[e.rb].pos.map((c, i) => c + e.rp[i]); spawnProj(e.ow ?? e.id, e.key, e.kind, e.pos, e.dir, e.tgt, e.dmg, e.tw ? { spd: e.spd || 1, col: 0xff5040, life: 30 } : undefined); if (e.tw) { const q = projs.get(e.key); if (q) q.vis = true; } const de = len(sub(e.pos, S.pos)); sfx(e.kind, de); if (de < 40000) P.lastCombat = performance.now(); if (!e.tw && P.hp > 0 && de < 30000 && de > 0 && (S.pos[0] - e.pos[0]) * e.dir[0] / de + (S.pos[1] - e.pos[1]) * e.dir[1] / de + (S.pos[2] - e.pos[2]) * e.dir[2] / de > 0.985) attackAlert('p', ownerName(e.ow ?? e.id), e.pos); } // disparo de otra nave que apunta hacia mí
    else if (e.t === 'hit') {
      killProj(e.key); const vid = e.v ?? e.id, r = remotes.get(vid); puff(e.pos, 0.02, 0xffd070, 0.5, 0.012); // vid: la víctima (un bot si lo envía el anfitrión)
      if (e.sh > 0 && r) { r.fl = 1; sfx('shield', len(sub(e.pos, S.pos))); } else boom(e.pos, e.dead ? 60 : e.dmg > 20 ? 25 : 6);
      if (e.dead && e.by === myId) { P.kills++; say('¡BAJA CONFIRMADA!'); if (vid >= 2000) gainXp(5, 'Bot enemigo derribado'); else gainXp(8 + 4 * ((r && r.lv) || 0), `${(r && r.name) || 'Piloto'} derribado`); } } // XP: bots 5; jugadores 8 + 4 × su nivel
    else if (e.t === 'nhit' && typeof NEU !== 'undefined') NEU.onHit(e);
    else if (e.t === 'wreck' && e.by !== myId) boom(wrecks[e.w].pos, 80);
    else if ((e.t === 'hdead' || e.t === 'hgone') && typeof BASE !== 'undefined') BASE.onEvent(e);
    return;
  }
  if (m.hg && typeof BASE !== 'undefined') BASE.sync(m.hg);
  if (m.ph && typeof BASE !== 'undefined') BASE.onLobby(m);
  if (Array.isArray(m.zr) && m.zr.length === ZONES.length) ZR = m.zr; // lo que queda en cada zona (igual para todos los de la sala)
  if (Array.isArray(m.wl)) LOOTED = new Set(m.wl);
  if (Array.isArray(m.nv) && typeof NEU !== 'undefined') NEU.sync(m.nv); // naves neutrales (las simula el anfitrión)
  const wd = new Set(m.wd); for (const w of wrecks) if (dead.has(w.i) && !wd.has(w.i)) w.hp = WRECK_HP;
  dead.clear(); wd.forEach(i => dead.add(i));
  const seen = new Set();
  for (const p of m.players) {
    if (p.id === myId || (p.id >= 2000 && typeof BASE !== 'undefined' && BASE.isHost()) || !p.pos.every(Number.isFinite)) continue; // los bots los simula el administrador (bot.js)
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) { r = { id: p.id, q: new THREE.Quaternion() }; remotes.set(p.id, r); }
    const spk = JSON.stringify(p.sp); // el rival cambió de nave o de mejoras: reconstruir su modelo
    if (r.spk !== spk) { if (r.grp) scene.remove(r.grp); r.grp = makeShip(p.sp); r.grp.visible = false; scene.add(r.grp); r.spk = spk; } // oculta hasta que el cuadro la coloque (si no, asomaría un instante sobre mi nave)
    Object.assign(r, { rb: p.rb ?? -1, rp: p.rp, bt: p.bt || 0, name: p.name, pos: p.pos, v: p.v, hp: p.hp, sh: p.sh, ms: p.ms, pk: p.pk, lv: p.lv || 0, st: p.sp && p.sp.t, k: p.k || 0, d: p.d || 0, t: Date.now() }); r.q.fromArray(p.q); // lv/st: nivel y tipo de su nave · k/d: bajas y muertes
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { scene.remove(r.grp); remotes.delete(id); }
};

// ---------- mira, radar y alarma ----------
const hc = document.createElement('canvas'), g2 = hc.getContext('2d');
hc.style.cssText = 'position:fixed;inset:0;pointer-events:none'; document.body.append(hc);
let lastBeep = 0;
const beep = () => tone('square', 950, 950, 0.09, 0.04);
const MONO = 'ui-monospace,Consolas,monospace';
function missileIcon(x, y, k, ready) { // punta arriba
  g2.save(); g2.translate(x, y); g2.scale(k, k);
  g2.fillStyle = ready ? '#dfe6ee' : 'rgba(255,255,255,0.18)';
  g2.beginPath(); g2.moveTo(0, -34); g2.lineTo(6, -22); g2.lineTo(6, 16); g2.lineTo(-6, 16); g2.lineTo(-6, -22); g2.closePath(); g2.fill();
  g2.beginPath(); g2.moveTo(-6, 4); g2.lineTo(-16, 26); g2.lineTo(-6, 16); g2.closePath(); g2.moveTo(6, 4); g2.lineTo(16, 26); g2.lineTo(6, 16); g2.closePath(); g2.fill();
  if (ready) { g2.fillStyle = '#ff3b2f'; g2.beginPath(); g2.moveTo(0, -34); g2.lineTo(6, -22); g2.lineTo(-6, -22); g2.closePath(); g2.fill(); }
  g2.restore();
}
function cellIcon(x, y, k, col) { // celda de plasma con rayo
  g2.save(); g2.translate(x, y); g2.scale(k, k);
  g2.fillStyle = col; g2.shadowColor = col; g2.shadowBlur = 12; g2.beginPath(); g2.roundRect(-15, -38, 30, 76, 11); g2.fill(); g2.shadowBlur = 0;
  g2.fillStyle = '#062'; g2.fillRect(-15, -30, 30, 5);
  g2.fillStyle = '#fff'; g2.beginPath(); g2.moveTo(5, -22); g2.lineTo(-9, 6); g2.lineTo(-1, 6); g2.lineTo(-5, 26); g2.lineTo(10, -6); g2.lineTo(2, -6); g2.closePath(); g2.fill();
  g2.restore();
}
function ammoPanel(W, now) {
  const x = W - 16, empty = (n, blink) => n <= 0 && Math.floor(now / 250) % 2 ? '#ff3b2f' : n <= 0 ? '#ff8a7a' : '#fff';
  g2.fillStyle = 'rgba(0,10,20,0.5)'; g2.beginPath(); g2.roundRect(W - 268, 12, 252, 262, 14); g2.fill();
  g2.textAlign = 'left'; g2.shadowColor = '#000'; g2.shadowBlur = 4;
  // plasma
  cellIcon(W - 232, 74, 1.05, P.plasma > 0 ? '#3fe6b0' : '#555');
  g2.fillStyle = '#9fe'; g2.font = `11px ${MONO}`; g2.fillText('PLASMA', W - 196, 38);
  g2.fillStyle = empty(P.plasma); g2.font = `bold 42px ${MONO}`; g2.fillText(P.plasma, W - 196, 82);
  g2.fillStyle = '#9fe'; g2.font = `14px ${MONO}`; g2.fillText('/' + MAXA.plasma, W - 196 + 26 * String(P.plasma).length, 82);
  g2.shadowBlur = 0; g2.fillStyle = 'rgba(255,255,255,0.15)'; g2.fillRect(W - 196, 94, 170, 6); g2.fillStyle = '#3fe6b0'; g2.fillRect(W - 196, 94, 170 * P.plasma / MAXA.plasma, 6);
  // misiles
  { const n = MAXA.missiles, sp = Math.min(58, 214 / n), k = Math.min(1.15, sp / 40); for (let i = 0; i < n; i++) missileIcon(W - 246 + sp / 2 + i * sp, 184, k, i < P.missiles); }
  g2.shadowBlur = 4; g2.fillStyle = '#ffd9a0'; g2.font = `11px ${MONO}`; g2.fillText('MISILES', W - 254, 128);
  g2.fillStyle = empty(P.missiles); g2.font = `bold 20px ${MONO}`; g2.fillText(`${P.missiles}/${MAXA.missiles}`, W - 190, 130);
  g2.shadowBlur = 0; g2.fillStyle = 'rgba(255,255,255,0.15)'; g2.fillRect(W - 254, 240, 214, 6);
  g2.fillStyle = P.cdM > 0 ? '#ffb347' : '#5dff8a'; g2.fillRect(W - 254, 240, 214 * (P.cdM > 0 ? 1 - P.cdM / WPN.m.cd : 1), 6);
  g2.fillStyle = '#ffd9a0'; g2.font = `11px ${MONO}`; g2.fillText(P.cdM > 0 ? `RECARGA ${P.cdM.toFixed(1)}s` : 'LISTO', W - 254, 262);
}
// ---------- instrumento de vuelo: horizonte artificial (inclinación respecto al suelo), altura, distancia a mi base y alerta de choque ----------
const _fi = { f: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), beep: 0 };
function flightInstr(W, H, now) {
  if (P.hp <= 0 || S.warp.on || S.foot.on) return;
  let nb = null, na = Infinity; for (const b of bodies) { if (b.k === 'sun') continue; const a = Math.hypot(S.pos[0] - b.pos[0], S.pos[1] - b.pos[1], S.pos[2] - b.pos[2]) - b.R; if (a < na) { na = a; nb = b; } }
  if (!nb || na > 600) return; // solo cerca de un planeta
  const g = Math.max(0, planets.info.on && planets.info.name === nb.n ? planets.info.ground : na), dv = sub(S.pos, nb.pos), dl = len(dv), up = [dv[0] / dl, dv[1] / dl, dv[2] / dl];
  _fi.f.set(0, 0, -1).applyQuaternion(S.q); _fi.r.set(1, 0, 0).applyQuaternion(S.q); _fi.u.set(0, 1, 0).applyQuaternion(S.q);
  const sinP = Math.max(-1, Math.min(1, _fi.f.x * up[0] + _fi.f.y * up[1] + _fi.f.z * up[2])), pitch = Math.asin(sinP), roll = Math.atan2(_fi.r.x * up[0] + _fi.r.y * up[1] + _fi.r.z * up[2], _fi.u.x * up[0] + _fi.u.y * up[1] + _fi.u.z * up[2]);
  const vz = S.ve * sinP, tti = vz < -0.03 && g > 0 && !S.park.on ? g / -vz : Infinity, thr = 1.5; // la alerta de choque (y el anillo rojo) solo a ≤ 1,5 s del impacto bajando deprisa; apuntar al planeta desde lejos no la activa
  const cx = W - 96, cy = H * 0.5 + 30, R = 52;
  g2.save(); g2.textAlign = 'center';
  g2.beginPath(); g2.arc(cx, cy, R, 0, 7); g2.save(); g2.clip(); g2.translate(cx, cy); g2.rotate(-roll); const py = pitch * 180 / Math.PI * 1.3;
  g2.fillStyle = '#2a6aa8'; g2.fillRect(-90, -200 + py, 180, 200); g2.fillStyle = '#7a5530'; g2.fillRect(-90, py, 180, 200); g2.fillStyle = '#ffffffcc'; g2.fillRect(-90, py - 1, 180, 2);
  g2.strokeStyle = '#ffffff99'; g2.lineWidth = 1; g2.font = `9px ${MONO}`; g2.fillStyle = '#ffffffcc'; for (let a = -30; a <= 30; a += 10) { if (!a) continue; const y = py - a * 1.3, w = a % 20 ? 10 : 18; g2.beginPath(); g2.moveTo(-w, y); g2.lineTo(w, y); g2.stroke(); if (!(a % 20)) g2.fillText(Math.abs(a), w + 10, y + 3); }
  g2.restore();
  g2.strokeStyle = tti <= thr && vz < -0.3 ? '#ff3b30' : '#8fd8ff'; g2.lineWidth = 3; g2.beginPath(); g2.arc(cx, cy, R, 0, 7); g2.stroke();
  g2.strokeStyle = '#ffd23f'; g2.lineWidth = 3; g2.beginPath(); g2.moveTo(cx - 30, cy); g2.lineTo(cx - 10, cy); g2.lineTo(cx - 5, cy + 6); g2.moveTo(cx + 30, cy); g2.lineTo(cx + 10, cy); g2.lineTo(cx + 5, cy + 6); g2.moveTo(cx, cy - 3); g2.lineTo(cx, cy + 1); g2.stroke(); // avión fijo
  const deg = Math.round(pitch * 180 / Math.PI), mine = typeof BASE !== 'undefined' ? BASE.mine() : null, bd = mine ? len(sub(BASE.worldOf(mine), S.pos)) : null;
  g2.font = `bold 12px ${MONO}`; g2.fillStyle = '#e6f6ff'; g2.strokeStyle = '#000'; g2.lineWidth = 3;
  const lines = [[`ALTURA ${g < 1 ? Math.round(g * 1000) + ' m' : fD(g)}`, '#e6f6ff'], [`INCLINACIÓN ${deg > 0 ? '+' : ''}${deg}°`, deg < -8 ? '#ffb347' : '#e6f6ff']];
  if (bd !== null) lines.push([`BASE ${fD(bd)}`, '#5dff8a']); if (tti < 60) lines.push([`IMPACTO ${tti.toFixed(1)} s`, tti <= thr ? '#ff5a4a' : '#ffd23f']);
  lines.forEach(([t, c], i) => { g2.fillStyle = c; g2.strokeText(t, cx, cy + R + 18 + i * 15); g2.fillText(t, cx, cy + R + 18 + i * 15); });
  g2.restore();
  if (tti <= thr && vz < -0.3) crashAlert(W, H, now, tti); // aterrizajes suaves (< 430 km/h de caída) no disparan la alerta
}
function crashAlert(W, H, now, tti) { // triángulo de peligro parpadeante en el centro de la pantalla; parpadea y pita más rápido cuanto menos falta
  const fast = tti < 3, ph = now / (fast ? 90 : 170), a = 0.5 + 0.5 * Math.sin(ph), x = W / 2, y = H * 0.3, s = 62 * (1 + 0.06 * Math.sin(ph));
  g2.save(); g2.textAlign = 'center'; g2.lineJoin = 'round';
  const k = (now % 900) / 900; g2.strokeStyle = `rgba(255,60,40,${0.5 * (1 - k)})`; g2.lineWidth = 5; g2.beginPath(); g2.arc(x, y + 8, s * (1 + k * 1.1), 0, 7); g2.stroke(); // onda que se expande
  g2.globalAlpha = 0.45 + 0.55 * a; g2.shadowColor = '#ff2a1a'; g2.shadowBlur = 28 + 22 * a;
  g2.beginPath(); g2.moveTo(x, y - s); g2.lineTo(x + s * 0.95, y + s * 0.72); g2.lineTo(x - s * 0.95, y + s * 0.72); g2.closePath();
  const gr = g2.createLinearGradient(0, y - s, 0, y + s * 0.72); gr.addColorStop(0, '#ff5a3c'); gr.addColorStop(1, '#a4100a'); g2.fillStyle = gr; g2.fill(); g2.lineWidth = 9; g2.strokeStyle = '#fff3c4'; g2.stroke(); g2.shadowBlur = 0;
  g2.lineWidth = 8; g2.lineCap = 'round'; g2.strokeStyle = '#fff'; g2.beginPath(); g2.moveTo(x, y - s * 0.42); g2.lineTo(x, y + s * 0.22); g2.stroke(); g2.beginPath(); g2.arc(x, y + s * 0.47, 1, 0, 7); g2.stroke(); // signo de exclamación
  g2.globalAlpha = 1; g2.font = 'bold 26px ui-monospace,Consolas,monospace'; g2.lineWidth = 5; g2.strokeStyle = '#000'; g2.fillStyle = a > 0.5 ? '#fff' : '#ff6a5a';
  g2.strokeText('¡VAS A ESTRELLARTE!', x, y + s + 40); g2.fillText('¡VAS A ESTRELLARTE!', x, y + s + 40);
  g2.font = 'bold 18px ui-monospace,Consolas,monospace'; g2.fillStyle = '#ffd23f'; const t2 = `SUBE · impacto en ${tti.toFixed(1)} s`; g2.strokeText(t2, x, y + s + 66); g2.fillText(t2, x, y + s + 66);
  g2.restore();
  if (now - _fi.beep > 120 + 60 * tti) { _fi.beep = now; beep(); }
}
// ---------- aviso de ataque: torretas enemigas, naves enemigas o daño a tu base (viñeta roja, banner, flecha hacia el origen y notificación) ----------
const ATK = { t: 0, kind: '', name: '', pos: null, nt: {}, beep: 0 };
function attackAlert(kind, name, pos) { // kind: 't' torretas enemigas · 'p' nave enemiga · 'b' daño a mi base
  const now = performance.now(); ATK.t = now; ATK.kind = kind; ATK.name = name || ''; ATK.pos = pos ? [...pos] : ATK.pos;
}
const ownerName = o => o >= 3000 && typeof NEU !== 'undefined' ? NEU.name(o) : (remotes.get(o) || {}).name || (typeof BOT !== 'undefined' && BOT.name(o)) || 'Un piloto'; // autor de un disparo: piloto, bot (2000+) o nave neutral (3000+)
const ownerPos = o => o >= 3000 && typeof NEU !== 'undefined' ? NEU.pos(o) : (remotes.get(o) || {}).pos || (typeof BOT !== 'undefined' ? BOT.pos(o) : null);
function attackHud(W, H, now, cm) {
  const dt = now - ATK.t; if (dt > 2600) return; const k = 1 - dt / 2600, pulse = 0.5 + 0.5 * Math.sin(now / 110);
  const gr = g2.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.85); gr.addColorStop(0, 'rgba(255,0,0,0)'); gr.addColorStop(1, `rgba(255,20,10,${(0.25 + 0.3 * pulse) * k})`); g2.fillStyle = gr; g2.fillRect(0, 0, W, H); // viñeta roja pulsante
  g2.save(); g2.textAlign = 'center'; g2.globalAlpha = Math.min(1, k * 2.2); g2.font = 'bold 22px ui-monospace,Consolas,monospace'; g2.lineWidth = 5; g2.strokeStyle = '#000'; g2.fillStyle = pulse > 0.4 ? '#ff5a4a' : '#fff';
  const tx = ATK.kind === 't' ? `⚠ TORRETAS DE ${ATK.name.toUpperCase()} TE ESTÁN DISPARANDO ⚠` : ATK.kind === 'p' ? `⚠ ${ATK.name.toUpperCase()} TE ESTÁ ATACANDO ⚠` : '⚠ TU BASE ESTÁ BAJO ATAQUE ⚠'; g2.strokeText(tx, W / 2, 132); g2.fillText(tx, W / 2, 132);
  if (ATK.pos) { // flecha en el borde hacia donde está el atacante
    const v = view(ATK.pos); cm.set(v.x, v.y, v.z).applyMatrix4(camera.matrixWorldInverse); let dx = cm.x, dy = -cm.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; const R = Math.min(W, H) * 0.38, a = Math.atan2(dy, dx);
    g2.translate(W / 2 + dx * R, H / 2 + dy * R); g2.rotate(a); g2.fillStyle = `rgba(255,50,30,${0.6 + 0.4 * pulse})`; g2.strokeStyle = '#fff'; g2.lineWidth = 3; g2.beginPath(); g2.moveTo(22, 0); g2.lineTo(-14, -16); g2.lineTo(-6, 0); g2.lineTo(-14, 16); g2.closePath(); g2.fill(); g2.stroke();
  }
  g2.restore(); if (now - ATK.beep > 450) { ATK.beep = now; tone('sawtooth', 520, 380, 0.12, 0.05); }
}
function gauge(H) { // medidor curvo: arco azul = escudo (exterior), arco verde = casco (interior)
  const j = P.flash > 0 ? 10 * P.flash : 0, cx = 110 + (Math.random() - 0.5) * j, cy = H - 16 - hud.offsetHeight - 72 + (Math.random() - 0.5) * j, a0 = 0.75 * Math.PI, sw = 1.5 * Math.PI; // el medidor curvo queda justo encima del panel (sin tocarlo)
  { const tvb = document.getElementById('tv'); if (tvb) tvb.style.bottom = (hud.offsetHeight + 16 + 158) + 'px'; } // la vista previa del objetivo sube con él
  const hullCol = P.hp > 0.25 * P.hpMax ? '#5dff8a' : '#ff4b3b';
  const arc = (r, f, col) => {
    g2.lineCap = 'round'; g2.lineWidth = 13; g2.strokeStyle = 'rgba(255,255,255,0.13)'; g2.beginPath(); g2.arc(cx, cy, r, a0, a0 + sw); g2.stroke();
    if (f > 0.005) { g2.strokeStyle = col; g2.shadowColor = col; g2.shadowBlur = 10; g2.beginPath(); g2.arc(cx, cy, r, a0, a0 + sw * Math.min(1, f)); g2.stroke(); g2.shadowBlur = 0; }
  };
  arc(74, P.sh / P.shMax, '#4db8ff'); arc(57, P.hp / P.hpMax, hullCol);
  g2.lineCap = 'butt'; g2.textAlign = 'center'; g2.font = `bold 15px ${MONO}`;
  g2.fillStyle = '#4db8ff'; g2.fillText(`ESC ${Math.round(Math.max(0, P.sh))}`, cx, cy - 2); g2.fillStyle = hullCol; g2.fillText(`CASCO ${Math.round(Math.max(0, P.hp))}`, cx, cy + 18);
}
function hurt(dmg, dir, now) { // el escudo absorbe primero; lo que sobra va al casco
  const over = dmg - P.sh, had = P.sh > 0; P.sh = Math.max(0, P.sh - dmg); if (over > 0) P.hp -= over;
  P.shT = now; P.lastCombat = now; P.flash = 1; P.shake = dmg > 20 ? 1 : 0.5; if (had) P.sf = 1; impact(dir, dmg > 20); sfx(over > 0 ? 'hit' : 'shield');
  if (P.hp <= 0) { P.deaths = (P.deaths || 0) + 1; P.deadUntil = now + 10000; S.v = 0; boom(S.pos, 60); } // muertes: se ven en la tabla de Tab
}
function impact(dir, big) { // fogonazo y chispas sobre mi nave, del lado de donde vino el proyectil
  for (let i = 0; i < (big ? 6 : 3); i++)
    puff(S.pos.map((c, j) => c - dir[j] * 0.02 + (Math.random() - 0.5) * 0.03), big ? 0.03 : 0.012, i ? 0xffd070 : 0xffffff, 0.5 + Math.random() * 0.4, 0.004);
}
function speedMeter(H, now) { // velocidad como una batería: barras que crecen (. : |) y se encienden según cobras impulso; debajo, la del impulso del motor dentro de la atmósfera
  const v = S.ve, warp = S.warp.on, low = S.atm || S.low, showB = (S.entry && !S.park.on) || S.boost > 0.02, hh = showB ? 100 : 66;
  hud.style.paddingTop = (hh + 12) + 'px'; const x0 = hud.offsetLeft + 10, y0 = H - 16 - hud.offsetHeight + 8, ref = low ? LOWCAP : P.vmax, f = warp ? 1 : Math.min(1, Math.sqrt(Math.max(0, v) / ref));
  g2.save(); g2.textAlign = 'left';
  g2.font = `10px ${MONO}`; g2.fillStyle = '#7fb6d4'; g2.fillText('VELOCIDAD', x0, y0 + 10); g2.fillStyle = '#5dff8a'; g2.textAlign = 'right'; g2.fillText(warp ? 'VELOCIDAD LUZ' : low ? 'COMBUSTIÓN' : 'CRUCERO', x0 + 246, y0 + 10); if (!warp && v < S.v - 0.001 && !S.park.on) { g2.fillStyle = '#ffb347'; g2.fillText('AUTOFRENADO', x0 + 246, y0 + 22); } g2.textAlign = 'left';
  g2.font = `bold 20px ${MONO}`; g2.fillStyle = '#fff'; g2.fillText(warp ? fV(S.warp.v) : low ? Math.round(v * 3600).toLocaleString('es') : fV(v).split(' ')[0], x0, y0 + 36); g2.font = `11px ${MONO}`; g2.fillStyle = '#9fd4ee'; g2.fillText(warp ? '' : low ? 'km/h' : fV(v).split(' ').slice(1).join(' '), x0, y0 + 50);
  const bars = (bx, by, n, w, gap, h0, h1, lit, hue0, hue1) => { for (let i = 0; i < n; i++) { const hgt = h0 + (h1 - h0) * i / (n - 1), on = i < lit, hue = hue0 + (hue1 - hue0) * i / (n - 1); g2.fillStyle = on ? `hsl(${hue},90%,55%)` : 'rgba(255,255,255,0.12)'; if (on) { g2.shadowColor = `hsl(${hue},90%,55%)`; g2.shadowBlur = 8; } g2.beginPath(); g2.roundRect(bx + i * (w + gap), by - hgt, w, hgt, 2); g2.fill(); g2.shadowBlur = 0; } };
  const pulse = warp ? 0.75 + 0.25 * Math.sin(now / 80) : 1; bars(x0 + 100, y0 + 54, 16, 8, 3, 5, 38, Math.ceil(f * 16 * pulse - 0.001) * (v > 0.002 || warp ? 1 : 0), 120, 0);
  if (showB) { g2.font = `10px ${MONO}`; g2.fillStyle = '#ffd27a'; g2.fillText('IMPULSO MOTOR', x0, y0 + 76); g2.fillStyle = S.boost > 0.02 ? '#fff' : '#7fb6d4'; g2.textAlign = 'right'; g2.fillText(S.boost > 0.02 ? Math.round(S.boost * 100) + ' %' : 'SHIFT', x0 + 246, y0 + 76); g2.textAlign = 'left'; bars(x0 + 100, y0 + 94, 16, 8, 3, 4, 16, Math.ceil(S.boost * 16 - 0.001), 50, 15); }
  g2.restore();
}
const resText = l => l.map(it => `${it.type} ×${it.n}`).join(' · ');
function asteroidMarks(W, H, now) { // recursos de los asteroides cercanos (iconos) y ficha del apuntado: tipos, cantidades y vida
  if (P.hp <= 0) return; const list = [];
  for (const o of fields.active) { const aimed = aimT && aimT.ob === o; if (!aimed && o.z == null) continue; const d = Math.hypot(o.pos[0] - S.pos[0], o.pos[1] - S.pos[1], o.pos[2] - S.pos[2]); if ((d < (o.m < fields.rockCount ? 6000 : 800) && astLeft(o).length) || aimed) list.push([d, o, aimed]); } // solo los que aún tienen recursos (o el apuntado)
  list.sort((a, b) => a[0] - b[0]);
  for (const [d, o, aimed] of list.slice(0, 8)) {
    const r = astInfo(o), v = view(o.pos); tv.set(v.x, v.y, v.z).project(camera); if (tv.z >= 1 || Math.abs(tv.x) > 1 || Math.abs(tv.y) > 1) continue;
    const x = (tv.x * 0.5 + 0.5) * W, y = (-tv.y * 0.5 + 0.5) * H - 26, st = AST.get(o.id), left = astLeft(o), hp = Math.max(0, r.hp - (st ? st.dmg : 0)), sz = aimed ? 24 : 18, w = left.length * (sz + 4) + 8;
    g2.save(); g2.globalAlpha = aimed ? 1 : 0.8; g2.fillStyle = 'rgba(0,10,20,0.75)'; g2.strokeStyle = left[0] ? RES[left[0].type] : '#667788'; g2.lineWidth = 2; g2.beginPath(); g2.roundRect(x - w / 2, y - sz / 2 - 4, w, sz + 8, 10); g2.fill(); g2.stroke();
    left.forEach((it, i) => { const im = icoImg(it.type); if (im && im.complete && im.naturalWidth) g2.drawImage(im, x - w / 2 + 6 + i * (sz + 4), y - sz / 2, sz, sz); });
    if (aimed) { g2.textAlign = 'center'; g2.font = `bold 12px ${MONO}`; g2.fillStyle = '#fff'; g2.strokeStyle = '#000'; g2.lineWidth = 3; const nm = o.m < fields.rockCount ? 'Asteroide ' + ROCKN[o.m] : 'Basura espacial', tx = `${nm} · ${resText(left) || (r.list.length ? 'zona agotada' : 'sin recursos')}`; g2.strokeText(tx, x, y - 24); g2.fillText(tx, x, y - 24); g2.fillStyle = 'rgba(255,255,255,0.18)'; g2.fillRect(x - 40, y + 22, 80, 6); g2.fillStyle = hp / r.hp > 0.35 ? '#5dff8a' : '#ff8a4c'; g2.fillRect(x - 40, y + 22, 80 * hp / r.hp, 6); g2.font = `10px ${MONO}`; g2.fillStyle = '#bfe8ff'; g2.fillText(`VIDA ${Math.round(hp)} / ${r.hp} · ${fD(d)}`, x, y + 40); }
    g2.restore();
  }
}
const wreckInfo = i => LOOTED.has(i) ? [] : wreckLoot(i); // recursos de un casco a la deriva (sysgen.wreckLoot, igual que en el servidor); ya saqueado en la sala: nada
function scanMarks(W, H, now) { // V: recursos al alcance (máx. 8): encima del propio objeto si se ve en pantalla; si está fuera o detrás, en un círculo con una flecha hacia él
  if (!S.scanT || P.hp <= 0) return; if (now - S.scanT > 30000) { S.scanT = 0; return; }
  const items = [];
  for (const o of fields.active) { if (o.z == null) continue; const d = Math.hypot(o.pos[0] - S.pos[0], o.pos[1] - S.pos[1], o.pos[2] - S.pos[2]); if (d < RANGE) { const list = astLeft(o); if (list.length) items.push({ pos: o.pos, d, list }); } } // solo lo que está al alcance de la nave y aún tiene recursos (zonas no agotadas)
  for (const w of wrecks) if (!dead.has(w.i) && !LOOTED.has(w.i)) { const d = Math.hypot(w.pos[0] - S.pos[0], w.pos[1] - S.pos[1], w.pos[2] - S.pos[2]); if (d < RANGE) items.push({ pos: w.pos, d, list: wreckInfo(w.i), wreck: true }); }
  items.sort((a, b) => a.d - b.d); const show = items.slice(0, 8), off = [], cm = new THREE.Vector3();
  tv.set(0, 0, 0).project(camera); const cx = (tv.x * 0.5 + 0.5) * W, cy = (-tv.y * 0.5 + 0.5) * H, R = Math.min(W, H) * 0.27;
  const capsule = (px, py, it) => { // cápsula con icono + cantidad de cada recurso y la distancia debajo
    const sz = 16, col = RES[it.list[0] ? it.list[0].type : 'piedra'], w = it.list.reduce((s, r) => s + sz + 6 + 7 * String(r.n).length, 0) + 8; let x = px - w / 2 + 5;
    g2.fillStyle = 'rgba(0,10,20,0.78)'; g2.strokeStyle = col; g2.lineWidth = 2; g2.beginPath(); g2.roundRect(px - w / 2, py - 13, w, 26, 9); g2.fill(); g2.stroke();
    g2.textAlign = 'left'; g2.font = `bold 11px ${MONO}`; for (const r of it.list) { const im = icoImg(r.type); if (im && im.complete && im.naturalWidth) g2.drawImage(im, x, py - sz / 2, sz, sz); g2.fillStyle = '#fff'; g2.fillText(String(r.n), x + sz + 2, py + 4); x += sz + 6 + 7 * String(r.n).length; }
    g2.textAlign = 'center'; g2.font = `10px ${MONO}`; g2.fillStyle = '#dff4ff'; g2.strokeStyle = '#000'; g2.lineWidth = 3; const tx = it.d < 1e4 ? Math.round(it.d).toLocaleString('es') + ' km' : (it.d / 1000).toFixed(0) + ' mil km'; g2.strokeText(tx, px, py + 26); g2.fillText(tx, px, py + 26);
    return w;
  };
  g2.save(); g2.textAlign = 'center';
  for (const it of show) { // delante y en pantalla: encima del propio objeto (misma proyección que asteroidMarks); si no, al círculo con flecha
    const v = view(it.pos); tv.set(v.x, v.y, v.z).project(camera);
    if (tv.z < 1 && Math.abs(tv.x) < 0.95 && Math.abs(tv.y) < 0.95) { capsule((tv.x * 0.5 + 0.5) * W, (-tv.y * 0.5 + 0.5) * H - 46, it); continue; }
    cm.set(v.x, v.y, v.z).applyMatrix4(camera.matrixWorldInverse); let dx = cm.x, dy = -cm.y; const l = Math.hypot(dx, dy); if (l < 1e-9) { dx = 0; dy = 1; } else { dx /= l; dy /= l; } it.a = Math.atan2(dy, dx); off.push(it); // dirección en el espacio de la cámara (como el aviso de ataque)
  }
  off.sort((a, b) => a.a - b.a); for (let k = 0; k < 6; k++) for (let i = 0; i < off.length; i++) { const j = (i + 1) % off.length; let gap = off[j].a - off[i].a; if (j === 0) gap += Math.PI * 2; const need = 0.16; if (off.length > 1 && gap < need) { const push = (need - gap) / 2; off[i].a -= push; off[j].a += push; } } // separa los marcadores que se solapan
  if (off.length) { g2.strokeStyle = 'rgba(93,255,138,0.25)'; g2.lineWidth = 1.5; g2.setLineDash([4, 8]); g2.beginPath(); g2.arc(cx, cy, R, 0, 7); g2.stroke(); g2.setLineDash([]); }
  g2.font = `bold 11px ${MONO}`; g2.fillStyle = '#5dff8a'; g2.fillText(`ESCÁNER · ${items.length} con recursos · V: apagar`, cx, cy - R - 40);
  for (const it of off) {
    const ux = Math.cos(it.a), uy = Math.sin(it.a), px = cx + ux * R, py = cy + uy * R, w = capsule(px, py, it), col = RES[it.list[0] ? it.list[0].type : 'piedra'];
    g2.save(); g2.translate(px + ux * (w / 2 + 6), py + uy * 12); g2.rotate(Math.atan2(uy, ux)); g2.fillStyle = col; g2.beginPath(); g2.moveTo(12, 0); g2.lineTo(-4, -8); g2.lineTo(-4, 8); g2.closePath(); g2.fill(); g2.restore(); // flecha hacia el recurso
  }
  g2.restore();
}
function zoneMarks(W, H, now) { // zonas de recursos en el HUD: rombo con nombre, distancia al borde e iconos de lo que queda; la seleccionada (N / mapa) en amarillo y con flecha si está fuera de la vista
  if (P.hp <= 0) return; const sel = S.tgt - bodies.length, cm = new THREE.Vector3(); g2.save(); g2.lineWidth = 2;
  const chips = (x, y, res, sz) => { // icono + cantidad restante de cada recurso dominante (atenuado si ya no queda)
    let cx = x; const a0 = g2.globalAlpha; g2.textAlign = 'left'; g2.font = `bold 11px ${MONO}`; g2.strokeStyle = '#000'; g2.lineWidth = 3;
    for (const it of res) { const im = icoImg(it.type); g2.globalAlpha = a0 * (it.n ? 1 : 0.35); if (im && im.complete && im.naturalWidth) g2.drawImage(im, cx, y - sz / 2, sz, sz); g2.fillStyle = it.n ? '#fff' : '#889'; g2.strokeText(String(it.n), cx + sz + 2, y + 4); g2.fillText(String(it.n), cx + sz + 2, y + 4); cx += sz + 8 + 7 * String(it.n).length; }
    g2.globalAlpha = a0;
  };
  for (const t of ZT) {
    const v = view(t.pos), d = v.d, res = zoneRes(t.zi), isSel = t.zi === sel, empty = res.every(it => !it.n), col = isSel ? '#ffd23f' : empty ? '#8899aa' : RES[res[0].type];
    g2.strokeStyle = '#000';
    if (d < t.R) { g2.textAlign = 'center'; g2.font = `bold 13px ${MONO}`; g2.fillStyle = col; const tx = `ZONA ${t.n.toUpperCase()}${empty ? ' · AGOTADA' : ''}`; g2.lineWidth = 3; g2.strokeText(tx, W / 2, 160); g2.fillText(tx, W / 2, 160); chips(W / 2 - 60, 180, res, 16); continue; } // dentro de la zona: cartel arriba
    tv.set(v.x, v.y, v.z).project(camera); const on = tv.z < 1 && Math.abs(tv.x) < 0.95 && Math.abs(tv.y) < 0.95;
    if (!on) { if (!isSel) continue; cm.set(v.x, v.y, v.z).applyMatrix4(camera.matrixWorldInverse); let dx = cm.x, dy = -cm.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; const R = Math.min(W, H) * 0.42; g2.save(); g2.translate(W / 2 + dx * R, H / 2 + dy * R); g2.rotate(Math.atan2(dy, dx)); g2.fillStyle = col; g2.beginPath(); g2.moveTo(14, 0); g2.lineTo(-8, -9); g2.lineTo(-8, 9); g2.closePath(); g2.fill(); g2.restore(); g2.textAlign = 'center'; g2.font = `bold 11px ${MONO}`; g2.fillStyle = col; g2.lineWidth = 3; g2.strokeText(t.n, W / 2 + dx * (R - 26), H / 2 + dy * (R - 26)); g2.fillText(t.n, W / 2 + dx * (R - 26), H / 2 + dy * (R - 26)); continue; }
    if (losBlocked({ dir: [v.rel[0] / d, v.rel[1] / d, v.rel[2] / d], dist: d, kind: 'z' })) continue; // tapada por un planeta
    const x = (tv.x * 0.5 + 0.5) * W, y = (-tv.y * 0.5 + 0.5) * H, s = isSel ? 11 + Math.sin(now / 200) : 8;
    g2.globalAlpha = isSel ? 1 : 0.78; g2.strokeStyle = col; g2.beginPath(); g2.moveTo(x, y - s); g2.lineTo(x + s, y); g2.lineTo(x, y + s); g2.lineTo(x - s, y); g2.closePath(); g2.stroke();
    g2.textAlign = 'left'; g2.font = `${isSel ? 'bold ' : ''}11px ${MONO}`; g2.fillStyle = col; g2.strokeStyle = '#000'; g2.lineWidth = 3; const tx = `${t.n} · ${fD(Math.max(0, d - t.R))}${empty ? ' · agotada' : ''}`; g2.strokeText(tx, x + s + 6, y - 2); g2.fillText(tx, x + s + 6, y - 2);
    chips(x + s + 6, y + 13, res, 14); g2.globalAlpha = 1;
  }
  g2.restore();
}
function warpBar(W, H) { // barra del motor de velocidad luz: aparece al entrar en velocidad luz y mientras se recarga
  const w = S.warp, f = w.bar / P.warpMax; if (!w.on && f > 0.999) return;
  const x = W / 2 - 170, y = H - 46, col = w.on ? (f > 0.25 ? '#8fd8ff' : '#ffb347') : w.lock ? '#ff4b3b' : '#5dff8a';
  g2.fillStyle = 'rgba(0,10,20,0.55)'; g2.beginPath(); g2.roundRect(x - 10, y - 26, 360, 50, 10); g2.fill();
  g2.textAlign = 'left'; g2.font = `11px ${MONO}`; g2.fillStyle = col;
  g2.fillText(w.on ? `VELOCIDAD LUZ ${(w.v / C).toFixed(1)} c · quedan ${Math.ceil(w.bar)} s` : w.lock ? `MOTOR LUZ AGOTADO — recargando ${Math.round(f * 100)}%` : `MOTOR LUZ recargando ${Math.round(f * 100)}%`, x, y - 8);
  g2.strokeStyle = col; g2.lineWidth = 1; g2.strokeRect(x + 0.5, y + 0.5, 340, 12); g2.fillRect(x + 2, y + 2, 337 * f, 9); g2.lineWidth = 2; g2.textAlign = 'center';
}
function keycap(x, y, key, label) { // dibujo de una tecla sobre la nave con su acción
  const s = 34; g2.save(); g2.shadowColor = 'rgba(120,220,255,0.6)'; g2.shadowBlur = 14;
  g2.fillStyle = '#0a2233'; g2.beginPath(); g2.roundRect(x - s / 2, y - s / 2 + 4, s, s, 7); g2.fill(); // base: da relieve a la tecla
  const gr = g2.createLinearGradient(0, y - s / 2, 0, y + s / 2); gr.addColorStop(0, '#e8f6ff'); gr.addColorStop(1, '#a9cde2');
  g2.shadowBlur = 0; g2.fillStyle = gr; g2.beginPath(); g2.roundRect(x - s / 2, y - s / 2, s, s, 7); g2.fill(); g2.strokeStyle = '#5db8e8'; g2.lineWidth = 2; g2.stroke();
  g2.fillStyle = '#0d2a3c'; g2.font = `bold 20px ${MONO}`; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(key, x, y + 1);
  g2.textBaseline = 'alphabetic'; g2.font = `12px ${MONO}`; g2.fillStyle = '#e6f6ff'; g2.fillText(label, x, y + s / 2 + 22); g2.restore();
}
function countdownHud(W, H, now) { // cuenta atrás del salto: luces de salida tipo carreras, franjas de alerta animadas y número grande
  const w = S.warp, go = w.cd <= 0, n = Math.ceil(w.cd), frac = go ? 1 : w.cd - Math.floor(w.cd);
  g2.save(); const a = go ? 0.22 : 0.1 + 0.1 * Math.sin(now / 90); g2.fillStyle = go ? `rgba(60,255,120,${a})` : `rgba(255,40,40,${a})`; g2.fillRect(0, 0, W, H);
  const sh = (now / 25) % 40; // franjas amarillas y negras que corren por arriba y abajo
  for (const y0 of [0, H - 22]) {
    g2.save(); g2.beginPath(); g2.rect(0, y0, W, 22); g2.clip(); g2.fillStyle = 'rgba(0,0,0,0.65)'; g2.fillRect(0, y0, W, 22); g2.fillStyle = go ? '#3cff78' : '#ffd23f';
    for (let x = -40 + sh; x < W + 40; x += 40) { g2.beginPath(); g2.moveTo(x, y0 + 22); g2.lineTo(x + 20, y0 + 22); g2.lineTo(x + 42, y0); g2.lineTo(x + 22, y0); g2.closePath(); g2.fill(); }
    g2.restore();
  }
  const lit = go ? 5 : 6 - n; // 5 luces que se encienden una a una; al llegar a 0 todas verdes
  for (let i = 0; i < 5; i++) {
    const x = W / 2 + (i - 2) * 54, y = H * 0.2; g2.fillStyle = '#111'; g2.beginPath(); g2.arc(x, y, 22, 0, 7); g2.fill();
    g2.fillStyle = go ? '#3cff78' : i < lit ? '#ff2a2a' : '#3a0a0a'; g2.shadowColor = g2.fillStyle; g2.shadowBlur = go || i < lit ? 24 : 0; g2.beginPath(); g2.arc(x, y, 18, 0, 7); g2.fill(); g2.shadowBlur = 0;
  }
  g2.translate(W / 2, H * 0.42); const sc = go ? 1 : 1 + 0.45 * Math.pow(1 - frac, 2); g2.scale(sc, sc); g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.font = `bold 150px ${MONO}`;
  g2.fillStyle = go ? '#3cff78' : n <= 2 ? '#ff4b3b' : '#ffd23f'; g2.shadowColor = g2.fillStyle; g2.shadowBlur = 30; g2.fillText(go ? 'GO' : String(n), 0, 0); g2.restore();
  g2.save(); g2.textAlign = 'center'; g2.font = `bold 16px ${MONO}`; g2.fillStyle = '#fff'; g2.fillText(go ? 'SALTO A VELOCIDAD LUZ' : `PREPARANDO SALTO A ${(warpTarget() || { n: '?' }).n.toUpperCase()} · Shift para cancelar`, W / 2, H * 0.62); g2.restore();
}
function drawHud(fwd, now, targets) {
  const W = hc.width = innerWidth, H = hc.height = innerHeight, lowAmmo = P.plasma < 40 || P.missiles === 0;
  g2.lineWidth = 2; g2.font = '12px ui-monospace,Consolas,monospace'; g2.textAlign = 'center';
  if (P.flash > 0) { // la pantalla parpadea en rojo al recibir daño
    const al = P.flash * (Math.sin(now / 45) > 0 ? 0.85 : 0.4), gr = g2.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.8);
    gr.addColorStop(0, `rgba(255,0,0,${al * 0.3})`); gr.addColorStop(1, `rgba(255,0,0,${al})`); g2.fillStyle = gr; g2.fillRect(0, 0, W, H);
  }
  if (S.warp.cd > 0 || now - S.warp.goT < 700) countdownHud(W, H, now);
  const wf = S.warp.fx;
  if (wf > 0.02) { // estelas de estrellas
    g2.strokeStyle = `rgba(170,215,255,${0.25 + 0.35 * wf})`; g2.lineWidth = 1.5;
    for (let i = 0; i < 110; i++) { const a = Math.random() * 6.283, r0 = (0.12 + Math.random() * 0.5) * H * (1 - 0.3 * wf), l = (0.05 + Math.random() * 0.35) * H * wf; g2.beginPath(); g2.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); g2.lineTo(W / 2 + Math.cos(a) * (r0 + l), H / 2 + Math.sin(a) * (r0 + l)); g2.stroke(); }
    g2.lineWidth = 2;
  }
  if (P.heat > 8) { // fricción atmosférica: resplandor naranja en los bordes y barra de temperatura
    const hf = P.heat / 100, gr = g2.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    gr.addColorStop(0, 'rgba(255,120,20,0)'); gr.addColorStop(1, `rgba(255,${Math.round(130 - 80 * hf)},20,${0.12 + 0.5 * hf})`); g2.fillStyle = gr; g2.fillRect(0, 0, W, H);
    const bx = W / 2 - 110, by = H - 100; g2.textAlign = 'left'; g2.font = `11px ${MONO}`; g2.fillStyle = hf > 0.6 ? '#ff4b3b' : '#ffb347'; g2.fillText(`${P.heatStar ? 'RADIACIÓN ESTELAR' : 'FRICCIÓN ATMOSFÉRICA'} ${Math.round(P.heat)}%`, bx, by - 6);
    g2.strokeStyle = g2.fillStyle; g2.lineWidth = 1; g2.strokeRect(bx + 0.5, by + 0.5, 220, 9); g2.fillRect(bx + 2, by + 2, 217 * hf, 6); g2.lineWidth = 2; g2.textAlign = 'center';
  }
  if (S.foot.on) return; // a pie: sin medidor de la nave, munición ni velocidad (FOOT.hud dibuja la interfaz del astronauta)
  attackHud(W, H, now, new THREE.Vector3()); gauge(H); flightInstr(W, H, now); ammoPanel(W, now); warpBar(W, H); speedMeter(H, now); asteroidMarks(W, H, now); scanMarks(W, H, now); zoneMarks(W, H, now);
  if (!S.warp.on && S.warp.cd <= 0 && P.hp > 0) { // rumbo del salto: G sobre la mira cuando apuntas a un planeta; marcador fijo cuando ya está fijado
    const cy = H / 2 - 84;
    if (S.lockB != null) {
      const lb = lockObj(), lv = view(lb.pos); g2.save(); g2.textAlign = 'center'; g2.font = `bold 13px ${MONO}`; g2.fillStyle = '#ffd23f';
      tv.set(lv.x, lv.y, lv.z).project(camera); if (tv.z < 1) { const x = (tv.x * 0.5 + 0.5) * W, y = (-tv.y * 0.5 + 0.5) * H; g2.strokeStyle = '#ffd23f'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(x, y - 20); g2.lineTo(x + 20, y); g2.lineTo(x, y + 20); g2.lineTo(x - 20, y); g2.closePath(); g2.stroke(); g2.fillText(lb.n, x, y - 28); }
      g2.restore(); g2.globalAlpha = 0.6 + 0.4 * Math.sin(now / 200); keycap(W / 2, cy, 'G', 'Al pulsar la tecla dejará de seguir'); g2.globalAlpha = 1;
    } else if (aimT && (aimT.type === 'b' || aimT.type === 'z')) { g2.globalAlpha = 0.6 + 0.4 * Math.sin(now / 200); keycap(W / 2, cy, 'G', `Vuelo directo hacia ${aimT.type === 'b' ? aimT.b.n : aimT.z.n}${aimT.type === 'z' ? ' · Shift: salto luz' : ''}`); g2.globalAlpha = 1; }
  }
  if ((S.canPark || S.park.on) && P.hp > 0 && !S.foot.on) {
    tv.set(0, 0, 0).project(camera); const kx = (tv.x * 0.5 + 0.5) * W, ky = (-tv.y * 0.5 + 0.5) * H - 70 + Math.sin(now / 300) * 3;
    if (S.park.on) { g2.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(now / 260)); if (S.park.water) keycap(kx, ky, 'W', 'Despegar (acelerar)'); else { keycap(kx, ky, 'T', 'Despegar'); } g2.globalAlpha = 1; } // teclas parpadeantes
    else keycap(kx, ky, 'T', 'Desplegar ruedas y estacionar');
  }
  g2.lineWidth = 2; g2.textAlign = 'center'; g2.font = `12px ${MONO}`;
  const nearest = Math.min(Infinity, ...targets.filter(t => t.kind === 'p').map(t => t.dist)); // enemigo más cercano (solo naves de jugadores)
  for (const t of targets) {
    if ((t.kind === 'w' && t.dist > 300000) || losBlocked(t)) continue; // sin línea de visión (planeta de por medio) no se dibuja
    const lock = t === lockT, sel = t === S.tsel, col = sel ? '#ffd23f' : t.kind === 'n' ? (t.hostile ? (lock ? '#ff2a2a' : '#ff5a4a') : (lock ? '#ffee55' : '#c8ff5d')) : t.kind === 'p' || t.kind === 'h' ? (lock ? '#ff2a2a' : '#ff8a4c') : (lock ? '#ffee55' : '#5dff8a'); // neutrales: verde amarillento (rojo si están hostiles); elegida con B: amarillo
    tv.copy(t.grp.position).project(camera);
    let x = (tv.x * 0.5 + 0.5) * W, y = (-tv.y * 0.5 + 0.5) * H; const behind = tv.z > 1;
    if (behind) { x = W - x; y = H - y; }
    g2.strokeStyle = g2.fillStyle = col;
    if (behind || x < 40 || x > W - 40 || y < 40 || y > H - 40) {
      if ((t.kind === 'w' && !lowAmmo) || (t.kind === 'n' && !sel && !t.hostile && t.dist > SEL_R)) continue; // neutrales lejanas y tranquilas: sin flecha en el borde
      const dx = x - W / 2, dy = y - H / 2, k = Math.min((W / 2 - 40) / (Math.abs(dx) || 1e-6), (H / 2 - 40) / (Math.abs(dy) || 1e-6));
      g2.save(); g2.translate(W / 2 + dx * k, H / 2 + dy * k); g2.rotate(Math.atan2(dy, dx));
      g2.beginPath(); g2.moveTo(14, 0); g2.lineTo(-10, -9); g2.lineTo(-10, 9); g2.closePath(); g2.fill(); g2.restore();
    } else {
      const s = lock ? 26 + 2 * Math.sin(now / 200) : 20, c = s * 0.4;
      g2.beginPath();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) { g2.moveTo(x + sx * s, y + sy * (s - c)); g2.lineTo(x + sx * s, y + sy * s); g2.lineTo(x + sx * (s - c), y + sy * s); }
      g2.stroke();
      const bw = 68, bx = x - bw / 2, by = y - s - 13, hbar = (yy, f, c) => { g2.fillStyle = 'rgba(0,0,0,0.6)'; g2.fillRect(bx - 1, yy - 1, bw + 2, 7); g2.fillStyle = c; g2.fillRect(bx, yy, bw * Math.max(0, Math.min(1, f)), 5); };
      if (t.kind === 'p' || t.kind === 'h' || t.kind === 'n') { hbar(by - 8, t.sh / 100, '#4db8ff'); hbar(by, t.hp / 100, t.hp > 25 ? '#5dff8a' : '#ff4b3b'); } else hbar(by, t.hp / 100, t.hp > 40 ? '#5dff8a' : '#ff8a4c'); // vida sobre el objetivo
      if (sel) { g2.beginPath(); g2.moveTo(x, y - s - 24); g2.lineTo(x + s + 10, y); g2.lineTo(x, y + s + 24); g2.lineTo(x - s - 10, y); g2.closePath(); g2.stroke(); } // rombo de la nave elegida con B
      g2.fillStyle = col; g2.fillText(t.kind === 'n' ? `${t.hostile ? 'HOSTIL' : 'NEUTRAL'} · ${shipTag(t)} · ${fD(t.dist)}` : t.kind === 'p' ? `${t.name} · ${shipTag(t)} · ${fD(t.dist)}` : `${t.name} · ${fD(t.dist)}`, x, y + s + 14);
    }
  }
  tv.set(fwd.x, fwd.y, fwd.z).multiplyScalar(1000).project(camera);
  const ax = (tv.x * 0.5 + 0.5) * W, ay = (-tv.y * 0.5 + 0.5) * H,
        cone = Math.tan(CONE) / Math.tan(camera.fov * Math.PI / 360) * H / 2 * (1 + 0.08 * Math.max(0, 1 - nearest / 2000) * Math.sin(now / 140)), hot = lockT && (lockT.kind === 'p' || lockT.kind === 'h');
  g2.strokeStyle = hot ? '#ff2a2a' : lockT ? '#ffee55' : '#7fe8ff'; g2.beginPath(); g2.arc(ax, ay, 3, 0, 7);
  g2.moveTo(ax - 14, ay); g2.lineTo(ax - 6, ay); g2.moveTo(ax + 6, ay); g2.lineTo(ax + 14, ay); g2.moveTo(ax, ay - 14); g2.lineTo(ax, ay - 6); g2.moveTo(ax, ay + 6); g2.lineTo(ax, ay + 14); g2.stroke();
  g2.setLineDash([4, 6]); g2.beginPath(); g2.arc(ax, ay, cone, 0, 7); g2.stroke(); g2.setLineDash([]);
  g2.font = 'bold 22px ui-monospace,Consolas,monospace';
  if (hot) {
    g2.fillStyle = '#ff2a2a'; if (Math.floor(now / 250) % 2) g2.fillText(lockT.kind === 'h' ? '⚠ BASE ENEMIGA FIJADA — DISPAROS GUIADOS ⚠' : '⚠ BLANCO FIJADO — IMPACTO GARANTIZADO ⚠', W / 2, 70);
    if (now - lastBeep > 70 + 230 * Math.min(1, lockT.dist / RANGE)) { lastBeep = now; beep(); } // más cerca = pitido más rápido
  } else if (lockT) { g2.fillStyle = '#ffee55'; g2.fillText(lockT.kind === 'n' ? `NAVE ${lockT.hostile ? 'HOSTIL' : 'NEUTRAL'} FIJADA — disparos guiados` : 'CASCO FIJADO — misil listo', W / 2, 70); }
  g2.fillStyle = '#ffd23f';
  if (P.hp <= 0) { g2.fillText('DESTRUIDO', W / 2, H / 2 - 80); if (P.cause) { g2.font = `16px ${MONO}`; g2.fillText(P.cause, W / 2, H / 2 - 52); } }
  else if (P.plasma <= 0 && P.missiles <= 0) g2.fillText('SIN MUNICIÓN — destruye cascos a la deriva', W / 2, 105);
  if (now < P.msgT) g2.fillText(P.msg, W / 2, H - 90);
}

// ---------- bucle ----------
let last = performance.now();
const hud = document.getElementById('hud'), tv = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  if (typeof FOOT === 'undefined') return; // los scripts se cargan en orden: el primer cuadro puede llegar antes que foot.js
  const dt = Math.min((now - last) / 1000, 0.1); last = now; simT = Date.now() / 1000;

  // planetas se mueven; si estamos en la esfera de influencia de uno, la nave lo acompaña
  updateBodies();
  let near = null, minAlt = Infinity;
  const canBoost = (keys.ShiftLeft || keys.ShiftRight) && S.entry && !S.warp.on && S.warp.cd <= 0 && !S.park.on && !S.foot.on && P.hp > 0 && !(planets.info.on && planets.info.ground < 0.15);
  S.boost = S.entry ? (canBoost ? Math.min(1, S.boost + dt / 6) : Math.max(0, S.boost - dt / 1.5)) : 0; // la aceleración crece mientras se mantiene; termina al salir de la atmósfera
  const bmul = 1 + 6 * S.boost, manual = keys.KeyW || S.boost > 0.02; // manual: con W o con el impulso pulsados no hay frenado automático (se puede chocar)
  let rho = 0, rhoH = 0, rhoB = null; let capAll = Infinity, hardV = Infinity, atm = null, entry = false; // frenado automático: entrada en la atmósfera a ≤60 km/s; frena desde 5 km y bajo 1 km del suelo usa el motor de combustión (km/h)
  for (const b of bodies) {
    const alt = len(sub(S.pos, b.pos)) - b.R; if (alt < minAlt) { minAlt = alt; near = b; }
    if (b.k === 'sun') continue;
    if (ATMO[b.n]) { const Ha = ATMO[b.n].H, x = Math.max(0, (0.8 - alt / Ha) / 0.8), exo = Math.max(0, Math.min(1, (6 * Ha - alt) / (5 * Ha))), rt = 0.05 * exo + 0.95 * x * x; if (rt > rho) { rho = rt; rhoB = b; } rhoH = Math.max(rhoH, x * x); } // densidad del aire: 0 en la exosfera (20% superior), 1 al ras del suelo
    const H = hatm(b), g = planets.info.on && planets.info.name === b.n ? planets.info.ground : alt; // altitud sobre el terreno real (si está generado)
    const u = Math.max(0, Math.min(1, (g - LOW_ALT) / (BRAKE_ALT - LOW_ALT))); // frenado gradual (cuadrático) entre BRAKE_ALT y LOW_ALT km; bajo LOW_ALT desciende hasta un aterrizaje suave
    const big = ENTRY_MAX + 0.5 * Math.max(0, alt - H), zone = sstep(HI_ALT, HI_ALT + 40, g);
    let cap = LOWCAP + (big - LOWCAP) * zone; // por debajo de 80 km de altura no se pueden alcanzar los km/s (tope duro < 1 km/s); entre 80 y 120 km sube poco a poco
    if (g < HI_ALT) hardV = Math.min(hardV, LOWCAP);
    if (!manual) { if (g < LOW_ALT) cap = Math.min(cap, Math.max(0.04, ATM_MAX * Math.max(0, g) / LOW_ALT)); else if (g < BRAKE_ALT) cap = Math.min(cap, ATM_MAX + (LOWCAP - ATM_MAX) * u * u); capAll = Math.min(capAll, cap, Math.max(0.04, 0.5 * Math.max(g, 0) / dt)); } else capAll = Math.min(capAll, cap); // el frenado de aterrizaje solo si no aceleras a mano: con W pulsado puedes ir rápido cerca del suelo (hasta el tope de combustión) y chocar
    if (g < LOW_ALT && (!atm || g < atm.alt)) atm = { b, alt: g }; if (alt < H) entry = true;
  }
  S.rho = rho; S.rhoH = rhoH; S.rhoB = rhoB; S.atm = atm; S.entry = entry; S.low = hardV < Infinity; // S.low: a menos de 80 km de altura (modo combustión)
  const nearGround = planets.info.on && planets.info.ground < 0.08 && S.ve < 0.1 && P.hp > 0 && !S.warp.on && !S.foot.on; S.canPark = nearGround && !planets.info.water; S.canFloat = nearGround && !!planets.info.water; // sobre el agua no se estaciona ni se pulsa T: al tocar el agua despacio la nave amerriza sola
  if (!S.park.on && S.canFloat && planets.info.ground < 0.03) {
    const wb = bodies.find(x => x.n === planets.info.name), wd = sub(S.pos, wb.pos), wl = len(wd);
    Object.assign(S.park, { on: true, b: wb, dir: wd.map(c => c / wl), h: planets.info.ground, water: true, upT: null }); S.v = 0; say('Amerizaje: la nave flota sobre las olas · W para despegar');
  } // modo combustión: velocidades en km/h para maniobrar cerca del suelo
  CARRY = [0, 0, 0]; S.refB = near.a && minAlt < near.R * 30 ? near.i : -1; if (near.a && minAlt < near.R * 30) { const d = sub(near.pos, near.prev); CARRY = d; S.pos = [S.pos[0] + d[0], S.pos[1] + d[1], S.pos[2] + d[2]]; }

  // orientación
  // giro con inercia: el ratón y las teclas cambian la velocidad angular (no el ángulo), que se amortigua con el tiempo;
  // las naves grandes giran más despacio y tienen una velocidad angular máxima
  const fo = S.foot.on; if (fo) { FOOT.look(mdx, mdy); mdx = mdy = 0; } // a pie: el ratón gira al astronauta, no la nave
  const lockFly = S.lockB != null && !S.warp.on && S.warp.cd <= 0 && !S.park.on && !S.foot.on && P.hp > 0; if (lockFly) mdx = mdy = 0; // vuelo directo (G): solo se acelera y frena
  const TAU = 0.45, MAXR = 1.9 * P.agil, av = S.w, warp = S.warp, ag = P.agil;
  const keyRate = (pos, neg, rate) => ((pos ? 1 : 0) - (neg ? 1 : 0)) * rate * ag; // velocidad angular objetivo con teclas
  av.y += -mdx * 0.0022 / TAU * ag; av.p += -mdy * 0.0022 / TAU * ag;
  const ky = fo || lockFly ? 0 : keyRate(keys.ArrowLeft || keys.KeyA, keys.ArrowRight || keys.KeyD, 1.1), kp = fo || lockFly ? 0 : keyRate(keys.ArrowUp, keys.ArrowDown, 1.1), kr = fo || lockFly ? 0 : keyRate(keys.KeyQ, keys.KeyE, 1.4);
  if (ky) av.y += (ky - av.y) * (1 - Math.exp(-dt * 3)); if (kp) av.p += (kp - av.p) * (1 - Math.exp(-dt * 3)); if (kr) av.r += (kr - av.r) * (1 - Math.exp(-dt * 3));
  if (Math.abs(mdx) + Math.abs(mdy) > 3) S.auto = false;
  mdx = mdy = 0;
  const damp = Math.exp(-dt / TAU); // sin entrada, la nave sigue girando un poco y se frena sola
  if (!ky) av.y *= damp; if (!kp) av.p *= damp; if (!kr) av.r *= damp * 0.92;
  av.y = Math.max(-MAXR, Math.min(MAXR, av.y)); av.p = Math.max(-MAXR, Math.min(MAXR, av.p)); av.r = Math.max(-MAXR * 1.2, Math.min(MAXR * 1.2, av.r));
  if (warp.on || fo || lockFly || (S.park.on && !S.park.water)) av.y = av.p = av.r = 0; // en velocidad luz y estacionada en tierra la dirección está bloqueada
  const yaw = av.y * dt, pitch = av.p * dt, roll = av.r * dt;
  if (P.hp <= 0) { S.park.on = false; S.foot.on = false; }
  if (S.park.on) { // en el suelo solo se puede girar sobre el eje vertical
    const up = S.park.water && S.park.upT ? S.park.upT.clone() : new THREE.Vector3(...S.park.dir); S.q.premultiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q); f.addScaledVector(up, -f.dot(up)).normalize(); S.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), f, up));
  } else if (!warp.on) S.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')));
  if ((warp.on || warp.cd > 0) && !S.park.on) { const tb = warp.on ? warp.tb : warpTarget(); if (tb) S.q.slerp(lookQ(nrm(sub(tb.pos, S.pos))), 1 - Math.exp(-dt * (warp.on ? 10 : 3))); }
  if (lockFly) { const tb = lockObj(), dl = len(sub(tb.pos, S.pos)) - tb.R; if (dl < 3000) { S.lockB = null; say(tb.zone ? `Has llegado a ${tb.n}` : 'Has llegado: control manual'); } else S.q.slerp(lookQ(nrm(sub(tb.pos, S.pos))), 1 - Math.exp(-dt * 2.5)); } // llegada: a 3000 km de la superficie o del borde del cúmulo
  if (S.auto && !warp.on && !S.park.on) S.q.slerp(lookQ(nrm(sub(tgtObj().pos, S.pos))), 1 - Math.exp(-dt * 2));
  S.q.normalize();

  // velocidad: W/S exponencial; cerca de un cuerpo se limita a ~0.8·altitud por segundo
  if (warp.cd > 0) { // cuenta atrás: 5…1 con un pitido cada número y sacudida; se cancela si hay combate
    warp.cd -= dt;
    if (P.hp <= 0 || S.foot.on || S.park.on || inCombat(now)) { warp.cd = 0; say('Cuenta atrás cancelada'); }
    else { const n = Math.ceil(warp.cd); if (n !== warp.n) { warp.n = n; if (n >= 1) { sfx('tick', 5 - n); P.shake = Math.max(P.shake, 0.3); } } if (warp.cd <= 0) { warp.cd = 0; startWarp(); } }
  }
  if (warp.on && P.hp <= 0) endWarp('');
  if (warp.on) { // gasta la barra y acelera hacia 5 c
    warp.bar -= dt; warp.v += (5 * C - warp.v) * (1 - Math.exp(-dt * 2.5));
    if (warp.bar <= 0) { warp.bar = 0; warp.lock = true; endWarp('Motor de velocidad luz agotado'); }
  } else { warp.bar = Math.min(P.warpMax, warp.bar + dt * P.warpMax / 30); if (warp.lock && warp.bar >= 0.25 * P.warpMax) warp.lock = false; }
  warp.fx += ((warp.on ? 1 : 0) - warp.fx) * (1 - Math.exp(-dt * 3));
  if (S.park.on) { if (keys.KeyW && !S.foot.on && S.park.water) S.park.on = false; else S.v = 0; }
  if (!warp.on && !S.park.on) { // velocidad normal: tope según los motores (hasta 1500 km/s)
    const slow = S.low && S.v > SOFTV; // bajo 80 km: hasta ~3 560 km/h se acelera normal; de ahí a 9 000 km/h cuesta mucho más tiempo
    if (keys.KeyW && !(S.boost > 0 && canBoost)) S.v = slow ? S.v + 0.2 * dt : Math.max(S.v, 0.05) * Math.exp(2 * dt); // más allá de ~3 560 km/h el empuje suma velocidad de forma constante: cuanto más y más tiempo empujas, más rápido vas
    if (keys.KeyS) { S.v /= Math.exp(2 * dt); if (S.v < 0.02) S.v = 0; }
    if (S.boost > 0 && canBoost && slow) S.v += (0.2 + 0.4 * S.boost) * dt; // impulso: la aceleración crece con el tiempo que lo mantienes
    else if (S.boost > 0 && canBoost) S.v = Math.max(S.v, 0.3) * Math.exp((0.5 + 0.7 * S.boost) * dt); // aceleración progresiva y más suave
    S.v = Math.min(S.v, P.vmax, hardV, S.atm ? (manual ? LOWCAP : ATM_MAX * bmul) : S.entry ? ENTRY_MAX * (1 + 0.5 * S.boost) : Infinity);
  }
  fields.update(S.pos); // asteroides/basura cercanos; la nave también frena ante ellos
  if (now - (S.emptyT || 0) > 500) { S.emptyT = now; for (let i = fields.active.length - 1; i >= 0; i--) { const o = fields.active[i]; if (astLeft(o).length) continue; fields.gone.add(o.id); fields.active.splice(i, 1); AST.delete(o.id); if (len(sub(o.pos, S.pos)) < 40000) puff(o.pos, Math.min(40, Math.max(3, o.vis * 0.6)), 0xb0a48f, 1.4, 0.004); } } // su zona se agotó: el asteroide se desvanece (no quedan asteroides vacíos)
  const vEff = S.park.on ? 0 : warp.on ? warp.v : Math.min(S.v, Math.max(0.02, Math.min(capAll, 2 * fields.near))), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.q);
  const oldPos = S.pos;
  if (S.park.on) parkStep(dt); else if (warp.on) warpStep(dt); else S.pos = [S.pos[0] + fwd.x * vEff * dt, S.pos[1] + fwd.y * vEff * dt, S.pos[2] + fwd.z * vEff * dt];
  if (!S.park.on && !warp.on && vEff * dt > 0.05 && planets.info.on) { const bb = bodies.find(x => x.n === planets.info.name), n = Math.min(40, Math.ceil(vEff * dt / 0.08)); if (bb) for (let k = 1; k < n; k++) { const p = oldPos.map((c, i) => c + (S.pos[i] - c) * k / n), d = sub(p, bb.pos), l = len(d); if (l < planets.surfaceR(bb, d, l) + 0.03) { S.pos = p; break; } } } // el primer punto bajo el suelo del tramo es donde chocas
  for (const b of bodies) { // suelo real (terreno procedural), núcleo de los gigantes gaseosos o superficie del Sol
    const d = sub(S.pos, b.pos), l = len(d);
    if (l > b.R * 1.03 + 60 || (S.park.on && b === S.park.b)) continue;
    const r = planets.surfaceR(b, d, l) + 0.03;
    if (l < r) {
      if (P.hp > 0 && vEff > 0.35) { // impacto a más de 350 m/s: la nave estalla
        P.cause = b.k === 'sun' ? 'incinerado por el Sol' : b.k === 'gas' ? `aplastado por la presión de ${b.n}` : `chocaste contra ${b.n}`;
        hurt(P.hp + P.sh + 1, d.map(c => -c / l), now);
      } else S.v = Math.min(S.v, 0.05); // aterrizaje suave
      S.pos = b.pos.map((c, i) => c + d[i] / l * r);
    }
  }

  for (const o of fields.active) if (!warp.on && P.hp > 0 && now - P.rockT > 500 && segDist(oldPos, S.pos, o.pos) < o.r + 0.03) { // choque: daño según velocidad y rebote
    const n = nrm(sub(S.pos, o.pos)); S.pos = o.pos.map((c, i) => c + n[i] * (o.r + 0.06)); P.rockT = now;
    hurt(10 + Math.min(60, vEff / 25), n.map(c => -c), now); S.v *= 0.1;
  }

  { // turbulencia y calentamiento por fricción al entrar en una atmósfera: demasiada velocidad con aire denso desintegra la nave
    const dn = S.rhoB ? sstep(0.2, 0.8, ((fwd.x * (S.rhoB.pos[0] - S.pos[0]) + fwd.y * (S.rhoB.pos[1] - S.pos[1]) + fwd.z * (S.rhoB.pos[2] - S.pos[2])) / Math.hypot(S.rhoB.pos[0] - S.pos[0], S.rhoB.pos[1] - S.pos[1], S.rhoB.pos[2] - S.pos[2])) ) : 0; // la fricción solo actúa al descender: al salir o alejarse no hay
    const sun0 = bodies[0], xs = len(sub(S.pos, sun0.pos)) / sun0.R, ss = sstep(16, 1.5, xs), Tst = warp.on ? 0 : 1.5 * ss * ss, hs = 90 * sstep(3.6, 1.4, xs); // ESTRELLA: turbulencia desde 16 radios solares (siempre, sin importar la velocidad) y radiación letal bajo ~3 radios, mucho antes de su atmósfera
    P.heatStar = hs > 1;
    const rd = S.rho * dn, rh = S.rhoH * dn, T0 = Math.max(Tst, warp.on || P.hp <= 0 ? 0 : Math.min(1.5, Math.min(vEff, 80) / 20 * rd)), T = T0 < 0.05 ? 0 : T0; // sin zumbido residual fuera de la atmósfera
    P.turb += (T - P.turb) * (1 - Math.exp(-dt * 6));
    P.heat = Math.max(0, Math.min(100, P.heat + (220 * Math.pow(Math.max(0, (vEff - 12) / 48), 1.3) * rh + hs - (vEff < 12 ? 18 : 4)) * dt));
    if (P.hp > 0 && P.heat > 50) burn(0.6 * (P.heat - 50) * dt, now);
    if (P.hp > 0 && P.heat >= 100) { P.cause = P.heatStar ? 'la radiación de la estrella destruyó la nave' : 'te desintegraste al entrar a la atmósfera a demasiada velocidad'; burn(P.hp + P.sh + 1, now); }
    if (P.turb > 0.05 && audio && now - lastRumble > 90) { lastRumble = now; noise(0.14, 0.03 + 0.07 * Math.min(1, P.turb), 500, 90); } // retumbar
  }

  FOOT.frame(dt, now); FOOT.tickStay(dt); if (typeof BASE !== 'undefined') BASE.frame(dt, now); if (typeof BOT !== 'undefined') BOT.frame(dt, now); if (typeof NEU !== 'undefined') NEU.frame(dt, now); // modo a pie: caminar, recolectar y colocar al astronauta

  // render con origen flotante + compresión de distancias enormes (mantiene el tamaño angular real)
  for (const b of bodies) {
    const rel = b.rel || (b.rel = [0, 0, 0]); rel[0] = b.pos[0] - S.pos[0]; rel[1] = b.pos[1] - S.pos[1]; rel[2] = b.pos[2] - S.pos[2]; // se reutiliza el mismo array (sin asignaciones por cuadro)
    const d = Math.hypot(rel[0], rel[1], rel[2]), rd = d > RMAX ? RMAX * (2 - RMAX / d) : d, s = rd / d;
    b.group.position.set(rel[0] * s, rel[1] * s, rel[2] * s);
    b.group.scale.setScalar(b.R * s);
    if (b.k === 'sun') b.mesh.rotation.y += dt * 0.02; // los planetas no giran: su textura debe seguir coincidiendo con el terreno cercano
    if (b.glow) { b.glow.position.copy(b.group.position); b.glow.scale.setScalar(b.R * s * 6); }
    if (b.k === 'sun') sunLight.position.set(rel[0] / d, rel[1] / d, rel[2] / d);
    b.dist = d; b.rp = b.group.position;
  }

  planets.update(S.pos, sunLight.position, fwd);
  const sky = planets.sky(S.pos, sunLight.position); renderer.setClearColor(sky.color); scene.fog.density = 0; // sin niebla (ni de suelo ni de cielo): se distingue el terreno del cielo
  scene.fog.color.copy(sky.color); { // cielo atmosférico (el sol se suaviza bajo la atmósfera) y, sobre mundos muy claros (hielo, arena blanca), menos luz para que se distinga el suelo
    const fbb = planets.info.on ? bodies.find(x => x.n === planets.info.name) : null; let dim = 1;
    if (fbb) { if (fbb.lum === undefined) { const a = new THREE.Color(fbb.c1), b2 = new THREE.Color(fbb.c2), L = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; fbb.lum = (L(a) + L(b2)) / 2; } dim = 1 - (0.12 + 0.45 * Math.max(0, Math.min(1, (fbb.lum - 0.25) / 0.35))) * Math.max(0, Math.min(1, 1 - planets.info.ground / 250)); }
    sunLight.intensity = (1.6 - 0.5 * sky.f) * dim; ambLight.intensity = 0.22 * (0.6 + 0.4 * dim);
  }
  SKY.set(sky.stars);
  // combate: respawn, disparos, proyectiles, remotos y cascos
  if (P.hp <= 0 && now >= P.deadUntil && (typeof BASE === 'undefined' || BASE.canRespawn())) { spawn(); P.cause = ''; P.heat = 0; Object.assign(P, { hp: P.hpMax, sh: P.shMax, plasma: MAXA.plasma, missiles: MAXA.missiles }); S.v = Math.min(300, P.vmax); Object.assign(S.warp, { on: false, bar: P.warpMax, lock: false }); }
  const alive = P.hp > 0; P.cdP -= dt; P.cdM -= dt; P.flash = Math.max(0, P.flash - dt * 1.1); ship.visible = alive;
  if (alive && now - P.shT > 4000 && P.sh < P.shMax) P.sh = Math.min(P.shMax, P.sh + 0.12 * P.shMax * dt); // el escudo se regenera sin recibir golpes
  P.sf = Math.max(0, P.sf - dt * 2.5); P.shake = Math.max(0, P.shake - dt * 2.5); setShieldFlash(ship, P.sf);
  if (alive && P.hp < 40 && (P.smoke -= dt) <= 0) { P.smoke = 0.06; puff(S.pos.map((c, j) => c - fwd.getComponent(j) * 0.03 + (Math.random() - 0.5) * 0.01), 0.012, 0xff7a30, 1.4, 0.004); } // casco dañado: humo
  if (alive && P.plasma < MAXA.plasma && now - (P.fireT || 0) > 1500) { P.pAcc = (P.pAcc || 0) + dt; const rg = P.regen || 1.4; if (P.pAcc >= rg) { P.pAcc -= rg; P.plasma++; } } // la munición de plasma se recarga muy lentamente (1 cada 1,4 s; menos con puntos de nivel en Recarga) si no disparas
  if (alive && firing && !S.warp.on && !S.foot.on && S.warp.cd <= 0 && P.cdP <= 0 && P.plasma > 0) { P.fireT = now; P.plasma--; P.cdP = WPN.p.cd; shoot('p', lockT ? { k: lockT.kind, id: lockT.id } : null); }
  if (now - lastSend > 66) { lastSend = now; send({ t: 's', rb: S.refB, rp: S.refB >= 0 ? sub(S.foot.on ? S.shipPos : S.pos, bodies[S.refB].pos) : null, name: myName, pos: S.foot.on ? S.shipPos : S.pos, q: S.q.toArray(), v: alive ? vEff : 0, hp: P.hp / P.hpMax * 100, sh: P.sh / P.shMax * 100, sp: mySpec, lv: lvlOf(mySpec.t).lv, k: P.kills, d: P.deaths || 0, ms: P.missiles, pk: S.park.on ? 1 : 0, bt: Math.round(S.boost * 100) / 100 }); }
  S.ve = alive ? vEff : 0; engine(S.ve, (keys.KeyW && alive) || S.warp.on || S.boost > 0.05); if (S.boost > 0.02) P.shake = Math.max(P.shake, 0.1 + 0.15 * S.boost);
  const targets = [];
  for (const r of remotes.values()) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(r.q), k = r.v * (Date.now() - r.t) / 1000;
    const bs = r.rb >= 0 && r.rp ? bodies[r.rb].pos.map((c, i) => c + r.rp[i]) : r.pos; // relativa al planeta de referencia del rival: sigue su órbita sin sacudidas
    r.apos = [bs[0] + f.x * k, bs[1] + f.y * k, bs[2] + f.z * k];
    const v = view(r.apos); r.grp.visible = r.hp > 0; r.fl = Math.max(0, (r.fl || 0) - dt * 2.5); setShieldFlash(r.grp, r.fl);
    r.grp.position.set(v.x, v.y, v.z); r.grp.scale.setScalar(Math.max(v.s, v.rd * 0.12)); r.grp.quaternion.copy(r.q); // tamaño real; mínimo ≈0.3° aparente
    setThrust(r.grp, r.v, now); setFlameHeat(r.grp, r.bt || 0); updateShipFx(r.grp, now, r.ms); r.grp.gear.visible = !!r.pk; r.dist = v.d; r.dir = [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d];
    if (r.hp > 0) targets.push({ kind: 'p', id: r.id, name: r.name, hp: r.hp, sh: r.sh, grp: r.grp, dist: v.d, dir: r.dir, lv: r.lv, st: r.st });
  }
  if (typeof BASE !== 'undefined') for (const t of BASE.targets()) targets.push(t); // las bases enemigas también son objetivos: se pueden fijar y guiar los disparos hacia ellas
  if (typeof NEU !== 'undefined') for (const t of NEU.targets()) targets.push(t); // naves neutrales
  if (typeof BOT !== 'undefined') for (const t of BOT.targets()) targets.push(t); // anfitrión: sus propios bots (antes se veían pero no eran objetivo: naves fantasma)
  for (const w of wrecks) {
    w.pos = [w.parent.pos[0] + w.off[0], w.parent.pos[1] + w.off[1], w.parent.pos[2] + w.off[2]];
    const v = view(w.pos), isDead = dead.has(w.i); w.grp.visible = !isDead;
    w.ang += dt * 0.3; w.grp.quaternion.setFromAxisAngle(w.ax, w.ang);
    w.grp.position.set(v.x, v.y, v.z); w.grp.scale.setScalar(Math.max(v.s * 6, v.rd * 0.15));
    w.dist = v.d; w.dir = [v.rel[0] / v.d, v.rel[1] / v.d, v.rel[2] / v.d];
    if (!isDead) targets.push({ kind: 'w', id: w.i, name: 'Casco a la deriva', hp: w.hp / WRECK_HP * 100, grp: w.grp, dist: v.d, dir: w.dir });
  }
  lastTargets = targets; S.tsel = S.tship ? targets.find(t => t.kind === S.tship.kind && t.id === S.tship.id) || null : null; if (S.tship && !S.tsel) S.tship = null; // nave elegida con B (se suelta si muere o se pierde)
  lockT = null; let bestA = CONE;
  if (alive) for (const t of targets) {
    const a = Math.acos(Math.min(1, fwd.x * t.dir[0] + fwd.y * t.dir[1] + fwd.z * t.dir[2]));
    if (a < bestA && t.dist < (t.kind === 'h' ? 200 : RANGE) && !losBlocked(t)) { bestA = a; lockT = t; }
  }
  aimT = null; // objetivo bajo la mira para el recuadro de vista previa
  if (alive) {
    let bd = Infinity; const CA = Math.cos(4 * Math.PI / 180);
    for (const t of targets) if (t.dist < 100000 && fwd.x * t.dir[0] + fwd.y * t.dir[1] + fwd.z * t.dir[2] > CA && t.dist < bd) { bd = t.dist; aimT = { type: t.kind, t, dist: t.dist }; }
    for (const ob of fields.active) {
      const rx = ob.pos[0] - S.pos[0], ry = ob.pos[1] - S.pos[1], rz = ob.pos[2] - S.pos[2], d = Math.hypot(rx, ry, rz), c = (fwd.x * rx + fwd.y * ry + fwd.z * rz) / d;
      if (d < bd && d < 30000 && Math.acos(Math.min(1, c)) < Math.atan(ob.r * 1.3 / d) + 0.03) { bd = d; aimT = { type: 'r', ob, dist: d }; }
    }
    let bestB = null, bestBd = Infinity, keepB = null; // planetas bajo la mira: solo los que no tapa otro más cercano; se mantiene el ya apuntado (histéresis) para que la mira no salte entre dos
    for (const b of bodies) {
      const rx = b.pos[0] - S.pos[0], ry = b.pos[1] - S.pos[1], rz = b.pos[2] - S.pos[2], d = Math.hypot(rx, ry, rz), c = (fwd.x * rx + fwd.y * ry + fwd.z * rz) / d, ang = Math.acos(Math.min(1, c)), rad = Math.atan(b.R / d);
      if (d - b.R <= 3000 || d - b.R >= bd || occluded(b)) continue; // margen de 2.3° (3.4° si ya estaba apuntado): de lejos un planeta ocupa una fracción de grado
      if (ang < rad + (b === lastAimB ? 0.06 : 0.04)) { if (b === lastAimB) keepB = b; if (d - b.R < bestBd) { bestBd = d - b.R; bestB = b; } }
    }
    const pickB = keepB || bestB; lastAimB = pickB; if (pickB) { const dd = Math.hypot(pickB.pos[0] - S.pos[0], pickB.pos[1] - S.pos[1], pickB.pos[2] - S.pos[2]) - pickB.R; bd = dd; aimT = { type: 'b', b: pickB, dist: dd }; }
    for (const t of ZT) { // cúmulo bajo la mira (su área o su marcador, +1,7°): G fija el rumbo y Shift salta hacia él; manda sobre un planeta más lejano
      const rx = t.pos[0] - S.pos[0], ry = t.pos[1] - S.pos[1], rz = t.pos[2] - S.pos[2], d = Math.hypot(rx, ry, rz), dz = d - t.R; if (dz <= 3000 || dz >= bd) continue;
      if (Math.acos(Math.min(1, (fwd.x * rx + fwd.y * ry + fwd.z * rz) / d)) > Math.atan(t.R / d) + 0.03 || losBlocked({ dir: [rx / d, ry / d, rz / d], dist: d, kind: 'z' })) continue;
      bd = dz; aimT = { type: 'z', z: t, dist: dz };
    }
  }
  for (const [key, p] of projs) {
    p.life -= dt; if (p.life <= 0) { killProj(key); continue; }
    if (CARRY[0] || CARRY[1] || CARRY[2]) p.pos = p.pos.map((c, i) => c + CARRY[i]);
    const ak = airK(p.pos), tp = p.tgt && targetPos(p.tgt); let spd = p.spd ?? (WPN[p.kind].speed * (1 - ak) + AIR[p.kind] * ak); if (p.spd === undefined) p.life += dt * 0.9 * ak; // en el aire son lentos y visibles; viven más para recorrer distancia
    if (tp) { // guiado: gira hacia el blanco y acelera si este huye más rápido que el proyectil
      const dd = nrm(sub(tp, p.pos)), k = Math.min(1, WPN[p.kind].turn * dt);
      p.dir = nrm(p.dir.map((c, i) => c + (dd[i] - c) * k)); spd = Math.max(spd, 1.3 * targetSpeed(p.tgt));
      if (len(sub(tp, p.pos)) < spd * dt * 2) p.dir = dd;
    }
    const old = p.pos, sp = spd * dt; p.pos = old.map((c, i) => c + p.dir[i] * sp);
    if (p.fromSpace && airK(p.pos) > 0.02) { killProj(key); continue; } // viene del espacio: se consume al entrar en la atmósfera
    const ao = fields.active.find(o => segDist(old, p.pos, o.pos) < o.r); if (ao) { puff(p.pos, 2, 0xffd090, 0.4, 0.01); killProj(key); if (p.owner === myId && !p.bot) hitAsteroid(ao, p.dmg); continue; } // extraer recursos de asteroides
    if ((p.owner === myId || (p.owner >= 2000 && p.owner < 3000)) && typeof BASE !== 'undefined' && BASE.hit(old, p.pos, p)) { killProj(key); continue; } // golpe al hangar de otro jugador (las neutrales no atacan bases)
    const gi = planets.impact(old, p.pos); if (gi) { killProj(key); if (len(sub(gi, S.pos)) < 200) boom(gi, p.kind === 'm' ? 0.06 : 0.012); FOOT.splash(gi, p.kind); continue; } // el proyectil golpea el suelo: explosión y daño de área a los objetos
    if (p.owner !== myId && !p.vis && alive && segDist(old, p.pos, S.pos) < (p.spd !== undefined || ak > 0.02 ? 0.04 : HIT_R)) { // en el aire y los disparos de torreta: radio real de la nave (40 m); en el espacio, el radio grande de siempre // el impacto lo decide la víctima
      killProj(key); if (p.owner < 0 && typeof BASE !== 'undefined') { const th = BASE.HG.get(-p.owner); attackAlert('t', th ? th.nm : 'un enemigo', th ? BASE.worldOf(th) : null); } else if (p.owner !== myId) attackAlert('p', ownerName(p.owner), ownerPos(p.owner)); hurt(p.dmg, p.dir, now); send({ t: 'hit', by: p.owner, key, dmg: p.dmg, pos: S.pos, dead: P.hp <= 0, sh: P.sh });
      continue;
    }
    if (!p.vis && p.bot === undefined && p.owner > -1000 && typeof BOT !== 'undefined' && BOT.hit(old, p.pos, p, key, ak)) { killProj(key); continue; } // impacto en un bot (lo decide su anfitrión, el administrador)
    if (!p.vis && typeof NEU !== 'undefined' && NEU.hit(old, p.pos, p, key, ak)) { killProj(key); continue; } // impacto en una nave neutral (lo decide el anfitrión)
    if (p.owner === myId) for (const w of wrecks) if (!dead.has(w.i) && segDist(old, p.pos, w.pos) < WRECK_R) {
      w.hp -= p.dmg; killProj(key); boom(p.pos, 6);
      if (w.hp <= 0) {
        dead.add(w.i); boom(w.pos, 80); send({ t: 'wreck', id: w.i });
        P.plasma = MAXA.plasma; P.missiles = MAXA.missiles; say('¡CASCO DESTRUIDO! MUNICIÓN RECARGADA'); // sus recursos los concede el servidor (respuesta 'mined'), solo la primera vez en la sala
      }
      break;
    }
    if (!projs.has(key)) continue;
    const v = view(p.pos), d = new THREE.Vector3(...p.dir);
    if (p.kind === 'p') { // rayo alargado que se ve desde lejos; su cola marca la trayectoria
      const trav = len(sub(p.pos, p.o0)), L = Math.min(300, Math.max(0.03, v.rd * 0.04), Math.max(0.001, trav)), r = Math.max(0.002, v.rd * 0.003) * (p.spd !== undefined ? 2.4 : 1); // la cola nunca pasa del punto de partida (el cañón)
      p.sp.position.set(v.x - d.x * L / 2, v.y - d.y * L / 2, v.z - d.z * L / 2); p.sp.scale.set(r, r, L); p.sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    } else { // misil con llama parpadeante y estela de humo
      const sc = Math.max(0.02 * v.s, v.rd * 0.008);
      p.sp.position.set(v.x, v.y, v.z); p.sp.scale.setScalar(sc); p.sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
      p.sp.flame.scale.set(1, 1, 0.6 + Math.random() * 0.9);
      if ((p.puff -= dt) <= 0) { p.puff = 0.02; puff(p.pos, 0.01, 0xff9a40, 1.2, 0.006); }
    }
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i]; e.t += dt; if ((CARRY[0] || CARRY[1] || CARRY[2]) && Math.abs(e.pos[0] - S.pos[0]) < 300 && Math.abs(e.pos[1] - S.pos[1]) < 300 && Math.abs(e.pos[2] - S.pos[2]) < 300) e.pos = e.pos.map((c, i) => c + CARRY[i]); const v = view(e.pos);
    if (e.t > e.dur) { scene.remove(e.sp); e.sp.material.dispose(); fx.splice(i, 1); continue; }
    const k = e.t / e.dur; e.sp.material.opacity = (1 - k) * 0.9; e.sp.position.set(v.x, v.y, v.z);
    e.sp.scale.setScalar(Math.max(e.size * (0.4 + k * 1.6) * v.s, v.rd * e.min));
  }

  // cámara en tercera persona con retardo suave
  camQ.slerp(S.foot.on ? S.foot.q : S.q, 1 - Math.exp(-dt * (S.foot.on ? (S.foot.view !== 'tp' ? 45 : 12) : 6)));
  ship.quaternion.copy(S.q);
  if (P.shake > 0) ship.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.3 * P.shake, (Math.random() - 0.5) * 0.3 * P.shake, (Math.random() - 0.5) * 0.5 * P.shake)));
  setThrust(ship, alive ? (S.park.leaving ? 30 : vEff) : 0, now); setFlameHeat(ship, S.boost); for (const f of ship.flames) f.scale.z *= 1 + 0.8 * S.boost; updateShipFx(ship, now, P.missiles); S.gearK += ((S.park.on && !S.park.water && !(S.park.leaving && S.park.t > 0.5) ? 1 : 0) - S.gearK) * (1 - Math.exp(-dt * 7)); ship.gear.visible = S.gearK > 0.02; dustTick(dt); ship.gear.scale.y = Math.max(0.01, S.gearK); // las ruedas se despliegan y recogen
  camera.quaternion.copy(camQ);
  const tf = 65 + 25 * S.warp.fx; if (Math.abs(camera.fov - tf) > 0.05) { camera.fov = tf; camera.updateProjectionMatrix(); } // el campo de visión se abre en velocidad luz
  if (S.foot.on) FOOT.cam(); else camera.position.set(0, 0.022, 0.09).applyQuaternion(camQ); // a pie: cámara del astronauta (1ª/3ª persona con balanceo)
  if (P.shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(0.02 * P.shake));
  const tb = P.turb; // turbulencia: vibra la cámara y la pantalla entera
  if (tb > 0.02) {
    camera.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.015 * tb));
    camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.012 * tb, (Math.random() - 0.5) * 0.012 * tb, (Math.random() - 0.5) * 0.03 * tb)));
  }
  const tr = tb > 0.02 ? `translate(${(Math.random() - 0.5) * 9 * tb}px,${(Math.random() - 0.5) * 9 * tb}px) scale(1.03)` : ''; renderer.domElement.style.transform = hc.style.transform = tr;
  camera.updateMatrixWorld(); _fr.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  fields.render(S.pos, now, _fr); planets.cull(_fr); // solo se genera y se dibuja lo que está dentro del campo de visión
  SKY.follow(camera.position);
  renderer.render(scene, camera);

  // etiquetas y HUD
  for (const b of bodies) {
    tv.copy(b.rp).project(camera);
    const vis = tv.z < 1 && Math.abs(tv.x) < 1.1 && Math.abs(tv.y) < 1.1 && b.dist > b.R * 0.5 && !S.foot.on && !occluded(b); // un planeta tapado por otro no muestra su información
    b.el.style.display = vis ? '' : 'none';
    if (vis) {
      b.el.style.transform = `translate(${(tv.x * 0.5 + 0.5) * innerWidth + 8}px,${(-tv.y * 0.5 + 0.5) * innerHeight}px)`;
      b.el.className = 'lb' + (b.i === S.tgt ? ' t' : '');
      b.el.textContent = `${b.n} · ${fD(b.dist - b.R)}`;
    }
  }
  { const sg = JSON.stringify(INV); if (sg !== rsSig) { rsSig = sg; rsEl.innerHTML = Object.keys(RES).map(k => `<span class="cost"><i>${ICONS[k]}</i>${INV[k]}</span>`).join(''); } } // recursos recogidos: arriba a la izquierda, con su icono
  hud.style.display = S.foot.on ? 'none' : ''; // a pie se ocultan los paneles de la nave
  scoreboardTick(now); drawHud(fwd, now, targets); FOOT.hud(now); if (typeof BASE !== 'undefined') BASE.hud(now); if (typeof TV !== 'undefined') TV.update(S.foot.on ? null : aimT && (aimT.type === 'p' || aimT.type === 'n') ? aimT : S.tsel ? { type: S.tsel.kind, t: S.tsel, dist: S.tsel.dist } : aimT, now); // la nave bajo la mira manda; si no, la elegida con B; si no, lo que haya en la mira
  hud.textContent = planets.info.on ? `SUELO      ${fD(Math.max(0, planets.info.ground))} sobre ${planets.info.water ? 'el agua' : 'tierra'} de ${planets.info.name}` : ''; // el panel solo muestra el suelo: velocidad e impulso van en el medidor y los avisos en notificaciones
  if (ov.style.display !== 'none' && typeof hangarFrame === 'function') hangarFrame(now);
}
requestAnimationFrame(frame);
