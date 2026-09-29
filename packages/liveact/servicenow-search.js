/**
 * Browser-only ServiceNow change-request search (no Table API).
 * Builds a classic list URL the logged-in tab can open.
 */

function looksLikeServiceNow(url, title = "") {
  const u = String(url || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  if (u.includes("service-now") || u.includes("servicenow")) return true;
  if (t.includes("servicenow")) return true;
  return /\/(nav_to\.do|change_request|incident\.do|now\/nav|textsearch\.do)/i.test(u);
}

function originFromUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function normalizeQuery(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}

function isChangeNumber(query) {
  const q = normalizeQuery(query).replace(/\s/g, "");
  return /^(chg)?\d{5,}$/i.test(q);
}

function changeNumberToken(query) {
  const q = normalizeQuery(query).replace(/\s/g, "").toUpperCase();
  if (/^\d{5,}$/.test(q)) return `CHG${q}`;
  return q;
}

/** Classic ServiceNow list query for a ticket number (RITM / CHG / SCTASK / INC). */
function snowNumberQuery(number) {
  const q = String(number || "").replace(/\s+/g, "").toUpperCase();
  if (!q) return "";
  return `number=${q}`;
}

/** One-line lookup for a bundle of ops ticket numbers. */
function snowNumberInQuery(numbers) {
  const list = [];
  const seen = new Set();
  for (const value of Array.isArray(numbers) ? numbers : [numbers]) {
    const q = String(value || "").replace(/\s+/g, "").toUpperCase();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    list.push(q);
  }
  if (!list.length) return "";
  if (list.length === 1) return snowNumberQuery(list[0]);
  const inQuery = `numberIN${list.join(",")}`;
  const orQuery = list.map((item) => snowNumberQuery(item)).join("^OR");
  return inQuery.length <= orQuery.length ? inQuery : orQuery;
}

function changeRequestSearchUrl(pageUrl, query) {
  const origin = originFromUrl(pageUrl);
  const q = normalizeQuery(query);
  if (!origin || !q) return "";
  let encodedQuery;
  if (isChangeNumber(q)) {
    const number = changeNumberToken(q);
    encodedQuery = `number=${encodeURIComponent(number)}^ORnumberLIKE${encodeURIComponent(number)}`;
  } else {
    const like = encodeURIComponent(q);
    encodedQuery = `numberLIKE${like}^ORshort_descriptionLIKE${like}^ORdescriptionLIKE${like}`;
  }
  return `${origin}/change_request_list.do?sysparm_query=${encodedQuery}&sysparm_first_row=1&sysparm_view=`;
}

module.exports = {
  looksLikeServiceNow,
  originFromUrl,
  normalizeQuery,
  isChangeNumber,
  changeNumberToken,
  snowNumberQuery,
  snowNumberInQuery,
  changeRequestSearchUrl,
};
