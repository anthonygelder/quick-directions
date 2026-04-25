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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ADD_TO_TRIP" && msg.address) {
    chrome.storage.local.set({ pendingAddress: msg.address }, () => {
      chrome.sidePanel.open({ windowId: sender.tab.windowId });
    });
    return;
  }

  if (msg.type === "OPTIMIZE_ROUTE") {
    optimizeWithGoogle(msg.stops, msg.mode, msg.apiKey)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});

async function optimizeWithGoogle(stops, mode, apiKey) {
  const MODES = { driving: "driving", transit: "transit", cycling: "bicycling", walking: "walking" };
  const origin = stops[0].address;
  const destination = stops[stops.length - 1].address;
  const middle = stops.slice(1, -1).map((s) => s.address);

  const params = new URLSearchParams({
    origin,
    destination,
    waypoints: `optimize:true|${middle.join("|")}`,
    mode: MODES[mode] || "driving",
    key: apiKey,
  });

  const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
  const data = await res.json();

  if (data.status !== "OK") throw new Error(data.status);

  // waypoint_order is the optimized indices into the middle stops array
  const order = data.routes[0].waypoint_order;
  const optimizedMiddle = order.map((i) => middle[i]);
  return { optimizedStops: [origin, ...optimizedMiddle, destination] };
}

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
