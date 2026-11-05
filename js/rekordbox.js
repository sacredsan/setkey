// Rekordbox entegrasyonu (resmi "rekordbox xml" formatı)
import { toCamelot, camDistance, camLetter } from "./camelot.js";

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unxml = s => s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi,
  (m, n, d, h) => ENT[m] || (d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : m));
const xml = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** 'file://localhost/C:/Music/a%20b.mp3' -> 'C:/Music/a b.mp3' */
export function locationToPath(loc) {
  let p = loc || "";
  for (const pre of ["file://localhost/", "file:///", "file://"]) if (p.startsWith(pre)) { p = p.slice(pre.length); break; }
  try { p = decodeURIComponent(p); } catch (e) {}
  if (!/^[A-Za-z]:/.test(p) && !p.startsWith("/")) p = "/" + p;   // macOS / Linux
  return p.replace(/\\/g, "/");
}

export function pathToLocation(abs) {
  let p = abs.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  return "file://localhost" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

const norm = p => p.replace(/\\/g, "/").toLowerCase();

/** XML metninden koleksiyonu okur -> [{path, bpm, key, camelot, title, artist, duration}] */
export function parseCollection(text) {
  const start = text.indexOf("<COLLECTION"), end = text.indexOf("</COLLECTION>");
  if (start < 0) throw new Error("not_rekordbox_xml");
  const body = text.slice(start, end > 0 ? end : undefined);
  const out = [];
  const re = /<TRACK\s([^>]*?)\/?>/g; let m;
  while ((m = re.exec(body))) {
    const a = {}; let am; const are = /(\w+)="([^"]*)"/g;
    while ((am = are.exec(m[1]))) a[am[1]] = unxml(am[2]);
    if (!a.Location) continue;
    const key = (a.Tonality || "").trim();
    out.push({ path: locationToPath(a.Location), bpm: Math.round((+a.AverageBpm || 0) * 100) / 100, key,
               camelot: toCamelot(key), title: a.Name || "", artist: a.Artist || "", duration: +a.TotalTime || 0 });
  }
  return out;
}

/**
 * Rekordbox kayıtlarını kütüphanedeki şarkılarla eşleştirir.
 * Tarayıcı dosyaların tam yolunu bilmez; bu yüzden göreli yol (Klasör/şarkı.mp3) ile
 * Rekordbox'taki tam yolun SONU karşılaştırılır. Eşleşmelerden kök klasörün tam yolu da öğrenilir.
 * Döner: { byId: {id: rbRec}, basePath, matched }
 */
export function matchToLibrary(rbTracks, libIds, rootName) {
  const byFile = new Map();
  for (const r of rbTracks) {
    const f = norm(r.path).split("/").pop();
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(r);
  }
  const byId = {}; const bases = new Map();
  for (const id of libIds) {
    const rel = norm((rootName ? rootName + "/" : "") + id);
    const cands = byFile.get(rel.split("/").pop()) || [];
    const hit = cands.find(r => norm(r.path).endsWith("/" + rel)) || cands.find(r => norm(r.path).endsWith("/" + norm(id)));
    if (hit) {
      byId[id] = hit;
      const full = hit.path.replace(/\\/g, "/");
      const base = full.slice(0, full.length - id.length - 1);          // .../KökKlasör
      bases.set(base, (bases.get(base) || 0) + 1);
    }
  }
  const basePath = [...bases.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return { byId, basePath, matched: Object.keys(byId).length };
}

export function bpmRelation(ours, rb) {
  if (!ours || !rb) return "none";
  if (Math.abs(ours - rb) <= 0.5) return "same";
  if (Math.abs(ours - rb) <= 2) return "close";
  for (const m of [2, 0.5, 1.5, 2 / 3]) if (Math.abs(ours * m - rb) <= 1) return "halfdouble";
  return "diff";
}

export function keyRelation(ours, rb) {
  if (!ours || !rb) return "none";
  if (ours === rb) return "same";
  const d = camDistance(ours, rb);
  if (d === 0) return "relative";
  if (d === 1 && camLetter(ours) === camLetter(rb)) return "neighbor";
  return "diff";
}

export function compare(tracks, rbById) {
  const rows = [];
  for (const t of tracks) {
    const r = rbById[t.id];
    if (!r || t.error || !t.an_bpm) continue;
    rows.push({ id: t.id, title: t.title || t.file, artist: t.artist || "", ourBpm: t.an_bpm, rbBpm: r.bpm,
                bpmRel: bpmRelation(t.an_bpm, r.bpm), ourCam: t.an_camelot, rbCam: r.camelot,
                keyRel: r.camelot ? keyRelation(t.an_camelot, r.camelot) : "none" });
  }
  const n = rows.length || 1, c = (f, v) => rows.filter(x => x[f] === v).length;
  const withKey = rows.filter(r => r.keyRel !== "none"), nk = withKey.length || 1, ck = v => withKey.filter(x => x.keyRel === v).length;
  return {
    count: rows.length, keyCount: withKey.length,
    bpmPct: Math.round((c("bpmRel", "same") + c("bpmRel", "close")) / n * 100),
    bpmHalf: c("bpmRel", "halfdouble"), bpmDiff: c("bpmRel", "diff"),
    keyPct: Math.round(ck("same") / nk * 100),
    keyCompatPct: Math.round((ck("same") + ck("relative") + ck("neighbor")) / nk * 100),
    keyDiff: ck("diff"),
    mismatches: rows.filter(r => !["same", "close"].includes(r.bpmRel) || (r.keyRel !== "same" && r.keyRel !== "none")).slice(0, 500),
  };
}

const classicKey = t => {
  const k = (t.key || "").trim(), p = k.split(/\s+/);
  if (p.length === 2 && /^(maj|min)/i.test(p[1])) return p[0] + (/^min/i.test(p[1]) ? "m" : "");
  return k;
};

/** playlists: {ad: [id, ...]} ; basePath: kök klasörün bilgisayardaki tam yolu (ör. C:/Users/x/Music/DJ) */
export function buildPlaylistXML(playlists, trackById, basePath, folderName = "Setkey") {
  const used = [];
  for (const ids of Object.values(playlists)) for (const id of ids) if (trackById[id] && !used.includes(id)) used.push(id);
  const base = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">',
    '  <PRODUCT Name="Setkey" Version="1.0" Company=""/>', `  <COLLECTION Entries="${used.length}">`];
  const key = {};
  used.forEach((id, i) => {
    const t = trackById[id]; key[id] = i + 1;
    let attrs = `TrackID="${i + 1}" Name="${xml(t.title || t.file)}" Artist="${xml(t.artist)}" Kind="${/\.mp3$/i.test(id) ? "MP3 File" : "Audio File"}" TotalTime="${Math.round(t.duration || 0)}" Location="${xml(pathToLocation(base + "/" + id))}"`;
    if (t.bpm) attrs += ` AverageBpm="${(+t.bpm).toFixed(2)}"`;
    if (classicKey(t)) attrs += ` Tonality="${xml(classicKey(t))}"`;
    lines.push(`    <TRACK ${attrs}/>`);
  });
  lines.push("  </COLLECTION>", "  <PLAYLISTS>", '    <NODE Type="0" Name="ROOT" Count="1">',
             `      <NODE Type="0" Name="${xml(folderName)}" Count="${Object.keys(playlists).length}">`);
  for (const [name, ids] of Object.entries(playlists)) {
    const ok = ids.filter(id => key[id]);
    lines.push(`        <NODE Name="${xml(name)}" Type="1" KeyType="0" Entries="${ok.length}">`);
    ok.forEach(id => lines.push(`          <TRACK Key="${key[id]}"/>`));
    lines.push("        </NODE>");
  }
  lines.push("      </NODE>", "    </NODE>", "  </PLAYLISTS>", "</DJ_PLAYLISTS>");
  return lines.join("\n");
}
