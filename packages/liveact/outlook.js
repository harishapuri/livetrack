const { loadSettings, saveSettings } = require("./settings");
const outlookDefaults = require("./outlook-defaults");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = ["User.Read", "Calendars.Read", "offline_access"].join(" ");
const TOKEN_SKEW_MS = 5 * 60 * 1000;
/** Shared Microsoft personal-accounts (MSA) tenant — same for every @outlook.com user */
const CONSUMERS_TENANT_GUID = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";
const DEFAULT_TENANT = outlookDefaults.outlookTenantId || "organizations";
const DEFAULT_CLIENT = outlookDefaults.outlookClientId || "";

let devicePoll = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize Azure authority tenant for device-code login.
 * Personal Outlook → consumers; work multi-tenant → organizations; company → GUID.
 */
function normalizeTenant(value) {
  let raw = String(value || "").trim();
  if (!raw) return DEFAULT_TENANT;
  // Repair accidental glue: "<guid>consumers" (common paste mistake)
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\s*consumers?$/i.test(
      raw,
    )
  ) {
    return "consumers";
  }
  const lower = raw.toLowerCase();
  if (lower === CONSUMERS_TENANT_GUID || lower === "consumers" || lower === "consumer") {
    return "consumers";
  }
  if (lower === "organizations" || lower === "organisation" || lower === "organization") {
    return "organizations";
  }
  if (lower === "common") return "common";
  return raw;
}

function resolveClientId(value) {
  const id = String(value || "").trim();
  // Migrate retired single-tenant LIVETRACK app → LiveTrack outlook
  if (!id || id === "ced2296f-c311-43d2-9568-0e48d555665e") {
    return DEFAULT_CLIENT;
  }
  return id;
}

function authorizeBase(tenant) {
  return `https://login.microsoftonline.com/${encodeURIComponent(normalizeTenant(tenant))}/oauth2/v2.0`;
}

function friendlyAuthError(raw, { tenantId } = {}) {
  const text = String(raw || "").trim();
  if (!text) return "Outlook login failed.";
  const tenant = normalizeTenant(tenantId);
  if (/AADSTS50059|No tenant-identifying information/i.test(text)) {
    return (
      `${text} — Your Azure app is still “My organization only”, so Tenant "common" cannot work. ` +
      "Fix: create a NEW app registration with account type “Accounts in any org directory and personal Microsoft accounts”, " +
      "or edit Manifest: signInAudience=AzureADandPersonalMicrosoftAccount and accessTokenAcceptedVersion=2. " +
      "Then paste the new Client ID in Settings → Advanced."
    );
  }
  if (
    /unauthorized_client|public client|device.?code|AADSTS7000218|AADSTS700016/i.test(text) ||
    (/AADSTS65001/i.test(text) && /public/i.test(text))
  ) {
    return `${text} — In Azure: Authentication → Allow public client flows = Yes, then Save.`;
  }
  if (/AADSTS700016|application.*(not found|not found in)/i.test(text)) {
    return `${text} — Check the Application (client) ID, and that the app allows this account type.`;
  }
  if (
    /AADSTS50020|AADSTS50126|does not exist in tenant|identity provider 'live\.com'/i.test(text) ||
    (/live\.com|msa/i.test(text) && /tenant|organization/i.test(text))
  ) {
    return `${text} — For personal Outlook.com use Tenant ID "consumers" (not a work tenant). For work accounts use your company Tenant ID or "organizations".`;
  }
  if (/AADSTS65001|consent_required|AADSTS50076|AADSTS50079/i.test(text)) {
    return `${text} — Sign in again and accept permissions. App needs User.Read + Calendars.Read (delegated).`;
  }
  if (tenant === "organizations" && /invalid_grant|interaction_required|access_denied/i.test(text)) {
    return `${text} — If this is a personal @outlook.com account, set Tenant ID to "consumers" and try again.`;
  }
  return text;
}

function getOutlookConfig() {
  const s = loadSettings();
  let tenantId = normalizeTenant(s.outlookTenantId || DEFAULT_TENANT);
  const clientId = resolveClientId(s.outlookClientId);
  // Migrate old single-tenant guest login → common (personal mailbox)
  if (
    clientId === DEFAULT_CLIENT &&
    (tenantId === "c3ad2d99-7a82-45ae-a789-70e20d9ab9eb" || tenantId === "organizations")
  ) {
    tenantId = DEFAULT_TENANT;
  }
  return {
    tenantId,
    clientId,
    accessToken: String(s.outlookAccessToken || "").trim(),
    refreshToken: String(s.outlookRefreshToken || "").trim(),
    tokenExpiresAt: Number(s.outlookTokenExpiresAt) || 0,
    accountName: String(s.outlookAccountName || "").trim(),
    accountGivenName: String(s.outlookAccountGivenName || "").trim(),
  };
}

function isConfigured() {
  const c = getOutlookConfig();
  return Boolean(c.clientId);
}

function isConnected() {
  const c = getOutlookConfig();
  return Boolean(c.clientId && (c.accessToken || c.refreshToken));
}

function persistTokens(partial) {
  return saveSettings(partial);
}

function parseGraphDateTime(slot) {
  const dt = String(slot?.dateTime || "").trim();
  if (!dt) return null;
  if (/Z|[+-]\d{2}:\d{2}$/.test(dt)) {
    const parsed = new Date(dt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(`${dt}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function attendeeName(entry) {
  const email = entry?.emailAddress || {};
  return String(email.name || email.address || "").trim();
}

const AGENDA_MAX_CHARS = 1200;

/** Teams / meetup join URLs commonly embedded in invite HTML when Graph omits onlineMeeting.joinUrl */
const TEAMS_JOIN_URL_RE =
  /https?:\/\/(?:teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"'\\]+/gi;
const MEETUP_JOIN_RE = /https?:\/\/[^\s<>"'\\]*meetup-join[^\s<>"'\\]*/gi;
const HTTP_URL_RE = /https?:\/\/[^\s<>"']+/gi;

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function sanitizeHttpUrl(raw) {
  let url = decodeBasicEntities(String(raw || "").trim());
  // Trim common trailing punctuation from plain-text / HTML leftovers
  url = url.replace(/[),.;:!?\]]+$/g, "");
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isTeamsJoinUrl(url) {
  const u = String(url || "").toLowerCase();
  return (
    /teams\.microsoft\.com|teams\.live\.com/i.test(u) ||
    /meetup-join/i.test(u)
  );
}

function collectUrlsFromText(text, into = []) {
  const src = String(text || "");
  if (!src) return into;
  for (const re of [TEAMS_JOIN_URL_RE, MEETUP_JOIN_RE, HTTP_URL_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(src))) {
      const cleaned = sanitizeHttpUrl(match[0]);
      if (cleaned) into.push(cleaned);
    }
  }
  return into;
}

function collectUrlsFromHtml(html, into = []) {
  const src = String(html || "");
  if (!src) return into;
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRe.exec(src))) {
    const cleaned = sanitizeHttpUrl(match[1]);
    if (cleaned) into.push(cleaned);
  }
  collectUrlsFromText(decodeBasicEntities(src.replace(/<[^>]+>/g, " ")), into);
  return into;
}

/**
 * Prefer Graph onlineMeeting.joinUrl / onlineMeetingUrl; fall back to Teams links in body HTML/preview.
 */
function extractTeamsJoinUrl(raw) {
  const direct = sanitizeHttpUrl(
    raw?.onlineMeeting?.joinUrl || raw?.onlineMeetingUrl || "",
  );
  if (direct && isTeamsJoinUrl(direct)) return direct;
  if (direct) return direct;

  const candidates = [];
  const bodyContent = String(raw?.body?.content || "");
  if (bodyContent) collectUrlsFromHtml(bodyContent, candidates);
  collectUrlsFromText(raw?.bodyPreview || "", candidates);
  collectUrlsFromText(raw?.location?.displayName || "", candidates);

  const teams = candidates.find((u) => isTeamsJoinUrl(u));
  return teams || "";
}

function extractBodyHyperlinks(raw, { joinUrl = "" } = {}) {
  const seen = new Set();
  const links = [];
  const push = (url, label) => {
    const cleaned = sanitizeHttpUrl(url);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    links.push({ url: cleaned, label: String(label || cleaned).trim() || cleaned });
  };
  if (joinUrl) push(joinUrl, "Join Teams");
  const bodyContent = String(raw?.body?.content || "");
  if (bodyContent) {
    const hrefRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = hrefRe.exec(bodyContent))) {
      const url = sanitizeHttpUrl(match[1]);
      if (!url) continue;
      const label = stripHtmlToText(match[2]).replace(/\s+/g, " ").trim() || url;
      push(url, label.slice(0, 80));
    }
    collectUrlsFromHtml(bodyContent, []).forEach((url) => push(url, url));
  }
  collectUrlsFromText(raw?.bodyPreview || "", []).forEach((url) => push(url, url));
  return links.slice(0, 12);
}

function stripHtmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    // Keep href targets so Teams / agenda links survive as plain URLs in agenda text
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const url = sanitizeHttpUrl(href);
      const label = String(inner || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (url && label && label !== url) return ` ${label} ${url} `;
      if (url) return ` ${url} `;
      return ` ${label} `;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function eventBodyText(raw) {
  const content = String(raw?.body?.content || "").trim();
  if (content) {
    const type = String(raw?.body?.contentType || "").toLowerCase();
    if (type === "html" || /<[a-z][\s\S]*>/i.test(content)) {
      const fromHtml = stripHtmlToText(content);
      if (fromHtml) return fromHtml;
    } else if (content) {
      return content;
    }
  }
  return String(raw?.bodyPreview || "").trim();
}

function mapGraphEvent(raw) {
  const start = parseGraphDateTime(raw?.start);
  const end = parseGraphDateTime(raw?.end);
  const attendees = Array.isArray(raw?.attendees)
    ? raw.attendees.map(attendeeName).filter(Boolean).slice(0, 24)
    : [];
  const joinUrl = extractTeamsJoinUrl(raw);
  const response = String(raw?.responseStatus?.response || "").trim().toLowerCase();
  const bodyPreview = String(raw?.bodyPreview || "").trim();
  let agenda = eventBodyText(raw);
  if (agenda.length > AGENDA_MAX_CHARS) {
    agenda = `${agenda.slice(0, AGENDA_MAX_CHARS).trim()}…`;
  }
  const hyperlinks = extractBodyHyperlinks(raw, { joinUrl });
  return {
    id: String(raw?.id || "").trim(),
    subject: String(raw?.subject || "(No subject)").trim() || "(No subject)",
    start: start ? start.toISOString() : "",
    end: end ? end.toISOString() : "",
    startMs: start ? start.getTime() : 0,
    endMs: end ? end.getTime() : 0,
    organizer: attendeeName({ emailAddress: raw?.organizer?.emailAddress }) || "",
    attendees,
    location: String(raw?.location?.displayName || "").trim(),
    isOnlineMeeting: Boolean(raw?.isOnlineMeeting || joinUrl),
    joinUrl,
    teamsUrl: joinUrl,
    onlineMeetingUrl: joinUrl,
    webLink: String(raw?.webLink || "").trim(),
    isCancelled: Boolean(raw?.isCancelled),
    isAllDay: Boolean(raw?.isAllDay),
    responseStatus: response || "none",
    importance: String(raw?.importance || "").trim().toLowerCase(),
    showAs: String(raw?.showAs || "").trim().toLowerCase(),
    bodyPreview,
    bodyText: agenda,
    agenda,
    hyperlinks,
  };
}

function localDayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function tokenRequest(tenant, body) {
  const res = await fetch(`${authorizeBase(tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      friendlyAuthError(data.error_description || data.error || `Token error (${res.status})`, {
        tenantId: tenant,
      }),
    );
    err.code = data.error || "";
    err.data = data;
    throw err;
  }
  return data;
}

async function startDeviceCode({ tenantId, clientId } = {}) {
  const tenant = normalizeTenant(tenantId || DEFAULT_TENANT);
  const id = resolveClientId(clientId);
  if (!id) return { ok: false, error: "Add the Azure application (client) ID in Settings." };
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return {
      ok: false,
      error:
        "Client ID looks invalid. Paste the Application (client) ID from Azure App registration → Overview.",
    };
  }
  // Built-in LIVETRACK app should use /common so personal Outlook calendars work.
  // Single-tenant "My organization only" guest logins get User.Read but no mailbox.
  const authorityTenant =
    id === DEFAULT_CLIENT && (tenant === DEFAULT_TENANT || !tenant || tenant === "organizations")
      ? DEFAULT_TENANT
      : id === DEFAULT_CLIENT && tenant === CONSUMERS_TENANT_GUID
        ? "consumers"
        : tenant;
  const res = await fetch(`${authorizeBase(authorityTenant)}/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      scope: SCOPES,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: friendlyAuthError(
        data.error_description || data.error || `Device login failed (${res.status})`,
        { tenantId: authorityTenant },
      ),
    };
  }
  return {
    ok: true,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || "https://microsoft.com/devicelogin",
    verificationUriComplete: data.verification_uri_complete || "",
    message: data.message || `Go to ${data.verification_uri} and enter ${data.user_code}`,
    interval: Math.max(3, Number(data.interval) || 5),
    expiresIn: Number(data.expires_in) || 900,
    tenantId: authorityTenant,
    clientId: id,
  };
}

function cancelDeviceLogin() {
  if (devicePoll?.abort) devicePoll.abort();
  devicePoll = null;
}

async function pollDeviceCode(started) {
  if (!started?.ok || !started.deviceCode) {
    return { ok: false, error: "Device login was not started." };
  }
  cancelDeviceLogin();
  const ctrl = { aborted: false, abort() { this.aborted = true; } };
  devicePoll = ctrl;
  const deadline = Date.now() + Math.max(60, Number(started.expiresIn) || 900) * 1000;
  let interval = Math.max(3, Number(started.interval) || 5);
  try {
    while (!ctrl.aborted && Date.now() < deadline) {
      await sleep(interval * 1000);
      if (ctrl.aborted) return { ok: false, cancelled: true, error: "Outlook login cancelled." };
      try {
        const data = await tokenRequest(started.tenantId, {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: started.clientId,
          device_code: started.deviceCode,
        });
        return applyTokenResponse(data, started);
      } catch (err) {
        const code = err?.code || "";
        if (code === "authorization_pending") continue;
        if (code === "slow_down") {
          interval += 5;
          continue;
        }
        if (code === "expired_token" || code === "authorization_declined") {
          return {
            ok: false,
            error: friendlyAuthError(err.message || code, { tenantId: started.tenantId }),
          };
        }
        return {
          ok: false,
          error: friendlyAuthError(err.message || "Outlook login failed.", {
            tenantId: started.tenantId,
          }),
        };
      }
    }
    if (ctrl.aborted) return { ok: false, cancelled: true, error: "Outlook login cancelled." };
    return { ok: false, error: "Outlook login timed out. Try Connect Outlook again." };
  } finally {
    if (devicePoll === ctrl) devicePoll = null;
  }
}

function applyTokenResponse(data, started = {}) {
  const expiresIn = Number(data.expires_in) || 3600;
  const next = {
    outlookTenantId: started.tenantId || getOutlookConfig().tenantId,
    outlookClientId: started.clientId || getOutlookConfig().clientId,
    outlookAccessToken: String(data.access_token || ""),
    outlookRefreshToken:
      String(data.refresh_token || "").trim() || getOutlookConfig().refreshToken,
    outlookTokenExpiresAt: Date.now() + expiresIn * 1000,
  };
  persistTokens(next);
  return {
    ok: true,
    expiresAt: next.outlookTokenExpiresAt,
  };
}

async function refreshAccessToken() {
  const c = getOutlookConfig();
  if (!c.clientId || !c.refreshToken) {
    return { ok: false, error: "Outlook is not connected." };
  }
  try {
    const data = await tokenRequest(c.tenantId, {
      grant_type: "refresh_token",
      client_id: c.clientId,
      refresh_token: c.refreshToken,
      scope: SCOPES,
    });
    return applyTokenResponse(data, { tenantId: c.tenantId, clientId: c.clientId });
  } catch (err) {
    return {
      ok: false,
      error: friendlyAuthError(err?.message || "Could not refresh Outlook login.", {
        tenantId: c.tenantId,
      }),
    };
  }
}

async function getAccessToken() {
  const c = getOutlookConfig();
  if (c.accessToken && c.tokenExpiresAt - TOKEN_SKEW_MS > Date.now()) {
    return { ok: true, token: c.accessToken };
  }
  if (!c.refreshToken) {
    if (c.accessToken) return { ok: true, token: c.accessToken };
    return { ok: false, error: "Connect Outlook in Settings." };
  }
  const refreshed = await refreshAccessToken();
  if (!refreshed.ok) return refreshed;
  return { ok: true, token: getOutlookConfig().accessToken };
}

async function graphGet(pathname, { search, retried = false } = {}) {
  const auth = await getAccessToken();
  if (!auth.ok) return auth;
  const url = new URL(pathname.startsWith("http") ? pathname : `${GRAPH_BASE}${pathname}`);
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) {
    const again = await refreshAccessToken();
    if (!again.ok) return { ok: false, error: again.error || "Outlook login expired." };
    return graphGet(pathname, { search, retried: true });
  }
  if (!res.ok) {
    const graphMsg =
      data?.error?.message ||
      data?.error_description ||
      data?.error?.code ||
      "";
    const detail = graphMsg
      ? `Graph ${res.status}: ${graphMsg}`
      : `Graph ${res.status}`;
    let error = friendlyAuthError(detail, {
      tenantId: getOutlookConfig().tenantId,
    });
    if (
      res.status === 401 ||
      res.status === 403 ||
      /ErrorAccessDenied|MailboxNotEnabled|ErrorItemNotFound/i.test(detail)
    ) {
      if (/calendar|mailbox|event/i.test(pathname) || pathname.includes("calendar")) {
        error =
          "Outlook connected, but this sign-in has no calendar mailbox (common for Azure AD guest accounts). " +
          "In Azure → LIVETRACK app → Authentication: set Supported account types to include personal Microsoft accounts, " +
          "Allow public client flows = Yes. In LiveTrack Settings use Tenant common, Disconnect, then Connect again with the Outlook.com / Microsoft account that has your meetings.";
      }
    }
    return { ok: false, error, status: res.status };
  }
  return { ok: true, data };
}

async function fetchMe() {
  const res = await graphGet("/me", {
    search: { $select: "displayName,givenName,mail,userPrincipalName" },
  });
  if (!res.ok) return res;
  const me = res.data || {};
  const accountName = String(me.displayName || me.mail || me.userPrincipalName || "").trim();
  const givenName = String(me.givenName || "").trim();
  persistTokens({
    outlookAccountName: accountName,
    outlookAccountGivenName: givenName,
  });
  return { ok: true, accountName, givenName, me };
}

async function fetchCalendarView({ now = new Date(), days = 14 } = {}) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, Number(days) || 14));
  end.setHours(23, 59, 59, 999);
  const events = [];
  let next = "/me/calendarView";
  let search = {
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $select:
      "id,subject,start,end,organizer,attendees,isOnlineMeeting,onlineMeeting,onlineMeetingUrl,location,webLink,isCancelled,isAllDay,responseStatus,importance,showAs,bodyPreview,body",
    $orderby: "start/dateTime",
    $top: "100",
  };
  let first = await graphGet(next, { search });
  if (!first.ok && /order/i.test(String(first.error || ""))) {
    delete search.$orderby;
    first = await graphGet(next, { search });
  }
  if (!first.ok && (first.status === 401 || first.status === 403)) {
    return first;
  }
  let pageRes = first;
  for (let page = 0; page < 10; page += 1) {
    const res = page === 0 ? pageRes : await graphGet(next);
    if (!res.ok) return res;
    const rows = Array.isArray(res.data?.value) ? res.data.value : [];
    for (const raw of rows) {
      if (raw?.isCancelled) continue;
      // Keep invitations: accepted, tentative, notResponded, organizer; skip declined
      const response = String(raw?.responseStatus?.response || "").toLowerCase();
      if (response === "declined") continue;
      const mapped = mapGraphEvent(raw);
      if (mapped.id) events.push(mapped);
    }
    next = String(res.data?.["@odata.nextLink"] || "").trim();
    if (!next) break;
    search = undefined;
  }
  return { ok: true, events, start: start.toISOString(), end: end.toISOString() };
}

function disconnect() {
  cancelDeviceLogin();
  persistTokens({
    outlookAccessToken: "",
    outlookRefreshToken: "",
    outlookTokenExpiresAt: 0,
    outlookAccountName: "",
    outlookAccountGivenName: "",
  });
  return { ok: true };
}

function publicStatus() {
  const c = getOutlookConfig();
  return {
    configured: Boolean(c.clientId),
    connected: isConnected(),
    tenantId: c.tenantId,
    clientId: c.clientId,
    accountName: c.accountName,
    accountGivenName: c.accountGivenName,
  };
}

module.exports = {
  SCOPES,
  CONSUMERS_TENANT_GUID,
  normalizeTenant,
  friendlyAuthError,
  getOutlookConfig,
  isConfigured,
  isConnected,
  publicStatus,
  startDeviceCode,
  pollDeviceCode,
  cancelDeviceLogin,
  refreshAccessToken,
  getAccessToken,
  fetchMe,
  fetchCalendarView,
  mapGraphEvent,
  extractTeamsJoinUrl,
  parseGraphDateTime,
  localDayBounds,
  disconnect,
  persistTokens,
};
