import { DEFAULT_SETTINGS } from "./ignis-client.js";

export function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      resolve({ ...DEFAULT_SETTINGS, ...items });
    });
  });
}

export function saveSettings(partial) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(partial, () => resolve());
  });
}
