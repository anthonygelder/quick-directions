const MAX_LOCATIONS = 5;
const NOMINATIM_DELAY_MS = 1100; // respect rate limit

let trip = [];       // [{ address: string, coords: {lat,lon}|null }]
let tripMode = "driving";
let settings = { defaultMode: "driving", savedLocations: [] };
let dragSrcIndex = null;
let optimizing = false;

// ── Utilities ──────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setTripStatus(msg, warn = false) {
  const el = document.getElementById("trip-status");
  el.textContent = msg;
  el.className = warn ? "warn" : "";
}

function setProgress(current, total) {
  const wrap = document.getElementById("progress-wrap");
  const bar = document.getElementById("progress-bar");
  if (total === 0) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  bar.style.width = `${Math.round((current / total) * 100)}%`;
}

// ── Storage ────────────────────────────────────────────────

function saveTrip() {
  chrome.storage.local.set({ trip });
}

function loadTrip() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["trip"], (data) => resolve(data.trip || []));
  });
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["defaultMode", "savedLocations"], (data) => {
      settings.defaultMode = data.defaultMode || "driving";
      settings.savedLocations = data.savedLocations || [];
      resolve();
    });
  });
}

// ── Trip rendering ─────────────────────────────────────────

function renderTrip() {
  const list = document.getElementById("stops-list");

  if (trip.length === 0) {
    list.innerHTML = `<div class="empty-state">
      Right-click any highlighted address<br>and choose <strong>Add to trip</strong><br><br>or type a stop below.
    </div>`;
    return;
  }

  list.innerHTML = "";
  trip.forEach((stop, i) => {
    const row = document.createElement("div");
    row.className = "stop-row";
    row.draggable = true;
    row.dataset.index = i;
    row.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="stop-num">${i + 1}</span>
      <span class="stop-addr">${escapeHtml(stop.address)}</span>
      <button class="remove-stop" data-index="${i}" title="Remove">×</button>
    `;

    row.addEventListener("dragstart", (e) => {
      dragSrcIndex = i;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => row.classList.add("dragging"), 0);
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (dragSrcIndex !== null && dragSrcIndex !== i) {
        const [moved] = trip.splice(dragSrcIndex, 1);
        trip.splice(i, 0, moved);
        dragSrcIndex = null;
        saveTrip();
        renderTrip();
      }
    });

    row.querySelector(".remove-stop").addEventListener("click", () => {
      trip.splice(i, 1);
      saveTrip();
      renderTrip();
    });

    list.appendChild(row);
  });
}

// ── Mode selector ──────────────────────────────────────────

function setTripMode(mode) {
  tripMode = mode;
  document.querySelectorAll("#trip-mode-group .mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

function setSettingsMode(mode) {
  settings.defaultMode = mode;
  document.querySelectorAll("#settings-mode-group .mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

// ── Maps URL ───────────────────────────────────────────────

function buildMultiStopUrl(stops, mode) {
  const MODES = { driving: "driving", transit: "transit", cycling: "bicycling", walking: "walking" };
  const addrs = stops.map((s) => s.address);

  if (addrs.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrs[0])}`;
  }

  const origin = encodeURIComponent(addrs[0]);
  const dest = encodeURIComponent(addrs[addrs.length - 1]);
  const waypoints = addrs.slice(1, -1).map(encodeURIComponent).join("|");
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=${MODES[mode] || "driving"}`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

// ── Geocoding (Nominatim) ──────────────────────────────────

async function geocode(address) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "User-Agent": "QuickDirections/2.0 (browser extension)" } }
    );
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch (_) {}
  return null;
}

// ── TSP: nearest-neighbor heuristic ───────────────────────

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

function nearestNeighborTSP(coords) {
  const n = coords.length;
  const visited = new Array(n).fill(false);
  visited[0] = true;
  const route = [0];

  for (let step = 1; step < n; step++) {
    const last = route[route.length - 1];
    let nearest = -1;
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && coords[j]) {
        const d = haversineKm(coords[last], coords[j]);
        if (d < minDist) { minDist = d; nearest = j; }
      }
    }
    // fallback for any un-geocoded stops
    if (nearest === -1) {
      nearest = visited.indexOf(false);
    }
    visited[nearest] = true;
    route.push(nearest);
  }
  return route;
}

// ── Optimize handler ───────────────────────────────────────

async function optimizeRoute() {
  if (trip.length < 3) {
    setTripStatus("Add at least 3 stops to optimize.", true);
    setTimeout(() => setTripStatus(""), 3000);
    return;
  }

  optimizing = true;
  document.getElementById("optimize-btn").disabled = true;
  document.getElementById("launch-btn").disabled = true;

  // Geocode stops that don't have coords yet
  let geocoded = 0;
  const total = trip.filter((s) => !s.coords).length;

  for (let i = 0; i < trip.length; i++) {
    if (!trip[i].coords) {
      setTripStatus(`Geocoding stop ${i + 1} of ${trip.length}…`);
      setProgress(geocoded, total);
      trip[i].coords = await geocode(trip[i].address);
      geocoded++;
      if (i < trip.length - 1) await sleep(NOMINATIM_DELAY_MS);
    }
  }

  setProgress(total, total);

  const failed = trip.filter((s) => !s.coords).map((s) => s.address);
  if (failed.length > 0) {
    setTripStatus(`Could not locate: ${failed.join("; ")}`, true);
    setProgress(0, 0);
    optimizing = false;
    document.getElementById("optimize-btn").disabled = false;
    document.getElementById("launch-btn").disabled = false;
    return;
  }

  setTripStatus("Optimizing…");
  const order = nearestNeighborTSP(trip.map((s) => s.coords));
  trip = order.map((i) => trip[i]);

  saveTrip();
  renderTrip();
  setProgress(0, 0);
  setTripStatus("Route optimized!");
  setTimeout(() => setTripStatus(""), 3000);

  optimizing = false;
  document.getElementById("optimize-btn").disabled = false;
  document.getElementById("launch-btn").disabled = false;
}

// ── Settings rendering ─────────────────────────────────────

function renderSettings() {
  setSettingsMode(settings.defaultMode);

  const list = document.getElementById("locations-list");
  list.innerHTML = "";
  settings.savedLocations.forEach((loc, i) => {
    const row = document.createElement("div");
    row.className = "location-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Label";
    nameInput.value = loc.name;
    nameInput.addEventListener("input", () => { settings.savedLocations[i].name = nameInput.value; });

    const addrInput = document.createElement("input");
    addrInput.type = "text";
    addrInput.placeholder = "Address or place";
    addrInput.value = loc.address;
    addrInput.addEventListener("input", () => { settings.savedLocations[i].address = addrInput.value; });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-loc";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      settings.savedLocations.splice(i, 1);
      renderSettings();
    });

    row.appendChild(nameInput);
    row.appendChild(addrInput);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });

  document.getElementById("add-location").style.display =
    settings.savedLocations.length >= MAX_LOCATIONS ? "none" : "block";
}

// ── Init ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  trip = await loadTrip();
  setTripMode(settings.defaultMode);
  renderTrip();
  renderSettings();

  // Pick up address queued by context-menu click
  chrome.storage.local.get(["pendingAddress"], (data) => {
    if (data.pendingAddress) {
      trip.push({ address: data.pendingAddress, coords: null });
      chrome.storage.local.remove("pendingAddress");
      saveTrip();
      renderTrip();
    }
  });

  // Handle addresses added while panel is already open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pendingAddress?.newValue) {
      trip.push({ address: changes.pendingAddress.newValue, coords: null });
      chrome.storage.local.remove("pendingAddress");
      saveTrip();
      renderTrip();
    }
  });

  // ── Tab switching ──
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  // ── Trip mode buttons ──
  document.querySelectorAll("#trip-mode-group .mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTripMode(btn.dataset.mode));
  });

  // ── Settings mode buttons ──
  document.querySelectorAll("#settings-mode-group .mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setSettingsMode(btn.dataset.mode));
  });

  // ── Add stop ──
  const addInput = document.getElementById("add-stop-input");
  const addStop = () => {
    const val = addInput.value.trim();
    if (!val) return;
    trip.push({ address: val, coords: null });
    addInput.value = "";
    saveTrip();
    renderTrip();
  };
  document.getElementById("add-stop-btn").addEventListener("click", addStop);
  addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addStop(); });

  // ── Optimize ──
  document.getElementById("optimize-btn").addEventListener("click", () => {
    if (!optimizing) optimizeRoute();
  });

  // ── Launch in Maps ──
  document.getElementById("launch-btn").addEventListener("click", () => {
    if (trip.length === 0) {
      setTripStatus("Add at least one stop first.", true);
      setTimeout(() => setTripStatus(""), 3000);
      return;
    }
    const url = buildMultiStopUrl(trip, tripMode);
    chrome.tabs.create({ url });
  });

  // ── Clear ──
  document.getElementById("clear-btn").addEventListener("click", () => {
    trip = [];
    saveTrip();
    renderTrip();
    setTripStatus("");
    setProgress(0, 0);
  });

  // ── Add saved location ──
  document.getElementById("add-location").addEventListener("click", () => {
    if (settings.savedLocations.length < MAX_LOCATIONS) {
      settings.savedLocations.push({ name: "", address: "" });
      renderSettings();
    }
  });

  // ── Save settings ──
  document.getElementById("save-settings-btn").addEventListener("click", () => {
    const clean = settings.savedLocations.filter((l) => l.name.trim() || l.address.trim());
    chrome.storage.sync.set({ defaultMode: settings.defaultMode, savedLocations: clean }, () => {
      const el = document.getElementById("settings-status");
      el.textContent = "Saved!";
      setTimeout(() => { el.textContent = ""; }, 1500);
    });
  });
});
