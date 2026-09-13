(function () {
  const CHUNK_MS = 3000;
  const TARGET_RATE = 16000;
  const MAX_IN_FLIGHT = 4;
  const MIN_SECONDS = 0.5;
  const MIN_RMS = 0.008;
  const speakers = () => window.liveTrackMomSpeakers || {};

  const state = {
    recording: false,
    stopping: false,
    streams: [],
    nodes: [],
    captureCtx: null,
    taps: { mic: null, loop: null },
    chunkTimer: 0,
    rawTurns: [],
    turns: [],
    transcript: "",
    onTurns: null,
    onChunkText: null,
    onStatus: null,
    inFlight: 0,
    waiters: [],
    loopback: false,
    operatorName: "",
    meeting: null,
    visualSpeaker: "",
    visualLocal: false,
    lastRemoteName: "",
    knownRef: "",
    micRefChunks: [],
    micRefRate: 16000,
    discarded: false,
    captureId: 0,
  };

  function setStatus(text) {
    try {
      state.onStatus?.(text);
    } catch {
      /* ignore */
    }
  }

  function mergeFloat32(chunks) {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function downsample(float32, fromRate, toRate) {
    const srcRate = Number(fromRate) || toRate;
    if (!float32?.length) return float32 || new Float32Array(0);
    if (srcRate === toRate) return float32;
    const ratio = srcRate / toRate;
    const outLen = Math.max(1, Math.floor(float32.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i += 1) {
      out[i] = float32[Math.min(float32.length - 1, Math.floor(i * ratio))] || 0;
    }
    return out;
  }

  function encodeWav(float32, sampleRate) {
    const count = float32.length;
    const buffer = new ArrayBuffer(44 + count * 2);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + count * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, count * 2, true);
    let pos = 44;
    for (let i = 0; i < count; i += 1) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || "");
        const comma = raw.indexOf(",");
        resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
      };
      reader.onerror = () => reject(reader.error || new Error("read_failed"));
      reader.readAsDataURL(blob);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("read_failed"));
      reader.readAsDataURL(blob);
    });
  }

  function stopStream(stream) {
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
  }

  function dropVideo(stream) {
    try {
      stream?.getVideoTracks?.().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
    return stream;
  }

  function hasAudio(stream) {
    return Boolean(stream?.getAudioTracks?.().some((track) => track.readyState === "live"));
  }

  function takeTapPcm(tap) {
    if (!tap) return [];
    const chunks = tap.chunks || [];
    tap.chunks = [];
    return chunks;
  }

  function rmsOf(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function releaseCapture() {
    if (state.chunkTimer) {
      clearInterval(state.chunkTimer);
      state.chunkTimer = 0;
    }
    for (const node of state.nodes) {
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    state.nodes = [];
    for (const stream of state.streams) stopStream(stream);
    state.streams = [];
    for (const key of ["mic", "loop"]) {
      const tap = state.taps[key];
      if (tap?.timer) clearInterval(tap.timer);
    }
    state.taps = { mic: null, loop: null };
    state.loopback = false;
    if (state.captureCtx && state.captureCtx.state !== "closed") {
      state.captureCtx.close().catch(() => {});
    }
    state.captureCtx = null;
  }

  function drainWaiters() {
    const pending = state.waiters.splice(0, state.waiters.length);
    for (const next of pending) {
      try {
        next();
      } catch {
        /* ignore */
      }
    }
  }

  function resetTranscript() {
    state.rawTurns = [];
    state.turns = [];
    state.transcript = "";
    state.knownRef = "";
    state.micRefChunks = [];
  }

  async function acquireSlot() {
    const id = state.captureId;
    while (state.inFlight >= MAX_IN_FLIGHT) {
      if (state.discarded || state.captureId !== id) return false;
      await new Promise((resolve) => {
        state.waiters.push(resolve);
      });
    }
    if (state.discarded || state.captureId !== id) return false;
    state.inFlight += 1;
    return true;
  }

  function releaseSlot(id) {
    if (id != null && id !== state.captureId) return;
    state.inFlight = Math.max(0, state.inFlight - 1);
    const next = state.waiters.shift();
    if (next) next();
  }

  function wordingOpts() {
    return { operatorName: state.operatorName, meeting: state.meeting };
  }

  function cleanChunkText(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (speakers().cleanMomWording) return speakers().cleanMomWording(raw, wordingOpts());
    if (speakers().isJunkTranscript?.(raw)) return "";
    return raw;
  }

  function publishTurns() {
    if (state.discarded) return;
    const mapped = speakers().mapSpeakerTurns?.(state.rawTurns, {
      operatorName: state.operatorName,
      meeting: state.meeting,
      visualSpeaker: state.visualSpeaker,
    }) || state.rawTurns;
    state.turns = speakers().mergeAdjacentTurns?.(mapped, wordingOpts()) || mapped;
    state.transcript = speakers().formatTurns?.(state.turns, wordingOpts()) || state.turns.map((t) => t.text).join("\n");
    try {
      state.onTurns?.(state.turns, state.transcript, {
        tileNames: state.meeting?.tileNames || [],
        activeSpeaker: state.visualLocal
          ? speakers().operatorLabel?.(state.operatorName) || "You"
          : state.visualSpeaker || "",
        operatorName: state.operatorName,
        meeting: state.meeting,
      });
    } catch {
      /* ignore */
    }
    try {
      state.onChunkText?.(state.transcript, state.transcript);
    } catch {
      /* ignore */
    }
  }

  async function transcribeChunk(samples, sampleRate, { diarize, model, skipKnown } = {}) {
    if (state.discarded) return null;
    if (!samples?.length || samples.length < TARGET_RATE * MIN_SECONDS) return null;
    if (rmsOf(samples) < MIN_RMS) return null;
    const pcm = downsample(samples, sampleRate, TARGET_RATE);
    const blob = encodeWav(pcm, TARGET_RATE);
    const base64 = await blobToBase64(blob);
    if (state.discarded) return null;
    const payload = { base64, mimeType: "audio/wav", model, whisperFallback: false };
    if (diarize) {
      payload.diarize = true;
      const op = speakers().operatorLabel?.(state.operatorName) || "You";
      if (state.knownRef && !skipKnown) {
        payload.knownSpeakerNames = [op];
        payload.knownSpeakerReferences = [state.knownRef];
      }
    }
    const result = await window.coact.transcribeAudio(payload);
    if (state.discarded) return null;
    if (!result?.ok) {
      const err = String(result?.error || "");
      if (err && !/no speech heard/i.test(err)) setStatus(err);
      return null;
    }
    const segments = Array.isArray(result.segments)
      ? result.segments
          .map((seg) => ({ ...seg, text: cleanChunkText(seg?.text) }))
          .filter((seg) => seg.text)
      : [];
    let text = cleanChunkText(result.text);
    if (!text && segments.length) text = segments.map((seg) => seg.text).join(" ").trim();
    if (!text) return null;
    return { ...result, text, segments };
  }

  async function maybeSaveMicReference(chunks, sampleRate) {
    if (state.knownRef || !chunks.length) return;
    const samples = downsample(mergeFloat32(chunks), sampleRate, TARGET_RATE);
    if (samples.length < TARGET_RATE * 2) {
      state.micRefChunks.push(...chunks);
      state.micRefRate = sampleRate;
      const held = downsample(mergeFloat32(state.micRefChunks), sampleRate, TARGET_RATE);
      if (held.length < TARGET_RATE * 2 || rmsOf(held) < 0.01) return;
      const blob = encodeWav(held.slice(0, TARGET_RATE * 8), TARGET_RATE);
      state.knownRef = await blobToDataUrl(blob);
      state.micRefChunks = [];
      return;
    }
    if (rmsOf(samples) < 0.01) return;
    const blob = encodeWav(samples.slice(0, TARGET_RATE * 8), TARGET_RATE);
    state.knownRef = await blobToDataUrl(blob);
  }

  function samePerson(a, b) {
    if (speakers().isSamePerson) return speakers().isSamePerson(a, b);
    const na = String(a || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    const nb = String(b || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (!na || !nb) return false;
    return na === nb;
  }

  async function peekTeamsFrame() {
    try {
      const frame = await window.coact?.momTeamsFrame?.();
      if (!frame) return { speaking: "", visualLocal: false };
      const op = speakers().operatorLabel?.(state.operatorName) || "You";
      if (Array.isArray(frame.participants) && frame.participants.length) {
        const incoming = frame.participants.map((row) => String(row || "").trim()).filter(Boolean);
        const prev = state.meeting?.tileNames || [];
        const tileNames =
          incoming.length >= 2 ? incoming : [...new Set([...prev, ...incoming])];
        const changed = tileNames.join("|") !== prev.join("|");
        state.meeting = {
          ...(state.meeting || {}),
          tileNames,
        };
        if (changed) publishTurns();
      }
      const speaking = String(frame.speaking || frame.speakingFirst || "").trim();
      const tiles = (state.meeting?.tileNames || []).join(", ");
      const operatorTile = speakers().isOperatorOnCall
        ? speakers().isOperatorOnCall(speaking, state.operatorName, state.meeting)
        : samePerson(speaking, op) || samePerson(speaking, "You");
      const setLive = (visualLocal, visualSpeaker) => {
        const changed = state.visualLocal !== visualLocal || state.visualSpeaker !== visualSpeaker;
        state.visualLocal = visualLocal;
        state.visualSpeaker = visualSpeaker;
        if (changed) publishTurns();
      };
      if (!speaking || /^(null|undefined|none|unknown)$/i.test(speaking)) {
        if (tiles) setStatus(`Teams tiles: ${tiles}`);
        setLive(false, "");
        return { speaking: "", visualLocal: false };
      }
      if (operatorTile) {
        setStatus(`Teams tiles: ${tiles || op}`);
        setLive(true, "");
        return { speaking: "", visualLocal: true };
      }
      setStatus(`Teams tiles: ${tiles || speaking}`);
      setLive(false, speaking);
      return { speaking, visualLocal: false };
    } catch {
      return { speaking: "", visualLocal: false };
    }
  }

  function remoteScreenName() {
    const named = speakers().screenNameForRemote?.(state.meeting, state.operatorName, state.visualSpeaker);
    if (named) return named;
    const v = String(state.visualSpeaker || state.lastRemoteName || "").trim();
    const op = speakers().operatorLabel?.(state.operatorName) || "You";
    if (v && !/^(null|undefined|none|unknown)$/i.test(v) && !samePerson(v, op) && !samePerson(v, "You")) {
      return v;
    }
    return "";
  }

  function loopSpeakerLabel(fallback) {
    return remoteScreenName() || fallback;
  }

  function appendResultTurns(result, source, at, chunkVisual) {
    if (!result || state.discarded) return;
    const toTurns = speakers().segmentsToTurns;
    const localName = speakers().operatorLabel?.(state.operatorName) || "You";
    const asLocal = source === "mic";

    if (asLocal) {
      const text = String(result.text || "").trim();
      const rows =
        result.segments?.length && toTurns
          ? toTurns(result.segments, { source: "mic", at })
          : text
            ? [{ text, speaker: localName, source: "mic", at }]
            : [];
      for (const row of rows) {
        const text = cleanChunkText(row.text);
        if (!text) continue;
        state.rawTurns.push({
          ...row,
          text,
          speaker: localName,
          rawSpeaker: "local",
          source: "mic",
        });
      }
      return;
    }

    const rows = (
      result.segments?.length && toTurns
        ? toTurns(result.segments, { source: "loop", at })
        : String(result.text || "").trim()
          ? [{ text: String(result.text).trim(), speaker: "A", source: "loop", at, rawSpeaker: "A" }]
          : []
    ).map((row, index) => ({
      ...row,
      rawSpeaker: `${at}-${index}-${row.speaker || "A"}`,
    }));
    const assigned =
      speakers().assignRemoteTurns?.(rows, {
        operatorName: state.operatorName,
        meeting: state.meeting,
        visualSpeaker: chunkVisual || "",
      }) || rows;
    for (const row of assigned) {
      const text = cleanChunkText(row.text);
      if (!text) continue;
      state.rawTurns.push({
        ...row,
        text,
        rawSpeaker: row.rawSpeaker || row.speaker,
        source: "loop",
      });
    }
  }

  async function flushTracks(sampleRate) {
    const captureId = state.captureId;
    if (state.discarded) return;
    const micChunks = takeTapPcm(state.taps.mic);
    const loopChunks = takeTapPcm(state.taps.loop);
    if (!micChunks.length && !loopChunks.length) return;
    const got = await acquireSlot();
    if (!got || state.discarded || captureId !== state.captureId) return;
    try {
      const at = Date.now();
      const framePromise = peekTeamsFrame();
      const micSamples = micChunks.length ? mergeFloat32(micChunks) : null;
      const loopSamples = loopChunks.length ? mergeFloat32(loopChunks) : null;
      if (micSamples) await maybeSaveMicReference(micChunks, sampleRate);
      if (state.discarded || captureId !== state.captureId) return;
      const loopLoud = loopSamples && rmsOf(loopSamples) >= MIN_RMS;
      const micLoud = micSamples && rmsOf(micSamples) >= 0.012;
      const loopRms = loopSamples ? rmsOf(loopSamples) : 0;
      const micRms = micSamples ? rmsOf(micSamples) : 0;
      const remoteDominates = loopLoud && loopRms >= Math.max(MIN_RMS, micRms * 1.15);
      const userTalking = micLoud && !remoteDominates && (!loopLoud || micRms > loopRms * 2.2);
      const jobs = [
        framePromise,
        state.loopback && loopLoud
          ? transcribeChunk(loopSamples, sampleRate, { diarize: false, skipKnown: true })
          : Promise.resolve(null),
        userTalking
          ? transcribeChunk(micSamples, sampleRate, { model: "gpt-4o-mini-transcribe" })
          : Promise.resolve(null),
      ];
      const [frame, loopRes, micRes] = await Promise.all(jobs);
      if (state.discarded || captureId !== state.captureId) return;
      let visualLocal = Boolean(frame?.visualLocal);
      let chunkVisual = visualLocal ? "" : String(frame?.speaking || "").trim();
      if (speakers().isOperatorOnCall?.(chunkVisual, state.operatorName, state.meeting)) {
        visualLocal = true;
        chunkVisual = "";
      }
      if (visualLocal && remoteDominates) {
        visualLocal = false;
        chunkVisual = state.lastRemoteName || "";
      }
      state.visualLocal = visualLocal;
      state.visualSpeaker = chunkVisual;
      if (chunkVisual) state.lastRemoteName = chunkVisual;
      if (loopRes) appendResultTurns(loopRes, "loop", at, chunkVisual);
      if (micRes && visualLocal && !remoteDominates) {
        appendResultTurns(micRes, "mic", at + 1, chunkVisual);
      }
      state.rawTurns.sort((a, b) => (a.at || 0) - (b.at || 0));
      publishTurns();
    } catch (err) {
      if (!state.discarded) setStatus(err?.message || "Could not convert speech to text.");
    } finally {
      releaseSlot(captureId);
    }
  }

  function connectTap(ctx, stream, key) {
    if (!hasAudio(stream)) return false;
    const source = ctx.createMediaStreamSource(stream);
    const tap = {
      chunks: [],
      source,
      processor: null,
      mute: null,
    };
    const onPcm = (pcm) => {
      if (!state.recording) return;
      tap.chunks.push(pcm);
    };
    if (typeof ctx.createScriptProcessor === "function") {
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        onPcm(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      tap.processor = processor;
      tap.mute = mute;
      state.nodes.push(source, processor, mute);
    } else {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(analyser);
      analyser.connect(mute);
      mute.connect(ctx.destination);
      const buf = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        if (!state.recording) return;
        analyser.getFloatTimeDomainData(buf);
        onPcm(new Float32Array(buf));
      }, 40);
      tap.processor = analyser;
      tap.mute = mute;
      tap.timer = timer;
      state.nodes.push(source, analyser, mute);
    }
    state.taps[key] = tap;
    state.streams.push(stream);
    return true;
  }

  async function openMicStream({ echoCancellation }) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: Boolean(echoCancellation),
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  }

  async function openDisplayLoopback() {
    if (!navigator.mediaDevices?.getDisplayMedia) return null;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        systemAudio: "include",
      });
      dropVideo(stream);
      return hasAudio(stream) ? stream : (stopStream(stream), null);
    } catch {
      return null;
    }
  }

  async function openDesktopLoopback() {
    const source = await window.coact?.momLoopbackSource?.();
    if (!source?.ok || !source.id) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: source.id,
          },
        },
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: source.id,
            maxWidth: 2,
            maxHeight: 2,
          },
        },
      });
      dropVideo(stream);
      return hasAudio(stream) ? stream : (stopStream(stream), null);
    } catch {
      return null;
    }
  }

  async function start({ onChunkText, onTurns, onStatus, operatorName, meeting } = {}) {
    if (state.recording) return { ok: true, already: true };
    const perm = await window.coact?.ensureMicrophone?.();
    if (perm && perm.ok === false) {
      return {
        ok: false,
        error: "Allow microphone access for LiveTrack in System Settings → Privacy & Security → Microphone.",
      };
    }
    await window.coact?.ensureScreenCapture?.().catch(() => {});

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return { ok: false, error: "This app cannot capture audio on this machine." };
    }

    let loopback = await openDisplayLoopback();
    if (!loopback) loopback = await openDesktopLoopback();

    let mic;
    try {
      mic = await openMicStream({ echoCancellation: Boolean(loopback) });
    } catch {
      if (loopback) stopStream(loopback);
      return {
        ok: false,
        error: "Microphone permission is required. Allow LiveTrack in System Settings → Microphone.",
      };
    }

    const captureCtx = new Ctx();
    if (captureCtx.state === "suspended") await captureCtx.resume();

    state.nodes = [];
    state.streams = [];
    state.taps = { mic: null, loop: null };
    connectTap(captureCtx, mic, "mic");
    if (loopback) {
      connectTap(captureCtx, loopback, "loop");
      state.loopback = true;
    }

    state.onChunkText = onChunkText || null;
    state.onTurns = onTurns || null;
    state.onStatus = onStatus || null;
    state.operatorName = String(operatorName || "").trim();
    state.meeting = meeting || null;
    state.visualSpeaker = "";
    state.visualLocal = false;
    state.lastRemoteName = "";
    state.rawTurns = [];
    state.turns = [];
    state.transcript = "";
    state.knownRef = "";
    state.micRefChunks = [];
    state.captureCtx = captureCtx;
    state.discarded = false;
    state.captureId += 1;
    state.recording = true;
    state.stopping = false;
    state.inFlight = 0;
    state.waiters = [];

    const rate = captureCtx.sampleRate || 44100;
    state.chunkTimer = setInterval(() => {
      if (!state.recording) return;
      flushTracks(rate);
    }, CHUNK_MS);

    setStatus(
      state.loopback
        ? "Listening on mic plus earphones/speakers (meeting playback)."
        : "Listening on the microphone, including speaker playback. Allow Screen Recording for earphone audio.",
    );
    return { ok: true, loopback: state.loopback };
  }

  async function cancel() {
    state.discarded = true;
    state.recording = false;
    state.stopping = false;
    state.captureId += 1;
    drainWaiters();
    releaseCapture();
    resetTranscript();
    state.inFlight = 0;
    state.waiters = [];
    setStatus("Recording cancelled.");
    try {
      state.onTurns?.([], "");
    } catch {
      /* ignore */
    }
    try {
      state.onChunkText?.("", "");
    } catch {
      /* ignore */
    }
    return { ok: true, discarded: true, transcript: "", turns: [] };
  }

  async function stop(opts = {}) {
    if (opts?.discard) return cancel();
    if (!state.recording && !state.stopping) {
      return { ok: true, transcript: state.transcript || "", turns: state.turns || [] };
    }
    state.recording = false;
    state.stopping = true;
    const sampleRate = state.captureCtx?.sampleRate || 44100;
    try {
      await flushTracks(sampleRate);
    } catch {
      /* ignore */
    }
    releaseCapture();
    while (state.inFlight > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    state.stopping = false;
    setStatus("Recording stopped.");
    return { ok: true, transcript: state.transcript || "", turns: state.turns || [] };
  }

  window.liveTrackMomRecord = {
    start,
    stop,
    cancel,
    isRecording() {
      return Boolean(state.recording);
    },
    getTranscript() {
      return state.transcript || "";
    },
    getTurns() {
      return state.turns || [];
    },
    getMeta() {
      return {
        tileNames: state.meeting?.tileNames || [],
        activeSpeaker: state.visualLocal
          ? speakers().operatorLabel?.(state.operatorName) || "You"
          : state.visualSpeaker || "",
        operatorName: state.operatorName,
        meeting: state.meeting,
      };
    },
    reset() {
      resetTranscript();
    },
  };
})();
