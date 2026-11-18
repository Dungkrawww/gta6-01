// Solara City — LocalStorage save / load (F13, Block C).
// One JSON document under a versioned key. The game assembles the state
// (cash, health, mission, player, car, wanted) and this module only owns
// the key and the read/write/clear plumbing — no game logic lives here.
export const SAVE_KEY = 'solara-city-save-v1';

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('save failed', err);
    return false;
  }
}

export function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (err) {
    console.warn('load failed', err);
    return null;
  }
}

export function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch (err) {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (err) {
    // Storage unavailable: nothing to clear.
  }
}
