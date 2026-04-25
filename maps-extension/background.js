const TRAVEL_MODES = {
  driving: "driving",
  transit: "transit",
  cycling: "bicycling",
  walking: "walking",
};

function buildMapsUrl(origin, destination, mode) {
  const params = new URLSearchParams({
    api: "1",
    destination,
    travelmode: TRAVEL_MODES[mode] ?? "driving",
  });
  if (origin) params.set("origin", origin);
  return `https://www.google.com/maps/dir/?${params}`;
}

function createMenus(savedLocations) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "qd-root",
      title: "Get directions to here",
      contexts: ["selection"],
    });

    chrome.contextMenus.create({
      id: "qd-current",
      parentId: "qd-root",
      title: "From my current location",
      contexts: ["selection"],
    });

    const validLocations = (savedLocations || []).filter((l) => l.name && l.address);
    if (validLocations.length > 0) {
      chrome.contextMenus.create({
        id: "qd-sep",
        parentId: "qd-root",
        type: "separator",
        contexts: ["selection"],
      });

      validLocations.forEach((loc, i) => {
        chrome.contextMenus.create({
          id: `qd-saved-${i}`,
          parentId: "qd-root",
          title: `From ${loc.name}`,
          contexts: ["selection"],
        });
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["savedLocations"], (data) => {
    createMenus(data.savedLocations || []);
  });
});

// Rebuild menus when settings change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.savedLocations) {
    createMenus(changes.savedLocations.newValue || []);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const destination = info.selectionText.trim();
  if (!destination) return;

  chrome.storage.sync.get(["savedLocations", "defaultMode"], (data) => {
    const mode = data.defaultMode || "driving";
    const savedLocations = data.savedLocations || [];

    let origin = null;
    if (info.menuItemId.startsWith("qd-saved-")) {
      const idx = parseInt(info.menuItemId.replace("qd-saved-", ""), 10);
      origin = savedLocations[idx]?.address ?? null;
    }
    // qd-current: origin stays null, Maps will use browser location

    const url = buildMapsUrl(origin, destination, mode);
    chrome.tabs.create({ url });
  });
});
