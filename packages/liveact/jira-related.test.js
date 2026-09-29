const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTicketRefs,
  extractTicketDescription,
  commentSourceForTickets,
  enrichRelatedTicketsFromComments,
  bundledParentDescription,
  ticketKindLabel,
  ticketLookupQuery,
  ensureOpenSprintJql,
  ensurePastWorkJql,
  filterPastWorkIssues,
  isPastWorkDoneIssue,
  issueInOpenSprint,
  mergeRelatedTickets,
  storiesAreSimilar,
  storiesAreRelated,
  similarRelatedFromIssues,
  similarSearchPhrases,
  similarSearchTokenGroups,
  distinctiveSimilarTokens,
  buildSimilarIssueJql,
  findSimilarPastIssues,
  pinSimilarSearchHits,
  pastWorkFoldKeys,
  pastWorkFoldHtml,
  collectFollowJiraKeys,
  selectRelatedTickets,
  filterRelatedTickets,
  finalizePastWorkRelated,
  mergeScrapedPastWork,
  jiraAdfToText,
  htmlToPlain,
} = require("./jira");

test("scrapes RITM, CR, INC, CHG, and Jira keys from story text", () => {
  const refs = extractTicketRefs(
    "Fix SSO timeout. RITM0012345 and CR-88 plus INC999001. See MBA-12 and CHG000111.",
    { excludeKey: "MBA-99" }
  );
  const keys = refs.map((row) => row.key).sort();
  assert.deepEqual(keys, ["CHG000111", "CR88", "INC999001", "MBA-12", "RITM0012345"]);
});

test("normalizes CHG-########, spaced CHG, CRQ, and change-request phrases", () => {
  const refs = extractTicketRefs(
    "CHG-123 linked to CHG 000111 and CRQ 00088. Change request 0040001.",
    { excludeKey: "MBA-3" }
  );
  const keys = refs.map((row) => row.key).sort();
  assert.deepEqual(keys, ["CHG000111", "CHG0040001", "CHG123", "CRQ00088"]);
});

test("scrapes every ticket id when two RITMs are in one comment", () => {
  const refs = extractTicketRefs(
    "Please close RITM0203030 / RITM0204040 and CR-88.",
    { excludeKey: "MBA-5" }
  );
  const keys = refs.map((row) => row.key).sort();
  assert.deepEqual(keys, ["CR88", "RITM0203030", "RITM0204040"]);
});

test("scrapes a second number after and/slash without repeating the prefix", () => {
  const refs = extractTicketRefs("RITM0203030 and 0204040", { excludeKey: "MBA-5" });
  const keys = refs.map((row) => row.key).sort();
  assert.deepEqual(keys, ["RITM0203030", "RITM0204040"]);
});

test("does not include the story's own key", () => {
  const refs = extractTicketRefs("MBA-12 depends on RITM0044", { excludeKey: "MBA-12" });
  assert.deepEqual(
    refs.map((row) => row.key),
    ["RITM0044"]
  );
});

test("one-hop follow excludes parent and followed key", () => {
  const refs = extractTicketRefs("MBA-2 comment mentions RITM0203030 and MBA-5", {
    excludeKey: "MBA-5",
    excludeKeys: ["MBA-2"],
  });
  assert.deepEqual(
    refs.map((row) => row.key),
    ["RITM0203030"]
  );
});

test("scrapes lowercase stask alias and 7-digit CHG", () => {
  const refs = extractTicketRefs("stask9203003 CHG0404004", { excludeKey: "MBA-3" });
  assert.deepEqual(
    refs.map((row) => row.key).sort(),
    ["CHG0404004", "SCTASK9203003"]
  );
});

test("TICKET_PREFIX treats SCTASK as an ops prefix", () => {
  const refs = extractTicketRefs("ServiceNow SCTASK9203003", { excludeKey: "MBA-3" });
  assert.deepEqual(
    refs.map((row) => row.key),
    ["SCTASK9203003"]
  );
});

test("ticket kind and auto query follow prefix (RITM/CHG/SCTASK/Jira)", () => {
  assert.equal(ticketKindLabel("RITM0203030"), "request");
  assert.equal(ticketKindLabel("CHG0404004"), "change");
  assert.equal(ticketKindLabel("SCTASK9203003"), "catalog task");
  assert.equal(ticketKindLabel("MBA-5"), "Jira issue");
  assert.equal(ticketLookupQuery("RITM0203030"), "number=RITM0203030");
  assert.equal(ticketLookupQuery("CHG0404004"), "number=CHG0404004");
  assert.equal(ticketLookupQuery("SCTASK9203003"), "number=SCTASK9203003");
  assert.equal(ticketLookupQuery("MBA-5"), "key = MBA-5");
});

test("extracts a comment snippet around each known ticket and skips parent Jira text", () => {
  const comments = [
    "Please close RITM0203030 after the MFA reset for SSO.",
    "Weekend window is CHG0404004.",
    "Catalog work SCTASK9203003 for the laptop request.",
    "Also RITM29292002020 and RITM100101002.",
  ].join(" ");
  const ritm = extractTicketDescription(comments, "RITM0203030", {
    parentSummary: "Implement Biometric Login in SAMPLE",
  });
  assert.match(ritm, /MFA reset/i);
  assert.doesNotMatch(ritm, /Implement Biometric Login/);
  assert.doesNotMatch(ritm, /please close/i);
  assert.match(extractTicketDescription(comments, "CHG0404004"), /Weekend window/i);
  assert.match(extractTicketDescription(comments, "SCTASK9203003"), /laptop request/i);
  assert.equal(extractTicketDescription("Completed the task.\nRITM0203030", "RITM0203030"), "");
  assert.equal(extractTicketDescription("RITM0203030\nCompleted the task.", "RITM0203030"), "");
  const copied = extractTicketDescription(
    "Implement Biometric Login in SAMPLE RITM0203030",
    "RITM0203030",
    { parentSummary: "Implement Biometric Login in SAMPLE" }
  );
  assert.equal(copied, "");
});

test("enrich fills kind, extracted description, and auto query without copying parent summary", () => {
  const issue = {
    key: "MBA-5",
    summary: "Implement Biometric Login in SAMPLE",
    description: "Sample biometric story",
    commentText:
      "Please close RITM0203030 after the MFA reset. Weekend window is CHG0404004. Catalog work SCTASK9203003 for the laptop request.",
    relatedTickets: [
      { key: "RITM0203030", summary: "Implement Biometric Login in SAMPLE", source: "comment" },
      { key: "CHG0404004", summary: "", source: "comment" },
      { key: "SCTASK9203003", summary: "Completed the task.", source: "comment" },
    ],
  };
  enrichRelatedTicketsFromComments(issue);
  assert.equal(issue.summary, "Implement Biometric Login in SAMPLE");
  assert.equal(issue.description, "Sample biometric story");
  const byKey = Object.fromEntries(issue.relatedTickets.map((row) => [row.key, row]));
  assert.equal(byKey.RITM0203030.kind, "request");
  assert.match(byKey.RITM0203030.summary, /MFA reset/i);
  assert.notEqual(byKey.RITM0203030.summary, issue.summary);
  assert.equal(byKey.RITM0203030.autoQuery, "number=RITM0203030");
  assert.equal(byKey.CHG0404004.kind, "change");
  assert.match(byKey.CHG0404004.summary, /Weekend window/i);
  assert.equal(byKey.SCTASK9203003.kind, "catalog task");
  assert.match(byKey.SCTASK9203003.summary, /laptop request/i);
  assert.equal(byKey.SCTASK9203003.autoQuery, "number=SCTASK9203003");
});

test("comment source is the comment lines that mention harvested tickets, not the Jira description", () => {
  const comments = [
    "Please close RITM0203030 after the MFA reset for SSO.",
    "Weekend window is CHG0404004.",
    "Catalog work SCTASK9203003 for the laptop request.",
    "Also RITM29292002020 and RITM100101002.",
  ].join("\n");
  const source = commentSourceForTickets(
    `${comments}\nAllow users to view their transaction history in the app.`,
    [
      { key: "RITM0203030" },
      { key: "CHG0404004" },
      { key: "SCTASK9203003" },
      { key: "RITM29292002020" },
      { key: "RITM100101002" },
    ],
    {
      parentKey: "MBA-5",
      parentSummary: "(Sample) Implement Biometric Login in SAMPLE",
      parentDescription: "Allow users to view their transaction history in the app.",
    }
  );
  assert.match(source, /RITM0203030 after the MFA reset/);
  assert.match(source, /CHG0404004/);
  assert.match(source, /SCTASK9203003/);
  assert.match(source, /RITM29292002020/);
  assert.match(source, /RITM100101002/);
  assert.doesNotMatch(source, /transaction history/i);
  assert.doesNotMatch(source, /Implement Biometric Login/);
});

test("parent Jira description stays the story field, not harvested comment tickets", () => {
  const text = bundledParentDescription({
    key: "MBA-5",
    summary: "Implement Biometric Login in SAMPLE",
    description: "Allow users to log in using fingerprint or facial recognition.",
    relatedTickets: [
      { key: "RITM0203030", summary: "after the MFA reset for SSO" },
      { key: "CHG0404004", summary: "Weekend window" },
      { key: "SCTASK9203003", summary: "Completed the task." },
      { key: "RITM29292002020", summary: "request" },
    ],
  });
  assert.match(text, /^Allow users to log in using fingerprint or facial recognition\./);
  assert.doesNotMatch(text, /Comment tickets:/);
  assert.doesNotMatch(text, /RITM0203030/);
  assert.doesNotMatch(text, /Completed the task/);
});

test("bundle lookup query is one line for collected ops ids", () => {
  const { bundledTicketLookupQuery } = require("./jira");
  const query = bundledTicketLookupQuery(
    [
      { key: "RITM0203030" },
      { key: "CHG0404004" },
      { key: "SCTASK9203003" },
      { key: "MBA-3" },
    ],
    { parentKey: "MBA-5" }
  );
  assert.match(query, /RITM0203030/);
  assert.match(query, /CHG0404004/);
  assert.match(query, /SCTASK9203003/);
  assert.doesNotMatch(query, /\n/);
  assert.doesNotMatch(query, /MBA-3/);
  assert.doesNotMatch(query, /request/);
});

test("href-only ADF/html still yields SCTASK and CHG ids", () => {
  const adf = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "see task",
            marks: [{ type: "link", attrs: { href: "https://example/stask9203003" } }],
          },
          {
            type: "inlineCard",
            attrs: { url: "https://snow.example/nav?id=CHG0404004" },
          },
        ],
      },
    ],
  };
  const fromAdf = extractTicketRefs(jiraAdfToText(adf), { excludeKey: "MBA-3" }).map((row) => row.key).sort();
  assert.deepEqual(fromAdf, ["CHG0404004", "SCTASK9203003"]);
  const fromHtml = extractTicketRefs(
    htmlToPlain('<p><a href="https://x/stask9203003">task</a> <a href="/browse/CHG0404004">chg</a></p>'),
    { excludeKey: "MBA-3" }
  )
    .map((row) => row.key)
    .sort();
  assert.deepEqual(fromHtml, ["CHG0404004", "SCTASK9203003"]);
});

test("adds open sprint to assignee JQL", () => {
  assert.equal(
    ensureOpenSprintJql("assignee = currentUser() ORDER BY updated ASC"),
    "assignee = currentUser() AND sprint in openSprints() ORDER BY updated ASC"
  );
  assert.equal(
    ensureOpenSprintJql("assignee = currentUser() AND sprint in openSprints() ORDER BY updated ASC"),
    "assignee = currentUser() AND sprint in openSprints() ORDER BY updated ASC"
  );
});

test("past work JQL keeps assigned issues across sprints so summary peers are visible", () => {
  const past = "assignee = currentUser() ORDER BY updated DESC";
  assert.equal(
    ensurePastWorkJql("assignee = currentUser() AND sprint in openSprints() ORDER BY updated ASC"),
    past
  );
  assert.equal(
    ensurePastWorkJql("assignee = currentUser() AND status != Done ORDER BY updated ASC"),
    past
  );
  assert.equal(ensurePastWorkJql(""), past);
  assert.equal(ensurePastWorkJql("assignee = currentUser() ORDER BY updated ASC"), past);
  assert.doesNotMatch(ensurePastWorkJql("assignee = currentUser()"), /sprint in openSprints\(\)/i);
  assert.doesNotMatch(ensurePastWorkJql("assignee = currentUser()"), /sprint not in openSprints\(\)/i);
  assert.doesNotMatch(ensurePastWorkJql("assignee = currentUser()"), /statusCategory = Done/i);
});

test("open-sprint and closed stories are dropped from Past samples", () => {
  const past = filterPastWorkIssues(
    [
      { key: "MBA-5", inOpenSprint: true, status: "Done" },
      { key: "MBA-3", inOpenSprint: false, status: "Closed", statusCategory: "done" },
      { key: "MBA-7", inOpenSprint: false, status: "Resolved" },
      { key: "MBA-9", inOpenSprint: false, status: "Complete" },
      { key: "MBA-8", inOpenSprint: false, status: "In Progress" },
    ],
    { excludeKeys: ["MBA-5"] }
  );
  assert.deepEqual(
    past.map((row) => row.key).sort(),
    ["MBA-8"]
  );
});

test("Past filter helper excludes statusCategory done even without a Done name", () => {
  const past = filterPastWorkIssues([
    { key: "MBA-3", inOpenSprint: false, status: "Closed", statusCategory: "done" },
    { key: "MBA-5", inOpenSprint: false, status: "In Progress", statusCategory: "indeterminate" },
  ]);
  assert.deepEqual(
    past.map((row) => row.key),
    ["MBA-5"]
  );
  assert.equal(isPastWorkDoneIssue({ status: "Closed" }), true);
  assert.equal(isPastWorkDoneIssue({ status: "Done" }), true);
  assert.equal(isPastWorkDoneIssue({ status: "Resolved" }), true);
  assert.equal(isPastWorkDoneIssue({ statusCategory: "done", status: "Finished" }), true);
});

test("done similar MBA-3 is kept as a past Jira key plus its ops ids", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE", status: "In Progress" };
  const mba3 = {
    key: "MBA-3",
    summary: "(Sample) Implement Biometric Login",
    status: "Closed",
    statusCategory: "done",
    done: true,
  };
  assert.deepEqual(collectFollowJiraKeys(mba5, [mba5, mba3]), ["MBA-3"]);
  assert.deepEqual(similarRelatedFromIssues(mba5, [mba5, mba3]).map((row) => row.key), []);
  const related = selectRelatedTickets(mba5, {
    scraped: [],
    hopOps: [
      { key: "SCTASK9203003", source: "comment" },
      { key: "CHG0404004", source: "comment" },
    ],
    hopStories: [mba3],
    batch: [mba5, mba3],
  });
  assert.deepEqual(
    related.map((row) => row.key).sort(),
    ["CHG0404004", "MBA-3", "SCTASK9203003"]
  );
  assert.deepEqual(
    filterPastWorkIssues([mba5, mba3]).map((row) => row.key),
    ["MBA-5"]
  );
});

test("issueInOpenSprint reads active sprint state from Jira sprint field", () => {
  assert.equal(issueInOpenSprint({ sprint: [{ state: "active", name: "Sprint 12" }] }), true);
  assert.equal(issueInOpenSprint({ sprint: [{ state: "closed", name: "Sprint 11" }] }), false);
  assert.equal(
    issueInOpenSprint({
      sprint: "com.atlassian.greenhopper.service.sprint.Sprint@[id=1,state=ACTIVE,name=S1]",
    }),
    true
  );
});

test("extracts ticket numbers from ADF link marks, inlineCard urls, and media titles", () => {
  const adf = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "see change",
            marks: [{ type: "link", attrs: { href: "https://example/browse/CHG000111" } }],
          },
          { type: "inlineCard", attrs: { url: "https://snow.example/nav?id=RITM0203030" } },
          { type: "media", attrs: { title: "CR-88.pdf" } },
        ],
      },
    ],
  };
  const keys = extractTicketRefs(jiraAdfToText(adf), { excludeKey: "MBA-3" })
    .map((row) => row.key)
    .sort();
  assert.deepEqual(keys, ["CHG000111", "CR88", "RITM0203030"]);
});

test("htmlToPlain keeps ticket ids inside anchor hrefs", () => {
  const text = htmlToPlain(
    '<p>see <a href="https://x/browse/CHG000111">this change</a> and <a href="/RITM0203030">ritm</a></p>'
  );
  const keys = extractTicketRefs(text, { excludeKey: "MBA-3" }).map((row) => row.key).sort();
  assert.deepEqual(keys, ["CHG000111", "RITM0203030"]);
});

test("scrapes every ticket number from a long comment history blob", () => {
  const chunks = [];
  for (let i = 0; i < 40; i++) {
    chunks.push(`note ${i}: RITM${String(2030300 + i)} and CHG${String(100 + i).padStart(6, "0")}`);
  }
  chunks.push("CR-88", "CHG 000111", "RITM0203030 and 0204040");
  const keys = new Set(extractTicketRefs(chunks.join("\n"), { excludeKey: "MBA-3" }).map((row) => row.key));
  assert.equal(keys.size >= 82, true);
  assert.equal(keys.has("RITM2030300"), true);
  assert.equal(keys.has("RITM2030339"), true);
  assert.equal(keys.has("CHG000139"), true);
  assert.equal(keys.has("CR88"), true);
  assert.equal(keys.has("CHG000111"), true);
  assert.equal(keys.has("RITM0203030"), true);
  assert.equal(keys.has("RITM0204040"), true);
});

test("MBA-5 matches MBA-3 biometric login sample", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const mba3 = { key: "MBA-3", summary: "(Sample) Implement Biometric Login" };
  assert.equal(storiesAreRelated(mba5, mba3), true);
  assert.equal(storiesAreSimilar(mba5, mba3), true);
});

test("MBA-5 matches closed MBA-6 biometric summary even without the word login", () => {
  const mba5 = {
    key: "MBA-5",
    summary: "(Sample) Implement Biometric Login in SAMPLE",
    description: "Allow users to view their transaction history in the app.",
  };
  const mba6 = {
    key: "MBA-6",
    summary: "Implement Biometric FAILIGN WITH 404",
    description: "Enable users to transfer funds between accounts.",
    status: "Done",
  };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management", status: "Done" };
  assert.equal(storiesAreRelated(mba5, mba6), true);
  assert.equal(storiesAreRelated(mba5, mba2), false);
  const related = similarRelatedFromIssues(mba5, [mba5, mba6, mba2], { includeDone: true });
  assert.deepEqual(
    related.map((row) => row.key),
    ["MBA-6"]
  );
});

test("MBA-5 does not match MBA-2 transaction management", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management" };
  assert.equal(storiesAreRelated(mba5, mba2), false);
  assert.equal(storiesAreSimilar(mba5, mba2), false);
});

test("a story is not similar to itself", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  assert.equal(storiesAreRelated(mba5, mba5), false);
  assert.equal(storiesAreSimilar(mba5, mba5), false);
});

test("selectRelatedTickets keeps ops and similar MBA-3, not comment-harvested MBA-2", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const mba3 = { key: "MBA-3", summary: "(Sample) Implement Biometric Login" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management" };
  const related = selectRelatedTickets(mba5, {
    scraped: [
      { key: "RITM0203030", source: "comment" },
      { key: "MBA-2", source: "comment" },
    ],
    hopOps: [],
    hopStories: [mba2],
    batch: [mba5, mba3, mba2],
  });
  assert.deepEqual(
    related.map((row) => row.key).sort(),
    ["MBA-3", "RITM0203030"]
  );
  assert.equal(related.find((row) => row.key === "MBA-3").summary, "(Sample) Implement Biometric Login");
  assert.ok(!related.some((row) => row.key === "MBA-5"));
  assert.ok(!related.some((row) => row.key === "MBA-2"));
});

test("selectRelatedTickets ignores issuelinks unless summaries match", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const related = selectRelatedTickets(mba5, {
    scraped: [],
    linked: [{ key: "MBA-2", summary: "(Sample) Transaction Management", source: "link" }],
    batch: [mba5],
  });
  assert.deepEqual(
    related.map((row) => row.key),
    []
  );
});

test("similar related row uses the other issue's summary, not the parent", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const mba3 = { key: "MBA-3", summary: "(Sample) Implement Biometric Login" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management" };
  const related = similarRelatedFromIssues(mba5, [mba5, mba3, mba2]);
  assert.deepEqual(
    related.map((row) => row.key),
    ["MBA-3"]
  );
  assert.equal(related[0].summary, "(Sample) Implement Biometric Login");
  assert.equal(related[0].source, "similar");
  assert.ok(!related.some((row) => row.summary === mba5.summary));
});

test("similar related does not duplicate a key already scraped from comments", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const mba3 = { key: "MBA-3", summary: "(Sample) Implement Biometric Login" };
  const merged = mergeRelatedTickets(
    [{ key: "MBA-3", summary: "", source: "comment" }],
    similarRelatedFromIssues(mba5, [mba5, mba3])
  );
  assert.equal(merged.filter((row) => row.key === "MBA-3").length, 1);
  assert.equal(merged.find((row) => row.key === "MBA-3").summary, "(Sample) Implement Biometric Login");
});

test("related filter keeps similar MBA-3 and ops keys, not comment MBA-2", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const mba3 = { key: "MBA-3", summary: "(Sample) Implement Biometric Login" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management" };
  const merged = mergeRelatedTickets(
    [{ key: "RITM0203030", source: "comment" }],
    [{ key: "MBA-2", summary: "(Sample) Transaction Management", source: "comment" }],
    similarRelatedFromIssues(mba5, [mba5, mba3, mba2], { includeDone: true })
  );
  const filtered = filterRelatedTickets(mba5, merged, [mba5, mba3, mba2]);
  const keys = filtered.map((row) => row.key).sort();
  assert.deepEqual(keys, ["MBA-3", "RITM0203030"]);
  assert.equal(filtered.find((row) => row.key === "MBA-3").summary, "(Sample) Implement Biometric Login");
});

test("mergeRelatedTickets fills MBA-2 summary without copying the parent story", () => {
  const merged = mergeRelatedTickets(
    [{ key: "MBA-2", summary: "", source: "comment" }],
    [{ key: "RITM0203030", source: "comment" }],
    [{ key: "MBA-2", summary: "(Sample) Transaction Management", source: "linked-story" }]
  );
  const mba2 = merged.find((row) => row.key === "MBA-2");
  const ritm = merged.find((row) => row.key === "RITM0203030");
  assert.equal(mba2.summary, "(Sample) Transaction Management");
  assert.equal(ritm.summary, "");
  assert.ok(!merged.some((row) => row.key === "MBA-5"));
});

test("one-hop follow is summary matches only, not comment MBA-2", () => {
  const mba5 = {
    key: "MBA-5",
    summary: "(Sample) Implement Biometric Login in SAMPLE",
    _mentionedJiraKeys: ["MBA-2"],
  };
  const mba3 = { key: "MBA-3", summary: "(Sample) Implement Biometric Login" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management" };
  const follow = collectFollowJiraKeys(mba5, [mba5, mba3, mba2]).sort();
  assert.deepEqual(follow, ["MBA-3"]);
});

test("following similar MBA-3 harvests its CHG onto MBA-5 without comment MBA-2", () => {
  const mba5 = { key: "MBA-5", summary: "(Sample) Implement Biometric Login in SAMPLE" };
  const mba3 = { key: "MBA-3", summary: "(Sample) Implement Biometric Login" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management" };
  const related = selectRelatedTickets(mba5, {
    scraped: [
      { key: "RITM0203030", source: "comment" },
      { key: "MBA-2", source: "comment" },
    ],
    hopOps: [{ key: "CHG000111", source: "comment" }],
    hopStories: [mba2, mba3],
    batch: [mba5, mba3, mba2],
  });
  assert.deepEqual(
    related.map((row) => row.key).sort(),
    ["CHG000111", "MBA-3", "RITM0203030"]
  );
});

test("MBA-12 is related to MBA-5 by summary matching the story text", () => {
  const mba5 = {
    key: "MBA-5",
    summary: "(Sample) Implement Biometric Login in SAMPLE",
    description: "Allow users to view their transaction history in the app.",
  };
  const mba12 = {
    key: "MBA-12",
    summary: "Allow users to view their transaction history in the app.",
    status: "Done",
  };
  const mba1 = { key: "MBA-1", summary: "(Sample) Account Registration" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management" };
  assert.equal(storiesAreRelated(mba5, mba12), true);
  assert.equal(storiesAreRelated(mba5, mba1), false);
  assert.equal(storiesAreRelated(mba5, mba2), false);
  const related = selectRelatedTickets(mba5, {
    scraped: [
      { key: "RITM0203030", source: "comment" },
      { key: "MBA-1", source: "comment" },
      { key: "MBA-2", source: "comment" },
    ],
    batch: [mba5, mba1, mba2, mba12],
  });
  assert.deepEqual(
    related.map((row) => row.key).sort(),
    ["MBA-12", "RITM0203030"]
  );
});

test("finalizePastWorkRelated nests MBA-12 under MBA-5 and keeps ops, not MBA-1/MBA-2", () => {
  const issues = [
    {
      key: "MBA-5",
      summary: "(Sample) Implement Biometric Login in SAMPLE",
      description: "Allow users to view their transaction history in the app.",
      status: "In Progress",
      relatedTickets: [
        { key: "RITM0203030", source: "comment" },
        { key: "MBA-1", source: "comment" },
        { key: "MBA-2", source: "comment" },
        { key: "MBA-3", source: "comment" },
      ],
    },
    {
      key: "MBA-1",
      summary: "(Sample) Account Registration",
      status: "Done",
      relatedTickets: [],
    },
    {
      key: "MBA-2",
      summary: "(Sample) Transaction Management",
      status: "Done",
      relatedTickets: [],
    },
    {
      key: "MBA-3",
      summary: "(Sample) Implement Biometric Login",
      status: "Done",
      relatedTickets: [],
    },
    {
      key: "MBA-12",
      summary: "Allow users to view their transaction history in the app.",
      status: "Done",
      relatedTickets: [],
    },
  ];
  const [mba5] = finalizePastWorkRelated(issues);
  assert.deepEqual(
    mba5.relatedTickets.map((row) => row.key).sort(),
    ["MBA-12", "MBA-3", "RITM0203030"]
  );
});

test("empty scrape keeps last-good MBA-3 and ops under MBA-5", () => {
  const cached = [
    {
      key: "MBA-5",
      summary: "(Sample) Implement Biometric Login in SAMPLE",
      description: "Allow users to view their transaction history in the app.",
      status: "In Progress",
      relatedTickets: [
        { key: "MBA-3" },
        { key: "RITM0203030" },
        { key: "CHG0404004" },
        { key: "SCTASK9203003" },
        { key: "RITM29292002020" },
        { key: "RITM100101002" },
      ],
    },
    {
      key: "MBA-3",
      summary: "(Sample) Implement Biometric Login",
      status: "Done",
      relatedTickets: [],
    },
  ];
  const scraped = [
    {
      key: "MBA-5",
      summary: "(Sample) Implement Biometric Login in SAMPLE",
      description: "Allow users to view their transaction history in the app.",
      status: "In Progress",
      relatedTickets: [],
    },
  ];
  const [mba5] = mergeScrapedPastWork(cached, scraped);
  assert.deepEqual(
    mba5.relatedTickets.map((row) => row.key).sort(),
    ["CHG0404004", "MBA-3", "RITM0203030", "RITM100101002", "RITM29292002020", "SCTASK9203003"]
  );
  assert.ok(!mba5.relatedTickets.some((row) => row.key === "MBA-1" || row.key === "MBA-2"));
});

test("similar search JQL is assignee-scoped across projects, includes no status filter, and sorts newest first", () => {
  const jql = buildSimilarIssueJql({
    projectKey: "MBA-5",
    phrase: "transaction history",
    excludeKey: "MBA-5",
  });
  assert.match(jql, /assignee = currentUser\(\)/);
  assert.doesNotMatch(jql, /project = MBA/);
  assert.match(jql, /summary ~ "transaction" AND summary ~ "history"/);
  assert.match(jql, /description ~ "transaction" AND description ~ "history"/);
  assert.doesNotMatch(jql, /summary ~ "allow users to view their transaction history in the app\."/i);
  assert.match(jql, /key != MBA-5/);
  assert.match(jql, /ORDER BY updated DESC/);
  assert.doesNotMatch(jql, /statusCategory != Done/i);
  assert.doesNotMatch(jql, /sprint not in openSprints/i);
});

test("recently closed similar summary is nested under MBA-5; MBA-1 and MBA-2 are not", () => {
  const mba5 = {
    key: "MBA-5",
    summary: "(Sample) Implement Biometric Login in SAMPLE",
    description: "Allow users to view their transaction history in the app.",
    status: "In Progress",
  };
  const mba21 = {
    key: "MBA-21",
    summary: "Allow users to view their transaction history in the app.",
    status: "Done",
    statusCategory: "done",
    done: true,
  };
  const mba1 = { key: "MBA-1", summary: "(Sample) Account Registration", status: "Done" };
  const mba2 = { key: "MBA-2", summary: "(Sample) Transaction Management", status: "Done" };
  assert.ok(similarSearchPhrases(mba5).some((phrase) => /transaction history/i.test(phrase)));
  assert.equal(storiesAreRelated(mba5, mba21), true);
  assert.equal(storiesAreRelated(mba5, mba1), false);
  assert.equal(storiesAreRelated(mba5, mba2), false);
  const related = similarRelatedFromIssues(mba5, [mba5, mba1, mba2, mba21], { includeDone: true });
  assert.deepEqual(
    related.map((row) => row.key).sort(),
    ["MBA-21"]
  );
});

test("live similar scrape adds a newly closed ticket into an existing MBA-5 fold", () => {
  const cached = [
    {
      key: "MBA-5",
      summary: "(Sample) Implement Biometric Login in SAMPLE",
      description: "Allow users to view their transaction history in the app.",
      status: "In Progress",
      relatedTickets: [{ key: "MBA-3" }, { key: "RITM0203030" }],
    },
    {
      key: "MBA-3",
      summary: "(Sample) Implement Biometric Login",
      status: "Done",
      relatedTickets: [],
    },
  ];
  const scraped = [
    {
      key: "MBA-5",
      summary: "(Sample) Implement Biometric Login in SAMPLE",
      description: "Allow users to view their transaction history in the app.",
      status: "In Progress",
      relatedTickets: [{ key: "MBA-21", summary: "Allow users to view their transaction history in the app." }],
    },
    {
      key: "MBA-21",
      summary: "Allow users to view their transaction history in the app.",
      status: "Done",
      statusCategory: "done",
      relatedTickets: [],
    },
  ];
  const merged = mergeScrapedPastWork(cached, scraped);
  const mba5 = merged.find((row) => row.key === "MBA-5");
  const keys = mba5.relatedTickets.map((row) => row.key).sort();
  assert.ok(keys.includes("MBA-3"));
  assert.ok(keys.includes("MBA-21"));
  assert.ok(keys.includes("RITM0203030"));
  assert.ok(!keys.includes("MBA-1"));
  assert.ok(!keys.includes("MBA-2"));
});

test("Refresh similar search returns closed MBA-99, not MBA-1", async () => {
  const http = require("http");
  const { URL } = require("url");
  const parentSummary = "Allow users to view their transaction history in the app.";
  const issues = {
    "MBA-5": {
      key: "MBA-5",
      fields: {
        summary: parentSummary,
        description: parentSummary,
        status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
        updated: "2026-09-01T12:00:00.000Z",
      },
    },
    "MBA-99": {
      key: "MBA-99",
      fields: {
        summary: parentSummary,
        description: parentSummary,
        status: { name: "Done", statusCategory: { key: "done" } },
        updated: "2026-09-17T14:00:00.000Z",
      },
    },
    "MBA-6": {
      key: "MBA-6",
      fields: {
        summary: parentSummary,
        description: parentSummary,
        status: { name: "Done", statusCategory: { key: "done" } },
        updated: "2026-09-17T15:10:00.000Z",
      },
    },
    "MBQ-6": {
      key: "MBQ-6",
      fields: {
        summary: parentSummary,
        description: parentSummary,
        status: { name: "Closed", statusCategory: { key: "done" } },
        updated: "2026-09-17T15:12:00.000Z",
      },
    },
    "DBAB-4": {
      key: "DBAB-4",
      fields: {
        summary: "View transaction history in the app",
        description: "",
        status: { name: "Done", statusCategory: { key: "done" } },
        updated: "2026-09-17T15:13:00.000Z",
      },
    },
    "MBA-1": {
      key: "MBA-1",
      fields: {
        summary: "(Sample) Account Registration",
        description: "Create an account in SAMPLE.",
        status: { name: "Done", statusCategory: { key: "done" } },
        updated: "2026-09-16T14:00:00.000Z",
      },
    },
  };
  const fieldHasTokens = (text, phrase) => {
    const hay = String(text || "").toLowerCase();
    const tokens = String(phrase || "")
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return tokens.length > 0 && tokens.every((tok) => hay.includes(tok));
  };
  const matchesJql = (jql, issue) => {
    const summary = String(issue.fields.summary || "").toLowerCase();
    const description = String(issue.fields.description || "").toLowerCase();
    const blob = `${summary} ${description}`;
    return String(jql || "")
      .split(/\s+OR\s+/i)
      .some((part) => {
        const clauses = [...part.matchAll(/\b(summary|description|text)\s*~\s*"([^"]+)"/gi)];
        if (!clauses.length) return false;
        return clauses.every(([, field, phrase]) => {
          const name = String(field || "").toLowerCase();
          const hay = name === "summary" ? summary : name === "description" ? description : blob;
          return fieldHasTokens(hay, phrase);
        });
      });
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "POST") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (body?.jql && !url.searchParams.get("jql")) url.searchParams.set("jql", String(body.jql));
        } catch {
          /* ignore */
        }
        finish(url, res);
      });
      return;
    }
    finish(url, res);
  });
  function finish(url, res) {
    const jql = String(url.searchParams.get("jql") || "");
    const hits = Object.values(issues).filter((issue) => {
      if (issue.key === "MBA-5") return false;
      if (/\b(summary|description|text)\s*~/i.test(jql)) return matchesJql(jql, issue);
      return true;
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ issues: hits, isLast: true }));
  }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const tokens = distinctiveSimilarTokens(parentSummary);
    assert.deepEqual(tokens.slice(0, 2), ["transaction", "history"]);
    assert.ok(!tokens.includes("allow"));
    const hits = await findSimilarPastIssues(
      {
        baseUrl: `http://127.0.0.1:${port}`,
        email: "demo@coact.local",
        apiToken: "mock-token",
      },
      {
        key: "MBA-5",
        summary: parentSummary,
        description: parentSummary,
        status: "In Progress",
      },
      { timeoutMs: 4000, forceRefresh: true }
    );
    const keys = hits.map((row) => row.key);
    assert.ok(keys.includes("MBA-99"), `expected MBA-99 in ${keys.join(",")}`);
    assert.ok(keys.includes("MBA-6"), `expected just-closed MBA-6 in ${keys.join(",")}`);
    assert.ok(keys.includes("MBQ-6"), `expected MBQ-6 in ${keys.join(",")}`);
    assert.ok(keys.includes("DBAB-4"), `expected DBAB-4 in ${keys.join(",")}`);
    assert.ok(!keys.includes("MBA-1"), `MBA-1 should not match: ${keys.join(",")}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("recent assigned JQL is not locked to the MBA project", () => {
  const { buildRecentAssignedIssueJql } = require("./jira");
  const jql = buildRecentAssignedIssueJql({ excludeKey: "MBA-5" });
  assert.match(jql, /assignee = currentUser\(\)/);
  assert.match(jql, /key != MBA-5/);
  assert.doesNotMatch(jql, /project = /);
});

test("similar search hits stay on MBA-5 relatedTickets and fold HTML after finalize", () => {
  const { issueToRow, rowToIssue } = require("./past-work-store");
  const mba5 = {
    key: "MBA-5",
    summary: "(Sample) Implement Biometric Login in SAMPLE",
    description: "Allow users to view their transaction history in the app.",
    status: "In Progress",
    relatedTickets: [{ key: "RITM0203030", source: "comment" }],
  };
  const hits = [
    {
      key: "MBA-7",
      summary: "Transaction history export",
      status: "Done",
      statusCategory: "done",
      done: true,
    },
    {
      key: "MBA-12",
      summary: "Allow users to view their transaction history in the app.",
      status: "Closed",
      statusCategory: "done",
      done: true,
    },
    {
      key: "MBA-3",
      summary: "(Sample) Implement Biometric Login",
      status: "Done",
      statusCategory: "done",
      done: true,
    },
  ];
  pinSimilarSearchHits(mba5, hits);
  const afterSelect = selectRelatedTickets(mba5, {
    scraped: [{ key: "RITM0203030", source: "comment" }],
    batch: [mba5],
  });
  mba5.relatedTickets = afterSelect;
  const [finalized] = finalizePastWorkRelated([
    mba5,
    { key: "MBA-1", summary: "(Sample) Account Registration", status: "Done", relatedTickets: [] },
  ]);
  const keys = finalized.relatedTickets.map((row) => row.key);
  assert.ok(keys.includes("MBA-7"));
  assert.ok(keys.includes("MBA-12"));
  assert.ok(keys.includes("MBA-3"));
  assert.ok(keys.includes("RITM0203030"));
  assert.ok(!keys.includes("MBA-1"));
  const fold = pastWorkFoldKeys(finalized);
  assert.deepEqual(fold.jira, ["MBA-3", "MBA-7", "MBA-12"]);
  const html = pastWorkFoldHtml(finalized);
  assert.match(html, /<button class="jira-key">MBA-7<\/button>/);
  assert.match(html, /<button class="jira-key">MBA-12<\/button>/);
  assert.match(html, /<button class="jira-key">MBA-3<\/button>/);
  assert.match(html, /RITM0203030/);
  const restored = rowToIssue(issueToRow(finalized));
  const persisted = restored.relatedTickets.map((row) => row.key);
  assert.ok(persisted.includes("MBA-7"));
  assert.ok(persisted.includes("MBA-12"));
  assert.ok(persisted.includes("MBA-3"));
  assert.ok(persisted.includes("RITM0203030"));
});
