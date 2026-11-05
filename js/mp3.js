// WAV -> MP3: dönüştürme ayrı bir işçide (worker) yapılır, sayfa donmaz
const MAJ = { "C": "C", "C#": "Db", "D": "D", "D#": "Eb", "E": "E", "F": "F", "F#": "F#", "G": "G", "G#": "Ab", "A": "A", "A#": "Bb", "B": "B" };

/** 'A minor' -> 'Am', 'Eb major' -> 'Eb' (MP3 TKEY etiketi için yaygın yazım) */
export function keyTag(key) {
  const m = String(key || "").match(/^([A-G][#b]?)\s*(major|minor|maj|min|m)?$/i);
  if (!m) return "";
  const minor = /^m(in(or)?)?$/i.test(m[2] || "");
  const n = m[1][0].toUpperCase() + (m[1][1] || "");
  return (MAJ[n] || n) + (minor ? "m" : "");
}

export const isWav = name => /\.wav$/i.test(name);
export const mp3Name = name => name.replace(/\.wav$/i, ".mp3");

/** file: WAV File/Blob. tags: {title, artist, bpm, key, comment}. Sonuç: MP3 Blob */
export function wavToMp3(file, { bitrate = 320, tags = {} } = {}, onProgress = null) {
  return new Promise(async (resolve, reject) => {
    const buf = await file.arrayBuffer();
    const w = new Worker(new URL("./mp3-worker.js", import.meta.url));
    w.onmessage = e => {
      const d = e.data;
      if (d.progress != null) { onProgress && onProgress(d.progress); return; }
      w.terminate();
      if (d.error) reject(new Error(d.error)); else resolve(new Blob([d.mp3], { type: "audio/mpeg" }));
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || "worker_error")); };
    w.postMessage({ buf, bitrate, tags }, [buf]);
  });
}
