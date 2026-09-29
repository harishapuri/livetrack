const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  groupCaptureEvents,
  isNavigationClick,
  isJunkCaptureName,
} = require("./pdf-server");
const { playwrightFromTxn, captureTransactionRecord, cleanCaptureDisplayPairs } = require("./capture-forward");
const { captureLooksLikeChoiceValue, isNavigationClickLabel, captureLooksLikeJunkFieldKey } = require("./capture-dom");

test("Save and Continue / Add Another are navigation clicks, not choice values", () => {
  assert.equal(isNavigationClickLabel("Save and Continue"), true);
  assert.equal(isNavigationClickLabel("Add Another"), true);
  assert.equal(captureLooksLikeChoiceValue("Save and Continue"), false);
  assert.equal(captureLooksLikeChoiceValue("Add Another"), false);
  assert.equal(captureLooksLikeChoiceValue("Yes"), true);
});

test("groupCaptureEvents keeps footer buttons as clicks", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-14T02:07:53.000Z",
      action: "check",
      fieldName: "How Did You Hear About Us?",
      label: "How Did You Hear About Us?",
      value: "Save and Continue",
      selectedText: "Save and Continue",
      selector: '[data-automation-id="pageFooterNextButton"]',
      pageUrl: "https://example.test/apply",
    },
    {
      ts: "2026-09-14T02:07:55.000Z",
      action: "check",
      fieldName: "Add any relevant websites.",
      label: "Add any relevant websites.",
      value: "Add Another",
      selectedText: "Add Another",
      selector: '[data-automation-id="add-button"]',
      pageUrl: "https://example.test/apply",
    },
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(
    grouped[0].clicks.map((c) => c.label),
    ["Save and Continue", "Add Another"],
  );
  assert.equal(grouped[0].fields["How Did You Hear About Us?"], undefined);
  assert.equal(grouped[0].steps.every((s) => s.action === "click"), true);
});

test("playwrightFromTxn reclassifies stored check+Save and Continue and keeps locators", () => {
  const txn = {
    pageUrl: "https://example.test/apply",
    pageTitle: "Apply",
    completedAt: "2026-09-14T02:09:07.848Z",
    fields: { "First Name*": "Harish" },
    steps: [
      {
        action: "fill",
        label: "First Name*",
        fieldName: "First Name*",
        selector: "#name--legalName--firstName",
        value: "Harish",
        pageUrl: "https://example.test/apply",
      },
      {
        action: "fill",
        label: "First Name*",
        fieldName: "First Name*",
        selector: "#name--legalName--firstName",
        value: "Harish",
        pageUrl: "https://example.test/apply",
      },
      {
        action: "check",
        label: "How Did You Hear About Us?*1 item selected",
        fieldName: "How Did You Hear About Us?*1 item selected",
        selector: '[data-automation-id="pageFooterNextButton"]',
        value: "Save and Continue",
        pageUrl: "https://example.test/apply",
      },
      {
        action: "fill",
        label: "Job Title",
        selector: "#jobTitle",
        value: "Engineer 1",
        pageUrl: "https://example.test/apply",
      },
      {
        action: "check",
        label: "Add any relevant websites.",
        selector: '[data-automation-id="add-button"]',
        value: "Add Another",
        pageUrl: "https://example.test/apply",
      },
      {
        action: "fill",
        label: "Job Title",
        selector: "#jobTitle",
        value: "Engineer 2",
        pageUrl: "https://example.test/apply",
      },
    ],
    clicks: [],
  };
  const pw = playwrightFromTxn(txn);
  assert.equal(pw.startUrl, "https://example.test/apply");
  const actions = pw.steps.map((s) => `${s.action}:${s.value}`);
  assert.deepEqual(actions, [
    "fill:Harish",
    "click:Save and Continue",
    "fill:Engineer 1",
    "click:Add Another",
    "fill:Engineer 2",
  ]);
  assert.equal(pw.steps[0].locator.css, "#name--legalName--firstName");
  assert.equal(pw.steps[0].locator.getByLabel, "First Name");
  assert.equal(pw.steps[1].locator.getByRole.role, "button");
  assert.equal(pw.steps[1].locator.getByRole.name, "Save and Continue");

  const rec = captureTransactionRecord(txn);
  assert.equal(rec.clicks.length, 2);
  assert.equal(rec.playwright.steps.length, 5);
  assert.equal(isNavigationClick(pw.steps[1]), true);
  assert.equal(rec.values["How Did You Hear About Us?*1 item selected"], undefined);
});

test("playwrightScriptFromSop uses capture txn locators and matches by URL", () => {
  const {
    playwrightScriptFromSop,
    compactPlaywrightScript,
    findCaptureTxnForSop,
  } = require("./capture-forward");
  const txn = {
    ticket: "REF-20260914-1BK3",
    pageUrl:
      "https://vanguard.wd5.myworkdayjobs.com/en-US/vanguard_external/job/Malvern%2C-PA/Application-Engineer---III_179797-1/apply/applyManually",
    pageTitle: "Full Stack Software Engineer",
    fields: { "First Name*": "Harish" },
    clicks: [
      {
        action: "click",
        label: "Save and Continue",
        selector: '[data-automation-id="pageFooterNextButton"]',
      },
      {
        action: "click",
        label: "Add",
        selector: '[data-automation-id="add-button"]',
      },
    ],
    steps: [
      {
        action: "click",
        label: "Save and Continue",
        selector: '[data-automation-id="pageFooterNextButton"]',
        value: "Save and Continue",
        pageUrl:
          "https://vanguard.wd5.myworkdayjobs.com/en-US/vanguard_external/job/Malvern%2C-PA/Application-Engineer---III_179797-1/apply/applyManually",
      },
      {
        action: "click",
        label: "Add",
        selector: '[data-automation-id="add-button"]',
        value: "Add",
        pageUrl:
          "https://vanguard.wd5.myworkdayjobs.com/en-US/vanguard_external/job/Malvern%2C-PA/Application-Engineer---III_179797-1/apply/applyManually",
      },
    ],
  };
  const sop = {
    id: "discovered-vanguard-wd5-myworkdayjobs-com-en-us-van-mu213kze",
    formUrl:
      "https://vanguard.wd5.myworkdayjobs.com/en-US/vanguard_external/job/Malvern%2C-PA/Application-Engineer---III_179797-1/apply/applyManually",
    steps: [{ id: "save", action: "click", label: "Save and Continue", selector: "button" }],
    sampleData: {},
  };
  const matched = findCaptureTxnForSop(sop, [txn]);
  assert.equal(matched, txn);
  const script = playwrightScriptFromSop(sop, matched);
  const compact = compactPlaywrightScript(script);
  assert.equal(compact.ticket, "REF-20260914-1BK3");
  assert.match(compact.startUrl, /applyManually/);
  assert.deepEqual(
    compact.clicks.map((c) => c.label),
    ["Save and Continue", "Add"]
  );
  assert.equal(compact.clicks[0].locator.getByRole.name, "Save and Continue");
  assert.equal(compact.clicks[0].selector, '[data-automation-id="pageFooterNextButton"]');
});

test("playwrightCaseData puts ticket, startUrl, and clicks first and keeps fill values", () => {
  const { playwrightCaseData } = require("./capture-forward");
  const data = playwrightCaseData(
    {
      ticket: "REF-20260914-1BK3",
      startUrl: "https://example.test/apply",
      clicks: [
        {
          action: "click",
          label: "Save and Continue",
          selector: '[data-automation-id="pageFooterNextButton"]',
          locator: { getByRole: { role: "button", name: "Save and Continue" } },
        },
      ],
      values: { "First Name*": "Harish" },
    },
    { "Job Title": "Engineer" }
  );
  assert.deepEqual(Object.keys(data).slice(0, 3), ["ticket", "startUrl", "clicks"]);
  assert.equal(data.ticket, "REF-20260914-1BK3");
  assert.equal(data.clicks[0].label, "Save and Continue");
  assert.equal(data["First Name*"], "Harish");
  assert.equal(data["Job Title"], "Engineer");
});

test("groupCaptureEvents duplicate click keeps the screenshot from the later event", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-24T21:03:38.000Z",
      action: "click",
      label: "Apply",
      value: "Apply",
      selector: "[data-automation-id='adventureButton']",
      pageUrl: "https://example.test/job",
      captureEventId: "evt-click",
    },
    {
      ts: "2026-09-24T21:03:39.000Z",
      action: "click",
      label: "Apply",
      value: "Apply",
      selector: "[data-automation-id='adventureButton']",
      pageUrl: "https://example.test/job",
      captureEventId: "evt-click",
      screenshotPath: "/tmp/apply.png",
      screenshotSource: "extension",
    },
  ]);
  assert.equal(grouped[0].steps.length, 1);
  assert.equal(grouped[0].steps[0].screenshotPath, "/tmp/apply.png");
});

test("groupCaptureEvents applies a step_screenshot patch onto the step", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-24T21:03:38.000Z",
      action: "check",
      label: "Professional Organization",
      fieldName: "Professional Organization",
      value: "Yes",
      selector: "#org",
      pageUrl: "https://example.test/job",
      captureEventId: "evt-org",
      recordingSessionId: "sess-ppt",
    },
    {
      kind: "step_screenshot",
      captureEventId: "evt-org",
      screenshotPath: "/tmp/org.png",
      screenshotSource: "extension",
    },
  ]);
  assert.equal(grouped[0].steps[0].screenshotPath, "/tmp/org.png");
});

test("groupCaptureEvents fill overwrite keeps the latest screenshotPath", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-22T12:00:00.000Z",
      action: "change",
      fieldName: "Company",
      label: "Company",
      value: "A",
      selector: "#company",
      pageUrl: "https://example.test/apply",
      screenshotPath: "/tmp/shot-a.png",
    },
    {
      ts: "2026-09-22T12:00:02.000Z",
      action: "change",
      fieldName: "Company",
      label: "Company",
      value: "Acme",
      selector: "#company",
      pageUrl: "https://example.test/apply",
      screenshotPath: "/tmp/shot-b.png",
      screenshotAt: "2026-09-22T12:00:02.000Z",
      screenshotSource: "extension",
    },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].steps.length, 1);
  assert.equal(grouped[0].steps[0].value, "Acme");
  assert.equal(grouped[0].steps[0].screenshotPath, "/tmp/shot-b.png");
  const pw = playwrightFromTxn(grouped[0]);
  assert.equal(pw.steps[0].screenshotPath, "/tmp/shot-b.png");
});

test("groupCaptureEvents stores the website finder when the LiveTrack name differs", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-26T12:00:00.000Z",
      action: "check",
      fieldName: "education current status",
      label: "education current status",
      value: "Completed Master's Degree",
      selectedText: "Completed Master's Degree",
      finder: "What is your current academic & professional status?",
      selector: "[name='education current status']",
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-finder",
    },
    {
      ts: "2026-09-26T12:00:05.000Z",
      action: "change",
      fieldName: "salary per annual usd",
      label: "salary per annual usd",
      value: "90000",
      finder: "What is your current annual salary in USD?",
      selector: "[name='salary per annual usd']",
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-finder",
    },
  ]);
  assert.equal(grouped.length, 1);
  const byName = Object.fromEntries(grouped[0].steps.map((step) => [step.fieldName, step]));
  assert.equal(byName["education current status"].finder, "What is your current academic & professional status?");
  assert.equal(byName["salary per annual usd"].finder, "What is your current annual salary in USD?");
  const stored = JSON.parse(grouped[0].payload);
  assert.equal(
    stored.steps.find((step) => step.fieldName === "salary per annual usd").finder,
    "What is your current annual salary in USD?",
  );
});

test("groupCaptureEvents stores a stable GUI id for the field", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-26T12:01:00.000Z",
      action: "change",
      fieldName: "salary per annual usd",
      label: "salary per annual usd",
      value: "90000",
      selector: '[name="salary per annual usd"]',
      guiId: '[name="salary per annual usd"]',
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-gui",
    },
  ]);
  assert.equal(grouped[0].steps[0].guiId, '[name="salary per annual usd"]');
  assert.equal(JSON.parse(grouped[0].payload).steps[0].guiId, '[name="salary per annual usd"]');
});

test("a later internal name does not replace the website question", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-26T13:00:00.000Z",
      action: "check",
      fieldName: "Are you currently employed in the USA? *",
      label: "Are you currently employed in the USA? *",
      value: "NO",
      guiId: '[name="employed_in_usa"]',
      selector: '[name="employed_in_usa"]',
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-q",
    },
    {
      ts: "2026-09-26T13:00:01.000Z",
      action: "check",
      fieldName: "employed_in_usa",
      label: "employed_in_usa",
      value: "NO",
      guiId: '[name="employed_in_usa"]',
      selector: '[name="employed_in_usa"]',
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-q",
    },
  ]);
  assert.equal(grouped[0].steps.length, 1);
  assert.equal(grouped[0].steps[0].label, "Are you currently employed in the USA? *");
  assert.equal(grouped[0].steps[0].value, "NO");
});

test("dropdown screen-reader text and react-select ids are not field names", () => {
  const instructions =
    "Use Up and Down to choose options, press Enter to select the currently focused option, press Escape to exit the menu, press Tab to select the option and exit the menu.";
  assert.equal(isJunkCaptureName(instructions), true);
  assert.equal(isJunkCaptureName("React-select-7-listbox"), true);
  assert.equal(captureLooksLikeJunkFieldKey(instructions), true);
  assert.equal(captureLooksLikeJunkFieldKey("React-select-7-listbox"), true);
  assert.equal(isJunkCaptureName("Country of Birth"), false);
});

test("a one-character option change is not its own field beside the dropdown", () => {
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-26T18:00:00.000Z",
      action: "change",
      fieldName: "British Indian Ocean Territory",
      label: "British Indian Ocean Territory",
      value: "1",
      recordingSessionId: "sess-opt",
    },
    {
      ts: "2026-09-26T18:00:00.060Z",
      action: "select",
      fieldName: "What is your Country of Birth?",
      label: "What is your Country of Birth?",
      value: "India",
      recordingSessionId: "sess-opt",
    },
    {
      ts: "2026-09-26T18:00:01.000Z",
      action: "check",
      fieldName: "(Check all that apply)",
      label: "(Check all that apply)",
      value: "EB-1A Green Card",
      recordingSessionId: "sess-opt",
    },
    {
      ts: "2026-09-26T18:00:01.050Z",
      action: "check",
      fieldName: "EB-1A Green Card",
      label: "EB-1A Green Card",
      value: "EB-1A Green Card",
      recordingSessionId: "sess-opt",
    },
  ]);
  const steps = grouped[0].steps.filter((s) => s.action !== "click");
  assert.deepEqual(
    steps.map((s) => [s.label, s.value]),
    [
      ["What is your Country of Birth?", "British Indian Ocean Territory"],
      ["EB-1A Green Card", "EB-1A Green Card"],
    ],
  );
});

test("one dropdown keeps the last value and drops the menu chrome", () => {
  const instructions =
    "Use Up and Down to choose options, press Enter to select the currently focused option, press Escape to exit the menu, press Tab to select the option and exit the menu.";
  const grouped = groupCaptureEvents([
    {
      ts: "2026-09-26T12:02:00.000Z",
      action: "select",
      fieldName: instructions,
      label: instructions,
      value: "India",
      selector: "#React-select-7-listbox",
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-dd",
    },
    {
      ts: "2026-09-26T12:02:01.000Z",
      action: "check",
      fieldName: "India",
      label: "India",
      value: "India",
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-dd",
    },
    {
      ts: "2026-09-26T12:02:02.000Z",
      action: "select",
      fieldName: "Country of Birth",
      label: "Country of Birth",
      value: "Social Media",
      guiId: "#country-of-birth",
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-dd",
    },
    {
      ts: "2026-09-26T12:02:03.000Z",
      action: "select",
      fieldName: "Country of Birth",
      label: "Country of Birth",
      value: "India",
      guiId: "#country-of-birth",
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-dd",
    },
    {
      ts: "2026-09-26T12:02:04.000Z",
      action: "change",
      fieldName: "Contact Number",
      label: "Contact Number",
      value: "+1 945 217 0438",
      selector: 'input[type="tel"]',
      pageUrl: "https://example.test/apply",
      recordingSessionId: "sess-dd",
    },
  ]);
  const steps = grouped[0].steps.filter((s) => s.action !== "click");
  assert.deepEqual(
    steps.map((s) => [s.label, s.value]),
    [
      ["India", "India"],
      ["Country of Birth", "India"],
      ["Contact Number", "+1 945 217 0438"],
    ],
  );
  const pairs = cleanCaptureDisplayPairs(steps, grouped[0].fields);
  assert.deepEqual(
    pairs.map((p) => [p.key, p.value]),
    [
      ["Country of Birth", "India"],
      ["Contact Number", "+1 945 217 0438"],
    ],
  );
});
