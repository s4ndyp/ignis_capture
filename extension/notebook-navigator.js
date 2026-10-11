import { readVaultText } from "./ignis-client.js";

export const NOTEBOOK_NAVIGATOR_DATA_PATH =
  ".obsidian/plugins/notebook-navigator/data.json";

/** @typedef {{ type: 'folder'|'note', path: string, alias?: string }} FolderOrNoteShortcut */
/** @typedef {{ type: 'tag', tagPath: string, alias?: string }} TagShortcut */
/** @typedef {{ type: 'search', name: string, query: string, provider?: string, alias?: string }} SearchShortcut */
/** @typedef {{ type: 'property', nodeId: string, alias?: string }} PropertyShortcut */
/** @typedef {FolderOrNoteShortcut | TagShortcut | SearchShortcut | PropertyShortcut} NavigatorShortcut */

/** @typedef {{ index: number, shortcut: NavigatorShortcut, label: string, subtitle: string, kind: string }} ShortcutListItem */

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {string} [profileIdOverride]
 */
export async function loadNotebookNavigatorShortcuts(settings, profileIdOverride) {
  let raw;
  try {
    raw = await readVaultText(settings, NOTEBOOK_NAVIGATOR_DATA_PATH);
  } catch (e) {
    if (/404|ENOENT|HTTP 404/i.test(e?.message || "")) {
      throw new Error(
        "Notebook Navigator data.json niet gevonden — installeer de plugin in deze vault.",
      );
    }
    throw e;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Notebook Navigator data.json is ongeldige JSON.");
  }

  const profileId = (profileIdOverride || data.vaultProfile || "default").trim();
  const profiles = Array.isArray(data.vaultProfiles) ? data.vaultProfiles : [];
  const profile =
    profiles.find((p) => p && p.id === profileId) ||
    profiles.find((p) => p && p.id === "default") ||
    profiles[0];

  if (!profile) {
    return { profileId, profileName: profileId, shortcuts: [] };
  }

  const shortcuts = Array.isArray(profile.shortcuts) ? profile.shortcuts : [];
  const items = shortcuts
    .map((shortcut, index) => normalizeShortcutItem(shortcut, index))
    .filter(Boolean);

  return {
    profileId: profile.id || profileId,
    profileName: profile.name || profile.id || profileId,
    shortcuts: items,
  };
}

/** @param {unknown} shortcut @param {number} index @returns {ShortcutListItem | null} */
function normalizeShortcutItem(shortcut, index) {
  if (!shortcut || typeof shortcut !== "object") return null;
  const s = /** @type {Record<string, unknown>} */ (shortcut);
  const type = typeof s.type === "string" ? s.type : "";
  const alias = typeof s.alias === "string" && s.alias.trim() ? s.alias.trim() : "";

  /** @type {NavigatorShortcut | null} */
  let parsed = null;
  let subtitle = "";

  if (type === "note" || type === "folder") {
    const path = typeof s.path === "string" ? s.path.trim() : "";
    if (!path) return null;
    parsed = alias ? { type, path, alias } : { type, path };
    subtitle = path;
  } else if (type === "tag") {
    const tagPath = typeof s.tagPath === "string" ? s.tagPath.trim() : "";
    if (!tagPath) return null;
    parsed = alias ? { type: "tag", tagPath, alias } : { type: "tag", tagPath };
    subtitle = `#${tagPath.replace(/\//g, " / ")}`;
  } else if (type === "search") {
    const query = typeof s.query === "string" ? s.query.trim() : "";
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!query && !name) return null;
    parsed = {
      type: "search",
      name: name || "Zoekopdracht",
      query,
      provider: typeof s.provider === "string" ? s.provider : undefined,
    };
    subtitle = query || name;
  } else if (type === "property") {
    const nodeId = typeof s.nodeId === "string" ? s.nodeId.trim() : "";
    if (!nodeId) return null;
    parsed = alias ? { type: "property", nodeId, alias } : { type: "property", nodeId };
    subtitle = nodeId;
  } else {
    return null;
  }

  return {
    index,
    shortcut: parsed,
    label: alias || defaultLabel(parsed),
    subtitle,
    kind: type,
  };
}

/** @param {NavigatorShortcut} shortcut */
function defaultLabel(shortcut) {
  if (shortcut.type === "note" || shortcut.type === "folder") {
    const parts = shortcut.path.split("/");
    return parts[parts.length - 1] || shortcut.path;
  }
  if (shortcut.type === "tag") {
    const parts = shortcut.tagPath.split("/");
    return `#${parts[parts.length - 1] || shortcut.tagPath}`;
  }
  if (shortcut.type === "search") {
    return shortcut.name || shortcut.query.slice(0, 48) || "Zoeken";
  }
  if (shortcut.type === "property") {
    return shortcut.nodeId;
  }
  return "Snelkoppeling";
}

/** @param {string} kind */
export function shortcutKindLabel(kind) {
  switch (kind) {
    case "note":
      return "Notitie";
    case "folder":
      return "Map";
    case "tag":
      return "Tag";
    case "search":
      return "Zoeken";
    case "property":
      return "Property";
    default:
      return kind;
  }
}
