const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isShortOptionLabel,
  isWeakQuestionHint,
  distinctiveQuestionHints,
  pickBestStepForTitle,
  titleMatchScore,
} = require("./step-match.js");

test("Yes/No and Workday widget names are not distinctive questions", () => {
  assert.equal(isShortOptionLabel("Yes"), true);
  assert.equal(isShortOptionLabel("No"), true);
  assert.equal(isWeakQuestionHint("OneYesNo"), true);
  assert.equal(isWeakQuestionHint("URL*"), false);
});

test("distinctive hints drop Yes and OneYesNo so they cannot steal later steps", () => {
  const step = {
    action: "check",
    label: "OneYesNo",
    findByLabel: ["OneYesNo"],
    findByText: ["Yes"],
  };
  assert.deepEqual(distinctiveQuestionHints(step), []);
  const real = {
    action: "check",
    label: "Do you have any post-employment obligations to any current or former employer?",
    findByLabel: ["Do you have any post-employment obligations to any current or former employer?"],
    findByText: ["Yes"],
  };
  assert.ok(distinctiveQuestionHints(real)[0].includes("post-employment"));
});

test("check validates Yes/No instead of publishing any selected option", () => {
  const { evaluateCheckSelection } = require("./step-match.js");
  assert.equal(evaluateCheckSelection("", ["Yes"]).ok, false);
  assert.equal(evaluateCheckSelection("No", ["Yes"]).ok, false);
  assert.equal(evaluateCheckSelection("No", ["Yes"]).wrong, true);
  assert.equal(evaluateCheckSelection("Yes", ["Yes"]).ok, true);
  assert.equal(evaluateCheckSelection("Yes for citizenship", ["Yes"]).ok, true);
  assert.equal(evaluateCheckSelection("Yes", []).ok, true);
});

test("Select One and question+options copy are not filled answers", () => {
  const { looksLikePlaceholder, effectiveChoiceValue } = require("./step-match.js");
  assert.equal(looksLikePlaceholder("Select One"), true);
  assert.equal(effectiveChoiceValue("Select One"), "");
  assert.equal(
    effectiveChoiceValue(
      "Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum? Select One",
      ["Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum?"]
    ),
    ""
  );
  assert.equal(effectiveChoiceValue("Select One Yes No"), "");
  assert.equal(
    effectiveChoiceValue("Yes", [
      "Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum?",
    ]),
    "yes"
  );
  assert.equal(
    effectiveChoiceValue(
      "Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum? Yes",
      ["Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum?"]
    ),
    "yes"
  );
});

test("education combobox and YYYY year fields match their steps", () => {
  const {
    pickBestStepForControl,
    looksLikePlaceholder,
  } = require("./step-match.js");
  const steps = [
    { id: "degree", action: "select", label: "Masters", findByLabel: ["Masters"] },
    { id: "fos", action: "fill", label: "Field of Study", findByLabel: ["Field of Study"] },
    { id: "year", action: "fill", label: "YYYY", findByLabel: ["YYYY"] },
    {
      id: "ref",
      action: "check",
      label: "To the best of your knowledge, did either of the following relatives work at this company?",
      findByLabel: [
        "To the best of your knowledge, did either of the following relatives work at this company?",
      ],
      findByText: ["Yes"],
    },
  ];
  assert.equal(looksLikePlaceholder("YYYY"), true);
  assert.equal(
    pickBestStepForControl(steps, { title: "Degree", value: "Masters" })?.id,
    "degree"
  );
  assert.equal(
    pickBestStepForControl(steps, { title: "Field of Study", value: "Computer Science" })?.id,
    "fos"
  );
  assert.equal(
    pickBestStepForControl(steps, { placeholder: "YYYY", aria: "Year", value: "2020" })?.id,
    "year"
  );
  assert.equal(
    pickBestStepForControl(steps, { title: "Yes", value: "Yes" }),
    null
  );
});

test("a renamed Clear form button matches its label when findByText is still Submit", () => {
  const { clickButtonHints, pickClickStepByButtonText } = require("./step-match.js");
  const steps = [
    {
      id: "expert",
      action: "click",
      label: "Which expert would like to request a letter from?",
      findByLabel: "I40",
    },
    {
      id: "click-submit",
      action: "click",
      label: "Clear form",
      findByText: ["Submit"],
    },
  ];
  assert.deepEqual(clickButtonHints(steps[1]), ["submit", "clear form"]);
  assert.equal(clickButtonHints(steps[0]).length, 0);
  assert.equal(pickClickStepByButtonText(steps, "Clear form")?.id, "click-submit");
  assert.equal(pickClickStepByButtonText(steps, "Submit")?.id, "click-submit");
});

test("clicking Yes on an earlier question does not pick a later Yes/No step", () => {
  const steps = [
    {
      id: "url",
      action: "fill",
      label: "URL*",
      findByLabel: ["URL*"],
    },
    {
      id: "post-emp",
      action: "check",
      label: "Do you have any post-employment obligations to any current or former employer?",
      findByLabel: ["Do you have any post-employment obligations to any current or former employer?"],
      findByText: ["Yes"],
    },
    {
      id: "citizen",
      action: "check",
      label: "Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum?",
      findByLabel: ["Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum?"],
      findByText: ["Yes"],
    },
  ];
  assert.equal(pickBestStepForTitle(steps, "Yes"), null);
  assert.equal(pickBestStepForTitle(steps, "URL*"), steps[0]);
  assert.equal(
    pickBestStepForTitle(steps, "Do you have any post-employment obligations to any current or former employer?"),
    steps[1]
  );
  assert.equal(
    pickBestStepForTitle(steps, "Are you a U.S. citizen, lawful permanent resident, refugee, or person granted asylum?"),
    steps[2]
  );
  assert.equal(titleMatchScore("Have you worked at Vanguard before?", distinctiveQuestionHints(steps[1])), 0);
});

test("isStableGuiSelector accepts an id or name and rejects a bare tag", () => {
  const { isStableGuiSelector } = require("./step-match.js");
  assert.equal(isStableGuiSelector("#educationStatus"), true);
  assert.equal(isStableGuiSelector('[name="salary per annual usd"]'), true);
  assert.equal(isStableGuiSelector("input"), false);
  assert.equal(isStableGuiSelector('input[type="text"]'), false);
});

test("a summarized LiveTrack name falls back to the website finder label", () => {
  const { pickBestStepForControl, pickBestStepForTitle } = require("./step-match.js");
  const step = {
    id: "education-current-status",
    action: "check",
    label: "education current status",
    findByLabel: ["education current status"],
    finder: "What is your current academic & professional status?",
  };
  const website = "What is your current academic & professional status?";
  assert.equal(pickBestStepForTitle([step], website)?.id, step.id);
  assert.equal(
    pickBestStepForControl([step], { title: website, value: "Completed Master's Degree" })?.id,
    step.id,
  );
  assert.equal(pickBestStepForTitle([step], "Completed Master's Degree"), null);
});
