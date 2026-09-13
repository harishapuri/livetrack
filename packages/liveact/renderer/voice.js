(function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const els = {
    panel: () => document.getElementById("voicePanel"),
    toggle: () => document.getElementById("btnVoicePanel"),
    mics: () => document.querySelectorAll(".js-mic"),
    input: () => {
      const formShell = document.getElementById("genaiShell");
      if (formShell && !formShell.classList.contains("hidden")) {
        return document.getElementById("formChatInput");
      }
      return document.getElementById("generalChatInput") || document.getElementById("formChatInput");
    },
    autoSpeak: () => document.getElementById("voiceAutoSpeak"),
    select: () => document.getElementById("voiceSelect"),
    rate: () => document.getElementById("voiceRate"),
    pitch: () => document.getElementById("voicePitch"),
    rateValue: () => document.getElementById("voiceRateValue"),
    pitchValue: () => document.getElementById("voicePitchValue"),
    status: () => document.getElementById("voiceStatus"),
    settingsSelect: () => document.getElementById("settingsVoiceSelect"),
    settingsRate: () => document.getElementById("settingsVoiceRate"),
    settingsPitch: () => document.getElementById("settingsVoicePitch"),
    settingsRateValue: () => document.getElementById("settingsVoiceRateValue"),
    settingsPitchValue: () => document.getElementById("settingsVoicePitchValue"),
    settingsStatus: () => document.getElementById("settingsVoiceStatus"),
  };

  const LISTEN_PLACEHOLDER = "Listening… speak, then tap Mic";
  const CONVERT_PLACEHOLDER = "Converting speech to text…";

  const state = {
    listening: false,
    finishing: false,
    recognition: null,
    recorder: null,
    stream: null,
    chunks: [],
    dictationBase: "",
    savedPlaceholder: "",
    voices: [],
    persistTimer: 0,
    speakSeq: 0,
    synthesizing: false,
    quietSpeak: false,
    lastError: "",
    player: null,
    players: [],
    objectUrl: null,
    audioCtx: null,
  };

  /** Single source of truth for TTS — synced from Settings / voice panel, not live DOM alone. */
  const prefs = {
    voiceName: "alloy",
    voiceRate: 0.85,
    voicePitch: 1,
  };

  const OPENAI_VOICES = [
    { id: "alloy", label: "Alloy" },
    { id: "echo", label: "Echo" },
    { id: "fable", label: "Fable" },
    { id: "onyx", label: "Onyx" },
    { id: "nova", label: "Nova" },
    { id: "shimmer", label: "Shimmer" },
  ];

  function setStatus(text) {
    const msg = String(text || "");
    const el = els.status();
    if (el) el.textContent = msg;
    const settingsEl = els.settingsStatus();
    if (settingsEl) settingsEl.textContent = msg;
  }

  function fmt(n) {
    return Number(n).toFixed(2);
  }

  function normalizeVoiceId(value, fallback = "alloy") {
    const id = String(value || "").trim().toLowerCase();
    return OPENAI_VOICES.some((v) => v.id === id) ? id : fallback;
  }

  function clampRate(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return prefs.voiceRate;
    return Math.min(1.4, Math.max(0.5, n));
  }

  function clampPitch(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return prefs.voicePitch;
    return Math.min(2, Math.max(0.5, n));
  }

  function activeVoiceName() {
    return prefs.voiceName || "alloy";
  }

  function activeRate() {
    return Number.isFinite(prefs.voiceRate) ? prefs.voiceRate : 0.85;
  }

  function activePitch() {
    return Number.isFinite(prefs.voicePitch) ? prefs.voicePitch : 1;
  }

  function setSelectValue(select, value) {
    if (!select) return;
    const id = normalizeVoiceId(value, prefs.voiceName || "alloy");
    if (OPENAI_VOICES.some((v) => v.id === id)) {
      select.value = id;
    } else if (!select.value) {
      select.value = "alloy";
    }
  }

  function setRateControls(value) {
    const rate = String(clampRate(value ?? prefs.voiceRate));
    for (const el of [els.rate(), els.settingsRate()]) {
      if (el) el.value = rate;
    }
    for (const el of [els.rateValue(), els.settingsRateValue()]) {
      if (el) el.textContent = fmt(rate);
    }
  }

  function setPitchControls(value) {
    const pitch = String(clampPitch(value ?? prefs.voicePitch));
    for (const el of [els.pitch(), els.settingsPitch()]) {
      if (el) el.value = pitch;
    }
    for (const el of [els.pitchValue(), els.settingsPitchValue()]) {
      if (el) el.textContent = fmt(pitch);
    }
  }

  function syncVoiceUi() {
    fillVoices();
    setSelectValue(els.select(), prefs.voiceName);
    setSelectValue(els.settingsSelect(), prefs.voiceName);
    setRateControls(prefs.voiceRate);
    setPitchControls(prefs.voicePitch);
  }

  function setVoicePrefs(patch = {}, { syncUi = true } = {}) {
    if (patch.voiceName != null && String(patch.voiceName).trim()) {
      prefs.voiceName = normalizeVoiceId(patch.voiceName, prefs.voiceName);
    }
    if (patch.voiceRate != null) prefs.voiceRate = clampRate(patch.voiceRate);
    if (patch.voicePitch != null) prefs.voicePitch = clampPitch(patch.voicePitch);
    if (syncUi) syncVoiceUi();
  }

  function speakable(text) {
    return String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_#>~|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function capWords(text, maxWords = 200) {
    const words = speakable(text).split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(" ");
    return `${words.slice(0, maxWords).join(" ")}.`;
  }

  function splitSpeakChunks(text) {
    const capped = capWords(text, 200);
    const match = capped.match(/^(.{12,220}?[.!?])(?:\s+|$)/);
    if (match) {
      const first = match[1].trim();
      const rest = capped.slice(match[0].length).trim();
      return rest ? [first, rest] : [first];
    }
    const words = capped.split(/\s+/);
    if (words.length <= 36) return [capped];
    return [words.slice(0, 36).join(" "), words.slice(36).join(" ")];
  }

  function currentVoice() {
    const name = activeVoiceName();
    return OPENAI_VOICES.find((v) => v.id === name) || OPENAI_VOICES[0];
  }

  function isSpeaking() {
    if (state.synthesizing) return true;
    const audio = state.player;
    return Boolean(audio && !audio.paused && !audio.ended && audio.src);
  }

  function waveEls() {
    return {
      root: document.getElementById("voiceWaveViz"),
      label: document.querySelector("#voiceWaveViz .voice-wave-label"),
    };
  }

  function setWaveVisible(on) {
    const { root } = waveEls();
    if (!root) return;
    root.classList.toggle("hidden", !on);
    root.classList.toggle("active", on);
    root.toggleAttribute("hidden", !on);
    root.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function syncSpeakButtons() {
    const active = isSpeaking();
    const quiet = Boolean(state.quietSpeak);
    document.querySelectorAll(".js-speak-btn").forEach((btn) => {
      btn.textContent = active ? "Stop" : "Speak";
      btn.classList.toggle("speaking", active);
      btn.title = active
        ? "Stop speaking"
        : btn.id === "btnMomSpeakTest"
          ? "Test meeting alert voice"
          : "Speak this reply";
    });
    for (const id of ["btnVoicePreview", "btnSettingsVoicePreview"]) {
      const preview = document.getElementById(id);
      if (preview) preview.textContent = active ? "Stop voice" : "Preview voice";
    }
    document.querySelectorAll(".js-stop-voice").forEach((stopHead) => {
      stopHead.classList.toggle("hidden", !active || quiet);
      stopHead.toggleAttribute("hidden", !active || quiet);
    });
    // Quiet coach guidance: audio only — no wave circle / tail ripple vibrator
    setWaveVisible(active && !quiet);
    const { label } = waveEls();
    if (label) {
      label.textContent = state.synthesizing ? "Preparing…" : "Speaking";
    }
    try {
      window.coact?.setTailStatus?.({ speaking: active && !quiet });
    } catch {
      /* ignore */
    }
  }

  function haltAudio(audio) {
    if (!audio) return;
    try {
      audio.onended = null;
      audio.onerror = null;
      audio.muted = true;
      audio.volume = 0;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.src = "";
    } catch {
      /* ignore */
    }
  }

  function stopSpeaking(opts = {}) {
    state.speakSeq = (state.speakSeq || 0) + 1;
    state.synthesizing = false;
    state.quietSpeak = false;
    haltAudio(state.player);
    (state.players || []).forEach(haltAudio);
    state.player = null;
    state.players = [];
    if (state.objectUrl) {
      try {
        URL.revokeObjectURL(state.objectUrl);
      } catch {
        /* ignore */
      }
      state.objectUrl = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    syncSpeakButtons();
    if (!opts.silent) setStatus("Voice stopped.");
  }

  async function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        if (!state.audioCtx) state.audioCtx = new Ctx();
        if (state.audioCtx.state === "suspended") await state.audioCtx.resume();
      }
    } catch {
      /* ignore */
    }
    if (!state.silentUnlock) {
      try {
        const silent = new Audio(
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="
        );
        silent.volume = 0.01;
        await silent.play();
        silent.pause();
        state.silentUnlock = true;
      } catch {
        /* ignore */
      }
    }
  }

  function speakWithSpeechSynthesis(text, seq) {
    return new Promise((resolve) => {
      try {
        const synth = window.speechSynthesis;
        if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
          state.lastError = "Speech synthesis unavailable.";
          resolve(false);
          return;
        }
        synth.cancel();
        const utter = new SpeechSynthesisUtterance(String(text || "").trim());
        if (!utter.text) {
          state.lastError = "Nothing to speak.";
          resolve(false);
          return;
        }
        utter.rate = Math.min(1.4, Math.max(0.7, activeRate()));
        utter.pitch = activePitch();
        utter.onend = () => {
          if (seq !== state.speakSeq) {
            resolve(false);
            return;
          }
          state.quietSpeak = false;
          syncSpeakButtons();
          resolve(true);
        };
        utter.onerror = () => {
          if (seq !== state.speakSeq) {
            resolve(false);
            return;
          }
          state.quietSpeak = false;
          state.lastError = "Could not play coach voice.";
          syncSpeakButtons();
          resolve(false);
        };
        state.synthesizing = false;
        syncSpeakButtons();
        synth.speak(utter);
      } catch (err) {
        state.lastError = err?.message || "Could not play coach voice.";
        state.quietSpeak = false;
        syncSpeakButtons();
        resolve(false);
      }
    });
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || "audio/mpeg" });
  }

  async function fetchSpeech(text) {
    return window.coact?.synthesizeSpeech?.({
      text,
      voice: currentVoice().id,
      speed: activeRate(),
    });
  }

  function playAudioResult(result, seq) {
    if (!result?.ok || !result.base64) return null;
    const blob = base64ToBlob(result.base64, result.mimeType);
    const url = URL.createObjectURL(blob);
    if (state.objectUrl) {
      try {
        URL.revokeObjectURL(state.objectUrl);
      } catch {
        /* ignore */
      }
    }
    state.objectUrl = url;
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.src = url;
    audio.volume = 1;
    audio.muted = false;
    state.player = audio;
    state.players = [audio];
    audio.onended = () => {
      if (seq !== state.speakSeq) return;
      haltAudio(audio);
      if (state.player === audio) state.player = null;
      if (typeof audio._onQueueEnded === "function") audio._onQueueEnded();
      else {
        state.quietSpeak = false;
        syncSpeakButtons();
        setStatus("Tap Mic to dictate. Replies are spoken from the app.");
      }
    };
    audio.onerror = () => {
      if (seq !== state.speakSeq) return;
      state.synthesizing = false;
      haltAudio(audio);
      syncSpeakButtons();
      setStatus("Could not play spoken audio.");
    };
    return audio;
  }

  async function speak(text, opts = {}) {
    const quiet = Boolean(opts?.quiet);
    const preferLocal = Boolean(opts?.preferLocal);
    const chunks = splitSpeakChunks(text);
    if (!chunks.length) {
      state.lastError = "Nothing to speak.";
      return false;
    }
    stopSpeaking({ silent: true });
    const seq = state.speakSeq;
    state.quietSpeak = quiet;
    state.lastError = "";
    state.synthesizing = true;
    syncSpeakButtons();
    await unlockAudio();
    if (seq !== state.speakSeq) {
      state.lastError = "Speech interrupted.";
      return false;
    }

    // Queue-card coach: local system voice is reliable for autoplay
    if (quiet && preferLocal) {
      return speakWithSpeechSynthesis(chunks.join(" "), seq);
    }

    if (!quiet) setStatus("Speaking… tap Stop to end.");
    const restPromise = chunks[1] ? fetchSpeech(chunks[1]) : null;
    const first = await fetchSpeech(chunks[0]);
    if (seq !== state.speakSeq) {
      state.lastError = "Speech interrupted.";
      return false;
    }
    if (!first?.ok || !first.base64) {
      state.synthesizing = false;
      if (quiet) return speakWithSpeechSynthesis(chunks.join(" "), seq);
      state.quietSpeak = false;
      state.lastError = first?.error || "Could not speak from the app.";
      syncSpeakButtons();
      setStatus(state.lastError);
      return false;
    }
    const audio = playAudioResult(first, seq);
    if (!audio) {
      if (quiet) return speakWithSpeechSynthesis(chunks.join(" "), seq);
      state.lastError = "Could not play spoken audio.";
      return false;
    }
    state.synthesizing = false;
    try {
      if (seq !== state.speakSeq) {
        haltAudio(audio);
        state.lastError = "Speech interrupted.";
        return false;
      }
      await audio.play();
      syncSpeakButtons();
      if (restPromise) {
        audio._onQueueEnded = async () => {
          if (seq !== state.speakSeq) return;
          const rest = await restPromise;
          if (seq !== state.speakSeq || !rest?.ok) {
            state.quietSpeak = false;
            if (rest && !rest.ok) state.lastError = rest.error || "Could not speak from the app.";
            syncSpeakButtons();
            if (!quiet) setStatus("Tap Mic to dictate. Replies are spoken from the app.");
            return;
          }
          const next = playAudioResult(rest, seq);
          if (!next) return;
          try {
            await next.play();
            syncSpeakButtons();
          } catch (err) {
            state.lastError = err?.message || "Click Coach once to enable app speech.";
            syncSpeakButtons();
          }
        };
      }
      return true;
    } catch (err) {
      state.synthesizing = false;
      haltAudio(audio);
      if (quiet) return speakWithSpeechSynthesis(chunks.join(" "), seq);
      state.quietSpeak = false;
      state.lastError = err?.message || "Click Preview voice once to enable app speech.";
      syncSpeakButtons();
      setStatus(state.lastError);
      return false;
    }
  }

  function fillVoices() {
    for (const select of [els.select(), els.settingsSelect()]) {
      if (!select) continue;
      const previous = select.value || prefs.voiceName;
      select.innerHTML = "";
      OPENAI_VOICES.forEach((voice) => {
        const opt = document.createElement("option");
        opt.value = voice.id;
        opt.textContent = voice.label;
        select.appendChild(opt);
      });
      select.value = normalizeVoiceId(previous, prefs.voiceName || "alloy");
    }
  }

  function applySettings(s) {
    if (!s) return;
    const auto = els.autoSpeak();
    if (auto) auto.checked = false;
    const patch = {};
    if (s.voiceName != null && String(s.voiceName).trim()) patch.voiceName = s.voiceName;
    if (s.voiceRate != null) patch.voiceRate = s.voiceRate;
    if (s.voicePitch != null) patch.voicePitch = s.voicePitch;
    setVoicePrefs(patch);
  }

  function snapshot() {
    return {
      voiceAutoSpeak: false,
      voiceRate: activeRate(),
      voicePitch: activePitch(),
      voiceName: activeVoiceName(),
    };
  }

  function persistSoon() {
    clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(async () => {
      try {
        await window.coact?.saveOpenAiSettings?.(snapshot());
      } catch {
        /* ignore */
      }
    }, 250);
  }

  function setListeningUi(on) {
    els.mics().forEach((mic) => {
      mic.classList.toggle("listening", on);
      mic.setAttribute("aria-pressed", on ? "true" : "false");
      mic.title = on ? "Stop and convert to text" : "Speak your prompt";
    });
  }

  function showLiveWords(text) {
    const input = els.input();
    if (!input) return;
    const piece = String(text || "").trim();
    if (state.dictationBase) {
      input.value = `${state.dictationBase}${piece}`;
      return;
    }
    input.value = "";
    input.placeholder = piece || LISTEN_PLACEHOLDER;
  }

  function commitWords(text) {
    const input = els.input();
    if (!input) return;
    const piece = String(text || "").trim();
    const base = String(state.dictationBase || "").replace(/\s+$/, "");
    input.value = [base, piece].filter(Boolean).join(" ");
    input.placeholder = state.savedPlaceholder || "Ask LiveTrack… or tap Mic";
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function restorePlaceholder() {
    const input = els.input();
    if (!input) return;
    input.placeholder = state.savedPlaceholder || "Ask LiveTrack… or tap Mic";
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

  function stopPreviewRecognition() {
    try {
      state.recognition?.stop();
    } catch {
      /* ignore */
    }
    state.recognition = null;
  }

  function startPreviewRecognition() {
    if (!SpeechRecognition) return;
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = currentVoice()?.lang || navigator.language || "en-US";
      recognition.onresult = (event) => {
        if (!state.listening) return;
        let finalText = "";
        let interim = "";
        for (let i = 0; i < event.results.length; i += 1) {
          const piece = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) finalText += piece;
          else interim += piece;
        }
        showLiveWords(finalText || interim);
      };
      recognition.onerror = () => {
        /* Chromium speech often fails in Electron; Whisper still converts on stop. */
      };
      recognition.onend = () => {
        if (state.listening && state.recognition === recognition) {
          try {
            recognition.start();
          } catch {
            /* ignore */
          }
        }
      };
      state.recognition = recognition;
      recognition.start();
    } catch {
      /* ignore */
    }
  }

  function releaseMic() {
    if (state.captureTimer) {
      clearInterval(state.captureTimer);
      state.captureTimer = 0;
    }
    try {
      state.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      state.processor?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      state.audioSource?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      state.captureGain?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      state.stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
    state.analyser = null;
    state.processor = null;
    state.audioSource = null;
    state.captureGain = null;
    state.stream = null;
    if (state.captureCtx && state.captureCtx.state !== "closed") {
      state.captureCtx.close().catch(() => {});
    }
    state.captureCtx = null;
  }

  async function startListening() {
    const input = els.input();
    if (!input || state.listening || state.finishing) return;

    const perm = await window.coact?.ensureMicrophone?.();
    if (perm && perm.ok === false) {
      setStatus("Allow microphone access for LiveTrack in System Settings → Privacy & Security → Microphone.");
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      setStatus("Microphone permission is required. Allow LiveTrack in System Settings → Microphone.");
      return;
    }

    const liveTrack = stream.getAudioTracks?.()[0];
    if (liveTrack?.muted || liveTrack?.readyState !== "live") {
      stream.getTracks().forEach((track) => track.stop());
      setStatus("Microphone is not live. Check System Settings → Microphone for LiveTrack.");
      return;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      stream.getTracks().forEach((track) => track.stop());
      setStatus("This app cannot capture audio on this machine.");
      return;
    }

    const captureCtx = new Ctx();
    if (captureCtx.state === "suspended") await captureCtx.resume();
    const audioSource = captureCtx.createMediaStreamSource(stream);
    const captureGain = captureCtx.createGain();
    captureGain.gain.value = 0.0001;
    const analyser = captureCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    audioSource.connect(analyser);
    analyser.connect(captureGain);
    captureGain.connect(captureCtx.destination);

    const pcmChunks = [];
    let peak = 0;
    const tap = new Float32Array(analyser.fftSize);
    const captureTimer = setInterval(() => {
      if (!state.listening) return;
      analyser.getFloatTimeDomainData(tap);
      pcmChunks.push(new Float32Array(tap));
      let sum = 0;
      for (let i = 0; i < tap.length; i += 1) sum += tap[i] * tap[i];
      const rms = Math.sqrt(sum / Math.max(1, tap.length));
      if (rms > peak) peak = rms;
      if (rms > 0.02) showLiveWords("Hearing you… tap Mic to convert to text");
    }, 40);

    state.savedPlaceholder = input.placeholder || "Ask LiveTrack… or tap Mic";
    const existing = String(input.value || "").replace(/\s+$/, "");
    state.dictationBase = existing ? `${existing} ` : "";
    state.stream = stream;
    state.captureCtx = captureCtx;
    state.audioSource = audioSource;
    state.captureGain = captureGain;
    state.analyser = analyser;
    state.captureTimer = captureTimer;
    state.pcmChunks = pcmChunks;
    state.pcmPeak = () => peak;
    state.listening = true;
    setListeningUi(true);
    showLiveWords("");
    setStatus("Listening… speak, then tap Mic again to turn it into text.");
    startPreviewRecognition();
  }

  async function finishListening() {
    if (!state.listening || state.finishing) return;
    state.listening = false;
    state.finishing = true;
    setListeningUi(false);
    stopPreviewRecognition();

    const input = els.input();
    if (input && !input.value.trim()) input.placeholder = CONVERT_PLACEHOLDER;
    setStatus("Converting speech to text…");
    els.mics().forEach((mic) => {
      mic.disabled = true;
    });

    const sampleRate = state.captureCtx?.sampleRate || 44100;
    const pcmChunks = state.pcmChunks || [];
    const peak = state.pcmPeak ? state.pcmPeak() : 0;
    const samples = mergeFloat32(pcmChunks);
    releaseMic();

    try {
      if (samples.length < sampleRate * 0.35) {
        restorePlaceholder();
        setStatus("That was too short. Hold Mic, speak a full sentence, then tap Mic again.");
        return;
      }
      if (peak < 0.008) {
        restorePlaceholder();
        setStatus("Mic was silent. Allow LiveTrack in System Settings → Microphone, then try again.");
        return;
      }
      const blob = encodeWav(samples, sampleRate);
      const base64 = await blobToBase64(blob);
      const result = await window.coact.transcribeAudio({ base64, mimeType: "audio/wav" });
      if (!result?.ok) {
        restorePlaceholder();
        setStatus(result?.error || "Could not convert speech to text.");
        return;
      }
      commitWords(result.text);
      setStatus("Prompt ready. Edit if needed, then send.");
    } catch (err) {
      restorePlaceholder();
      setStatus(err?.message || "Could not convert speech to text.");
    } finally {
      state.finishing = false;
      state.pcmChunks = [];
      els.mics().forEach((mic) => {
        mic.disabled = false;
      });
    }
  }

  function stopListening() {
    if (state.listening) {
      finishListening();
      return;
    }
    stopPreviewRecognition();
    releaseMic();
    setListeningUi(false);
  }

  function togglePanel() {
    const panel = els.panel();
    if (!panel) return;
    const open = panel.classList.contains("hidden") || panel.hasAttribute("hidden");
    panel.classList.toggle("hidden", !open);
    if (open) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    els.toggle()?.classList.toggle("active", open);
    syncVoiceUi();
  }

  async function init() {
    syncVoiceUi();

    try {
      const s = await window.coact?.getOpenAiSettings?.();
      applySettings(s);
    } catch {
      /* ignore */
    }

    els.toggle()?.addEventListener("click", () => {
      unlockAudio();
      togglePanel();
    });
    els.mics().forEach((mic) => {
      mic.addEventListener("click", () => {
        unlockAudio();
        if (state.listening) {
          finishListening();
          return;
        }
        startListening();
      });
    });
    document.getElementById("btnVoicePreview")?.addEventListener("click", async () => {
      if (isSpeaking()) {
        stopSpeaking();
        return;
      }
      await unlockAudio();
      const ok = await speak(
        "This is LiveTrack speaking from the app with your current voice and rate."
      );
      if (!ok && isSpeaking() === false) {
        setStatus("Could not play voice. Check the OpenAI key and computer volume.");
      }
    });
    document.getElementById("btnSettingsVoicePreview")?.addEventListener("click", async () => {
      if (isSpeaking()) {
        stopSpeaking();
        return;
      }
      await unlockAudio();
      const ok = await speak(
        "Hi, this is your meeting alert voice at the current rate."
      );
      if (!ok && isSpeaking() === false) {
        setStatus("Could not play voice. Check the OpenAI key and computer volume.");
      }
    });
    document.getElementById("btnVoiceWaveStop")?.addEventListener("click", () => {
      stopSpeaking();
    });
    document.querySelectorAll(".js-stop-voice").forEach((btn) => {
      btn.addEventListener("click", () => stopSpeaking());
    });
    els.autoSpeak()?.addEventListener("change", persistSoon);
    const onVoiceChange = (event) => {
      setVoicePrefs({ voiceName: event?.target?.value || activeVoiceName() });
      persistSoon();
    };
    const onRateInput = (event) => {
      setVoicePrefs({ voiceRate: event?.target?.value ?? activeRate() });
      persistSoon();
    };
    const onPitchInput = (event) => {
      setVoicePrefs({ voicePitch: event?.target?.value ?? activePitch() });
      persistSoon();
    };
    els.select()?.addEventListener("change", onVoiceChange);
    els.settingsSelect()?.addEventListener("change", onVoiceChange);
    els.rate()?.addEventListener("input", onRateInput);
    els.settingsRate()?.addEventListener("input", onRateInput);
    els.pitch()?.addEventListener("input", onPitchInput);
    els.settingsPitch()?.addEventListener("input", onPitchInput);

    setStatus("Tap Mic to dictate. Open Settings → Voice to pick a voice and slower rate.");

    // Keep audio unlocked so queue-card coach can autoplay after a click
    document.addEventListener(
      "pointerdown",
      () => {
        unlockAudio();
      },
      true,
    );
  }

  window.liveTrackVoice = {
    init,
    speak,
    stopSpeaking,
    stopListening,
    isAutoSpeak() {
      return false;
    },
    isSpeaking,
    applySettings,
    unlockAudio,
    lastError() {
      return state.lastError || "";
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
