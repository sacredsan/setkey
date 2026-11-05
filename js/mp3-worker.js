// WAV -> MP3 dönüştürücü (klasik Web Worker). Her şey tarayıcıda olur, hiçbir şey sunucuya gitmez.
// MP3 kodlayıcı: LAME (lamejs, LGPL-3.0) — https://lame.sourceforge.io , https://github.com/zhuker/lamejs
importScripts("../vendor/lame.min.js");

const RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

/** WAV başlığını çözer: format, kanal, örnekleme hızı, veri yeri ve (varsa) LIST/INFO etiketleri */
function parseWav(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
  if (str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") throw new Error("not_wav");
  let p = 12, fmt = null, data = null; const info = {};
  while (p + 8 <= buf.byteLength) {
    const id = str(p, 4), size = v.getUint32(p + 4, true), body = p + 8;
    if (id === "fmt ") {
      let format = v.getUint16(body, true);
      const ch = v.getUint16(body + 2, true), rate = v.getUint32(body + 4, true), bits = v.getUint16(body + 14, true);
      if (format === 0xFFFE && size >= 26) format = v.getUint16(body + 24, true);   // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, ch, rate, bits };
    } else if (id === "data") {
      data = { off: body, len: Math.min(size, buf.byteLength - body) };
    } else if (id === "LIST" && str(body, 4) === "INFO") {
      let q = body + 4;
      while (q + 8 <= body + size) {
        const k = str(q, 4), n = v.getUint32(q + 4, true);
        const txt = new TextDecoder().decode(u8.subarray(q + 8, q + 8 + n)).replace(/\0+$/, "").trim();
        if (k === "INAM") info.title = txt; if (k === "IART") info.artist = txt;
        q += 8 + n + (n & 1);
      }
    }
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("bad_wav");
  if (![1, 3].includes(fmt.format)) throw new Error("wav_codec");
  return { ...fmt, ...data, info };
}

/** Sesi 16-bit tam sayıya çevirir (8/16/24/32-bit PCM ya da 32/64-bit float) */
function reader(w, v) {
  const bps = w.bits / 8;
  if (w.format === 3) return w.bits === 64 ? o => v.getFloat64(o, true) : o => v.getFloat32(o, true);
  if (w.bits === 8) return o => (v.getUint8(o) - 128) / 128;
  if (w.bits === 16) return o => v.getInt16(o, true) / 32768;
  if (w.bits === 24) return o => ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16))) / 8388608;
  if (w.bits === 32) return o => v.getInt32(o, true) / 2147483648;
  throw new Error("wav_codec");
}
const clip = x => x > 1 ? 32767 : x < -1 ? -32768 : Math.round(x * 32767);

/** ID3v2.3 etiketi (UTF-16): TIT2 başlık, TPE1 sanatçı, TBPM, TKEY (Rekordbox bunları okur) */
function id3(tags) {
  const frames = [];
  for (const [id, val] of [["TIT2", tags.title], ["TPE1", tags.artist], ["TBPM", tags.bpm], ["TKEY", tags.key], ["COMM", tags.comment]]) {
    if (val == null || val === "") continue;
    const s = String(val), body = [1];                       // 1 = UTF-16 (BOM ile)
    if (id === "COMM") body.push(0x65, 0x6e, 0x67, 0xff, 0xfe, 0, 0);   // dil "eng" + boş açıklama
    body.push(0xff, 0xfe);
    for (const ch of s) { const c = ch.charCodeAt(0); body.push(c & 255, c >> 8); }
    const n = body.length;
    frames.push(...[...id].map(c => c.charCodeAt(0)), (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, 0, 0, ...body);
  }
  if (!frames.length) return new Uint8Array(0);
  const n = frames.length;
  return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127, ...frames]);
}

onmessage = e => {
  const { buf, bitrate = 320, tags = {} } = e.data;
  try {
    const w = parseWav(buf), v = new DataView(buf), rd = reader(w, v);
    const frameBytes = w.ch * (w.bits / 8), frames = Math.floor(w.len / frameBytes);
    let f = 1; while (w.rate / f > 48000) f++;              // 88.2/96/192 kHz -> 44.1/48 kHz
    const outRate = Math.round(w.rate / f);
    if (!RATES.includes(outRate)) throw new Error("wav_rate");
    const chOut = Math.min(w.ch, 2), enc = new lamejs.Mp3Encoder(chOut, outRate, bitrate);
    const parts = [], BLOCK = 1152 * 8, L = new Int16Array(BLOCK), R = new Int16Array(BLOCK);
    let done = 0, lastP = 0;
    for (let fr = 0; fr < frames; ) {
      let k = 0;
      for (; k < BLOCK && fr < frames; k++) {
        let a = 0, b = 0, m = 0;
        for (let j = 0; j < f && fr < frames; j++, fr++, m++) {   // basit ortalama ile örnek düşürme
          const o = w.off + fr * frameBytes;
          a += rd(o); if (chOut === 2) b += rd(o + w.bits / 8);
        }
        L[k] = clip(a / m); if (chOut === 2) R[k] = clip(b / m);
      }
      const mp3 = chOut === 2 ? enc.encodeBuffer(L.subarray(0, k), R.subarray(0, k)) : enc.encodeBuffer(L.subarray(0, k));
      if (mp3.length) parts.push(new Uint8Array(mp3));
      done = fr / frames;
      if (done - lastP > 0.05) { lastP = done; postMessage({ progress: done }); }
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    const head = id3({ title: tags.title || w.info.title, artist: tags.artist || w.info.artist, bpm: tags.bpm, key: tags.key, comment: tags.comment });
    const total = head.length + parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total);
    out.set(head, 0); let o = head.length; for (const p of parts) { out.set(p, o); o += p.length; }
    postMessage({ mp3: out, rate: outRate, channels: chOut, duration: frames / w.rate }, [out.buffer]);
  } catch (err) { postMessage({ error: err.message || String(err) }); }
};
