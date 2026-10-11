/** @typedef {{ ignisBaseUrl: string, connectionMode: 'direct'|'proxy', proxyBaseUrl: string, vaultId: string, folder: string, notebookNavigatorProfile: string }} CaptureSettings */

export const DEFAULT_SETTINGS = {
  ignisBaseUrl: "https://10.5.0.134",
  connectionMode: "direct",
  proxyBaseUrl: "http://localhost:8080",
  vaultId: "My Vault",
  folder: "Inbox",
  notebookNavigatorProfile: "",
};

export function normalizeBase(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

/** @param {CaptureSettings} settings @param {string} apiPath e.g. /api/fs/writeFile */
export function buildApiUrl(settings, apiPath) {
  const path = apiPath.startsWith("/") ? apiPath : "/" + apiPath;
  if (settings.connectionMode === "proxy") {
    const base = normalizeBase(settings.proxyBaseUrl);
    const sub = path.replace(/^\/api/, "");
    return `${base}/ignis-api${sub}`;
  }
  const base = normalizeBase(settings.ignisBaseUrl);
  return `${base}${path}`;
}

export function originPatternFromBase(baseUrl) {
  const u = new URL(baseUrl);
  return `${u.origin}/*`;
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

/** Compact uniek suffix (alleen bij naamconflict of zonder titel). */
export function compactTimestamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function slugify(title) {
  const t = (title || "").trim() || "notitie";
  const cleaned = t
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "notitie";
}

/** Bestandsnaam zonder extensie — Obsidian/Ignis toont dit als notitietitel. */
export function noteBaseName(title) {
  const t = (title || "").trim();
  if (t) return slugify(t);
  return `Notitie ${compactTimestamp()}`;
}

/** @param {string} title @param {number} [duplicateIndex] 0 = eerste keuze, daarna suffix */
export function buildNoteFilename(title, duplicateIndex = 0) {
  const base = noteBaseName(title);
  if (duplicateIndex <= 0) return `${base}.md`;
  return `${base} (${duplicateIndex}).md`;
}

export function buildNotePath(folder, filename) {
  const f = (folder || "").trim().replace(/^\/+|\/+$/g, "");
  return f ? `${f}/${filename}` : filename;
}

export function buildMarkdown(_title, body) {
  const now = new Date().toISOString();
  const lines = ["---", "created: " + now, "source: ignis-capture-extension", "---", ""];
  const text = (body || "").trim();
  if (text) {
    lines.push(text, "");
  }
  return lines.join("\n");
}

export async function parseJsonResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data.error ||
      data.message ||
      (typeof data.raw === "string" ? data.raw : null) ||
      res.statusText ||
      "Request mislukt";
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return data;
}

/** @param {CaptureSettings} settings */
export async function postIgnisJson(settings, apiPath, body) {
  const url = buildApiUrl(settings, apiPath);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vault: settings.vaultId.trim(), ...body }),
  });
  return parseJsonResponse(res);
}

/** @param {CaptureSettings} settings @param {Record<string, string>} [query] */
export function buildApiUrlWithQuery(settings, apiPath, query = {}) {
  const url = buildApiUrl(settings, apiPath);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** @param {CaptureSettings} settings @param {Record<string, string>} [query] */
export async function getIgnisJson(settings, apiPath, query = {}) {
  const url = buildApiUrlWithQuery(settings, apiPath, query);
  const res = await fetch(url);
  return parseJsonResponse(res);
}

/** @typedef {Record<string, { type: 'file' | 'directory', size?: number, mtime?: number, ctime?: number }>} VaultTree */

/** @param {CaptureSettings} settings @returns {Promise<VaultTree>} */
export async function fetchVaultTree(settings) {
  return getIgnisJson(settings, "/api/fs/tree", {
    vault: settings.vaultId.trim(),
  });
}

const HIDDEN_TREE_PREFIXES = [".obsidian", ".trash"];

/** @param {string} relPath */
export function isHiddenVaultPath(relPath) {
  if (!relPath) return false;
  if (relPath.startsWith(".") && relPath !== "") {
    return HIDDEN_TREE_PREFIXES.some(
      (p) => relPath === p || relPath.startsWith(p + "/"),
    );
  }
  const segments = relPath.split("/");
  return segments.some((seg) => seg.startsWith(".") && seg !== "..");
}

/** @param {VaultTree} tree @returns {string[]} sorted folder paths (empty string = vault root) */
export function listSelectableFolders(tree) {
  const dirs = new Set([""]);
  for (const [relPath, node] of Object.entries(tree || {})) {
    if (node.type === "directory") {
      if (!isHiddenVaultPath(relPath)) dirs.add(relPath);
    } else if (node.type === "file") {
      const slash = relPath.lastIndexOf("/");
      if (slash >= 0) {
        const parent = relPath.slice(0, slash);
        if (!isHiddenVaultPath(parent)) dirs.add(parent);
      }
    }
  }
  return [...dirs].sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

/** @param {string} folder */
export function formatFolderLabel(folder) {
  return folder === "" ? "(vault root)" : folder;
}

/** @param {CaptureSettings} settings @param {string} relPath */
export async function notePathExists(settings, relPath) {
  const url = buildApiUrlWithQuery(settings, "/api/fs/stat", {
    vault: settings.vaultId.trim(),
    path: relPath,
  });
  const res = await fetch(url);
  if (res.status === 404) return false;
  if (res.ok) return true;
  await parseJsonResponse(res);
  return false;
}

/** @param {CaptureSettings} settings @param {string} title @param {string} folder */
async function allocateNotePath(settings, title, folder) {
  for (let i = 0; i < 50; i++) {
    const filename = buildNoteFilename(title, i);
    const path = buildNotePath(folder, filename);
    if (!(await notePathExists(settings, path))) {
      return path;
    }
  }
  throw new Error("Kon geen unieke bestandsnaam vinden (te veel duplicaten).");
}

/** @param {CaptureSettings} settings @param {string} [folderOverride] */
export async function writeNote(settings, title, body, folderOverride) {
  const folder =
    folderOverride !== undefined && folderOverride !== null
      ? folderOverride
      : settings.folder;
  const path = await allocateNotePath(settings, title, folder);
  const content = buildMarkdown(title, body);
  await postIgnisJson(settings, "/api/fs/writeFile", { path, content });
  return { path };
}

/** @param {CaptureSettings} settings @param {string} relPath */
export async function readVaultText(settings, relPath) {
  const url = buildApiUrlWithQuery(settings, "/api/fs/readFile", {
    vault: settings.vaultId.trim(),
    path: relPath,
  });
  const res = await fetch(url);
  if (!res.ok) {
    await parseJsonResponse(res);
  }
  return res.text();
}

/** @param {CaptureSettings} settings @param {string} filePath */
export function buildIgnisFileUrl(settings, filePath) {
  const base = normalizeBase(
    settings.connectionMode === "proxy"
      ? settings.proxyBaseUrl
      : settings.ignisBaseUrl,
  );
  const vault = settings.vaultId.trim();
  return (
    `${base}/?vault=${encodeURIComponent(vault)}` +
    `&file=${encodeURIComponent(filePath)}`
  );
}

/** @param {CaptureSettings} settings */
export async function testConnection(settings) {
  const version = await getIgnisJson(settings, "/api/version");
  const vaults = await getIgnisJson(settings, "/api/vault/list");
  const vault = settings.vaultId.trim();
  const found = Array.isArray(vaults) && vaults.some((v) => v.id === vault);
  return {
    ignisVer: version.ignis || version.version || "?",
    obsVer: version.obsidian || version.obsidianVersion || "?",
    vault,
    found,
  };
}
