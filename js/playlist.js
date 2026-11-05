// Playlist motorları / Playlist engines
//  smart  : ton uyumu + BPM yakınlığı + enerji akışı; yön kuralı kesin (ısınmada BPM düşmez)
//  locked : BPM sırası bozulmaz; yakın BPM'ler (bant) içinde Camelot'a göre dizilir
import { camelotScore, bpmScore, bpmDiffPct, camNum, camLetter } from "./camelot.js";

/** Çarkta kaç adım ve hangi yöne (aynı harf içinde): 8A→9A = +1, 8A→7A = −1, 8A→10A = +2 */
export function camStep(a, b) {
  if (!a || !b || camLetter(a) !== camLetter(b)) return 0;
  return ((camNum(b) - camNum(a) + 18) % 12) - 6;
}

/** Ton yönü: tempo yükselirken çarkta ileri (+1), inerken geri (−1) */
export const KEY_W = { forward: 3, backward: -2, repeat3: -4, jump: 7, maxJumps: 2 };
export function keyBonus(prev, cur, t, kd, jumpsLeft) {
  let b = 0; const st = camStep(cur.camelot, t.camelot);
  if (kd && st === kd) b += KEY_W.forward;                       // istenen yönde komşu
  else if (kd && st === -kd) b += KEY_W.backward;                // ters yönde komşu
  if (kd && jumpsLeft > 0 && st === 2 * kd) b += KEY_W.jump;     // bilinçli enerji sıçraması (+2)
  if (prev && prev.camelot && prev.camelot === cur.camelot && cur.camelot === t.camelot) b += KEY_W.repeat3; // aynı tonda 3. kez
  return b;
}

/** Enerji de akışla aynı yöne gitsin: yükselirken enerjisi düşen, inerken enerjisi artan şarkı küçük ceza alır */
export const ENERGY_W = 0.8;
export function energyBonus(cur, t, kd) {
  if (!kd || !cur.energy || !t.energy) return 0;
  return -Math.max(0, kd * (cur.energy - t.energy)) * ENERGY_W;
}

/** "Bunun yerine": i. şarkının yerine önceki ve sonraki şarkıya en iyi uyan adaylar */
export function alternatives(list, i, pool, n = 3) {
  const prev = list[i - 1], next = list[i + 1], cur = list[i];
  const inList = new Set(list.map(x => stem(x.id)));
  pool = dedupeFormats(pool);
  const lo = prev && next ? Math.min(prev.bpm, next.bpm) : 0, hi = prev && next ? Math.max(prev.bpm, next.bpm) : 0;
  const fit = (a, b) => camelotScore(a.camelot, b.camelot)[0] * 1.4 + bpmScore(a.bpm, b.bpm)[0];
  const scored = pool.filter(t => t.bpm && !t.error && !inList.has(stem(t.id))).map(t => {
    let s = 0;
    if (prev) s += fit(prev, t);
    if (next) s += fit(t, next);
    if (lo) s -= Math.max(0, lo - t.bpm, t.bpm - hi) * 1.5;      // önceki ile sonraki arasında kalsın
    if (!prev || !next) s *= 2;                                  // uçtaki şarkıda tek komşu var
    if (cur && t.camelot === cur.camelot) s += 0.5;
    return { track: t, score: Math.round(s * 10) / 10,
             inCam: prev ? camelotScore(prev.camelot, t.camelot)[1] : null, outCam: next ? camelotScore(t.camelot, next.camelot)[1] : null };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, n);
}

/** Aynı şarkının WAV ve MP3'ü (aynı ad, farklı uzantı) varsa sadece biri kalır: MP3 tercih edilir */
const stem = id => String(id || "").replace(/\.[^./]+$/, "").toLowerCase();
export function dedupeFormats(tracks) {
  const best = new Map();
  for (const t of tracks) { const k = stem(t.id), o = best.get(k);
    if (!o || (/\.mp3$/i.test(t.id) && !/\.mp3$/i.test(o.id))) best.set(k, t); }
  return tracks.filter(t => best.get(stem(t.id)) === t);
}

function filterPool(tracks, bmin = 0, bmax = 0) {
  let out = dedupeFormats(tracks.filter(t => !t.error && t.bpm));
  if (bmin) out = out.filter(t => t.bpm >= bmin);
  if (bmax) out = out.filter(t => t.bpm <= bmax);
  return out;
}

function direction(shape, pos) {
  if (shape === "warmup") return 1;
  if (shape === "cooldown") return -1;
  if (shape === "peak") return pos <= 0.7 ? 1 : -1;
  return 0;
}

/** Tek başına duran uç değerlere takılmadan en yavaş / en hızlı başlangıç */
export function denseEdge(srt, fromLow = true, windowBpm = 4) {
  const need = Math.max(3, Math.floor(srt.length / 25));
  const seq = fromLow ? srt : [...srt].reverse();
  for (const t of seq) {
    const cnt = srt.filter(o => (fromLow ? o.bpm - t.bpm : t.bpm - o.bpm) >= 0 &&
                                (fromLow ? o.bpm - t.bpm : t.bpm - o.bpm) <= windowBpm).length;
    if (cnt >= need) return t;
  }
  return seq[0];
}

export function smart(tracks, { length = 0, start = "slow", shape = "warmup", bmin = 0, bmax = 0, startId = null } = {}) {
  const pool = filterPool(tracks, bmin, bmax);
  if (!pool.length) return [];
  length = Math.min(length || pool.length, pool.length);
  // Çelişen seçimi düzelt: en yavaştan "Kapanış" ya da en hızlıdan "Isınma/Zirve" olmaz
  const notes = [];
  if (!startId && shape === "cooldown" && start === "slow") { start = "fast"; notes.push("fix_to_fast"); }
  if (!startId && (shape === "warmup" || shape === "peak") && start === "fast") { start = "slow"; notes.push("fix_to_slow"); }
  const srt = [...pool].sort((a, b) => a.bpm - b.bpm);
  const lo = srt[0].bpm, hi = srt[srt.length - 1].bpm;
  let first = startId ? pool.find(t => t.id === startId) : null;
  if (!first) first = start === "slow" ? denseEdge(srt, true) : start === "fast" ? denseEdge(srt, false) : srt[Math.floor(srt.length / 2)];
  const b0 = first.bpm;

  const STEP = 1.5, steps = Math.max(length - 1, 1);
  const up = Math.min(hi - b0, STEP * steps), down = Math.min(b0 - lo, STEP * steps);
  const target = pos => {
    if (shape === "warmup") return b0 + up * pos;
    if (shape === "cooldown") return b0 - down * pos;
    if (shape === "peak") {
      const top = b0 + Math.min(hi - b0, STEP * steps * 0.7);
      return pos <= 0.7 ? b0 + (top - b0) * (pos / 0.7) : top - (top - b0) * 0.5 * ((pos - 0.7) / 0.3);
    }
    if (shape === "wave") {               // yukarıda yer yoksa (tepeden başlandıysa) aşağı doğru dalgalan
      let amp = Math.min((hi - b0) / 2, 3); if (amp < 1) amp = -Math.min((b0 - lo) / 2, 3);
      return b0 + amp * (1 - Math.cos(pos * Math.PI * 3));
    }
    return b0;
  };
  const keyDir = pos => {
    if (shape === "wave") { const a = target(pos), b = target(Math.min(pos + 0.02, 1)); return Math.abs(b - a) < 1e-6 ? 0 : b > a ? 1 : -1; }
    return direction(shape, pos);
  };
  const TOL = 0.3;
  let jumps = shape === "peak" ? KEY_W.maxJumps : 0;       // sıçrama sadece Zirve setinde
  const out = [first], used = new Set([first.id]);
  while (out.length < length) {
    const cur = out[out.length - 1];
    const pos = out.length / Math.max(length - 1, 1);
    const tgt = target(pos), d = direction(shape, pos), kd = keyDir(pos), prev = out[out.length - 2];
    const ok = pool.filter(t => !used.has(t.id) &&
      (d === 1 ? t.bpm >= cur.bpm - TOL : d === -1 ? t.bpm <= cur.bpm + TOL : true));
    if (!ok.length) break;                       // kural bozulmaz: liste burada biter
    let best = null, bestS = -1e9;
    for (const t of ok) {
      const s = camelotScore(cur.camelot, t.camelot)[0] * 1.4 + bpmScore(cur.bpm, t.bpm)[0]
        - Math.abs(t.bpm - tgt) * 1.5 - Math.max(0, Math.abs(t.bpm - cur.bpm) - 3) * 2
        + keyBonus(prev, cur, t, kd, jumps) + energyBonus(cur, t, kd);
      if (s > bestS) { bestS = s; best = t; }
    }
    if (kd && camStep(cur.camelot, best.camelot) === 2 * kd) jumps--;
    out.push(best); used.add(best.id);
  }
  out.notes = notes;
  return out;
}

export function locked(tracks, { length = 0, tolerance = 2, bmin = 0, bmax = 0, descending = false } = {}) {
  const pool = filterPool(tracks, bmin, bmax);
  if (!pool.length) return [];
  const srt = [...pool].sort((a, b) => descending ? b.bpm - a.bpm : a.bpm - b.bpm);
  const bands = [[srt[0]]];
  for (const t of srt.slice(1)) {
    const band = bands[bands.length - 1];
    if (Math.abs(t.bpm - band[0].bpm) <= tolerance) band.push(t); else bands.push([t]);
  }
  const out = []; let prev = null;
  for (const band of bands) {
    const rest = [...band];
    // BPM yukarı giderken çarkta da ileri (+1), aşağı giderken geri (−1) tercih edilir
    const kd = descending ? -1 : 1, ks = (ref, x) => camelotScore(ref.camelot, x.camelot)[0] + (camStep(ref.camelot, x.camelot) === kd ? 0.5 : 0);
    const byScore = ref => rest.sort((a, b) => ks(ref, b) - ks(ref, a));
    if (prev) byScore(prev);
    let cur = rest.shift(); const seq = [cur];
    while (rest.length) { byScore(cur); cur = rest.shift(); seq.push(cur); }
    out.push(...seq); prev = seq[seq.length - 1];
  }
  return length ? out.slice(0, length) : out;
}

export function report(pl) {
  const transitions = []; let good = 0;
  for (let i = 0; i < pl.length - 1; i++) {
    const a = pl[i], b = pl[i + 1];
    const [cs, cl] = camelotScore(a.camelot, b.camelot);
    const [bs, pct] = bpmScore(a.bpm, b.bpm);
    const ok = cs >= 8 && bs >= 7; if (ok) good++;
    transitions.push({ i, cam: cl, camScore: cs, bpmPct: Math.round(pct * 10) / 10,
      level: ok ? "good" : (cs >= 2 && bs >= 3 ? "ok" : "bad") });
  }
  const n = transitions.length;
  return { transitions, good, total: n, score: n ? Math.round(good / n * 100) : 100,
           duration: pl.reduce((s, t) => s + (t.duration || 0), 0) };
}

/** M3U: yollar playlist dosyasına göre göreli */
export function toM3U(pl, pathOf = t => t.id) {
  return "#EXTM3U\n" + pl.map(t => `#EXTINF:${Math.round(t.duration || -1)},${t.artist ? t.artist + " - " : ""}${t.title || t.file}\n${pathOf(t)}`).join("\n") + "\n";
}

export function toCSV(pl, labels) {
  const esc = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [labels, ...pl.map((t, i) => [i + 1, t.artist, t.title, t.bpm, t.key, t.camelot, t.energy, t.id])];
  return "﻿" + rows.map(r => r.map(esc).join(";")).join("\r\n");
}

export { bpmDiffPct };
