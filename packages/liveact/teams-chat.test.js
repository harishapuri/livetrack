const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isTeamsAppWindowName,
  isTeamsOwnerName,
  pickBestTeamsWindow,
  conversationTitleFromWindowName,
  overlayBoundsFor,
  canShowTeamsChatOverlay,
} = require("./mom-teams");
const { polishTeamsChatDraft } = require("./openai-chat");
const { rowToRecord, recordToRow, sortRecords } = require("./teams-chat-store");
const { parseMomActionItems } = require("./actions-store");

test("Teams app window names include chat titles", () => {
  assert.equal(isTeamsAppWindowName("Harish | Microsoft Teams"), true);
  assert.equal(isTeamsAppWindowName("Microsoft Teams"), true);
  assert.equal(isTeamsAppWindowName("LiveTrack"), false);
  assert.equal(isTeamsAppWindowName("Google Chrome"), false);
});

test("new Teams process owners match, helpers do not", () => {
  assert.equal(isTeamsOwnerName("MSTeams"), true);
  assert.equal(isTeamsOwnerName("Microsoft Teams WebView"), true);
  assert.equal(isTeamsOwnerName("Microsoft Teams"), true);
  assert.equal(isTeamsOwnerName("Microsoft Teams WebView Helper"), false);
  assert.equal(isTeamsOwnerName("Cursor"), false);
});

test("pickBestTeamsWindow uses the large Teams frame, not chrome chips", () => {
  const best = pickBestTeamsWindow([
    { owner: "MSTeams", width: 80, height: 80, x: 0, y: 0 },
    { owner: "MSTeams", title: "Standup", width: 1200, height: 800, x: 40, y: 30 },
    { owner: "Cursor", width: 1400, height: 900, x: 0, y: 0 },
  ]);
  assert.equal(best.width, 1200);
  assert.equal(best.height, 800);
  assert.equal(best.title, "Standup");
});

test("conversation title strips Teams suffix", () => {
  assert.equal(
    conversationTitleFromWindowName("Standup | Microsoft Teams"),
    "Standup",
  );
  assert.equal(conversationTitleFromWindowName("Microsoft Teams"), "Teams");
  assert.equal(conversationTitleFromWindowName(""), "Teams");
});

test("polishTeamsChatDraft rejects empty draft", async () => {
  const res = await polishTeamsChatDraft({ draft: "   " });
  assert.equal(res.ok, false);
  assert.equal(res.error, "empty_draft");
});

test("TeamsChat row mapping and newest-first sort", () => {
  const rec = rowToRecord({
    id: "tch_1",
    ts: "2026-01-02T00:00:00.000Z",
    user: "harish",
    conversation: "Standup",
    original: "pls send cr",
    refined: "Please send the CR.",
    usedAi: "true",
  });
  assert.equal(rec.usedAi, true);
  const row = recordToRow(rec);
  assert.equal(row.usedAi, "true");
  const sorted = sortRecords([
    rec,
    { ...rec, id: "tch_0", ts: "2026-01-01T00:00:00.000Z" },
  ]);
  assert.equal(sorted[0].id, "tch_1");
});

test("AI star sits above the compose box, not over the typed sentence", () => {
  const teams = { x: 100, y: 40, width: 1000, height: 700 };
  const fallback = overlayBoundsFor(teams);
  assert.equal(fallback.width, 24);
  assert.equal(fallback.height, 24);
  assert.ok(fallback.x > 100 + 200, "star is inside the chat compose, not the gray rail");
  assert.ok(fallback.y + fallback.height <= 40 + 700 - 90, "star is above the typed line");

  const box = { x: 420, y: 680, width: 520, height: 48 };
  const above = overlayBoundsFor(teams, { width: 24, height: 24 }, box);
  assert.ok(above.x >= box.x && above.x < box.x + 80);
  assert.ok(above.y + above.height <= box.y, "star does not cover the sentence");
  assert.ok(above.y >= box.y - 40);
});

test("AI star shows on the Teams window, not a display-wide guess", () => {
  const teams = {
    ok: true,
    x: 100,
    y: 40,
    width: 1000,
    height: 700,
    frontmost: true,
    via: "cg",
  };
  assert.equal(canShowTeamsChatOverlay(teams), true);
  assert.equal(canShowTeamsChatOverlay({ ...teams, via: "display" }), false);
  assert.equal(canShowTeamsChatOverlay({ ...teams, frontmost: false }), false);
  assert.equal(canShowTeamsChatOverlay({ ...teams, ok: false }), false);
});

test("MOM action items still parse after tab merge", () => {
  const items = parseMomActionItems(
    "Meeting\nStandup\nAction items\nHarish — Send CR\nOpen questions\nNone stated\n",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].owner, "Harish");
  assert.equal(items[0].title, "Send CR");
});
