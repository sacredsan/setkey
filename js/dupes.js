// Aynı şarkıları bulma: birebir aynı dosyalar (SHA-256) + benzer isimler
const NOISE = ["official video", "official audio", "official music video", "lyrics", "lyric video", "audio", "video",
  "hq", "hd", "remastered", "remaster", "explicit", "clean version", "clean", "full", "mp3", "download",
  "free download", "youtube", "soundcloud", "spotify"];

export function normalizeName(filename) {
  let n = filename.replace(/\.[^.]+$/, "").toLowerCase();
  n = n.replace(/\(.*?\)|\[.*?\]/g, " ").replace(/\b\d{2,3}\s*kbps\b/g, " ").replace(/^\d{1,3}\s*[-_.]\s*/, " ");
  for (const w of NOISE) n = n.replace(new RegExp("\\b" + w.replace(/ /g, "\\s+") + "\\b", "g"), " ");
  return n.replace(/[-_.]+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** İki metnin benzerliği 0-1 (harf ikilileri, Dice katsayısı) */
export function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let inter = 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

async function sha256(file) {
  const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
}

/** files: [{id, handle, dir}] -> [{exact, items:[{id, size, name, handle, dir}]}] */
export async function findDuplicates(files, threshold = 0.85, onProgress = () => {}, isCancelled = () => false) {
  const n = files.length, parent = [...Array(n).keys()];
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const meta = [];
  for (const f of files) { const file = await f.handle.getFile(); meta.push({ ...f, size: file.size, file, name: f.id.split("/").pop() }); }

  // 1) Aynı boyuttakileri hash'le (birebir kopyalar)
  const bySize = new Map(); meta.forEach((m, i) => { if (!bySize.has(m.size)) bySize.set(m.size, []); bySize.get(m.size).push(i); });
  const cand = [...bySize.values()].filter(g => g.length > 1).flat();
  const hashes = {}; let done = 0; const total = cand.length + n;
  for (const i of cand) { if (isCancelled()) return []; hashes[i] = await sha256(meta[i].file); onProgress(++done, total); }
  const byHash = new Map(); for (const [i, h] of Object.entries(hashes)) { if (!byHash.has(h)) byHash.set(h, []); byHash.get(h).push(+i); }
  for (const g of byHash.values()) for (const j of g.slice(1)) union(g[0], j);

  // 2) Benzer isimler (içindeki sayılar farklıysa eşleşmez: "Song 2" ≠ "Song 3")
  const names = meta.map(m => normalizeName(m.name));
  const nums = names.map(s => (s.match(/\d+/g) || []).join(","));
  for (let i = 0; i < n; i++) {
    if (isCancelled()) return [];
    for (let j = i + 1; j < n; j++) {
      if (!names[i] || !names[j] || nums[i] !== nums[j] || find(i) === find(j)) continue;
      if (Math.abs(names[i].length - names[j].length) > Math.max(names[i].length, names[j].length) * (1 - threshold) * 2) continue;
      if (similarity(names[i], names[j]) >= threshold) union(i, j);
    }
    onProgress(++done, total);
  }
  const groups = new Map(); meta.forEach((m, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const out = [];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const hs = new Set(idx.map(i => hashes[i]));
    out.push({ exact: hs.size === 1 && !hs.has(undefined),
               items: idx.map(i => ({ id: meta[i].id, size: meta[i].size, name: meta[i].name, handle: meta[i].handle, dir: meta[i].dir })).sort((a, b) => b.size - a.size) });
  }
  return out.sort((a, b) => (b.exact - a.exact) || a.items[0].name.localeCompare(b.items[0].name));
}

/** Seçilenleri kök klasördeki _kopyalar klasörüne taşır (silmez; taşıma yoksa kopyalayıp asıl dosyayı kaldırır) */
export async function moveToTrash(items, root) {
  const target = await root.getDirectoryHandle("_kopyalar", { create: true });
  let moved = 0; const errors = [];
  for (const it of items) {
    try {
      let name = it.name, k = 1;
      const exists = async nm => { try { await target.getFileHandle(nm); return true; } catch (e) { return false; } };
      while (await exists(name)) { name = it.name.replace(/(\.[^.]+)$/, ` (${k++})$1`); }
      if (it.handle.move) { await it.handle.move(target, name); }
      else {
        const f = await it.handle.getFile();
        const w = await (await target.getFileHandle(name, { create: true })).createWritable();
        await f.stream().pipeTo(w);
        await it.dir.removeEntry(it.name);
      }
      moved++;
    } catch (e) { errors.push(`${it.name}: ${e.message}`); }
  }
  return { moved, errors };
}
