const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeJqlPhrase,
  parsePastWorkSearchJson,
  parsePastWorkRankJson,
  parsePastWorkTicketSummaryJson,
  applyTicketSummariesToIssue,
  applyRankToPastWorkRows,
} = require("./past-work-ai");
const { applyPastWorkTextQuery, ensurePastWorkJql } = require("./jira");

test("AI JQL phrase strips operators and quotes", () => {
  assert.equal(sanitizeJqlPhrase('SSO"; DROP'), "SSO DROP");
  assert.equal(sanitizeJqlPhrase("assignee = currentUser()"), "assignee currentUser");
  assert.equal(sanitizeJqlPhrase(""), "");
});

test("past work text query keeps assignee without hiding current-sprint peers", () => {
  const jql = applyPastWorkTextQuery(
    "assignee = currentUser() ORDER BY updated ASC",
    "SSO timeout"
  );
  assert.match(jql, /assignee = currentUser\(\)/);
  assert.doesNotMatch(jql, /sprint not in openSprints\(\)/);
  assert.match(jql, /summary ~ "SSO timeout"/);
  assert.match(jql, /ORDER BY updated DESC/);
  assert.equal(applyPastWorkTextQuery(ensurePastWorkJql(""), "   "), ensurePastWorkJql(""));
});

test("search JSON ignores raw JQL from the model", () => {
  const parsed = parsePastWorkSearchJson(
    '{"textQuery":"SSO login timeout AND project = HACK","keywords":["SSO","timeout"]}'
  );
  assert.equal(parsed.textQuery, "SSO login timeout AND project HACK");
  assert.ok(!/currentUser/.test(parsed.textQuery));
});

test("rank JSON drops invented keys", () => {
  const parsed = parsePastWorkRankJson(
    '{"related":[{"key":"MBA-3","keep":true,"score":90},{"key":"FAKE-9","keep":true,"score":99}]}',
    [{ key: "MBA-3" }, { key: "RITM0203030" }]
  );
  assert.deepEqual(
    parsed.related.map((row) => row.key),
    ["MBA-3"]
  );
  assert.equal(parsed.related[0].keep, true);
});

test("rank filter keeps the current ticket and AI-approved related ids", () => {
  const rows = [
    {
      jira_key: "MBA-5",
      summary: "SSO timeout",
      related_tickets: "RITM0203030, CHG000111",
      relatedTickets: ["RITM0203030", "CHG000111"],
      matchScore: 100,
    },
    {
      jira_key: "MBA-2",
      summary: "Unrelated txn",
      related_tickets: "",
      relatedTickets: [],
      matchScore: 60,
    },
    {
      jira_key: "MBA-3",
      summary: "SSO login",
      related_tickets: "",
      relatedTickets: [],
      matchScore: 80,
    },
  ];
  const ranked = applyRankToPastWorkRows(
    rows,
    {
      related: [
        { key: "MBA-5", keep: true, score: 100 },
        { key: "MBA-3", keep: true, score: 88 },
        { key: "RITM0203030", keep: true, score: 92 },
        { key: "CHG000111", keep: false, score: 10 },
        { key: "MBA-2", keep: false, score: 5 },
      ],
    },
    { issueKey: "MBA-5" }
  );
  assert.deepEqual(
    ranked.map((row) => row.jira_key).sort(),
    ["MBA-3", "MBA-5"]
  );
  assert.deepEqual(ranked.find((row) => row.jira_key === "MBA-5").relatedTickets, ["RITM0203030"]);
});

test("empty AI rank leaves catalog rows unchanged", () => {
  const rows = [{ jira_key: "MBA-5", related_tickets: "RITM1", relatedTickets: ["RITM1"] }];
  assert.equal(applyRankToPastWorkRows(rows, { related: [] }, { issueKey: "MBA-5" }), rows);
});

test("ticket summary JSON keeps only listed comment keys", () => {
  const parsed = parsePastWorkTicketSummaryJson(
    '{"tickets":[{"key":"RITM0203030","summary":"Reset MFA"},{"key":"FAKE-1","summary":"nope"}]}',
    ["RITM0203030", "CHG0404004", "SCTASK9203003"]
  );
  assert.deepEqual(
    parsed.tickets.map((row) => row.key),
    ["RITM0203030"]
  );
});

test("AI summaries attach per comment ticket without overwriting Jira summary", () => {
  const issue = {
    key: "MBA-5",
    summary: "Fix SSO timeout",
    relatedTickets: [
      { key: "RITM0203030", summary: "" },
      { key: "CHG0404004", summary: "Keep this" },
    ],
  };
  const next = applyTicketSummariesToIssue(issue, [
    { key: "RITM0203030", summary: "Password reset for SSO" },
    { key: "CHG0404004", summary: "Should not replace" },
    { key: "RITM100101002", summary: "invented" },
  ]);
  assert.equal(next.summary, "Fix SSO timeout");
  assert.equal(next.relatedTickets[0].summary, "Password reset for SSO");
  assert.equal(next.relatedTickets[1].summary, "Keep this");
  assert.equal(next.relatedTickets.length, 2);
});
