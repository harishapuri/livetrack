const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isDenied, filterActivePeople } = require("./expert-rank");

test("denylist drops named or emailed people", () => {
  const deny = new Set(["gone@coact.local", "departed user"]);
  assert.equal(isDenied({ person: "Alex", personEmail: "gone@coact.local" }, deny), true);
  assert.equal(isDenied({ person: "Departed User", personEmail: "" }, deny), true);
  assert.equal(isDenied({ person: "Alex", personEmail: "alex@coact.local" }, deny), false);
});

test("inactive Jira accounts are removed from the ranking", async () => {
  const people = [
    { person: "Gone", personAccountId: "gone", personEmail: "gone@coact.local", score: 9 },
    { person: "Alex", personAccountId: "a1", personEmail: "alex@coact.local", score: 4 },
  ];
  const filtered = await filterActivePeople(
    people,
    { expertInactiveEmails: "" },
    { fetchActive: async (_config, accountId) => accountId !== "gone" }
  );
  assert.deepEqual(
    filtered.map((row) => row.person),
    ["Alex"]
  );
});
