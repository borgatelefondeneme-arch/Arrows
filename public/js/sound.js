// Küçük ses efektleri (WebAudio ile sentezlenir, dosya gerekmez).
let ctx = null;
export let enabled = true;
export function setEnabled(v) { enabled = v; }

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// iOS sesi ancak bir dokunuşla açar.
export function unlock() { ac(); }

function tone(freq, dur, type = 'sine', gain = 0.15, slide = 0, delay = 0) {
  if (!enabled) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  whoosh: () => tone(500, 0.18, 'triangle', 0.12, 700),
  bump: () => { tone(140, 0.2, 'square', 0.1, -60); },
  tick: () => tone(880, 0.08, 'sine', 0.12),
  go: () => tone(1320, 0.25, 'sine', 0.15),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.14, 0, i * 0.11)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', 0.12, 0, i * 0.15)),
  pop: () => tone(660, 0.1, 'sine', 0.1, 200),
};
