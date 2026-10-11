/** @typedef {{ tag: string, count: number }} TagEntry */

/** @typedef {{ segment: string, fullPath: string, count: number, children: TagTreeNode[] }} TagTreeNode */

/**
 * @param {TagEntry[]} entries
 * @returns {TagTreeNode[]}
 */
export function buildTagTree(entries) {
  /** @type {TagTreeNode & { _map?: Map<string, TagTreeNode> }} */
  const root = { segment: "", fullPath: "", count: 0, children: [], _map: new Map() };

  for (const { tag, count } of entries) {
    const parts = tag.split("/").filter(Boolean);
    if (!parts.length) continue;

    /** @type {TagTreeNode & { _map?: Map<string, TagTreeNode> }} */
    let node = root;
    let path = "";

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      path = path ? `${path}/${segment}` : segment;

      const map = node._map || (node._map = new Map());
      let child = map.get(segment);
      if (!child) {
        child = { segment, fullPath: path, count: 0, children: [], _map: new Map() };
        map.set(segment, child);
        node.children.push(child);
      }
      if (i === parts.length - 1) {
        child.count = count;
      }
      node = /** @type {TagTreeNode & { _map?: Map<string, TagTreeNode> }} */ (child);
    }
  }

  finalizeTree(root);
  return root.children;
}

/** @param {TagTreeNode & { _map?: Map<string, TagTreeNode> }} node */
function finalizeTree(node) {
  delete node._map;
  node.children.sort((a, b) =>
    a.segment.localeCompare(b.segment, undefined, { sensitivity: "base" }),
  );
  for (const child of node.children) {
    finalizeTree(/** @type {TagTreeNode & { _map?: Map<string, TagTreeNode> }} */ (child));
  }
}

/**
 * @param {TagTreeNode[]} nodes
 * @param {string} query
 * @returns {TagTreeNode[]}
 */
export function filterTagTree(nodes, query) {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  /** @param {TagTreeNode} node @returns {TagTreeNode | null} */
  function walk(node) {
    const selfMatch =
      node.fullPath.toLowerCase().includes(q) ||
      node.segment.toLowerCase().includes(q);

    const keptChildren = node.children
      .map(walk)
      .filter(Boolean);

    if (selfMatch || keptChildren.length) {
      return {
        segment: node.segment,
        fullPath: node.fullPath,
        count: node.count,
        children: keptChildren,
      };
    }
    return null;
  }

  return nodes.map(walk).filter(Boolean);
}

/** @param {TagTreeNode[]} nodes @returns {number} */
export function countTagTreeLeaves(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.count > 0) n += 1;
    n += countTagTreeLeaves(node.children);
  }
  return n;
}
