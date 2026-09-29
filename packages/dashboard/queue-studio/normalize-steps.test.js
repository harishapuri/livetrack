const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStepsForSave } = require("./normalize-steps");

test("normalizeStepsForSave keeps screenshotPath", () => {
  const out = normalizeStepsForSave([
    {
      id: "Company Name",
      action: "fill",
      label: "Company",
      valueFrom: "company",
      screenshotPath: "play/shots/001-fill-company.png",
      screenshotSource: "extension",
      locator: { css: "#company" },
      pageUrl: "https://example.test/apply",
    },
  ]);
  assert.equal(out[0].screenshotPath, "play/shots/001-fill-company.png");
  assert.equal(out[0].screenshotSource, "extension");
  assert.equal(out[0].locator.css, "#company");
  assert.equal(out[0].pageUrl, "https://example.test/apply");
  assert.equal(out[0].id, "company-name");
});

test("normalizeStepsForSave keeps explanation", () => {
  const out = normalizeStepsForSave([
    {
      id: "company",
      action: "fill",
      label: "Company",
      explanation: "  Enter the legal company name.  ",
    },
    {
      id: "email",
      action: "fill",
      label: "Email",
      explanation: "   ",
    },
  ]);
  assert.equal(out[0].explanation, "Enter the legal company name.");
  assert.equal(out[1].explanation, undefined);
});

test("normalizeStepsForSave keeps one value, several choices, and drops an empty list", () => {
  const out = normalizeStepsForSave([
    {
      id: "city",
      action: "fill",
      label: "City",
      allowedValues: ["  Austin  "],
    },
    {
      id: "state",
      action: "fill",
      label: "State",
      allowedValues: [" TX ", "", " WA "],
    },
    {
      id: "empty",
      action: "fill",
      label: "Empty",
      allowedValues: ["  ", ""],
      value: "should-not-keep",
    },
    {
      id: "legacy",
      action: "fill",
      label: "Legacy",
      value: "  Seattle ",
    },
    {
      id: "go",
      action: "click",
      label: "Go",
      value: "nope",
    },
  ]);
  assert.deepEqual(out[0].allowedValues, ["Austin"]);
  assert.equal(out[0].value, "Austin");
  assert.deepEqual(out[1].allowedValues, ["TX", "WA"]);
  assert.equal(out[1].value, "TX");
  assert.equal(out[2].allowedValues, undefined);
  assert.equal(out[2].value, undefined);
  assert.deepEqual(out[3].allowedValues, ["Seattle"]);
  assert.equal(out[3].value, "Seattle");
  assert.equal(out[4].allowedValues, undefined);
  assert.equal(out[4].value, "nope");
});

test("normalizeStepsForSave keeps check and select choices after a field rename", () => {
  const out = normalizeStepsForSave([
    {
      id: "name-star",
      action: "check",
      label: "Corrected name question",
      valueFrom: "name-question",
      allowedValues: ["yes"],
    },
    {
      id: "state",
      action: "select",
      label: "State",
      valueFrom: "state",
      value: "TX",
    },
  ]);
  assert.deepEqual(out[0].allowedValues, ["yes"]);
  assert.equal(out[0].value, "yes");
  assert.equal(out[0].valueFrom, "name-question");
  assert.deepEqual(out[1].allowedValues, ["TX"]);
  assert.equal(out[1].value, "TX");
});

test("normalizeStepsForSave keeps a website finder that differs from the LiveTrack name", () => {
  const out = normalizeStepsForSave([
    {
      id: "education-current-status",
      action: "check",
      label: "education current status",
      findByLabel: ["education current status", "What is your current academic & professional status?"],
      finder: "What is your current academic & professional status?",
      allowedValues: ["Completed Master's Degree"],
    },
  ]);
  assert.equal(out[0].label, "education current status");
  assert.equal(out[0].findByLabel, "education current status");
  assert.equal(out[0].finder, "What is your current academic & professional status?");
});

test("normalizeStepsForSave keeps a stable GUI id and drops a generic tag selector", () => {
  const out = normalizeStepsForSave([
    {
      id: "salary",
      action: "fill",
      label: "salary per annual usd",
      selector: "input",
      guiId: '[name="salary per annual usd"]',
      allowedValues: ["90000"],
    },
  ]);
  assert.equal(out[0].guiId, '[name="salary per annual usd"]');
  assert.equal(out[0].selector, '[name="salary per annual usd"]');
});
