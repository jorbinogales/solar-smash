// Menú (Esc / H): pestañas NAVE, BASE, PERSONAJE y CONTROLES. Las mejoras se compran con los recursos del planeta; el coste se muestra solo como icono + número.
const $ = id => document.getElementById(id);
let sel = JSON.parse(JSON.stringify(mySpec)), tab = 'ship';
const mkPreview = id => { const r = new THREE.WebGLRenderer({ canvas: $(id), antialias: true, alpha: true }), sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(38, 460 / 320, 0.001, 20); sc.add(new THREE.AmbientLight(0xffffff, 0.4)); const l = new THREE.DirectionalLight(0xffffff, 0.9); l.position.set(1, 1.4, 0.8); sc.add(l); r.setPixelRatio(Math.min(devicePixelRatio, 2)); const pivot = new THREE.Group(); sc.add(pivot); return { r, sc, cam, pivot, obj: null, key: '' }; };
const PV = mkPreview('pv'), BV = mkPreview('bv');

// naves y estilos de torreta desbloqueados (Halcón y plasma son los básicos)
const load = (k, base) => { try { return new Set([...base, ...JSON.parse(localStorage.getItem(k) || '[]')]); } catch { return new Set(base); } };
const unlocked = load('unlockedShips', ['halcon']), towersUnlocked = load('unlockedTowers', ['plasma']);
const saveSets = () => { try { localStorage.setItem('unlockedShips', JSON.stringify([...unlocked])); localStorage.setItem('unlockedTowers', JSON.stringify([...towersUnlocked])); } catch {} };
function resetShips() { unlocked.clear(); unlocked.add('halcon'); towersUnlocked.clear(); towersUnlocked.add('plasma'); saveSets(); }

const bar = (v, max, col) => `<div class="bar"><i style="width:${Math.min(100, Math.max(0, v / max * 100))}%;background:${col}"></i></div>`;
const inv = () => (typeof INV !== 'undefined' ? INV : {});
const icon = k => (typeof ICONS !== 'undefined' && ICONS[k]) || '';
const ic = k => `<i class="uico">${(typeof UPI !== 'undefined' && UPI[k]) || ''}</i>`;
const costHtml = cost => `<span class="costs">${Object.entries(cost).map(([k, n]) => `<span class="cost${(inv()[k] || 0) >= n ? '' : ' no'}"><i>${icon(k)}</i>${n}</span>`).join('')}</span>`;
const canPay = cost => Object.entries(cost).every(([k, n]) => (inv()[k] || 0) >= n);
const pips = (lv, max) => Array.from({ length: max }, (_, k) => `<span class="pip ${k < lv ? 'on' : ''}" style="display:inline-block;margin-left:3px"></span>`).join('');
const buyBtn = (attr, cost) => `<span class="buy" ${attr}>${costHtml(cost)}</span>`;
let pvs = null; // vista previa: al pasar el ratón sobre una mejora bloqueada se ve su efecto en el modelo sin comprarla ('style:x' | 'up:x' | 'ship:x' | 'add:i')
const card = (iconKey, title, pipsHtml, small, ctl, pv = '') => `<div class="upc" data-pv="${pv}">${ic(iconKey)}<div><b>${title}<span>${pipsHtml}</span></b><small>${small}</small><div class="ctl">${ctl}</div></div></div>`;

function applyNow() { const v = validSpec(sel); saveSpec(v); applyLoadout(v, false); refresh(); } // la nave se actualiza al momento
const atBase = () => typeof BASE === 'undefined' || !BASE.started() || BASE.atBase(); // compras, mejoras, puntos de nivel y cambios de nave: solo en tu base
const NOB = 'Solo en tu base';
const lvA = t => { const a = lvlOf(t).a.slice(); if (pvs && pvs.startsWith('lv:') && t === mySpec.t) { const i = +pvs.slice(3); a[i] = Math.min(LV_PTMAX, a[i] + 1); } return a; }; // puntos de nivel (con el que se previsualiza al pasar el ratón por un «+»)

// ---------- NAVE ----------
function renderRes() {
  const keys = typeof RES !== 'undefined' ? Object.keys(RES) : ['agua', 'piedra', 'cobre', 'plata', 'oro', 'diamante'];
  $('resbar').innerHTML = keys.map(k => `<span class="cost"><i>${icon(k)}</i>${inv()[k] || 0}</span>`).join('');
}
function renderShip() {
  sel = validSpec(sel); const shown = (() => { if (!pvs) return sel; if (pvs.startsWith('ship:')) return validSpec({ ...sel, t: pvs.slice(5) }); if (pvs.startsWith('add:')) { const i = +pvs.slice(4), a = sel.a.slice(); a[i] = Math.min(ADDONS[i].max, a[i] + 1); return validSpec({ ...sel, a }); } return sel; })(), previewing = shown !== sel, st = statsOf(shown, lvA(shown.t)), used = sel.a.reduce((x, y) => x + y, 0), tot = ADDONS.reduce((x, d) => x + d.max, 0);
  $('shipList').innerHTML = Object.entries(TYPES).map(([id, t]) => { const cost = SHIP_COST[id], unl = !cost || unlocked.has(id); return `<button class="ship hasico ${id === sel.t ? 'on' : ''}" data-t="${id}" data-pv="ship:${id}">${ic(id)}<div><b>${t.name}</b><small>${t.role}</small><small>${t.desc}</small>${unl ? '' : costHtml(cost)}</div></button>`; }).join('');
  $('slots').innerHTML = `<b>Mejoras ${used}/${tot}</b> ${'▮'.repeat(used)}${'▯'.repeat(tot - used)}`;
  $('addons').innerHTML = ADDONS.map((a, i) => { const lv = sel.a[i], cost = lv < a.max ? upgradeCost(i, lv) : null; return card(a.id, a.name, pips(lv, a.max), a.desc, cost ? buyBtn(`data-a="${i}"`, cost) : '<span class="max">MÁXIMO</span>', lv < a.max ? 'add:' + i : ''); }).join('');
  const L = lvlOf(shown.t), pts = shown.t === mySpec.t ? lvPts(L) : 0, ok = atBase(), need = L.lv < LV_MAX ? lvNeed(L.lv + 1) : 0; // nivel de la nave mostrada; los «+» solo para la nave actual
  const lvCell = i => i < 0 ? '<span class="lvc"></span>' : `<span class="lvc">${L.a[i] ? `<em>+${L.a[i] * 2} %</em>` : ''}${pts > 0 ? `<span title="${ok ? `+2 % de ${LV_STATS[i].name.toLowerCase()} (1 punto)` : NOB}"><button class="kbp" data-lv="${i}" data-pv="lv:${i}"${ok ? '' : ' disabled'}>+</button></span>` : ''}</span>`; // + naranja: 1 punto = +2 % del valor base
  $('stats').innerHTML = [['Casco', st.hp, 200, '#5dff8a', 1], ['Escudo', st.sh, 180, '#4db8ff', 2], ['Plasma', st.plasma, 380, '#3fe6b0', 6], ['Misiles', st.missiles, 12, '#ffb347', -1], ['Velocidad (km/s)', st.vmax, 1200, '#ffd23f', 0], ['Maniobra', Math.round(st.agil * 100), 100, '#f5a8ff', 4], ['Barra luz (s)', st.warp, 180, '#b48cff', 7], ['Daño plasma', st.pdmg, 12, '#3fe6b0', 3], ['Recarga plasma', +(1 / st.regen).toFixed(2), 1, '#c8ff5d', 5, '/s']] // máximos de las barras: los del chasis −30 % con todas las mejoras
    .map(([n, v, max, c, li, u = '']) => `<span>${n}</span>${bar(v, max, c)}<b>${v}${u}</b>${lvCell(li)}`).join('');
  $('pvlv').innerHTML = `${hexSvg(L.lv, '#ffd23f', 38)}<div><b>Nv ${L.lv}</b><div class="xbar"><i style="width:${need ? Math.min(100, L.xp / need * 100) : 100}%"></i></div><small>${need ? `${L.xp}/${need} XP` : 'NIVEL MÁX.'}</small>${lvPts(L) > 0 ? `<em>${lvPts(L)} punto${lvPts(L) > 1 ? 's' : ''}</em>` : ''}</div>`; // nivel sobre la vista previa
  const key = JSON.stringify(shown); if (key !== PV.key) { PV.key = key; if (PV.obj) PV.pivot.remove(PV.obj); PV.obj = makeShip(shown); PV.obj.showShield = true; setThrust(PV.obj, 500, 0); updateShipFx(PV.obj, 0); PV.pivot.add(PV.obj); PV.cam.position.set(0.05, 0.032, 0.09); PV.cam.lookAt(0, 0, 0); }
}

// ---------- BASE: modelo centrado con sus estadísticas, estilos de torreta y mejoras ----------
function baseModel(ts, tw, shield) { // maqueta del hangar: EL MISMO modelo que el del juego (BASE.model, en km) escalado para que la plataforma mida radio 1, más la cúpula del escudo
  const g = new THREE.Group(), m = BASE.model(ts, tw, false, typeof mySpec !== 'undefined' ? mySpec.c : 0x4db8ff);
  m.scale.setScalar(1.15 / 0.055); m.position.y = 0.06; g.add(m); // la cara superior de la plataforma queda a y = 0.06 (igual que la maqueta anterior)
  if (shield) { const d = new THREE.Mesh(new THREE.SphereGeometry(1.25, 28, 18), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide })); d.position.y = 0.1; g.add(d); }
  return g;
}
function renderBase() {
  const h = typeof BASE !== 'undefined' ? BASE.mine() : null;
  if (!h) { for (const id of ['towerStyles', 'baseUp', 'bStats', 'slotsRow']) $(id).innerHTML = ''; $('baseUp').innerHTML = '<div class="empty">Aún no tienes base: elige un planeta de origen al iniciar la partida.</div>'; return; }
  const pk = pvs && pvs.startsWith('up:') ? pvs.slice(3) : null, s = pk ? baseStats({ ...h.up, [pk]: ((h.up && h.up[pk]) || 0) + 1 }) : h.st, pvStyle = pvs && pvs.startsWith('style:') ? pvs.slice(6) : null, avg = h.tw ? h.tw.reduce((x, y) => x + y, 0) / 4 : s.twMax; // s = estadísticas mostradas (con la mejora en vista previa)
  // estilos de torreta: compra y equipar
  $('towerStyles').innerHTML = Object.entries(TOWER_STYLES).map(([k, t]) => { const has = towersUnlocked.has(k), all = h.ts && h.ts.every(v => v === k);
    return `<div class="upc" data-pv="style:${k}">${ic('t_' + k)}<div><b>${t.name}${has ? '<span style="color:#5dff8a">✓</span>' : ''}</b><small>${(t.dmg * s.dmgMul).toFixed(1)} de daño · 1 disparo cada ${t.cd.toFixed(1)} s${t.homing ? ' · guiado' : ''}</small><div class="ctl">${has ? (all ? '<span class="max">EN LAS 4 TORRETAS</span>' : `<button class="up" data-equip="${k}"><b>EQUIPAR EN TODAS</b></button>`) : buyBtn(`data-buytw="${k}"`, t.cost)}</div></div></div>`; }).join('');
  // ranuras de las torretas: clic para cambiar de estilo entre los desbloqueados
  $('slotsRow').innerHTML = (h.ts || []).map((k, i) => `<button data-slot="${i}" class="${h.tw && h.tw[i] > 0 ? '' : 'dead'}">${ic('t_' + k)}${TOWER_STYLES[k].name.split(' ')[0]}</button>`).join('');
  $('bStats').innerHTML = `<div class="sgrid">${[['Vida', h.hp, s.hpMax, '#5dff8a'], ['Escudo', h.sh, s.shMax || 1, '#4db8ff'], ['Vida torretas', avg, s.twMax, '#ffb347']].map(([n, v, max, c]) => `<span>${n}</span>${bar(v, max, c)}<b>${n === 'Escudo' && !s.shMax ? '—' : Math.round(v) + '/' + Math.round(max)}</b>`).join('')}<span>Daño torretas</span>${bar(s.dmgMul, 2.6, '#ff8a3c')}<b>×${s.dmgMul.toFixed(1)}</b></div>`;
  const eff = { hp: () => `${h.st.hpMax} de vida`, sh: () => (h.st.shMax ? `${h.st.shMax} de escudo que absorbe las balas` : 'sin escudo'), tw: () => `${h.st.twMax} de vida por torreta`, td: () => `×${h.st.dmgMul.toFixed(1)} de daño de las torretas` };
  $('baseUp').innerHTML = Object.entries(BASE_UP).map(([k, u]) => { const lv = (h.up && h.up[k]) || 0, cost = lv < u.max ? u.cost(lv + 1) : null; return card(k, u.name, pips(lv, u.max), 'Ahora: ' + eff[k](), cost ? buyBtn(`data-base="${k}"`, cost) : '<span class="max">MÁXIMO</span>', lv < u.max ? 'up:' + k : ''); }).join('');
  const tsShown = pvStyle ? [pvStyle, pvStyle, pvStyle, pvStyle] : (h.ts || ['plasma', 'plasma', 'plasma', 'plasma']), key = JSON.stringify([tsShown, h.tw && h.tw.map(v => v > 0), s.shMax > 0]); if (key !== BV.key) { BV.key = key; if (BV.obj) BV.pivot.remove(BV.obj); BV.obj = baseModel(tsShown, h.tw || [1, 1, 1, 1], s.shMax > 0); BV.pivot.add(BV.obj); BV.cam.position.set(2.4, 1.6, 2.9); BV.cam.lookAt(0, 0.25, 0); }
}
function renderTools() {
  if (typeof TOOL_UP === 'undefined') return;
  $('toolUp').innerHTML = Object.entries(TOOL_UP).map(([k, u]) => { const lv = TOOLS[k], cost = lv < u.max ? u.cost(lv + 1) : null; return card(k, u.name, pips(lv, u.max), `Ahora: ${u.fx(lv)}${lv < u.max ? ' · siguiente: ' + u.fx(lv + 1) : ''}`, cost ? buyBtn(`data-tool="${k}"`, cost) : '<span class="max">MÁXIMO</span>'); }).join('');
}
const fitMenu = () => { if (ov.style.display !== 'none') fitBox($('hg'), 1100); };
addEventListener('resize', fitMenu);
function refresh() { $('hg').classList.toggle('nob', !atBase()); renderRes(); setTimeout(fitMenu, 0); if (tab === 'ship') renderShip(); else if (tab === 'base') renderBase(); else if (tab === 'tools') renderTools(); }
function setTab(t) { tab = t; document.querySelectorAll('#hg .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('#hg .tab').forEach(x => x.style.display = x.id === 'tab-' + t ? '' : 'none'); refresh(); }

document.addEventListener('mouseover', e => { // vista previa al pasar el ratón
  const el = e.target.closest && e.target.closest('#hg [data-pv]'), v = el && el.dataset.pv ? el.dataset.pv : null; if (v !== pvs) { pvs = v; refresh(); }
});
document.addEventListener('click', e => {
  const tb = e.target.closest('#hg .tabs button'), t = e.target.closest('#hg [data-t]'), eq = e.target.closest('[data-equip]'), sl = e.target.closest('[data-slot]'), lb = e.target.closest('#hg [data-lv]');
  if (tb) return setTab(tb.dataset.tab);
  if (lb) { // «+»: asigna un punto de nivel (+2 %) a esa característica de la nave actual
    if (!atBase()) return say(NOB); const L = lvlOf(mySpec.t), i = +lb.dataset.lv; if (lvPts(L) <= 0) return say('Sin puntos: sube de nivel derribando naves'); if (L.a[i] >= LV_PTMAX) return;
    L.a[i]++; saveLv(); pvs = null; sel.t = mySpec.t; sel.a = mySpec.a.slice(); applyNow(); return;
  }
  if (t) { const id = t.dataset.t; if (id === mySpec.t) return; if (!atBase()) return say(NOB + ': vuelve para cambiar de nave'); if (SHIP_COST[id] && !unlocked.has(id)) return say('Doble clic en la nave para desbloquearla'); sel.t = id; applyNow(); }
  else if (eq) { if (!atBase()) return say(NOB); const k = eq.dataset.equip; for (let i = 0; i < 4; i++) send({ t: 'bts', i, s: k }); }
  else if (sl) { if (!atBase()) return say(NOB); const h = BASE.mine(), i = +sl.dataset.slot; if (!h) return; const list = [...towersUnlocked], n = list[(list.indexOf(h.ts[i]) + 1) % list.length]; send({ t: 'bts', i, s: n }); }
});
document.addEventListener('dblclick', e => { // comprar: doble clic en la tarjeta completa
  const card = e.target.closest('#hg .upc, #hg .ship'); if (!card) return;
  if (!atBase()) return say(NOB); // fuera de la base el menú solo muestra las estadísticas
  if (card.dataset.t) { const id = card.dataset.t, cost = SHIP_COST[id]; if (cost && !unlocked.has(id)) { if (!canPay(cost)) return say('Faltan recursos'); if (!FOOT.spend(cost)) return; unlocked.add(id); saveSets(); sel.t = id; applyNow(); } return; }
  const b = card.querySelector('.buy'); if (!b) return;
  if (b.dataset.a !== undefined) { const i = +b.dataset.a, cost = upgradeCost(i, sel.a[i]); if (!canPay(cost)) return say('Faltan recursos'); if (FOOT.spend(cost)) { sel.a[i]++; applyNow(); } }
  else if (b.dataset.base) { const k = b.dataset.base, h = BASE.mine(); if (!h) return; const cost = BASE_UP[k].cost(((h.up && h.up[k]) || 0) + 1); if (!canPay(cost)) return say('Faltan recursos'); if (FOOT.spend(cost)) send({ t: 'bup', k }); }
  else if (b.dataset.buytw) { const k = b.dataset.buytw; if (!canPay(TOWER_STYLES[k].cost)) return say('Faltan recursos'); if (FOOT.spend(TOWER_STYLES[k].cost)) { towersUnlocked.add(k); saveSets(); refresh(); } }
  else if (b.dataset.tool) { if (FOOT.upTool(b.dataset.tool)) refresh(); }
});
$('go').onclick = () => {
  if (typeof BASE !== 'undefined' && !BASE.mine()) return BASE.choose(); // sin hangar: primero elige planeta
  renderer.domElement.requestPointerLock();
};
let sig = '', fitLast = '';
function hangarFrame(now) { // llamado desde el bucle principal mientras el menú está abierto
  const h = typeof BASE !== 'undefined' ? BASE.mine() : null, sg = JSON.stringify([typeof INV !== 'undefined' && INV, typeof TOOLS !== 'undefined' && TOOLS, h && [h.up, Math.round(h.hp), Math.round(h.sh), h.tw, h.ts], [...unlocked], [...towersUnlocked], mySpec.a, mySpec.t, lvlOf(mySpec.t), atBase(), tab]);
  if (fitLast !== ov.style.display + innerWidth + 'x' + innerHeight) { fitLast = ov.style.display + innerWidth + 'x' + innerHeight; fitMenu(); }
  if (sg !== sig) { sig = sg; sel.a = mySpec.a.slice(); sel.t = mySpec.t; refresh(); } // los recursos y la base cambian mientras juegas
  const P_ = tab === 'ship' ? PV : tab === 'base' ? BV : null;
  if (P_ && P_.obj) {
    P_.pivot.rotation.y = now / 2500; if (P_ === PV) { setThrust(PV.obj, 500, now); updateShipFx(PV.obj, now); }
    const cv = P_.r.domElement; P_.r.setSize(cv.clientWidth, cv.clientHeight, false); P_.cam.aspect = cv.clientWidth / cv.clientHeight; P_.cam.updateProjectionMatrix(); P_.r.render(P_.sc, P_.cam);
  }
}
setTab('ship');

// ---------- compra rápida (F): avisa cuando ya alcanzan los recursos para algo y lo compra sin abrir el menú ----------
const BUYS = () => {
  const out = [], h = typeof BASE !== 'undefined' ? BASE.mine() : null;
  ADDONS.forEach((a, i) => { const lv = mySpec.a[i]; if (lv < a.max) out.push({ key: `a${i}:${lv}`, ik: a.id, name: a.name, cost: upgradeCost(i, lv), go: () => { sel.a = mySpec.a.slice(); sel.t = mySpec.t; sel.a[i]++; applyNow(); } }); });
  Object.keys(TYPES).forEach(id => { const cost = SHIP_COST[id]; if (cost && !unlocked.has(id)) out.push({ key: 's' + id, ik: id, name: 'Nave ' + TYPES[id].name, cost, go: () => { unlocked.add(id); saveSets(); sel.a = mySpec.a.slice(); sel.t = id; applyNow(); } }); });
  Object.entries(TOWER_STYLES).forEach(([k, t]) => { if (t.cost && !towersUnlocked.has(k)) out.push({ key: 't' + k, ik: 't_' + k, name: 'Torreta: ' + t.name, cost: t.cost, go: () => { towersUnlocked.add(k); saveSets(); refresh(); } }); });
  if (h) Object.entries(BASE_UP).forEach(([k, u]) => { const lv = (h.up && h.up[k]) || 0; if (lv < u.max) out.push({ key: `b${k}:${lv}`, ik: k, name: 'Base: ' + u.name, cost: u.cost(lv + 1), go: () => send({ t: 'bup', k }) }); });
  return out;
};
let seen = null, sug = null; const nel = {};
setInterval(() => {
  if (typeof BASE === 'undefined' || !BASE.started() || BASE.loading()) return;
  const now = new Set(BUYS().filter(b => canPay(b.cost)).map(b => b.key)), first = seen === null;
  if (!first) for (const b of BUYS()) if (now.has(b.key) && !seen.has(b.key)) { sug = b.key; nel[b.key] = notifyEl(`${ic(b.ik)}<span>${atBase() ? `Ya puedes comprar<br><b>${b.name}</b> — pulsa <kbd>F</kbd>` : `Ya te alcanza para<br><b>${b.name}</b> — vuelve a tu base para comprar`}</span>`, 9000, 'buy'); }
  seen = now;
}, 700);
addEventListener('keydown', e => {
  if (e.code !== 'KeyF' || e.repeat || !document.pointerLockElement) return;
  if (!atBase()) return say('Vuelve a tu base para comprar');
  const all = BUYS().filter(b => canPay(b.cost)), b = all.find(x => x.key === sug) || all[0];
  if (!b) return say('Aún no te alcanzan los recursos');
  if (FOOT.spend(b.cost)) { b.go(); sug = null; const el = nel[b.key]; if (el && el.isConnected) { el.classList.add('done'); el.insertAdjacentHTML('beforeend', '<span class="ok">✔</span>'); setTimeout(() => el.classList.add('out'), 900); setTimeout(() => el.remove(), 1400); } }
});
