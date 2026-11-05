// Yerel ilerleme: açılan bölümler, en iyi süreler, oyuncu kimliği.
const KEY = 'okkup:v1';

const defaults = () => ({ name: '', maxLevel: 1, best: {}, id: null, token: null, sound: true });

export function load() {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults();
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* gizli sekme vb. */ }
}

export function totalScore(state) {
  return Object.values(state.best).reduce((s, b) => s + (b.score || 0), 0);
}

export function totalStars(state) {
  return Object.values(state.best).reduce((s, b) => s + (b.stars || 0), 0);
}
