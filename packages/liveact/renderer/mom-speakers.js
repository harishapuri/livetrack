(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.liveTrackMomSpeakers = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function firstName(raw) {
    return String(raw || "")
      .trim()
      .split(/[\s,/]+/)
      .filter(Boolean)[0] || "";
  }

  function normName(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function operatorLabel(operatorName) {
    const name = String(operatorName || "").trim();
    return name || "You";
  }

  function nameParts(raw) {
    return String(raw || "")
      .replace(/\(guest\)/gi, " ")
      .trim()
      .split(/[\s,/|_-]+/)
      .map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, ""))
      .filter(Boolean);
  }

  function compactName(raw) {
    return nameParts(raw).join("");
  }

  /** Full identity only. "Harish Apuri" is not "harishchowdary". */
  function isSamePerson(a, b) {
    const ca = compactName(a);
    const cb = compactName(b);
    if (!ca || !cb || ca.length < 3 || cb.length < 3) return false;
    if (ca === cb) return true;
    const pa = nameParts(a);
    const pb = nameParts(b);
    if (pa.length >= 2 && pb.length === 1 && pb[0].length >= 8 && pb[0] === pa.join("")) return true;
    if (pb.length >= 2 && pa.length === 1 && pa[0].length >= 8 && pa[0] === pb.join("")) return true;
    return false;
  }

  function nameContext(operatorName, meeting) {
    return [
      operatorLabel(operatorName),
      meeting?.organizer,
      ...(meeting?.attendees || []),
      ...(meeting?.tileNames || []),
    ].map((row) => String(row || "").trim()).filter(Boolean);
  }

  function inviteeNames(meeting, operatorName) {
    const names = [];
    if (meeting?.organizer) names.push(String(meeting.organizer));
    for (const row of meeting?.attendees || []) names.push(String(row || ""));
    for (const row of meeting?.tileNames || []) names.push(String(row || ""));
    const seen = new Set();
    const out = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const key = compactName(trimmed);
      if (!key || seen.has(key)) continue;
      if (isSamePerson(trimmed, operatorName)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  function normalizeDiarizeLabel(raw) {
    const s = String(raw || "").trim();
    if (!s) return "Speaker 1";
    if (/^you$/i.test(s)) return "You";
    const letter = /^([A-Za-z])$/.exec(s);
    if (letter) {
      const n = letter[1].toUpperCase().charCodeAt(0) - 64;
      return `Speaker ${Math.max(1, n)}`;
    }
    const indexed = /(?:speaker[_-\s]*)(\d+)/i.exec(s);
    if (indexed) {
      const n = Number(indexed[1]);
      if (s.includes("_") || (/speaker[_-]?\d+/i.test(s) && /_/.test(s))) {
        return `Speaker ${n + 1}`;
      }
      if (/^speaker[_-]\d+$/i.test(s)) return `Speaker ${n + 1}`;
      return `Speaker ${n === 0 ? 1 : n}`;
    }
    if (/^speaker\s*\d+$/i.test(s)) return s.replace(/\s+/g, " ").replace(/^s/, "S");
    return s;
  }

  function sharesGivenName(a, b) {
    const pa = nameParts(a);
    const pb = nameParts(b);
    if (!pa[0] || !pb[0] || pa[0].length < 4 || pb[0].length < 4) return false;
    if (pa[0] === pb[0]) return true;
    if (pa.length === 1 && pa[0].startsWith(pb[0])) return true;
    if (pb.length === 1 && pb[0].startsWith(pa[0])) return true;
    return false;
  }

  function displayNameForInvitee(name, contextNames) {
    const cleaned = String(name || "")
      .replace(/\s*\(guest\)\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const first = firstName(cleaned);
    const list = Array.isArray(contextNames) ? contextNames : [];
    const hasOtherSameGiven = list.some((row) => sharesGivenName(cleaned, row) && !isSamePerson(cleaned, row));
    if (hasOtherSameGiven) return cleaned;
    return first || cleaned;
  }

  function isLocalTurn(turn) {
    const source = String(turn?.source || "").toLowerCase();
    return source === "mic" || source === "you" || source === "local";
  }

  function isPlaceholderSpeaker(raw) {
    const s = String(raw ?? "").trim();
    return !s || /^(null|undefined|none|unknown|n\/a|nan)$/i.test(s);
  }

  function looksNamed(value) {
    const s = String(value || "").trim();
    if (!s || isPlaceholderSpeaker(s)) return false;
    if (/^you$/i.test(s) || /^guest$/i.test(s) || /^speaker\s*\d+$/i.test(s) || /^[A-Za-z]$/.test(s)) return false;
    if (/^speaker[_-\s]?\d+$/i.test(s)) return false;
    return /[A-Za-z]{2,}/.test(s);
  }

  function editDistance(a, b) {
    const s = String(a || "");
    const t = String(b || "");
    if (s === t) return 0;
    const rows = Array.from({ length: s.length + 1 }, (_, i) => {
      const row = new Array(t.length + 1);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= t.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= s.length; i += 1) {
      for (let j = 1; j <= t.length; j += 1) {
        rows[i][j] =
          s[i - 1] === t[j - 1]
            ? rows[i - 1][j - 1]
            : 1 + Math.min(rows[i - 1][j], rows[i][j - 1], rows[i - 1][j - 1]);
      }
    }
    return rows[s.length][t.length];
  }

  function matchTile(word, tiles) {
    const needle = normName(word);
    if (!needle || needle.length < 3) return null;
    const list = Array.isArray(tiles) ? tiles : [];
    for (const tile of list) {
      const first = normName(firstName(tile));
      const full = normName(String(tile).replace(/\(guest\)/gi, ""));
      if (first === needle || full === needle) return tile;
      if (first.length >= 4 && needle.length >= 4 && first[0] === needle[0] && editDistance(first, needle) <= 1) {
        return tile;
      }
    }
    return null;
  }

  function isOperatorOnCall(name, operatorName, meeting) {
    const operator = operatorLabel(operatorName);
    const raw = String(name || "").trim();
    if (!raw) return false;
    if (/^you$/i.test(raw) || isSamePerson(raw, operator)) return true;
    const tiles = (meeting?.tileNames || []).map((row) => String(row || "").trim()).filter(Boolean);
    const hits = tiles.filter((tile) => isSamePerson(tile, operator) || sharesGivenName(tile, operator));
    if (hits.length !== 1) return false;
    return isSamePerson(raw, hits[0]) || sharesGivenName(raw, hits[0]);
  }

  function extractIntroNames(text) {
    const hits = [];
    const re = /\b(?:i am|i'm|i’m|im|this is|my name is)\s+([A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*){0,3})/gi;
    let match;
    while ((match = re.exec(String(text || "")))) {
      for (const part of String(match[1] || "").split(/\s+/)) {
        if (part.length >= 3) hits.push(part);
      }
    }
    return hits;
  }

  function clusterKey(turn) {
    return String(turn?.rawSpeaker || turn?.speaker || "A");
  }

  function assignRemoteTurns(turns, { operatorName, meeting, visualSpeaker } = {}) {
    const opts = { operatorName, meeting, visualSpeaker };
    const operator = operatorLabel(operatorName);
    const ctx = nameContext(operatorName, meeting);
    const tiles = remoteTileNames(meeting, operator).filter(
      (tile) => !isOperatorOnCall(tile, operatorName, meeting),
    );
    const visual =
      looksNamed(visualSpeaker) && !isOperatorOnCall(visualSpeaker, operatorName, meeting)
        ? displayNameForInvitee(matchTile(visualSpeaker, tiles) || visualSpeaker, ctx)
        : "";
    const list = (Array.isArray(turns) ? turns : []).map((turn) => ({
      ...turn,
      text: cleanMomWording(turn.text, opts),
    }));
    const voiced = list.filter((turn) => turn.text);
    const clusterToName = new Map();
    const used = new Set();

    const bind = (key, tile, { allowReuse } = {}) => {
      if (!key || !tile || clusterToName.has(key)) return false;
      const label = displayNameForInvitee(tile, ctx);
      const id = compactName(label);
      if (!id) return false;
      if (!allowReuse && used.has(id)) return false;
      clusterToName.set(key, label);
      used.add(id);
      return true;
    };

    for (const turn of voiced) {
      for (const word of extractIntroNames(turn.text)) {
        const tile = matchTile(word, tiles);
        if (tile && !isOperatorOnCall(tile, operatorName, meeting)) bind(clusterKey(turn), tile);
      }
    }

    const latest = Math.max(0, ...voiced.map((turn) => Number(turn.at) || 0));
    const fresh = (turn) => !latest || latest - (Number(turn.at) || 0) <= 4000;
    if (visual) {
      const tile = matchTile(visual, tiles) || visual;
      for (const turn of voiced.filter(fresh)) {
        if (!clusterToName.has(clusterKey(turn))) bind(clusterKey(turn), tile, { allowReuse: true });
      }
    }

    const shareTiles = voiced.filter((turn) => !clusterToName.has(clusterKey(turn)));
    if (tiles.length === 1) {
      for (const turn of shareTiles) bind(clusterKey(turn), tiles[0], { allowReuse: true });
    }

    const compact = new Map();
    let speakerN = 0;
    return list.map((turn) => {
      const key = clusterKey(turn);
      let speaker = clusterToName.get(key);
      if (!speaker && looksNamed(turn.speaker) && !isOperatorOnCall(turn.speaker, operatorName, meeting)) {
        speaker = displayNameForInvitee(turn.speaker, ctx);
      }
      if (!speaker && tiles.length === 1) speaker = displayNameForInvitee(tiles[0], ctx);
      if (!speaker && visual && tiles.length <= 1) speaker = visual;
      if (!speaker) {
        if (!compact.has(key)) {
          speakerN += 1;
          compact.set(key, `Speaker ${speakerN}`);
        }
        speaker = compact.get(key);
      }
      return {
        ...turn,
        speaker,
        rawSpeaker: key,
        source: "loop",
      };
    });
  }

  function mapSpeakerTurns(turns, { operatorName, meeting, visualSpeaker } = {}) {
    const opts = { operatorName, meeting, visualSpeaker };
    const operator = operatorLabel(operatorName);
    const list = Array.isArray(turns) ? turns : [];
    const pending = [];
    for (const turn of list) {
      if (!isLocalTurn(turn) && !looksNamed(turn.speaker)) pending.push(turn);
    }
    const assigned = assignRemoteTurns(pending, opts);
    let pendingIdx = 0;
    return list.map((turn) => {
      const text = cleanMomWording(turn.text, opts);
      if (isLocalTurn(turn)) {
        return { ...turn, text, speaker: operator, rawSpeaker: turn.rawSpeaker || "local" };
      }
      if (looksNamed(turn.speaker) && !isOperatorOnCall(turn.speaker, operatorName, meeting)) {
        const tiles = remoteTileNames(meeting, operator).filter(
          (tile) => !isOperatorOnCall(tile, operatorName, meeting),
        );
        const ctx = nameContext(operatorName, meeting);
        const hit = matchTile(turn.speaker, tiles);
        return {
          ...turn,
          text,
          speaker: hit ? displayNameForInvitee(hit, ctx) : displayNameForInvitee(turn.speaker, ctx),
        };
      }
      return assigned[pendingIdx++] || { ...turn, text };
    });
  }

  function namesOverlap(a, b) {
    return isSamePerson(a, b);
  }

  function collapseRepeatedText(text) {
    let s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const sentences = s.split(/(?<=[.!?])\s+/);
    const kept = [];
    for (const sentence of sentences) {
      const next = sentence.trim();
      if (!next) continue;
      const n = next.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const prev = kept[kept.length - 1];
      const pn = prev ? prev.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
      if (n && pn && (n === pn || (n.length >= 12 && pn.includes(n)) || (pn.length >= 12 && n.includes(pn)))) continue;
      kept.push(next);
    }
    s = kept.join(" ");
    const compact = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const words = compact.split(/\s+/).filter(Boolean);
    if (words.length >= 8 && words.length % 2 === 0) {
      const half = words.length / 2;
      if (words.slice(0, half).join(" ") === words.slice(half).join(" ")) {
        return kept.slice(0, Math.ceil(kept.length / 2)).join(" ");
      }
    }
    return s;
  }

  function isFillerOnlyShort(text) {
    const words = String(text || "")
      .toLowerCase()
      .replace(/[^a-z']+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return true;
    if (words.length > 4) return false;
    return words.every(
      (word) =>
        /^(?:um+|uh+|uhm+|hmm+|mm+|mhm|ah+|oh+|er+|you|the|a|and)$/i.test(word),
    );
  }

  function countThanksBye(text) {
    return (String(text || "").match(/\b(?:thank you|thanks|goodbye|bye)\b/gi) || []).length;
  }

  function stripTranscriptJunk(text) {
    let s = String(text || "");
    s = s.replace(/^[\u0400-\u04FF]\s+/, "");
    s = s.replace(/ご視聴ありがとうございました[。.]?/g, " ");
    s = s.replace(/チャンネル登録(?:してください|お願いします|してね)?[。.!?]*/g, " ");
    s = s.replace(/ご視聴[^\s]*/g, " ");
    s = s.replace(/(?:thanks|thank you)\s+for\s+watching(?:\s+\w+){0,6}[!.,]*/gi, " ");
    s = s.replace(/(?:please\s+)?like and subscribe(?:\s+\w+){0,8}[!.,]*/gi, " ");
    s = s.replace(/please\s+subscribe(?:\s+\w+){0,8}[!.,]*/gi, " ");
    s = s.replace(/harishi\s+attack/gi, " ");
    s = s.replace(/before joining the call[,.]?\s*(?:please introduce yourself)?[.!]*/gi, " ");
    if (countThanksBye(s) >= 3) {
      s = s.replace(/\b(?:thank you|thanks|goodbye|bye)\b[.!,?]*/gi, " ");
    }
    return s.replace(/\s+/g, " ").trim();
  }

  function isJunkTranscript(text) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return true;
    if (/harishi\s+attack/i.test(raw)) {
      const leftover = stripTranscriptJunk(raw);
      if (!leftover || isFillerOnlyShort(leftover)) return true;
    }
    if (/ご視聴ありがとうございました/.test(raw) || /チャンネル登録/.test(raw)) {
      const leftover = stripTranscriptJunk(raw);
      if (!leftover || isFillerOnlyShort(leftover)) return true;
    }
    if (/\bthanks for watching\b/i.test(raw) || /\bthank you for watching\b/i.test(raw)) {
      const leftover = stripTranscriptJunk(raw);
      if (!leftover || isFillerOnlyShort(leftover)) return true;
    }
    if (isFillerOnlyShort(raw)) return true;
    if (countThanksBye(raw) >= 3) {
      const leftover = stripTranscriptJunk(raw);
      if (!leftover || isFillerOnlyShort(leftover)) return true;
    }
    const stripped = stripTranscriptJunk(raw);
    if (!stripped) return true;
    if (isFillerOnlyShort(stripped)) return true;
    return false;
  }

  function cleanTranscriptText(text, opts) {
    return cleanMomWording(text, opts);
  }

  function spokenOperatorName(operatorName) {
    const first = firstName(operatorName);
    if (/^harish/i.test(first || operatorName)) {
      return first && first.length <= 8 ? first : "Harish";
    }
    return first || String(operatorName || "").trim();
  }

  function sttNameFixes(operatorName, meeting) {
    const tiles = remoteTileNames(meeting, operatorName);
    const fixes = [];
    const mitin = tiles.find((tile) => /^mitin$/i.test(normName(firstName(tile))));
    if (mitin) {
      fixes.push({
        re: /\b(?:mitun|matten|mutton|mitten|mittin|mithun)\b/gi,
        to: displayNameForInvitee(mitin, tiles),
      });
    }
    const situn = tiles.find((tile) => /^situn$/i.test(normName(firstName(tile))));
    if (situn) {
      const label = displayNameForInvitee(situn, tiles);
      fixes.push({ re: /\b(?:sarav\s+)?(?:sithun|sithen|situn)\b/gi, to: label });
      fixes.push({ re: /\b(?:sarav(?:anan)?)\b/gi, to: label });
    }
    if (/^harish/i.test(normName(firstName(operatorName) || operatorName))) {
      fixes.push({
        re: /\b(?:harishi|harishan|harishii)\b/gi,
        to: spokenOperatorName(operatorName),
      });
    }
    return fixes;
  }

  function capitalizeSentences(text) {
    return String(text || "").replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
  }

  function cleanMomWording(text, { operatorName, meeting } = {}) {
    if (isJunkTranscript(text)) return "";
    let s = stripTranscriptJunk(text);
    if (!s || isFillerOnlyShort(s)) return "";
    for (const fix of sttNameFixes(operatorName, meeting)) {
      s = s.replace(fix.re, fix.to);
    }
    s = collapseRepeatedText(s);
    s = capitalizeSentences(s);
    return s.replace(/\s+/g, " ").trim();
  }

  function textFingerprint(text) {
    return collapseRepeatedText(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function similarText(a, b) {
    const na = textFingerprint(a);
    const nb = textFingerprint(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.45) {
      return true;
    }
    const wa = na.split(/\s+/).filter(Boolean);
    const wb = nb.split(/\s+/).filter(Boolean);
    if (wa.length < 4 || wb.length < 4) return false;
    const setA = new Set(wa);
    const common = wb.filter((word) => setA.has(word)).length;
    return common / Math.max(wa.length, wb.length) >= 0.7;
  }

  function remoteTileNames(meeting, operatorName) {
    return inviteeNames({ tileNames: meeting?.tileNames || [] }, operatorName);
  }

  function screenNameForRemote(meeting, operatorName, visualSpeaker) {
    const operator = operatorLabel(operatorName);
    const tiles = remoteTileNames(meeting, operator);
    const ctx = nameContext(operatorName, meeting);
    const visual = looksNamed(visualSpeaker) && !isOperatorOnCall(visualSpeaker, operatorName, meeting)
      ? displayNameForInvitee(visualSpeaker, ctx)
      : "";
    if (visual) return visual;
    if (tiles.length === 1) return displayNameForInvitee(tiles[0], ctx);
    return "";
  }

  function mergeAdjacentTurns(turns, opts = {}) {
    const out = [];
    for (const turn of Array.isArray(turns) ? turns : []) {
      const text = cleanMomWording(turn?.text, opts);
      if (!text || isJunkTranscript(text)) continue;
      const speaker = looksNamed(turn.speaker) || /^Speaker\s+\d+$/.test(String(turn.speaker || "").trim())
        ? String(turn.speaker).trim()
        : "Speaker";
      const source = String(turn.source || "");
      if (source === "mic") {
        const loopEcho = out.find((row) => row.source === "loop" && similarText(row.text, text));
        if (loopEcho) continue;
      }
      if (source === "loop") {
        const micEcho = out.findIndex((row) => row.source === "mic" && similarText(row.text, text));
        if (micEcho >= 0) out.splice(micEcho, 1);
      }
      const prev = out[out.length - 1];
      if (prev && similarText(prev.text, text) && prev.speaker !== speaker) {
        if (prev.source === "loop" && source === "mic") continue;
        if (prev.source === "mic" && source === "loop") continue;
        if (prev.source === "loop" && source === "loop") {
          /* keep both guests even if the wording overlaps */
        } else {
          continue;
        }
      }
      if (prev && prev.speaker === speaker && prev.source === source) {
        prev.text = `${prev.text} ${text}`.replace(/\s+/g, " ").trim();
        continue;
      }
      out.push({
        speaker,
        rawSpeaker: turn.rawSpeaker || speaker,
        source,
        text,
        at: Number(turn.at) || 0,
      });
    }
    return out;
  }

  function formatTurns(turns, opts = {}) {
    const lines = [];
    let last = "";
    for (const turn of mergeAdjacentTurns(turns, opts)) {
      if (turn.speaker !== last) {
        if (lines.length) lines.push("");
        lines.push(turn.speaker);
        last = turn.speaker;
      }
      lines.push(turn.text);
    }
    return lines.join("\n");
  }

  function parseTurnsFromTranscript(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    const chunks = raw.split(/\n\s*\n/);
    const turns = [];
    for (const chunk of chunks) {
      const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!lines.length) continue;
      if (lines.length === 1) {
        turns.push({ speaker: "Speaker", text: lines[0], source: "", at: 0 });
        continue;
      }
      const speaker = lines[0];
      const body = lines.slice(1).join(" ");
      turns.push({ speaker, text: body, source: "", at: 0 });
    }
    return turns;
  }

  function buildSpeakerThreads(turns, { operatorName, meeting, activeSpeaker } = {}) {
    const operator = operatorLabel(operatorName);
    const ctx = nameContext(operatorName, meeting);
    const tiles = (meeting?.tileNames || []).map((row) => String(row || "").trim()).filter(Boolean);
    const names = [];
    const add = (raw) => {
      const label = displayNameForInvitee(raw, ctx) || String(raw || "").trim();
      if (!label || /^speaker\s*\d+$/i.test(label) || /^guest$/i.test(label)) return;
      if (names.some((name) => isSamePerson(name, label))) return;
      names.push(label);
    };
    for (const tile of tiles) add(tile);
    const givenHits = names.filter((name) => isSamePerson(name, operator) || sharesGivenName(name, operator));
    if (!givenHits.length) add(operator);
    for (const turn of Array.isArray(turns) ? turns : []) {
      if (looksNamed(turn?.speaker)) add(turn.speaker);
    }
    const localName = names.find((name) => isSamePerson(name, operator))
      || (givenHits.length === 1 ? givenHits[0] : "");
    const active = String(activeSpeaker || "").trim();
    return names.map((name) => {
      const local = Boolean(localName) && isSamePerson(name, localName);
      const live = Boolean(active) && (
        isSamePerson(name, active)
        || (local && (isSamePerson(active, operator) || /^(you)$/i.test(active)))
      );
      return {
        name,
        local,
        live,
        turns: (Array.isArray(turns) ? turns : []).filter((turn) => {
          const speaker = String(turn?.speaker || "");
          if (isSamePerson(speaker, name)) return true;
          if (local && isLocalTurn(turn) && !names.some((other) => other !== name && isSamePerson(speaker, other))) {
            return true;
          }
          return false;
        }),
      };
    });
  }

  function segmentsToTurns(segments, { source, at } = {}) {
    const t0 = Number(at) || Date.now();
    return (Array.isArray(segments) ? segments : [])
      .map((seg, index) => ({
        speaker: String(seg?.speaker || "A"),
        text: String(seg?.text || "").trim(),
        source: source || "loop",
        at: t0 + Math.round((Number(seg?.start) || index) * 1000),
      }))
      .filter((turn) => turn.text && !isJunkTranscript(turn.text));
  }

  return {
    operatorLabel,
    inviteeNames,
    isOperatorOnCall,
    isSamePerson,
    normalizeDiarizeLabel,
    mapSpeakerTurns,
    mergeAdjacentTurns,
    formatTurns,
    parseTurnsFromTranscript,
    segmentsToTurns,
    collapseRepeatedText,
    isPlaceholderSpeaker,
    screenNameForRemote,
    assignRemoteTurns,
    matchTile,
    isJunkTranscript,
    cleanMomWording,
    cleanTranscriptText,
    buildSpeakerThreads,
  };
});
