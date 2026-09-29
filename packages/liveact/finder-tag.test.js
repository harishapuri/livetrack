const { test } = require("node:test");
const assert = require("node:assert/strict");
const { captureEventsToSopSteps } = require("./process-discovery");
const { playwrightFromTxn } = require("./capture-forward");

test("a queue step keeps the summarized name and the website finder", () => {
  const { steps } = captureEventsToSopSteps([
    {
      action: "check",
      fieldName: "education current status",
      label: "education current status",
      value: "Completed Master's Degree",
      selectedText: "Completed Master's Degree",
      finder: "What is your current academic & professional status?",
    },
  ]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "education current status");
  assert.equal(steps[0].finder, "What is your current academic & professional status?");
  assert.ok(
    steps[0].findByLabel.some((hint) => hint === "What is your current academic & professional status?"),
  );
});

test("playwright steps search the website finder when the LiveTrack name differs", () => {
  const script = playwrightFromTxn({
    pageUrl: "https://example.test/apply",
    steps: [
      {
        action: "fill",
        fieldName: "salary per annual usd",
        label: "salary per annual usd",
        value: "90000",
        finder: "What is your current annual salary in USD?",
      },
    ],
  });
  const step = script.steps[0];
  assert.equal(step.label, "salary per annual usd");
  assert.equal(step.finder, "What is your current annual salary in USD?");
  assert.deepEqual(step.findByLabel, [
    "salary per annual usd",
    "What is your current annual salary in USD?",
  ]);
});
