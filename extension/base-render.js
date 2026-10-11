import { parse as parseYaml } from "./vendor/yaml/dist/index.js";
import { buildVaultNoteRecords } from "./vault-note-index.js";
import { mergeBaseFilters, noteMatchesFilter } from "./base-filters.js";

/** @typedef {import('./vault-note-index.js').VaultNoteRecord} VaultNoteRecord */

/**
 * @param {import('./ignis-client.js').CaptureSettings} settings
 * @param {string} baseYamlText
 * @param {string} baseFilePath
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function renderBaseTableHtml(settings, baseYamlText, baseFilePath, onProgress) {
  /** @type {Record<string, unknown>} */
  let config;
  try {
    config = parseYaml(baseYamlText) || {};
  } catch (e) {
    throw new Error("Ongeldige .base YAML: " + (e?.message || String(e)));
  }

  const view = pickTableView(config);
  if (!view) {
    throw new Error("Geen table-view gevonden in dit .base-bestand.");
  }

  const thisCtx = buildThisContext(baseFilePath);
  const { notes, truncated, total } = await buildVaultNoteRecords(settings, onProgress);
  const filter = mergeBaseFilters(config.filters, view.filters);

  let rows = notes.filter((n) => noteMatchesFilter(n, filter, thisCtx));
  rows = sortRows(rows, view);
  const limit = typeof view.limit === "number" && view.limit > 0 ? view.limit : null;
  if (limit != null) rows = rows.slice(0, limit);

  const columns = resolveColumns(view, config);
  const viewName = typeof view.name === "string" ? view.name : "Tabel";

  const html = buildTableHtml({
    viewName,
    columns,
    rows,
    propertyLabels: config.properties || {},
    truncated,
    scannedTotal: total,
    rowTotal: rows.length,
    formulasSkipped: columns.some((c) => c.key.startsWith("formula.")),
  });

  return { html, viewName, rowCount: rows.length, truncated };
}

/** @param {Record<string, unknown>} config */
function pickTableView(config) {
  const views = Array.isArray(config.views) ? config.views : [];
  const tables = views.filter((v) => v && typeof v === "object" && v.type === "table");
  if (!tables.length) return null;
  const named = tables.find((v) => v.name && config.defaultView === v.name);
  return named || tables[0];
}

/** @param {string} baseFilePath */
function buildThisContext(baseFilePath) {
  const path = baseFilePath.replace(/^\/+/, "");
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  return { file: { path, name, folder } };
}

/** @param {VaultNoteRecord[]} rows @param {Record<string, unknown>} view */
function sortRows(rows, view) {
  /** @type {{ property?: string, direction?: string }[]} */
  const sorts = Array.isArray(view.sorts) ? view.sorts : [];
  if (!sorts.length) {
    return [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const s of sorts) {
      const prop = typeof s.property === "string" ? s.property : "file.name";
      const dir = (s.direction || "ASC").toUpperCase() === "DESC" ? -1 : 1;
      const av = formatCellValue(a, prop);
      const bv = formatCellValue(b, prop);
      const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
  return sorted;
}

/** @param {Record<string, unknown>} view @param {Record<string, unknown>} config */
function resolveColumns(view, config) {
  /** @type {string[]} */
  const order = Array.isArray(view.order) ? view.order.map(String) : ["file.name"];
  const propertyLabels = config.properties && typeof config.properties === "object" ? config.properties : {};

  return order.map((key) => {
    const cfg = propertyLabels[key];
    const displayName =
      cfg && typeof cfg === "object" && cfg.displayName
        ? String(cfg.displayName)
        : defaultColumnLabel(key);
    return { key, displayName };
  });
}

/** @param {string} key */
function defaultColumnLabel(key) {
  if (key.startsWith("file.")) return key.slice(5);
  if (key.startsWith("note.")) return key.slice(5);
  if (key.startsWith("formula.")) return key.slice(8);
  return key;
}

/** @param {VaultNoteRecord} note @param {string} key */
function formatCellValue(note, key) {
  if (key.startsWith("formula.")) return "—";
  if (key === "file.name") return note.name.replace(/\.md$/i, "");
  if (key === "file.path") return note.path;
  if (key === "file.folder") return note.folder;
  if (key === "file.ext") return note.ext;
  if (key === "file.size") return note.size;
  if (key === "file.mtime") return formatEpoch(note.mtime);
  if (key === "file.ctime") return formatEpoch(note.ctime);
  if (key === "file.tags") return note.tags.map((t) => `#${t}`).join(" ");
  if (key.startsWith("file.")) return "";
  if (key.startsWith("note.")) {
    return formatPropertyValue(note.properties[key.slice(5)]);
  }
  return formatPropertyValue(note.properties[key]);
}

/** @param {unknown} value */
function formatPropertyValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** @param {number} sec */
function formatEpoch(sec) {
  if (!sec) return "";
  try {
    return new Date(sec * 1000).toLocaleString("nl-NL");
  } catch {
    return String(sec);
  }
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ viewName: string, columns: { key: string, displayName: string }[], rows: VaultNoteRecord[], truncated: boolean, scannedTotal: number, rowTotal: number, formulasSkipped: boolean, propertyLabels: unknown }} opts
 */
function buildTableHtml(opts) {
  const head = opts.columns
    .map((c) => `<th scope="col">${escapeHtml(c.displayName)}</th>`)
    .join("");

  const body = opts.rows
    .map((note) => {
      const cells = opts.columns
        .map((c) => `<td>${escapeHtml(formatCellValue(note, c.key))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const meta = [
    `<span class="base-meta-pill">${escapeHtml(opts.viewName)}</span>`,
    `<span class="base-meta-pill">${opts.rowTotal} rijen</span>`,
  ];
  if (opts.truncated) {
    meta.push(`<span class="base-meta-warn">Vault-scan beperkt (${opts.scannedTotal} md)</span>`);
  }
  if (opts.formulasSkipped) {
    meta.push(`<span class="base-meta-warn">Formulekolommen niet berekend</span>`);
  }

  return (
    `<div class="base-preview">` +
    `<div class="base-meta">${meta.join("")}</div>` +
    `<div class="base-table-wrap"><table class="base-table"><thead><tr>${head}</tr></thead>` +
    `<tbody>${body || `<tr><td colspan="${opts.columns.length}">Geen resultaten</td></tr>`}</tbody></table></div></div>`
  );
}
