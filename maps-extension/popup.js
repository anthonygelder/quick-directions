const MAX_LOCATIONS = 5;

let currentMode = "driving";
let locations = [];

function renderLocations() {
  const list = document.getElementById("locations-list");
  list.innerHTML = "";

  locations.forEach((loc, i) => {
    const row = document.createElement("div");
    row.className = "location-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Label";
    nameInput.value = loc.name;
    nameInput.addEventListener("input", () => { locations[i].name = nameInput.value; });

    const addrInput = document.createElement("input");
    addrInput.type = "text";
    addrInput.placeholder = "Address or place name";
    addrInput.value = loc.address;
    addrInput.addEventListener("input", () => { locations[i].address = addrInput.value; });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      locations.splice(i, 1);
      renderLocations();
    });

    row.appendChild(nameInput);
    row.appendChild(addrInput);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });

  document.getElementById("add-location").style.display =
    locations.length >= MAX_LOCATIONS ? "none" : "block";
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

document.getElementById("add-location").addEventListener("click", () => {
  if (locations.length < MAX_LOCATIONS) {
    locations.push({ name: "", address: "" });
    renderLocations();
  }
});

document.getElementById("save-btn").addEventListener("click", () => {
  const clean = locations.filter((l) => l.name.trim() || l.address.trim());
  chrome.storage.sync.set({ defaultMode: currentMode, savedLocations: clean }, () => {
    const status = document.getElementById("status");
    status.textContent = "Saved!";
    setTimeout(() => { status.textContent = ""; }, 1500);
  });
});

// Load saved settings on open
chrome.storage.sync.get(["defaultMode", "savedLocations"], (data) => {
  setMode(data.defaultMode || "driving");
  locations = data.savedLocations || [];
  renderLocations();
});
