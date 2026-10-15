import { loadSettings } from "./settings-store.js";
import { readVaultText } from "./ignis-client.js";
import { ensurePermissionsForSettings } from "./permissions.js";

const params = new URLSearchParams(window.location.search);
const path = params.get("path") || "";
const title = params.get("title") || "Notitie";

const els = {
  viewTitle: document.getElementById("viewTitle"),
  viewPath: document.getElementById("viewPath"),
  viewBody: document.getElementById("viewBody"),
  viewStatus: document.getElementById("viewStatus"),
  btnClose: document.getElementById("btnClose"),
};

els.viewTitle.textContent = title;
els.viewPath.textContent = path || "—";
document.title = `${title} — Ignis Capture`;

els.btnClose.addEventListener("click", () => window.close());

async function load() {
  if (!path) {
    showError("Geen bestandspad opgegeven.");
    return;
  }
  els.viewBody.textContent = "Laden…";
  try {
    const settings = await loadSettings();
    const ok = await ensurePermissionsForSettings(settings);
    if (!ok) {
      throw new Error("Host-permissie ontbreekt — open Instellingen van de extensie.");
    }
    const content = await readVaultText(settings, path);
    els.viewBody.textContent = content;
  } catch (e) {
    showError(e?.message || String(e));
    els.viewBody.textContent = "";
  }
}

/** @param {string} message */
function showError(message) {
  els.viewStatus.hidden = false;
  els.viewStatus.textContent = message;
}

load();
