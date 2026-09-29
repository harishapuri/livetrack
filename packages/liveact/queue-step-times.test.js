const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const workbookStore = require("./workbook");

function stepKey(row) {
  return `${row.run_id}\0${row.step_id}`;
}

test("QueueStepTimes upserts one row per run and step", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-step-times-"));
  const first = {
    queue_card_id: "card-a",
    run_id: "run-1",
    step_id: "name",
    label: "Name",
    step_start_time: "2026-09-25T12:00:00.000Z",
    step_end_time: "2026-09-25T12:01:00.000Z",
  };
  await workbookStore.upsertRows("QueueStepTimes", [first], stepKey, dir);
  await workbookStore.upsertRows(
    "QueueStepTimes",
    [
      {
        ...first,
        step_end_time: "2026-09-25T12:02:00.000Z",
      },
      {
        queue_card_id: "card-a",
        run_id: "run-1",
        step_id: "email",
        label: "Email",
        step_start_time: "2026-09-25T12:02:00.000Z",
        step_end_time: "2026-09-25T12:03:00.000Z",
      },
    ],
    stepKey,
    dir,
  );
  await workbookStore.upsertRows(
    "QueueStepTimes",
    [
      {
        queue_card_id: "card-a",
        run_id: "run-2",
        step_id: "name",
        label: "Name",
        step_start_time: "2026-09-25T13:00:00.000Z",
        step_end_time: "2026-09-25T13:01:00.000Z",
      },
    ],
    stepKey,
    dir,
  );

  const { QueueStepTimes } = await workbookStore.readTables(["QueueStepTimes"], dir);
  assert.deepEqual(
    QueueStepTimes.map((row) => [row.run_id, row.step_id, row.step_start_time, row.step_end_time]),
    [
      ["run-1", "name", "2026-09-25T12:00:00.000Z", "2026-09-25T12:02:00.000Z"],
      ["run-1", "email", "2026-09-25T12:02:00.000Z", "2026-09-25T12:03:00.000Z"],
      ["run-2", "name", "2026-09-25T13:00:00.000Z", "2026-09-25T13:01:00.000Z"],
    ],
  );
  assert.equal(fs.existsSync(path.join(dir, workbookStore.WORKBOOK_NAME)), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
