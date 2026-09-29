const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  looksLikeServiceNow,
  isChangeNumber,
  changeNumberToken,
  snowNumberQuery,
  changeRequestSearchUrl,
} = require("./servicenow-search");

test("looksLikeServiceNow matches cloud and classic paths", () => {
  assert.equal(looksLikeServiceNow("https://acme.service-now.com/nav_to.do"), true);
  assert.equal(looksLikeServiceNow("https://itsm.example.com/change_request_list.do"), true);
  assert.equal(looksLikeServiceNow("https://jira.example.com/browse/CHG-1", "Jira"), false);
});

test("CHG numbers map to number query on the list", () => {
  const url = changeRequestSearchUrl(
    "https://acme.service-now.com/nav_to.do?uri=/incident.do",
    "chg0001234"
  );
  assert.match(url, /^https:\/\/acme\.service-now\.com\/change_request_list\.do\?/);
  assert.match(url, /sysparm_query=/);
  assert.match(url, /number=CHG0001234/);
});

test("bare digits become CHG tokens", () => {
  assert.equal(isChangeNumber("0040001"), true);
  assert.equal(changeNumberToken("0040001"), "CHG0040001");
});

test("snowNumberQuery builds a classic number lookup", () => {
  assert.equal(snowNumberQuery("RITM0203030"), "number=RITM0203030");
  assert.equal(snowNumberQuery("chg0404004"), "number=CHG0404004");
  assert.equal(snowNumberQuery("  "), "");
});

test("snowNumberInQuery keeps a one-line bundle lookup", () => {
  const { snowNumberInQuery } = require("./servicenow-search");
  assert.equal(snowNumberInQuery(["RITM0203030"]), "number=RITM0203030");
  const bundled = snowNumberInQuery(["RITM0203030", "CHG0404004", "SCTASK9203003"]);
  assert.match(bundled, /RITM0203030/);
  assert.match(bundled, /CHG0404004/);
  assert.match(bundled, /SCTASK9203003/);
  assert.doesNotMatch(bundled, /\n/);
  assert.doesNotMatch(bundled, /request/);
});

test("keywords search number and description on change_request", () => {
  const url = changeRequestSearchUrl("https://acme.service-now.com/", "weekend patch");
  assert.equal(url.includes("change_request_list.do"), true);
  assert.equal(url.includes("short_descriptionLIKE"), true);
  assert.equal(url.includes("weekend%20patch"), true);
  assert.equal(url.includes("incident"), false);
});
