// Motor de sonido (WebAudio, sin archivos): mezcla con volumen maestro y compresor, AUDIO ESPACIAL con radio audible finito por tipo y efectos sintetizados realistas.
// Todo sonido con origen en el mundo pasa por AUDIO.sfx(kind, pos): fuera de su radio (AUDIO_KM) NO se crea ningún nodo; dentro, atenuación inversa/cuadrática, paso bajo que
// baja con la distancia (lo lejano suena apagado), retardo de propagación (topado), panorama estéreo según la cámara y máximo de voces por categoría (ganan las más cercanas).
// pos: null/undefined = mío o de interfaz (siempre al 100 %) · [x, y, z] = punto del mundo (km) · número = distancia (compatibilidad, sin dirección). Usa S y camera de game.js.
const AUDIO_KM = { plasma: 250, misil: 400, torreta: 300, buqueDisparo: 2500, satDisparo: 2000, impacto: 150, escudo: 150, explosionNave: 1500, explosionGrande: 6000, warpSalida: 20000, warpEntrada: 20000, alarmaBuque: 5000 }; // radio audible (km) de cada sonido del mundo
const AUDIO = (() => {
  const CAT = { plasma: 'disparo', misil: 'disparo', torreta: 'disparo', buqueDisparo: 'disparo', satDisparo: 'disparo', impacto: 'impacto', escudo: 'impacto', explosionNave: 'explosion', explosionGrande: 'explosion', warpSalida: 'warp', warpEntrada: 'warp', alarmaBuque: 'alarma' };
  const MAXV = { disparo: 10, impacto: 6, explosion: 4, warp: 4, alarma: 2, mio: 16 }, ALIAS = { p: 'plasma', m: 'misil', boom: 'explosionNave', hit: 'impacto', shield: 'escudo', warp: 'warpEntrada', warpEnd: 'warpSalida' };
  const SOUND_KMS = 100, MAX_DELAY = 1.5, VOL = 0.9; // velocidad ficticia del «sonido» (km/s) para el retardo, con tope · volumen maestro
  let A = null, M = null, NZ = null, PK = null, REV = null, SAT = null; const act = {};
  function ctx() { // contexto, maestro (ganancia → compresor → salida), ruido blanco y rosa, reverberación corta y curva de saturación: se crean UNA vez
    if (!A) {
      A = new (window.AudioContext || window.webkitAudioContext)(); const C = A.createDynamicsCompressor(); C.threshold.value = -16; C.knee.value = 12; C.ratio.value = 5; C.attack.value = 0.004; C.release.value = 0.22;
      M = A.createGain(); M.gain.value = VOL; M.connect(C).connect(A.destination);
      const n = A.sampleRate * 2; NZ = A.createBuffer(1, n, A.sampleRate); PK = A.createBuffer(1, n, A.sampleRate); const w = NZ.getChannelData(0), p = PK.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) { const x = Math.random() * 2 - 1; w[i] = x; b0 = 0.997 * b0 + 0.029 * x; b1 = 0.985 * b1 + 0.032 * x; b2 = 0.95 * b2 + 0.048 * x; p[i] = (b0 + b1 + b2 + x * 0.1) * 2.2; } // ruido rosa (filtro de Voss simplificado)
      REV = A.createConvolver(); const rn = Math.floor(A.sampleRate * 1.6), rb = A.createBuffer(2, rn, A.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = rb.getChannelData(ch); for (let i = 0; i < rn; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rn, 3); } REV.buffer = rb; REV.connect(M);
      SAT = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; SAT[i] = Math.tanh(2.4 * x) / Math.tanh(2.4); }
    }
    if (A.state === 'suspended') A.resume(); return A;
  }
  // ---------- piezas de síntesis (todas se programan en el instante t y se conectan a `out`) ----------
  const src = (buf, t, dur) => { const s = A.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05); return s; };
  const flt = (type, f, q = 0.7) => { const b = A.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const env = (g, t, peak, att, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec); return g; };
  function nburst(out, t, dur, peak, type, f0, f1, q, buf = NZ, att = 0.004) { const s = src(buf, t, dur), f = flt(type, f0, q), g = A.createGain(); if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur); s.connect(f).connect(env(g, t, peak, att, dur)).connect(out); }
  function osc(out, t, type, f0, f1, dur, peak, att = 0.005, sat = false, sweep = dur) { const o = A.createOscillator(), g = A.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sweep); let n = o; if (sat) { const w = A.createWaveShaper(); w.curve = SAT; n = o.connect(w); } n.connect(env(g, t, peak, att, dur)).connect(out); o.start(t); o.stop(t + att + dur + 0.05); }
  function echo(out, t, time, fb, lp, dur) { const d = A.createDelay(1), g = A.createGain(), f = flt('lowpass', lp); d.delayTime.value = time; g.gain.value = fb; out.connect(d); d.connect(f).connect(g).connect(d); const o = A.createGain(); o.gain.value = 0.8; f.connect(o).connect(M); setTimeout(() => { try { out.disconnect(d); } catch (e) {} }, (dur + 3) * 1000); }
  // ---------- voz espacial ----------
  function voice(kind, pos, o = {}) { // → { t, out, x (0 cerca · 1 al borde del radio), mine } o null si no se oye
    if (!A) return null; const mine = pos == null || o.mine; let d = 0, pan = 0;
    if (!mine) {
      if (typeof pos === 'number') d = pos; else { const r = [pos[0] - S.pos[0], pos[1] - S.pos[1], pos[2] - S.pos[2]]; d = Math.hypot(r[0], r[1], r[2]); if (d > 1e-3 && typeof camera !== 'undefined') { const q = camera.quaternion, rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y); pan = Math.max(-1, Math.min(1, (r[0] * rx + r[1] * ry + r[2] * rz) / d)) * 0.85; } } // lado según el eje derecho de la cámara
      if (!(d <= (AUDIO_KM[kind] || 300))) return null; // fuera del radio: no se crea nada
    }
    const x = mine ? 0 : d / (AUDIO_KM[kind] || 300), cat = mine ? 'mio' : CAT[kind] || 'impacto', L = act[cat] || (act[cat] = []), now = A.currentTime;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].end < now) L.splice(i, 1);
    if (L.length >= (MAXV[cat] || 6)) { let far = 0; for (let i = 1; i < L.length; i++) if (L[i].d > L[far].d) far = i; if (L[far].d <= d) return null; L[far].g.gain.cancelScheduledValues(now); L[far].g.gain.setTargetAtTime(0, now, 0.02); L.splice(far, 1); } // prioridad: la más cercana gana
    const g = A.createGain(), lp = flt('lowpass', mine ? 18000 : 250 + 17000 * (1 - x) * (1 - x)), pn = A.createStereoPanner ? A.createStereoPanner() : null, rv = A.createGain();
    g.gain.value = (o.vol || 1) * (mine ? 1 : (1 - x) * (1 - x) / (1 + 6 * x)); rv.gain.value = 0.12 + 0.45 * x + (o.rev || 0); // curva inversa/cuadrática · más reverberación lejos
    if (pn) { pn.pan.value = pan; g.connect(lp).connect(pn).connect(M); } else g.connect(lp).connect(M); lp.connect(rv).connect(REV);
    const t = now + 0.005 + (mine ? 0 : Math.min(MAX_DELAY, d / SOUND_KMS)); L.push({ d, g, end: t + (o.dur || 2) }); return { t, out: g, x, mine, d };
  }
  // ---------- efectos ----------
  const FX = {
    plasma(v) { const { t, out } = v; nburst(out, t, 0.007, 0.5, 'highpass', 4200); osc(out, t, 'square', 2400, 260, 0.13, 0.12); osc(out, t, 'sine', 190, 70, 0.14, 0.32); nburst(out, t, 0.09, 0.08, 'bandpass', 3000, 700, 2); }, // zap: transitorio, barrido descendente y cuerpo grave
    misil(v) { const { t, out } = v; nburst(out, t, 0.01, 0.4, 'highpass', 2500); nburst(out, t, 0.9, 0.3, 'bandpass', 600, 2800, 1.2, PK, 0.08); osc(out, t, 'sawtooth', 62, 55, 1.2, 0.12, 0.05); osc(out, t, 'sawtooth', 64.5, 56, 1.2, 0.1, 0.05); }, // encendido: silbido/whoosh y ronroneo
    cannon(v, big) { const { t, out } = v, k = big ? 1.6 : 1; nburst(out, t, 0.45 * k, 0.8, 'lowpass', 3500, 240, 0.7, PK, 0.004); osc(out, t, 'sine', 85 / k, 36, 0.5 * k, 0.9, 0.004, true); nburst(out, t, 0.012, 0.5, 'highpass', 2000); echo(out, t, big ? 0.22 : 0.16, 0.3, 1200, 1.2 * k); }, // estampido con eco
    torreta(v) { FX.cannon(v, false); }, buqueDisparo(v) { FX.cannon(v, true); }, satDisparo(v) { FX.misil(v); FX.cannon(v, false); },
    impacto(v) { const { t, out } = v; nburst(out, t, 0.01, 0.6, 'bandpass', 2500, 2500, 1); for (const f of [900, 1630, 2470]) osc(out, t, 'sine', f * (0.9 + 0.2 * Math.random()), f * 0.97, 0.12 + 0.1 * Math.random(), 0.1, 0.002); nburst(out, t, 0.18, 0.12, 'lowpass', 1500, 300); }, // chispazo en otro objeto
    escudo(v) { const { t, out } = v, bp = flt('bandpass', 900, 4), trem = A.createOscillator(), tg = A.createGain(), g = A.createGain(); trem.frequency.value = 32; tg.gain.value = 0.5; trem.connect(tg).connect(g.gain); bp.connect(env(g, t, 0.35, 0.01, 0.34)).connect(out); trem.start(t); trem.stop(t + 0.4); for (const f of [118, 181]) { const o = A.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(bp); o.start(t); o.stop(t + 0.4); } nburst(out, t, 0.06, 0.15, 'highpass', 6000); }, // zumbido eléctrico
    explosion(v, size) { // estallido (barrido descendente) + golpe sub + crepitar de escombros + cola; lejos solo queda el retumbo grave
      const { t, out, x } = v, k = Math.max(0.35, Math.min(3, size / 60));
      if (x < 0.65) nburst(out, t, 0.55 * k, 0.9, 'lowpass', 8000, 260, 0.7, NZ, 0.003);
      osc(out, t, 'sine', 48, 26, 1.3 * k, 1.1, 0.01, true, 1.1 * k); nburst(out, t, 1.6 * k, 0.5, 'lowpass', 400, 90, 0.7, PK, 0.02);
      if (x < 0.5) for (let i = 0, n = Math.round(10 * k); i < n; i++) nburst(out, t + 0.08 + Math.random() * 1.1 * k, 0.02 + Math.random() * 0.03, 0.06 + Math.random() * 0.16, 'highpass', 1500 + Math.random() * 2500);
    },
    warpSalida(v) { const { t, out, x } = v; nburst(out, t, 0.016, 0.9 * (1 - 0.7 * x), 'highpass', 2500); nburst(out, t, 1.5, 0.8, 'lowpass', 6000 * (1 - 0.6 * x), 200, 0.8, NZ, 0.012); osc(out, t, 'triangle', 55, 28, 1.05, 1.1, 0.02, true, 0.9); nburst(out, Math.max(A.currentTime, t - 0.35), 0.85, 0.18 * (1 - x), 'bandpass', 3200, 350, 1.4, PK, 0.3); }, // estampido de la onda de choque
    warpEntrada(v) { const { t, out } = v; nburst(out, t, 1.0, 0.35, 'bandpass', 400, 5000, 1.5, PK, 0.5); osc(out, t, 'sine', 60, 240, 1.0, 0.35, 0.6, true); }, // subida antes del salto
    alarm(v, enemy) { // alarma de buque de guerra: golpe grave + 3 «wooong» (sierra + cuadrada, vibrato, paso bajo resonante, saturación) con eco de pasillo metálico
      const { t, out } = v, f0 = enemy ? 118 : 150; osc(out, t, 'sine', 62, 34, 0.45, 0.9, 0.004); echo(out, t, 0.11, 0.38, 1400, 3);
      for (let p = 0; p < 3; p++) {
        const t0 = t + 0.18 + p * 0.82, g = A.createGain(), bp = flt('lowpass', 500, 7), sh = A.createWaveShaper(), lfo = A.createOscillator(), lg = A.createGain(); bp.frequency.setValueAtTime(500, t0); bp.frequency.linearRampToValueAtTime(1300, t0 + 0.35); bp.frequency.linearRampToValueAtTime(600, t0 + 0.72); sh.curve = SAT;
        lfo.frequency.value = 6.5; lg.gain.value = f0 * 0.03; lfo.connect(lg); lfo.start(t0); lfo.stop(t0 + 0.8);
        for (const [type, mul, gv] of [['sawtooth', 1, 0.5], ['square', 0.502, 0.35], ['sawtooth', 1.007, 0.3]]) { const o = A.createOscillator(), og = A.createGain(); o.type = type; o.frequency.setValueAtTime(f0 * 0.82 * mul, t0); o.frequency.linearRampToValueAtTime(f0 * 1.08 * mul, t0 + 0.32); o.frequency.linearRampToValueAtTime(f0 * 0.9 * mul, t0 + 0.72); lg.connect(o.frequency); og.gain.value = gv; o.connect(og).connect(bp); o.start(t0); o.stop(t0 + 0.8); }
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.09); g.gain.setValueAtTime(0.7, t0 + 0.5); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.78); bp.connect(sh).connect(g).connect(out);
      }
    },
  };
  const DUR = { plasma: 0.3, misil: 1.3, torreta: 1.2, buqueDisparo: 1.8, satDisparo: 1.4, impacto: 0.35, escudo: 0.45, explosionNave: 2.5, explosionGrande: 4.5, warpSalida: 2, warpEntrada: 1.2, alarmaBuque: 3.2 };
  function sfx(kind, pos, o = {}) { // punto único de los sonidos del mundo (y de los de interfaz: kind UI sin posición)
    kind = ALIAS[kind] || kind; if (UI[kind]) { if (!A) return; return UI[kind](o); }
    const v = voice(kind, pos, { ...o, dur: DUR[kind] }); if (!v) return;
    if (kind === 'explosionNave' || kind === 'explosionGrande') FX.explosion(v, o.size || (kind === 'explosionGrande' ? 160 : 60)); else if (FX[kind]) FX[kind](v);
  }
  function hitMe(dmg, hull) { // impacto en MI nave: metálico (golpe seco + resonancias inarmónicas + chirrido); si es grande, retumbo · si lo absorbió el escudo, zumbido eléctrico
    if (!A) return; const v = voice('impacto', null, { dur: 1 }); if (!v) return; const { t, out } = v, big = dmg > 20;
    if (!hull) return FX.escudo(v);
    nburst(out, t, 0.012, 0.9, 'bandpass', 3000, 3000, 0.9);
    for (const f of [820, 1370, 1990, 2710, 3450]) { const ff = f * (0.9 + 0.2 * Math.random()), bp = flt('bandpass', ff, 12), o2 = A.createOscillator(), g = A.createGain(); o2.frequency.value = ff; o2.connect(bp).connect(env(g, t, 0.18 + Math.random() * 0.12, 0.002, 0.08 + Math.random() * 0.3)).connect(out); o2.start(t); o2.stop(t + 0.5); }
    osc(out, t + 0.01, 'sawtooth', 3200 + Math.random() * 800, 1600, 0.18, 0.03);
    if (big) { osc(out, t, 'sine', 70, 32, 0.55, 0.9, 0.004, true); nburst(out, t, 0.6, 0.35, 'lowpass', 180, 80, 0.7, PK); }
  }
  // ---------- interfaz y mi nave (siempre al 100 %: no pasan por el radio) ----------
  const UI = {
    empty() { const v = voice('impacto', null, { dur: 0.2 }); if (v) { nburst(v.out, v.t, 0.02, 0.2, 'lowpass', 1200); osc(v.out, v.t, 'sine', 160, 140, 0.06, 0.12); } },
    tick(o) { const v = voice('impacto', null, { dur: 0.2 }); if (v) osc(v.out, v.t, 'square', 520 + (o.n || 0) * 110, 520 + (o.n || 0) * 110, 0.1, 0.07, 0.003); }, // aviso (cuenta atrás del salto): pitido intencionado
    vent() { const v = voice('warp', null, { dur: 2 }); if (v) { nburst(v.out, v.t, 1.5, 0.22, 'lowpass', 7500, 450, 0.7, PK, 0.05); nburst(v.out, v.t + 0.38, 1.0, 0.14, 'lowpass', 5500, 350, 0.7, PK, 0.05); osc(v.out, v.t, 'sine', 75, 38, 1.3, 0.12, 0.05); } }, // gases al despegar
    land() { const v = voice('impacto', null, { dur: 0.6 }); if (v) { nburst(v.out, v.t, 0.5, 0.08, 'lowpass', 3000, 300, 0.7, PK, 0.02); osc(v.out, v.t, 'sine', 90, 45, 0.25, 0.1); } }, // tren de aterrizaje
    dodge() { const v = voice('impacto', null, { dur: 0.4 }); if (v) nburst(v.out, v.t, 0.3, 0.18, 'bandpass', 900, 3500, 1.4, PK, 0.03); }, // esquiva: whoosh
    level() { const v = voice('warp', null, { dur: 1.6, rev: 0.4 }); if (v) [523, 659, 784, 1047].forEach((f, i) => osc(v.out, v.t + i * 0.11, 'sine', f, f, 0.5, 0.09, 0.01)); }, // subida de nivel: campanitas suaves
    buy() { const v = voice('impacto', null, { dur: 0.5, rev: 0.2 }); if (v) { osc(v.out, v.t, 'sine', 880, 880, 0.18, 0.07, 0.004); osc(v.out, v.t + 0.07, 'sine', 1320, 1320, 0.25, 0.06, 0.004); } },
    rumble(o) { const v = voice('impacto', null, { dur: 0.3 }); if (v) nburst(v.out, v.t, 0.14, 0.03 + 0.07 * Math.min(1, o.k || 0), 'lowpass', 500, 90, 0.7, PK); }, // turbulencia
  };
  function tone(type, f0, f1, dur, vol) { if (!A) return; const t = A.currentTime, o = A.createOscillator(), g = A.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g).connect(M); o.start(t); o.stop(t + dur); } // avisos de interfaz (al maestro)
  function noiseUI(dur, vol, f0, f1) { if (!A) return; const t = A.currentTime, s = src(NZ, t, dur), f = flt('lowpass', f0), g = A.createGain(); f.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f).connect(g).connect(M); }
  return { ctx, sfx, hitMe, alarm: (pos, enemy) => { const v = voice('alarmaBuque', pos, { dur: DUR.alarmaBuque }); if (v) FX.alarm(v, enemy); }, tone, noiseUI, master: () => (ctx(), M), noise: () => (ctx(), NZ), setVolume: x => { if (M) M.gain.value = x; }, KM: AUDIO_KM };
})();
