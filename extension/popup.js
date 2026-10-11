import {
  writeNote,
  testConnection,
  fetchVaultTree,
  listSelectableFolders,
  formatFolderLabel,
} from "./ignis-client.js";
import { buildVaultTagIndex } from "./tag-index.js";
import { buildTagTree, filterTagTree } from "./tag-tree.js";
import { loadTagIndexCache, saveTagIndexCache, isTagCacheStale } from "./tag-cache.js";
import { loadSettings } from "./settings-store.js";
import { ensurePermissionsForSettings } from "./permissions.js";
import {
  loadNotebookNavigatorShortcuts,
  shortcutKindLabel,
} from "./notebook-navigator.js";
import { openNavigatorShortcutItem } from "./shortcut-opener.js";

const els = {
  modeBadge: document.getElementById("modeBadge"),
  title: document.getElementById("title"),
  body: document.getElementById("body"),
  status: document.getElementById("status"),
  saveFolder: document.getElementById("saveFolder"),
  btnSave: document.getElementById("btnSave"),
  btnTest: document.getElementById("btnTest"),
  btnPing: document.getElementById("btnPing"),
  btnPickFolder: document.getElementById("btnPickFolder"),
  btnResetFolder: document.getElementById("btnResetFolder"),
  btnInsertTask: document.getElementById("btnInsertTask"),
  openOptions: document.getElementById("openOptions"),
  folderModal: document.getElementById("folderModal"),
  folderModalBackdrop: document.getElementById("folderModalBackdrop"),
  btnCloseFolderModal: document.getElementById("btnCloseFolderModal"),
  folderTree: document.getElementById("folderTree"),
  folderTreeLoading: document.getElementById("folderTreeLoading"),
  folderTreeError: document.getElementById("folderTreeError"),
  tagFilter: document.getElementById("tagFilter"),
  tagTree: document.getElementById("tagTree"),
  tagMeta: document.getElementById("tagMeta"),
  btnRefreshTags: document.getElementById("btnRefreshTags"),
  shortcutsMeta: document.getElementById("shortcutsMeta"),
  shortcutList: document.getElementById("shortcutList"),
  btnRefreshShortcuts: document.getElementById("btnRefreshShortcuts"),
};

/** @type {import('./ignis-client.js').CaptureSettings | null} */
let settings = null;

/** Map for the next save (defaults to settings.folder / Inbox). */
let saveFolder = "";

/** @type {import('./tag-cache.js').TagIndexCache | null} */
let tagIndex = null;
let tagsLoading = false;
/** @type {Set<string>} collapsed tag paths (children hidden) */
const collapsedTagPaths = new Set();
let tagTreeCollapseDefaultsApplied = false;
/** @type {import('./notebook-navigator.js').ShortcutListItem[] | null} */
let navigatorShortcuts = null;
let shortcutsLoading = false;

function defaultFolder() {
  return (settings?.folder ?? "Inbox").trim();
}

function setStatus(kind, message) {
  els.status.className = "status show " + kind;
  els.status.textContent = message;
}

function clearStatus() {
  els.status.className = "status";
  els.status.textContent = "";
}

function setBusy(busy) {
  els.btnSave.disabled = busy;
  els.btnTest.disabled = busy;
  els.btnPing.disabled = busy;
  els.btnPickFolder.disabled = busy;
  if (!tagsLoading) els.btnRefreshTags.disabled = busy;
  if (!shortcutsLoading) els.btnRefreshShortcuts.disabled = busy;
}

function updateModeBadge() {
  if (!settings) return;
  els.modeBadge.textContent = settings.connectionMode === "proxy" ? "docker proxy" : "direct";
}

function updateSaveFolderUi() {
  const label = formatFolderLabel(saveFolder);
  els.saveFolder.textContent = label;
  els.saveFolder.title = saveFolder === "" ? "Vault root" : saveFolder;
}

function resetSaveFolderToDefault() {
  saveFolder = defaultFolder();
  updateSaveFolderUi();
}

async function refreshSettings() {
  settings = await loadSettings();
  updateModeBadge();
  resetSaveFolderToDefault();
  void refreshTags(false);
  void refreshNavigatorShortcuts(false);
}

async function withPermission(fn) {
  if (!settings) await refreshSettings();
  const ok = await ensurePermissionsForSettings(settings);
  if (!ok) {
    throw new Error("Host-permissie geweigerd — open Instellingen en keur de URL goed.");
  }
  return fn(settings);
}

function folderDepth(path) {
  if (!path) return 0;
  return path.split("/").length;
}

function depthClass(depth) {
  const d = Math.min(depth, 5);
  return d > 0 ? `depth-${d}` : "";
}

function renderFolderTree(folders) {
  els.folderTree.innerHTML = "";
  for (const path of folders) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = depthClass(folderDepth(path));
    btn.textContent = formatFolderLabel(path);
    btn.dataset.path = path;
    if (path === saveFolder) {
      btn.classList.add("selected");
    }
    btn.addEventListener("click", () => {
      saveFolder = path;
      updateSaveFolderUi();
      closeFolderModal();
      setStatus("info", "Opslaglocatie: " + formatFolderLabel(path));
    });
    li.appendChild(btn);
    els.folderTree.appendChild(li);
  }
}

function openFolderModal() {
  els.folderModal.hidden = false;
  els.folderModal.setAttribute("aria-hidden", "false");
}

function closeFolderModal() {
  els.folderModal.hidden = true;
  els.folderModal.setAttribute("aria-hidden", "true");
  els.folderTreeError.hidden = true;
  els.folderTreeLoading.hidden = true;
}

async function onPickFolder() {
  clearStatus();
  openFolderModal();
  els.folderTree.innerHTML = "";
  els.folderTreeError.hidden = true;
  els.folderTreeLoading.hidden = false;
  setBusy(true);
  try {
    const tree = await withPermission((s) => fetchVaultTree(s));
    const folders = listSelectableFolders(tree);
    renderFolderTree(folders);
    if (folders.length === 0) {
      els.folderTreeError.hidden = false;
      els.folderTreeError.textContent = "Geen mappen gevonden in deze vault.";
    }
  } catch (e) {
    els.folderTreeError.hidden = false;
    els.folderTreeError.textContent = formatError(e);
  } finally {
    els.folderTreeLoading.hidden = true;
    setBusy(false);
  }
}

function updateTagMeta() {
  if (!tagIndex) {
    els.tagMeta.textContent = "Nog niet geladen.";
    return;
  }
  let msg = `${tagIndex.tags.length} tags uit ${tagIndex.filesScanned} notities`;
  if (tagIndex.truncated) {
    msg += ` (eerste ${tagIndex.filesScanned} van ${tagIndex.markdownTotal})`;
  }
  msg += ` · ${new Date(tagIndex.scannedAt).toLocaleString("nl-NL")}`;
  els.tagMeta.textContent = msg;
}

function renderTagTree() {
  els.tagTree.innerHTML = "";
  const filter = els.tagFilter.value.trim();
  const entries = tagIndex?.tags || [];
  if (!entries.length) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = tagIndex ? "Geen tags in vault." : "Scan via ↻ of open opnieuw.";
    els.tagTree.appendChild(hint);
    return;
  }

  const roots = buildTagTree(entries);
  if (!tagTreeCollapseDefaultsApplied) {
    for (const node of roots) {
      if (node.children.length) collapsedTagPaths.add(node.fullPath);
    }
    tagTreeCollapseDefaultsApplied = true;
  }
  const visible = filterTagTree(roots, filter);
  if (!visible.length) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "Geen tags voor deze zoekterm.";
    els.tagTree.appendChild(hint);
    return;
  }

  const list = document.createElement("ul");
  list.className = "tag-tree-group";
  list.setAttribute("role", "group");
  for (const node of visible) {
    list.appendChild(renderTagTreeNode(node, 0, Boolean(filter)));
  }
  els.tagTree.appendChild(list);
}

/**
 * @param {import('./tag-tree.js').TagTreeNode} node
 * @param {number} depth
 * @param {boolean} filterActive
 */
function renderTagTreeNode(node, depth, filterActive) {
  const li = document.createElement("li");
  li.setAttribute("role", "treeitem");
  li.setAttribute("aria-level", String(depth + 1));

  const hasChildren = node.children.length > 0;
  const expanded = filterActive || !collapsedTagPaths.has(node.fullPath);

  const row = document.createElement("div");
  row.className = "tag-tree-row";
  row.style.paddingLeft = `${8 + depth * 14}px`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tag-tree-toggle" + (hasChildren ? "" : " placeholder");
  toggle.setAttribute("aria-label", hasChildren ? (expanded ? "Inklappen" : "Uitklappen") : "");
  toggle.textContent = hasChildren ? (expanded ? "▼" : "▶") : "·";
  if (hasChildren) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (collapsedTagPaths.has(node.fullPath)) {
        collapsedTagPaths.delete(node.fullPath);
      } else {
        collapsedTagPaths.add(node.fullPath);
      }
      renderTagTree();
    });
  }

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "tag-tree-pick" + (node.count === 0 && hasChildren ? " is-parent-only" : "");
  pick.title = node.count
    ? `Invoegen #${node.fullPath} (${node.count}×)`
    : `Map #${node.fullPath} — klik om volledige tag in te voegen`;
  const seg = document.createElement("span");
  seg.className = "seg";
  seg.textContent = `#${node.segment}`;
  pick.appendChild(seg);
  if (node.count > 0) {
    const cnt = document.createElement("span");
    cnt.className = "cnt";
    cnt.textContent = `(${node.count})`;
    pick.appendChild(cnt);
  }
  pick.addEventListener("click", () => insertTag(node.fullPath));

  row.append(toggle, pick);
  li.appendChild(row);

  if (hasChildren) {
    li.setAttribute("aria-expanded", expanded ? "true" : "false");
    const childList = document.createElement("ul");
    childList.className = "tag-tree-children tag-tree-group";
    childList.hidden = !expanded;
    childList.setAttribute("role", "group");
    for (const child of node.children) {
      childList.appendChild(renderTagTreeNode(child, depth + 1, filterActive));
    }
    li.appendChild(childList);
  }

  return li;
}

function insertTag(tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`#${escaped}(?:[\\s/#]|$)`, "i").test(els.body.value)) {
    setStatus("info", `#${tag} staat al in de notitie`);
    return;
  }
  insertSnippet(`#${tag} `);
}

function insertSnippet(snippet) {
  const ta = els.body;
  const val = ta.value;
  const start = ta.selectionStart ?? val.length;
  const end = ta.selectionEnd ?? start;
  let insert = snippet;
  if (val.length > 0 && start > 0) {
    const last = val[start - 1];
    if (last !== "\n" && last !== " ") {
      insert = " " + snippet;
    }
  }
  ta.setRangeText(insert, start, end, "end");
  ta.focus();
}

async function refreshTags(force) {
  if (tagsLoading) return;
  if (!settings) {
    settings = await loadSettings();
    updateModeBadge();
    resetSaveFolderToDefault();
  }
  const vault = settings.vaultId.trim();

  if (!force) {
    const cached = await loadTagIndexCache(vault);
    if (cached?.tags) {
      tagIndex = cached;
      updateTagMeta();
      renderTagTree();
      if (!isTagCacheStale(cached)) return;
    }
  }

  tagsLoading = true;
  els.btnRefreshTags.disabled = true;
  els.tagMeta.textContent = "Tags scannen…";
  try {
    tagIndex = await withPermission((s) =>
      buildVaultTagIndex(s, (done, total) => {
        els.tagMeta.textContent = `Tags scannen… ${done}/${total}`;
      }),
    );
    await saveTagIndexCache(vault, tagIndex);
    updateTagMeta();
    renderTagTree();
    setStatus("ok", `${tagIndex.tags.length} tags gevonden in vault.`);
  } catch (e) {
    els.tagMeta.textContent = "Tag-scan mislukt.";
    setStatus("err", formatError(e));
  } finally {
    tagsLoading = false;
    els.btnRefreshTags.disabled = false;
  }
}

function renderShortcutList() {
  els.shortcutList.innerHTML = "";
  if (!navigatorShortcuts?.length) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = navigatorShortcuts
      ? "Geen snelkoppelingen in dit vault-profiel."
      : "Laad snelkoppelingen via Vernieuwen (Notebook Navigator).";
    els.shortcutList.appendChild(hint);
    return;
  }

  for (const item of navigatorShortcuts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shortcut-item";
    const num = item.index + 1;
    btn.title = `${item.label}\n${item.subtitle}`;

    const numEl = document.createElement("span");
    numEl.className = "shortcut-num" + (num <= 9 ? " hotkey" : "");
    numEl.textContent = num <= 9 ? String(num) : "·";

    const body = document.createElement("span");
    body.className = "shortcut-body";
    const label = document.createElement("span");
    label.className = "shortcut-label";
    label.textContent = item.label;
    const sub = document.createElement("span");
    sub.className = "shortcut-sub";
    sub.textContent = item.subtitle;
    body.append(label, sub);

    const kind = document.createElement("span");
    kind.className = "shortcut-kind";
    kind.textContent = shortcutKindLabel(item.kind);

    btn.append(numEl, body, kind);
    btn.addEventListener("click", () => onOpenShortcut(item));
    els.shortcutList.appendChild(btn);
  }
}

async function refreshNavigatorShortcuts(force) {
  if (shortcutsLoading && !force) return;
  if (!settings) {
    settings = await loadSettings();
    updateModeBadge();
    resetSaveFolderToDefault();
  }

  shortcutsLoading = true;
  els.btnRefreshShortcuts.disabled = true;
  els.shortcutsMeta.textContent = "Snelkoppelingen laden…";

  try {
    const profileOverride = (settings.notebookNavigatorProfile || "").trim();
    const data = await withPermission((s) =>
      loadNotebookNavigatorShortcuts(s, profileOverride || undefined),
    );
    navigatorShortcuts = data.shortcuts;
    const profileLabel = data.profileName || data.profileId;
    els.shortcutsMeta.textContent =
      `${data.shortcuts.length} snelkoppelingen · profiel “${profileLabel}”` +
      (data.shortcuts.some((_, i) => i < 9)
        ? " · 1–9 openen via Notebook Navigator in Ignis"
        : "");
    renderShortcutList();
  } catch (e) {
    navigatorShortcuts = null;
    els.shortcutsMeta.textContent = "Snelkoppelingen niet geladen.";
    renderShortcutList();
    if (force) setStatus("err", formatError(e));
  } finally {
    shortcutsLoading = false;
    els.btnRefreshShortcuts.disabled = false;
  }
}

/** @param {import('./notebook-navigator.js').ShortcutListItem} item */
async function onOpenShortcut(item) {
  clearStatus();
  setBusy(true);
  try {
    const result = await withPermission((s) => openNavigatorShortcutItem(s, item));
    setStatus("ok", `Geopend (${result.mode}): ${result.detail}`);
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

function insertTaskLine() {
  const ta = els.body;
  const val = ta.value;
  const start = ta.selectionStart ?? val.length;
  const before = val.slice(0, start);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  insertSnippet((needsLeadingNewline ? "\n" : "") + "- [ ] ");
}

async function onSave() {
  clearStatus();
  if (!els.body.value.trim() && !els.title.value.trim()) {
    setStatus("err", "Vul minimaal titel of inhoud in.");
    return;
  }
  setBusy(true);
  try {
    const { path } = await withPermission((s) =>
      writeNote(s, els.title.value, els.body.value, saveFolder),
    );
    setStatus("ok", "Opgeslagen: " + path);
    els.body.value = "";
    els.title.value = "";
    resetSaveFolderToDefault();
    els.title.focus();
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

async function onTest() {
  clearStatus();
  setBusy(true);
  try {
    const { path } = await withPermission((s) =>
      writeNote(
        s,
        "Extension test",
        "Testnotitie vanuit Chrome-extensie.\n\n" + new Date().toLocaleString("nl-NL") + "\n",
        saveFolder,
      ),
    );
    setStatus("ok", "Test OK: " + path);
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

async function onPing() {
  clearStatus();
  setBusy(true);
  try {
    const result = await withPermission((s) => testConnection(s));
    setStatus(
      result.found ? "ok" : "info",
      `Ignis ${result.ignisVer}, Obsidian ${result.obsVer}. Vault "${result.vault}": ${
        result.found ? "gevonden" : "niet gevonden"
      }.`,
    );
  } catch (e) {
    setStatus("err", formatError(e));
  } finally {
    setBusy(false);
  }
}

function formatError(e) {
  const msg = e?.message || String(e);
  if (/Failed to fetch|NetworkError|ERR_CERT/i.test(msg)) {
    return (
      msg +
      " — TLS/certificaat? Open Ignis eenmalig in een tab en vertrouw het certificaat. " +
      "Anders: zet in Instellingen modus Docker proxy."
    );
  }
  return msg;
}

els.btnSave.addEventListener("click", onSave);
els.btnTest.addEventListener("click", onTest);
els.btnPing.addEventListener("click", onPing);
els.btnPickFolder.addEventListener("click", onPickFolder);
els.btnResetFolder.addEventListener("click", () => {
  resetSaveFolderToDefault();
  setStatus("info", "Opslaglocatie: " + formatFolderLabel(saveFolder));
});
els.btnInsertTask.addEventListener("click", insertTaskLine);
els.btnRefreshTags.addEventListener("click", () => refreshTags(true));
els.btnRefreshShortcuts.addEventListener("click", () => refreshNavigatorShortcuts(true));
els.tagFilter.addEventListener("input", renderTagTree);
els.btnCloseFolderModal.addEventListener("click", closeFolderModal);
els.folderModalBackdrop.addEventListener("click", closeFolderModal);
els.openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refreshSettings();
