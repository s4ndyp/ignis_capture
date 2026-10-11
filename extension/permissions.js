import { normalizeBase, originPatternFromBase } from "./ignis-client.js";

/** @param {{ connectionMode: string, ignisBaseUrl: string, proxyBaseUrl: string }} settings */
export function activeBaseUrl(settings) {
  if (settings.connectionMode === "proxy") {
    return normalizeBase(settings.proxyBaseUrl);
  }
  return normalizeBase(settings.ignisBaseUrl);
}

/** @param {string} baseUrl */
export async function ensureHostPermission(baseUrl) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    throw new Error("Ongeldige URL in instellingen");
  }
  const pattern = `${origin}/*`;
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (granted) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

/** @param {{ connectionMode: string, ignisBaseUrl: string, proxyBaseUrl: string }} settings */
export async function ensurePermissionsForSettings(settings) {
  const base = activeBaseUrl(settings);
  if (!base) throw new Error("Vul een Ignis- of proxy-URL in (Instellingen)");
  return ensureHostPermission(base);
}
