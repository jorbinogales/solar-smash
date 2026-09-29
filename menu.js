// Menú principal en una sola pantalla: sistema solar 3D inclinado (clic en un planeta para elegirlo, arrastra para girar), código y enlace de la sala,
// jugadores con foto de perfil (Blobatar), ajustes y botón de crear / unirse / iniciar. La carga de la partida empieza al iniciar: todos pasan a /game.
(() => {
  const box = document.getElementById('box'), cv = document.getElementById('stars'), g = cv.getContext('2d');
  const rnd = n => Math.floor(Math.random() * n), pick = a => a[rnd(a.length)], ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let token = null; try { token = sessionStorage.getItem('token'); if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('token', token); } } catch { token = Math.random().toString(36).slice(2); }
  const hk = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return h >>> 0; }, myHk = hk(token);
  const newSeed = () => 'p' + Math.random().toString(36).slice(2, 8);
  const autoName = () => `${pick(['Nebulosa', 'Cósmica', 'Estelar', 'Orbital', 'Galáctica', 'Lunar', 'Solar', 'Cuántica'])}-${pick(['Alfa', 'Kepler', 'Andrómeda', 'Orión', 'Vega', 'Sirio', 'Aurora', 'Titán'])}-${10 + rnd(90)}`;
  const COL = ['#4db8ff', '#ff6a3c', '#5dff8a', '#ffd23f', '#d06bff', '#f2f2f2', '#ff5fa2', '#3ff0e0'];
  const st = { name: ls.get('pname') || '', av: ls.get('avatar') || newSeed(), room: null, msg: '', np: 4, seed: 1 + rnd(2e9), rname: autoName(), copied: false, want: null, hover: null, cands: null, view: 'home', code: (new URLSearchParams(location.search).get('sala') || '').toUpperCase().slice(0, 8) };
  st.cands = [st.av, ...Array.from({ length: 5 }, newSeed)];
  const me = () => (st.room ? st.room.members.find(m => m.hk === myHk) : null), isHost = () => !!(me() && me().host);
  const cur = () => (st.room ? { seed: st.room.seed, np: st.room.np } : { seed: st.seed, np: st.np });
  let blob = null; import('/blobatar.js').then(m => { blob = m.blobatar; render(true); }).catch(() => {});
  const avSvg = a => (blob && a ? blob(a, { background: 'circle' }) : '');

  // ---------- fondo de estrellas ----------
  const stars = Array.from({ length: 420 }, () => ({ x: Math.random(), y: Math.random(), z: 0.15 + Math.random() * 0.85, p: Math.random() * 6.28, c: pick(['#ffffff', '#cfe6ff', '#ffe9c4', '#b7d4ff']) })), sh = { t: 0, x: 0, y: 0, vx: 0, vy: 0 };
  function resize() { cv.width = innerWidth; cv.height = innerHeight; } addEventListener('resize', resize); resize();
  function drawStars(t) {
    const W = cv.width, H = cv.height; g.fillStyle = '#010308'; g.fillRect(0, 0, W, H);
    for (const [x, y, r, c] of [[0.2, 0.25, 0.55, '40,90,180'], [0.82, 0.7, 0.5, '120,50,160'], [0.6, 0.15, 0.35, '30,120,140']]) { const gr = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r); gr.addColorStop(0, `rgba(${c},0.22)`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(0, 0, W, H); } // nebulosas
    for (const s of stars) { const x = ((s.x * W - t * 0.004 * s.z * 6) % W + W) % W, y = s.y * H, a = 0.45 + 0.55 * Math.sin(t * 0.0015 * s.z + s.p); g.globalAlpha = Math.max(0.1, a * s.z); g.fillStyle = s.c; const r = 0.4 + s.z * 1.5; g.fillRect(x, y, r, r); }
    g.globalAlpha = 1;
    if (!sh.t && Math.random() < 0.004) Object.assign(sh, { t: 1, x: Math.random() * W, y: Math.random() * H * 0.5, vx: 9 + Math.random() * 6, vy: 3 + Math.random() * 3 }); // estrella fugaz
    if (sh.t) { sh.x += sh.vx; sh.y += sh.vy; sh.t += 0.03; const gr = g.createLinearGradient(sh.x, sh.y, sh.x - sh.vx * 8, sh.y - sh.vy * 8); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(sh.x, sh.y); g.lineTo(sh.x - sh.vx * 8, sh.y - sh.vy * 8); g.stroke(); if (sh.t > 2.2 || sh.x > W + 50) sh.t = 0; }
  }

  // ---------- sistema solar 3D inclinado (proyección propia sobre canvas 2D: sin librerías ni memoria extra) ----------
  const cache = {}, sysOf = (seed, np) => cache[seed + ':' + np] || (cache[seed + ':' + np] = genSystem(seed, np)), imgs = {};
  const imgOf = a => { if (!a || !blob) return null; let im = imgs[a]; if (!im) { im = imgs[a] = new Image(); im.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(avSvg(a).replace('<svg ', '<svg width="96" height="96" ')); } return im.complete && im.naturalWidth ? im : null; };
  const V = { yaw: 0.5, tilt: 1.1, drag: null }, hit = []; window.MENU_HIT = hit; // tilt: 0 = vista desde arriba, π/2 = de canto
  const planetsOf = sys => sys.bodies.filter(b => b.k !== 'sun' && !b.parent);
  function drawSystem(c, sys, t) {
    const w = c.width = c.clientWidth * 1.5, h = c.height = c.clientHeight * 1.5, x = c.getContext('2d'), cx = w / 2, cy = h * 0.52, S = Math.min(w * 0.4, h * 0.85), cyw = Math.cos(V.yaw), syw = Math.sin(V.yaw), ct = Math.cos(V.tilt), stl = Math.sin(V.tilt);
    const pr = (px, py, pz) => { const x1 = px * cyw - pz * syw, z1 = px * syw + pz * cyw, dep = z1 * stl + py * ct, f = 1 / (1 - dep * 0.35); return { x: cx + x1 * S * f, y: cy + (z1 * ct - py * stl) * S * f, f, dep }; };
    const pls = planetsOf(sys), amin = Math.min(...pls.map(p => p.a)), amax = Math.max(...pls.map(p => p.a)), Rmax = Math.max(...pls.map(p => p.R)), mine = me() ? me().pick : st.want;
    const owner = {}; if (st.room) st.room.members.forEach((m, i) => { if (m.pick) owner[m.pick] = { m, i }; }); else if (st.want) owner[st.want] = { m: { nm: st.name || 'Tú', av: st.av, hk: myHk }, i: 0 };
    x.clearRect(0, 0, w, h); x.lineJoin = 'round'; x.lineCap = 'round';
    const items = [];
    pls.forEach((p, i) => {
      const rr = 0.2 + 0.8 * Math.sqrt((p.a - amin) / (amax - amin + 1e-9)), ang = p.ph + t * 0.00018 / (0.7 + i * 0.45);
      x.strokeStyle = 'rgba(170,215,255,0.3)'; x.lineWidth = 2; x.setLineDash([2, 9]); x.beginPath(); for (let k = 0; k <= 90; k++) { const a = k / 90 * 6.2832, q = pr(Math.cos(a) * rr, 0, Math.sin(a) * rr); k ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); } x.stroke(); x.setLineDash([]);
      const q = pr(Math.cos(ang) * rr, 0, Math.sin(ang) * rr); items.push({ p, q, r: (0.028 + 0.035 * Math.sqrt(p.R / Rmax)) * S * q.f, ang, rr, i });
    });
    items.push({ sun: true, q: pr(0, 0, 0), r: 0.075 * S, dep: 0 });
    items.sort((a, b) => a.q.dep - b.q.dep); hit.length = 0;
    for (const it of items) {
      const { q, r } = it;
      if (it.sun) {
        const gl = x.createRadialGradient(q.x, q.y, r * 0.5, q.x, q.y, r * 3); gl.addColorStop(0, 'rgba(255,200,90,.55)'); gl.addColorStop(1, 'rgba(255,140,40,0)'); x.fillStyle = gl; x.beginPath(); x.arc(q.x, q.y, r * 3, 0, 7); x.fill();
        for (let k = 0; k < 12; k++) { const a = k / 12 * 6.2832 + t * 0.0004, l = r * (k % 2 ? 1.45 : 1.7); x.strokeStyle = '#ffd86a'; x.lineWidth = 4; x.beginPath(); x.moveTo(q.x + Math.cos(a) * r * 1.15, q.y + Math.sin(a) * r * 1.15 * 0.8); x.lineTo(q.x + Math.cos(a) * l, q.y + Math.sin(a) * l * 0.8); x.stroke(); }
        const sg = x.createRadialGradient(q.x - r * 0.3, q.y - r * 0.3, r * 0.1, q.x, q.y, r); sg.addColorStop(0, '#fff6c8'); sg.addColorStop(1, sys.star.c1); x.fillStyle = sg; x.strokeStyle = '#050f1c'; x.lineWidth = 4; x.beginPath(); x.arc(q.x, q.y, r, 0, 7); x.fill(); x.stroke(); continue;
      }
      const p = it.p, ow = owner[p.n], hov = st.hover === p.n, fill = () => { const gr = x.createRadialGradient(q.x - r * 0.35, q.y - r * 0.4, r * 0.1, q.x, q.y, r * 1.05); gr.addColorStop(0, p.c2); gr.addColorStop(1, p.c1); x.fillStyle = gr; x.beginPath(); x.arc(q.x, q.y, r, 0, 7); x.fill(); x.strokeStyle = '#050f1c'; x.lineWidth = 3.5; x.stroke(); };
      const ring = p.k === 'gas'; if (ring) { x.strokeStyle = '#050f1c'; x.lineWidth = r * 0.36; x.beginPath(); x.ellipse(q.x, q.y, r * 1.9, Math.max(2, r * 1.9 * Math.abs(ct)), -0.25, Math.PI, 6.2832); x.stroke(); x.strokeStyle = '#e8d2a0'; x.lineWidth = r * 0.22; x.beginPath(); x.ellipse(q.x, q.y, r * 1.9, Math.max(2, r * 1.9 * Math.abs(ct)), -0.25, Math.PI, 6.2832); x.stroke(); }
      fill(); x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.ellipse(q.x - r * 0.35, q.y - r * 0.4, r * 0.28, r * 0.16, -0.7, 0, 7); x.fill();
      if (ring) { x.strokeStyle = '#050f1c'; x.lineWidth = r * 0.36; x.beginPath(); x.ellipse(q.x, q.y, r * 1.9, Math.max(2, r * 1.9 * Math.abs(ct)), -0.25, 0, Math.PI); x.stroke(); x.strokeStyle = '#e8d2a0'; x.lineWidth = r * 0.22; x.beginPath(); x.ellipse(q.x, q.y, r * 1.9, Math.max(2, r * 1.9 * Math.abs(ct)), -0.25, 0, Math.PI); x.stroke(); }
      sys.bodies.filter(m => m.parent === p.n).forEach((m, k) => { const ma = t * 0.0011 / (1 + k) + k * 2.4, d = r * (1.7 + k * 0.6), mq = pr(Math.cos(it.ang) * it.rr + Math.cos(ma) * d / S / q.f, 0, Math.sin(it.ang) * it.rr + Math.sin(ma) * d / S / q.f); x.fillStyle = '#c9ccd2'; x.strokeStyle = '#050f1c'; x.lineWidth = 2.5; x.beginPath(); x.arc(mq.x, mq.y, Math.max(3, r * 0.22), 0, 7); x.fill(); x.stroke(); });
      if (hov || ow) { x.strokeStyle = ow ? COL[ow.i % 8] : '#fff'; x.lineWidth = 4; x.setLineDash([8, 6]); x.lineDashOffset = -t * 0.02; x.beginPath(); x.arc(q.x, q.y, r + 9, 0, 7); x.stroke(); x.setLineDash([]); }
      x.font = `900 ${Math.round(h * 0.03)}px ui-rounded,"Trebuchet MS",sans-serif`; x.textAlign = 'center'; x.lineWidth = 5; x.strokeStyle = '#050f1c'; x.fillStyle = '#fff'; x.strokeText(p.n, q.x, q.y + r + h * 0.04); x.fillText(p.n, q.x, q.y + r + h * 0.04);
      if (ow) { // foto de perfil del jugador que eligió este planeta, en una chincheta sobre él
        const by = q.y - r - 30, im = imgOf(ow.m.av); x.fillStyle = COL[ow.i % 8]; x.strokeStyle = '#050f1c'; x.lineWidth = 4; x.beginPath(); x.moveTo(q.x - 8, by + 24); x.lineTo(q.x, q.y - r - 2); x.lineTo(q.x + 8, by + 24); x.closePath(); x.fill(); x.stroke();
        x.beginPath(); x.arc(q.x, by, 27, 0, 7); x.fill(); x.stroke(); if (im) { x.save(); x.beginPath(); x.arc(q.x, by, 22, 0, 7); x.clip(); x.drawImage(im, q.x - 22, by - 22, 44, 44); x.restore(); }
        x.font = `900 ${Math.round(h * 0.024)}px ui-rounded,"Trebuchet MS",sans-serif`; x.lineWidth = 4; x.strokeStyle = '#050f1c'; x.fillStyle = '#fff'; x.strokeText(ow.m.nm || '', q.x, by - 33); x.fillText(ow.m.nm || '', q.x, by - 33);
      }
      hit.push({ n: p.n, x: q.x, y: q.y, r: Math.max(r + 8, 18), p });
    }
    if (st.hover) { const p = hit.find(k => k.n === st.hover); if (p) { const b = p.p, tx = `${b.label || ''} · radio ${Math.round(b.R).toLocaleString('es')} km`; x.font = `800 ${Math.round(h * 0.024)}px ui-rounded,"Trebuchet MS",sans-serif`; const tw = x.measureText(tx).width + 24, bx = Math.min(w - tw - 8, Math.max(8, p.x - tw / 2)), by = Math.max(8, p.y - p.r - 78); x.fillStyle = '#0d2338'; x.strokeStyle = '#050f1c'; x.lineWidth = 4; x.beginPath(); x.roundRect(bx, by, tw, 34, 10); x.fill(); x.stroke(); x.fillStyle = '#e6f6ff'; x.textAlign = 'left'; x.fillText(tx, bx + 12, by + 23); } }
  }

  // ---------- red ----------
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host), send = o => (ws.readyState === 1 ? ws.send(JSON.stringify(o)) : ws.addEventListener('open', () => ws.send(JSON.stringify(o)), { once: true }));
  ws.onopen = () => send({ t: 'hi', token });
  ws.onclose = () => { st.msg = 'Conexión perdida con el servidor.'; render(true); };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id) { render(); return; }
    if (m.created === 1) { st.msg = ''; if (st.want) send({ t: 'pick', b: st.want }); st.want = null; history.replaceState(null, '', '?sala=' + m.code); return; }
    if (m.created === 0) { st.msg = m.why || 'No se pudo crear la sala.'; render(true); return; }
    if (m.joined === 1) { st.msg = ''; st.want = null; return; }
    if (m.joined === 0) { st.msg = m.why || 'No se pudo entrar.'; render(true); return; }
    if (m.go) { if (!me()) return; ls.set('pname', st.name); location.href = '/game'; return; }
    if (m.rm !== undefined) { const had = st.room; st.room = m.rm; if (!st.room) { if (had) { st.view = 'home'; st.msg = 'La sala se cerró.'; history.replaceState(null, '', '/'); } } else if (st.room.phase !== 'lobby' && me()) { ls.set('pname', st.name); location.href = '/game'; return; } render(); }
  };

  // ---------- pantalla única ----------
  const esc = s => String(s).replace(/[<>&"]/g, '');
  let sig = '';
  function render(force) {
    const r = st.room, s = [st.view, st.code, st.msg, st.copied, st.np, st.seed, st.rname, st.want, st.av, st.cands.join(), !!blob, r && JSON.stringify(r)].join('|'); if (!force && s === sig) return; sig = s;
    const nmEl = box.querySelector('#nm'), rnEl = box.querySelector('#rn'); if (nmEl) st.name = nmEl.value; if (rnEl && !r) st.rname = rnEl.value;
    const focus = document.activeElement && document.activeElement.id; box.innerHTML = html();
    if (focus) { const el = box.querySelector('#' + focus); if (el) { el.focus(); if (el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
    fit();
  }
  const slot = (m, i) => m ? `<div class="slot${m.hk === myHk ? ' me' : ''}"><div class="av">${avSvg(m.av)}</div><div class="in"><div class="nm">${m.host ? '★ ' : ''}${esc(m.nm)}</div><small>${m.pick ? `<span class="dot" style="background:${COL[i % 8]}"></span>${esc(m.pick)}` : 'sin planeta'}</small></div></div>` : `<div class="slot empty"><div class="av">+</div><div class="in"><div class="nm">esperando…</div></div></div>`;
  const profile = () => `<div class="card"><h3>TU PERFIL</h3><div class="prof"><div class="av big">${avSvg(st.av)}</div><div class="grow"><input type="text" id="nm" maxlength="16" placeholder="Tu nombre" value="${esc(st.name)}"></div></div>
          <div class="cands">${st.cands.map(a => `<div class="av${a === st.av ? ' on' : ''}" data-av="${a}">${avSvg(a)}</div>`).join('')}<button class="btn ghost sm" id="reav" title="Más fotos" style="margin-left:auto">🎲</button></div></div>`;
  function homeHtml() { // portada: crear una sala o entrar a una con su código de invitación (no se listan las salas de otros)
    return `<div style="max-width:760px;margin:0 auto"><div class="hdr" style="justify-content:center"><div class="logo" style="font-size:34px;text-align:center">SISTEMA SOLAR<small>PROCEDURAL</small></div></div>
      ${profile()}
      <div class="opts"><div class="card opt"><h3>NUEVA PARTIDA</h3><p>Crea tu sala, elige cuántos planetas tendrá el sistema y comparte el código.</p><button class="btn go" id="toSetup">CREAR SALA</button></div>
        <div class="card opt"><h3>TENGO UN CÓDIGO</h3><p>Escribe el código de invitación que te pasó el anfitrión.</p><input type="text" id="code" maxlength="8" placeholder="CÓDIGO" value="${esc(st.code)}" style="text-align:center;letter-spacing:.3em;font-size:20px;text-transform:uppercase"><button class="btn green" id="joinCode" style="width:100%;margin-top:10px;font-size:17px;padding:11px">ENTRAR A LA SALA</button></div></div>
      <div class="err" style="font-size:15px;margin-top:14px">${esc(st.msg)}</div></div>`;
  }
  const html = () => (st.room && me() ? roomHtml() : st.view === 'setup' ? roomHtml() : homeHtml());
  function roomHtml() {
    const r = st.room, host = isHost(), mem = me(), { np } = cur(), link = r ? `${location.origin}/?sala=${r.code}` : '';
    const members = r ? r.members : [{ nm: st.name || 'Tú', av: st.av, hk: myHk, host: true, pick: st.want }];
    const slots = Array.from({ length: np }, (_, i) => slot(members[i], i)).join('');
    const canCfg = !r || host, chosen = mem ? mem.pick : st.want;
    let action;
    if (!r) action = '<button class="btn go" id="create">CREAR SALA</button>';
    else if (host) action = '<button class="btn go" id="start">INICIAR PARTIDA</button>';
    else action = '<div class="wait">Esperando a que el anfitrión inicie la partida…</div>';
    return `<div class="hdr"><div class="logo">SISTEMA SOLAR<small>PROCEDURAL</small></div>
      <div class="grow"></div>
      <button class="btn ghost sm" id="${r ? 'leave' : 'toHome'}">${r ? 'SALIR' : '← VOLVER'}</button>
      <div class="code">CÓDIGO<b>${r ? r.code : '·····'}</b></div>
      <button class="btn sm" id="copy" ${r ? '' : 'disabled'}>${st.copied ? '¡COPIADO!' : 'COMPARTIR'}</button></div>
    <div class="main"><div class="left card" style="padding:10px"><canvas id="pv"></canvas><div class="cap">Haz clic en un planeta para elegirlo · arrastra para girar el sistema${chosen ? ' · clic de nuevo para soltarlo' : ''}</div></div>
      <div class="right">
        ${r ? `<div class="card"><h3><span>JUGADORES ${members.length}/${np}</span></h3><div class="slots">${slots}</div></div>` : ''}
        ${profile()}
        <div class="card"><h3>SISTEMA</h3>${!r ? `<div class="row"><div class="stepper"><button class="btn ghost sm" id="npm">−</button><b>${np}</b><button class="btn ghost sm" id="npp">+</button><span style="color:var(--dim)">planetas = jugadores</span></div><button class="btn ghost sm" id="reroll">🎲 OTRO</button></div>` : `<div class="wait" style="padding:4px">Sistema de ${np} planetas</div>`}
          ${host ? `<label class="chk"><input type="checkbox" id="fb" ${r.fillBots ? 'checked' : ''}> Rellenar los planetas libres con bots IA</label>` : !r ? '<label class="chk"><input type="checkbox" checked disabled> Rellenar los planetas libres con bots IA</label>' : `<div class="wait" style="padding:4px">Bots ${r.fillBots ? 'activados' : 'desactivados'}</div>`}</div>
        ${action}<div class="err">${esc(st.msg)}</div></div></div>`;
  }

  // ---------- eventos ----------
  box.addEventListener('input', e => { if (e.target.id === 'code') st.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (e.target.id === 'nm') { st.name = e.target.value; if (me()) send({ t: 'pf', nm: st.name }); ls.set('pname', st.name); } if (e.target.id === 'rn') st.rname = e.target.value; });
  box.addEventListener('change', e => { if (e.target.id === 'fb' && st.room) send({ t: 'cfg', np: st.room.np, fillBots: e.target.checked }); });
  const setAv = a => { st.av = a; ls.set('avatar', a); if (me()) send({ t: 'pf', av: a }); render(true); };
  const nick = () => (st.name || 'Piloto').slice(0, 16);
  const pickPlanet = n => {
    if (st.room) { if (!me()) { st.msg = 'Únete a la sala para elegir un planeta.'; return render(true); } const o = st.room.members.find(m => m.pick === n && m.hk !== myHk); if (o) { st.msg = `${o.nm} ya eligió ${n}.`; return render(true); } st.msg = ''; send({ t: 'pick', b: n }); }
    else { st.want = st.want === n ? null : n; render(true); }
  };
  box.addEventListener('click', e => {
    const av = e.target.closest('[data-av]'); if (av) return setAv(av.dataset.av);
    const id = e.target.closest('[id]') && e.target.closest('[id]').id, np = cur().np;
    if (id === 'reav') { st.cands = [st.av, ...Array.from({ length: 5 }, newSeed)]; render(true); }
    else if (id === 'rname') { st.rname = autoName(); render(true); }
    else if (id === 'npm' || id === 'npp') { const n = Math.max(2, Math.min(8, np + (id === 'npp' ? 1 : -1))); if (st.room) send({ t: 'cfg', np: n, seed: st.room.seed }); else { st.np = n; st.want = null; render(true); } }
    else if (id === 'reroll') { if (st.room) send({ t: 'cfg', np: st.room.np, seed: 1 + rnd(2e9) }); else { st.seed = 1 + rnd(2e9); st.want = null; render(true); } }
    else if (id === 'create') send({ t: 'create', token, nm: nick(), av: st.av, np: st.np, seed: st.seed, name: st.rname });
    else if (id === 'toSetup') { st.view = 'setup'; st.msg = ''; st.seed = 1 + rnd(2e9); render(true); }
    else if (id === 'toHome') { st.view = 'home'; st.want = null; st.msg = ''; render(true); }
    else if (id === 'joinCode') { if (!st.code) { st.msg = 'Escribe el código de la sala.'; render(true); } else send({ t: 'join', token, nm: nick(), av: st.av, code: st.code }); }
    else if (id === 'leave') { send({ t: 'leave' }); st.room = null; st.view = 'home'; st.want = null; st.msg = ''; history.replaceState(null, '', '/'); render(true); }
    else if (id === 'start') send({ t: 'start' });
    else if (id === 'copy' && st.room) { const link = `${location.origin}/?sala=${st.room.code}`, done = () => { st.copied = true; render(true); setTimeout(() => { st.copied = false; render(true); }, 1800); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, done); else done(); }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'code') { e.preventDefault(); const b = box.querySelector('#joinCode'); if (b) b.click(); } });
  // arrastrar el sistema para girarlo; un clic sin arrastre elige planeta
  const canvasPt = e => { const c = box.querySelector('#pv'), b = c.getBoundingClientRect(); return { x: (e.clientX - b.left) * c.width / b.width, y: (e.clientY - b.top) * c.height / b.height }; };
  const planetAt = e => { const q = canvasPt(e); let best = null; for (const k of hit) if (Math.hypot(q.x - k.x, q.y - k.y) < k.r) best = k; return best; };
  box.addEventListener('pointerdown', e => { if (e.target.id !== 'pv') return; V.drag = { x: e.clientX, y: e.clientY, yaw: V.yaw, tilt: V.tilt, moved: false }; e.target.classList.add('drag'); });
  addEventListener('pointermove', e => {
    if (V.drag) { const dx = e.clientX - V.drag.x, dy = e.clientY - V.drag.y; if (Math.abs(dx) + Math.abs(dy) > 5) V.drag.moved = true; if (V.drag.moved) { V.yaw = V.drag.yaw + dx * 0.008; V.tilt = Math.max(0.15, Math.min(1.5, V.drag.tilt + dy * 0.006)); } return; }
    if (e.target.id === 'pv') { const p = planetAt(e); st.hover = p ? p.n : null; e.target.style.cursor = p ? 'pointer' : ''; } else st.hover = null;
  });
  addEventListener('pointerup', e => { const d = V.drag; V.drag = null; const c = box.querySelector('#pv'); if (c) c.classList.remove('drag'); if (d && !d.moved && e.target.id === 'pv') { const p = planetAt(e); if (p) pickPlanet(p.n); } });

  // ---------- ajuste a pantalla (100 % de la ventana, sin scroll) ----------
  function fit() { box.style.zoom = 1; const h = box.offsetHeight || 1, s = Math.max(0.35, Math.min(innerHeight / (h + 40), innerWidth / (1080 + 30), 1.4)); box.style.zoom = s; }
  addEventListener('resize', fit);
  (function loop(t) { drawStars(t); const c = box.querySelector('#pv'); if (c) { const { seed, np } = cur(); drawSystem(c, sysOf(seed, np), t); } requestAnimationFrame(loop); })(0);
  // ---------- instalación: botón de instalar la app (PWA) y descarga del ejecutable de escritorio ----------
  const inst = document.getElementById('inst'); let deferred = null; const RELEASE = 'https://github.com/jorbinogales/solar-smash/releases/latest';
  const paintInst = () => { inst.innerHTML = (deferred ? '<button class="btn green sm" id="pwa">⬇ INSTALAR APP</button>' : '') + `<a class="btn ghost sm" href="${RELEASE}" target="_blank" rel="noopener">DESCARGAR PARA WINDOWS</a>`; const b = document.getElementById('pwa'); if (b) b.onclick = async () => { deferred.prompt(); await deferred.userChoice; deferred = null; paintInst(); }; };
  if (!(window.electron || /Electron/.test(navigator.userAgent))) paintInst(); // dentro de la app de escritorio no hace falta
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; paintInst(); });
  addEventListener('appinstalled', () => { deferred = null; paintInst(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render(true);
})();
