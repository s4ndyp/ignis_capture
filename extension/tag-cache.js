const CACHE_TTL_MS = 60 * 60 * 1000;
const STORAGE_PREFIX = "ignis-tag-index:";

/** @param {string} vaultId */
function storageKey(vaultId) {
  return STORAGE_PREFIX + vaultId.trim();
}

/** @typedef {{ tags: { tag: string, count: number }[], scannedAt: number, filesScanned: number, markdownTotal: number, truncated: boolean }} TagIndexCache */

/** @param {string} vaultId @returns {Promise<TagIndexCache | null>} */
export function loadTagIndexCache(vaultId) {
  const key = storageKey(vaultId);
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (items) => {
      resolve(items[key] || null);
    });
  });
}

/** @param {string} vaultId @param {TagIndexCache} data */
export function saveTagIndexCache(vaultId, data) {
  const key = storageKey(vaultId);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: data }, () => resolve());
  });
}

/** @param {TagIndexCache | null} cache */
export function isTagCacheStale(cache) {
  if (!cache?.scannedAt) return true;
  return Date.now() - cache.scannedAt > CACHE_TTL_MS;
}
