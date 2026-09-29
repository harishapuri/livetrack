(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.LtNormalizeSteps = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function parseFindByText(value) {
    if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
    return String(value || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function normalizeStepsForSave(steps) {
    return (steps || []).map((s, i) => {
      const action = s.action || "click";
      const id = slugify(s.id || s.label || `step-${i + 1}`) || `step-${i + 1}`;
      const step = {
        id,
        action,
        label: String(s.label || id).trim() || id,
      };
      if (s.selector) step.selector = String(s.selector).trim();
      const keepsChoices = action === "fill" || action === "check" || action === "select";
      if (keepsChoices && s.valueFrom) step.valueFrom = String(s.valueFrom).trim();
      if (action === "click") {
        const texts = parseFindByText(s.findByText);
        if (texts.length) step.findByText = texts;
      }
      const labelHints = Array.isArray(s.findByLabel)
        ? s.findByLabel.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      if (labelHints.length) step.findByLabel = labelHints[0];
      else if (s.findByLabel) step.findByLabel = String(s.findByLabel).trim();
      const finder =
        String(s.finder || "").replace(/\s+/g, " ").trim() ||
        labelHints.find((item) => item.toLowerCase() !== String(step.label || "").trim().toLowerCase()) ||
        "";
      if (finder && finder.toLowerCase() !== String(step.label || "").trim().toLowerCase()) {
        step.finder = finder;
      }
      const guiId = String(s.guiId || s.selector || "").trim();
      if (
        guiId &&
        (guiId.startsWith("#") || /\[(name|id|data-automation-id|data-testid|data-test)=/i.test(guiId)) &&
        !/^(input|select|textarea|button)\[type=/i.test(guiId)
      ) {
        step.guiId = guiId;
        step.selector = guiId;
      }
      const allowed = Array.isArray(s.allowedValues)
        ? s.allowedValues.map((v) => String(v ?? "").trim()).filter(Boolean)
        : null;
      if (keepsChoices && allowed) {
        if (allowed.length) {
          step.allowedValues = allowed;
          step.value = allowed[0];
        }
      } else if (keepsChoices && s.value != null && String(s.value).trim()) {
        const literal = String(s.value).trim();
        step.allowedValues = [literal];
        step.value = literal;
      } else if (s.value != null && s.value !== "") {
        step.value = s.value;
      }
      if (s.waitAfter && typeof s.waitAfter === "object") step.waitAfter = s.waitAfter;
      if (s.navigates) step.navigates = true;
      if (s.mandatory) step.mandatory = true;
      if (s.optional) step.optional = true;
      if (s.locator && typeof s.locator === "object") step.locator = s.locator;
      if (s.pageUrl) step.pageUrl = String(s.pageUrl).trim();
      const explanation = String(s.explanation || "").replace(/\s+/g, " ").trim();
      if (explanation) step.explanation = explanation;
      const screenshotPath = String(s.screenshotPath || "").trim();
      if (screenshotPath) {
        step.screenshotPath = screenshotPath;
        if (s.screenshotAt) step.screenshotAt = s.screenshotAt;
        if (s.screenshotSource) step.screenshotSource = s.screenshotSource;
      }
      return step;
    });
  }

  return { slugify, parseFindByText, normalizeStepsForSave };
});
