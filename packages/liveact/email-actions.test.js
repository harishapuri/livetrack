const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  heuristicExtractMailActions,
  isMailDirectedAtMe,
  firstTaggedName,
  isPointedQuestion,
  inferDueKind,
  isNoiseSender,
} = require("./email-actions");
const { parseMailActionsJson } = require("./openai-chat");
const { htmlToText } = require("./outlook");

const ME = {
  tokens: ["harish", "apuri", "hapuri1029", "hapuri29"],
  emails: ["hapuri1029@outlook.com", "hapuri29@outlook.com"],
};

test("htmlToText strips tags and keeps requests", () => {
  const text = htmlToText("<p>Please <b>send</b> the CR&nbsp;today</p>");
  assert.equal(text.includes("Please send the CR today"), true);
});

test("noise senders are skipped", () => {
  assert.equal(isNoiseSender("noreply@vendor.com"), true);
  assert.equal(isNoiseSender("jane@company.com"), false);
});

test("first tagged name is the opening greeting", () => {
  assert.equal(firstTaggedName("Hi Harish\n\nCan you fix this bug"), "Harish");
  assert.equal(firstTaggedName("Hi pavan\n\nPlease check pipeline"), "pavan");
});

test("Hi Harish + can you fix is mine; Hi pavan pipeline is not", () => {
  const mine = {
    id: "m1",
    subject: "vulnenrivilty fix",
    body: "Hi Harish\n\nCan you fix this bug",
    fromAddress: "hapuri1029@outlook.com",
    fromName: "Harish Apuri",
  };
  const pavan = {
    id: "m2",
    subject: "pipeline",
    body: "Hi pavan\n\nPlease check pipeline",
    fromAddress: "hapuri1029@outlook.com",
    fromName: "Harish Apuri",
  };
  assert.equal(isMailDirectedAtMe(mine, ME), true);
  assert.equal(isMailDirectedAtMe(pavan, ME), false);
  const items = heuristicExtractMailActions([mine, pavan], ME);
  assert.equal(items.length, 1);
  assert.equal(items[0].messageId, "m1");
  assert.match(items[0].title, /fix this bug/i);
});

test("Harish and praveen + can you check is mine", () => {
  assert.equal(
    firstTaggedName("Harish and praveen\n\nCan you check the vulnerbilities"),
    "Harish",
  );
  assert.equal(
    firstTaggedName("Praveen and Harish\n\nCan you check the vulnerbilities"),
    "Praveen",
  );
  const mail = {
    id: "m3",
    subject: "security",
    body: "Harish and praveen\n\nCan you check the vulnerbilities",
    fromAddress: "lead@coact.local",
  };
  assert.equal(isMailDirectedAtMe(mail, ME), true);
  const items = heuristicExtractMailActions([mail], ME);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /check the vulner/i);
  assert.equal(
    isMailDirectedAtMe(
      {
        id: "m4",
        body: "Praveen and Harish\n\nCan you check the vulnerbilities",
        fromAddress: "lead@coact.local",
      },
      ME,
    ),
    false,
  );
});

test("copied mail without tagging me first is skipped", () => {
  assert.equal(
    isMailDirectedAtMe(
      {
        subject: "FYI",
        body: "The build is green.",
        fromAddress: "alex@coact.local",
      },
      ME,
    ),
    false,
  );
  assert.equal(isPointedQuestion("Can you fix this bug"), true);
  assert.equal(inferDueKind("please confirm this week"), "week");
});

test("parseMailActionsJson reads items array", () => {
  const items = parseMailActionsJson(
    '{"items":[{"messageId":"aa","title":"Send CR","owner":"Harish","dueKind":"today","subject":"CR","from":"Alex"}]}',
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Send CR");
  assert.equal(items[0].dueKind, "today");
});
