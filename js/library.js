// Kütüphane: analiz sonuçları + Rekordbox değerleri + ayarlar + playlist'ler
// Kalıcı kayıt: kullanıcının müzik klasöründeki setkey-kutuphane.json (+ tarayıcıda yedek)
import { toCamelot } from "./camelot.js";
import { LIB_FILE, OLD_LIB_FILE, readText, writeText, idbGet, idbSet } from "./fsutil.js";

export const DEFAULTS = {
  use_rb: true, bpm_lo: 0, bpm_hi: 0, key_strategy: { type: "profile", profile: "edma" },
  playlist_source: "ours", playlist_name: "Yeni Set", rb_base: "", rb_export_shown: false,
  copy_numbered: true, copy_m3u: true, lang: "", skip_used: false,
};

export function foldBpm(bpm, lo, hi) {
  if (!bpm || !lo || !hi || hi <= lo) return bpm;
  while (bpm > hi && bpm / 2 >= lo * 0.98) bpm /= 2;
  while (bpm < lo && bpm * 2 <= hi * 1.02) bpm *= 2;
  return bpm;
}

export class Library {
  constructor() {
    this.root = null; this.rootName = "";
    this.tracks = {};          // id -> analiz kaydı (ham)
    this.rb = {};              // id -> Rekordbox kaydı
    this.settings = { ...DEFAULTS };
    this.playlist = [];        // id listesi
    this.rbPlaylists = {};     // Rekordbox'a gönderilenler {ad: [id]}
    this.used = {};            // kullanılan şarkılar {id: {n: kaç kez, last: 'YYYY-AA-GG', sets: [set adları]}}
    this._erank = null; this._saveTimer = null; this.canWrite = false;
    this.onSaveError = null;
  }

  // ── Kalıcılık ──
  snapshot() {
    return { app: "Setkey", version: 1, saved: new Date().toISOString(), root: this.rootName,
             tracks: this.tracks, rb: this.rb, settings: this.settings, playlist: this.playlist, rbPlaylists: this.rbPlaylists, used: this.used };
  }
  load(data) {
    if (!data) return;
    this.tracks = data.tracks || {}; this.rb = data.rb || {};
    this.settings = { ...DEFAULTS, ...(data.settings || {}) };
    this.playlist = data.playlist || []; this.rbPlaylists = data.rbPlaylists || {}; this.used = data.used || {};
    for (const r of Object.values(this.rb)) if (!r.camelot && r.key) r.camelot = toCamelot(r.key);
    this._erank = null;
  }
  async openRoot(root, canWrite) {
    this.root = root; this.rootName = root.name; this.canWrite = canWrite;
    const txt = (await readText(root, LIB_FILE)) || (await readText(root, OLD_LIB_FILE));
    let data = null;
    if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
    if (!data) data = await idbGet("lib:" + root.name);          // klasörde yoksa tarayıcıdaki yedek
    this.load(data || {});
    return !!data;
  }
  /** Kaydı sıraya koyar: yazmalar asla üst üste binmez (aksi halde dosya bir an boş kalabilir). */
  save(now = false) {
    clearTimeout(this._saveTimer); this._saveTimer = null;
    this._erank = null;
    const run = async () => {
      const snap = this.snapshot();
      await idbSet("lib:" + this.rootName, snap);
      if (this.root && this.canWrite) {
        try { await writeText(this.root, LIB_FILE, JSON.stringify(snap)); }
        catch (e) { this.onSaveError && this.onSaveError(e); }
      }
    };
    const go = () => { this._saveTimer = null; this._chain = (this._chain || Promise.resolve()).then(run, run); return this._chain; };
    if (now) return go();
    this._saveTimer = setTimeout(go, 800);
    this._pending = go;
  }
  /** Bekleyen kaydı hemen başlatır (sayfa kapanırken) */
  flush() { if (this._saveTimer) { clearTimeout(this._saveTimer); return this._pending(); } return this._chain; }

  // ── Birleşik görünüm (kullanılan değerler) ──
  energyRanks() {
    if (!this._erank) {
      const vals = Object.entries(this.tracks)
        .filter(([, t]) => !t.error && (t.energy_raw != null || t.energy))
        .map(([id, t]) => [t.energy_raw != null ? t.energy_raw : (t.energy || 0) / 10, id]).sort((a, b) => a[0] - b[0]);
      const n = vals.length; this._erank = {};
      vals.forEach(([, id], i) => { this._erank[id] = 1 + Math.round(9 * i / Math.max(n - 1, 1)); });
    }
    return this._erank;
  }
  /** source: null = genel tercih, 'ours' = bizim analiz, 'rb' = Rekordbox */
  view(t, source = null) {
    if (!t) return null;
    const s = this.settings, v = { ...t };
    v.an_bpm = t.bpm || 0; v.an_key = t.key || ""; v.an_camelot = t.camelot || ""; v.src = t.engine || "essentia";
    if (s.bpm_lo && s.bpm_hi && v.bpm) v.bpm = Math.round(foldBpm(v.bpm, s.bpm_lo, s.bpm_hi) * 10) / 10;
    const r = this.rb[t.id];
    if (r) {
      v.rb_bpm = r.bpm; v.rb_camelot = r.camelot; v.rb_key = r.key;
      if (source === "rb" || (source === null && s.use_rb)) {
        if (r.bpm) v.bpm = r.bpm;
        if (r.camelot) { v.camelot = r.camelot; v.key = r.key; v.key_conf = 1; }
        v.bpm_conf = 1; v.src = "rekordbox";
      }
    }
    if (t.bpm_manual) { v.bpm = t.bpm_manual; v.bpm_conf = 1; }
    const er = this.energyRanks()[t.id];
    if (er) { v.energy_abs = t.energy; v.energy = er; }
    v.used = this.used[t.id] || null;
    return v;
  }
  get(id, source = null) { return this.view(this.tracks[id], source); }
  list(source = null) {
    const all = Object.values(this.tracks);
    if (source === "rb") return all.filter(t => this.rb[t.id]?.bpm && this.rb[t.id]?.camelot).map(t => ({ ...this.view(t, "rb"), error: null }));
    if (source === "ours") return all.filter(t => t.engine !== "rekordbox" && !t.error && t.bpm).map(t => this.view(t, "ours"));
    return all.map(t => this.view(t, source));
  }

  needsAnalysis(id, file) {
    const t = this.tracks[id];
    if (!t || t.error || t.engine === "rekordbox") return true;   // Rekordbox'tan gelen analizsiz kayıt
    return t.size !== file.size || Math.abs((t.mtime || 0) - file.lastModified) > 1000;
  }
  put(rec) {
    const old = this.tracks[rec.id];
    if (old?.bpm_manual && rec.bpm_manual == null) rec.bpm_manual = old.bpm_manual;
    this.tracks[rec.id] = rec; this._erank = null;
  }
  /** Taşınmış dosyalar: aynı ad + aynı boyut -> kaydı yeni yere aktar */
  relink(found) {
    const ids = new Set(found.map(f => f.id));
    const missing = Object.keys(this.tracks).filter(id => !ids.has(id));
    if (!missing.length) return 0;
    const idx = new Map();
    for (const f of found) if (!this.tracks[f.id]) idx.set(f.id.split("/").pop().toLowerCase() + "|" + f.size, f.id);
    let moved = 0;
    for (const id of missing) {
      const t = this.tracks[id], k = id.split("/").pop().toLowerCase() + "|" + t.size, nid = idx.get(k);
      if (!nid) continue;
      idx.delete(k); delete this.tracks[id];
      t.id = nid; t.file = nid.split("/").pop(); t.folder = nid.split("/").slice(0, -1).join("/");
      this.tracks[nid] = t;
      if (this.rb[id]) { this.rb[nid] = this.rb[id]; delete this.rb[id]; }
      this.playlist = this.playlist.map(x => x === id ? nid : x);
      if (this.used[id]) { this.used[nid] = this.used[id]; delete this.used[id]; }
      for (const n in this.rbPlaylists) this.rbPlaylists[n] = this.rbPlaylists[n].map(x => x === id ? nid : x);
      moved++;
    }
    this._erank = null;
    return moved;
  }
  // ── Kullanılan şarkılar (Rekordbox'a gönderilen / USB'ye kopyalanan) ──
  markUsed(ids, setName = "") {
    const today = new Date().toISOString().slice(0, 10);
    for (const id of ids) {
      const u = this.used[id] || { n: 0, last: "", sets: [] };
      if (!(u.last === today && setName && u.sets.includes(setName))) u.n++;   // aynı seti aynı gün tekrar göndermek sayılmaz
      u.last = today;
      if (setName) u.sets = [setName, ...u.sets.filter(s => s !== setName)].slice(0, 5);
      this.used[id] = u;
    }
  }
  unuse(ids) { for (const id of ids) delete this.used[id]; }

  removeMissing(foundIds) {
    const ids = new Set(foundIds); let n = 0;
    for (const id of Object.keys(this.tracks)) if (!ids.has(id)) { delete this.tracks[id]; n++; }
    this.playlist = this.playlist.filter(id => this.tracks[id]);
    this._erank = null; return n;
  }
}
