// ─────────────────────────────────────────────────────────────
//  Essentia.js analiz işçisi (Web Worker)
//  Ana pencereden mono 44.1 kHz ses (Float32Array) alır,
//  BPM, ton ve enerji hesaplayıp geri gönderir.
// ─────────────────────────────────────────────────────────────
import { EssentiaWASM } from "../vendor/essentia-wasm.es.js";
import Essentia from "../vendor/essentia.js-core.es.js";

let es = null;
try {
  let mod = EssentiaWASM;
  if (typeof mod === "function") mod = await mod();      // bazı sürümlerde fabrika fonksiyonu
  es = new Essentia(mod);
  postMessage({ type: "ready", version: es.version });
} catch (e) {
  postMessage({ type: "fatal", error: String(e && e.message || e) });
}

const clamp01 = v => Math.max(0, Math.min(1, v));
const norm = (v, lo, hi) => clamp01((v - lo) / (hi - lo));
function del(...xs) { for (const x of xs) { try { if (x && typeof x.delete === "function") x.delete(); } catch (e) {} } }

// Denenebilecek ton profilleri (kalibrasyonda hepsi ölçülür)
const KEY_PROFILES = ["edma", "edmm", "bgate", "braw", "shaath", "temperley", "krumhansl", "faraldo"];

function keyWith(vec, profile) {
  try {
    const k = es.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, profile, 44100, 0.0001, 440, "cosine", "hann");
    return (k && k.key) ? { key: k.key, scale: k.scale, strength: k.strength } : null;
  } catch (e) { return null; }
}

// Ayarlanan stratejiye göre ton: tek profil ya da birkaç profilin oylaması
function keyByStrategy(vec, strat) {
  strat = strat || { type: "profile", profile: "edma" };
  if (strat.type === "vote" && Array.isArray(strat.profiles) && strat.profiles.length) {
    const votes = {}, first = {};
    for (const p of strat.profiles) {
      const k = keyWith(vec, p);
      if (!k) continue;
      const name = k.key + " " + k.scale;
      (votes[name] = votes[name] || []).push(k.strength);
      if (!(name in first)) first[name] = Object.keys(first).length;
    }
    const names = Object.keys(votes);
    if (names.length) {
      names.sort((a, b) => votes[b].length - votes[a].length || first[a] - first[b]);
      const [key, scale] = names[0].split(" ");
      const agree = votes[names[0]].length / strat.profiles.length;
      return { key, scale, strength: agree * (votes[names[0]].reduce((x, y) => x + y, 0) / votes[names[0]].length) };
    }
  }
  return keyWith(vec, strat.profile || "edma") || keyWith(vec, "bgate");
}

function analyze(signal, opts) {
  opts = opts || {};
  const out = {};
  const vec = es.arrayToVector(signal);
  try {
    // Kalibrasyon modu: sadece her profilin ton sonucu
    if (opts.calibrate) {
      out.keys = {};
      for (const p of opts.calibrate) { const k = keyWith(vec, p); if (k) out.keys[p] = k; }
      return out;
    }
    // ── BPM: RhythmExtractor2013 (multifeature) + güven değeri
    try {
      const r = es.RhythmExtractor2013(vec, 185, "multifeature", 70);
      let bpm = r.bpm;
      while (bpm > 0 && bpm < 75) bpm *= 2;     // yarım tempo düzeltmesi
      while (bpm > 190) bpm /= 2;
      out.bpm = bpm;
      out.bpm_conf = Math.min(1, (r.confidence || 0) / 5.32);   // multifeature güveni 0–5.32 arası
      del(r.ticks, r.estimates, r.bpmIntervals);
    } catch (e) {
      const p = es.PercivalBpmEstimator(vec);
      out.bpm = p.bpm; out.bpm_conf = 0;
    }

    // ── Ton: kalibrasyonla seçilen strateji (varsayılan: elektronik müzik profili 'edma')
    const k = keyByStrategy(vec, opts.keyStrategy);
    if (k) { out.key = k.key; out.scale = k.scale; out.strength = k.strength; }

    // ── Enerji (ham puan 0–1; uygulama bunu kütüphanedeki diğer şarkılara göre 1–10'a çevirir)
    // İndirilen şarkıların ses seviyesi eşitlendiği için "ne kadar yüksek" değil,
    // "ne kadar yoğun / sürükleyici" ölçülür: vuruş sıklığı, dans edilebilirlik,
    // dinamik aralığın darlığı (sıkıştırılmış = enerjik) ve parlaklık (yüksek frekans payı).
    let onsetRate = 3, dance = 1.3, dyn = 5;
    try { const o = es.OnsetRate(vec); onsetRate = o.onsetRate; del(o.onsets); } catch (e) {}
    try { const d = es.Danceability(vec); dance = d.danceability; del(d.dfa); } catch (e) {}
    try { const dc = es.DynamicComplexity(vec); dyn = dc.dynamicComplexity; } catch (e) {}
    let zc = 0; for (let i = 1; i < signal.length; i++) if ((signal[i] >= 0) !== (signal[i - 1] >= 0)) zc++;
    const zcr = zc / Math.max(1, signal.length);          // parlaklık göstergesi
    const raw = 0.35 * norm(onsetRate, 1.5, 7) + 0.25 * norm(dance, 0.9, 2.4)
              + 0.20 * (1 - norm(dyn, 2, 10)) + 0.20 * norm(zcr, 0.03, 0.15);
    out.energy_raw = raw;
    out.energy = Math.round(1 + raw * 9);
  } finally {
    del(vec);
  }
  return out;
}

onmessage = (ev) => {
  const { id, signal, opts } = ev.data;
  if (!es) { postMessage({ type: "result", id, error: "Essentia yüklenemedi" }); return; }
  try {
    postMessage({ type: "result", id, ...analyze(signal, opts) });
  } catch (e) {
    postMessage({ type: "result", id, error: String(e && e.message || e) });
  }
};
