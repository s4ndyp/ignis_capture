import { notePathExists, readVaultText } from "./ignis-client.js";

/** @param {string} notePath */
export function notePathCandidates(notePath) {
  const p = notePath.trim().replace(/^\/+/, "");
  if (!p) return [];
  const candidates = [p];
  if (!/\.(md|base)$/i.test(p)) {
    candidates.push(`${p}.md`, `${p}.base`);
  }
  return candidates;
}

/** @param {string} path */
export function isBaseVaultPath(path) {
  return /\.base$/i.test(path);
}

/** @param {import('./ignis-client.js').CaptureSettings} settings @param {string} folderPath */
export async function resolveFolderNotePath(settings, folderPath) {
  const folder = folderPath.replace(/^\/+|\/+$/g, "");
  if (!folder) return null;

  const name = folder.split("/").pop() || folder;
  const candidates = [
    `${folder}/${name}.md`,
    `${folder}.md`,
    `${folder}/index.md`,
  ];

  for (const path of candidates) {
    if (await notePathExists(settings, path)) {
      return path;
    }
  }
  return null;
}

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {import('./notebook-navigator.js').ShortcutListItem} item
 * @returns {Promise<string | null>} vault-relative file path, or null if not a file shortcut
 */
export async function resolveShortcutFilePath(settings, item) {
  const s = item.shortcut;
  if (s.type === "note") {
    for (const path of notePathCandidates(s.path)) {
      if (await notePathExists(settings, path)) {
        return path;
      }
    }
    throw new Error(`Notitie niet gevonden in vault: ${s.path}`);
  }
  if (s.type === "folder") {
    const path = await resolveFolderNotePath(settings, s.path);
    if (!path) {
      throw new Error(`Geen foldernote gevonden voor map: ${s.path}`);
    }
    return path;
  }
  return null;
}

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {import('./notebook-navigator.js').ShortcutListItem} item
 */
export async function fetchShortcutFileContent(settings, item) {
  const path = await resolveShortcutFilePath(settings, item);
  if (!path) {
    return { kind: "non-file", item };
  }
  const content = await readVaultText(settings, path);
  if (isBaseVaultPath(path)) {
    return { kind: "base", path, content, title: item.label };
  }
  return { kind: "markdown", path, content, title: item.label };
}
