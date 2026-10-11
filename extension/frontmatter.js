import { parse as parseYaml } from "./vendor/yaml/dist/index.js";

/** @param {string} markdown @returns {Record<string, unknown>} */
export function parseFrontmatterObject(markdown) {
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return {};
  try {
    const parsed = parseYaml(fmMatch[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return /** @type {Record<string, unknown>} */ (parsed);
    }
  } catch {
    // fall through
  }
  return {};
}
