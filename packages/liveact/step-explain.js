/**
 * Assign spoken lines to captured steps.
 * Speech before the next action belongs to the step just done.
 * Until Record stops, speech after the latest step stays pending.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LtStepExplain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function parseAt(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function joinText(parts) {
    return cleanText((parts || []).filter(Boolean).join(" "));
  }

  function stepTimes(steps) {
    return (steps || []).map((step, index) => ({
      index,
      at: parseAt(step?.stepAt ?? step?.at ?? step?.ts),
    }));
  }

  function utteranceLines(utterances) {
    return (utterances || [])
      .map((row) => ({
        at: parseAt(row?.at),
        text: cleanText(row?.text),
      }))
      .filter((row) => row.text && row.at > 0);
  }

  /**
   * @returns {{ explanations: string[], pending: string }}
   * explanations[i] is speech for step i.
   * pending is speech after the latest step, until flush puts it on that step.
   */
  function assignExplanations(steps, utterances, { flush = false } = {}) {
    const times = stepTimes(steps);
    const lines = utteranceLines(utterances);
    const buckets = times.map(() => []);
    const pending = [];
    if (!times.length) {
      return { explanations: [], pending: joinText(lines.map((line) => line.text)) };
    }
    for (const line of lines) {
      if (line.at < times[0].at) {
        buckets[0].push(line.text);
        continue;
      }
      let placed = false;
      for (let i = 0; i < times.length - 1; i += 1) {
        if (line.at >= times[i].at && line.at < times[i + 1].at) {
          buckets[i].push(line.text);
          placed = true;
          break;
        }
      }
      if (placed) continue;
      if (flush) buckets[times.length - 1].push(line.text);
      else pending.push(line.text);
    }
    return {
      explanations: buckets.map((parts) => joinText(parts)),
      pending: joinText(pending),
    };
  }

  return { parseAt, assignExplanations };
});
