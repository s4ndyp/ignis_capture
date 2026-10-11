import { activeBaseUrl } from "./permissions.js";
import { buildIgnisFileUrl } from "./ignis-client.js";
import { resolveFolderNotePath } from "./shortcut-file.js";

const NN_COMMAND_PREFIX = "notebook-navigator:open-shortcut-";
const LOAD_TIMEOUT_MS = 90000;

/** @param {import('./ignis-client.js').CaptureSettings} settings */
export function buildIgnisVaultUrl(settings) {
  const base = activeBaseUrl(settings);
  const vault = settings.vaultId.trim();
  return `${base}/?vault=${encodeURIComponent(vault)}`;
}

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {number} shortcutNumber 1–9
 */
export async function openNotebookNavigatorShortcutByNumber(settings, shortcutNumber) {
  if (!Number.isInteger(shortcutNumber) || shortcutNumber < 1 || shortcutNumber > 9) {
    throw new Error("Alleen snelkoppelingen 1–9 kunnen via Obsidian-commando's worden geopend.");
  }

  const vaultUrl = buildIgnisVaultUrl(settings);
  const tab = await findOrCreateIgnisTab(vaultUrl);
  await waitForTabComplete(tab.id);
  const commandId = `${NN_COMMAND_PREFIX}${shortcutNumber}`;

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: runObsidianCommandWhenReady,
    args: [commandId, LOAD_TIMEOUT_MS],
  });

  if (!result?.ok) {
    throw new Error(
      result?.error ||
        "Kon Notebook Navigator-snelkoppeling niet openen (plugin geladen?)",
    );
  }
}

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {import('./notebook-navigator.js').ShortcutListItem} item
 */
export async function openNavigatorShortcutItem(settings, item) {
  const number = item.index + 1;
  if (number >= 1 && number <= 9) {
    await openNotebookNavigatorShortcutByNumber(settings, number);
    return { mode: "command", detail: `Snelkoppeling ${number}` };
  }

  const shortcut = item.shortcut;
  if (shortcut.type === "note") {
    const url = buildIgnisFileUrl(settings, shortcut.path);
    await chrome.tabs.create({ url, active: true });
    return { mode: "file", detail: shortcut.path };
  }

  if (shortcut.type === "folder") {
    const notePath = await resolveFolderNotePath(settings, shortcut.path);
    if (notePath) {
      const url = buildIgnisFileUrl(settings, notePath);
      await chrome.tabs.create({ url, active: true });
      return { mode: "file", detail: notePath };
    }
    await chrome.tabs.create({ url: buildIgnisVaultUrl(settings), active: true });
    return {
      mode: "vault",
      detail: "Map-snelkoppeling — open Notebook Navigator in Ignis voor volledige navigatie.",
    };
  }

  await chrome.tabs.create({ url: buildIgnisVaultUrl(settings), active: true });
  return {
    mode: "vault",
    detail:
      "Tag/zoek/property-snelkoppelingen boven positie 9: open Ignis en gebruik Notebook Navigator.",
  };
}

/** @param {number} tabId */
function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab.status === "complete") {
        resolve(tab);
        return;
      }

      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error("Ignis-tab laadt te langzaam."));
      }, LOAD_TIMEOUT_MS);

      function onUpdated(updatedId, info) {
        if (updatedId !== tabId || info.status !== "complete") return;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.get(tabId, (t) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(t);
        });
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

/** @param {string} vaultUrl */
async function findOrCreateIgnisTab(vaultUrl) {
  const vaultParam = new URL(vaultUrl).searchParams.get("vault") || "";
  const origin = new URL(vaultUrl).origin;

  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const existing = tabs.find((t) => {
    if (!t.url) return false;
    try {
      const u = new URL(t.url);
      return u.searchParams.get("vault") === vaultParam;
    } catch {
      return false;
    }
  });

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: vaultUrl });
    return existing;
  }

  return chrome.tabs.create({ url: vaultUrl, active: true });
}

/**
 * Injected into Ignis tab — polls until Obsidian app is ready, then runs command.
 * @param {string} commandId
 * @param {number} timeoutMs
 */
async function runObsidianCommandWhenReady(commandId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  /** @type {any} */
  const w = window;

  while (Date.now() < deadline) {
    const app = w.app;
    if (app?.commands?.executeCommandById) {
      try {
        await app.commands.executeCommandById(commandId);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  return { ok: false, error: "Obsidian in Ignis niet op tijd geladen." };
}
