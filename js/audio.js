// 用 WebAudio 即时合成的小音效，无需任何音频文件
let ctx = null;
let master = null;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noiseBurst(dur, vol = 0.2, delay = 0) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1800;
  g.gain.value = vol;
  s.buffer = buf; s.connect(f); f.connect(g); g.connect(master);
  s.start(t0);
}

export function sfx(name, vol = 1) {
  if (!ctx || vol <= 0.01) return;
  switch (name) {
    case 'shoot': noiseBurst(0.12, 0.25 * vol); tone(700, 0.1, { type: 'square', vol: 0.08 * vol, slide: -400 }); break;
    case 'miss': tone(220, 0.25, { type: 'triangle', vol: 0.2 * vol, slide: -120 }); break;
    case 'hit': tone(660, 0.1, { type: 'square', vol: 0.15 * vol }); tone(990, 0.2, { type: 'square', vol: 0.15 * vol, delay: 0.08 }); break;
    case 'found': tone(880, 0.12, { vol: 0.25 * vol }); tone(440, 0.3, { vol: 0.25 * vol, delay: 0.1, slide: -200 }); noiseBurst(0.3, 0.2 * vol, 0.05); break;
    case 'taunt': tone(900, 0.12, { type: 'triangle', vol: 0.35 * vol, slide: 500 }); tone(1300, 0.14, { type: 'triangle', vol: 0.3 * vol, delay: 0.14, slide: -500 }); break;
    case 'tick': tone(1200, 0.05, { type: 'square', vol: 0.06 * vol }); break;
    case 'start': [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.25 * vol, delay: i * 0.12 })); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.25 * vol, delay: i * 0.13 })); break;
    case 'lose': [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.25 * vol, delay: i * 0.16 })); break;
    case 'pick': tone(1500, 0.06, { vol: 0.12 * vol }); break;
    case 'pop': tone(500, 0.08, { vol: 0.12 * vol, slide: 400 }); break;
    case 'join': tone(700, 0.1, { vol: 0.12 * vol }); tone(1050, 0.12, { vol: 0.12 * vol, delay: 0.09 }); break;
  }
}
