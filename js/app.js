// Setkey — arayüz ve akış
// Her şey tarayıcıda çalışır; dosyalar kullanıcının bilgisayarından çıkmaz.
import { t, setLang, getLang, applyI18n } from "./i18n.js";
import * as FS from "./fsutil.js";
import { Library } from "./library.js";
import { readTags } from "./tags.js";
import { wavToMp3, keyTag, isWav, mp3Name } from "./mp3.js";
import { runPool, bestStrategy } from "./analyzer.js";
import * as PL from "./playlist.js";
import * as RB from "./rekordbox.js";
import { findDuplicates, moveToTrash } from "./dupes.js";
import { CAM_COLORS, camNum, camOfKey, toCamelot, camCompatible } from "./camelot.js";

const SOURCE_URL = "https://github.com/sacredsan/setkey";
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtT = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const camChip = c => c ? `<span class="cam" style="background:${CAM_COLORS[camNum(c)]}">${esc(c)}</span>` : `<span class="cam none">?</span>`;
const enBars = e => { let h = ""; for (let i = 1; i <= 5; i++) h += `<i class="${e && e / 2 >= i - 0.5 ? "on" : ""}" style="height:${4 + i * 2}px"></i>`; return `<div class="en" title="${t("energy")} ${e || "?"}/10">${h}</div>`; };
const P = n => t("pct", { n });   // yüzde yazımı: TR "%84", EN "84%"
const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`;

const LIB = new Library();
const S = { files: new Map(), libSel: new Set(), sort: { k: "title", d: 1 }, libLimit: 1000, startId: null,
            tasks: {}, dest: null, plMode: "smart", plSrc: "ours", calibBest: null };

function toast(msg, err) { const d = document.createElement("div"); d.className = "toast" + (err ? " err" : ""); d.textContent = msg; $("#toasts").append(d); setTimeout(() => d.remove(), err ? 7000 : 3500); }
function alertBox(msg) { const d = document.createElement("div"); d.className = "toast"; d.style.whiteSpace = "pre-wrap"; d.style.maxWidth = "540px";
  d.innerHTML = esc(msg) + `<div style="text-align:right;margin-top:10px"><button class="btn sm pri">OK</button></div>`; d.querySelector("button").onclick = () => d.remove(); $("#toasts").append(d); }
async function safe(fn) { try { return await fn(); } catch (e) { if (e && e.name === "AbortError") return; console.error(e); toast(t(e.message) || e.message, true); } }
LIB.onSaveError = e => toast(t("save_error") + " " + e.message, true);

/* ═════════════ Görev paneli ═════════════ */
function newTask(kind, title, total = 0) {
  const T = { kind, title, status: "running", total, done: 0, logs: [], error: null, cancelled: false };
  S.tasks[kind] = T; renderTask(kind); return T;
}
const tlog = (T, msg, level = "info") => { T.logs.push({ t: new Date().toLocaleTimeString(), msg, level }); if (T.logs.length > 400) T.logs.splice(0, 100); };
let rafPending = {};
function renderTask(kind) {
  if (rafPending[kind]) return; rafPending[kind] = true;
  requestAnimationFrame(() => {
    rafPending[kind] = false;
    const T = S.tasks[kind], box = $("#task-" + kind); if (!box) return;
    if (!T) { box.innerHTML = ""; return; }
    const pct = T.total ? Math.round(T.done / T.total * 100) : (T.status === "running" ? 0 : 100);
    const lg0 = box.querySelector(".log"), atBottom = !lg0 || lg0.scrollTop + lg0.clientHeight >= lg0.scrollHeight - 20;
    box.innerHTML = `<div class="task"><div class="top"><span>${T.status === "running" ? '<span class="spin"></span> ' : ""}${esc(T.title)} <span class="pill" style="margin-left:6px">${t("st_" + T.status)}</span></span>
      <span class="row"><span class="mono" style="color:var(--muted)">${T.done}/${T.total || "?"}</span>${T.status === "running" ? `<button class="btn sm" data-cancel="${kind}">${t("cancel")}</button>` : ""}</span></div>
      <div class="prog"><i style="width:${pct}%"></i></div>${T.error ? `<div class="hint" style="color:var(--bad)">${esc(T.error)}</div>` : ""}
      <div class="log">${T.logs.slice(-150).map(l => `<div class="${l.level}">${esc(l.t)}  ${esc(l.msg)}</div>`).join("")}</div></div>`;
    const c = box.querySelector("[data-cancel]"); if (c) c.onclick = () => { T.cancelled = true; };
    const lg = box.querySelector(".log"); if (lg && atBottom) lg.scrollTop = lg.scrollHeight;
  });
}
const running = kind => S.tasks[kind]?.status === "running";

/* ═════════════ Klasör açma ═════════════ */
async function openRoot(handle, fromPicker) {
  let canWrite = await FS.hasPermission(handle, true);
  if (!canWrite) canWrite = await FS.ensurePermission(handle, true).catch(() => false);
  if (!canWrite && !(await FS.ensurePermission(handle, false))) throw new Error("perm_denied");
  const had = await LIB.openRoot(handle, canWrite);
  if (location.hash !== "#test") await FS.idbSet("root", handle);   // bir dahaki ziyarette "Devam et" için
  $("#welcome").hidden = true;
  $("#root-name").textContent = handle.name;
  if (!canWrite) toast(t("readonly_warn"), true);
  if (LIB.settings.lang && !fromPicker) setLang(LIB.settings.lang);
  applySettingsToUI();
  await scanFiles();
  go(localStorage.getItem("djw-page") || "lib");
  if (!had) toast(t("first_open"));
}
async function scanFiles() {
  $("#root-stat").textContent = t("scanning");
  const map = new Map(), found = [];
  for await (const f of FS.walkAudio(LIB.root, "", $("#lib-rec").checked)) {
    try { const file = await f.handle.getFile(); f.size = file.size; f.mtime = file.lastModified; } catch (e) {}
    map.set(f.id, f); found.push(f);
  }
  S.files = map;
  const moved = LIB.relink(found);
  if (moved) { toast(t("relinked", { n: moved })); LIB.save(); }
  updateRootStat(); renderLib(); fillFolderSelect(); renderPl();
  return found;
}
function updateRootStat() {
  const n = S.files.size, a = Object.values(LIB.tracks).filter(x => x.engine !== "rekordbox" && !x.error && x.bpm).length;
  $("#root-stat").textContent = t("root_stat", { n, a });
  const b = $("#b-lib"); b.hidden = !a; b.textContent = a;
}

/* ═════════════ Navigasyon ═════════════ */
function go(p) {
  if (!["lib", "pl", "cp", "tools"].includes(p)) p = "lib";
  $$("#nav button").forEach(b => b.classList.toggle("on", b.dataset.p === p));
  $$(".page").forEach(s => s.classList.toggle("on", s.id === "p-" + p));
  try { localStorage.setItem("djw-page", p); } catch (e) {}
  if (p === "pl") renderPl();
  if (p === "cp") updateCopySummary();
  if (p === "tools") updateWavCount();
}
$$("#nav button").forEach(b => b.onclick = () => go(b.dataset.p));

/* ═════════════ Oynatıcı ═════════════ */
const audio = $("#audio"); let nowId = "", nowUrl = "", cuePt = 0;
async function play(tr) {
  if (nowId === tr.id && !audio.paused) { audio.pause(); return; }
  if (nowId !== tr.id) {
    const f = S.files.get(tr.id); if (!f) return toast(t("file_missing"), true);
    if (nowUrl) URL.revokeObjectURL(nowUrl);
    nowUrl = URL.createObjectURL(await f.handle.getFile()); audio.src = nowUrl; nowId = tr.id;
    $("#pl-t").textContent = tr.title || tr.file; $("#pl-a").textContent = tr.artist || tr.folder || "";
    $("#deck-key").innerHTML = tr.camelot ? camChip(tr.camelot) : ""; $("#deck-bpm").textContent = tr.bpm ? (+tr.bpm).toFixed(1) + " BPM" : "";
    audio.addEventListener("loadedmetadata", () => {
      cuePt = audio.duration > 90 ? audio.duration * 0.35 : 0; audio.currentTime = cuePt;
      $("#deck-len").textContent = fmtT(audio.duration);
      const m = $("#pl-cuemark"); m.hidden = false; m.style.left = (cuePt / audio.duration * 100) + "%"; }, { once: true });
  }
  audio.play().catch(e => toast(e.message, true));
}
$("#pl-btn").onclick = () => { if (nowId) audio.paused ? audio.play() : audio.pause(); };
// CUE: işaret noktasına (giriş, %35) dön ve dur — CDJ'deki gibi
$("#deck-cue").onclick = () => { if (!nowId) return; audio.pause(); audio.currentTime = cuePt; };
audio.ontimeupdate = () => { const pc = audio.currentTime / (audio.duration || 1) * 100; $("#pl-fill").style.width = pc + "%"; $("#pl-bar").setAttribute("aria-valuenow", Math.round(pc)); $("#pl-tm").textContent = fmtT(audio.currentTime); };
$("#pl-bar").onkeydown = e => { if (!audio.duration) return; if (e.key === "ArrowRight") audio.currentTime += 10; else if (e.key === "ArrowLeft") audio.currentTime -= 10; else return; e.preventDefault(); };
audio.onplay = audio.onpause = () => { $("#pl-btn").innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE; $("#pl-btn").classList.toggle("on", !audio.paused); markPlaying(); };
$("#pl-bar").onclick = e => { const r = e.currentTarget.getBoundingClientRect(); if (audio.duration) audio.currentTime = (e.clientX - r.left) / r.width * audio.duration; };
function markPlaying() { $$("[data-play]").forEach(b => { const on = b.dataset.play === nowId && !audio.paused; b.classList.toggle("on", on); b.innerHTML = on ? ICON_PAUSE : ICON_PLAY; }); }

/* ═════════════ Analiz ═════════════ */
async function analyze(force = false) {
  if (running("analyze")) throw new Error("already_running");
  await scanFiles();
  const todo = [...S.files.values()].filter(f => force || LIB.needsAnalysis(f.id, { size: f.size, lastModified: f.mtime }));
  const T = newTask("analyze", t("analysis_of", { name: LIB.rootName }), todo.length);
  tlog(T, t("found_todo", { n: S.files.size, m: todo.length }));
  if (!todo.length) { T.status = "done"; renderTask("analyze"); return; }
  tlog(T, t("engine_loading")); renderTask("analyze");
  let errors = 0;
  try {
    const n = await runPool(todo, {
      keyStrategy: LIB.settings.key_strategy, isCancelled: () => T.cancelled,
      onResult: async (it, r) => {
        const file = await it.handle.getFile().catch(() => null);
        const tags = file ? await readTags(file) : { title: it.id, artist: "" };
        const key = r.key ? `${r.key} ${r.scale}` : "";
        LIB.put({ id: it.id, file: it.id.split("/").pop(), folder: it.id.split("/").slice(0, -1).join("/"),
                  size: r.size ?? it.size, mtime: r.mtime ?? it.mtime, engine: "essentia", ...tags,
                  duration: r.duration || 0, bpm: r.bpm ? Math.round(r.bpm * 10) / 10 : 0, bpm_conf: r.bpm_conf || 0,
                  key, camelot: toCamelot(key), key_conf: Math.round((r.strength || 0) * 100) / 100,
                  energy: r.energy || 0, energy_raw: r.energy_raw, error: r.error || null });
        T.done++;
        if (r.error) { errors++; tlog(T, `${t("error")}  ${it.id}: ${r.error}`, "error"); }
        else tlog(T, `${(r.bpm || 0).toFixed(1).padStart(6)} BPM  ${(toCamelot(key) || "?").padStart(3)}  ${it.id}`);
        if (T.done % 10 === 0) { LIB.save(); updateRootStat(); }
        renderTask("analyze");
      } });
    if (T.done === todo.length) tlog(T, t("workers_used", { n }));
    await LIB.save(true);                 // önce kaydet, sonra "bitti" de
    T.status = T.cancelled ? "cancelled" : "done";
    if (errors) tlog(T, t("n_errors", { n: errors }), "error");
  } catch (e) { T.status = "error"; T.error = t(e.message) || e.message; await LIB.save(true); } updateRootStat(); renderLib(); fillFolderSelect(); renderTask("analyze");
  if (T.status === "done") toast(t("analysis_done"));
}
$("#lib-go").onclick = () => safe(() => analyze($("#lib-force").checked));
$("#root-scan").onclick = () => { go("lib"); safe(() => analyze(false)); };
$("#root-change").onclick = () => safe(async () => openRoot(await FS.pickDirectory(), true));

/* ═════════════ Kütüphane tablosu ═════════════ */
// 140 üstü BPM: çoğu zaman yarım tempolu şarkının çift ölçülmesi (BPM aralığı ayarlıysa ya da elle düzeltildiyse sayılmaz)
const fastSuspect = x => x.bpm > 140 && !x.bpm_manual && !(LIB.settings.bpm_lo && LIB.settings.bpm_hi);
function isLow(x) { if (x.error || !x.bpm || x.src === "rekordbox" || x.engine === "rekordbox") return false;
  return (x.key_conf > 0 && x.key_conf < 0.5) || x.bpm_conf < 0.3 || (x.camelot || "").endsWith("B") || fastSuspect(x); }
function lowWhy(x) { const r = []; if (x.key_conf > 0 && x.key_conf < 0.5) r.push(t("low_key", { p: Math.round(x.key_conf * 100) }));
  if (x.bpm_conf < 0.3) r.push(t("low_bpm", { p: Math.round(x.bpm_conf * 100) })); if ((x.camelot || "").endsWith("B")) r.push(t("low_major"));
  if (fastSuspect(x)) r.push(t("low_fast")); return r.join("; "); }
const SRC = { rekordbox: "RB", essentia: "ES" };
const srcTag = x => SRC[x.src] ? `<span class="src ${x.src}">${SRC[x.src]}</span>` : "";
function bpmTitle(x) { const p = []; if (x.rb_bpm) p.push(`Rekordbox: ${x.rb_bpm} BPM ${x.rb_camelot || ""}`);
  if (x.an_bpm) p.push(`Essentia: ${(+x.an_bpm).toFixed(1)} BPM ${x.an_camelot || ""}`); if (x.bpm_manual) p.push(`${t("manual")}: ${x.bpm_manual}`); return p.join("\n"); }

function libRows() {
  const q = $("#lib-search").value.toLowerCase().trim(), c = $("#lib-cam").value, mn = +$("#lib-bmin").value || 0, mx = +$("#lib-bmax").value || 0, low = $("#lib-low").checked, unused = $("#lib-unused").checked;
  const a = LIB.list(null).filter(x => S.files.has(x.id) || !S.files.size).filter(x =>
    (!q || `${x.title} ${x.artist} ${x.id}`.toLowerCase().includes(q)) && (!c || x.camelot === c) && (!mn || x.bpm >= mn) && (!mx || x.bpm <= mx) && (!low || isLow(x)) && (!unused || !x.used));
  const { k, d } = S.sort;
  a.sort((x, y) => { let A = x[k], B = y[k]; if (k === "camelot") { A = camNum(A) * 2 + (A || "").endsWith("B"); B = camNum(B) * 2 + (B || "").endsWith("B"); }
    return typeof A === "string" ? A.localeCompare(B || "") * d : ((A || 0) - (B || 0)) * d; });
  return a;
}
function renderLib() {
  const all = LIB.list(null), rows = libRows();
  const cams = [...new Set(all.map(x => x.camelot).filter(Boolean))].sort((a, b) => camNum(a) - camNum(b) || a.localeCompare(b));
  const sel = $("#lib-cam"), v = sel.value; sel.innerHTML = `<option value="">${t("all_keys")}</option>` + cams.map(c => `<option>${c}</option>`).join(""); sel.value = v;
  $("#lib-count").innerHTML = `<b>${rows.length}</b> / ${all.length}`;
  if (!all.length) { $("#lib-tbl").innerHTML = `<tr><td><div class="empty">${t("lib_empty")}</div></td></tr>`; $("#lib-more-row").hidden = true; rbStatus(); return; }
  const shown = rows.slice(0, S.libLimit);
  $("#lib-more-row").hidden = rows.length <= shown.length; $("#lib-more").textContent = t("more", { n: rows.length - shown.length });
  const H = (k, l, cls = "") => `<th class="${cls}" data-k="${k}">${l}${S.sort.k === k ? (S.sort.d > 0 ? " ↑" : " ↓") : ""}</th>`;
  $("#lib-tbl").innerHTML = `<tr><th style="width:30px"><input type="checkbox" id="lib-all" style="accent-color:var(--acc)"></th><th style="width:40px"></th>${H("title", t("song"))}${H("bpm", "BPM", "num")}${H("camelot", t("key"))}${H("energy", t("energy"))}${H("duration", t("duration"), "num")}</tr>` +
    shown.map((x, i) => `<tr class="${S.libSel.has(x.id) ? "sel" : ""}" data-i="${i}"><td><input type="checkbox" ${S.libSel.has(x.id) ? "checked" : ""} style="accent-color:var(--acc)"></td>
      <td><button class="playbtn" data-play="${esc(x.id)}" aria-label="${esc(t("play"))}">${ICON_PLAY}</button></td>
      <td><div class="tt2" title="${esc(x.id)}">${esc(x.title || x.file)}${usedTag(x.used)}</div><div class="ar">${x.error ? `<span style="color:var(--bad)">${esc(x.error.slice(0, 90))}</span>` : x.engine === "rekordbox" ? `<span style="color:var(--dim)">${t("rb_only")}</span>` : esc(x.artist || x.folder)}</div></td>
      <td class="num" title="${esc(bpmTitle(x))}">${x.bpm ? `<span class="rowbtns"><button data-bpm="0.5" aria-label="BPM ½">½</button><button data-bpm="2" aria-label="BPM ×2">×2</button></span>` : ""}${x.bpm_manual ? '<span style="color:var(--ok)">✎</span> ' : ""}${x.bpm ? (+x.bpm).toFixed(1) : "–"}${srcTag(x)}</td>
      <td style="white-space:nowrap">${camChip(x.camelot)} <span style="font-size:11px;color:var(--dim)">${esc(x.key || "")}${x.key_conf && x.src !== "rekordbox" ? ` (${P(Math.round(x.key_conf * 100))})` : ""}</span>${isLow(x) ? `<span class="flag" title="${esc(lowWhy(x))}">${t("suspect")}</span>` : ""}</td>
      <td>${enBars(x.energy)}</td><td class="num" style="color:var(--muted)">${fmtT(x.duration)}</td></tr>`).join("");
  $$("#lib-tbl th[data-k]").forEach(th => th.onclick = () => { const k = th.dataset.k; S.sort = { k, d: S.sort.k === k ? -S.sort.d : 1 }; renderLib(); });
  $$("#lib-tbl tr[data-i]").forEach(tr => { const x = shown[+tr.dataset.i];
    tr.querySelector("input").onchange = e => { e.target.checked ? S.libSel.add(x.id) : S.libSel.delete(x.id); tr.classList.toggle("sel", e.target.checked); selBar(); };
    tr.querySelector(".playbtn").onclick = () => play(x);
    tr.querySelectorAll("[data-bpm]").forEach(b => b.onclick = () => { const raw = LIB.tracks[x.id]; if (!raw) return;
      raw.bpm_manual = Math.round(x.bpm * +b.dataset.bpm * 10) / 10; LIB.save(); renderLib(); }); });
  $("#lib-all").onchange = e => { shown.forEach(x => e.target.checked ? S.libSel.add(x.id) : S.libSel.delete(x.id)); renderLib(); };
  const fast = all.filter(x => fastSuspect(x) && !x.error && x.src !== "rekordbox");
  const fb = $("#lib-fixfast"); fb.hidden = !fast.length; fb.textContent = t("fix_fast", { n: fast.length });
  fb.onclick = () => { if (!confirm(t("fix_fast_confirm", { n: fast.length }))) return;
    for (const x of fast) { const raw = LIB.tracks[x.id]; if (raw) raw.bpm_manual = Math.round(x.bpm / 2 * 10) / 10; }
    LIB.save(); renderLib(); toast(t("fix_fast_done", { n: fast.length })); };
  markPlaying(); selBar(); rbStatus();
}
function selBar() { $("#lib-selbar").hidden = !S.libSel.size; $("#lib-selc").textContent = S.libSel.size; }
["#lib-search", "#lib-cam", "#lib-bmin", "#lib-bmax", "#lib-low", "#lib-unused"].forEach(s => $(s).oninput = renderLib);
$("#lib-unuse").onclick = () => { LIB.unuse([...S.libSel]); LIB.save(); renderLib(); renderPl(); };
$("#pl-skipused").onchange = () => { LIB.settings.skip_used = $("#pl-skipused").checked; LIB.save(); };
$("#lib-more").onclick = () => { S.libLimit += 1000; renderLib(); };
$("#lib-unsel").onclick = () => { S.libSel.clear(); renderLib(); };
const bpmAct = fn => { for (const id of S.libSel) { const x = LIB.get(id), raw = LIB.tracks[id]; if (x && raw) { const v = fn(x); if (v) raw.bpm_manual = Math.round(v * 10) / 10; else delete raw.bpm_manual; } } LIB.save(); renderLib(); };
$("#lib-half").onclick = () => bpmAct(x => x.bpm / 2);
$("#lib-double").onclick = () => bpmAct(x => x.bpm * 2);
$("#lib-resetbpm").onclick = () => bpmAct(() => 0);
$("#lib-add").onclick = () => { const have = new Set(LIB.playlist); const add = libRows().filter(x => S.libSel.has(x.id) && !have.has(x.id)).map(x => x.id);
  LIB.playlist.push(...add); LIB.save(); toast(t("added_n", { n: add.length })); S.libSel.clear(); renderLib(); };
$("#lib-start").onclick = () => { if (S.libSel.size !== 1) return toast(t("pick_one"), true); S.startId = [...S.libSel][0]; renderStartPill(); toast(t("start_set")); };
$("#lib-missing").onclick = () => safe(async () => { await scanFiles(); const n = LIB.removeMissing([...S.files.keys()]); await LIB.save(true); toast(t("removed_n", { n })); renderLib(); updateRootStat(); });
$("#lib-clear").onclick = () => { if (!confirm(t("confirm_reset"))) return; LIB.tracks = {}; LIB.rb = {}; LIB.playlist = []; LIB.save(); renderLib(); updateRootStat(); };

/* ═════════════ Rekordbox ═════════════ */
function rbStatus() {
  const n = Object.keys(LIB.rb).length;
  $("#rb-status").innerHTML = n ? `<span style="color:var(--info)">●</span> ${t("rb_matched", { n })}` : t("rb_none");
  const box = $("#rb-sum"); box.hidden = !n; if (!n) return;
  const r = RB.compare(LIB.list(null), LIB.rb);
  box.innerHTML = r.count ? `<div class="k"><span>${t("cmp_bpm")}</span><b style="color:var(--good)">${P(r.bpmPct)}</b></div><div class="k"><span>${t("cmp_key")}</span><b>${P(r.keyPct)}</b></div><div class="k"><span>${t("cmp_keycompat")}</span><b>${P(r.keyCompatPct)}</b></div>` : "";
  box.hidden = !r.count;
  $("#rb-compare").hidden = !n; $("#rb-calib").hidden = !n;
}
$("#rb-pick").onclick = () => safe(async () => { const { text } = await FS.openTextFile(); await importRbText(text); });
async function importRbText(text) {
  let coll; try { coll = RB.parseCollection(text); } catch (e) { throw new Error("not_rekordbox_xml"); }
  const ids = [...S.files.keys()];
  const m = RB.matchToLibrary(coll, ids, LIB.rootName);
  LIB.rb = m.byId;
  if (m.basePath) LIB.settings.rb_base = m.basePath;
  // Rekordbox'ta olup henüz analiz edilmemiş şarkılar da (Rekordbox değerleriyle) kullanılabilsin
  for (const [id, r] of Object.entries(m.byId)) if (!LIB.tracks[id]) {
    const f = S.files.get(id);
    LIB.tracks[id] = { id, file: id.split("/").pop(), folder: id.split("/").slice(0, -1).join("/"), size: f?.size, mtime: f?.mtime,
                       engine: "rekordbox", title: r.title || id.split("/").pop(), artist: r.artist, duration: r.duration, bpm: 0, key: "", camelot: "", error: null };
  }
  await LIB.save(true);
  const noKey = coll.filter(r => !r.key).length, badKey = coll.filter(r => r.key && !r.camelot).length;
  toast(t("rb_imported", { n: coll.length, m: m.matched }) + (noKey ? " " + t("rb_nokey", { n: noKey }) : "") + (badKey ? " " + t("rb_badkey", { n: badKey }) : ""));
  renderLib(); fillFolderSelect(); updateRootStat();
}
$("#rb-use").onchange = () => { LIB.settings.use_rb = $("#rb-use").checked; LIB.save(); renderLib(); };
$("#pref-save").onclick = () => { const lo = +$("#pref-lo").value || 0, hi = +$("#pref-hi").value || 0;
  if ((lo || hi) && !(lo && hi && hi > lo * 1.5)) return toast(t("range_err"), true);
  LIB.settings.bpm_lo = lo; LIB.settings.bpm_hi = hi; LIB.save(); renderLib(); toast(lo ? t("range_set", { lo, hi }) : t("range_off")); };

$("#rb-compare").onclick = () => {
  const r = RB.compare(LIB.list(null), LIB.rb);
  if (!r.count) { $("#rb-result").innerHTML = `<div class="hint">${t("cmp_none")}</div>`; return; }
  const card = (v, l, c = "") => `<div class="k"><span>${l}</span><b style="${c}">${v}</b></div>`;
  const REL = { same: t("rel_same"), close: t("rel_close"), halfdouble: t("rel_half"), diff: t("rel_diff"), relative: t("rel_relative"), neighbor: t("rel_neighbor"), none: "—" };
  const col = v => v === "same" || v === "close" ? "var(--good)" : v === "diff" ? "var(--bad)" : "var(--ok)";
  $("#rb-result").innerHTML = `<div class="cmp">${card(r.count, t("cmp_count"))}${card(P(r.bpmPct), t("cmp_bpm"), "color:var(--good)")}${card(r.bpmHalf, t("cmp_half"), "color:var(--ok)")}
      ${card(r.bpmDiff, t("cmp_bpmdiff"), "color:var(--bad)")}${card(P(r.keyPct), t("cmp_key") + ` (${r.keyCount})`, "color:var(--good)")}${card(P(r.keyCompatPct), t("cmp_keycompat"))}${card(r.keyDiff, t("cmp_keydiff"), "color:var(--bad)")}</div>
    ${r.mismatches.length ? `<h3 style="margin-top:16px">${t("cmp_mism")} (${r.mismatches.length})</h3><div class="scroll" style="max-height:340px"><table class="tbl"><tr><th>${t("song")}</th><th class="num">ES BPM</th><th class="num">RB BPM</th><th></th><th>ES</th><th>RB</th><th></th></tr>` +
      r.mismatches.map(m => `<tr><td><div class="tt2">${esc(m.title)}</div><div class="ar">${esc(m.artist)}</div></td><td class="num">${(+m.ourBpm).toFixed(1)}</td><td class="num">${(+m.rbBpm).toFixed(1)}</td>
        <td style="color:${col(m.bpmRel)};font-size:12px">${REL[m.bpmRel]}</td><td>${camChip(m.ourCam)}</td><td>${camChip(m.rbCam)}</td><td style="color:${col(m.keyRel)};font-size:12px">${REL[m.keyRel]}</td></tr>`).join("") + `</table></div>` : ""}`;
};

$("#rb-calib").onclick = () => safe(async () => {
  if (running("analyze")) throw new Error("already_running");
  const cands = Object.values(LIB.tracks).filter(x => x.engine === "essentia" && !x.error && LIB.rb[x.id]?.camelot && S.files.has(x.id)).slice(0, 250);
  if (cands.length < 20) throw new Error(t("calib_need", { n: cands.length }));
  const T = newTask("analyze", t("calib_title", { n: cands.length }), cands.length);
  $("#rb-result").innerHTML = `<div class="hint">${t("keep_open")}</div>`; tlog(T, t("engine_loading"));
  const rows = [];
  await runPool(cands.map(x => S.files.get(x.id)), { mode: "calibrate", isCancelled: () => T.cancelled,
    onResult: async (it, r) => { if (r.keys) rows.push({ keys: r.keys, rb: LIB.rb[it.id].camelot }); else tlog(T, `${t("error")} ${it.id}: ${r.error}`, "error"); T.done++; renderTask("analyze"); } });
  if (T.cancelled) { T.status = "cancelled"; renderTask("analyze"); return; }
  T.status = "done"; renderTask("analyze");
  const B = bestStrategy(rows, LIB.settings.key_strategy), pct = v => Math.round(v / B.n * 100);
  S.calibBest = B.best.strat;
  const better = B.best.ex > B.current.ex;
  $("#rb-result").innerHTML = `<div class="cmp"><div class="k"><span>${t("calib_n")}</span><b>${B.n}</b></div>
      <div class="k"><span>${t("calib_cur")} (${esc(B.current.label)})</span><b>${P(pct(B.current.ex))}</b></div>
      <div class="k"><span>${t("calib_best")}</span><b style="color:var(--good)">${P(pct(B.best.ex))}</b></div></div>
    <div class="hint">${t("calib_best_is")}: <b>${esc(B.best.label)}</b>. ${t("calib_note", { n: B.n })}</div>
    <div class="row" style="margin-top:10px">${better ? `<button class="btn pri sm" id="calib-apply">${t("calib_apply")}</button>` : `<span class="hint" style="margin:0">${t("calib_already")}</span>`}</div>
    <h3 style="margin-top:16px">${t("calib_singles")}</h3><table class="tbl"><tr><th>${t("profile")}</th><th class="num">${t("rel_same")}</th></tr>${B.singles.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${P(pct(r.ex))}</td></tr>`).join("")}</table>`;
  const ap = $("#calib-apply"); if (ap) ap.onclick = () => safe(async () => { LIB.settings.key_strategy = S.calibBest; await LIB.save(true); toast(t("calib_saved")); await analyze(true); });
});

/* ═════════════ Playlist ═════════════ */
const MODE_HINT = () => ({ smart: t("hint_smart"), locked: t("hint_locked") });
function setMode(v) { S.plMode = v; $$("#pl-mode button").forEach(x => x.classList.toggle("on", x.dataset.v === v));
  $("#smart-opts").hidden = v !== "smart"; $("#locked-opts").hidden = v !== "locked"; $("#mode-hint").textContent = MODE_HINT()[v]; }
function setSrc(v) { S.plSrc = v; $$("#pl-src button").forEach(x => x.classList.toggle("on", x.dataset.v === v)); $("#src-hint").textContent = t(v === "rb" ? "hint_src_rb" : "hint_src_ours"); fillFolderSelect(); }
$$("#pl-mode button").forEach(b => b.onclick = () => setMode(b.dataset.v));
$$("#pl-src button").forEach(b => b.onclick = () => setSrc(b.dataset.v));
$("#pl-tol").oninput = e => $("#tol-v").textContent = e.target.value;
const eligible = () => (S.plSrc === "rb" ? LIB.list("rb") : LIB.list("ours")).filter(x => S.files.has(x.id));
function fillFolderSelect() {
  const sel = $("#pl-folder"), v = sel.value, L = eligible(), fs = [...new Set(L.map(x => x.folder))].sort();
  sel.innerHTML = `<option value="">${t("all_eligible", { n: L.length })}</option>` + fs.map(f => `<option value="${esc(f)}">${esc(f || "/")} (${L.filter(x => x.folder === f).length})</option>`).join("");
  sel.value = fs.includes(v) ? v : "";
}
function renderStartPill() { const el = $("#start-pill"), x = LIB.get(S.startId);
  if (!x) { el.hidden = true; S.startId = null; return; }
  el.hidden = false; el.innerHTML = `<span class="pill fchip"><span class="fname">⇥ ${esc(x.title || x.file)}, ${(+x.bpm).toFixed(1)} BPM</span><button class="x" aria-label="${esc(t("remove"))}">×</button></span>`;
  el.querySelector(".x").onclick = () => { S.startId = null; renderStartPill(); }; }
const plTracks = () => LIB.playlist.map(id => LIB.get(id, LIB.settings.playlist_source || "ours")).filter(Boolean);

$("#pl-build").onclick = () => safe(async () => {
  let pool = skipUsed(eligible()); const f = $("#pl-folder").value;
  if (f) pool = pool.filter(x => x.folder === f || x.folder.startsWith(f + "/"));
  if (!pool.length) throw new Error($("#pl-skipused").checked && eligible().length ? "all_used" : S.plSrc === "rb" ? "no_rb_tracks" : "no_tracks");
  const o = { length: +$("#pl-len").value || 0, bmin: +$("#pl-bmin").value || 0, bmax: +$("#pl-bmax").value || 0 };
  const res = S.plMode === "locked" ? PL.locked(pool, { ...o, tolerance: +$("#pl-tol").value, descending: $("#pl-desc").checked })
    : PL.smart(pool, { ...o, start: $("#pl-start").value, shape: $("#pl-shape").value, startId: S.startId });
  if (!res.length) throw new Error("no_result");
  LIB.playlist = res.map(x => x.id); LIB.settings.playlist_source = S.plSrc; LIB.save(); renderPl(); toast(t("pl_ready", { n: res.length }));
  for (const n of res.notes || []) toast(t(n));
  if (o.length && res.length < o.length) toast(t("pl_short", { n: res.length, m: o.length }), true);
});
$("#pl-name").onchange = () => { LIB.settings.playlist_name = $("#pl-name").value; LIB.save(); };
$("#pl-empty").onclick = () => { if (confirm(t("confirm_empty"))) { LIB.playlist = []; LIB.save(); renderPl(); } };
const plName = () => ($("#pl-name").value || "playlist").replace(/[\\/:*?"<>|]/g, "_");
$("#pl-m3u").onclick = () => safe(async () => {
  const T = plTracks(); if (!T.length) throw new Error("pl_empty");
  if (LIB.canWrite) { await FS.writeText(LIB.root, plName() + ".m3u", PL.toM3U(T)); toast(t("m3u_written", { name: plName() + ".m3u" })); }
  else await FS.saveFile(plName() + ".m3u", PL.toM3U(T), "audio/x-mpegurl");
});
$("#pl-csv").onclick = () => safe(async () => { const T = plTracks(); if (!T.length) throw new Error("pl_empty");
  await FS.saveFile(plName() + ".csv", PL.toCSV(T, t("csv_head").split("|")), "text/csv"); });
$("#pl-rb").onclick = () => safe(async () => {
  const T = plTracks(); if (!T.length) throw new Error("pl_empty");
  let base = LIB.settings.rb_base;
  if (!base) { base = prompt(t("ask_base", { name: LIB.rootName })); if (!base) return; LIB.settings.rb_base = base.trim(); }
  LIB.rbPlaylists[$("#pl-name").value || "Setkey"] = T.map(x => x.id);
  LIB.markUsed(T.map(x => x.id), $("#pl-name").value || "Setkey");
  const byId = {}; for (const ids of Object.values(LIB.rbPlaylists)) for (const id of ids) { const v = LIB.get(id, LIB.settings.playlist_source || "ours"); if (v) byId[id] = v; }
  const ok = await FS.saveFile("Setkey_rekordbox.xml", RB.buildPlaylistXML(LIB.rbPlaylists, byId, LIB.settings.rb_base), "text/xml");
  LIB.save(); renderPl(); renderLib();
  if (ok && !LIB.settings.rb_export_shown) { LIB.settings.rb_export_shown = true; LIB.save(); alertBox(t("rb_howto")); }
});

function renderPl() {
  const T = plTracks(), R = PL.report(T);
  $("#pl-name").value = LIB.settings.playlist_name || t("new_set");
  $("#pl-n").textContent = T.length; $("#pl-dur").textContent = fmtT(R.duration);
  const bp = T.map(x => +x.bpm).filter(Boolean);
  $("#pl-span").textContent = bp.length ? (bp.length > 1 ? `${bp[0].toFixed(0)} → ${bp[bp.length - 1].toFixed(0)}` : bp[0].toFixed(0)) : "–";
  $("#pl-srcpill").innerHTML = `${t("values")}: <b>${LIB.settings.playlist_source === "rb" ? "Rekordbox" : t("src_ours")}</b>`;
  $("#pl-score").innerHTML = R.total ? `${P(R.score)} <span style="color:var(--dim);font-weight:500">(${R.good}/${R.total})</span>` : "–"; drawRing(R.total ? R.score : 0);
  drawCurve(T, R); drawWheel(T); updateCopySummary();
  if (!T.length) { $("#pl-list").innerHTML = `<div class="card empty">${t("pl_empty_hint")}</div>`; return; }
  let h = "";
  T.forEach((x, i) => {
    h += `<div class="pl-item" draggable="true" data-i="${i}"><span class="n">${i + 1}</span><button class="playbtn" data-play="${esc(x.id)}" aria-label="${esc(t("play"))}">${ICON_PLAY}</button>
      <div style="min-width:0"><div class="tt2">${esc(x.title || x.file)}${usedTag(x.used)}</div><div class="ar">${esc(x.artist || "")}</div></div>
      <span class="mono" style="text-align:right">${(+x.bpm).toFixed(1)}</span>${camChip(x.camelot)}${enBars(x.energy)}<span class="mono dur" style="color:var(--muted);font-size:12px;text-align:right">${fmtT(x.duration)}</span>
      <button class="x swap" data-alt="${i}" title="${esc(t("swap_tip"))}" aria-label="${esc(t("swap_tip"))}">⇄</button><button class="x" data-rm="${i}" aria-label="${esc(t("remove"))}">×</button></div>`;
    const tr = R.transitions[i], nx = T[i + 1];
    if (tr) { const d = (+nx.bpm || 0) - (+x.bpm || 0), ds = (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d).toFixed(1);
      h += `<div class="trans ${tr.level}"><i></i><span class="k">${t("v_" + tr.level)}</span> · ${esc(t(tr.cam))} (${esc(x.camelot || "?")} → ${esc(nx.camelot || "?")}), ${ds} BPM <span style="color:var(--dim)">(${P(tr.bpmPct)})</span></div>`; }
  });
  $("#pl-list").innerHTML = h;
  $$("#pl-list .playbtn").forEach(b => b.onclick = () => play(T.find(x => x.id === b.dataset.play)));
  $$("#pl-list [data-rm]").forEach(b => b.onclick = () => { LIB.playlist.splice(+b.dataset.rm, 1); LIB.save(); renderPl(); });
  $$("#pl-list [data-alt]").forEach(b => b.onclick = () => showAlts(T, +b.dataset.alt, b.closest(".pl-item")));
  let from = null;
  $$("#pl-list .pl-item").forEach(el => {
    el.ondragstart = e => { from = +el.dataset.i; el.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; };
    el.ondragend = () => el.classList.remove("drag");
    el.ondragover = e => { e.preventDefault(); el.classList.add("over"); };
    el.ondragleave = () => el.classList.remove("over");
    el.ondrop = e => { e.preventDefault(); el.classList.remove("over"); const to = +el.dataset.i; if (from === null || from === to) return;
      const [m] = LIB.playlist.splice(from, 1); LIB.playlist.splice(to, 0, m); LIB.save(); renderPl(); };
  });
  markPlaying();
}
function drawRing(pct) { const r = 19, c = 2 * Math.PI * r, col = pct >= 70 ? "var(--good)" : pct >= 40 ? "var(--ok)" : "var(--bad)";
  $("#pl-ring").innerHTML = `<circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--s3)" stroke-width="5"/><circle cx="23" cy="23" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c * pct / 100} ${c}" transform="rotate(-90 23 23)"/>`; }
function drawCurve(T, R) {
  const W = 800, H = 170, P = 18, svg = $("#pl-curve");
  if (T.length < 2) { svg.innerHTML = `<text x="400" y="90" fill="#5d6473" text-anchor="middle" font-size="14">${esc(t("curve_empty"))}</text>`; return; }
  const b = T.map(x => x.bpm), mn = Math.min(...b) - 2, mx = Math.max(...b) + 2, X = i => P + i * (W - 2 * P) / (T.length - 1), Y = v => H - P - (v - mn) / (mx - mn || 1) * (H - 2 * P);
  const bw = Math.max(2, (W - 2 * P) / T.length * 0.5); let s = "";
  for (let k = 0; k < 4; k++) { const v = mn + (mx - mn) * k / 3; s += `<line x1="${P}" x2="${W - P}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1c2029"/><text x="${W - P}" y="${Y(v) - 4}" fill="#5d6473" font-size="10" text-anchor="end" font-family="Archivo, system-ui, sans-serif">${v.toFixed(0)}</text>`; }
  T.forEach((x, i) => { const e = x.energy || 0; if (e) { const hh = e / 10 * (H - 2 * P) * 0.7; s += `<rect x="${X(i) - bw / 2}" y="${H - P - hh}" width="${bw}" height="${hh}" rx="1.5" fill="rgba(212,255,58,.10)"/>`; } });
  for (let i = 0; i < T.length - 1; i++) { const tr = R.transitions[i]; s += `<line x1="${X(i)}" y1="${Y(b[i])}" x2="${X(i + 1)}" y2="${Y(b[i + 1])}" stroke="${{ good: "#4ade80", ok: "#facc15", bad: "#f87171" }[tr.level]}" stroke-width="2.5" stroke-linecap="round"/>`; }
  T.forEach((x, i) => { s += `<circle cx="${X(i)}" cy="${Y(x.bpm)}" r="${T.length > 60 ? 2 : 3.5}" fill="${CAM_COLORS[camNum(x.camelot)] || "#888"}"><title>${i + 1}. ${esc(x.title)} — ${x.bpm} BPM ${x.camelot || ""}</title></circle>`; });
  svg.innerHTML = s;
}
function drawWheel(T) {
  const cnt = {}; T.forEach(x => { if (x.camelot) cnt[x.camelot] = (cnt[x.camelot] || 0) + 1; }); const max = Math.max(1, ...Object.values(cnt)), C = 100;
  const arc = (r1, r2, a1, a2) => { const p = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)]; const [x1, y1] = p(r2, a1), [x2, y2] = p(r2, a2), [x3, y3] = p(r1, a2), [x4, y4] = p(r1, a1);
    return `M${x1},${y1} A${r2},${r2} 0 0 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 0 0 ${x4},${y4}Z`; };
  let s = "";
  for (let n = 1; n <= 12; n++) { const a0 = ((n % 12) * 30 - 90 - 15) * Math.PI / 180, a1 = a0 + 30 * Math.PI / 180, am = (a0 + a1) / 2;
    [["B", 62, 96], ["A", 30, 62]].forEach(([L, r1, r2]) => { const k = n + L, c = cnt[k] || 0, op = c ? 0.35 + 0.65 * c / max : 0.08;
      s += `<path d="${arc(r1, r2, a0 + 0.01, a1 - 0.01)}" fill="${CAM_COLORS[n]}" fill-opacity="${op}" stroke="#08090b"><title>${k}: ${c}</title></path>`;
      const rm = (r1 + r2) / 2; s += `<text x="${C + rm * Math.cos(am)}" y="${C + rm * Math.sin(am) + 3.5}" text-anchor="middle" font-size="9.5" font-family="Archivo, system-ui, sans-serif" font-weight="600" fill="${c ? "#0a0a0a" : "#5d6473"}">${k}</text>`; }); }
  const path = T.filter(x => x.camelot).map(x => { const n = camNum(x.camelot), a = ((n % 12) * 30 - 90) * Math.PI / 180, r = x.camelot.endsWith("B") ? 79 : 46; return [C + r * Math.cos(a), C + r * Math.sin(a)]; });
  if (path.length > 1) s += `<polyline points="${path.map(p => p.join(",")).join(" ")}" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1"/>`;
  s += `<circle cx="100" cy="100" r="27" fill="#0f1115"/><text x="100" y="104" text-anchor="middle" font-size="12" fill="#8a91a0" font-family="Archivo, system-ui, sans-serif">${Object.keys(cnt).length} ${esc(t("keys_short"))}</text>`;
  $("#pl-wheel").innerHTML = s;
}

/* "Bunun yerine": o boşluğa uyan 3 şarkı */
function showAlts(T, i, el) {
  const open = $("#pl-list .alts"); if (open) { const same = open.dataset.i === String(i); open.remove(); if (same) return; }
  const src = LIB.settings.playlist_source || "ours";
  const pool = skipUsed((src === "rb" ? LIB.list("rb") : LIB.list("ours")).filter(x => S.files.has(x.id)));
  const A = PL.alternatives(T, i, pool, 3);
  const box = document.createElement("div"); box.className = "alts"; box.dataset.i = i;
  box.innerHTML = `<div class="alts-h">${esc(t("swap_title", { name: T[i].title || T[i].file }))}</div>` + (A.length ? A.map((a, k) => { const x = a.track;
    const why = [a.inCam && t(a.inCam), a.outCam && t(a.outCam)].filter(Boolean).map(esc).join(" · ");
    return `<div class="alt"><button class="playbtn" data-play="${esc(x.id)}" aria-label="${esc(t("play"))}">${ICON_PLAY}</button>
      <div style="min-width:0"><div class="tt2">${esc(x.title || x.file)}</div><div class="ar">${esc(x.artist || "")}${why ? " · " + why : ""}</div></div>
      <span class="mono">${(+x.bpm).toFixed(1)}</span>${camChip(x.camelot)}<button class="btn sm" data-k="${k}">${t("swap_use")}</button></div>`; }).join("") : `<div class="hint">${t("swap_none")}</div>`);
  el.after(box);
  box.querySelectorAll(".playbtn").forEach(b => b.onclick = () => play(A.find(a => a.track.id === b.dataset.play).track));
  box.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { LIB.playlist[i] = A[+b.dataset.k].track.id; LIB.save(); renderPl(); toast(t("swapped")); });
  markPlaying();
}

/* ═════════════ Kopyalama ═════════════ */
function updateCopySummary() {
  const T = plTracks(); const dur = T.reduce((a, x) => a + (x.duration || 0), 0);
  $("#cp-sum").innerHTML = `<span class="pill">${t("nav_pl")} <b>${esc(LIB.settings.playlist_name || "")}</b></span><span class="pill"><b>${T.length}</b> ${t("songs")}</span><span class="pill"><b>${fmtT(dur)}</b></span>`;
  $("#cp-sub").placeholder = LIB.settings.playlist_name || "";
  $("#cp-go").disabled = !T.length;
}
$("#cp-pick").onclick = () => safe(async () => { S.dest = await FS.pickDirectory("djstudio-dest", "readwrite"); $("#cp-dest").textContent = "📁 " + S.dest.name; $("#cp-dest").classList.add("set"); });
$("#cp-go").onclick = () => safe(async () => {
  const T = plTracks(); if (!T.length) throw new Error("pl_empty");
  if (!S.dest) throw new Error("pick_dest");
  if (!(await FS.ensurePermission(S.dest, true))) throw new Error("perm_denied");
  const sub = $("#cp-sub").value.trim().replace(/[\\/:*?"<>|]/g, "_");
  const dir = sub ? await FS.subDir(S.dest, sub) : S.dest;
  const usedIds = [];
  const num = $("#cp-num").checked, asMp3 = $("#cp-mp3").checked, w = Math.max(2, String(T.length).length), written = [];
  const K = newTask("copy", t("copy_to", { name: S.dest.name + (sub ? "/" + sub : "") }), T.length);
  for (let i = 0; i < T.length && !K.cancelled; i++) {
    const x = T[i], f = S.files.get(x.id), conv = asMp3 && isWav(x.file);
    const name = (num ? String(i + 1).padStart(w, "0") + " - " : "") + (conv ? mp3Name(x.file) : x.file);
    try { if (!f) throw new Error(t("file_missing"));
      if (conv) {
        const h = await dir.getFileHandle(name, { create: true });
        if ((await h.getFile()).size > 0) { written.push(name); tlog(K, `${t("skipped_exists")}: ${name}`); }
        else { const blob = await wavToMp3(await f.handle.getFile(), { bitrate: 320, tags: mp3Tags(x) });
          const wr = await h.createWritable(); await wr.write(blob); await wr.close(); written.push(name); tlog(K, `${t("converted")}: ${name}`); }
      } else { const r = await FS.copyFileTo(f.handle, dir, name); written.push(name); tlog(K, `${r === "exists" ? t("skipped_exists") : t("copied")}: ${name}`); }
      usedIds.push(x.id); }
    catch (e) { tlog(K, `${t("error")} ${x.file}: ${e.message}`, "error"); }
    K.done = i + 1; renderTask("copy");
  }
  if ($("#cp-m3u").checked && written.length) { await FS.writeText(dir, "playlist.m3u", "#EXTM3U\n" + written.join("\n") + "\n"); tlog(K, "playlist.m3u ✓"); }
  if (usedIds.length) { LIB.markUsed(usedIds, LIB.settings.playlist_name || sub || "USB"); LIB.save(); renderPl(); renderLib(); }
  K.status = K.cancelled ? "cancelled" : "done"; renderTask("copy"); toast(t("copy_done", { n: written.length, m: T.length }));
});

/* ═════════════ WAV -> MP3 ═════════════ */
const usedTag = u => u ? `<span class="usedtag" title="${esc(t("used_tip", { n: u.n, date: u.last, sets: u.sets.join(", ") }))}">${t("used")}</span>` : "";
const skipUsed = pool => $("#pl-skipused").checked ? pool.filter(x => !x.used || x.id === S.startId) : pool;
const mp3Tags = x => x ? { title: (x.title || "").replace(/\.wav$/i, ""), artist: x.artist || "", bpm: x.bpm ? String(Math.round(x.bpm)) : "",
  key: keyTag(x.key), comment: x.camelot ? `${x.camelot} · Setkey` : "" } : {};
function updateWavCount() { const n = [...S.files.keys()].filter(isWav).length; $("#wav-count").textContent = t("wav_found", { n }); $("#wav-go").disabled = !n; }
/** Bir WAV'ı MP3'e çevirip aynı klasöre yazar ve analizini MP3'e aktarır */
async function convertOne(f, bitrate, onProgress) {
  const x = LIB.get(f.id), file = await f.handle.getFile();
  const blob = await wavToMp3(file, { bitrate, tags: mp3Tags(x) }, onProgress);
  const name = mp3Name(f.id.split("/").pop()), h = await f.dir.getFileHandle(name, { create: true });
  const w = await h.createWritable(); await w.write(blob); await w.close();
  const out = await h.getFile(), id = mp3Name(f.id), rec = LIB.tracks[f.id];
  if (rec && !LIB.tracks[id]) LIB.tracks[id] = { ...rec, id, file: name, size: out.size, mtime: out.lastModified,
    title: rec.title === rec.file ? name.replace(/\.mp3$/i, "") : rec.title };
  return { id, name };
}
$("#wav-go").onclick = () => safe(async () => {
  if (running("wav")) return;
  await scanFiles();
  const skip = $("#wav-skip").checked, bitrate = +$("#wav-br").value;
  const todo = [...S.files.values()].filter(f => isWav(f.id) && !(skip && S.files.has(mp3Name(f.id))));
  const K = newTask("wav", t("wav_task", { n: todo.length }), todo.length);
  if (!todo.length) { tlog(K, t("wav_nothing")); K.status = "done"; renderTask("wav"); return; }
  let ok = 0;
  for (const f of todo) {
    if (K.cancelled) break;
    try { const r = await convertOne(f, bitrate); ok++; tlog(K, `${t("done_short")}: ${r.id}`); }
    catch (e) { tlog(K, `${t("error")} ${f.id}: ${t(e.message) || e.message}`, "error"); }
    K.done++; renderTask("wav");
    if (ok % 5 === 0) LIB.save();
  }
  await LIB.save(true); await scanFiles(); updateWavCount();
  K.status = K.cancelled ? "cancelled" : "done"; renderTask("wav"); toast(t("wav_done", { n: ok, m: todo.length }));
});

/* ═════════════ Araçlar: kopya bulma ═════════════ */
$("#dup-th").oninput = e => $("#dup-th-v").textContent = e.target.value;
$("#dup-go").onclick = () => safe(async () => {
  if (running("dup")) return;
  await scanFiles(); const files = [...S.files.values()];
  const T = newTask("dup", t("dup_scanning", { n: files.length }), files.length); $("#dup-res").innerHTML = "";
  const groups = await findDuplicates(files, +$("#dup-th").value / 100, (d, tot) => { T.done = d; T.total = tot; renderTask("dup"); }, () => T.cancelled);
  T.status = T.cancelled ? "cancelled" : "done"; tlog(T, t("dup_groups", { n: groups.length })); renderTask("dup");
  if (!groups.length) { $("#dup-res").innerHTML = `<div class="empty">${t("dup_none")}</div>`; return; }
  $("#dup-res").innerHTML = `<div class="row" style="margin-top:14px"><span class="pill"><b>${groups.length}</b> ${t("groups")}</span><span class="grow"></span><button class="btn sm danger" id="dup-move">${t("dup_move")}</button></div>
    <div class="hint">${t("dup_keep")}</div>` + groups.map((g, gi) => `<div class="dgroup"><div class="gh"><span class="tag ${g.exact ? "ex" : "sim"}">${g.exact ? t("exact") : t("similar")}</span>${esc(g.items[0].name)}</div>` +
      g.items.map((it, k) => `<label class="ditem"><input type="checkbox" data-g="${gi}" data-k="${k}" ${k > 0 ? "checked" : ""}><span class="p">${esc(it.id)}</span><span class="mono" style="color:var(--dim);font-size:11px">${(it.size / 1048576).toFixed(1)} MB</span></label>`).join("") + `</div>`).join("");
  $("#dup-move").onclick = () => safe(async () => {
    const sel = $$("#dup-res input:checked").map(i => groups[+i.dataset.g].items[+i.dataset.k]); if (!sel.length) return;
    if (!confirm(t("dup_confirm", { n: sel.length }))) return;
    const r = await moveToTrash(sel, LIB.root); toast(t("dup_moved", { n: r.moved })); if (r.errors.length) toast(r.errors[0], true);
    $$("#dup-res input:checked").forEach(i => i.closest(".ditem").remove()); await scanFiles();
  });
});

/* ═════════════ Ayarlar → arayüz ═════════════ */
function applySettingsToUI() {
  const s = LIB.settings;
  $("#rb-use").checked = s.use_rb !== false; $("#pref-lo").value = s.bpm_lo || ""; $("#pref-hi").value = s.bpm_hi || "";
  $("#cp-num").checked = s.copy_numbered !== false; $("#cp-m3u").checked = s.copy_m3u !== false; $("#cp-mp3").checked = !!s.copy_mp3; $("#pl-skipused").checked = !!s.skip_used;
  setSrc(s.playlist_source === "rb" ? "rb" : "ours"); setMode(S.plMode);
}
$("#cp-num").onchange = () => { LIB.settings.copy_numbered = $("#cp-num").checked; LIB.save(); };
$("#cp-m3u").onchange = () => { LIB.settings.copy_m3u = $("#cp-m3u").checked; LIB.save(); };
$("#cp-mp3").onchange = () => { LIB.settings.copy_mp3 = $("#cp-mp3").checked; LIB.save(); };

/* ═════════════ Karşılama: Camelot çarkında kendini çizen örnek set ═════════════ */
function heroWheel() {
  const svg = $("#hero-wheel"); if (!svg) return;
  const C = 100, SET = ["8A", "9A", "9B", "10B", "10A", "11A", "12A", "12B"];
  const pt = (k, r) => { const n = camNum(k), a = ((n % 12) * 30 - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (r1, r2, a1, a2) => { const p = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)]; const [x1, y1] = p(r2, a1), [x2, y2] = p(r2, a2), [x3, y3] = p(r1, a2), [x4, y4] = p(r1, a1);
    return `M${x1},${y1} A${r2},${r2} 0 0 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 0 0 ${x4},${y4}Z`; };
  let s = "";
  for (let n = 1; n <= 12; n++) { const a0 = ((n % 12) * 30 - 105) * Math.PI / 180, a1 = a0 + Math.PI / 6, am = (a0 + a1) / 2;
    [["B", 64, 96], ["A", 32, 64]].forEach(([L, r1, r2]) => { const k = n + L, on = SET.includes(k);
      s += `<path d="${arc(r1, r2, a0 + 0.012, a1 - 0.012)}" fill="${CAM_COLORS[n]}" fill-opacity="${on ? 0.9 : 0.16}"/>`;
      const rm = L === "B" ? 77 : 50; s += `<text x="${C + rm * Math.cos(am)}" y="${C + rm * Math.sin(am) + 3.3}" text-anchor="middle" font-size="8.5" font-family="Archivo, system-ui, sans-serif" font-weight="700" fill="${on ? "#141414" : "#8a8c95"}">${k}</text>`; }); }
  const pts = SET.map(k => pt(k, k.endsWith("B") ? 91 : 37));   // noktalar dilimin dış kenarına yakın: ton yazısını kapatmaz
  s += `<polyline class="path" points="${pts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}"/>`;
  pts.forEach((p, i) => { s += `<circle class="stop" cx="${p[0]}" cy="${p[1]}" r="${i ? 3.2 : 4.2}" fill="${i ? "#eeebe5" : "#ffa02e"}" stroke="#191a1e" stroke-width="1.2" style="animation-delay:${0.5 + i * 3.2 / (pts.length - 1)}s"/>`; });
  s += `<circle cx="100" cy="100" r="29" fill="#191a1e"/><text x="100" y="98" text-anchor="middle" font-size="15" font-weight="800" font-family="Archivo, system-ui, sans-serif" fill="#eeebe5" style="font-stretch:125%">${SET.length}</text><text x="100" y="111" text-anchor="middle" font-size="8" font-family="Archivo, system-ui, sans-serif" fill="#8a8c95">${esc(t("songs"))}</text>`;
  svg.innerHTML = s;
  const path = svg.querySelector(".path"); path.style.setProperty("--len", path.getTotalLength());
}

/* ═════════════ Dil ═════════════ */
function langButtons() { $$(".lang button").forEach(b => { b.classList.toggle("on", b.dataset.lang === getLang()); b.onclick = () => { setLang(b.dataset.lang); LIB.settings.lang = b.dataset.lang; if (LIB.root) LIB.save(); rerender(); }; }); }
function rerender() {
  applyI18n(); langButtons(); heroWheel(); setMode(S.plMode); $("#src-hint").textContent = t(S.plSrc === "rb" ? "hint_src_rb" : "hint_src_ours");
  if (LIB.root) { updateRootStat(); renderLib(); fillFolderSelect(); renderPl(); renderStartPill(); }
  Object.keys(S.tasks).forEach(renderTask);
}
$("#about-link").onclick = e => { e.preventDefault(); alertBox(t("about_text")); };
$("#src-link").href = SOURCE_URL;

// Sekme kapanırken / gizlenirken bekleyen kaydı hemen yaz
addEventListener("pagehide", () => LIB.flush());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") LIB.flush(); });

// Otomatik testler için (adres sonuna #test eklenince); normal kullanımda etkisi yok
if (location.hash === "#test") window.__dj = { openRoot, importRbText, LIB, S, analyze, renderLib, renderPl };

/* ═════════════ Logo: karşılama ekranına dön ═════════════ */
function showWelcome() {
  $("#welcome").hidden = false;
  if (LIB.root) { const b = $("#w-resume"); b.hidden = false; b.textContent = t("resume", { name: LIB.rootName });
    b.onclick = () => { $("#welcome").hidden = true; }; }      // klasör zaten açık: sadece geri dön
  window.scrollTo(0, 0);
}
const homeLogo = $("#home-logo");
homeLogo.onclick = showWelcome;
homeLogo.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showWelcome(); } };

/* ═════════════ Başlangıç ═════════════ */
(async function init() {
  rerender();
  if (!FS.supported()) { $("#w-unsupported").hidden = false; $("#w-pick").disabled = true; return; }
  $("#w-pick").onclick = () => safe(async () => openRoot(await FS.pickDirectory(), true));
  const saved = await FS.idbGet("root");
  if (saved) {
    const b = $("#w-resume"); b.hidden = false; b.textContent = t("resume", { name: saved.name });
    b.onclick = () => safe(async () => openRoot(saved, false));
    if (await FS.hasPermission(saved, false)) safe(async () => openRoot(saved, false));   // izin hâlâ geçerliyse doğrudan aç
  }
})();
