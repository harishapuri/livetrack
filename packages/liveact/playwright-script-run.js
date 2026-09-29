/**
 * Launch headed Chrome via Playwright and replay a card-owned play/*.json script.
 * Not the LiveTrack extension, and not "wait for an already-open tab".
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function loadChromium() {
  const candidates = [
    "playwright-core",
    "playwright",
    path.join(os.homedir(), "Desktop", "playwright", "node_modules", "playwright"),
    path.join(os.homedir(), "Desktop", "playwright", "node_modules", "playwright-core"),
  ];
  let last = "";
  for (const id of candidates) {
    try {
      return require(id);
    } catch (err) {
      last = err?.message || String(err);
    }
  }
  throw new Error(last || "playwright-core is not installed");
}

const { chromium } = loadChromium();

let SOP = { steps: [] };
let APP = {};
let INFO = {};
let EDU = {};
let VOL = {};
let JOB_URL = "";
let RESUME_PATH = "";
let SHOULD_SUBMIT = false;
const HEADED = true;
let jobIndex = 0;
let logger = (msg, extra) => {
  console.log(`[apply] ${msg}${extra ? ` — ${extra}` : ""}`);
};
let onStep = null;
let onPage = null;
let runCtl = { cancelled: false, paused: false };

function control(action) {
  const a = String(action || "").toLowerCase();
  if (a === "pause") runCtl.paused = true;
  else if (a === "resume") runCtl.paused = false;
  else if (a === "cancel" || a === "stop") {
    runCtl.cancelled = true;
    runCtl.paused = false;
  }
  return { ok: true, action: a };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWhilePaused() {
  while (runCtl.paused && !runCtl.cancelled) await sleep(200);
  return !runCtl.cancelled;
}

function log(msg, extra) {
  logger(msg, extra);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function defaultApplication() {
  const file = path.join(os.homedir(), "Desktop", "playwright", "data", "application.json");
  return readJsonSafe(file) || {};
}

function applyConfig({ script, application, startUrl, resumePath, submit } = {}) {
  SOP = script && typeof script === "object" ? { ...script } : { steps: [] };
  if (!Array.isArray(SOP.steps) || !SOP.steps.length) {
    const nested = SOP.playwright && Array.isArray(SOP.playwright.steps) ? SOP.playwright.steps : [];
    if (nested.length) {
      SOP.steps = nested;
      if (!SOP.startUrl) SOP.startUrl = SOP.playwright.startUrl || "";
    }
  }
  APP = application && typeof application === "object" ? application : defaultApplication();
  INFO = APP.myInformation || {};
  EDU = APP.education || {};
  VOL = APP.voluntaryDisclosures || {};
  JOB_URL = String(startUrl || APP.jobUrl || SOP.startUrl || "").trim();
  RESUME_PATH = String(resumePath || process.env.RESUME_PATH || APP.resumePath || "").trim();
  SHOULD_SUBMIT = Boolean(submit) || process.env.SUBMIT === "1";
  jobIndex = 0;
}

function isHashId(value) {
  return /^#?[0-9a-f]{20,}$/i.test(String(value || "").trim());
}

async function firstVisible(locator, timeout = 6000) {
  try {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (await item.isVisible().catch(() => false)) return item;
    }
    await locator.first().waitFor({ state: "visible", timeout });
    return locator.first();
  } catch {
    return null;
  }
}

const FIELD_ALIASES = {
  "new york": "State",
  "new-york": "State",
  landline: "Phone Device Type",
};

function canonicalLabel(label) {
  const raw = String(label || "").replace(/\*$/, "").trim();
  return FIELD_ALIASES[raw.toLowerCase()] || raw;
}

function labelPattern(label) {
  const trimmed = canonicalLabel(label);
  if (/^state$/i.test(trimmed)) return /^(state)(\s*\/\s*province)?\s*\*?$/i;
  if (/^phone device type$/i.test(trimmed)) return /^(phone device type|phone type)\s*\*?$/i;
  return new RegExp(`^${escapeRegex(trimmed)}\\s*\\*?$`, "i");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function questionPattern(label) {
  const short = String(label || "").replace(/\*$/, "").trim();
  const distinctive = [
    /currently work for, or with Vanguard/i,
    /temporary work for Vanguard/i,
    /search agency submitted your application/i,
    /interviewed for a position at Vanguard/i,
    /Central Registration Depository/i,
    /political contribution/i,
    /relatives employed at Vanguard/i,
    /close associate of a current or former Government Official/i,
    /director, officer or senior employee of a Vanguard client/i,
    /Are you a current or former Government Official/i,
    /post-employment obligations/i,
    /require sponsorship/i,
    /U\.S\. citizen/i,
  ];
  return distinctive.find((re) => re.test(short)) || new RegExp(escapeRegex(short.slice(0, 56)), "i");
}

function answerForLabel(label) {
  const hay = String(label || "").toLowerCase();
  const hits = (APP.questions || []).filter((q) => hay.includes(String(q.match || "").toLowerCase()));
  hits.sort((a, b) => String(b.match || "").length - String(a.match || "").length);
  return hits[0]?.answer;
}

async function resolve(page, step) {
  const label = canonicalLabel(step.locator?.getByLabel || step.label || "");
  const tries = [];
  if (label) {
    tries.push(() => page.getByLabel(labelPattern(label)));
    tries.push(() => page.getByRole("combobox", { name: labelPattern(label) }));
    tries.push(() => page.getByRole("button", { name: labelPattern(label) }));
    tries.push(() => page.getByRole("textbox", { name: labelPattern(label) }));
  }
  if (step.locator?.getByRole?.role && step.locator.getByRole.name) {
    const roleName = canonicalLabel(step.locator.getByRole.name);
    tries.push(() =>
      page.getByRole(step.locator.getByRole.role, {
        name: labelPattern(roleName),
      }),
    );
  }
  if (step.locator?.css && !isHashId(step.locator.css)) {
    tries.push(() => page.locator(step.locator.css));
  }
  for (const make of tries) {
    const loc = make();
    if (!loc) continue;
    const el = await firstVisible(loc, 2500);
    if (el) return el;
  }
  return null;
}

function promptOptions(page) {
  return page.locator('[data-automation-id="promptOption"]:visible, [role="option"]:visible');
}

async function pickOption(page, hint) {
  if (!hint) return "";
  const options = promptOptions(page);
  await options.first().waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  const count = await options.count();
  const wanted = String(hint).replace(/\s+/g, " ").trim();
  const exactRe = new RegExp(`^${escapeRegex(wanted)}$`, "i");
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const item = options.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    items.push({ item, text });
  }
  const exact = items.find((o) => exactRe.test(o.text));
  if (exact) {
    await safeClick(exact.item);
    return exact.text;
  }
  if (!/^(yes|no)$/i.test(wanted)) {
    const hintRe = new RegExp(escapeRegex(wanted).replace(/\\-/g, "[\\s-]*"), "i");
    const partial = items.find((o) => hintRe.test(o.text));
    if (partial) {
      await safeClick(partial.item);
      return partial.text;
    }
  }
  if (items.length) log("prompt options (no match)", items.map((o) => o.text).slice(0, 8).join(" | "));
  return "";
}

async function isFillable(el) {
  return el
    .evaluate((n) => {
      const tag = n.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (n.getAttribute("contenteditable") === "true") return true;
      const role = n.getAttribute("role") || "";
      return role === "textbox" || role === "searchbox";
    })
    .catch(() => false);
}

async function waitForIdle(page) {
  await page
    .locator('[data-automation-id="loading"], [aria-busy="true"], [data-automation-id="busyIndicator"]')
    .first()
    .waitFor({ state: "hidden", timeout: 12000 })
    .catch(() => {});
}

async function safeClick(el, timeout = 4000) {
  if (!el) return false;
  await reveal(el);
  try {
    await el.click({ timeout });
    return true;
  } catch {
    try {
      await el.click({ force: true, timeout: 3000 });
      return true;
    } catch {
      try {
        await el.evaluate((n) => n.click());
        return true;
      } catch {
        return false;
      }
    }
  }
}

async function reveal(el) {
  await el.evaluate((n) => {
    n.scrollIntoView({ block: "center", inline: "nearest" });
    let p = n.parentElement;
    while (p) {
      const style = getComputedStyle(p);
      if (/(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflow)) {
        const top = n.getBoundingClientRect().top - p.getBoundingClientRect().top;
        p.scrollTop += top - p.clientHeight / 3;
      }
      p = p.parentElement;
    }
  }).catch(() => {});
}

async function fillInput(el, value) {
  await reveal(el);
  if (!(await isFillable(el))) {
    await el.click({ force: true, timeout: 3000 }).catch(() => {});
    return;
  }
  try {
    await el.fill(String(value), { timeout: 5000 });
    return;
  } catch {
    /* click is often blocked by Workday's sticky footer; force-fill instead */
  }
  await el.click({ force: true, timeout: 2000 }).catch(() => {});
  await el.fill(String(value), { force: true }).catch(async () => {
    await el.evaluate((n, v) => {
      n.focus();
      n.value = v;
      n.dispatchEvent(new Event("input", { bubbles: true }));
      n.dispatchEvent(new Event("change", { bubbles: true }));
    }, String(value));
  });
}

async function typeahead(page, step) {
  await page.keyboard.press("Escape").catch(() => {});
  const el = await resolve(page, step);
  if (!el) {
    const picked = await selectPrompt(page, step.label, step.option || step.value, step);
    if (!picked) log("skip typeahead, field not found", step.label);
    return picked;
  }
  await safeClick(el);
  await sleep(250);

  if (await isFillable(el)) {
    await el.fill("");
    await el.pressSequentially(String(step.value), { delay: 45 });
  }

  const searchBox = page.locator(
    '[data-automation-id="searchBox"]:visible, [role="listbox"] input:visible',
  );
  const search = await firstVisible(searchBox, 800);
  if (search) {
    await safeClick(search);
    await search.fill("");
    await search.pressSequentially(String(step.value), { delay: 45 });
  }
  await sleep(700);

  const picked = await pickOption(page, step.option || step.value);
  if (picked) {
    log("typeahead", `${step.label} → ${picked}`);
    await page.keyboard.press("Escape").catch(() => {});
    return true;
  }
  await page.keyboard.press("Enter").catch(() => {});
  await sleep(300);
  await page.keyboard.press("Escape").catch(() => {});
  log("typeahead typed only", step.label);
  return true;
}

async function clickNamed(page, step) {
  const rawName = step.locator?.getByRole?.name || step.label;
  const label = String(rawName || "").replace(/\*$/, "").trim();
  const nameRe = label
    ? new RegExp(escapeRegex(label), "i")
    : /save and continue|continue|next/i;
  await waitForIdle(page);
  const footer = page.locator(
    '[data-automation-id="pageFooterNextButton"], [data-automation-id="bottom-navigation-next-button"]',
  );
  let btn = page.getByRole("button", { name: nameRe }).first();
  if (step.section) {
    const heading = page.getByRole("heading", { name: new RegExp(step.section, "i") }).first();
    if (await heading.isVisible().catch(() => false)) {
      const region = heading.locator("xpath=ancestor::*[self::section or @data-automation-id][1]");
      const inSection = region.getByRole("button", { name: nameRe });
      if (await inSection.first().isVisible().catch(() => false)) btn = inSection;
    }
  }
  const el =
    (/save and continue|next|continue/i.test(label)
      ? await firstVisible(footer, 5000)
      : null) ||
    (await firstVisible(btn, 8000)) ||
    (await firstVisible(
      page.locator(step.locator?.css || "[data-automation-id='pageFooterNextButton']"),
      5000,
    ));
  if (!el) {
    log("skip click, button not found", label);
    return false;
  }
  const ok = await onceOrSkip(
    page,
    label,
    async () => {
      const clicked = await safeClick(el, 6000);
      if (!clicked) throw new Error(`click missed: ${label}`);
    },
    el,
  );
  if (ok) {
    await sleep(700);
    await waitForIdle(page);
    if (/save and continue/i.test(label)) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page
        .getByText(/Are you a U\.S\. citizen|require sponsorship|I have read and consent|Gender/i)
        .first()
        .waitFor({ state: "visible", timeout: 12000 })
        .catch(() => {});
      await sleep(500);
    }
    log("clicked", label);
  }
  return ok;
}

async function unstick(page, el) {
  if (!page || page.isClosed()) return;
  await page.keyboard.press("Escape").catch(() => {});
  if (el) await reveal(el);
  else {
    await page.mouse.wheel(0, 450).catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 350)).catch(() => {});
  }
  await sleep(250);
}

async function onceOrSkip(page, label, fn, el) {
  try {
    await fn();
    return true;
  } catch (err) {
    log("stuck, moving once", `${label}: ${String(err.message || err).split("\n")[0]}`);
    await unstick(page, el);
    try {
      await fn();
      return true;
    } catch (err2) {
      log("skip", `${label}: ${String(err2.message || err2).split("\n")[0]}`);
      await page.keyboard.press("Escape").catch(() => {});
      return false;
    }
  }
}

async function fillBySuffix(page, suffix, value, nth = 0) {
  if (value == null || value === "") return;
  const el = page.locator(`[id$="${suffix}"]`).nth(nth);
  if (!(await el.count().catch(() => 0))) return;
  await el.waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
  await onceOrSkip(page, suffix, () => fillInput(el, value), el);
}

async function fillJob(page, job) {
  const nth = jobIndex;
  log(`job ${nth + 1}`, `${job.jobTitle} @ ${job.company}`);
  await fillBySuffix(page, "--jobTitle", job.jobTitle, nth);
  await fillBySuffix(page, "--companyName", job.company, nth);
  await fillBySuffix(page, "--location", job.location, nth);
  await fillBySuffix(page, "--startDate-dateSectionMonth-input", job.startMonth, nth);
  await fillBySuffix(page, "--startDate-dateSectionYear-input", job.startYear, nth);
  const current = page.locator("[id$='--currentlyWorkHere']").nth(nth);
  if (job.currentlyWorkHere && (await current.count())) {
    await onceOrSkip(
      page,
      "currently work here",
      async () => {
        if (!(await current.isChecked().catch(() => false))) {
          await current.check({ force: true }).catch(() => safeClick(current));
        }
      },
      current,
    );
  } else {
    await fillBySuffix(page, "--endDate-dateSectionMonth-input", job.endMonth, nth);
    await fillBySuffix(page, "--endDate-dateSectionYear-input", job.endYear, nth);
  }
  await fillBySuffix(page, "--roleDescription", job.roleDescription, nth);
  jobIndex += 1;
}

async function selectPrompt(page, label, value, step = {}) {
  await page.keyboard.press("Escape").catch(() => {});
  const short = String(label || "").replace(/\*$/, "").trim();
  const nameRe = questionPattern(short);
  const valueRe = new RegExp(`^\\s*${escapeRegex(String(value))}\\s*$`, "i");
  const waitMs = step.quick ? 1200 : 15000;

  const heading = page.getByText(nameRe).first();
  await heading.waitFor({ state: "visible", timeout: waitMs }).catch(() => {});
  if (await heading.isVisible().catch(() => false)) {
    await reveal(heading);
    await sleep(250);
    const radioGroup = heading.locator(
      'xpath=following::input[@type="radio"][1]/ancestor::*[.//input[@type="radio"]][1]',
    );
    const radio = radioGroup.getByRole("radio", { name: valueRe }).first();
    if (await radio.isVisible().catch(() => false)) {
      await safeClick(radio);
      log("answered", `${short.slice(0, 48)} → ${value}`);
      return true;
    }
  }

  const followingSelect = heading.locator(
    'xpath=following::*[self::button or @role="button" or @role="combobox" or @aria-haspopup="listbox"][contains(normalize-space(.), "Select One") or @aria-haspopup="listbox" or @role="combobox"][1]',
  );
  const widgetInField = page
    .locator(
      '[data-automation-id^="formField"], [data-automation-id*="Questionnaire"], li, fieldset, [role="group"]',
    )
    .filter({ hasText: nameRe })
    .locator(
      'button:has-text("Select One"), [data-automation-id="selectWidget"], [data-automation-id="select-selectedOption"], [aria-haspopup="listbox"], [role="combobox"]',
    );

  const locators = [];
  if (step.locator?.css && !isHashId(step.locator.css)) locators.push(page.locator(step.locator.css));
  locators.push(page.getByRole("combobox", { name: nameRe }));
  locators.push(page.getByLabel(nameRe));
  locators.push(page.getByRole("button", { name: nameRe }));
  locators.push(followingSelect);
  locators.push(widgetInField);

  let trigger = null;
  for (const loc of locators) {
    trigger = await firstVisible(loc, 2500);
    if (trigger) break;
  }
  if (!trigger) {
    log("skip answer, no dropdown", short.slice(0, 50));
    return false;
  }

  await reveal(trigger);
  if (!(await safeClick(trigger, 5000))) return false;
  await sleep(500);

  let picked = await pickOption(page, value);
  if (!picked) {
    const opt = page.getByRole("option", { name: valueRe }).first();
    if (await opt.isVisible().catch(() => false)) {
      await safeClick(opt);
      picked = value;
    }
  }
  if (!picked) {
    const byText = page.getByText(valueRe).last();
    if (await byText.isVisible().catch(() => false)) {
      await safeClick(byText);
      picked = value;
    }
  }

  if (picked) {
    log("answered", `${short.slice(0, 48)} → ${picked}`);
    await page.keyboard.press("Escape").catch(() => {});
    return true;
  }
  log("skip answer", short.slice(0, 60));
  return false;
}

async function answerQuestion(page, label, value, step = {}) {
  return selectPrompt(page, label, value, step);
}

async function answerRemaining(page, defaultValue = "No") {
  for (let n = 0; n < 16; n += 1) {
    const leftover = page.locator(
      'button:has-text("Select One"), [role="button"]:has-text("Select One"), [role="combobox"]:has-text("Select One"), [aria-haspopup="listbox"]:has-text("Select One")',
    );
    const btn = await firstVisible(leftover, 800);
    if (!btn) break;
    const nearby = await btn
      .evaluate((el) => {
        const root =
          el.closest('[data-automation-id^="formField"], li, fieldset, [role="group"]') ||
          el.parentElement;
        return (root?.innerText || "").replace(/\s+/g, " ").trim();
      })
      .catch(() => "");
    const value = answerForLabel(nearby) || defaultValue;
    await reveal(btn);
    await safeClick(btn, 4000);
    await sleep(400);
    const picked = await pickOption(page, value);
    if (picked) log("answered remaining", `${nearby.slice(0, 56)} → ${picked}`);
    else log("skip remaining", nearby.slice(0, 60));
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(200);
  }
}

async function checkControl(page, step) {
  if (step.kind === "radio" && /vanguard/i.test(step.label || "")) {
    const no = page.locator("#uya57");
    if (await no.isVisible().catch(() => false)) {
      await no.check().catch(() => safeClick(no));
      log("checked", "never worked for Vanguard");
      return true;
    }
    const radioNo = page.getByRole("radio", { name: /^no$/i }).first();
    if (await radioNo.isVisible().catch(() => false)) {
      await safeClick(radioNo);
      return true;
    }
  }

  if (step.value && step.value !== "on") {
    const named = page.getByRole("checkbox", { name: new RegExp(`^${escapeRegex(step.value)}$`, "i") });
    if (await named.first().isVisible().catch(() => false)) {
      await named.first().check().catch(() => safeClick(named.first()));
      log("checked", step.value);
      return true;
    }
    const text = page.getByText(step.value, { exact: true }).first();
    if (await text.isVisible().catch(() => false)) {
      await safeClick(text);
      log("clicked text", step.value);
      return true;
    }
  }

  const el = await resolve(page, step);
  if (!el) {
    if (step.value && step.value !== "on") {
      const picked = await selectPrompt(page, step.label, step.value, step);
      if (picked) return true;
    }
    const terms = page.getByRole("checkbox", { name: /terms and conditions|consent/i }).first();
    if (await terms.isVisible().catch(() => false)) {
      await terms.check({ force: true }).catch(() => safeClick(terms));
      log("checked", step.label);
      return true;
    }
    log("skip check", step.label);
    return false;
  }
  const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => "");
  if (tag === "input") {
    const type = await el.getAttribute("type");
    if (type === "checkbox" || type === "radio") {
      await el.check().catch(() => safeClick(el));
      log("checked", step.label);
      return true;
    }
  }
  await safeClick(el);
  log("clicked control", step.label);
  return true;
}

function overlayStep(step) {
  const next = { ...step, locator: step.locator ? { ...step.locator } : step.locator };
  const label = canonicalLabel(step.label);
  const fills = {
    "First Name": INFO.firstName,
    "Last Name": INFO.lastName,
    "Address Line 1": INFO.addressLine1,
    "City": INFO.city,
    "Postal Code": INFO.postalCode,
    "Phone Number": INFO.phoneNumber,
    "Field of Study": EDU.fieldOfStudy,
    "Year last attended": EDU.lastYear,
    "Overall Result (GPA)": EDU.gpa,
    URL: (APP.websites || [])[0],
    "If you selected other OR have taken any of the license exams": APP.otherExamDetails,
  };
  if (fills[label] != null) next.value = fills[label];

  const prompts = {
    "How Did You Hear About Us?": {
      value: INFO.howDidYouHearSearch || INFO.howDidYouHear,
      option: INFO.howDidYouHear,
    },
    State: { value: INFO.state, option: INFO.state },
    "Phone Device Type": { value: INFO.phoneType, option: INFO.phoneType },
    "School or University": { value: EDU.school, option: EDU.school },
    Degree: { value: EDU.degree, option: EDU.degree },
    Gender: { value: VOL.gender, option: VOL.gender },
    "Veteran Status": { value: VOL.veteran, option: VOL.veteran },
  };
  if (prompts[label]) Object.assign(next, prompts[label]);

  if (/finra/i.test(label) && APP.finraExams) next.value = APP.finraExams;
  if (step.action === "answer" || step.action === "answerRemaining") {
    const mapped = answerForLabel(step.label);
    if (mapped) next.value = mapped;
  }
  if (step.action === "fillJob") {
    next.job = (APP.experience || [])[jobIndex] || step.job;
  }
  if (step.action === "check" && /terms and conditions/i.test(label)) {
    next.value = APP.acceptTerms ? "on" : "";
  }
  return next;
}

async function fillSkills(page, step) {
  const skills = APP.skills && APP.skills.length ? APP.skills : [step.value].filter(Boolean);
  for (const skill of skills) {
    log("skill", skill);
    await typeahead(page, { ...step, value: skill, option: skill });
  }
}

function isAnswerStep(step) {
  if (process.env.SKIP_ANSWERS === "0") return false;
  if (process.env.SKIP_ANSWERS !== "1" && SOP.skipAnswers !== true) return false;
  if (step.action === "answer") return true;
  const label = String(step.label || "");
  return /citizen|sponsorship|post-employment|finra|license exam|cfa|certified financial|sister-in-law|government official|refer or recommend|gender|veteran/i.test(
    label,
  );
}

async function runStep(page, step, index) {
  step = overlayStep(step);
  if (step.submit && !SHOULD_SUBMIT) {
    log("stopped before Submit — re-run with SUBMIT=1 to send the application");
    return "stop";
  }
  const name = step.action + (step.label ? ` ${step.label}` : "");
  if (isAnswerStep(step)) {
    log(`step ${index + 1}/${SOP.steps.length}`, `skip answer — ${step.label || step.action}`);
    return "ok";
  }
  log(`step ${index + 1}/${SOP.steps.length}`, name);
  if (step.value != null && step.value !== "") log("value", String(step.value).slice(0, 80));
  try {
    onStep?.({
      index,
      step,
      status: "running",
      pageUrl: page.url(),
    });
  } catch {
    /* ignore */
  }

  const applied = await onceOrSkip(page, name, async () => {
    switch (step.action) {
      case "fill": {
        const el = await resolve(page, step);
        if (!el) {
          log("skip fill", step.label);
          return;
        }
        await fillInput(el, step.value);
        break;
      }
      case "typeahead":
        if (/type to add skills/i.test(step.label || "")) await fillSkills(page, step);
        else await typeahead(page, step);
        break;
      case "click":
        await clickNamed(page, step);
        break;
      case "fillJob":
        await fillJob(page, step.job);
        break;
      case "answer":
        await answerQuestion(page, step.label, step.value, step);
        break;
      case "answerRemaining":
        await answerRemaining(page, step.value || "No");
        break;
      case "check":
        if (step.value === "") {
          log("skip check (acceptTerms false)", step.label);
          break;
        }
        await checkControl(page, step);
        break;
      default:
        log("unknown action", step.action);
    }
  });
  try {
    onStep?.({
      index,
      step,
      status: applied ? "done" : "skipped",
      pageUrl: page.url(),
    });
  } catch {
    /* ignore */
  }
  return "ok";
}

async function dismissNoise(page) {
  const cookie = page.getByRole("button", { name: /accept( all)?|agree|got it/i }).first();
  if (await cookie.isVisible().catch(() => false)) await safeClick(cookie, 3000);
  const applyManually = page.getByRole("button", { name: /apply manually/i }).first();
  if (await applyManually.isVisible().catch(() => false)) {
    log("click Apply Manually");
    await safeClick(applyManually, 5000);
    await sleep(1200);
    await waitForIdle(page);
  }
}

async function formReady(page) {
  const first = page
    .locator("#name--legalName--firstName")
    .or(page.getByLabel(/first name/i))
    .first();
  return first.isVisible().catch(() => false);
}

async function waitForForm(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const deadline = Date.now() + 180000;
  let noticedSignIn = false;
  while (Date.now() < deadline && !runCtl.cancelled) {
    if (!(await waitWhilePaused())) return false;
    await dismissNoise(page);
    if (await formReady(page)) return true;
    const signIn = await page
      .getByRole("heading", { name: /sign in|create account/i })
      .isVisible()
      .catch(() => false);
    if (signIn && !noticedSignIn) {
      noticedSignIn = true;
      log("Workday sign-in — waiting. Take over to sign in; the script continues when the form appears.");
      try {
        onStep?.({
          index: -1,
          step: { action: "wait", label: "Sign in", reason: "Sign in to Workday — Take over, then wait for the form" },
          status: "notice",
          pageUrl: page.url(),
        });
      } catch {
        /* ignore */
      }
    }
    await sleep(800);
  }
  if (runCtl.cancelled) return false;
  throw new Error("Form did not open. Sign in or open the apply page, then Launch again.");
}

async function uploadResume(page) {
  if (!RESUME_PATH || !fs.existsSync(RESUME_PATH)) return;
  const input = page.locator('[data-automation-id="file-upload-input-ref"], input[type="file"]').first();
  if (await input.count().catch(() => 0)) {
    await input.setInputFiles(RESUME_PATH);
    log("uploaded resume", RESUME_PATH);
  }
}

async function attachOrLaunch() {
  const opts = { headless: false, slowMo: 50 };
  let browser;
  try {
    browser = await chromium.launch({ ...opts, channel: "chrome" });
  } catch {
    try {
      browser = await chromium.launch({ ...opts, channel: "msedge" });
    } catch {
      browser = await chromium.launch(opts);
    }
  }
  return {
    browser,
    page: await browser.newPage({ viewport: { width: 1400, height: 900 } }),
    keepOpen: true,
  };
}

async function waitUntilUserCloses(browser, page) {
  log("leaving the window open — close the Chrome window when you are done");
  await Promise.race([
    page.waitForEvent("close", { timeout: 0 }).catch(() => {}),
    new Promise((resolve) => browser.once("disconnected", resolve)),
  ]);
}

async function runPlaywrightScript(options = {}) {
  applyConfig(options);
  if (typeof options.onLog === "function") logger = options.onLog;
  onStep = typeof options.onStep === "function" ? options.onStep : null;
  onPage = typeof options.onPage === "function" ? options.onPage : null;
  runCtl = { cancelled: false, paused: false };
  const steps = Array.isArray(SOP.steps) ? SOP.steps : [];
  if (!steps.length) return { ok: false, error: "playwright_script_empty" };
  if (!JOB_URL) return { ok: false, error: "missing_start_url" };

  log("ticket", SOP.ticket || "");
  log("using application.json", `${INFO.firstName || ""} ${INFO.lastName || ""}`.trim());
  log("job", JOB_URL);
  log("launching Chrome via Playwright");
  const { browser, page } = await attachOrLaunch();
  page.on("close", () => log("page closed"));
  browser.on("disconnected", () => log("browser disconnected"));
  const emitPage = async () => {
    try {
      onPage?.({
        url: page.url(),
        title: await page.title(),
      });
    } catch {
      /* ignore */
    }
  };
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) void emitPage();
  });
  try {
    if (typeof options.onReady === "function") {
      await options.onReady({ browser, page, startUrl: JOB_URL });
    }
    await page.goto(JOB_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await emitPage();
    page.setDefaultTimeout(8000);
    const ready = await waitForForm(page);
    if (!ready) {
      log("stopped before form");
      return { ok: false, cancelled: true, error: "Take over" };
    }
    if (typeof options.onFormReady === "function") {
      await options.onFormReady({ page });
    }
    for (let i = 0; i < steps.length; i += 1) {
      if (!(await waitWhilePaused())) {
        return { ok: false, cancelled: true, error: "Take over" };
      }
      if (page.isClosed()) {
        log("window closed during the run — stopping");
        break;
      }
      const result = await runStep(page, steps[i], i);
      if (result === "stop") break;
      if (steps[i].action === "fillJob" && steps[i + 1]?.section === "Education") {
        await uploadResume(page);
      }
    }
    if (runCtl.cancelled) return { ok: false, cancelled: true, error: "Take over" };
    log("done");
    return { ok: true };
  } catch (err) {
    const message = err?.message || String(err);
    log("failed", message);
    return { ok: false, error: message };
  }
}

module.exports = {
  runPlaywrightScript,
  defaultApplication,
  control,
};
