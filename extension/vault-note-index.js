import { fetchVaultTree, isHiddenVaultPath, postIgnisJson } from "./ignis-client.js";
import { listMarkdownPaths, parseTagsFromMarkdown } from "./tag-index.js";
import { parseFrontmatterObject } from "./frontmatter.js";

const BATCH_READ_SIZE = 200;

/** @typedef {{ path: string, name: string, folder: string, ext: string, mtime: number, ctime: number, size: number, tags: string[], properties: Record<string, unknown>, links: string[] }} VaultNoteRecord */

/** @param {import('./ignis-client.js').VaultTree} tree @param {string} relPath */
function treeMeta(tree, relPath) {
  const node = tree[relPath];
  return {
    mtime: node?.mtime ?? 0,
    ctime: node?.ctime ?? 0,
    size: node?.size ?? 0,
  };
}

/** @param {string} markdown */
function parseWikiLinks(markdown) {
  /** @type {string[]} */
  const links = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const target = m[1].trim();
    if (target) links.push(target);
  }
  return links;
}

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{ notes: VaultNoteRecord[], truncated: boolean, total: number }>}
 */
export async function buildVaultNoteRecords(settings, onProgress) {
  const tree = await fetchVaultTree(settings);
  const { paths, total, truncated } = listMarkdownPaths(tree);

  /** @type {VaultNoteRecord[]} */
  const notes = [];

  for (let i = 0; i < paths.length; i += BATCH_READ_SIZE) {
    const chunk = paths.slice(i, i + BATCH_READ_SIZE);
    const files = await batchRead(settings, chunk);
    for (const relPath of chunk) {
      const content = files[relPath];
      if (typeof content !== "string") continue;
      const slash = relPath.lastIndexOf("/");
      const name = slash >= 0 ? relPath.slice(slash + 1) : relPath;
      const folder = slash >= 0 ? relPath.slice(0, slash) : "";
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
      const meta = treeMeta(tree, relPath);
      const properties = parseFrontmatterObject(content);
      const tags = parseTagsFromMarkdown(content);
      notes.push({
        path: relPath,
        name,
        folder,
        ext,
        mtime: meta.mtime,
        ctime: meta.ctime,
        size: meta.size,
        tags,
        properties,
        links: parseWikiLinks(content),
      });
    }
    onProgress?.(Math.min(i + chunk.length, paths.length), paths.length);
  }

  return { notes, truncated, total };
}

/** @param {import('./ignis-client.js').CaptureSettings} settings @param {string[]} paths */
async function batchRead(settings, paths) {
  const res = await postIgnisJson(settings, "/api/fs/batch-read", { paths });
  return res.files || {};
}
