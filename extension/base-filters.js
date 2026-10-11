/** @typedef {import('./vault-note-index.js').VaultNoteRecord} VaultNoteRecord */

/** @typedef {{ file: { path: string, folder: string, name: string } }} BaseThisContext */

/**
 * @param {unknown} globalFilters
 * @param {unknown} viewFilters
 */
export function mergeBaseFilters(globalFilters, viewFilters) {
  if (!globalFilters && !viewFilters) return null;
  if (!globalFilters) return viewFilters;
  if (!viewFilters) return globalFilters;
  return { and: [globalFilters, viewFilters] };
}

/**
 * @param {VaultNoteRecord} note
 * @param {unknown} filter
 * @param {BaseThisContext} [thisCtx]
 */
export function noteMatchesFilter(note, filter, thisCtx) {
  if (filter == null || filter === "") return true;
  if (typeof filter === "string") {
    return evalFilterExpression(filter.trim(), note, thisCtx);
  }
  if (typeof filter !== "object" || filter === null) return true;

  const obj = /** @type {Record<string, unknown>} */ (filter);
  if (Array.isArray(obj.and)) {
    return obj.and.every((f) => noteMatchesFilter(note, f, thisCtx));
  }
  if (Array.isArray(obj.or)) {
    return obj.or.some((f) => noteMatchesFilter(note, f, thisCtx));
  }
  if (obj.not !== undefined) {
    const items = Array.isArray(obj.not) ? obj.not : [obj.not];
    return !items.some((f) => noteMatchesFilter(note, f, thisCtx));
  }
  return true;
}

/**
 * @param {string} expr
 * @param {VaultNoteRecord} note
 * @param {BaseThisContext} [thisCtx]
 */
function evalFilterExpression(expr, note, thisCtx) {
  if (!expr) return true;

  let m = expr.match(/^file\.hasTag\(\s*"([^"]*)"\s*\)$/);
  if (m) return noteHasTag(note, m[1]);

  m = expr.match(/^file\.inFolder\(\s*"([^"]*)"\s*\)$/);
  if (m) return noteInFolder(note, m[1]);

  m = expr.match(/^file\.hasLink\(\s*"([^"]*)"\s*\)$/);
  if (m) return noteHasLink(note, m[1]);

  m = expr.match(/^file\.hasLink\(\s*this\.file\s*\)$/);
  if (m && thisCtx) {
    const target = thisCtx.file.name.replace(/\.md$/i, "");
    return noteHasLink(note, target) || noteHasLink(note, thisCtx.file.path.replace(/\.md$/i, ""));
  }

  m = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (m) {
    const left = resolveValue(m[1].trim(), note, thisCtx);
    const op = m[2];
    const right = parseLiteral(m[3].trim(), note, thisCtx);
    return compareValues(left, op, right);
  }

  return true;
}

/** @param {VaultNoteRecord} note @param {string} tag */
function noteHasTag(note, tag) {
  const want = tag.toLowerCase().replace(/^#+/, "");
  return note.tags.some((t) => {
    const got = t.toLowerCase();
    return got === want || got.endsWith("/" + want) || want.endsWith("/" + got);
  });
}

/** @param {VaultNoteRecord} note @param {string} folder */
function noteInFolder(note, folder) {
  const f = folder.replace(/^\/+|\/+$/g, "");
  if (!f) return true;
  return note.folder === f || note.folder.startsWith(f + "/") || note.path.startsWith(f + "/");
}

/** @param {VaultNoteRecord} note @param {string} link */
function noteHasLink(note, link) {
  const want = link.replace(/\.md$/i, "").toLowerCase();
  return note.links.some((l) => l.toLowerCase() === want || l.toLowerCase().endsWith("/" + want));
}

/** @param {string} token @param {VaultNoteRecord} note @param {BaseThisContext} [thisCtx] */
function resolveValue(token, note, thisCtx) {
  if (token === "now()") return Date.now();
  if (token === "today()") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  if (token.startsWith("this.file.")) {
    const key = token.slice("this.file.".length);
    if (!thisCtx) return undefined;
    switch (key) {
      case "name":
        return thisCtx.file.name;
      case "path":
        return thisCtx.file.path;
      case "folder":
        return thisCtx.file.folder;
      default:
        return undefined;
    }
  }

  if (token.startsWith("this.")) {
    return resolveValue(token.replace(/^this\./, "file."), note, thisCtx);
  }

  if (token.startsWith("file.")) {
    const key = token.slice(5);
    switch (key) {
      case "name":
        return note.name;
      case "path":
        return note.path;
      case "folder":
        return note.folder;
      case "ext":
        return note.ext;
      case "mtime":
        return note.mtime ? note.mtime * 1000 : 0;
      case "ctime":
        return note.ctime ? note.ctime * 1000 : 0;
      case "size":
        return note.size;
      case "tags":
        return note.tags;
      default:
        return undefined;
    }
  }

  if (token.startsWith("note.")) {
    return note.properties[token.slice(5)];
  }

  if (token.startsWith("formula.")) {
    return undefined;
  }

  if (thisCtx && token.startsWith("file.")) {
    // already handled
  }

  return note.properties[token];
}

/** @param {string} raw @param {VaultNoteRecord} note @param {BaseThisContext} [thisCtx] */
function parseLiteral(raw, note, thisCtx) {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return resolveValue(raw, note, thisCtx);
}

/** @param {unknown} left @param {string} op @param {unknown} right */
function compareValues(left, op, right) {
  if (op === "==" || op === "!=") {
    const eq = looseEqual(left, right);
    return op === "==" ? eq : !eq;
  }
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (ln == null || rn == null) return false;
  switch (op) {
    case ">":
      return ln > rn;
    case "<":
      return ln < rn;
    case ">=":
      return ln >= rn;
    case "<=":
      return ln <= rn;
    default:
      return false;
  }
}

/** @param {unknown} a @param {unknown} b */
function looseEqual(a, b) {
  if (Array.isArray(a) && typeof b === "string") {
    return a.some((x) => String(x) === b);
  }
  if (typeof a === "string" && Array.isArray(b)) {
    return b.some((x) => String(x) === a);
  }
  return String(a) === String(b);
}

/** @param {unknown} v @returns {number | null} */
function toNumber(v) {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
