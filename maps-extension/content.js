// Matches street addresses like "123 Main St", "456 Oak Ave, Chicago, IL 60601"
const ADDRESS_PATTERN =
  "\\b\\d{1,5}\\s+" +
  "(?:[A-Z][a-zA-Z'-]*\\s+){1,4}" +
  "(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|" +
  "Way|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter|Highway|Hwy|" +
  "Plaza|Square|Parkway|Pkwy|Trail|Trl|Loop|Alley|Aly)\\.?" +
  "(?:[,\\s]+[A-Z][a-zA-Z\\s]+)?(?:[,\\s]+[A-Z]{2}\\b)?(?:\\s+\\d{5}(?:-\\d{4})?)?";

function getAddressRe() {
  return new RegExp(ADDRESS_PATTERN, "g");
}

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE",
  "NOSCRIPT", "IFRAME", "SELECT", "BUTTON",
]);

// ── Floating "+" overlay ────────────────────────────────────

const overlay = document.createElement("div");
overlay.setAttribute("data-qd", "overlay");
Object.assign(overlay.style, {
  position: "fixed",
  zIndex: "2147483647",
  background: "#1a73e8",
  color: "#fff",
  borderRadius: "50%",
  width: "22px",
  height: "22px",
  fontSize: "18px",
  fontWeight: "bold",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  display: "none",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
  lineHeight: "1",
  userSelect: "none",
  transition: "transform 0.1s",
  pointerEvents: "auto",
});
overlay.textContent = "+";

document.addEventListener("DOMContentLoaded", () => document.body.appendChild(overlay), { once: true });
if (document.body) document.body.appendChild(overlay);

let currentAddress = null;
let hideTimer = null;

function showOverlay(span) {
  clearTimeout(hideTimer);
  const rect = span.getBoundingClientRect();
  overlay.style.top = `${rect.top - 11}px`;
  overlay.style.left = `${rect.right + 4}px`;
  overlay.style.display = "flex";
  overlay.style.transform = "scale(1)";
  currentAddress = span.dataset.qdAddress;
}

function scheduleHide() {
  hideTimer = setTimeout(() => {
    overlay.style.display = "none";
    currentAddress = null;
  }, 200);
}

overlay.addEventListener("mouseenter", () => clearTimeout(hideTimer));
overlay.addEventListener("mouseleave", scheduleHide);

overlay.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentAddress) return;

  chrome.runtime.sendMessage({ type: "ADD_TO_TRIP", address: currentAddress });

  // Brief confirmation feedback
  overlay.textContent = "✓";
  overlay.style.background = "#188038";
  overlay.style.transform = "scale(1.2)";
  setTimeout(() => {
    overlay.textContent = "+";
    overlay.style.background = "#1a73e8";
    overlay.style.transform = "scale(1)";
    overlay.style.display = "none";
    currentAddress = null;
  }, 900);
});

// ── DOM scanning ────────────────────────────────────────────

function scanNode(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      if (p.closest("[data-qd]")) return NodeFilter.FILTER_REJECT;
      // Quick bail: addresses always contain a digit
      if (!/\d/.test(node.textContent)) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (getAddressRe().test(n.textContent)) nodes.push(n);
  }
  nodes.forEach(wrapAddresses);
}

function wrapAddresses(textNode) {
  const text = textNode.textContent;
  const matches = [...text.matchAll(getAddressRe())];
  if (matches.length === 0) return;

  const frag = document.createDocumentFragment();
  let cursor = 0;

  for (const match of matches) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, start)));
    }

    const span = document.createElement("span");
    span.dataset.qd = "location";
    span.dataset.qdAddress = match[0].replace(/\s+/g, " ").trim();
    span.textContent = match[0];
    Object.assign(span.style, {
      borderBottom: "1.5px dashed #1a73e8",
      borderRadius: "2px",
      cursor: "default",
    });

    span.addEventListener("mouseenter", () => showOverlay(span));
    span.addEventListener("mouseleave", scheduleHide);
    frag.appendChild(span);
    cursor = end;
  }

  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)));
  }

  textNode.parentNode.replaceChild(frag, textNode);
}

// ── Run ─────────────────────────────────────────────────────

function init() {
  scanNode(document.body);

  // Watch for dynamically added content
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !SKIP_TAGS.has(node.tagName)) {
          scanNode(node);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
