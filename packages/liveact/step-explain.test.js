const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assignExplanations } = require("./step-explain");
const { captureEventsToSopSteps } = require("./process-discovery");
const { stepsOf, playwrightFromTxn } = require("./capture-forward");
const { groupCaptureEvents } = require("./pdf-server");

test("speech after a step and before the next step is that step's explanation", () => {
  const steps = [{ stepAt: 1000 }, { stepAt: 5000 }];
  const utterances = [
    { at: 500, text: "before the first click" },
    { at: 1500, text: "first note" },
    { at: 6000, text: "tail note" },
  ];
  const open = assignExplanations(steps, utterances, { flush: false });
  assert.equal(open.explanations[0], "before the first click first note");
  assert.equal(open.explanations[1], "");
  assert.equal(open.pending, "tail note");
});

test("stopping record flushes leftover speech onto the last step", () => {
  const steps = [{ stepAt: 1000 }, { stepAt: 5000 }];
  const utterances = [
    { at: 1500, text: "first note" },
    { at: 6000, text: "tail note" },
  ];
  const closed = assignExplanations(steps, utterances, { flush: true });
  assert.equal(closed.explanations[0], "first note");
  assert.equal(closed.explanations[1], "tail note");
  assert.equal(closed.pending, "");
});

test("captureEventsToSopSteps copies explanation onto the SOP step", () => {
  const { steps } = captureEventsToSopSteps([
    {
      action: "fill",
      label: "Company name",
      fieldName: "Company name",
      value: "Acme",
      selector: "#company",
      explanation: "Enter the legal name",
    },
  ]);
  assert.equal(steps[0].explanation, "Enter the legal name");
  assert.equal(steps[0].label, "Company name");
  assert.deepEqual(steps[0].allowedValues, ["Acme"]);
  assert.equal(steps[0].value, "Acme");
});

test("recorded answers stay on each step when field names collide or change", () => {
  const { steps } = captureEventsToSopSteps([
    {
      action: "fill",
      label: "Your answer",
      fieldName: "Your answer",
      value: "eb2 niw",
    },
    {
      action: "check",
      label: "yes",
      fieldName: "Name *",
      question: "Name *",
      value: "yes",
    },
    {
      action: "fill",
      label: "Your answer",
      fieldName: "Your answer",
      value: "asap",
    },
    {
      action: "fill",
      label: "I40",
      fieldName: "I40",
      value: "Michael E. (Northeastern University Assistant Professor).",
    },
  ]);
  assert.equal(steps.length, 4);
  assert.deepEqual(steps[0].allowedValues, ["eb2 niw"]);
  assert.deepEqual(steps[1].allowedValues, ["yes"]);
  assert.equal(steps[1].action, "check");
  assert.deepEqual(steps[2].allowedValues, ["asap"]);
  assert.notEqual(steps[0].id, steps[2].id);
  assert.deepEqual(steps[3].allowedValues, [
    "Michael E. (Northeastern University Assistant Professor).",
  ]);
  steps[0].valueFrom = "renamed-field";
  steps[0].label = "Corrected question";
  assert.deepEqual(steps[0].allowedValues, ["eb2 niw"]);
});

test("grouped capture steps and playwright steps keep explanation", () => {
  const txns = groupCaptureEvents([
    {
      ts: "2026-09-24T16:00:00.000Z",
      action: "fill",
      label: "Company name",
      fieldName: "Company name",
      value: "Acme",
      selector: "#company",
      pageUrl: "https://example.test/form",
      recordingSessionId: "sess-explain",
      captureEventId: "evt-1",
    },
    {
      kind: "step_explanation",
      captureEventId: "evt-1",
      explanation: "Enter the legal name",
    },
  ]);
  assert.equal(txns[0].steps[0].explanation, "Enter the legal name");
  assert.equal(txns[0].steps[0].captureEventId, "evt-1");
  assert.equal(txns[0].steps[0].stepAt, "2026-09-24T16:00:00.000Z");

  const txn = {
    pageUrl: "https://example.test/form",
    steps: [
      {
        action: "fill",
        label: "Company name",
        fieldName: "Company name",
        value: "Acme",
        selector: "#company",
        explanation: "Enter the legal name",
      },
    ],
  };
  assert.equal(stepsOf(txn)[0].explanation, "Enter the legal name");
  const script = playwrightFromTxn(txn);
  assert.equal(script.steps[0].explanation, "Enter the legal name");
});
