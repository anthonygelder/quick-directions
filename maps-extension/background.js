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
    // --- Get directions ---
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

    // --- Trip builder ---
    chrome.contextMenus.create({
      id: "qd-sep-trip",
      type: "separator",
      contexts: ["selection"],
    });

    chrome.contextMenus.create({
      id: "qd-add-trip",
      title: "Add to trip",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.storage.sync.get(["savedLocations"], (data) => {
    createMenus(data.savedLocations || []);
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.savedLocations) {
    createMenus(changes.savedLocations.newValue || []);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "ADD_TO_TRIP" && msg.address) {
    chrome.storage.local.set({ pendingAddress: msg.address }, () => {
      chrome.sidePanel.open({ windowId: sender.tab.windowId });
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = info.selectionText.trim();
  if (!text) return;

  if (info.menuItemId === "qd-add-trip") {
    chrome.storage.local.set({ pendingAddress: text }, () => {
      chrome.sidePanel.open({ windowId: tab.windowId });
    });
    return;
  }

  chrome.storage.sync.get(["savedLocations", "defaultMode"], (data) => {
    const mode = data.defaultMode || "driving";
    const savedLocations = data.savedLocations || [];

    let origin = null;
    if (info.menuItemId.startsWith("qd-saved-")) {
      const idx = parseInt(info.menuItemId.replace("qd-saved-", ""), 10);
      origin = savedLocations[idx]?.address ?? null;
    }

    const url = buildMapsUrl(origin, text, mode);
    chrome.tabs.create({ url });
  });
});
