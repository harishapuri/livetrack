const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  issueToRow,
  rowToIssue,
  formatPastWorkListLine,
  upsertPastWorkRows,
  findSimilarPastWorkRows,
  formatStoredPastWorkBlock,
  persistPastWorkIssues,
  loadPastWorkRows,
} = require("./past-work-store");
const workbookStore = require("./workbook");

function sampleIssue() {
  return {
    key: "MBA-5",
    summary: "Fix SSO timeout on login",
    description: "Users cannot complete SSO after idle timeout.",
    commentText:
      "Please close RITM0203030 after the MFA reset for SSO.\nWeekend window is CHG000111.",
    status: "In Progress",
    issueType: "Story",
    url: "https://jira.example/browse/MBA-5",
    relatedTickets: [
      { key: "RITM0203030", kind: "request", autoQuery: "number=RITM0203030", source: "comment" },
      { key: "CHG000111", kind: "change", autoQuery: "number=CHG000111", source: "comment" },
    ],
  };
}

test("formatPastWorkListLine is key:Jira description(ops tickets)", () => {
  const issue = rowToIssue(issueToRow(sampleIssue()));
  assert.equal(
    formatPastWorkListLine(issue),
    "MBA-5:Users cannot complete SSO after idle timeout.(RITM0203030, CHG000111)"
  );
  assert.doesNotMatch(formatPastWorkListLine(issue), /Please close/i);
  assert.doesNotMatch(formatPastWorkListLine(issue), /RITM0203030 after/);
});

test("empty description does not fall back to comments or summary", () => {
  const issue = rowToIssue({
    jira_key: "MBA-3",
    summary: "(Sample) Implement Biometric Login",
    description: "",
    related_tickets: "RITM0203030, CHG0404004, MBA-5",
    related_notes:
      "From comments:\nPlease close RITM0203030.\nTicket numbers:\nRITM0203030 — request — number=RITM0203030; CHG0404004 — change — number=CHG0404004",
  });
  assert.equal(issue.description, "");
  assert.match(issue.commentSource, /Please close/);
  assert.equal(formatPastWorkListLine(issue), "MBA-3:(RITM0203030, CHG0404004)");
  assert.equal(
    formatPastWorkListLine({
      key: "MBA-3",
      description: "",
      commentSource: "Please close RITM0203030",
      relatedTickets: [],
    }),
    "MBA-3:"
  );
});

test("MBA-5 list line uses biometric description and lists ops tickets once", () => {
  const issue = rowToIssue({
    jira_key: "MBA-5",
    summary: "(Sample) Implement Biometric Login in SAMPLE",
    description: "Allow users to log in using fingerprint or facial recognition.",
    related_tickets: "RITM0203030, CHG0404004, SCTASK9203003, RITM29292002020, RITM100101002",
    related_notes:
      "From comments:\nPlease close RITM0203030 after the MFA reset. Weekend window is CHG0404004. Catalog work SCTASK9203003. Also RITM29292002020 and RITM100101002.\nTicket numbers:\nRITM0203030 — request — number=RITM0203030; CHG0404004 — change — number=CHG0404004; SCTASK9203003 — catalog task — number=SCTASK9203003; RITM29292002020 — request — number=RITM29292002020; RITM100101002 — request — number=RITM100101002",
  });
  assert.equal(
    issue.description,
    "Allow users to log in using fingerprint or facial recognition."
  );
  assert.equal(
    formatPastWorkListLine(issue),
    "MBA-5:Allow users to log in using fingerprint or facial recognition.(RITM0203030, CHG0404004, SCTASK9203003, RITM29292002020, RITM100101002)"
  );
  assert.doesNotMatch(formatPastWorkListLine(issue), /Please close/);
  assert.doesNotMatch(formatPastWorkListLine(issue), /transaction history/i);
  assert.doesNotMatch(formatPastWorkListLine(issue), /Completed the task/i);
  const once = formatPastWorkListLine(issue).match(/RITM0203030/g) || [];
  assert.equal(once.length, 1);
});

test("rowToIssue restores Jira summary, description, and comment ticket numbers", () => {
  const issue = rowToIssue(issueToRow(sampleIssue()));
  assert.equal(issue.key, "MBA-5");
  assert.equal(issue.summary, "Fix SSO timeout on login");
  assert.match(issue.description, /SSO after idle/);
  assert.doesNotMatch(issue.description, /Comment tickets:/);
  assert.match(issue.commentSource, /MFA reset/);
  assert.match(issue.commentSource, /RITM0203030/);
  assert.doesNotMatch(issue.commentSource, /transaction history/i);
  assert.deepEqual(
    issue.relatedTickets.map((row) => [row.key, row.summary, row.kind, row.autoQuery]),
    [
      ["RITM0203030", "", "request", "number=RITM0203030"],
      ["CHG000111", "", "change", "number=CHG000111"],
    ]
  );
});

test("related_notes persist comment source plus kind and auto query, not fake summaries", () => {
  const row = issueToRow({
    ...sampleIssue(),
    relatedTickets: [
      {
        key: "RITM0203030",
        summary: "Completed the task.",
        kind: "request",
        autoQuery: "number=RITM0203030",
        source: "comment",
      },
      {
        key: "CHG0404004",
        summary: "Weekend window",
        kind: "change",
        autoQuery: "number=CHG0404004",
        source: "comment",
      },
    ],
  });
  assert.match(row.related_notes, /From comments:/);
  assert.match(row.related_notes, /RITM0203030 after the MFA reset/);
  assert.match(row.related_notes, /RITM0203030 — request — number=RITM0203030/);
  assert.match(row.related_notes, /CHG0404004 — change — number=CHG0404004/);
  assert.doesNotMatch(row.related_notes, /Completed the task/);
  const restored = rowToIssue(row);
  assert.equal(restored.relatedTickets[0].kind, "request");
  assert.equal(restored.relatedTickets[0].summary, "");
  assert.equal(restored.relatedTickets[0].autoQuery, "number=RITM0203030");
  assert.equal(restored.relatedTickets[1].kind, "change");
  assert.equal(restored.relatedTickets[1].autoQuery, "number=CHG0404004");
  assert.match(restored.commentSource, /MFA reset/);
});

test("same-line Comment tickets leftover is stripped from stored description", () => {
  const row = issueToRow({
    ...sampleIssue(),
    description:
      "Allow users to log in using fingerprint or facial recognition. Comment tickets: CHG0404004, SCTASK9203003, RITM0203030, MBA-5",
  });
  assert.equal(
    row.description,
    "Allow users to log in using fingerprint or facial recognition."
  );
  assert.doesNotMatch(row.description, /Comment tickets:/);
  assert.doesNotMatch(row.description, /RITM0203030/);
  assert.doesNotMatch(row.description, /MBA-5/);
  const restored = rowToIssue(row);
  assert.equal(
    restored.description,
    "Allow users to log in using fingerprint or facial recognition."
  );
});

test("one row is jira key, description, and related ticket numbers with no dates", () => {
  const row = issueToRow(sampleIssue());
  assert.equal(row.jira_key, "MBA-5");
  assert.equal(row.summary, "Fix SSO timeout on login");
  assert.match(row.description, /SSO after idle/);
  assert.doesNotMatch(row.description, /Comment tickets:/);
  assert.doesNotMatch(row.description, /RITM0203030/);
  assert.equal(row.related_tickets, "RITM0203030, CHG000111");
  assert.match(row.related_notes, /RITM0203030/);
  assert.match(row.related_notes, /From comments:/);
  assert.equal(row.status, "In Progress");
  assert.equal(row.issue_type, "Story");
  assert.ok(row.url);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "fetched_at"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "updated_at"), false);
  assert.deepEqual(Object.keys(row).sort(), [...workbookStore.SHEETS.PastWork.columns].sort());
});

test("upsert unions related tickets and keeps previous when incoming related is empty", () => {
  const first = issueToRow(sampleIssue());
  const next = issueToRow({
    ...sampleIssue(),
    summary: "Fix SSO timeout on login (retry)",
    relatedTickets: [{ key: "RITM0204040", summary: "Second RITM" }],
  });
  const rows = upsertPastWorkRows([first], [next]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].related_tickets, /RITM0203030/);
  assert.match(rows[0].related_tickets, /RITM0204040/);
  assert.match(rows[0].summary, /retry/);

  const blank = issueToRow({
    ...sampleIssue(),
    relatedTickets: [],
    description: "",
  });
  const kept = upsertPastWorkRows(rows, [blank]);
  assert.match(kept[0].related_tickets, /RITM0203030/);
  assert.match(kept[0].related_tickets, /RITM0204040/);
  assert.match(kept[0].description, /SSO after idle/);
});

test("similar question or related ticket number finds the saved row", () => {
  const rows = [issueToRow(sampleIssue())];
  const byKey = findSimilarPastWorkRows(rows, { issueKey: "MBA-5" });
  assert.equal(byKey[0].jira_key, "MBA-5");
  assert.equal(byKey[0].matchScore, 100);

  const byRitm = findSimilarPastWorkRows(rows, { snippet: "please close RITM0203030" });
  assert.equal(byRitm[0].jira_key, "MBA-5");
  assert.ok(byRitm[0].matchScore >= 90);

  const byQuestion = findSimilarPastWorkRows(rows, {
    snippet: "How did we fix SSO timeout on login?",
    pageTitle: "SSO timeout",
  });
  assert.equal(byQuestion[0].jira_key, "MBA-5");
  assert.ok(byQuestion[0].matchScore > 0);
});

test("saved history block lists related tickets", () => {
  const hits = findSimilarPastWorkRows([issueToRow(sampleIssue())], { issueKey: "MBA-5" });
  const block = formatStoredPastWorkBlock(hits);
  assert.match(block, /MBA-5/);
  assert.match(block, /RITM0203030/);
  assert.match(block, /CHG000111/);
});

test("empty persist still creates the PastWork sheet", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pastwork-empty-"));
  await persistPastWorkIssues([], dir);
  const file = path.join(dir, workbookStore.WORKBOOK_NAME);
  assert.equal(fs.existsSync(file), true);
  const { PastWork } = await workbookStore.readTables(["PastWork"], dir);
  assert.deepEqual(PastWork, []);
  assert.equal(fs.existsSync(path.join(dir, "PastWork.csv")), true);
});

test("persist writes PastWork sheet and lookup reads it back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pastwork-"));
  const persist = await persistPastWorkIssues([sampleIssue(), { key: "", summary: "skip" }], dir);
  assert.equal(persist.saved, 1);
  assert.equal(fs.existsSync(path.join(dir, "PastWork.csv")), true);
  const csv = fs.readFileSync(path.join(dir, "PastWork.csv"), "utf8");
  assert.match(csv, /MBA-5/);
  assert.match(csv, /RITM0203030/);
  const loaded = await loadPastWorkRows(dir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].jira_key, "MBA-5");
  assert.equal(loaded[0].related_tickets, "RITM0203030, CHG000111");
  assert.equal(loaded[0].fetched_at, undefined);
  const spec = workbookStore.SHEETS.PastWork;
  assert.deepEqual(spec.columns.includes("fetched_at"), false);
  assert.deepEqual(spec.columns.includes("updated_at"), false);
  const { PastWork } = await workbookStore.readTables(["PastWork"], dir);
  assert.equal(PastWork[0].jira_key, "MBA-5");
});
