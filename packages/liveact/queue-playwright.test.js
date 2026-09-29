const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadCardFromDir,
  persistQueuePlaywrightCaseData,
  cardHasAttachedPlaywright,
} = require("./documents");
const {
  sopStepsFromPlaywright,
  shouldAutoRunCardPlaywright,
  playwrightStepsOf,
} = require("./capture-forward");

function tmpCard(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lt-play-${id}-`));
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({ id, title: id, sopId: "shared-sop", formUrl: "https://example.test/apply" }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ firstName: "Harish" }, null, 2));
  return dir;
}

const fullstackSnippet = {
  ticket: "REF-20260914-1BK3",
  startUrl:
    "https://vanguard.wd5.myworkdayjobs.com/en-US/vanguard_external/job/Malvern%2C-PA/Application-Engineer---III_179797-1/apply/applyManually",
  steps: [
    {
      action: "fill",
      label: "First Name",
      value: "Harish",
      locator: { css: "#name--legalName--firstName", getByLabel: "First Name" },
    },
    {
      action: "click",
      label: "Save and Continue",
      pageUrl: "https://example.test/apply/info",
      locator: {
        css: '[data-automation-id="pageFooterNextButton"]',
        getByRole: { role: "button", name: "Save and Continue" },
      },
    },
    {
      action: "fill",
      label: "Job Title",
      value: "Engineer",
      pageUrl: "https://example.test/apply/experience",
      locator: { css: '[id$="--jobTitle"]', getByLabel: "Job Title" },
    },
  ],
};

test("card A script does not appear on card B after attach", () => {
  const dirA = tmpCard("card-a");
  const dirB = tmpCard("card-b");
  persistQueuePlaywrightCaseData(dirA, {
    startUrl: "https://example.test/a",
    steps: [{ action: "click", label: "Only A", locator: { css: "#only-a" } }],
  });
  persistQueuePlaywrightCaseData(dirB, null);
  const a = loadCardFromDir(dirA, "card-a", "TCOO");
  const b = loadCardFromDir(dirB, "card-b", "TCOO");
  assert.equal(cardHasAttachedPlaywright(a), true);
  assert.equal(playwrightStepsOf(a.playwright)[0].label, "Only A");
  assert.equal(cardHasAttachedPlaywright(b), false);
  assert.equal(b.playwright, null);
  const labelsA = sopStepsFromPlaywright(a.playwright).steps.map((s) => s.label);
  const labelsB = sopStepsFromPlaywright(b.playwright).steps.map((s) => s.label);
  assert.ok(labelsA.includes("Only A"));
  assert.equal(labelsB.includes("Only A"), false);
});

test("fullstack locators preserved (pageFooterNextButton, getByRole Save and Continue)", () => {
  const { steps } = sopStepsFromPlaywright(fullstackSnippet, { firstName: "Harish" });
  const save = steps.find((s) => s.label === "Save and Continue");
  assert.ok(save);
  assert.equal(save.locator.css, '[data-automation-id="pageFooterNextButton"]');
  assert.equal(save.locator.getByRole.role, "button");
  assert.equal(save.locator.getByRole.name, "Save and Continue");
  assert.equal(save.selector, '[data-automation-id="pageFooterNextButton"]');
});

test("cross-page waitAfter.urlIncludes when the next step pageUrl differs", () => {
  const { steps } = sopStepsFromPlaywright(fullstackSnippet);
  const save = steps.find((s) => s.label === "Save and Continue");
  assert.ok(save.waitAfter);
  assert.match(save.waitAfter.urlIncludes, /apply\/experience/);
});

test("Agent auto-run predicate is true only when the card has attached playwright steps", () => {
  assert.equal(shouldAutoRunCardPlaywright({}), false);
  assert.equal(shouldAutoRunCardPlaywright({ playwright: { steps: [] } }), false);
  assert.equal(
    shouldAutoRunCardPlaywright({
      playwright: { steps: [{ action: "click", label: "Go" }] },
    }),
    true
  );
  const dir = tmpCard("empty-play");
  fs.mkdirSync(path.join(dir, "play"));
  const empty = loadCardFromDir(dir, "empty-play", "TCOO");
  assert.equal(shouldAutoRunCardPlaywright(empty), false);
  assert.equal(cardHasAttachedPlaywright(empty), false);
});

test("sopStepsFromPlaywright copies screenshotPath", () => {
  const { steps } = sopStepsFromPlaywright({
    startUrl: "https://example.test/apply",
    steps: [
      {
        action: "fill",
        label: "Company",
        selector: "#company",
        value: "Acme",
        screenshotPath: "play/shots/001-fill-company.png",
        screenshotSource: "extension",
      },
    ],
  });
  assert.equal(steps[0].screenshotPath, "play/shots/001-fill-company.png");
  assert.equal(steps[0].screenshotSource, "extension");
  assert.deepEqual(steps[0].allowedValues, ["Acme"]);
});

test("same field name keeps each step's own recorded choice", () => {
  const { steps } = sopStepsFromPlaywright(
    {
      startUrl: "https://docs.google.com/forms/d/e/example/viewform",
      steps: [
        { action: "fill", label: "Your answer", value: "eb2 niw" },
        { action: "fill", label: "Your answer", value: "asap" },
      ],
      values: { "Your answer": "asap" },
    },
    { "Your answer": "asap" }
  );
  assert.deepEqual(steps[0].allowedValues, ["eb2 niw"]);
  assert.deepEqual(steps[1].allowedValues, ["asap"]);
  steps[0].label = "Visa category";
  steps[0].valueFrom = "visa-category";
  assert.deepEqual(steps[0].allowedValues, ["eb2 niw"]);
});
