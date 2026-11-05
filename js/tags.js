// MP3 etiketlerinden (ID3v2) şarkı adı / sanatçı / tür okur. Yoksa dosya adından tahmin eder.

function decodeText(bytes) {
  const enc = bytes[0], b = bytes.subarray(1);
  try {
    if (enc === 0) return new TextDecoder("latin1").decode(b);
    if (enc === 1) return new TextDecoder("utf-16").decode(b);          // BOM'lu
    if (enc === 2) return new TextDecoder("utf-16be").decode(b);
    return new TextDecoder("utf-8").decode(b);
  } catch (e) { return ""; }
}
const clean = s => (s || "").replace(/\0+$/g, "").split("\0")[0].trim();
const syncsafe = (a, i) => (a[i] << 21) | (a[i + 1] << 14) | (a[i + 2] << 7) | a[i + 3];

export async function readTags(file) {
  const out = { title: "", artist: "", genre: "" };
  try {
    if (/\.mp3$/i.test(file.name)) {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {            // "ID3"
        const ver = head[3], size = syncsafe(head, 6);
        const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 512 * 1024)).arrayBuffer());
        let i = (head[5] & 0x40) ? (ver === 4 ? syncsafe(buf, 0) : ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) + 4) : 0;
        while (i + 10 <= buf.length) {
          const id = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
          if (!/^[A-Z0-9]{4}$/.test(id)) break;
          const fsz = ver === 4 ? syncsafe(buf, i + 4) : ((buf[i + 4] << 24) | (buf[i + 5] << 16) | (buf[i + 6] << 8) | buf[i + 7]);
          if (fsz <= 0 || i + 10 + fsz > buf.length) break;
          const data = buf.subarray(i + 10, i + 10 + fsz);
          if (id === "TIT2") out.title = clean(decodeText(data));
          else if (id === "TPE1") out.artist = clean(decodeText(data));
          else if (id === "TCON") out.genre = clean(decodeText(data));
          i += 10 + fsz;
        }
      }
    }
  } catch (e) {}
  if (!out.title) {
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/^\d{1,3}\s*[-_.]\s*/, "");
    const m = stem.split(" - ");
    if (m.length > 1 && !out.artist) { out.artist = m[0].trim(); out.title = m.slice(1).join(" - ").trim(); }
    else out.title = stem;
  }
  return out;
}
