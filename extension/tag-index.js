import { fetchVaultTree, isHiddenVaultPath, postIgnisJson } from "./ignis-client.js";

const BATCH_READ_SIZE = 200;
const MAX_MARKDOWN_FILES = 4000;

/** @param {string} text */
function stripCodeRegions(text) {
  return text
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/^    .*$/gm, "\n")
    .replace(/`[^`\n]+`/g, " ");
}

/** @param {string} tag */
function normalizeTagKey(tag) {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

/** @param {string} tag */
export function isValidObsidianTag(tag) {
  if (!tag || tag.length > 128) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(tag);
}

/** @param {string} frontmatter */
function parseFrontmatterTags(frontmatter) {
  /** @type {string[]} */
  const found = [];
  const lines = frontmatter.split(/\r?\n/);
  let inTagsBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const inline = trimmed.match(/^tags:\s*\[(.*)\]\s*$/);
    if (inline) {
      for (const part of inline[1].split(",")) {
        const t = part.trim().replace(/^['"]|['"]$/g, "");
        if (t) found.push(t);
      }
      inTagsBlock = false;
      continue;
    }

    if (/^tags:\s*.+/.test(trimmed) && !trimmed.startsWith("tags:")) {
      inTagsBlock = false;
    }

    if (/^tags:\s*$/.test(trimmed)) {
      inTagsBlock = true;
      continue;
    }

    if (/^tags:\s+\S/.test(trimmed)) {
      const rest = trimmed.replace(/^tags:\s+/, "").replace(/^['"]|['"]$/g, "");
      if (rest) found.push(rest);
      inTagsBlock = false;
      continue;
    }

    if (inTagsBlock && /^-\s+/.test(trimmed)) {
      const t = trimmed.replace(/^-\s+/, "").replace(/^['"]|['"]$/g, "");
      if (t) found.push(t);
    } else {
      inTagsBlock = false;
    }
  }

  return found;
}

/** @param {string} markdown @returns {string[]} canonical tag spellings */
export function parseTagsFromMarkdown(markdown) {
  /** @type {string[]} */
  const tags = [];
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    for (const t of parseFrontmatterTags(fmMatch[1])) {
      if (isValidObsidianTag(t)) tags.push(t);
    }
  }

  const body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown;
  const scan = stripCodeRegions(body);
  const re = /(?:^|[\s([{>])#([a-zA-Z0-9][a-zA-Z0-9_/-]*)/g;
  let m;
  while ((m = re.exec(scan)) !== null) {
    if (isValidObsidianTag(m[1])) tags.push(m[1]);
  }
  return tags;
}

/** @param {import('./ignis-client.js').VaultTree} tree */
export function listMarkdownPaths(tree) {
  const paths = Object.entries(tree || {})
    .filter(
      ([relPath, node]) =>
        node.type === "file" &&
        relPath.toLowerCase().endsWith(".md") &&
        !isHiddenVaultPath(relPath),
    )
    .map(([relPath]) => relPath)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const truncated = paths.length > MAX_MARKDOWN_FILES;
  return {
    paths: paths.slice(0, MAX_MARKDOWN_FILES),
    total: paths.length,
    truncated,
  };
}

/** @param {import('./ignis-client.js').CaptureSettings} settings @param {string[]} paths */
async function batchReadMarkdown(settings, paths) {
  /** @type {Record<string, string>} */
  const merged = {};
  for (let i = 0; i < paths.length; i += BATCH_READ_SIZE) {
    const chunk = paths.slice(i, i + BATCH_READ_SIZE);
    const res = await postIgnisJson(settings, "/api/fs/batch-read", { paths: chunk });
    Object.assign(merged, res.files || {});
  }
  return merged;
}

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function buildVaultTagIndex(settings, onProgress) {
  const tree = await fetchVaultTree(settings);
  const { paths, total, truncated } = listMarkdownPaths(tree);
  /** @type {Map<string, { tag: string, count: number }>} */
  const byKey = new Map();

  for (let i = 0; i < paths.length; i += BATCH_READ_SIZE) {
    const chunk = paths.slice(i, i + BATCH_READ_SIZE);
    const files = await batchReadMarkdown(settings, chunk);
    for (const content of Object.values(files)) {
      if (typeof content !== "string") continue;
      for (const raw of parseTagsFromMarkdown(content)) {
        const key = normalizeTagKey(raw);
        const prev = byKey.get(key);
        if (prev) {
          prev.count += 1;
        } else {
          byKey.set(key, { tag: raw, count: 1 });
        }
      }
    }
    onProgress?.(Math.min(i + chunk.length, paths.length), paths.length);
  }

  const tags = [...byKey.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" });
  });

  return {
    tags,
    scannedAt: Date.now(),
    filesScanned: paths.length,
    markdownTotal: total,
    truncated,
  };
}
