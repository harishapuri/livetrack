/**
 * Knowledge Graph — nodes and edges stored in livetrack.xlsx (KgNodes / KgEdges).
 */
const path = require("path");

function loadWorkbookStore() {
  const candidates = [
    path.join(__dirname, "..", "liveact", "workbook"),
    path.join(__dirname, "..", "app.asar", "workbook"),
  ];
  if (typeof process !== "undefined" && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "app.asar", "workbook"));
  }
  let lastErr;
  for (const id of candidates) {
    try {
      return require(id);
    } catch (err) {
      lastErr = err;
      if (err?.code !== "MODULE_NOT_FOUND") throw err;
    }
  }
  throw lastErr || new Error("Cannot find liveact workbook module");
}

const workbookStore = loadWorkbookStore();

function graphPath(projectRoot) {
  return workbookStore.workbookPath(projectRoot);
}

function emptyGraph() {
  return { version: 1, updatedAt: null, nodes: {}, edges: [] };
}

async function loadGraph(projectRoot) {
  const tables = await workbookStore.readTables(["KgNodes", "KgEdges", "Catalog"], projectRoot);
  const nodes = {};
  for (const row of tables.KgNodes || []) {
    if (!row.id) continue;
    const extra = workbookStore.parseJsonCell(row.payload_json);
    nodes[row.id] = {
      id: row.id,
      kind: row.kind,
      key: row.key,
      ...(extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {}),
    };
  }
  const edges = (tables.KgEdges || []).map((row) => {
    const extra = workbookStore.parseJsonCell(row.payload_json);
    return {
      from: row.from,
      type: row.type,
      to: row.to,
      ...(extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {}),
    };
  });
  const catalog = (tables.Catalog || []).find((r) => r.sheet === "KgNodes");
  return {
    version: 1,
    updatedAt: catalog?.updated_at || null,
    nodes,
    edges,
  };
}

async function saveGraph(projectRoot, graph) {
  graph.updatedAt = new Date().toISOString();
  const nodeRows = Object.values(graph.nodes || {}).map((n) => {
    const { id, kind, key, ...rest } = n;
    return {
      id: id || "",
      kind: kind || "",
      key: key || "",
      payload_json: workbookStore.jsonCell(rest),
    };
  });
  const edgeRows = (graph.edges || []).map((e) => {
    const { from, type, to, ...rest } = e;
    return {
      from: from || "",
      type: type || "",
      to: to || "",
      payload_json: workbookStore.jsonCell(rest),
    };
  });
  await workbookStore.replaceRows("KgNodes", nodeRows, projectRoot);
  await workbookStore.replaceRows("KgEdges", edgeRows, projectRoot);
  return graph;
}

function nodeId(kind, key) {
  return `${kind}:${key}`;
}

function upsertNode(graph, kind, key, data = {}) {
  const id = nodeId(kind, key);
  const existing = graph.nodes[id];
  graph.nodes[id] = {
    id,
    kind,
    key,
    ...existing,
    ...data,
    firstSeenAt: existing?.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  return graph.nodes[id];
}

function upsertEdge(graph, from, type, to, data = {}) {
  const existing = graph.edges.find((e) => e.from === from && e.to === to && e.type === type);
  if (existing) {
    Object.assign(existing, data, { lastSeenAt: new Date().toISOString() });
    return existing;
  }
  const edge = { from, type, to, ...data, createdAt: new Date().toISOString() };
  graph.edges.push(edge);
  return edge;
}

function neighborsOf(graph, id, type = null) {
  return graph.edges
    .filter((e) => e.from === id && (!type || e.type === type))
    .map((e) => ({ edge: e, node: graph.nodes[e.to] }))
    .filter((x) => x.node);
}

function summarize(graph) {
  const byKind = {};
  for (const node of Object.values(graph.nodes)) {
    byKind[node.kind] = (byKind[node.kind] || 0) + 1;
  }
  return {
    updatedAt: graph.updatedAt,
    nodeCount: Object.keys(graph.nodes).length,
    edgeCount: graph.edges.length,
    byKind,
  };
}

module.exports = {
  graphPath,
  emptyGraph,
  loadGraph,
  saveGraph,
  nodeId,
  upsertNode,
  upsertEdge,
  neighborsOf,
  summarize,
};
