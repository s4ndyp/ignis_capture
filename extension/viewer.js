import { loadSettings } from "./settings-store.js";
import { readVaultText } from "./ignis-client.js";
import { ensurePermissionsForSettings } from "./permissions.js";
import { isBaseVaultPath } from "./shortcut-file.js";
import { renderBaseTableHtml } from "./base-render.js";

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
  els.viewBody.className = "body is-markdown";
  try {
    const settings = await loadSettings();
    const ok = await ensurePermissionsForSettings(settings);
    if (!ok) {
      throw new Error("Host-permissie ontbreekt — open Instellingen van de extensie.");
    }
    const content = await readVaultText(settings, path);
    if (isBaseVaultPath(path)) {
      els.viewBody.className = "body";
      els.viewBody.textContent = "Base opbouwen…";
      const rendered = await renderBaseTableHtml(settings, content, path, (done, total) => {
        els.viewBody.textContent = `Base opbouwen… ${done}/${total}`;
      });
      els.viewBody.innerHTML = rendered.html;
      els.viewTitle.textContent = `${title} — ${rendered.viewName}`;
      return;
    }
    els.viewBody.className = "body is-markdown";
    els.viewBody.textContent = content;
  } catch (e) {
    showError(e?.message || String(e));
    els.viewBody.innerHTML = "";
  }
}

/** @param {string} message */
function showError(message) {
  els.viewStatus.hidden = false;
  els.viewStatus.textContent = message;
}

load();
