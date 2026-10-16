const API = {
  status: "/api/status",
  titles: "/api/titles",
  config: "/api/config",
  downloads: "/api/downloads",
  installStatus: "/api/installstatus",
  rescan: "/api/rescan",
  storage: "/api/storage",
  storageDelete: (titleId) => `/api/storage/${encodeURIComponent(titleId)}/delete`,
  action: (titleId, action) => `/api/titles/${encodeURIComponent(titleId)}/${action}`,
};

// title_id -> loaded <img>, so re-rendered cards show icons instantly.
const iconCache = new Map();

const SOURCE_TYPES = {
  official:    { label: "Official",    className: "ok",       installAllowed: true,  description: "Native console installation" },
  external:    { label: "External",    className: "external", installAllowed: true,  description: "Real external installation" },
  shadowmount: { label: "Shadowmount", className: "shadow",   installAllowed: false, description: "Not supported" },
  unknown:     { label: "Unknown",     className: "blocked",  installAllowed: false, description: "Blocked" },
  fake:        { label: "Fake package", className: "blocked", installAllowed: false, description: "Not supported" },
};

const fallback = {
  status: {
    firmware: "11.60",
    firmware_build: "0x11600000",
    dns_guard: "Active",
    resolver: "Internal allowlist",
    free_space_mb: 771916,
    download_dir: "/data/patchdl (internal)",
    lan_ip: "192.168.178.90",
    http_port: 12880,
  },
  config: {
    default_policy: "deny",
    download_dir: "/data/patchdl (internal)",
    install_after_download: false,
    delete_pkg_after_install: true,
    verify_downloads: false,
    home_shortcut: true,
    max_connections: 4,
    source_policy: {
      official: { allow_check: true, allow_download: true, allow_install: true },
      external: { allow_check: true, allow_download: true, allow_install: true },
      shadowmount: { allow_check: true, allow_download: false, allow_install: false },
      unknown: { allow_check: true, allow_download: false, allow_install: false },
      fake: { allow_check: true, allow_download: false, allow_install: false },
    },
    cdn_allowlist: [
      "sgst.prod.dl.playstation.net",
      "gst.prod.dl.playstation.net",
      "gs2.ww.prod.dl.playstation.net",
      "gs-sec.ww.np.dl.playstation.net",
    ],
  },
  titles: [
    {
      title_id: "PPSA01628_00", name: "Call of Duty Black Ops Cold War",
      content_id: "UP0002-PPSA01628_00-CODCWTHEGAME0001",
      installed_version: "01.032.000", compatible_version: "01.041.000",
      latest_version: "01.041.000", latest_required_fw: "11.60",
      source_type: "official", source_path: "/system_ex/app/PPSA01628_00",
      patch_storage_match: true,
      mount_from: "/dev/ssd0.system_ex", enabled: true, status: "available",
    },
    {
      title_id: "PPSA01284_00", name: "Demon's Souls",
      content_id: "UP9000-PPSA01284_00-DEMONSSOULS00001",
      installed_version: "01.004.000", compatible_version: "01.004.000",
      latest_version: "01.004.000", latest_required_fw: "10.01",
      source_type: "external", source_path: "/system_data/priv/appmeta/external/PPSA01284_00",
      patch_storage_match: true,
      mount_from: "/mnt/ext0/user/app/PPSA01284_00", enabled: true, status: "up_to_date",
    },
    {
      title_id: "PPSA90001_00", name: "Shadowmounted Test Title",
      content_id: "UP0000-PPSA90001_00-SHADOWMOUNT0001",
      installed_version: "01.000.000", compatible_version: "01.006.000",
      latest_version: "01.009.000", latest_required_fw: "12.00",
      source_type: "shadowmount", source_path: "/system_ex/app/PPSA90001_00",
      patch_storage_match: true,
      mount_from: "/mnt/usb0/itemzflow/Shadowmounted Test Title", enabled: true, status: "blocked",
    },
    {
      title_id: "PPSA03396", name: "The Last of Us Part I",
      content_id: "UP9000-PPSA03396_00-THELASTOFUSPART1",
      installed_version: "01.000.000", compatible_version: null,
      latest_version: "02.002.000", latest_required_fw: "10.20",
      prospero_version: "01.003.000", prospero_required_fw: "7.01", prospero_size: "71.7 GB", prospero_done: true,
      source_type: "official", source_path: "/system_ex/app/PPSA03396",
      patch_storage_match: true,
      mount_from: "/dev/ssd0.system_ex", enabled: true, status: "incompatible_fw",
    },
  ],
  downloads: [],
  logs: [],
};

let state = {
  status: fallback.status,
  config: fallback.config,
  titles: fallback.titles,
  downloads: fallback.downloads,
  logs: fallback.logs,
  view: "games",
  filter: "updates",
  query: "",
  usingFallback: false,
};

let downloadPollTimer = null;
let installPollTimer = null;
let emptyPolls = 0;
const dlMeta = {}; // per-title speed tracking: { bytes, t, speed }

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  loadInitialData().then(openGuideFromHash);
  window.addEventListener("hashchange", openGuideFromHash);
  setInterval(watchTitles, 5000);
  document.querySelectorAll("[data-donate]").forEach((b) => b.addEventListener("click", openDonate));
});

const DONATE_URL = "https://paypal.me/oliverkoester";

// Donation dialog. On the TV a link is no use, so it shows a QR code for
// the phone (hidden on phones, where the button opens PayPal directly).
function openDonate() {
  const back = document.activeElement;
  const matrix = qrEncode(DONATE_URL);
  const wrap = document.createElement("div");
  wrap.className = "guide-backdrop";
  wrap.innerHTML = `
    <section class="guide" role="dialog" aria-modal="true" aria-labelledby="donateTitle">
      <header class="guide-head">
        <div>
          <p class="eyebrow">Support PatchDL</p>
          <h2 id="donateTitle">Buy me a coffee</h2>
        </div>
        <button class="icon-button guide-close" type="button" aria-label="Close">×</button>
      </header>
      <p class="guide-why">If you like what I do, you can buy me a coffee.</p>
      ${matrix ? `<div class="guide-qr">${qrSvg(matrix)}<div>
        <span>Scan with your phone to open PayPal:</span>
        <code>${escapeHtml(DONATE_URL)}</code></div></div>` : ""}
      <a class="row-button is-update donate-open" href="${DONATE_URL}" target="_blank" rel="noopener">Open PayPal</a>
      <p class="guide-why"><small>It doesn't have to be a generous donation. A few cents are enough to show me who is interested in further development. So the motivation stays and I just know that I am not programming for the bin ;)</small></p>
    </section>`;
  const close = () => {
    document.removeEventListener("keydown", onKey);
    wrap.remove();
    if (back && document.contains(back)) back.focus();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  wrap.querySelector(".guide-close").addEventListener("click", close);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);
  wrap.querySelector(".guide-close").focus();
}

// The server rescans on its own when games are added or removed and bumps
// titles_gen whenever the list or an update check changes; reload quietly then.
let watchBusy = false;
async function watchTitles() {
  if (watchBusy) return;   // a slow reload is still running
  watchBusy = true;
  try {
    const response = await fetch(API.status, { cache: "no-store" });
    if (!response.ok) return;
    const status = await response.json();
    const changed = state.status && status.titles_gen !== state.status.titles_gen;
    if (changed) await loadInitialData({ quiet: true });
    else { state.status = status; renderStatus(); }
  } catch (_) { /* offline for a moment; the next tick retries */ }
  finally { watchBusy = false; }
}

// Refresh button: ask for a rescan right away, then reload once it had time.
async function rescanNow() {
  try { await postJson(API.rescan, {}); } catch (_) { /* older server: plain reload */ }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await loadInitialData();
}

function bindElements() {
  Object.assign(els, {
    firmwareValue: document.getElementById("firmwareValue"),
    firmwareBuild: document.getElementById("firmwareBuild"),
    dnsValue: document.getElementById("dnsValue"),
    resolverValue: document.getElementById("resolverValue"),
    spaceValue: document.getElementById("spaceValue"),
    downloadDirValue: document.getElementById("downloadDirValue"),
    railFw: document.getElementById("railFw"),
    railSpace: document.getElementById("railSpace"),
    gameGrid: document.getElementById("gameGrid"),
    logOutput: document.getElementById("logOutput"),
    allowlistHosts: document.getElementById("allowlistHosts"),
    sourcePolicyList: document.getElementById("sourcePolicyList"),
    storageList: document.getElementById("storageList"),
    storageTotal: document.getElementById("storageTotal"),
    searchInput: document.getElementById("searchInput"),
    defaultPolicy: document.getElementById("defaultPolicy"),
    downloadDir: document.getElementById("downloadDir"),
    installAfterDownload: document.getElementById("installAfterDownload"),
    deleteAfterInstall: document.getElementById("deleteAfterInstall"),
    verifyDownloads: document.getElementById("verifyDownloads"),
    homeShortcut: document.getElementById("homeShortcut"),
    connValue: document.getElementById("connValue"),
    connMinus: document.getElementById("connMinus"),
    connPlus: document.getElementById("connPlus"),
    refreshBtn: document.getElementById("refreshBtn"),
    updateAllBtn: document.getElementById("updateAllBtn"),
    brandVersion: document.getElementById("brandVersion"),
    globalDl:         document.getElementById("globalDl"),
    globalDlState:    document.getElementById("globalDlState"),
    globalDlName:     document.getElementById("globalDlName"),
    globalDlPosition: document.getElementById("globalDlPosition"),
    globalDlPct:      document.getElementById("globalDlPct"),
    globalDlSpeed:    document.getElementById("globalDlSpeed"),
    globalDlEta:      document.getElementById("globalDlEta"),
    globalDlBar:      document.getElementById("globalDlBar"),
    saveBtn: document.getElementById("saveBtn"),
    clearLogBtn: document.getElementById("clearLogBtn"),
    toast: document.getElementById("toast"),
  });
}

function bindEvents() {
  document.querySelectorAll(".nav-link").forEach((b) =>
    b.addEventListener("click", () => setView(b.dataset.view)));

  els.searchInput.addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    renderGames();
  });

  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segmented button").forEach((i) => {
        i.classList.remove("is-selected");
        i.setAttribute("aria-pressed", "false");
      });
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
      state.filter = button.dataset.filter;
      renderGames();
    });
  });

  els.refreshBtn.addEventListener("click", rescanNow);
  if (els.updateAllBtn) els.updateAllBtn.addEventListener("click", updateAll);
  els.saveBtn.addEventListener("click", saveConfig);
  els.clearLogBtn.addEventListener("click", () => { state.logs = []; renderLogs(); });
  if (els.connMinus)
    els.connMinus.addEventListener("click", () => setConnections(clampConn(state.config.max_connections) - 1));
  if (els.connPlus)
    els.connPlus.addEventListener("click", () => setConnections(clampConn(state.config.max_connections) + 1));
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-link").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("is-active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("is-active", s.dataset.view === view));
  if (view === "settings") loadStorage();
}

async function loadInitialData({ quiet = false } = {}) {
  state.usingFallback = false;
  const [status, config, titles, downloads] = await Promise.all([
    getJson(API.status, fallback.status),
    getJson(API.config, fallback.config),
    getJson(API.titles, fallback.titles),
    getJson(API.downloads, fallback.downloads),
  ]);

  // /api/titles carries no client-only progress flags, so preserve them across a
  // refresh — otherwise an in-flight download/install flips back to a clickable
  // button mid-operation.
  // Carry client-only flags across a refresh; the pool's job list is the source
  // of truth for download state and is reconciled right after.
  const prev = new Map(state.titles.map((g) => [g.title_id, g]));
  titles.forEach((g) => {
    const old = prev.get(g.title_id);
    // Neither state has a patch left to fetch, so drop stale job flags.
    // An install ends when the install poll says so, not when the list
    // already reports the new version (the console writes it mid-install).
    if (old && old.installing) {
      g.installing = true;
      g.installStatus = old.installStatus;
      g.installProgress = old.installProgress;
      g.installDone = old.installDone;
      g.installTotal = old.installTotal;
    }
    if (old && g.status !== "up_to_date" &&
        (g.status !== "incompatible_fw" || g.manual_version)) {
      if (old._autoInstalled) g._autoInstalled = true;
      if (old._localDownloading) g._localDownloading = true;
      if (old._wasActive) g._wasActive = true;
    }
  });

  // A background reload must not swap the real list for demo data because
  // one request failed for a moment.
  if (quiet && state.usingFallback) { state.usingFallback = false; return; }
  state = { ...state, status, config, titles, downloads };
  reconcileFromJobs(downloads);

  render();
  if (downloads.some((j) => j.state === "active" || j.state === "queued") ||
      state.titles.some((g) => g._localDownloading))
    startDownloadPolling();
  if (state.titles.some((g) => g.installing)) startInstallPolling();
  // Pick up installs that are running while this page was (re)loaded.
  if (!quiet) refreshInstallStatus();
  if (!quiet)
    showToast(state.usingFallback ? "Demo data loaded. API is not reachable yet." : "Data refreshed.");
}

async function getJson(url, fallbackValue) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    state.usingFallback = true;
    return clone(fallbackValue);
  }
}

function render() {
  renderStatus();
  renderSettings();
  renderGames();
  renderLogs();
}

function renderStatus() {
  els.firmwareValue.textContent = state.status.firmware || "--";
  els.firmwareBuild.textContent = state.status.firmware_build || "System version";
  els.dnsValue.textContent = state.status.dns_guard || "--";
  els.resolverValue.textContent = state.status.resolver || "--";
  const space = formatMb(state.status.free_space_mb);
  els.spaceValue.textContent = space;
  const kept = Number(state.status.downloads_bytes) || 0;
  if (kept > 0) {
    // Packages on disk take space too; the link opens the list to manage them.
    els.downloadDirValue.innerHTML =
      `<button type="button" class="link-button">${formatBytes(kept)} in downloads · manage</button>`;
    els.downloadDirValue.querySelector("button").addEventListener("click", () => setView("settings"));
  } else {
    els.downloadDirValue.textContent = state.status.download_dir || state.config.download_dir || "Download target";
  }
  if (els.railFw) els.railFw.textContent = `FW ${state.status.firmware || "--"}`;
  if (els.railSpace) els.railSpace.textContent = `${space} free`;
  if (els.brandVersion)
    els.brandVersion.textContent = state.status.version ? `v${state.status.version}` : "v--";
}

const CONN_MIN = 1, CONN_MAX = 16;
function clampConn(n) {
  n = parseInt(n, 10);
  if (!Number.isFinite(n)) n = 4;
  return Math.max(CONN_MIN, Math.min(CONN_MAX, n));
}

function renderConnStepper() {
  const n = clampConn(state.config.max_connections);
  if (els.connValue) els.connValue.textContent = String(n);
  if (els.connMinus) els.connMinus.disabled = n <= CONN_MIN;
  if (els.connPlus) els.connPlus.disabled = n >= CONN_MAX;
}

let connSaveTimer = null;
// Stepper +/-: update + re-render immediately, then persist just this field
// (debounced) so rapid taps collapse into one POST and other unsaved form
// fields stay untouched. The server applies the new count live (no restart).
function setConnections(n) {
  const v = clampConn(n);
  if (v === clampConn(state.config.max_connections)) { renderConnStepper(); return; }
  state.config.max_connections = v;
  renderConnStepper();
  clearTimeout(connSaveTimer);
  connSaveTimer = setTimeout(async () => {
    try {
      await postJson(API.config, { max_connections: v });
      showToast(`Parallel connections: ${v}`);
    } catch (e) {
      showToast("Could not save connections — API not reachable.");
    }
  }, 450);
}

function renderSettings() {
  els.defaultPolicy.value = state.config.default_policy || "deny";
  els.downloadDir.value = state.config.download_dir || "";
  els.installAfterDownload.checked = Boolean(state.config.install_after_download);
  els.deleteAfterInstall.checked = Boolean(state.config.delete_pkg_after_install);
  if (els.verifyDownloads) els.verifyDownloads.checked = Boolean(state.config.verify_downloads);
  if (els.homeShortcut) els.homeShortcut.checked = state.config.home_shortcut !== false;
  renderConnStepper();
  els.allowlistHosts.replaceChildren(...(state.config.cdn_allowlist || []).map((host) => {
    const chip = document.createElement("span");
    chip.className = "host-chip";
    chip.textContent = host;
    return chip;
  }));
  renderSourcePolicies();
}

/* ---------------- games ---------------- */

function renderGames() {
  renderGlobalStatus();
  const counts = { updates: 0, uptodate: 0, blocked: 0, all: state.titles.length };
  state.titles.forEach((g) => { counts[gameCategory(g)]++; });
  document.querySelectorAll(".segmented button").forEach((b) => {
    const c = b.querySelector(".chip-count");
    if (c) c.textContent = String(counts[b.dataset.filter] ?? "");
  });
  const visible = state.titles.filter(matchesFilter).filter(matchesQuery)
    .sort((a, b) => (a.name || a.title_id).localeCompare(b.name || b.title_id, undefined, { sensitivity: "base", numeric: true }));
  els.gameGrid.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No titles match this filter.";
    els.gameGrid.appendChild(empty);
    return;
  }
  visible.forEach((game) => els.gameGrid.appendChild(createGameCard(game)));
}

// One bucket per game for the filter chips, answering a single question: is
// there something to get for this console? Where the patch comes from (Sony,
// Prospero) and whether it installs or only downloads is shown on the card.
function isPs4(game) { return (game.title_id || "").startsWith("CUSA"); }

function gameCategory(game) {
  const policy = sourcePolicy(game);
  // Not supported = PatchDL can't install it (fake packages, mounted images).
  if (game.patch_title_match === false || !policy.allow_install || game.status === "blocked")
    return "blocked";
  if (game.downloading || game.resumable || game.downloaded || game.installing || game._jobState)
    return "updates";
  if (game.status === "checking" || game.status === "available" || hasOlderPatch(game))
    return "updates";
  return "uptodate";
}

// Sony's newest patch needs newer firmware, but Prospero knows an older one
// that runs here and is newer than what is installed.
function hasOlderPatch(game) {
  return game.status === "incompatible_fw" && Boolean(game.prospero_version) &&
    game.prospero_version > (game.installed_version || "");
}

function matchesFilter(game) {
  if (state.filter === "all") return true;
  return gameCategory(game) === state.filter;
}

function matchesQuery(game) {
  if (!state.query) return true;
  return [game.name, game.title_id, game.content_id, game.source_type, game.source_path, game.mount_from]
    .filter(Boolean)
    .some((v) => v.toLowerCase().includes(state.query));
}

function createGameCard(game) {
  const card = document.createElement("article");
  card.className = "game-card";
  card.dataset.titleId = game.title_id;
  if (game.downloading) card.classList.add("is-downloading");
  if (game.installing) card.classList.add("is-installing");

  // ---- top row: icon (+ toggle) | body | action ----
  const row = document.createElement("div");
  row.className = "card-row";

  const lead = document.createElement("div");
  lead.className = "lead";
  const cover = document.createElement("div");
  cover.className = "cover";
  cover.textContent = initials(game.name);
  if (game.has_icon) {
    // Cards re-render on every poll. Reuse an icon that already loaded so
    // it doesn't flash back to the initials; a failed icon keeps them.
    const loaded = iconCache.get(game.title_id);
    if (loaded) {
      cover.replaceChildren(loaded.cloneNode());
    } else {
      const img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.onload = () => { iconCache.set(game.title_id, img); cover.replaceChildren(img.cloneNode()); };
      img.src = `/api/icon/${encodeURIComponent(game.title_id)}`;
    }
  }
  lead.appendChild(cover);
  if (sourcePolicy(game).allow_install) lead.appendChild(buildToggle(game));

  const body = document.createElement("div");
  body.className = "card-body";
  body.innerHTML = `
    <h3>${escapeHtml(game.name)}</h3>
    <div class="subline">
      <span>${escapeHtml(game.title_id)}</span>
      <span>${escapeHtml(game.content_id || "")}</span>
    </div>
    <div class="pills">
      ${game.downloading && game._jobState === "queued" ? `<span class="pill">Queued</span>` : ""}
      ${game.downloading && game._jobState !== "queued" ? `<span class="pill live">Downloading</span>` : ""}
      ${game.resumable && !game.downloading ? `<span class="pill warn">Paused</span>` : ""}
      ${statusPill(game)}
      ${sourcePill(game)}
      ${isPs4(game) ? `<span class="pill">PS4</span>` : ""}
    </div>
    <div class="versions">${versionsHtml(game)}</div>
  `;

  const actions = document.createElement("div");
  actions.className = "card-actions";
  [primaryButton(game), stopButton(game)].forEach((act) => {
    if (!act) return;
    const btn = document.createElement("button");
    btn.className = `row-button is-${act.variant}`;
    btn.textContent = act.label;
    if (act.hint) btn.title = act.hint;
    if (act.disabled) btn.disabled = true;
    else btn.addEventListener("click", () => runTitleAction(game.title_id, act.action));
    actions.appendChild(btn);
  });

  row.append(lead, body, actions);
  card.appendChild(row);

  // ---- progress block (only while downloading) ----
  if (game.downloading) {
    const d = state.downloads.find((x) => x.title_id === game.title_id) || {};
    const prog = document.createElement("div");
    prog.className = "card-progress";
    prog.innerHTML = `
      <div class="progress"><i style="width:${pctOf(d)}%"></i></div>
      <div class="progress-meta">${progressMetaHtml(d)}</div>
    `;
    card.appendChild(prog);
  } else if (game.installing) {
    const pct = Math.max(0, Math.min(100, Number(game.installProgress) || 0));
    const indet = game.installStatus === "finishing" || game.installStatus === "waiting";
    const note = document.createElement("div");
    note.className = "card-progress";
    note.innerHTML = `
      <div class="progress${indet ? " is-indeterminate" : ""}"><i style="width:${indet ? 32 : pct}%${indet ? `;animation-delay:-${Date.now() % INDET_MS}ms` : ""}"></i></div>
      <div class="progress-meta">${installProgressHtml(game)}</div>
    `;
    card.appendChild(note);
  } else if (game.resumable && game.partial_bytes > 0) {
    // ---- paused partial (survived a reboot) ----
    const note = document.createElement("div");
    note.className = "card-progress";
    note.innerHTML = `
      <div class="progress-meta">
        <span>Paused — <b>${formatBytes(game.partial_bytes)}</b> downloaded</span>
        <span>Resume to continue</span>
      </div>
    `;
    card.appendChild(note);
  }

  return card;
}

function buildToggle(game) {
  const toggle = document.createElement("label");
  toggle.className = "toggle";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = game.enabled !== false;
  cb.setAttribute("aria-label", `Enable updates for ${game.name}`);
  const track = document.createElement("span");
  track.className = "track";
  const lbl = document.createElement("span");
  lbl.className = "label";
  lbl.textContent = cb.checked ? "Updates on" : "Updates off";
  cb.addEventListener("change", () => {
    lbl.textContent = cb.checked ? "Updates on" : "Updates off";
    updateGame(game.title_id, { enabled: cb.checked });
  });
  toggle.append(cb, track, lbl);
  return toggle;
}

// Primary play/pause button (green to go, amber while downloading). Fixed width
// (CSS) so the label never reflows. Returns null when there is nothing to do.
function primaryButton(game) {
  if (game.installing) return { label: "Installing…", variant: "ghost", disabled: true };
  if (game.downloading) return { label: "Pause", action: "pause", variant: "pause", hint: "Pause the download (keeps what was downloaded)." };
  if (game.patch_title_match === false) return null;
  if (canGetOlderPatch(game))
    return { label: "Old FW patch", action: "guide", variant: "update", hint: `Get ${game.prospero_version} from Prospero Patches, the newest patch that runs on this firmware.` };
  if (game.resumable && isDownloadAllowed(game))
    return { label: "Resume", action: "download", variant: "update", hint: "Continue the paused download where it stopped." };
  const hasPatch = game.status === "available" || Boolean(game.manual_version);
  if (game.downloaded && hasPatch && isInstallAllowed(game))
    return { label: "Install", action: "install", variant: "update", hint: "Install the downloaded patch (modifies the game)." };
  if (game.downloaded && hasPatch) return null;
  if (!hasPatch) return null;
  if (!isDownloadAllowed(game)) return null;
  return state.config.install_after_download && isInstallAllowed(game)
    ? { label: "Update", action: "update", variant: "update", hint: "Download and install the update." }
    : { label: "Download", action: "download", variant: "update", hint: "Download the patch internally." };
}

// Red stop button: present whenever there is a download to stop or discard.
// Cancel stops AND deletes (unlike Pause, which keeps the partial).
function stopButton(game) {
  if (game.installing) return null;
  if (game.downloaded && !game.downloading)
    return { label: "Delete", action: "cancel", variant: "cancel", hint: "Delete the downloaded package to free space." };
  if (game.downloading || game.resumable)
    return { label: "Cancel", action: "cancel", variant: "cancel", hint: "Stop and delete the download." };
  return null;
}

// Installed -> what PatchDL can get for this console -> newest overall with
// the firmware it needs (left out when it's the same as the offered update).
function versionsHtml(game) {
  const v = (x) => `<b>${escapeHtml(x)}</b>`;
  const parts = [`<span>Installed ${v(game.installed_version || "--")}</span>`];
  let offered = "";
  if (game.manual_version) {
    offered = game.manual_version;
    parts.push(`<span>Update ${v(offered)} · from Prospero</span>`);
  } else if (game.status === "available" && game.compatible_version) {
    offered = game.compatible_version;
    parts.push(`<span>Update ${v(offered)}</span>`);
  } else if (hasOlderPatch(game)) {
    offered = game.prospero_version;
    const fw = game.prospero_required_fw ? ` · needs FW ${escapeHtml(game.prospero_required_fw)}` : "";
    parts.push(`<span class="prospero-line">Update ${v(offered)}${fw} · <a href="https://prosperopatches.com/${encodeURIComponent(game.title_id)}" target="_blank" rel="noopener">Prospero</a></span>`);
  } else if (game.status === "incompatible_fw" && !game.prospero_done) {
    parts.push(`<span>Looking for a patch for this firmware\u2026</span>`);
  }
  const job = state.downloads.find((d) => d.title_id === game.title_id);
  if (job && job.state === "error" && Number(job.rc) === -3)
    parts.push(`<span class="card-note is-warn">${noSpaceText(job.need_bytes, job.free_bytes)}</span>`);
  if (game.latest_version && game.latest_version !== offered) {
    const fw = game.latest_required_fw ? ` · needs FW ${escapeHtml(game.latest_required_fw)}` : "";
    parts.push(`<span>Newest ${v(game.latest_version)}${fw}</span>`);
  }
  return parts.join("");
}

function statusPill(game) {
  if (game.installing) return `<span class="pill warn">Installing…</span>`;
  if (game.status === "checking") return `<span class="pill">Checking…</span>`;
  if (game.status === "blocked" || !sourcePolicy(game).allow_install)
    return `<span class="pill">Not supported</span>`;
  if (game.patch_title_match === false) return `<span class="pill blocked">Title mismatch</span>`;
  if (game.manual_version || hasOlderPatch(game)) return `<span class="pill prospero">Via Prospero</span>`;
  if (game.status === "available") return `<span class="pill ok">Update available</span>`;
  if (game.status === "incompatible_fw")
    return `<span class="pill">Newest needs FW ${escapeHtml(game.latest_required_fw || "?")}</span>`;
  if (game.status === "up_to_date") return `<span class="pill">Up to date</span>`;
  return `<span class="pill">No patch info</span>`;
}

function sourcePill(game) {
  const info = sourceInfo(game);
  return `<span class="pill ${info.className}">${escapeHtml(info.label)}</span>`;
}
function sourceInfo(game) { return SOURCE_TYPES[sourceType(game)] || SOURCE_TYPES.unknown; }
function sourceType(game) { return game.source_type || "unknown"; }

/* ---------------- download progress (in-tile) ---------------- */

function pctOf(d) {
  const done = Number(d.bytes) || 0;
  const total = Number(d.total_bytes) || 0;
  if (total > 0) return Math.max(0, Math.min(100, Math.round((done * 100) / total)));
  return Math.max(0, Math.min(100, Number(d.progress) || 0));
}

function progressMetaHtml(d) {
  const done = Number(d.bytes) || 0;
  const total = Number(d.total_bytes) || 0;
  const speed = Number(d._speed) || 0;
  if (d.state === "queued") return `<span>Queued — waiting for a free slot</span>`;
  const parts = [];
  if (d.verifying) parts.push(`<span><b>Checking the package already on disk</b></span>`);
  parts.push(`<span><b>${formatBytes(done)}</b>${total > 0 ? ` / ${formatBytes(total)}` : ""}</span>`);
  if (speed > 0) parts.push(`<span><b>${formatBytes(speed)}/s</b></span>`);
  if (speed > 0 && total > done) parts.push(`<span>ETA <b>${formatEta((total - done) / speed)}</b></span>`);
  else if (!total) parts.push(`<span>Fetching manifest…</span>`);
  parts.push(`<span><b>${pctOf(d)}%</b></span>`);
  return parts.join("");
}

// One sweep of the indeterminate bar. Cards are rebuilt on every list
// update; a negative delay taken from the clock lets a rebuilt bar continue
// where the old one was instead of starting over.
const INDET_MS = 1600;

const INSTALL_PHASE_TEXT = {
  waiting: "Waiting for the console",
  reading: "Console reading package",
  finishing: "Finishing on console",
};

function installProgressHtml(game) {
  const status = game.installStatus || "waiting";
  const done = Number(game.installDone) || 0;
  const total = Number(game.installTotal) || 0;
  const phase = INSTALL_PHASE_TEXT[status];
  if (phase) {
    const parts = [`<span><b>${phase}</b></span>`];
    if (status === "reading" && total > 0) {
      parts.push(`<span><b>${formatBytes(done)}</b> / ${formatBytes(total)}</span>`);
      parts.push(`<span><b>${Math.max(0, Math.min(100, Number(game.installProgress) || 0))}%</b></span>`);
    }
    return parts.join("");
  }
  const parts = [`<span>Status <b>${escapeHtml(status)}</b></span>`];
  if (total > 0) parts.push(`<span><b>${formatBytes(done)}</b> / ${formatBytes(total)}</span>`);
  parts.push(`<span><b>${Math.max(0, Math.min(100, Number(game.installProgress) || 0))}%</b></span>`);
  return parts.join("");
}

function startDownloadPolling() {
  emptyPolls = 0;
  if (downloadPollTimer) return;
  downloadPollTimer = setInterval(refreshDownloads, 2000);
  refreshDownloads();
}

function stopDownloadPolling() {
  if (!downloadPollTimer) return;
  clearInterval(downloadPollTimer);
  downloadPollTimer = null;
}

// Map the pool's job list onto per-title flags, and auto-install once a job
// finishes if "install after download" is on.
function reconcileFromJobs(jobs) {
  const byId = new Map((jobs || []).map((j) => [j.title_id, j]));
  state.titles.forEach((g) => {
    const j = byId.get(g.title_id);
    if (!j) {
      // The pool never produced a job for our local intent: time it out so the
      // card can't wedge in "Downloading" forever (server restart between POST
      // and poll, or an unexpected response shape).
      if (g._localDownloading && g._localSince &&
          Date.now() - g._localSince > 12000) {
        g._localDownloading = false;
      }
      if (g.downloading && !g._localDownloading) g.downloading = false;
      g._jobState = null;
      return;
    }
    // A download started from this page counts as watched even if it
    // finished before a poll saw it running (a verified package on disk).
    if (g._localDownloading) g._wasActive = true;
    g._localDownloading = false; // the pool now tracks it
    g._jobState = j.state;
    if (j.state === "active" || j.state === "queued") {
      g._spaceWarned = false;
      g.downloading = true;
      g.resumable = false;
      g._wasActive = true;
    } else if (j.state === "paused") {
      g.downloading = false;
      g.resumable = true;
      g.partial_bytes = Number(j.bytes) || g.partial_bytes || 0;
      g._wasActive = false;
    } else if (j.state === "done") {
      // Auto-install once, on the download finishing while this page watched
      // it, and only while the update is still pending. A finished job stays
      // in the pool; without these checks every poll would retry the install
      // (refused as already installed) and redraw the list each time.
      const justFinished = g._wasActive;
      const pending = g.status === "available" || Boolean(g.manual_version);
      g.downloading = false;
      g.resumable = false;
      g.downloaded = true;
      g._wasActive = false;
      if (justFinished && pending && state.config.install_after_download &&
          isInstallAllowed(g) && !g.installing && !g._autoInstalled) {
        g._autoInstalled = true;
        doInstall(g);
      }
    } else if (j.state === "error") {
      // The server keeps the partial + sidecar (resumable) on a post-retry
      // network failure. Reflect that so primaryButton shows "Resume" and the
      // red Cancel stays available to delete the kept partial.
      const bytes = Number(j.bytes) || 0;
      if (Number(j.rc) === -3) {
        if (!g._spaceWarned) showToast(`${g.name}: ${noSpaceText(j.need_bytes, j.free_bytes)}`);
        g._spaceWarned = true;
      } else if (g._wasActive) {
        showToast(`${g.name}: download failed${bytes > 0 ? " — partial kept, press Resume to continue" : "."}`);
      }
      g._wasActive = false;
      g.downloading = false;
      g.resumable = bytes > 0;
      g.partial_bytes = bytes || g.partial_bytes || 0;
    }
  });
}

function startInstallPolling() {
  if (installPollTimer) return;
  installPollTimer = setInterval(refreshInstallStatus, 2000);
  refreshInstallStatus();
}

function stopInstallPolling() {
  if (!installPollTimer) return;
  clearInterval(installPollTimer);
  installPollTimer = null;
}

async function refreshInstallStatus() {
  let s;
  try {
    const response = await fetch(API.installStatus, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    s = await response.json();
  } catch (error) {
    return;
  }

  if (!s || !s.active) {
    if (!state.titles.some((g) => g.installing)) stopInstallPolling();
    return;
  }

  // Installs streamed from PatchDL: what PatchDL measured itself (how much
  // of each package the console read) beats Sony's status query, which fails
  // or reports nothing useful for them. One entry per title.
  const streams = Array.isArray(s.streams) ? s.streams : [];
  if (streams.length) {
    let ended = false, changed = false;
    streams.forEach((st) => {
      const game = state.titles.find((g) => g.title_id.startsWith(st.title_id));
      if (!game) return;
      const over = st.phase === "done" || st.phase === "stalled";
      if (over && !game.installing) return;   // finished before this page watched it
      const total = Number(st.total) || 0;
      const read = Math.min(Number(st.read) || 0, total || Infinity);
      const pct = total ? Math.floor((read * 100) / total) : 0;
      // Re-render only on a visible change: a rebuilt card restarts the
      // indeterminate bar's animation.
      if (game.installing !== !over || game.installStatus !== st.phase ||
          game.installProgress !== pct) changed = true;
      game.installing = !over;
      game.installStatus = st.phase;
      game.installProgress = pct;
      game.installDone = read;
      game.installTotal = total;
      if (over) {
        const msg = st.phase === "stalled"
          ? "stopped: the console stopped reading the package"
          : st.verified
            ? `done and verified${st.deleted ? ", package deleted" : ", package kept"}`
            : "finished, but the new version could not be confirmed; package kept";
        state.logs.push(`[${timeNow()}] Install ${game.title_id}: ${msg}.`);
        showToast(`${game.name}: install ${msg}.`);
        ended = true;
      }
    });
    if (changed) renderGames();
    if (state.titles.some((g) => g.installing)) startInstallPolling();
    if (ended) {
      renderLogs();
      if (!state.titles.some((g) => g.installing)) stopInstallPolling();
      loadInitialData({ quiet: true });
    }
    return;
  }

  const titleId = s.target_title_id || "";
  const game = state.titles.find((g) => g.title_id === titleId || g.title_id.slice(0, 9) === titleId.slice(0, 9));
  if (!game) return;

  game.installing = !s.terminal;
  game.installStatus = s.status || "running";
  game.installProgress = Number(s.progress) || 0;
  game.installDone = Number(s.downloaded_size) || 0;
  game.installTotal = Number(s.total_size) || 0;
  renderGames();

  if (s.terminal) {
    const ok = s.status === "playable";
    state.logs.push(`[${timeNow()}] Install ${ok ? "completed" : "stopped"} for ${game.title_id}: ${s.status || "unknown"}${s.error_code ? ` (0x${Number(s.error_code >>> 0).toString(16)})` : ""}`);
    renderLogs();
    stopInstallPolling();
    if (ok) loadInitialData();
  }
}

async function refreshDownloads() {
  let jobs;
  try {
    const response = await fetch(API.downloads, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    jobs = await response.json();
  } catch (error) {
    return; // keep last state on a transient failure
  }

  const now = Date.now();
  const ids = new Set();
  jobs.forEach((j) => {
    ids.add(j.title_id);
    const done = Number(j.bytes) || 0;
    const prev = dlMeta[j.title_id];
    if (prev && now > prev.t) {
      if (done >= prev.bytes) {
        const inst = ((done - prev.bytes) * 1000) / (now - prev.t); // bytes/s
        prev.speed = prev.speed ? prev.speed * 0.5 + inst * 0.5 : inst; // smoothed
      } else {
        prev.speed = 0; // counter went backwards -> re-baseline
      }
    }
    const meta = prev || (dlMeta[j.title_id] = { speed: 0 });
    meta.bytes = done;
    meta.t = now;
    j._speed = meta.speed || 0;
  });
  Object.keys(dlMeta).forEach((id) => { if (!ids.has(id)) delete dlMeta[id]; });

  state.downloads = jobs;
  const before = downloadingIds();
  reconcileFromJobs(jobs);
  if (downloadingIds() !== before) renderGames();
  else applyDownloadProgress();

  const busy = jobs.some((j) => j.state === "active" || j.state === "queued") ||
               state.titles.some((g) => g._localDownloading);
  if (!busy) { if (++emptyPolls >= 3) stopDownloadPolling(); }
  else emptyPolls = 0;
}

function downloadingIds() {
  return state.titles.filter((g) => g.downloading).map((g) => g.title_id).join(",");
}

// Top-of-page status banner. Visible while any job in this batch is queued,
// active, or has just finished (done jobs linger one or two polls before the
// pool reaps them, which is what gives us the "5 of 9" position).
function renderGlobalStatus() {
  const el = els.globalDl;
  if (!el) return;
  const jobs   = state.downloads || [];
  const batch  = jobs.filter((j) => ["queued", "active", "done"].includes(j.state));
  const flying = batch.filter((j) => j.state === "queued" || j.state === "active");

  if (flying.length === 0) { el.hidden = true; return; }
  el.hidden = false;

  const active = batch.find((j) => j.state === "active") || flying[0];
  const total  = batch.length;
  const done   = batch.filter((j) => j.state === "done").length;
  const pos    = Math.min(total, done + 1);
  const isActive = active && active.state === "active";

  // Eyebrow + name
  els.globalDlState.textContent = !isActive ? "Queued" : active.verifying ? "Verifying" : "Downloading";
  els.globalDlName.textContent  = active.name || active.title_id || "—";

  // Position chip ("3 of 9") only when there's more than one game in this run
  if (total > 1) {
    els.globalDlPosition.hidden = false;
    els.globalDlPosition.textContent = `${pos} of ${total}`;
  } else {
    els.globalDlPosition.hidden = true;
  }

  // Progress line
  const pct   = pctOf(active);
  const speed = Number(active._speed) || 0;
  const done_ = Number(active.bytes) || 0;
  const total_ = Number(active.total_bytes) || 0;
  els.globalDlPct.innerHTML   = isActive ? `<b>${pct}%</b>` : `<b>—</b> waiting`;
  els.globalDlSpeed.innerHTML = isActive && speed > 0
    ? `<b>${formatBytes(speed)}/s</b>`
    : (isActive && !total_ ? "fetching manifest…" : "—");
  els.globalDlEta.innerHTML = isActive && speed > 0 && total_ > done_
    ? `ETA <b>${formatEta((total_ - done_) / speed)}</b>`
    : "";

  // Bar: animated indeterminate while fetching manifest, otherwise width=pct
  if (isActive && total_ > 0) {
    els.globalDlBar.classList.remove("is-indeterminate");
    els.globalDlBar.style.width = pct + "%";
  } else {
    els.globalDlBar.classList.add("is-indeterminate");
  }
}

// Update the progress bar/meta in place to avoid rebuilding every card each tick.
function applyDownloadProgress() {
  renderGlobalStatus();
  let needRender = false;
  state.downloads.forEach((d) => {
    // Only titles currently downloading render a progress tile; paused/done/error
    // jobs linger in the pool list but have no .progress bar — skip them so a
    // missing tile for a non-downloading title doesn't force a full rebuild.
    const g = state.titles.find((t) => t.title_id === d.title_id);
    if (!g || !g.downloading) return;
    const card = els.gameGrid.querySelector(`[data-title-id="${d.title_id}"]`);
    const bar = card && card.querySelector(".card-progress .progress > i");
    const meta = card && card.querySelector(".card-progress .progress-meta");
    if (!bar || !meta) { needRender = true; return; }
    bar.style.width = pctOf(d) + "%";
    meta.innerHTML = progressMetaHtml(d);
  });
  if (needRender) renderGames();
}

/* ---------------- settings ---------------- */

const STORAGE_STATE = {
  complete: { label: "Complete", className: "ok" },
  paused: { label: "Paused", className: "warn" },
  downloading: { label: "Downloading", className: "live" },
  installing: { label: "Installing", className: "live" },
  failed: { label: "Failed", className: "blocked" },
};

// What PatchDL keeps under /data/patchdl, one row per title folder, with a
// delete button that also works for games that are no longer installed.
async function loadStorage() {
  if (!els.storageList) return;
  let data;
  try {
    const response = await fetch(API.storage, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    els.storageList.innerHTML = `<p class="storage-empty">Could not read the download folder.</p>`;
    return;
  }
  const items = (data.items || []).sort((a, b) => b.bytes - a.bytes);
  els.storageTotal.textContent = items.length ? `${formatBytes(data.total_bytes)} in total` : "";
  if (!items.length) {
    els.storageList.innerHTML = `<p class="storage-empty">Nothing downloaded.</p>`;
    return;
  }
  els.storageList.replaceChildren(...items.map((item) => {
    const info = STORAGE_STATE[item.state] || STORAGE_STATE.complete;
    const busy = item.state === "installing" || item.state === "downloading";
    const row = document.createElement("div");
    row.className = "storage-row";
    row.innerHTML = `
      <span><strong>${escapeHtml(item.name || item.title_id)}</strong><br>
        <em>${escapeHtml(item.title_id)}${item.version ? ` · ${escapeHtml(item.version)}` : ""} · ${storageRelation(item)}</em></span>
      <span class="pill ${info.className}">${info.label}</span>
      <b>${formatBytes(item.bytes)}</b>
    `;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-button is-cancel";
    btn.textContent = "Delete";
    btn.disabled = busy;
    btn.title = busy ? "Busy right now" : `Delete ${formatBytes(item.bytes)} for ${item.name || item.title_id}`;
    btn.addEventListener("click", () => deleteStorage(item));
    row.appendChild(btn);
    return row;
  }));
}

// How the package relates to the installed game, so a kept package can be
// judged: still useful (newer), spent (installed), or for a game not present.
function storageRelation(item) {
  if (!item.installed) return "game not installed";
  if (!item.version || !item.installed_version) return "version unknown";
  return item.version > item.installed_version ? "newer than installed" : "already installed";
}

async function deleteStorage(item) {
  const label = item.name || item.title_id;
  if (!window.confirm(`Delete the download for ${label} (${formatBytes(item.bytes)})?`)) return;
  try {
    await postJson(API.storageDelete(item.title_id), {});
    showToast(`${label}: download deleted.`);
  } catch (error) {
    showToast(`${label}: ${reasonText(error)}`);
  }
  await loadStorage();
  await loadInitialData({ quiet: true });
}

function renderSourcePolicies() {
  const rows = Object.keys(SOURCE_TYPES).map((type) => {
    const info = SOURCE_TYPES[type];
    const policy = sourcePolicyForType(type);
    const row = document.createElement("div");
    row.className = "policy-row";
    row.innerHTML = `
      <span class="pill ${info.className}">${escapeHtml(info.label)}</span>
      <strong>${policy.allow_install ? "Install allowed" : "Install blocked"}</strong>
      <em>${policy.allow_download ? "Download allowed" : "Download blocked"} - ${escapeHtml(info.description)}</em>
    `;
    return row;
  });
  els.sourcePolicyList.replaceChildren(...rows);
}

function renderLogs() {
  els.logOutput.textContent = state.logs.length ? state.logs.join("\n") : "No events yet.";
}

async function saveConfig() {
  const config = {
    ...state.config,
    default_policy: els.defaultPolicy.value,
    download_dir: els.downloadDir.value.trim(),
    install_after_download: els.installAfterDownload.checked,
    delete_pkg_after_install: els.deleteAfterInstall.checked,
    verify_downloads: els.verifyDownloads ? els.verifyDownloads.checked : Boolean(state.config.verify_downloads),
    home_shortcut: els.homeShortcut ? els.homeShortcut.checked : state.config.home_shortcut !== false,
    max_connections: clampConn(state.config.max_connections),
  };
  try {
    await postJson(API.config, config);
    state.config = config;
    showToast("Configuration saved.");
  } catch (error) {
    state.config = config;
    showToast("Configuration updated locally. API is not reachable yet.");
  }
  renderSettings();
  renderGames(); // install_after_download changes the button label
}

/* ---------------- actions (data layer) ---------------- */

// Queue a download for every game that has an available update AND could
// actually be installed afterwards. Shadowmounts pass isDownloadAllowed but
// fail isInstallAllowed (their app slot has no real source medium), so a
// sweep would otherwise pull tens of GB that AppInstUtil will refuse — the
// user picks those up by hand when the disc is ready. The server tolerates
// duplicate requests, so a second click is harmless. If install_after_download
// is on, the per-job auto-install pipeline kicks in once each download
// finishes — no further client action needed.
async function updateAll() {
  const targets = state.titles.filter((g) =>
    g.status === "available" && isInstallAllowed(g) &&
    !g.downloading && !g.downloaded);
  if (!targets.length) {
    showToast("No installable updates to queue.");
    return;
  }
  showToast(`Queueing ${targets.length} update${targets.length === 1 ? "" : "s"}…`);
  for (const g of targets) {
    // Sequential await: the pool returns quickly (202 Accepted) and we want
    // a stable order in the queue, not a thundering-herd of concurrent POSTs.
    try { await doDownload(g); } catch (_) { /* per-job errors already toast */ }
  }
}

// Enqueue a download. The pool returns immediately (202); progress, completion
// and (if configured) auto-install are driven by reconcileFromJobs() on poll.
async function doDownload(game) {
  game.downloading = true;
  game._localDownloading = true;   // until the pool reports a job for this title
  game._localSince = Date.now();   // bounded in reconcileFromJobs if no job appears
  game._autoInstalled = false;
  state.downloads = state.downloads.filter((i) => i.title_id !== game.title_id);
  state.downloads.push({ title_id: game.title_id, name: game.name,
                         version: game.compatible_version || "",
                         state: "queued", progress: 0, bytes: 0, total_bytes: 0 });
  renderGames();
  startDownloadPolling();

  try {
    const r = await postJson(API.action(game.title_id, "download"), {});
    if (r && r.downloaded && r.already) {
      game.downloading = false;
      game._localDownloading = false;
      game.downloaded = true;
      renderGames();
    } else {
      state.logs.push(`[${timeNow()}] Download queued: ${game.title_id} ${game.compatible_version || ""}`);
      renderLogs();
    }
  } catch (error) {
    game.downloading = false;
    game._localDownloading = false;
    state.downloads = state.downloads.filter((i) => i.title_id !== game.title_id);
    const why = reasonText(error);
    state.logs.push(`[${timeNow()}] download ${game.title_id} blocked: ${why}`);
    showToast(`${game.name}: ${why}`);
    renderGames(); renderLogs();
  }
}

async function doInstall(game) {
  const wasDownloaded = game.downloaded;
  game.installing = true;
  game.installStatus = "starting";
  game.installProgress = 0;
  game.downloaded = false; // the package is being consumed by the install
  renderGames();
  try {
    await postJson(API.action(game.title_id, "install"), {});
  } catch (error) {
    game.downloaded = wasDownloaded;   // refused: the package is untouched
    if (error.body && error.body.reason === "install_running") {
      // Another tab or device started it: follow that install here.
      startInstallPolling();
    } else {
      game.installing = false;
    }
    const why = reasonText(error);
    state.logs.push(`[${timeNow()}] install ${game.title_id} blocked: ${why}`);
    showToast(`${game.name}: ${why}`);
    renderGames(); renderLogs();
    return false;
  }
  state.logs.push(`[${timeNow()}] Install started for ${game.title_id} ${game.compatible_version} — running in PS5 background`);
  showToast(`${game.name}: installing update.`);
  startInstallPolling();
  renderGames(); renderLogs();
  return true;
}

// Cancel a running download (server aborts + deletes the partial) or delete a
// finished package. Same endpoint handles both.
async function cancelDownload(titleId) {
  const game = state.titles.find((g) => g.title_id === titleId);
  try {
    await postJson(API.action(titleId, "cancel"), {});
    showToast(`${game ? game.name : titleId}: download cancelled / deleted.`);
  } catch (error) {
    showToast(`${game ? game.name : titleId}: ${reasonText(error)}`);
    return;   // refused (e.g. the console is installing from it): nothing changed
  }
  if (game) {
    game.downloading = false;
    game._localDownloading = false;
    game.downloaded = false;
    game.resumable = false;
    game.partial_bytes = 0;
    game.manual_version = null;   // the server drops the pasted link on cancel
  }
  state.downloads = state.downloads.filter((i) => i.title_id !== titleId);
  state.logs.push(`[${timeNow()}] Download cancelled / deleted: ${titleId}`);
  renderGames(); renderLogs();
  refreshDownloads();
}

async function runTitleAction(titleId, action) {
  const game = state.titles.find((i) => i.title_id === titleId);
  if (!game) return;
  // "update" and "download" both just enqueue; for "update" (install-after-
  // download on) the reconciler auto-installs once the pool reports it done.
  if (action === "download" || action === "update") await doDownload(game);
  else if (action === "install") await doInstall(game);
  else if (action === "pause") await doPause(game);
  else if (action === "cancel") await cancelDownload(titleId);
  else if (action === "guide") openGuide(game);
}

// Pause only sends the signal; the in-flight doDownload() request returns its
// "paused" result and updates the card (resumable + partial bytes).
async function doPause(game) {
  try {
    await postJson(API.action(game.title_id, "pause"), {});
    showToast(`${game.name}: pausing…`);
  } catch (error) {
    showToast(`${game.name}: ${reasonText(error)}`);
  }
}

function updateGame(titleId, patch) {
  const game = state.titles.find((i) => i.title_id === titleId);
  if (!game) return;
  Object.assign(game, patch);
  renderGames();

  const wantEnabled = game.enabled !== false;
  postJson(API.action(titleId, wantEnabled ? "enable" : "disable"), {})
    .then(() => { state.logs.push(`[${timeNow()}] Saved: ${titleId} ${wantEnabled ? "enabled" : "disabled"}`); renderLogs(); })
    .catch(() => showToast(`${titleId}: could not save toggle (API not reachable).`));
}

/* ---------------- policy helpers ---------------- */

function isInstallBlocked(game) { return !sourcePolicy(game).allow_install; }
function isDownloadAllowed(game) {
  return Boolean(
    game.enabled !== false &&
    (game.compatible_version || game.manual_version) &&
    game.patch_title_match !== false &&
    sourcePolicy(game).allow_download
  );
}
function isInstallAllowed(game) {
  return Boolean(
    game.enabled !== false &&
    (game.compatible_version || game.manual_version) &&
    game.patch_title_match !== false &&
    sourcePolicy(game).allow_install
  );
}
function sourcePolicy(game) { return sourcePolicyForType(sourceType(game)); }
function sourcePolicyForType(type) {
  const fb = fallback.config.source_policy[type] || fallback.config.source_policy.unknown;
  const cfg = (state.config.source_policy || {})[type] || {};
  return { ...fb, ...cfg };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.reason || data.message || `HTTP ${response.status}`);
    err.body = data;
    err.status = response.status;
    throw err;
  }
  return data;
}

const REASON_TEXT = {
  patch_title_mismatch: "Patch metadata targets a different title - install blocked.",
  install_not_allowed_for_source: "Install blocked for this source.",
  source_unknown: "Source unknown — blocked.",
  source_fake: "Fake packages are not supported.",
  source_shadowmount: "Shadowmount titles are not supported.",
  no_compatible_patch: "No compatible patch available.",
  download_failed: "Download failed.",
  download_in_progress: "Another download is already running.",
  piece_verify_failed: "A downloaded piece failed its SHA-256 check.",
  install_running: "The console is installing from this package right now. Try again when it is done.",
  already_installed: "This version is already installed.",
  too_many_installs: "Too many installs running at once. Try again when one has finished.",
  download_incomplete: "The download is not complete yet.",
  download_unverified: "The package on disk hasn't been checked yet. Press Update: PatchDL verifies it and downloads only what's missing.",
  title_disabled: "This title is disabled.",
  download_paused: "Download paused.",
  not_downloading: "Nothing is downloading for this title.",
  not_an_sc_link: "That is not the SC link. Under Additional Files, copy the link of the SC button.",
  url_title_mismatch: "That link belongs to a different game.",
  url_not_allowed: "Only Sony CDN links (https) are accepted.",
  url_invalid: "The link contains unexpected characters.",
  no_space: "Not enough free space on the PS5.",
  manifest_unavailable: "The PS5 could not load the package list from Sony. Copy the SC link again and retry.",
  download_exists: "A download already exists for this game. Cancel it first.",
  source_not_supported: "Downloads are not supported for this source.",
};
// The server keeps 2 GB free on /data on top of the package itself.
function noSpaceText(need, free) {
  return `Not enough space on the PS5: needs ${formatBytes(need)} plus 2 GB headroom, ${formatBytes(free)} free.`;
}

function reasonText(error) {
  const r = error && error.body && error.body.reason;
  return (r && REASON_TEXT[r]) || (error && error.message) || "failed";
}

/* ---------------- QR code (byte mode, ECC level M, versions 1-6) ----------------
   Enough for ~100 bytes, i.e. any PatchDL link. Follows ISO/IEC 18004; the
   structure mirrors Project Nayuki's reference encoder. */

const QR_ECC_M = [0, 10, 16, 26, 18, 24, 16];      // ECC codewords per block
const QR_BLOCKS_M = [0, 1, 1, 1, 2, 2, 4];         // number of blocks

function qrRawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
  }
  return n;
}

function qrDataCodewords(ver) {
  return Math.floor(qrRawModules(ver) / 8) - QR_ECC_M[ver] * QR_BLOCKS_M[ver];
}

function qrGfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function qrRsDivisor(degree) {
  const r = new Array(degree - 1).fill(0);
  r.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = qrGfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = qrGfMul(root, 0x02);
  }
  return r;
}

function qrRsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((coef, i) => { r[i] ^= qrGfMul(coef, factor); });
  }
  return r;
}

// Returns a square boolean matrix (true = dark), or null if text is too long.
function qrEncode(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  while (ver <= 6 && 4 + 8 + bytes.length * 8 > qrDataCodewords(ver) * 8) ver++;
  if (ver > 6) return null;

  // Data bit stream: byte mode, 8-bit length, payload, terminator, padding.
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0x4, 4);
  push(bytes.length, 8);
  bytes.forEach((b) => push(b, 8));
  const cap = qrDataCodewords(ver) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  // Split into blocks, add Reed-Solomon ECC, interleave.
  const numBlocks = QR_BLOCKS_M[ver];
  const eccLen = QR_ECC_M[ver];
  const rawCodewords = Math.floor(qrRawModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = qrRsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = qrRsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((blk, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(blk[i]);
    });

  // Function patterns.
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  });
  if (ver >= 2) {
    const pos = [6, size - 7];   // versions 2-6 have one alignment pattern
    const c = pos[1];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask) => {
    const data5 = (0 << 3) | mask;          // ECC level M = 0b00
    let rem = data5;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((data5 << 10) | rem) ^ 0x5412;
    const bit = (i) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);   // reserve the format areas before placing data

  // Data placement: two-column zigzag from the bottom right.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }

  const maskFn = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
  };
  // Simplified penalty (runs, 2x2 blocks, balance) to pick a readable mask.
  const penalty = () => {
    let p = 0, dark = 0;
    for (let a = 0; a < size; a++) {
      let runR = 1, runC = 1;
      for (let b = 0; b < size; b++) {
        if (mod[a][b]) dark++;
        if (b > 0) {
          runR = mod[a][b] === mod[a][b - 1] ? runR + 1 : 1;
          runC = mod[b][a] === mod[b - 1][a] ? runC + 1 : 1;
          if (runR === 5) p += 3; else if (runR > 5) p++;
          if (runC === 5) p += 3; else if (runC > 5) p++;
        }
        if (a > 0 && b > 0) {
          const c = mod[a][b];
          if (c === mod[a - 1][b] && c === mod[a][b - 1] && c === mod[a - 1][b - 1]) p += 3;
        }
      }
    }
    const total = size * size;
    p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return p;
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const score = penalty();
    if (score < bestScore) { best = m; bestScore = score; }
    applyMask(m);   // XOR again to undo
  }
  applyMask(best);
  drawFormat(best);
  return mod;
}

// SVG markup for a QR matrix, dark on white with the required 4-module margin.
function qrSvg(matrix) {
  const n = matrix.length, q = 4, s = n + q * 2;
  let d = "";
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) d += `M${x + q},${y + q}h1v1h-1z`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" class="qr" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="#fff" stroke="none"/><path d="${d}" fill="#000" stroke="none"/></svg>`;
}

/* ---------------- older patch guide (Prospero) ---------------- */

// Sony's version.xml only lists the newest patch. When that needs newer
// firmware, Prospero Patches still has older ones, but its links sit behind a
// human check, so the user copies one link and PatchDL does the rest. Copying
// is awkward in the PS5 browser, hence the QR hand-off to a phone.

const guide = { el: null, game: null, fromLink: false, started: false, busy: false,
                lastUrl: "", timer: null, returnFocus: null, onKey: null };

function canGetOlderPatch(game) {
  return hasOlderPatch(game) &&
    !game.manual_version && !game.downloading && !game.downloaded &&
    !game.resumable && !game.installing &&
    isDownloadAllowed({ ...game, manual_version: game.prospero_version });
}

// A link a phone can open. A page opened on the PS5 itself runs on 127.0.0.1,
// so the server reports its LAN address for this.
function phoneLink(game) {
  const h = location.hostname;
  let base = location.origin;
  if (!h || h === "localhost" || h === "127.0.0.1" || h === "[::1]") {
    if (!state.status.lan_ip) return null;
    base = `http://${state.status.lan_ip}:${state.status.http_port || location.port || 12880}`;
  }
  return `${base}/#get/${encodeURIComponent(game.title_id)}`;
}

function openGuideFromHash() {
  const m = location.hash.match(/^#get\/([A-Za-z0-9_.-]+)$/);
  if (!m) return;
  const game = state.titles.find((g) => g.title_id === m[1]);
  if (!game) { showToast("That game is not installed on this PS5."); clearGuideHash(); return; }
  if (!canGetOlderPatch(game)) {
    showToast(game.manual_version || game.downloading || game.downloaded
      ? `${game.name}: the older patch is already on its way.`
      : `${game.name}: there is no older patch to fetch.`);
    clearGuideHash();
    return;
  }
  openGuide(game, true);
}

function clearGuideHash() {
  if (location.hash.startsWith("#get/"))
    history.replaceState(null, "", location.pathname + location.search);
}

// The PS5 browser can't copy links, so on the console the guide only hands
// over to a phone. Opened via the home-screen tile the page runs on 127.0.0.1.
function isConsoleBrowser() {
  const h = location.hostname;
  return /PlayStation/i.test(navigator.userAgent) || h === "127.0.0.1" || h === "localhost";
}

function openGuide(game, fromLink = false) {
  closeGuide();
  Object.assign(guide, { game, fromLink, started: false, busy: false, lastUrl: "",
                         returnFocus: document.activeElement });
  const ver = escapeHtml(game.prospero_version);
  const size = game.prospero_size ? ` (${escapeHtml(game.prospero_size)})` : "";
  const onConsole = !fromLink && isConsoleBrowser();
  const link = fromLink ? null : phoneLink(game);
  const matrix = link ? qrEncode(link) : null;

  const head = `
      <header class="guide-head">
        <div>
          <p class="eyebrow">Old FW patch</p>
          <h2 id="guideTitle">Get ${ver}</h2>
          <p class="guide-game">${escapeHtml(game.name)}</p>
        </div>
        <button class="icon-button guide-close" type="button" aria-label="Close">×</button>
      </header>`;

  let body;
  if (onConsole) {
    body = matrix
      ? `<div class="guide-handoff">${qrSvg(matrix)}
           <p>Scan this code with your phone, or open this link on your phone:</p>
           <code>${escapeHtml(link)}</code>
         </div>`
      : `<p class="guide-why">Open PatchDL on your phone (this console's IP address, port ${escapeHtml(String(state.status.http_port || 12880))}) and pick the game there.</p>`;
    body += `<div class="guide-status" role="status" aria-live="polite"></div>`;
  } else {
    const handoff = matrix
      ? `<div class="guide-qr">${qrSvg(matrix)}<div>
           <strong>Easier on your phone</strong>
           <span>Scan this with your phone camera and continue there. This screen follows along.</span>
           <code>${escapeHtml(link)}</code>
         </div></div>`
      : "";
    body = `
      <p class="guide-why">Sony only offers ${escapeHtml(game.latest_version || "the newest patch")}, which needs FW ${escapeHtml(game.latest_required_fw || "?")}. Prospero Patches still lists <b>${ver}</b>, which runs on FW ${escapeHtml(game.prospero_required_fw || "?")}.</p>
      ${handoff}
      <ol class="guide-steps">
        <li>
          <div class="guide-step-text"><strong>Open Prospero Patches</strong>
            <span>Tap version <b>${ver}</b>${size}. If a human check shows up, confirm it.</span></div>
          <a class="row-button is-update guide-open" href="https://prosperopatches.com/${encodeURIComponent(game.title_id)}" target="_blank" rel="noopener">Open Prospero</a>
        </li>
        <li>
          <div class="guide-step-text"><strong>Copy the SC link</strong>
            <span>Under <b>Additional Files</b>, press and hold the <b>SC</b> button and choose <i>Copy Link</i>. PatchDL takes the full piece list from it.</span></div>
        </li>
        <li>
          <div class="guide-step-text"><strong>Paste it here</strong>
            <span>The download starts on your PS5 as soon as the link is in.</span></div>
          <div class="guide-paste">
            <input class="guide-input" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…_sc.pkg" aria-label="SC link">
            <button class="row-button guide-start" type="button">Start</button>
          </div>
          <div class="guide-status" role="status" aria-live="polite"></div>
        </li>
      </ol>`;
  }

  const wrap = document.createElement("div");
  wrap.className = "guide-backdrop";
  wrap.innerHTML = `<section class="guide${onConsole ? " is-handoff" : ""}" role="dialog" aria-modal="true" aria-labelledby="guideTitle">${head}${body}</section>`;
  document.body.appendChild(wrap);
  guide.el = wrap;

  const input = wrap.querySelector(".guide-input");
  if (input) {
    const tryInput = () => {
      const url = extractLink(input.value);
      if (url && url !== guide.lastUrl && /\.(pkg|crc|json)$/i.test(url)) guideSubmit(url, false);
    };
    input.addEventListener("focus", () => input.select());   // a paste then replaces the old link
    input.addEventListener("input", tryInput);
    input.addEventListener("paste", () => setTimeout(tryInput, 0));
    wrap.querySelector(".guide-start").addEventListener("click",
      () => guideSubmit(extractLink(input.value), false));
  }
  wrap.querySelector(".guide-close").addEventListener("click", closeGuide);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeGuide(); });
  guide.onKey = (e) => { if (e.key === "Escape") closeGuide(); };
  document.addEventListener("keydown", guide.onKey);

  guideStatus("idle", matrix ? "Waiting for the link from your phone…" : "");
  guide.timer = setInterval(guidePoll, 2000);
  (fromLink ? wrap.querySelector(".guide-open") : wrap.querySelector(".guide-close")).focus();
}

function closeGuide() {
  if (!guide.el) return;
  clearInterval(guide.timer);
  document.removeEventListener("keydown", guide.onKey);
  guide.el.remove();
  guide.el = null;
  guide.game = null;
  clearGuideHash();
  if (guide.returnFocus && document.contains(guide.returnFocus)) guide.returnFocus.focus();
}

// The last link in the field wins, so pasting a new link next to a rejected
// one (instead of over it) still picks up the new one.
function extractLink(text) {
  const all = String(text || "").match(/https?:\/\/(?:(?!https?:\/\/)[^\s"'<>])+/g) || [];
  const pkgs = all.filter((u) => /\.(pkg|crc|json)$/i.test(u));
  return (pkgs.length ? pkgs[pkgs.length - 1] : all[all.length - 1]) || "";
}

function guideStatus(kind, message, action) {
  if (!guide.el) return;
  const box = guide.el.querySelector(".guide-status");
  box.innerHTML = message ? `<p class="guide-msg is-${kind}">${message}</p>` : "";
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "row-button is-ghost guide-action";
    b.textContent = action.label;
    b.addEventListener("click", action.run);
    box.appendChild(b);
  }
}

async function guideSubmit(url, force) {
  const game = guide.game;
  if (!game || guide.busy) return;
  if (!url) { guideStatus("error", "Paste the SC link from Prospero first."); return; }
  guide.busy = true;
  guide.lastUrl = url;
  const start = guide.el.querySelector(".guide-start");
  start.disabled = true;
  guideStatus("busy", "Checking the link on your PS5…");
  try {
    await postJson("/api/download_url", {
      title_id: game.title_id, url, version: game.prospero_version, force,
    });
  } catch (error) {
    guide.busy = false;
    if (!guide.el) return;
    start.disabled = false;
    const b = (error && error.body) || {};
    if (b.reason === "no_space") {
      guideStatus("error", escapeHtml(noSpaceText(b.need_bytes, b.free_bytes)));
    } else if (b.reason === "size_mismatch") {
      guideStatus("warn",
        `This link is ${formatBytes(b.found_bytes)} in ${Number(b.pieces) || "?"} pieces, but ${escapeHtml(game.prospero_version)} should be about ${escapeHtml(b.expected || "?")}. It is probably a different version.`,
        { label: "Download anyway", run: () => guideSubmit(url, true) });
    } else {
      guideStatus("error", escapeHtml(reasonText(error)) + (b.detail ? ` (${escapeHtml(b.detail)})` : ""));
    }
    state.logs.push(`[${timeNow()}] Prospero link for ${game.title_id} refused: ${reasonText(error)}`);
    renderLogs();
    return;
  }
  guide.busy = false;
  manualDownloadStarted(game);
  if (!guide.fromLink) {
    showToast(`${game.name}: download of ${game.prospero_version} started.`);
    closeGuide();
    return;
  }
  guide.started = true;
  guideStatus("ok", "Download started on your PS5.");
}

// Card state for a download that the server has accepted (from this page or
// from a phone); the pool's job list takes over from here.
function manualDownloadStarted(game) {
  game.manual_version = game.prospero_version;
  game.downloading = true;
  game._localDownloading = true;
  game._localSince = Date.now();
  game._autoInstalled = false;
  state.downloads = state.downloads.filter((i) => i.title_id !== game.title_id);
  state.downloads.push({ title_id: game.title_id, name: game.name, version: game.manual_version,
                         state: "queued", progress: 0, bytes: 0, total_bytes: 0 });
  state.logs.push(`[${timeNow()}] Download queued (Prospero): ${game.title_id} ${game.manual_version}`);
  renderGames(); renderLogs();
  startDownloadPolling();
}

async function guidePoll() {
  const game = guide.game;
  if (!game) return;
  let jobs;
  try {
    const r = await fetch(API.downloads, { cache: "no-store" });
    if (!r.ok) return;
    jobs = await r.json();
  } catch (error) {
    return;
  }
  if (guide.game !== game) return;
  const j = (jobs || []).find((x) => x.title_id === game.title_id);
  if (!j) return;
  if (!guide.started) {
    // Only a job that is actually running means a link arrived from elsewhere;
    // an old failed or paused entry does not.
    if (j.state !== "queued" && j.state !== "active") return;
    manualDownloadStarted(game);
    if (!guide.fromLink) {
      showToast(`${game.name}: link received, download of ${game.prospero_version} started.`);
      closeGuide();
      return;
    }
    guide.started = true;
  }
  const total = Number(j.total_bytes) || 0;
  const pct = total ? Math.min(100, Math.round((Number(j.bytes) || 0) * 100 / total)) : 0;
  const note = {
    queued: "Queued on your PS5…",
    active: "Downloading on your PS5. You can close this page.",
    paused: "Paused on your PS5.",
    done: state.config.install_after_download
      ? "Downloaded. Your PS5 installs it now."
      : "Downloaded. Press Install on the game in PatchDL.",
    error: "The download stopped. Resume it from the game in PatchDL.",
  }[j.state] || "";
  guideStatus(j.state === "error" ? "error" : "ok",
    `${note}<span class="guide-progress"><span class="progress"><i style="width:${pct}%"></i></span>` +
    `<span>${total ? `${formatBytes(j.bytes)} / ${formatBytes(total)} · ` : ""}${pct}%</span></span>`);
}

/* ---------------- formatting ---------------- */

function initials(name) {
  return (name || "PD").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

// Auto-scaled byte sizes: B / KB / MB / GB / TB.
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "--";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Free space comes from the backend in MB.
function formatMb(mb) {
  const n = Number(mb);
  if (!Number.isFinite(n)) return "--";
  return formatBytes(n * 1024 * 1024);
}

function formatEta(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (!Number.isFinite(s) || s <= 0) return "--";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function timeNow() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}
