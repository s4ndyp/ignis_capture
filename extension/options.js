import { loadSettings, saveSettings } from "./settings-store.js";
import { ensurePermissionsForSettings, activeBaseUrl } from "./permissions.js";

const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const connectionMode = document.getElementById("connectionMode");
const ignisFields = document.getElementById("ignisFields");
const proxyFields = document.getElementById("proxyFields");
const btnRequestPerm = document.getElementById("btnRequestPerm");

const fields = [
  "ignisBaseUrl",
  "proxyBaseUrl",
  "vaultId",
  "folder",
  "notebookNavigatorProfile",
];

function setStatus(kind, message) {
  statusEl.className = "status show " + kind;
  statusEl.textContent = message;
}

function syncModeUi() {
  const proxy = connectionMode.value === "proxy";
  ignisFields.hidden = proxy;
  proxyFields.hidden = !proxy;
}

connectionMode.addEventListener("change", syncModeUi);

async function populateForm() {
  const s = await loadSettings();
  connectionMode.value = s.connectionMode;
  for (const id of fields) {
    const el = document.getElementById(id);
    if (el) el.value = s[id] ?? "";
  }
  syncModeUi();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const partial = {
    connectionMode: connectionMode.value,
    vaultId: document.getElementById("vaultId").value.trim(),
    folder: document.getElementById("folder").value.trim(),
    ignisBaseUrl: document.getElementById("ignisBaseUrl").value.trim(),
    proxyBaseUrl: document.getElementById("proxyBaseUrl").value.trim(),
    notebookNavigatorProfile: document
      .getElementById("notebookNavigatorProfile")
      .value.trim(),
  };
  await saveSettings(partial);
  const ok = await ensurePermissionsForSettings(partial);
  setStatus(
    ok ? "ok" : "info",
    ok ? "Opgeslagen en host-permissie actief." : "Opgeslagen — host-permissie niet verleend.",
  );
});

btnRequestPerm.addEventListener("click", async () => {
  const s = await loadSettings();
  try {
    const ok = await ensurePermissionsForSettings(s);
    setStatus(ok ? "ok" : "err", ok ? `Toegang tot ${activeBaseUrl(s)}` : "Permissie geweigerd");
  } catch (e) {
    setStatus("err", e.message || String(e));
  }
});

populateForm();
