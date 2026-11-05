// Analiz: dosyayı tarayıcıda çözüp Essentia işçilerine verir (bilgisayarın birkaç çekirdeği aynı anda)
import { camOfKey } from "./camelot.js";

export const KEY_PROFILES = ["edma", "edmm", "bgate", "braw", "shaath", "temperley", "krumhansl", "faraldo"];

export function makeWorker() {
  return new Promise((res, rej) => {
    const w = new Worker(new URL("./essentia-worker.js", import.meta.url), { type: "module" });
    const to = setTimeout(() => { w.terminate(); rej(new Error("essentia_timeout")); }, 90000);
    w.onmessage = e => {
      if (e.data.type === "ready") { clearTimeout(to); w.onmessage = null; w.onerror = null; res(w); }
      else if (e.data.type === "fatal") { clearTimeout(to); w.terminate(); rej(new Error(e.data.error)); }
    };
    w.onerror = e => { clearTimeout(to); w.terminate(); rej(new Error(e.message || "worker_error")); };
  });
}

function runInWorker(w, signal, opts) {
  return new Promise(res => {
    const id = Math.random();
    w.onmessage = e => { if (e.data.id === id) res(e.data); };
    w.onerror = e => res({ error: e.message || "worker_error" });
    w.postMessage({ id, signal, opts: opts || {} }, [signal.buffer]);
  });
}

/** Dosyayı 44.1 kHz mono'ya çevirir; şarkının ortasından en fazla 150 sn alır (giriş/çıkış atlanır) */
export async function decodeFile(file) {
  const ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
  const segLen = Math.min(ab.length, Math.round(150 * 44100));
  const start = ab.duration > 170 ? Math.round((ab.length - segLen) / 2) : 0;
  const out = new Float32Array(segLen), ch = ab.numberOfChannels;
  for (let c = 0; c < ch; c++) { const d = ab.getChannelData(c); for (let i = 0; i < segLen; i++) out[i] += d[start + i] / ch; }
  return { signal: out, duration: ab.duration };
}

export const workerCount = () => Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)));

/**
 * items: [{id, handle}] ; her biri için onResult(item, sonuç) çağrılır.
 * mode: 'analyze' (BPM+ton+enerji) | 'calibrate' (her profil için ton)
 */
export async function runPool(items, { mode = "analyze", keyStrategy, onResult, isCancelled = () => false }) {
  const n = workerCount(), workers = [];
  try {
    for (let i = 0; i < n; i++) workers.push(await makeWorker());
    const queue = [...items];
    await Promise.all(workers.map(async w => {
      while (queue.length && !isCancelled()) {
        const it = queue.shift(); let res;
        try {
          const file = await it.handle.getFile();
          const { signal, duration } = await decodeFile(file);
          res = await runInWorker(w, signal, mode === "calibrate" ? { calibrate: KEY_PROFILES } : { keyStrategy });
          res.duration = duration; res.size = file.size; res.mtime = file.lastModified;
        } catch (e) { res = { error: e.message || String(e) }; }
        delete res.type; delete res.id;
        await onResult(it, res);
      }
    }));
  } finally { workers.forEach(w => w.terminate()); }
  return n;
}

/** Kalibrasyon sonuçlarından en iyi ton stratejisini seçer. rows: [{keys:{profil:{key,scale}}, rb: '8A'}] */
export function bestStrategy(rows, current) {
  const camVote = (keys, ps) => {
    const c = {}, order = {};
    for (const p of ps) { const v = camOfKey(keys[p]); if (!v) continue; c[v] = (c[v] || 0) + 1; if (!(v in order)) order[v] = Object.keys(order).length; }
    const names = Object.keys(c); if (!names.length) return "";
    names.sort((a, b) => c[b] - c[a] || order[a] - order[b]); return names[0];
  };
  const combos = (arr, k, s = 0, cur = [], out = []) => { if (cur.length === k) { out.push([...cur]); return out; } for (let i = s; i < arr.length; i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); } return out; };
  const score = fn => rows.filter(r => fn(r.keys) === r.rb).length;
  const res = [];
  for (const p of KEY_PROFILES) res.push({ strat: { type: "profile", profile: p }, label: p, ex: score(k => camOfKey(k[p])) });
  for (const k of [3, 5]) for (const ps of combos(KEY_PROFILES, k)) res.push({ strat: { type: "vote", profiles: ps }, label: ps.join(" + "), ex: score(keys => camVote(keys, ps)) });
  res.sort((a, b) => b.ex - a.ex || (a.strat.type === "profile" ? -1 : 1));
  const curKey = JSON.stringify(current || { type: "profile", profile: "edma" });
  return { best: res[0], current: res.find(r => JSON.stringify(r.strat) === curKey) || res.find(r => r.label === "edma"),
           singles: res.filter(r => r.strat.type === "profile"), n: rows.length };
}
