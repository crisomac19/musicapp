// Dr. Cris song composer front-end. Talks only to our own /api/* Netlify function.
import { LANGS, STRINGS, pickLang } from "/i18n.js";

const $ = (s) => document.querySelector(s);
const LS_JOBS = "songsmith.jobs.v1";
const LS_PW = "songsmith.pw";
const LS_LANG = "songsmith.lang";
const POLL_MS = 6000;
const MAX_WAIT_MS = 12 * 60 * 1000;

const STYLE_CHIPS = [
  "Pop", "Hip-hop", "R&B", "Lo-fi", "EDM", "House", "Rock", "Indie", "Acoustic",
  "Jazz", "Country", "Reggaeton", "Latin", "Afrobeats", "Cinematic", "Piano ballad", "Synthwave", "Metal",
];
const FAIL = ["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR", "GENERATE_LYRICS_FAILED", "FAILED"];
const STATUS_PROGRESS = { PENDING: 15, TEXT_SUCCESS: 40, FIRST_SUCCESS: 75, SUCCESS: 100 };

let mode = "simple";
let lang = "en";
let jobs = load();
let password = safeGet(LS_PW) || "";
const pollers = new Map();

// ---------- utils ----------
function t(key, vars = {}) {
  const v = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  return typeof v === "string" ? v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : v;
}
const statusText = (s) => (STRINGS[lang][`st_${s}`] || STRINGS.en[`st_${s}`] ? t(`st_${s}`) : "");

function applyI18n() {
  document.documentElement.lang = lang;
  document.title = t("pageTitle");
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll("[data-i18n-content]").forEach((el) => el.setAttribute("content", t(el.dataset.i18nContent)));
  $("#langSelect").value = lang;
  $("#durationOut").textContent = Number($("#duration").value) === 0 ? t("auto") : fmt($("#duration").value);
  $("#varietyOut").textContent = t("varietyLevels")[$("#variety").value];
  if (lastCredits !== null) $("#creditsValue").textContent = t("credits", { n: Number(lastCredits).toLocaleString(lang) });
  render();
}

function setLang(l, persist) {
  lang = LANGS[l] ? l : "en";
  if (persist) safeSet(LS_LANG, lang);
  applyI18n();
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function load() { try { return JSON.parse(safeGet(LS_JOBS)) || []; } catch { return []; } }
function save() { safeSet(LS_JOBS, JSON.stringify(jobs.slice(0, 100))); }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(password ? { "x-app-password": password } : {}), ...(opts.headers || {}) },
  });
  let body;
  try { body = await res.json(); } catch { body = { ok: false, error: `Server error (${res.status})` }; }
  if (body.needPassword) { await askPassword(true); return api(path, opts); }
  if (!res.ok || !body.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body.data;
}

// ---------- password gate ----------
function askPassword(wrong = false) {
  return new Promise((resolve) => {
    const dlg = $("#pwDialog");
    $("#pwError").hidden = !wrong || !password;
    $("#pwInput").value = "";
    dlg.showModal();
    $("#pwForm").onsubmit = (e) => {
      e.preventDefault();
      password = $("#pwInput").value;
      safeSet(LS_PW, password);
      dlg.close();
      resolve();
    };
  });
}

// ---------- credits ----------
let lastCredits = null;
async function refreshCredits() {
  const el = $("#credits");
  try {
    const n = await api("credits");
    lastCredits = n;
    $("#creditsValue").textContent = t("credits", { n: Number(n).toLocaleString(lang) });
    el.classList.toggle("ok", n >= 20);
    el.classList.toggle("low", n < 20);
  } catch (e) {
    $("#creditsValue").textContent = t("creditsNA");
    el.title = e.message;
  }
}

// ---------- form ----------
function setMode(m) {
  mode = m;
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.mode === m;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  });
  $(".mode-simple").hidden = m !== "simple";
  $(".mode-custom").hidden = m !== "custom";
  document.querySelectorAll(".simple-only").forEach((e) => (e.hidden = m !== "simple"));
  syncInstrumental();
}

function syncInstrumental() {
  const instr = $("#instrumental").checked;
  if (mode === "custom") {
    $(".lyrics-field").hidden = instr;
    $("#vocalGender").disabled = instr;
  }
}

function renderChips() {
  const box = $("#styleChips");
  box.innerHTML = STYLE_CHIPS.map((c) => `<button type="button" class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("");
  box.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const input = $("#style");
    const val = chip.dataset.chip;
    const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === val.toLowerCase());
    if (idx >= 0) parts.splice(idx, 1); else parts.push(val);
    input.value = parts.join(", ");
    syncChips();
  });
  $("#style").addEventListener("input", syncChips);
}
function syncChips() {
  const parts = $("#style").value.toLowerCase().split(",").map((s) => s.trim());
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", parts.includes(c.dataset.chip.toLowerCase())));
}

function bindCounters() {
  document.querySelectorAll(".counter").forEach((c) => {
    const input = document.getElementById(c.dataset.for);
    const upd = () => (c.textContent = `${input.value.length} / ${input.maxLength}`);
    input.addEventListener("input", upd); upd();
  });
}

function bindSliders() {
  const d = $("#duration");
  const updD = () => ($("#durationOut").textContent = Number(d.value) === 0 ? t("auto") : fmt(d.value));
  d.addEventListener("input", updD); updD();
  const sw = $("#styleWeight"), wd = $("#weirdness"), va = $("#variety");
  sw.addEventListener("input", () => ($("#styleWeightOut").textContent = Number(sw.value).toFixed(2)));
  wd.addEventListener("input", () => ($("#weirdnessOut").textContent = Number(wd.value).toFixed(2)));
  va.addEventListener("input", () => ($("#varietyOut").textContent = t("varietyLevels")[va.value]));
}

function collect() {
  const base = {
    customMode: mode === "custom",
    instrumental: $("#instrumental").checked,
    model: $("#model").value,
    style: $("#style").value.trim(),
  };
  if (mode === "simple") {
    return { ...base, prompt: $("#prompt").value.trim() };
  }
  const out = {
    ...base,
    title: $("#title").value.trim(),
    lyrics: base.instrumental ? "" : $("#lyrics").value.trim(),
    negativeTags: $("#negativeTags").value.trim(),
    vocalGender: $("#vocalGender").value,
    styleWeight: Number($("#styleWeight").value),
    weirdnessConstraint: Number($("#weirdness").value),
    variety: Number($("#variety").value),
  };
  const dur = Number($("#duration").value);
  if (dur > 0) out.duration = dur;
  return out;
}

function validate(p) {
  if (!p.customMode && !p.prompt && !p.style) return t("errDescribe");
  if (p.customMode && !p.style && !p.lyrics && !p.negativeTags) return t("errCustom");
  return "";
}

async function onSubmit(e) {
  e.preventDefault();
  const err = $("#formError");
  const payload = collect();
  const msg = validate(payload);
  if (msg) { err.textContent = msg; err.hidden = false; return; }
  err.hidden = true;

  const btn = $("#submitBtn");
  btn.disabled = true; btn.classList.add("loading");
  btn.querySelector(".btn-label").textContent = t("starting");
  try {
    const data = await api("generate", { method: "POST", body: JSON.stringify(payload) });
    const job = {
      taskId: data.taskId,
      createdAt: Date.now(),
      status: "PENDING",
      summary: payload.title || payload.prompt || payload.style || t("untitled"),
      style: payload.style,
      instrumental: payload.instrumental,
      model: payload.model,
      tracks: [],
    };
    jobs.unshift(job); save(); render();
    poll(job.taskId);
    toast(t("started"));
  } catch (e2) {
    err.textContent = e2.message; err.hidden = false;
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
    btn.querySelector(".btn-label").textContent = t("create");
  }
}

// ---------- AI lyrics ----------
async function onGenLyrics() {
  const prompt = $("#lyricsPrompt").value.trim();
  const box = $("#lyricsOptions");
  if (!prompt) { $("#lyricsPrompt").focus(); return; }
  const btn = $("#genLyrics");
  btn.disabled = true;
  box.innerHTML = `<div class="mini-status">${esc(t("writingLyrics"))}</div>`;
  try {
    const { taskId } = await api("lyrics", { method: "POST", body: JSON.stringify({ prompt }) });
    const start = Date.now();
    while (Date.now() - start < 4 * 60 * 1000) {
      await sleep(4000);
      const d = await api(`lyrics-status?taskId=${encodeURIComponent(taskId)}`);
      if (d.status === "SUCCESS") {
        const opts = (d.response?.data || []).filter((o) => o.status !== "failed" && o.text);
        if (!opts.length) throw new Error(t("noLyrics"));
        box.innerHTML = opts.map((o, i) =>
          `<button type="button" class="lyric-opt" data-i="${i}"><strong>${esc(o.title || t("option", { n: i + 1 }))} — ${esc(t("useThis"))}</strong>${esc(o.text)}</button>`).join("");
        box.onclick = (e) => {
          const b = e.target.closest(".lyric-opt"); if (!b) return;
          const o = opts[Number(b.dataset.i)];
          $("#lyrics").value = o.text;
          $("#lyrics").dispatchEvent(new Event("input"));
          if (!$("#title").value && o.title) $("#title").value = o.title.slice(0, 80);
          toast(t("lyricsAdded"));
        };
        return;
      }
      if (FAIL.includes(d.status)) throw new Error(d.errorMessage || statusText(d.status) || t("lyricsFailed"));
    }
    throw new Error(t("lyricsSlow"));
  } catch (e) {
    box.innerHTML = `<div class="error-text">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- polling ----------
function normalizeTracks(d) {
  const list = d?.response?.sunoData || d?.response?.data || [];
  return list.map((t) => ({
    id: t.id,
    title: t.title,
    tags: t.tags,
    image: t.image_url || t.source_image_url || "",
    audio: t.audio_url || t.source_audio_url || "",
    stream: t.stream_audio_url || t.source_stream_audio_url || "",
    lyrics: t.prompt || "",
    duration: t.duration || 0,
  }));
}

async function poll(taskId) {
  if (pollers.has(taskId)) return;
  pollers.set(taskId, true);
  try {
    while (true) {
      const job = jobs.find((j) => j.taskId === taskId);
      if (!job) return;
      if (Date.now() - job.createdAt > MAX_WAIT_MS) { job.status = "TIMEOUT"; break; }
      try {
        const d = await api(`status?taskId=${encodeURIComponent(taskId)}`);
        job.status = d.status || job.status;
        const tracks = normalizeTracks(d);
        if (tracks.length) job.tracks = tracks;
        if (FAIL.includes(job.status)) job.error = d.errorMessage || "";
        save(); render();
        if (job.status === "SUCCESS" || FAIL.includes(job.status)) break;
      } catch (e) {
        if (e.status === 401 || e.status === 400) { job.status = "FAILED"; job.error = e.message; break; }
        // transient: keep polling
      }
      await sleep(POLL_MS);
    }
  } finally {
    pollers.delete(taskId);
    save(); render();
    refreshCredits();
  }
}

// ---------- rendering ----------
function render() {
  const box = $("#jobs");
  $("#empty").hidden = jobs.length > 0;
  $("#clearLib").hidden = jobs.length === 0;
  box.innerHTML = jobs.map(renderJob).join("");
  markPlaying();
}

function renderJob(job) {
  const done = job.status === "SUCCESS";
  const failed = FAIL.includes(job.status) || job.status === "TIMEOUT";
  const pending = !done && !failed;
  const badge = done ? `<span class="badge done">${esc(t("ready"))}</span>`
    : failed ? `<span class="badge failed">${esc(t("failed"))}</span>`
    : `<span class="badge pending">${esc(statusText(job.status) || t("st_WORKING"))}</span>`;
  const prog = pending
    ? `<div class="progress ${job.status === "PENDING" ? "indeterminate" : ""}"><span style="width:${STATUS_PROGRESS[job.status] || 10}%"></span></div>`
    : "";
  let tracks = "";
  if (job.tracks?.length) {
    tracks = `<div class="tracks">${job.tracks.map((t) => renderTrack(job, t)).join("")}</div>`;
  } else if (pending) {
    tracks = `<div class="tracks">${[0, 1].map(() => `
      <div class="track-card"><div class="cover skeleton"></div>
        <div class="t-meta"><div class="t-title">${esc(t("composing"))}</div><div class="t-tags">${esc(job.style || "")}</div></div></div>`).join("")}</div>`;
  }
  const error = failed ? `<div class="error-text">${esc(job.error || statusText(job.status) || t("somethingWrong"))}</div>` : "";
  return `
    <article class="job" data-task="${esc(job.taskId)}">
      <div class="job-head">
        <div class="job-prompt" title="${esc(job.summary)}">${esc(job.summary)}</div>
        <div class="job-actions">${badge}<button class="icon-btn" data-remove="${esc(job.taskId)}" title="${esc(t("remove"))}" aria-label="${esc(t("remove"))}">✕</button></div>
      </div>
      ${prog}${tracks}${error}
    </article>`;
}

function renderTrack(job, tr) {
  const src = tr.audio || tr.stream;
  const playable = Boolean(src);
  const dur = tr.duration ? `<span class="t-dur">${fmt(tr.duration)}</span>` : "";
  const dl = tr.audio ? `<a href="${esc(tr.audio)}" target="_blank" rel="noopener" download>${esc(t("download"))}</a>` : (playable ? `<span class="t-dur">${esc(t("streaming"))}</span>` : "");
  const lyr = tr.lyrics && !job.instrumental ? `<button type="button" data-copy="${esc(tr.id)}">${esc(t("lyrics"))}</button>` : "";
  return `
    <div class="track-card" data-track="${esc(tr.id)}">
      <button class="cover ${playable ? "" : "skeleton"}" ${playable ? `data-play="${esc(job.taskId)}|${esc(tr.id)}"` : "disabled"} aria-label="${esc(t("play"))} ${esc(tr.title)}">
        ${tr.image ? `<img src="${esc(tr.image)}" alt="" loading="lazy" />` : ""}
        ${playable ? `<span class="play-ov">▶</span>` : ""}
      </button>
      <div class="t-meta">
        <div class="t-title" title="${esc(tr.title)}">${esc(tr.title || t("untitled"))}</div>
        <div class="t-tags" title="${esc(tr.tags)}">${esc(tr.tags || "")}</div>
        <div class="t-links">${dur}${dl}${lyr}</div>
      </div>
    </div>`;
}

// ---------- player ----------
const audio = $("#audio");
let current = null; // {taskId, id}

function findTrack(taskId, id) {
  const job = jobs.find((j) => j.taskId === taskId);
  return job?.tracks.find((t) => t.id === id);
}

function play(taskId, id) {
  const tr = findTrack(taskId, id);
  if (!tr) return;
  if (current && current.taskId === taskId && current.id === id) {
    audio.paused ? audio.play() : audio.pause();
    return;
  }
  current = { taskId, id };
  audio.src = tr.audio || tr.stream;
  audio.play().catch(() => toast(t("cantPlay")));
  $("#player").hidden = false;
  const cover = $("#pCover");
  if (tr.image) { cover.src = tr.image; cover.style.visibility = "visible"; }
  else { cover.removeAttribute("src"); cover.style.visibility = "hidden"; }
  $("#pTitle").textContent = tr.title || t("untitled");
  $("#pTags").textContent = tr.tags || "";
  markPlaying();
}

function markPlaying() {
  document.querySelectorAll(".track-card").forEach((el) => {
    const on = current && el.dataset.track === current.id && !audio.paused;
    el.classList.toggle("playing", Boolean(on));
    const ov = el.querySelector(".play-ov");
    if (ov) ov.textContent = on ? "❚❚" : "▶";
  });
  $("#pToggle").textContent = audio.paused ? "▶" : "❚❚";
}

audio.addEventListener("play", markPlaying);
audio.addEventListener("pause", markPlaying);
audio.addEventListener("ended", markPlaying);
audio.addEventListener("loadedmetadata", () => { if (isFinite(audio.duration)) $("#pDur").textContent = fmt(audio.duration); });
audio.addEventListener("timeupdate", () => {
  $("#pTime").textContent = fmt(audio.currentTime);
  if (isFinite(audio.duration) && audio.duration > 0) {
    $("#pSeek").value = (audio.currentTime / audio.duration) * 100;
    $("#pDur").textContent = fmt(audio.duration);
  }
});
$("#pSeek").addEventListener("input", (e) => {
  if (isFinite(audio.duration)) audio.currentTime = (e.target.value / 100) * audio.duration;
});
$("#pToggle").addEventListener("click", () => (audio.paused ? audio.play() : audio.pause()));

// ---------- events ----------
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
$("#instrumental").addEventListener("change", syncInstrumental);
$("#genForm").addEventListener("submit", onSubmit);
$("#openLyricsAI").addEventListener("click", () => {
  const box = $("#lyricsAI"); box.hidden = !box.hidden;
  if (!box.hidden) $("#lyricsPrompt").focus();
});
$("#genLyrics").addEventListener("click", onGenLyrics);
$("#lyricsPrompt").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onGenLyrics(); } });
$("#clearLib").addEventListener("click", () => {
  if (!confirm(t("confirmClear"))) return;
  jobs = []; save(); render();
});
$("#jobs").addEventListener("click", async (e) => {
  const playBtn = e.target.closest("[data-play]");
  if (playBtn) { const [taskId, id] = playBtn.dataset.play.split("|"); play(taskId, id); return; }
  const rm = e.target.closest("[data-remove]");
  if (rm) { jobs = jobs.filter((j) => j.taskId !== rm.dataset.remove); save(); render(); return; }
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    const job = jobs.find((j) => j.tracks?.some((t) => t.id === cp.dataset.copy));
    const tr = job?.tracks.find((x) => x.id === cp.dataset.copy);
    try { await navigator.clipboard.writeText(tr.lyrics); toast(t("copied")); }
    catch { toast(t("cantCopy")); }
  }
});

// ---------- init ----------
(async function init() {
  const saved = safeGet(LS_LANG);
  const sel = $("#langSelect");
  sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  sel.addEventListener("change", () => setLang(sel.value, true));
  renderChips(); bindCounters(); bindSliders(); setMode("simple");
  setLang(pickLang({ saved, browser: navigator.language }));
  try {
    const cfg = await api("config");
    if (!saved) setLang(pickLang({ country: cfg.country, browser: navigator.language }));
    if (cfg.passwordRequired && !password) await askPassword();
  } catch {}
  refreshCredits();
  jobs.filter((j) => j.status !== "SUCCESS" && !FAIL.includes(j.status) && j.status !== "TIMEOUT").forEach((j) => poll(j.taskId));
})();
