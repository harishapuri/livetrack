/**
 * Microphone speech-to-text while Record is capturing steps.
 * Speech after a step, until the next step, becomes that step's explanation.
 * Mic / transcription must never block the Record toggle — callers may fire-and-forget
 * start(), and stop()/pause() bound their waits so permission or STT hangs cannot stick UI.
 */
(function () {
  const CHUNK_MS = 3000;
  const TARGET_RATE = 16000;
  const MIN_SECONDS = 0.5;
  const MIN_RMS = 0.012;
  const MIC_OPEN_MS = 4000;
  const FLUSH_WAIT_MS = 2500;

  const state = {
    recording: false,
    paused: false,
    streams: [],
    nodes: [],
    captureCtx: null,
    tap: null,
    chunkTimer: 0,
    utterances: [],
    steps: [],
    sent: new Map(),
    inFlight: 0,
    waiters: [],
    generation: 0,
    onStatus: null,
    onPreview: null,
    chain: Promise.resolve(),
  };

  function withTimeout(promise, ms, fallback) {
    const limit = Math.max(0, Number(ms) || 0);
    if (!limit) return Promise.resolve(promise).catch(() => fallback);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(fallback);
      }, limit);
      Promise.resolve(promise).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      );
    });
  }

  function explainApi() {
    return window.LtStepExplain || null;
  }

  function setStatus(text) {
    try {
      state.onStatus?.(text || "");
    } catch {
      /* ignore */
    }
  }

  function notify() {
    try {
      state.onPreview?.();
    } catch {
      /* ignore */
    }
  }

  function enqueue(fn) {
    const run = state.chain.then(fn, fn);
    state.chain = run.then(
      () => {},
      () => {}
    );
    return run;
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

  function rmsOf(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function stopStream(stream) {
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
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
    if (state.tap?.timer) clearInterval(state.tap.timer);
    state.tap = null;
    if (state.captureCtx && state.captureCtx.state !== "closed") {
      state.captureCtx.close().catch(() => {});
    }
    state.captureCtx = null;
  }

  function waitInFlight(ms) {
    if (state.inFlight <= 0) return Promise.resolve();
    const wait = new Promise((resolve) => {
      state.waiters.push(resolve);
    });
    if (ms == null) return wait;
    return withTimeout(wait, ms, undefined);
  }

  function releaseSlot() {
    state.inFlight = Math.max(0, state.inFlight - 1);
    if (state.inFlight === 0) {
      const pending = state.waiters.splice(0, state.waiters.length);
      for (const next of pending) {
        try {
          next();
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function transcribeSamples(samples, sampleRate, at) {
    if (!samples?.length || samples.length < sampleRate * MIN_SECONDS) return;
    if (rmsOf(samples) < MIN_RMS) return;
    const pcm = downsample(samples, sampleRate, TARGET_RATE);
    if (pcm.length < TARGET_RATE * MIN_SECONDS || rmsOf(pcm) < MIN_RMS) return;
    const base64 = await blobToBase64(encodeWav(pcm, TARGET_RATE));
    const result = await window.coact?.transcribeAudio?.({
      base64,
      mimeType: "audio/wav",
      model: "gpt-4o-mini-transcribe",
      whisperFallback: false,
    });
    if (!result?.ok) {
      const err = String(result?.error || "").trim();
      if (err && !/no speech heard/i.test(err)) setStatus(err);
      return;
    }
    const text = String(result.text || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    state.utterances.push({ at: at || Date.now(), text });
    setStatus("");
    notify();
  }

  async function flushTap(sampleRate, generation) {
    const tap = state.tap;
    if (!tap) return;
    const chunks = tap.chunks || [];
    const at = tap.chunkStart || Date.now();
    tap.chunks = [];
    tap.chunkStart = 0;
    if (!chunks.length) return;
    state.inFlight += 1;
    try {
      if (generation !== state.generation) return;
      await transcribeSamples(mergeFloat32(chunks), sampleRate, at);
    } catch (err) {
      setStatus(err?.message || "Could not convert speech to text.");
    } finally {
      releaseSlot();
    }
  }

  function connectTap(ctx, stream) {
    const source = ctx.createMediaStreamSource(stream);
    const tap = { chunks: [], chunkStart: 0, source, processor: null, mute: null, timer: 0 };
    const onPcm = (pcm) => {
      if (!state.recording) return;
      if (!tap.chunkStart) tap.chunkStart = Date.now();
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
      tap.timer = setInterval(() => {
        if (!state.recording) return;
        analyser.getFloatTimeDomainData(buf);
        onPcm(new Float32Array(buf));
      }, 40);
      state.nodes.push(source, analyser, mute);
    }
    state.tap = tap;
    state.streams.push(stream);
  }

  async function openMic() {
    if (typeof window.coact?.ensureMicrophone === "function") {
      const perm = await withTimeout(
        window.coact.ensureMicrophone(),
        MIC_OPEN_MS,
        { ok: true, timedOut: true }
      );
      if (perm && perm.ok === false) {
        return {
          ok: false,
          error:
            "Allow microphone access for LiveTrack in System Settings → Privacy & Security → Microphone.",
        };
      }
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: "This app cannot capture microphone audio." };
    }
    let mic = null;
    let mediaError = null;
    const mediaPromise = navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
      .then((stream) => {
        mic = stream;
        return stream;
      })
      .catch((err) => {
        mediaError = err;
        return null;
      });
    const opened = await withTimeout(mediaPromise, MIC_OPEN_MS, null);
    if (!opened) {
      if (mic) stopStream(mic);
      else mediaPromise.then((stream) => stream && stopStream(stream)).catch(() => {});
      if (mediaError) {
        return {
          ok: false,
          error:
            "Microphone permission is required. Allow LiveTrack in System Settings → Microphone.",
        };
      }
      return {
        ok: false,
        error: "Microphone did not respond in time. Steps still record without speech-to-text.",
      };
    }
    const captureCtx = new Ctx();
    if (captureCtx.state === "suspended") {
      try {
        await withTimeout(captureCtx.resume(), 1500, undefined);
      } catch {
        /* continue */
      }
    }
    state.nodes = [];
    state.streams = [];
    state.captureCtx = captureCtx;
    connectTap(captureCtx, mic);
    const rate = captureCtx.sampleRate || 44100;
    const generation = state.generation;
    state.chunkTimer = setInterval(() => {
      if (!state.recording) return;
      flushTap(rate, generation);
    }, CHUNK_MS);
    state.sampleRate = rate;
    return { ok: true };
  }

  async function publish(flush) {
    const api = explainApi();
    if (!api?.assignExplanations) return { explanations: [], pending: "" };
    const result = api.assignExplanations(state.steps, state.utterances, { flush: Boolean(flush) });
    const explanations = result.explanations || [];
    for (let i = 0; i < state.steps.length; i += 1) {
      const text = String(explanations[i] || "").trim();
      const id = String(state.steps[i]?.captureEventId || "").trim();
      if (!text || !id || state.sent.get(id) === text) continue;
      state.sent.set(id, text);
      try {
        const saved = await window.coact?.attachStepExplanation?.({
          captureEventId: id,
          explanation: text,
        });
        if (saved && saved.ok === false) state.sent.delete(id);
      } catch {
        state.sent.delete(id);
      }
    }
    return result;
  }

  function preview() {
    const api = explainApi();
    if (!api?.assignExplanations) return { explanations: [], pending: "" };
    return api.assignExplanations(state.steps, state.utterances, { flush: false });
  }

  async function start({ fresh = false } = {}) {
    if (state.recording) return { ok: true, already: true };
    const wasPaused = state.paused;
    if (fresh) {
      state.generation += 1;
      state.utterances = [];
      state.steps = [];
      state.sent = new Map();
    }
    const opened = await openMic();
    if (!opened.ok) {
      setStatus(opened.error || "Speech-to-text unavailable");
      state.paused = Boolean(wasPaused && !fresh);
      return opened;
    }
    state.recording = true;
    state.paused = false;
    setStatus("");
    notify();
    return { ok: true };
  }

  async function windDownCapture(flush) {
    const rate = state.sampleRate || state.captureCtx?.sampleRate || 44100;
    const generation = state.generation;
    if (state.chunkTimer) {
      clearInterval(state.chunkTimer);
      state.chunkTimer = 0;
    }
    const drain = (async () => {
      await flushTap(rate, generation);
      await waitInFlight();
    })();
    // Bound the wait so permission/STT hangs cannot stick callers (Record toggle).
    await withTimeout(drain, FLUSH_WAIT_MS, undefined);
    releaseCapture();
    const published = await withTimeout(
      enqueue(() => publish(Boolean(flush))),
      FLUSH_WAIT_MS,
      null
    );
    if (published) return { result: published, deferred: false };
    // Keep attaching in the background if transcription is still catching up.
    const deferred = drain
      .catch(() => {})
      .then(() => enqueue(() => publish(Boolean(flush))));
    deferred.catch(() => {});
    return { result: preview(), deferred: true, deferredPromise: deferred };
  }

  function clearExplainState() {
    state.utterances = [];
    state.steps = [];
    state.sent = new Map();
    setStatus("");
    notify();
  }

  async function pause() {
    if (!state.recording) {
      state.paused = true;
      return { ok: true };
    }
    state.recording = false;
    state.paused = true;
    const wound = await windDownCapture(false);
    if (wound.deferred && wound.deferredPromise) {
      wound.deferredPromise.then(() => notify()).catch(() => {});
    } else {
      notify();
    }
    return { ok: true };
  }

  async function stop() {
    const wasLive =
      state.recording || state.paused || state.inFlight > 0 || state.utterances.length || state.steps.length;
    if (state.recording) {
      state.recording = false;
    }
    state.paused = false;
    const generation = state.generation;
    let result = { explanations: [], pending: "" };
    if (wasLive) {
      const wound = await windDownCapture(true);
      result = wound.result || result;
      if (wound.deferred && wound.deferredPromise) {
        wound.deferredPromise
          .then(() => {
            if (generation === state.generation) clearExplainState();
          })
          .catch(() => {
            if (generation === state.generation) clearExplainState();
          });
        notify();
        return { ok: true, ...result, deferred: true };
      }
    }
    clearExplainState();
    return { ok: true, ...result };
  }

  function syncSteps(steps) {
    if (!state.recording && !state.paused) return preview();
    state.steps = Array.isArray(steps) ? steps : [];
    enqueue(() => publish(false)).then(() => notify());
    return preview();
  }

  function isActive() {
    return state.recording || state.paused;
  }

  window.liveTrackRecordExplain = {
    start,
    pause,
    resume: () => start({ fresh: false }),
    stop,
    syncSteps,
    preview,
    isActive,
    setHandlers({ onStatus, onPreview } = {}) {
      state.onStatus = onStatus || null;
      state.onPreview = onPreview || null;
    },
  };
})();
