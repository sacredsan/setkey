// Dosya erişimi (File System Access API) ve tarayıcı içi küçük depo (IndexedDB)
// Hiçbir veri sunucuya gitmez: her şey kullanıcının bilgisayarında kalır.

export const AUDIO_EXT = [".mp3", ".wav", ".flac", ".m4a", ".aiff", ".aif", ".ogg"];
export const LIB_FILE = "setkey-kutuphane.json";
export const OLD_LIB_FILE = "djstudio-kutuphane.json";      // eski ad (DJ Studio): varsa okunur, yeni adla kaydedilir

export const supported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickDirectory(id = "djstudio-root", mode = "readwrite") {
  return await window.showDirectoryPicker({ id, mode });
}

export async function ensurePermission(handle, write = false) {
  const opts = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

export const hasPermission = async (handle, write = false) =>
  (await handle.queryPermission({ mode: write ? "readwrite" : "read" })) === "granted";

/** Klasörü (alt klasörler dahil) gezip ses dosyalarını verir: {id: 'Alt/şarkı.mp3', handle, dir} */
export async function* walkAudio(dir, prefix = "", recursive = true) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith(".") || name === "_kopyalar") continue;
    if (h.kind === "directory") {
      if (recursive) yield* walkAudio(h, prefix + name + "/", true);
    } else if (AUDIO_EXT.some(e => name.toLowerCase().endsWith(e))) {
      yield { id: prefix + name, handle: h, dir };
    }
  }
}

export async function getFileHandle(root, id) {
  const parts = id.split("/");
  let d = root;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  return { handle: await d.getFileHandle(parts[parts.length - 1]), dir: d };
}

export async function readText(dir, name) {
  try { return await (await (await dir.getFileHandle(name)).getFile()).text(); } catch (e) { return null; }
}

export async function writeText(dir, name, text) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text); await w.close();
}

export async function copyFileTo(srcHandle, destDir, name) {
  const f = await srcHandle.getFile();
  const dst = await destDir.getFileHandle(name, { create: true });
  try {
    const old = await dst.getFile();
    if (old.size === f.size) return "exists";
  } catch (e) {}
  const w = await dst.createWritable();
  await f.stream().pipeTo(w);
  return "copied";
}

export async function subDir(dir, name) { return await dir.getDirectoryHandle(name, { create: true }); }

/** Kullanıcının bilgisayarına dosya kaydettirir (indirme gibi) */
export async function saveFile(name, text, mime = "text/plain") {
  if (window.showSaveFilePicker) {
    try {
      const ext = name.slice(name.lastIndexOf("."));
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext, accept: { [mime]: [ext] } }] });
      const w = await h.createWritable(); await w.write(text); await w.close(); return true;
    } catch (e) { if (e.name === "AbortError") return false; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

export async function openTextFile(accept = { "text/xml": [".xml"] }) {
  const [h] = await window.showOpenFilePicker({ types: [{ description: "XML", accept }] });
  return { name: h.name, text: await (await h.getFile()).text() };
}

// ── IndexedDB: klasör tutamaçlarını ve kütüphanenin yedeğini tarayıcıda saklar ──
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("djstudio-web", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbGet(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => { const q = d.transaction("kv").objectStore("kv").get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  } catch (e) { return undefined; }
}
export async function idbSet(key, val) {
  try {
    const d = await db();
    await new Promise((res, rej) => { const tx = d.transaction("kv", "readwrite"); tx.objectStore("kv").put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) {}
}
