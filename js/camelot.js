// Camelot Wheel yardımcıları / Camelot wheel helpers
// Not: minör tonlar ayrı tabloyla çevrilir (A minör = 8A).

export const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR = { B: 1, "F#": 2, "C#": 3, "G#": 4, "D#": 5, "A#": 6, F: 7, C: 8, G: 9, D: 10, A: 11, E: 12 };
const MINOR = { "G#": 1, "D#": 2, "A#": 3, F: 4, C: 5, G: 6, D: 7, A: 8, E: 9, B: 10, "F#": 11, "C#": 12 };
const FLAT = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#", CB: "B", FB: "E", "E#": "F", "B#": "C" };

export const CAM_COLORS = {
  1: "#56f0c8", 2: "#5fe08a", 3: "#9be35a", 4: "#e8d84a", 5: "#f6a94a", 6: "#f57f5b",
  7: "#f2617d", 8: "#e45bb0", 9: "#b56cf0", 10: "#8a7cf7", 11: "#5d9cf7", 12: "#4cc9f0",
};

/** 'A Minor', 'Am', 'Bb major', 'F#m', '8A', Open Key '1m' ... -> Camelot ('8A'); anlaşılamazsa '' */
export function toCamelot(keyStr) {
  if (!keyStr) return "";
  const s = String(keyStr).trim();
  let m = s.match(/^(\d{1,2})\s*([ABab])$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${+m[1]}${m[2].toUpperCase()}`;
  m = s.match(/^(\d{1,2})\s*([mMdD])$/);                         // Open Key: 1m = Am = 8A
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${((+m[1] + 6) % 12) + 1}${m[2].toLowerCase() === "m" ? "A" : "B"}`;
  m = s.match(/^([A-Ga-g])([#b♯♭]?)\s*(.*)$/);
  if (!m) return "";
  const letter = m[1].toUpperCase();
  const acc = m[2].replace("♯", "#").replace("♭", "b");
  const rest = m[3].trim();
  let note = letter;
  if (acc === "b") note = FLAT[letter + "B"] || letter;
  else if (acc === "#") note = FLAT[letter + "#"] || letter + "#";
  const low = rest.toLowerCase();
  const minor = rest === "m" || low.startsWith("min") || low.startsWith("moll");
  const num = (minor ? MINOR : MAJOR)[note];
  return num ? `${num}${minor ? "A" : "B"}` : "";
}

export const camNum = c => parseInt(c, 10) || 0;
export const camLetter = c => (c ? c.slice(-1).toUpperCase() : "");
export function camDistance(a, b) { const d = Math.abs(camNum(a) - camNum(b)); return Math.min(d, 12 - d); }

/** Geçiş puanı ve açıklama anahtarı (i18n) */
export function camelotScore(a, b) {
  if (!a || !b) return [0, "key_unknown"];
  if (a === b) return [10, "key_same"];
  const d = camDistance(a, b), same = camLetter(a) === camLetter(b);
  if (d === 0 && !same) return [9, "key_relative"];
  if (d === 1 && same) return [8, "key_neighbor"];
  if (d === 2 && same) return [3, "key_jump"];
  if (d === 1 && !same) return [2, "key_diagonal"];
  return [-5, "key_clash"];
}

/** BPM farkı (%), yarım/çift tempo dahil */
export function bpmDiffPct(b1, b2) {
  if (!b1 || !b2) return 100;
  return Math.min(...[b2, b2 * 2, b2 / 2].map(c => Math.abs(b1 - c) / Math.max(b1, c) * 100));
}

export function bpmScore(b1, b2) {
  const f = bpmDiffPct(b1, b2);
  return [f <= 3 ? 10 : f <= 6 ? 7 : f <= 10 ? 3 : -5, f];
}

export const camColor = c => CAM_COLORS[camNum(c)] || "#888888";

/** Essentia çıktısı {key:'Bb', scale:'minor'} -> '3A' */
export const camOfKey = k => (k && k.key ? toCamelot(`${k.key} ${k.scale || ""}`.trim()) : "");

/** Uyumlu mu (aynı, majör/minör eşi, komşu) */
export function camCompatible(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const d = camDistance(a, b);
  return d === 0 || (d === 1 && camLetter(a) === camLetter(b));
}
