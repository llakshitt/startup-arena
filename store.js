// Saved roles live only in this browser (localStorage). No account, nothing is sent anywhere.
const KEY = 'arena.saved.v1';

export function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function persistSaved(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch {
    return false; // private window or storage blocked
  }
}
