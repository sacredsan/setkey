// Mantık testleri — çalıştırma: node tests/logic.test.mjs
import { toCamelot } from "../js/camelot.js";
import * as PL from "../js/playlist.js";
import * as RB from "../js/rekordbox.js";
import { Library, foldBpm } from "../js/library.js";

const passed = [], failed = [];
const check = (name, cond, detail = "") => (cond ? passed : failed).push(name + (cond ? "" : "  →  " + detail));

// Camelot
const cases = { "A Minor": "8A", Am: "8A", "C Major": "8B", C: "8B", "F# Minor": "11A", "Gb major": "2B", Bbm: "3A",
  Eb: "5B", "G#m": "1A", "D minor": "7A", E: "12B", "8a": "8A", Abm: "1A", Db: "3B", "1m": "8A", "1d": "8B", "6m": "1A", "12m": "7A", "4d": "11B" };
for (const [k, v] of Object.entries(cases)) check(`Camelot ${k} -> ${v}`, toCamelot(k) === v, toCamelot(k));

// Playlist
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const cams = []; for (let i = 1; i <= 12; i++) cams.push(i + "A", i + "B");
const T = Array.from({ length: 80 }, (_, i) => ({ id: `m/${i}.mp3`, bpm: Math.round((118 + rnd() * 22) * 10) / 10,
  camelot: cams[Math.floor(rnd() * 24)], energy: 1 + Math.floor(rnd() * 10), duration: 200 }));
const up = PL.smart(T, { length: 12, start: "slow", shape: "warmup" });
check("Isınmada BPM düşmüyor", up.every((t, i) => !i || t.bpm >= up[i - 1].bpm - 0.3), up.map(t => t.bpm).join(","));
const dn = PL.smart(T, { length: 12, start: "fast", shape: "cooldown" });
check("Kapanışta BPM yükselmiyor", dn.every((t, i) => !i || t.bpm <= dn[i - 1].bpm + 0.3), dn.map(t => t.bpm).join(","));
check("Şarkı sayısı", up.length === 12);
check("Tekrar yok", new Set(up.map(t => t.id)).size === up.length);
const T2 = [...T, { id: "out.mp3", bpm: 98, camelot: "8A", duration: 200 }];
check("Uç değere takılmıyor", PL.smart(T2, { length: 10 })[0].bpm > 100);
check("Bu şarkıyla başla", PL.smart(T, { length: 10, startId: "m/5.mp3" })[0].id === "m/5.mp3");
const lk = PL.locked(T, { tolerance: 2 });
check("BPM kilidi", lk.every((t, i) => lk.slice(0, i).every(o => o.bpm <= t.bpm + 2.0001)));
check("Rapor", PL.report(up).total === 11);

// BPM katlama
check("Katlama 64->128", Math.abs(foldBpm(64, 85, 175) - 128) < 0.01);
check("Katlama 180->90", Math.abs(foldBpm(180, 80, 160) - 90) < 0.01);

// Rekordbox
const lib = { "DanceParty100/Şarkı 1 & Co.mp3": { id: "DanceParty100/Şarkı 1 & Co.mp3", title: "Şarkı 1", artist: "DJ Ç", bpm: 126, key: "A Minor", camelot: "8A", duration: 300, file: "Şarkı 1 & Co.mp3" } };
const xmlText = RB.buildPlaylistXML({ "Test Set": Object.keys(lib) }, lib, "C:/Users/M/Music/DJ Downloads");
const coll = RB.parseCollection(xmlText);
check("XML yol gidip geliyor", coll[0]?.path === "C:/Users/M/Music/DJ Downloads/DanceParty100/Şarkı 1 & Co.mp3", coll[0]?.path);
check("XML BPM/ton", coll[0]?.bpm === 126 && coll[0]?.camelot === "8A", JSON.stringify(coll[0]));
const mt = RB.matchToLibrary(coll, Object.keys(lib), "DJ Downloads");
check("Eşleştirme + kök yolu öğrenme", mt.matched === 1 && mt.basePath === "C:/Users/M/Music/DJ Downloads", JSON.stringify(mt.basePath));
const mac = RB.parseCollection('<DJ_PLAYLISTS><COLLECTION><TRACK Location="file://localhost/Users/me/Music/DJ/a%20b.mp3" AverageBpm="128.00" Tonality="6m"/></COLLECTION></DJ_PLAYLISTS>');
check("macOS yolu + Open Key", mac[0].path === "/Users/me/Music/DJ/a b.mp3" && mac[0].camelot === "1A", JSON.stringify(mac[0]));
check("İlişki: yarım/çift", RB.bpmRelation(128, 64) === "halfdouble");
check("İlişki: eşi / komşu", RB.keyRelation("8A", "8B") === "relative" && RB.keyRelation("8A", "9A") === "neighbor");

// Kütüphane görünümü
const L = new Library();
L.tracks = { "a.mp3": { id: "a.mp3", bpm: 64, camelot: "3A", key: "Bb minor", energy_raw: 0.3 }, "b.mp3": { id: "b.mp3", bpm: 128, camelot: "8A", energy_raw: 0.6 } };
L.rb = { "b.mp3": { bpm: 127.9, camelot: "9A", key: "Em" } };
check("Görünüm: Rekordbox değeri öncelikli", L.get("b.mp3").bpm === 127.9 && L.get("b.mp3").src === "rekordbox");
check("Görünüm: 'ours' kaynağı bizim değer", L.get("b.mp3", "ours").bpm === 128);
L.settings.bpm_lo = 85; L.settings.bpm_hi = 175;
check("Görünüm: BPM aralığı katlama", L.get("a.mp3").bpm === 128);
check("Liste: rb kaynağı sadece Rekordbox tonlu", L.list("rb").length === 1);
check("Enerji sıralaması 1-10", L.get("a.mp3").energy === 1 && L.get("b.mp3").energy === 10);
const moved = L.relink([{ id: "yeni/a.mp3", size: undefined }]);
check("Taşınan dosya tanınıyor", moved === 1 && L.tracks["yeni/a.mp3"]);


// ── Bilinçli ton yönü ──
{
  const mk = (id, bpm, cam) => ({ id, bpm, camelot: cam, duration: 300 });
  // 8A'dan başla: 7A ve 9A eşit uzaklıkta. Isınmada 9A (ileri), kapanışta 7A (geri) seçilmeli
  const K = [mk("a", 124, "8A"), mk("b", 124, "9A"), mk("c", 124, "7A")];
  const w = PL.smart(K, { length: 2, startId: "a", shape: "warmup" });
  check("Isınmada çarkta ileri (8A → 9A)", w[1].camelot === "9A");
  const c = PL.smart(K, { length: 2, startId: "a", shape: "cooldown" });
  check("Kapanışta çarkta geri (8A → 7A)", c[1].camelot === "7A");
  // Aynı ton üst üste 3 kez olmasın (komşu ton varsa)
  const R = [mk("a", 124, "8A"), mk("b", 124.2, "8A"), mk("c", 124.4, "8A"), mk("d", 124.6, "9A")];
  const r = PL.smart(R, { length: 3, startId: "a", shape: "warmup" });
  check("Aynı tonda 3. kez kalmıyor", r[2].camelot === "9A");
  check("camStep 12A → 1A = +1", PL.camStep("12A", "1A") === 1 && PL.camStep("1A", "12A") === -1);
}

// ── Çelişen seçim düzeltmesi ve aşağı dalga ──
{
  const mk = (id, bpm, cam) => ({ id, bpm, camelot: cam, duration: 300 });
  const U = [...Array(12)].map((_, i) => mk("u" + i, 120 + i, (1 + i) + "A"));
  const c = PL.smart(U, { length: 8, start: "slow", shape: "cooldown" });
  check("Yavaş + Kapanış → en hızlıdan başlar", c[0].bpm === 131 && c.length === 8 && c.notes.includes("fix_to_fast"));
  const w = PL.smart(U, { length: 8, start: "fast", shape: "warmup" });
  check("Hızlı + Isınma → en yavaştan başlar", w[0].bpm === 120 && w.notes.includes("fix_to_slow"));
  const v = PL.smart(U, { length: 8, start: "fast", shape: "wave" });
  check("Tepeden Dalga aşağı iner", v.some(x => x.bpm < 131));
}

// ── Enerji yönü ve "bunun yerine" ──
{
  const mk = (id, bpm, cam, energy) => ({ id, bpm, camelot: cam, energy, duration: 300 });
  const E = [mk("a", 124, "8A", 5), mk("b", 124, "9A", 3), mk("c", 124, "9A", 7)];
  check("Isınmada enerjisi yükselen seçilir", PL.smart(E, { length: 2, startId: "a", shape: "warmup" })[1].id === "c");
  check("Kapanışta enerjisi düşen seçilir", PL.smart(E, { length: 2, startId: "a", shape: "cooldown" })[1].id === "b");
  const list = [mk("p", 124, "8A", 5), mk("x", 124, "3B", 5), mk("n", 125, "9A", 5)];
  const pool = [...list, mk("good", 124.5, "8A", 5), mk("bad", 131, "2B", 5), mk("ok", 124.5, "9A", 5)];
  const alt = PL.alternatives(list, 1, pool, 3);
  check("Öneri: listedekiler önerilmez", alt.every(a => !["p", "x", "n"].includes(a.track.id)));
  check("Öneri: en uyumlu başta", ["good", "ok"].includes(alt[0].track.id) && alt[alt.length - 1].track.id === "bad");
}

// ── WAV/MP3 ikilisi tek sayılır ──
{
  const mk = (id, bpm, cam) => ({ id, bpm, camelot: cam, duration: 300 });
  const D = [mk("a/x.wav", 124, "8A"), mk("a/x.mp3", 124, "8A"), mk("y.mp3", 125, "9A")];
  const r = PL.smart(D, { shape: "warmup" });
  check("WAV+MP3 aynı şarkı bir kez girer (MP3)", r.length === 2 && r.some(t => t.id === "a/x.mp3") && !r.some(t => t.id === "a/x.wav"));
  const alt = PL.alternatives([mk("y.mp3", 125, "9A"), mk("a/x.wav", 124, "8A")], 0, D, 3);
  check("Öneri: listedeki şarkının MP3'ü önerilmez", alt.length === 0);
}
console.log(passed.map(p => "  ✔ " + p).join("\n"));
console.log(failed.map(p => "  ✘ " + p).join("\n"));
console.log(`\n  SONUÇ: ${passed.length} başarılı, ${failed.length} hatalı`);
process.exit(failed.length ? 1 : 0);
