const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const learned = require("./learned-choices");
const workbookStore = require("./workbook");

function markedStep(extra = {}) {
  return {
    id: "evidence",
    action: "fill",
    mandatory: true,
    allowedValues: ["eb1a", "EB2 NIW", "o1"],
    ...extra,
  };
}

test("merged list is static first, then each saved value once", () => {
  const step = markedStep();
  const rows = [
    { sop_id: "sop", step_id: "evidence", value: "published papers" },
    { sop_id: "sop", step_id: "evidence", value: "EB2 NIW" },
    { sop_id: "sop", step_id: "other", value: "ignored" },
    { sop_id: "sop", step_id: "evidence", value: "published papers" },
  ];
  assert.deepEqual(learned.mergedChoicesForStep(step, rows), [
    "eb1a",
    "EB2 NIW",
    "o1",
    "published papers",
  ]);
});

test("unmarked steps are not merged and the SOP list is not rewritten", () => {
  const step = markedStep({ mandatory: false });
  const original = step.allowedValues;
  const rows = [{ sop_id: "sop", step_id: "evidence", value: "published papers" }];
  assert.equal(learned.mergedChoicesForStep(step, rows), null);
  const sop = { id: "sop", steps: [step, markedStep({ id: "fee", action: "click" })] };
  const watched = learned.applyLearnedToSop(sop, rows);
  assert.equal(watched, sop);
  assert.equal(step.allowedValues, original);
  assert.deepEqual(step.allowedValues, ["eb1a", "EB2 NIW", "o1"]);
});

test("a new answer is stored once and a repeat or static value is not", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learned-choices-"));
  const step = markedStep();
  const first = await learned.rememberChoice({
    sopId: "sop",
    stepId: step.id,
    value: "  published papers  ",
    staticValues: learned.staticChoiceList(step),
    projectRoot: dir,
  });
  assert.equal(first.saved, true);
  assert.equal(first.row.value, "published papers");

  const again = await learned.rememberChoice({
    sopId: "sop",
    stepId: step.id,
    value: "Published   Papers",
    staticValues: learned.staticChoiceList(step),
    projectRoot: dir,
  });
  assert.equal(again.saved, false);

  const staticHit = await learned.rememberChoice({
    sopId: "sop",
    stepId: step.id,
    value: " EB1A ",
    staticValues: learned.staticChoiceList(step),
    projectRoot: dir,
  });
  assert.equal(staticHit.saved, false);

  const otherStep = await learned.rememberChoice({
    sopId: "sop",
    stepId: "deadline",
    value: "published papers",
    staticValues: [],
    projectRoot: dir,
  });
  assert.equal(otherStep.saved, true);

  const { LearnedChoices } = await workbookStore.readTables(["LearnedChoices"], dir);
  assert.equal(LearnedChoices.length, 2);
  assert.deepEqual(
    LearnedChoices.map((row) => [row.sop_id, row.step_id, row.value]),
    [
      ["sop", "evidence", "published papers"],
      ["sop", "deadline", "published papers"],
    ],
  );

  const grouped = await learned.groupedBySop(dir);
  const watched = learned.applyLearnedToSop(
    { id: "sop", steps: [step] },
    grouped.get("sop"),
  );
  assert.deepEqual(watched.steps[0].allowedValues, [
    "eb1a",
    "EB2 NIW",
    "o1",
    "published papers",
  ]);
  assert.deepEqual(step.allowedValues, ["eb1a", "EB2 NIW", "o1"]);
  assert.equal(fs.existsSync(path.join(dir, workbookStore.WORKBOOK_NAME)), true);
});

test("a follow-up edit of the same field replaces the row just saved", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learned-revise-"));
  const step = markedStep();
  const first = await learned.rememberChoice({
    sopId: "sop",
    stepId: step.id,
    value: "EB NIW: EB2 NIW selection",
    staticValues: learned.staticChoiceList(step),
    projectRoot: dir,
  });
  assert.equal(first.saved, true);
  const next = await learned.rememberChoice({
    sopId: "sop",
    stepId: step.id,
    value: "EB4 NIW: EB4 NIW selection",
    staticValues: learned.staticChoiceList(step),
    projectRoot: dir,
  });
  assert.equal(next.saved, true);
  assert.equal(next.revised, true);
  const { LearnedChoices } = await workbookStore.readTables(["LearnedChoices"], dir);
  assert.deepEqual(
    LearnedChoices.map((row) => row.value),
    ["EB4 NIW: EB4 NIW selection"],
  );
});
