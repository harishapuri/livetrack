const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isTestTicket,
  isLowQualityText,
  isVagueQuery,
  matchSystemTag,
  personFromUser,
  personKey,
  hashEmbed,
  cosineSimilarity,
  groupExperts,
  makeRecord,
  formatExpertResult,
} = require("./expert-records");
const { buildExpertJql, resolverFromChangelog, recordsFromIssue } = require("./expert-jira");
const { buildExpertCql, recordsFromPage } = require("./confluence");

test("test tickets and empty text are dropped", () => {
  assert.equal(isTestTicket("Test VPN reset", []), true);
  assert.equal(isTestTicket("VPN reset for branch", ["prod"]), false);
  assert.equal(isLowQualityText("ok"), true);
  assert.equal(isLowQualityText("Users cannot complete SSO after idle timeout."), false);
});

test("vague queries ask for a system", () => {
  assert.equal(isVagueQuery("who is good at IT stuff"), true);
  assert.equal(isVagueQuery("who knows LOS onboarding"), false);
  assert.equal(isVagueQuery("two factor authentication"), false);
  assert.equal(isVagueQuery("who knows", "LOS"), false);
});

test("system tag matches component or label", () => {
  assert.equal(matchSystemTag(["UPI recon", "network"], ["UPI", "LOS"]), "UPI");
  assert.equal(matchSystemTag(["other"], ["UPI"]), "");
});

test("expert JQL is project-wide, not currentUser", () => {
  const jql = buildExpertJql({ projectKey: "ITHELP", systemTags: "UPI, LOS" });
  assert.match(jql, /project = ITHELP/);
  assert.match(jql, /component in \(UPI, LOS\)/);
  assert.doesNotMatch(jql, /currentUser/);
  assert.doesNotMatch(jql, /status in \(Resolved/);
  assert.match(
    buildExpertJql({ projectKey: "ITHELP", textQuery: "two factor authentication" }),
    /text ~ "two factor authentication"/
  );
  assert.equal(
    buildExpertJql({ expertJql: "project = ABC AND status = Done" }),
    "project = ABC AND status = Done ORDER BY updated DESC"
  );
});

test("resolver comes from status/resolution changelog", () => {
  const person = resolverFromChangelog([
    {
      author: { displayName: "Alex", accountId: "a1", emailAddress: "alex@coact.local" },
      items: [{ field: "status", toString: "Done" }],
    },
  ]);
  assert.equal(person.person, "Alex");
  assert.equal(person.personAccountId, "a1");
});

test("jira issue records prefer resolver then commenters", () => {
  const rows = recordsFromIssue(
    {
      key: "ITHELP-9",
      fields: {
        summary: "LOS onboarding timeout",
        description: "Users stall on KYC after SSO redirect for LOS.",
        resolutiondate: "2026-08-01T00:00:00.000Z",
        components: [{ name: "LOS" }],
        labels: [],
        assignee: { displayName: "Sam", accountId: "s1" },
        comment: {
          comments: [{ author: { displayName: "Riley", accountId: "r1" }, body: "Restarted LOS adapter." }],
        },
      },
    },
    {
      baseUrl: "https://ex.atlassian.net",
      systemTags: "LOS",
      resolver: { displayName: "Alex", accountId: "a1" },
    }
  );
  assert.ok(rows.some((row) => row.role_signal === "resolver" && row.person === "Alex"));
  assert.ok(rows.some((row) => row.role_signal === "commenter" && row.person === "Riley"));
  assert.equal(rows[0].system_tag, "LOS");
});

test("normalized changelog person still becomes a resolver record", () => {
  const resolver = resolverFromChangelog([
    {
      author: { displayName: "Alex", accountId: "a1" },
      items: [{ field: "status", toString: "Done" }],
    },
  ]);
  const rows = recordsFromIssue(
    {
      key: "ITHELP-10",
      fields: {
        summary: "VPN split tunnel drop",
        description: "Remote users lose VPN after SSO idle timeout.",
        labels: ["VPN"],
        assignee: { displayName: "Sam", accountId: "s1" },
      },
    },
    { baseUrl: "https://ex.atlassian.net", systemTags: "VPN", resolver }
  );
  assert.ok(rows.some((row) => row.role_signal === "resolver" && row.person === "Alex"));
});

test("confluence CQL scopes to spaces and labels", () => {
  const cql = buildExpertCql({ spaceKeys: "ITSOP", systemTags: "UPI" });
  assert.match(cql, /space = ITSOP/);
  assert.match(cql, /label = "UPI"/);
  assert.equal(buildExpertCql({ spaceKeys: "" }), "");
});

test("confluence page authors and editors become records", () => {
  const rows = recordsFromPage(
    {
      id: "42",
      title: "UPI Recon Runbook",
      body: { storage: { value: "<p>Nightly UPI reconciliation steps for ops.</p>" } },
      metadata: { labels: { results: [{ name: "UPI" }] } },
      history: { createdBy: { displayName: "Jordan", accountId: "j1" }, createdDate: "2026-01-01" },
      _links: { webui: "/spaces/ITSOP/pages/42" },
    },
    {
      baseUrl: "https://ex.atlassian.net",
      systemTags: "UPI",
      versions: [{ author: { displayName: "Morgan", accountId: "m1" }, createdAt: "2026-02-01" }],
    }
  );
  assert.ok(rows.some((row) => row.role_signal === "author" && row.person === "Jordan"));
  assert.ok(rows.some((row) => row.role_signal === "editor" && row.person === "Morgan"));
});

test("identical hashing vectors rank together and group by person", () => {
  const a = hashEmbed("LOS onboarding KYC timeout");
  const b = hashEmbed("LOS onboarding KYC timeout");
  const c = hashEmbed("unrelated printer jam");
  assert.ok(cosineSimilarity(a, b) > cosineSimilarity(a, c));
  const people = groupExperts([
    {
      ...makeRecord({
        source: "jira",
        person: "Alex",
        personAccountId: "a1",
        role_signal: "resolver",
        text: "LOS",
        date: new Date().toISOString(),
        reference_id: "ITHELP-1",
      }),
      similarity: 0.9,
    },
    {
      ...makeRecord({
        source: "jira",
        person: "Alex",
        personAccountId: "a1",
        role_signal: "commenter",
        text: "LOS",
        date: new Date().toISOString(),
        reference_id: "ITHELP-2",
      }),
      similarity: 0.8,
    },
    {
      ...makeRecord({
        source: "jira",
        person: "Sam",
        personAccountId: "s1",
        role_signal: "assignee",
        text: "LOS",
        date: new Date().toISOString(),
        reference_id: "ITHELP-3",
      }),
      similarity: 0.5,
    },
  ]);
  assert.equal(people[0].person, "Alex");
  assert.equal(people[0].matchCount, 2);
  assert.match(formatExpertResult(people[0]), /Alex/);
  assert.equal(personKey(personFromUser({ accountId: "a1", displayName: "Alex" })), "id:a1");
});
