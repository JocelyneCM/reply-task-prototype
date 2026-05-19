/**
 * Relay — participant + admin front-end.
 * Participant: polished multi-mode UI (SMS, Messenger, Email, Voice).
 * Admin: Relay research console (multi-section UI; same CSV / log APIs).
 * Legacy monolith code was removed; it referenced undefined globals and broke all pages.
 */

"use strict";

// -----------------------------------------------------------------------------
// Shared utilities
// -----------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Match server-side P### normalisation for URLs, storage, and payloads. */
function normalizeStudyParticipantIdClient(raw) {
  const s = String(raw || "").trim();
  const m = /^P(\d+)$/i.exec(s);
  if (!m) return s;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n)) return s;
  return `P${String(n).padStart(3, "0")}`;
}

/** Match server normalize_input_method for participant URL params and logging. */
function normalizeInputMethodClient(rawInputMethod, medium = "") {
  const value = String(rawInputMethod || "").trim().toLowerCase();
  const mediumNorm = String(medium || "").trim().toLowerCase();
  let normalized;
  if (value === "typing" || value === "keyboard") normalized = "Typing";
  else if (value === "swipe" || value === "swipe typing" || value === "swipetyping")
    normalized = "Swipe typing";
  else if (
    value === "voice" ||
    value === "speech" ||
    value === "speech-to-text" ||
    value === "speech to text" ||
    value === "voice-to-text" ||
    value === "voice to text"
  )
    normalized = "Voice-to-text";
  else if (!value) normalized = "Typing";
  else {
    const exact = String(rawInputMethod || "").trim();
    const allowed = ["Typing", "Swipe typing", "Voice-to-text"];
    normalized = allowed.includes(exact) ? exact : "Typing";
  }
  if (mediumNorm === "voice" && normalized !== "LLM") return "Voice-to-text";
  return normalized;
}

/** Primary study mediums (admin defaults). Legacy SMS/Voice still load for old plans/logs. */
const STUDY_MEDIUMS_PRIMARY = ["Messenger", "Email"];
const STUDY_MEDIUMS_LEGACY = ["SMS", "Voice"];

/** Chart/filter label: legacy mediums marked without changing stored CSV values. */
function formatMediumDisplayLabel(medium) {
  const m = String(medium || "").trim();
  if (!m || m === "—") return "—";
  if (m === "SMS") return "SMS (legacy)";
  if (m === "Voice") return "Voice (legacy)";
  return m;
}

function formatPromptKindLabel(kind) {
  const k = String(kind || "all").trim().toLowerCase();
  if (k === "email") return "Email";
  if (k === "sms_messenger") return "Messenger (chat)";
  if (k === "all") return "Messenger + Email";
  return kind || "—";
}

function sortMediumKeysForDisplay(keys) {
  const order = { Messenger: 0, Email: 1, SMS: 2, Voice: 3 };
  return [...keys].sort((a, b) => {
    const oa = order[a] ?? 50;
    const ob = order[b] ?? 50;
    if (oa !== ob) return oa - ob;
    return String(a).localeCompare(String(b));
  });
}

function studyMediumChoicesForSelect(selected) {
  const sel = String(selected || "").trim();
  const choices = [
    ["Messenger", "Messenger"],
    ["Email", "Email"],
  ];
  if (STUDY_MEDIUMS_LEGACY.includes(sel) && !choices.some(([v]) => v === sel)) {
    choices.push([sel, `${sel} (legacy — prefer Messenger or Email)`]);
  }
  return choices;
}

/** Normalize session-plan task fields (participant polling + admin plan table). */
function normalizeStudyTaskClient(t) {
  const defaults = {
    medium: "Messenger",
    input_method: "Typing",
    device: "",
    prompt_condition: "auto",
    prompt_pick: "random",
    text_prompt_id: "",
  };
  const o = { ...defaults, ...(t || {}) };
  let med = String(o.medium || "Messenger").trim();
  if (!["SMS", "Messenger", "Email", "Voice"].includes(med)) med = "Messenger";
  o.medium = med;
  const allowedIm = ["Typing", "Swipe typing", "Voice-to-text"];
  let im = String(o.input_method || "Typing").trim();
  if (!allowedIm.includes(im)) im = "Typing";
  o.input_method = im;
  const dev = String(o.device || "").trim().toLowerCase();
  o.device = dev === "phone" || dev === "laptop" ? dev : "";
  let pc = String(o.prompt_condition || "auto").trim().toLowerCase();
  if (!["formal", "informal", "auto"].includes(pc)) pc = "auto";
  o.prompt_condition = pc;
  let pp = String(o.prompt_pick || "random").trim().toLowerCase();
  if (pp !== "random" && pp !== "selected") pp = "random";
  o.prompt_pick = pp;
  let tid = String(o.text_prompt_id || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_\-]{0,63}$/.test(tid)) tid = "";
  if (o.prompt_pick === "random") tid = "";
  o.text_prompt_id = tid;
  return o;
}

function micAccessHelpMessage() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser does not support microphone recording. Try Chrome or Safari on a recent version.";
  }
  if (window.isSecureContext) return "";
  const host = (location.hostname || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return "";
  return (
    "Voice-to-text on phones needs HTTPS — browsers block the mic on http:// Wi‑Fi links (not a Relay bug). " +
    "Use ngrok (https://…) for phone mic, or use typing/swipe on HTTP. Tap “How to enable phone mic” in Study session for steps."
  );
}

function formatMicrophoneError(err) {
  const name = String(err?.name || "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone blocked. Allow mic access in browser site settings, then reload.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Microphone is in use by another app. Close it and try again.";
  }
  const secureHint = micAccessHelpMessage();
  if (secureHint) return secureHint;
  return "Could not access microphone.";
}

function formatSecondsCell(v) {
  const x = parseFloat(String(v ?? ""));
  if (!Number.isFinite(x)) return String(v ?? "");
  return x.toFixed(3);
}

function formatConfidenceCell(v) {
  const x = parseFloat(String(v ?? ""));
  if (!Number.isFinite(x)) return String(v ?? "");
  return x.toFixed(3);
}

/** Bucket logged prompt_formality for admin tables (matches server classify_prompt_condition_bucket). */
function promptConditionBucket(pf) {
  const x = String(pf || "").trim().toLowerCase();
  if (x === "formal" || x.startsWith("auto:label_1")) return "formal";
  if (x === "informal" || x.startsWith("auto:label_0")) return "informal";
  return "other";
}

/** Participants table: last prompt id, or short text preview when id missing on older rows. */
function formatLastPromptLoggedCell(stats) {
  const id = String(stats?.last_prompt_id || "").trim();
  if (id) return id;
  const text = String(stats?.last_prompt_text || stats?.last_prompt_preview || "").trim();
  if (!text) return "—";
  const max = 36;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** How the prompt bundle was chosen (matches server prompt_source_readable). */
function formatPromptSourceLabel(source) {
  const key = String(source || "").trim().toLowerCase();
  const labels = {
    url_param: "Library (URL id)",
    random: "Library (random)",
    library_id: "Library (next preset)",
    admin_selected_next: "Next preset",
    admin_custom_next: "Next custom",
    local: "Built-in fallback",
  };
  return labels[key] || (String(source || "").trim() || "—");
}

/** Map formality model class labels to short study-facing text (raw codes stay in CSV / advanced). */
function displayFormalityRegisterLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "—";
  const u = s.toUpperCase();
  if (u === "LABEL_0") return "Informal";
  if (u === "LABEL_1") return "Formal";
  return s;
}

function createEl(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function nowMs() {
  return performance.now();
}

function secondsBetween(a, b) {
  return Math.max(0, (b - a) / 1000);
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function fetchJSONWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const merged = { ...(options || {}), signal: controller.signal };
    return await fetchJSON(url, merged);
  } finally {
    clearTimeout(timer);
  }
}

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Lightweight follow-up line after the participant sends (UX only; not logged as separate row). */
function buildAutoReply(text) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return "Sounds good.";
  if (/\b(thank|thanks|thank you)\b/.test(t)) return "Anytime!";
  if (/\b(sad|upset|bad|angry|stressed|worried)\b/.test(t))
    return "I'm here if you want to talk more.";
  if (/\b(happy|great|good|excited|love|amazing)\b/.test(t))
    return "Love that for you.";
  if (/\b(help|can you|could you)\b/.test(t))
    return "Sure — what do you need?";
  if (/\?\s*$/.test(t)) return "Let me think on that.";
  return "Got it, thanks for letting me know.";
}

// -----------------------------------------------------------------------------
// Participant
// -----------------------------------------------------------------------------

function initParticipantUI() {
  const els = {
    app: document.getElementById("participantApp"),
    menuBtn: document.getElementById("pexMenuBtn"),
    drawer: document.getElementById("pexDrawer"),
    backdrop: document.getElementById("pexDrawerBackdrop"),
    drawerClose: document.getElementById("pexDrawerClose"),
    navBtns: Array.from(document.querySelectorAll(".pex-nav-btn")),
    title: document.getElementById("pexScreenTitle"),
    tagline: document.getElementById("pexScreenTagline"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    toast: document.getElementById("pexToast"),
    micBanner: document.getElementById("pexMicBanner"),
    participantId: document.getElementById("participantId"),
    studyCondition: document.querySelector(".pex-study-condition"),
    studyDeviceContext: document.getElementById("studyDeviceContext"),
    studyInputMethod: document.getElementById("studyInputMethod"),
    studyInputInstruction: document.getElementById("studyInputInstruction"),
    layoutSMS: document.getElementById("layoutSMS"),
    layoutMessenger: document.getElementById("layoutMessenger"),
    layoutEmail: document.getElementById("layoutEmail"),
    layoutVoice: document.getElementById("layoutVoice"),
    smsThread: document.getElementById("smsThread"),
    messengerThread: document.getElementById("messengerThread"),
    promptSMS: document.getElementById("promptSMS"),
    promptMsg: document.getElementById("promptMsg"),
    replySMS: document.getElementById("replySMS"),
    replyMsg: document.getElementById("replyMsg"),
    recordTextVoiceSMSBtn: document.getElementById("recordTextVoiceSMSBtn"),
    recordTextVoiceMsgBtn: document.getElementById("recordTextVoiceMsgBtn"),
    sendSMSBtn: document.getElementById("sendSMSBtn"),
    sendMsgBtn: document.getElementById("sendMsgBtn"),
    typingIndicator: document.getElementById("typingIndicator"),
    suggestionSMS: document.getElementById("suggestionSMS"),
    suggestionMsg: document.getElementById("suggestionMsg"),
    suggestionEmail: document.getElementById("suggestionEmail"),
    suggestionMP3: document.getElementById("suggestionMP3"),
    mailApp: document.getElementById("pexMailApp"),
    mailList: document.getElementById("pexMailList"),
    mailRead: document.getElementById("pexMailRead"),
    mailCompose: document.getElementById("pexMailCompose"),
    mailOpenBtn: document.getElementById("pexMailOpenBtn"),
    mailBackList: document.getElementById("pexMailBackList"),
    mailReplyBtn: document.getElementById("pexMailReplyBtn"),
    mailBackRead: document.getElementById("pexMailBackRead"),
    emailFrom: document.getElementById("emailFrom"),
    emailSubject: document.getElementById("emailSubject"),
    emailFromPreview: document.getElementById("emailFromPreview"),
    emailSubjectPreview: document.getElementById("emailSubjectPreview"),
    promptEmail: document.getElementById("promptEmail"),
    replyEmail: document.getElementById("replyEmail"),
    recordTextVoiceEmailBtn: document.getElementById("recordTextVoiceEmailBtn"),
    sendEmailBtn: document.getElementById("sendEmailBtn"),
    mailExchange: document.getElementById("pexMailExchange"),
    mailYourReply: document.getElementById("pexMailYourReply"),
    mailAlexReply: document.getElementById("pexMailAlexReply"),
    mailFinalWrap: document.getElementById("pexMailFinalWrap"),
    mailFinalReply: document.getElementById("pexMailFinalReply"),
    mailUnreadBadge: document.getElementById("pexMailUnreadBadge"),
    voiceThread: document.getElementById("voiceThread"),
    promptAudio: document.getElementById("promptAudio"),
    promptPlayBtn: document.getElementById("pexPromptPlayBtn"),
    promptTime: document.getElementById("pexPromptTime"),
    promptDuration: document.getElementById("pexPromptDuration"),
    voiceWave: document.getElementById("voiceWave"),
    voiceStatus: document.getElementById("voiceStatus"),
    recordBtn: document.getElementById("recordBtn"),
    recordMeter: document.getElementById("pexRecordMeter"),
    recordedClip: document.getElementById("recordedClip"),
    playbackAudio: document.getElementById("playbackAudio"),
    playbackToggleBtn: document.getElementById("pexPlaybackToggleBtn"),
    draftMeta: document.getElementById("pexDraftMeta"),
    transcriptDisplay: document.getElementById("pexVoiceTranscriptDisplay"),
    sendVoiceBtn: document.getElementById("sendVoiceBtn"),
    discardVoiceBtn: document.getElementById("pexVoiceDiscardBtn"),
    replyMP3: document.getElementById("replyMP3"),
  };

  /**
   * Writing-behaviour metrics collected per reply.
   *
   * Interpretation varies by input method:
   *   Typing        — keypressCount / backspaceCount are literal keyboard events.
   *   Swipe typing  — the browser may fire synthetic keydown events for each
   *                   inserted character; counts are approximate interaction/
   *                   editing events, NOT physical key presses or swipe gestures.
   *   Voice-to-text — keypressCount stays 0 unless the participant manually edits
   *                   the transcript. response_time_seconds is the main comparable
   *                   metric across all three methods (prompt-shown → Send).
   */
  const trial = {
    startedAtMs: null,
    lastInputAtMs: null,
    keypressCount: 0,
    backspaceCount: 0,
    pasteUsed: false,
    correctionApplied: false,
  };

  const studyEditTrace =
    typeof globalThis.ComposeEditTraceTracker === "function"
      ? new globalThis.ComposeEditTraceTracker()
      : null;
  if (studyEditTrace) {
    studyEditTrace.attachTextareas(els.replySMS, els.replyMsg, els.replyEmail);
  }

  // Tracks a small in-memory conversation run: first user reply -> LLM reply -> final user reply
  let currentRun = null;
  let currentMedium = "SMS";
  let lastTextMedium = "SMS";
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedFilename = "";
  /** Server transcript after upload (core logging path uses this on send). */
  let pendingVoiceTranscript = "";
  let recordedObjectUrl = null;
  let mediaStream = null;
  let audioContext = null;
  let analyser = null;
  let meterRaf = 0;
  let typingTimeout = null;
  /**
   * Incremented whenever the draft playback blob is reset so async duration
   * work from an older recording cannot overwrite the UI.
   */
  let playbackEpoch = 0;
  /** Prevents starting a new take while upload/metadata from the previous stop is in flight. */
  let voicePipelineBusy = false;
  /**
   * When true, the next mediaRecorder.onstop run should skip upload/blob UX (user
   * discarded or left Voice mode while recording). Mic is still released normally.
   */
  let voiceAbortCurrentTake = false;
  /** Per-medium timestamp for when the current prompt became visible. */
  const promptShownAtMsByMedium = {
    SMS: nowMs(),
    Messenger: nowMs(),
    Email: nowMs(),
    Voice: nowMs(),
  };
  /** Draft audio uploads for text mediums when input method is Voice. */
  const textVoiceDrafts = {
    SMS: { audioFilename: "", transcript: "", transcriptStatus: "" },
    Messenger: { audioFilename: "", transcript: "", transcriptStatus: "" },
    Email: { audioFilename: "", transcript: "", transcriptStatus: "" },
  };
  let textVoiceRecorder = null;
  let textVoiceStream = null;
  let textVoiceChunks = [];
  let textVoiceBusy = false;
  let textVoiceRecordingMedium = "";

  /** Voice prompt files from server (VoiceFiles/, audio/mp3/, static/audio/prompts/). */
  let voicePromptList = [];
  (function parseVoicePromptsJson() {
    const el = document.getElementById("pexVoicePromptsData");
    if (!el) return;
    try {
      const raw = el.textContent.trim();
      voicePromptList = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(voicePromptList)) voicePromptList = [];
    } catch (e) {
      console.warn("pexVoicePromptsData parse failed", e);
      voicePromptList = [];
    }
  })();

  const MODE_LABELS = {
    SMS: { title: "Messages", tag: "Text" },
    Messenger: { title: "Chats", tag: "Messenger" },
    Email: { title: "Mail", tag: "Inbox" },
    Voice: { title: "Voice", tag: "Voice notes" },
  };

  /** Prompt tags saved with each trial. Keep this simple for now. */
  let currentPromptMeta = {
    prompt_tone: "",
    prompt_seriousness: "",
    prompt_formality: "auto",
    prompt_id: "",
    prompt_source: "local",
  };
  /**
   * When the participant URL includes prompt_condition= (or legacy prompt_formality=),
   * we re-apply after the prompt bundle loads so the study session plan wins over bundle defaults.
   */
  let urlStudyPromptCondition = null;
  /** When set, participant loads this bundle id via /api/prompt_bundle (does not use global next). */
  let urlTextPromptId = null;
  /** Server session plan version last applied (participant polling). */
  let lastAppliedPlanVersion = "";
  /** How we got the transcript for voice rows. */
  let lastTranscriptStatus = "";
  let lastTranscriptSource = "";

  /** Scenario-aligned text prompts so SMS/Messenger/Email stay coherent. */
  const TEXT_PROMPT_SCENARIOS = [
    {
      sms: "Hi! Can you help me with something today?",
      messenger: "Hey! Can you help me with something today?",
      emailFrom: "someone@example.com",
      emailSubject: "Quick question",
      emailBody: "Hi! Can you help me with something today?",
    },
    {
      sms: "Can you quickly review this plan before 5?",
      messenger: "Could you glance at this plan before 5?",
      emailFrom: "teammate@example.com",
      emailSubject: "Quick plan review",
      emailBody: "Hi! Could you review this plan and share feedback before 5 PM?",
    },
    {
      sms: "Are you free to help me prep for tomorrow?",
      messenger: "Any chance you can help me prep for tomorrow?",
      emailFrom: "colleague@example.com",
      emailSubject: "Preparation help",
      emailBody: "Hello, are you available to help me prepare for tomorrow's meeting?",
    },
  ];

  function showToast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.add("hidden"), 2600);
  }

  function syncStudyInstruction() {
    if (!els.studyInputInstruction) return;
    const selected = (els.studyInputMethod?.value || "Typing").trim();
    if (selected === "Swipe typing") {
      els.studyInputInstruction.textContent = "Use swipe typing on your keyboard.";
      return;
    }
    if (selected === "Voice-to-text") {
      els.studyInputInstruction.textContent = "Use microphone dictation, then send the transcript.";
      return;
    }
    els.studyInputInstruction.textContent = "Type your reply normally.";
  }

  let serverMicLikelyAvailable = null;

  async function refreshMicrophoneBannerFromServer() {
    try {
      const h = await fetchJSON("/api/health");
      serverMicLikelyAvailable =
        typeof h.mic_likely_available === "boolean" ? h.mic_likely_available : null;
    } catch {
      serverMicLikelyAvailable = null;
    }
    syncMicrophoneBanner();
  }

  function syncMicrophoneBanner() {
    if (!els.micBanner) return;
    const needsMic = getSelectedInputMethod() === "Voice-to-text";
    if (!needsMic) {
      els.micBanner.classList.add("hidden");
      els.micBanner.textContent = "";
      return;
    }
    if (window.isSecureContext || serverMicLikelyAvailable === true) {
      els.micBanner.classList.add("hidden");
      els.micBanner.textContent = "";
      return;
    }
    const msg = micAccessHelpMessage();
    if (!msg) {
      els.micBanner.classList.add("hidden");
      return;
    }
    els.micBanner.textContent = msg;
    els.micBanner.classList.remove("hidden");
  }

  function syncStudyDeviceLayout(device) {
    const dev = (device || "").trim().toLowerCase();
    if (els.app) {
      if (dev === "phone" || dev === "laptop") els.app.dataset.studyDevice = dev;
      else delete els.app.dataset.studyDevice;
    }
    if (els.studyDeviceContext) {
      if (dev === "phone") els.studyDeviceContext.textContent = "Session note: phone";
      else if (dev === "laptop") els.studyDeviceContext.textContent = "Session note: laptop";
      else els.studyDeviceContext.textContent = "";
    }
  }

  function applyStudyTaskSettings(task, opts = {}) {
    const t = normalizeStudyTaskClient(task);
    const med = t.medium;
    if (["SMS", "Messenger", "Email", "Voice"].includes(med)) {
      if (med === "SMS") {
        const smsNav = document.querySelector(".pex-nav-legacy-sms");
        if (smsNav) {
          smsNav.classList.remove("hidden");
          smsNav.hidden = false;
          smsNav.setAttribute("aria-hidden", "false");
        }
      }
      showMode(med);
    }
    if (els.studyInputMethod) {
      els.studyInputMethod.value = normalizeInputMethodClient(t.input_method, med);
    }
    syncStudyDeviceLayout(t.device);
    urlStudyPromptCondition = t.prompt_condition;
    urlTextPromptId =
      t.prompt_pick === "selected" && t.text_prompt_id ? t.text_prompt_id : null;
    syncMicButtonVisibilityForInputMethod();
    syncStudyInstruction();
    syncMicrophoneBanner();
    const reloadPrompts = opts.reloadPrompts !== false;
    if (reloadPrompts && !currentRun) {
      assignRandomTextPrompts();
    } else if (reloadPrompts && currentRun) {
      currentPromptMeta.prompt_formality = t.prompt_condition;
    }
  }

  async function pollSessionPlanCurrent() {
    const pid = normalizeStudyParticipantIdClient(els.participantId?.value || "");
    if (!/^P\d{3,}$/i.test(pid)) return;
    try {
      const d = await fetchJSON(
        `/api/session_plan/current?participant_id=${encodeURIComponent(pid)}`
      );
      if (!d?.ok) return;
      const version = String(d.plan_version || "").trim();
      if (!version) return;
      if (!d.task) {
        lastAppliedPlanVersion = version;
        return;
      }
      if (version === lastAppliedPlanVersion) return;
      const isFirst = !lastAppliedPlanVersion;
      const sp = new URLSearchParams(window.location.search);
      const hadUrlTask =
        sp.has("medium") || sp.has("input_method") || sp.has("prompt_condition");
      if (isFirst && hadUrlTask) {
        lastAppliedPlanVersion = version;
        return;
      }
      lastAppliedPlanVersion = version;
      applyStudyTaskSettings(d.task, { reloadPrompts: !currentRun });
      if (!isFirst) showToast("Session task updated by researcher.");
    } catch {
      /* polling is best-effort */
    }
  }

  function pickRandom(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  function derivePromptMetaFromText(promptText) {
    const lower = String(promptText || "").toLowerCase();
    let tone = "neutral";
    let seriousness = "medium";
    if (/\b(urgent|asap|immediately|before 5|deadline)\b/.test(lower)) {
      tone = "urgent";
      seriousness = "high";
    } else if (/\b(sorry|apolog|regret)\b/.test(lower)) {
      tone = "apologetic";
    } else if (/\b(dear|regards|sincerely)\b/.test(lower)) {
      tone = "professional";
    } else if (/\b(hi|hey|hello|please|thank)\b/.test(lower)) {
      tone = "friendly";
    } else if (/\b(review|prepare|meeting|plan)\b/.test(lower)) {
      tone = "serious";
      seriousness = "high";
    }
    if (/\b(quick|small|tiny|short)\b/.test(lower) && seriousness !== "high")
      seriousness = "low";
    const formality =
      /\b(dear|regards|sincerely|to whom)\b/.test(lower)
        ? "formal"
        : /\b(hey|yo|lol|gonna|wanna)\b/.test(lower)
          ? "informal"
          : "neutral";
    return {
      prompt_tone: tone,
      prompt_seriousness: seriousness,
      prompt_formality: formality,
    };
  }

  function applyTextPromptScenario(scenario) {
    if (!scenario) return;
    if (els.promptSMS) els.promptSMS.textContent = scenario.sms || "";
    if (els.promptMsg) els.promptMsg.textContent = scenario.messenger || "";
    if (els.promptEmail) els.promptEmail.textContent = scenario.emailBody || "";
    if (els.emailFrom) els.emailFrom.textContent = scenario.emailFrom || "";
    if (els.emailFromPreview) els.emailFromPreview.textContent = scenario.emailFrom || "";
    if (els.emailSubject) els.emailSubject.textContent = scenario.emailSubject || "";
    if (els.emailSubjectPreview)
      els.emailSubjectPreview.textContent = scenario.emailSubject || "";
    const replySub = document.getElementById("replyEmailSubject");
    if (replySub)
      replySub.textContent = scenario.emailSubject
        ? `Re: ${scenario.emailSubject}`
        : "Re:";
    const emailTo = document.getElementById("emailToCompose");
    if (emailTo) emailTo.textContent = scenario.emailFrom || "someone@example.com";
    syncMailPreview();
    syncEmailThreadPeerCardFromDom();
    const t0 = document.getElementById("emailTimeOriginal");
    if (t0) {
      delete t0.dataset.locked;
      t0.textContent = formatMailCardTime();
    }
    currentPromptMeta = {
      prompt_tone: "",
      prompt_seriousness: "",
      prompt_formality: scenario.prompt_formality || "auto",
      prompt_id: scenario.id || "",
      prompt_source: scenario.source || "local",
    };
    const stamp = nowMs();
    promptShownAtMsByMedium.SMS = stamp;
    promptShownAtMsByMedium.Messenger = stamp;
    promptShownAtMsByMedium.Email = stamp;
    resetMailExchangeUi();
    els.mailUnreadBadge?.classList.add("hidden");
    startComposeEditTraceSession();
  }

  function formatMailCardTime() {
    try {
      return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  /** Sync first message card From/To/Subject lines from header fields. */
  function syncEmailThreadPeerCardFromDom() {
    const from = els.emailFrom?.textContent?.trim() || "someone@example.com";
    const to = els.emailTo?.textContent?.replace(/^to\s+/i, "").trim() || "you@study.local";
    const subj = els.emailSubject?.textContent?.trim() || "";
    const cf = document.getElementById("emailCardFrom");
    const ct = document.getElementById("emailCardTo");
    const cs = document.getElementById("emailCardSubject");
    if (cf) cf.textContent = from;
    if (ct) ct.textContent = to;
    if (cs) cs.textContent = subj || "—";
    const t0 = document.getElementById("emailTimeOriginal");
    if (t0 && !t0.dataset.locked) t0.textContent = formatMailCardTime();
  }

  function syncEmailFollowupMetaLines() {
    const alexAddr = els.emailFrom?.textContent?.trim() || "someone@example.com";
    const youLine = els.emailTo?.textContent?.replace(/^to\s+/i, "").trim() || "you@study.local";
    const reSub =
      document.getElementById("replyEmailSubject")?.textContent?.trim() || "Re:";
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set("emailCardToYou", alexAddr);
    set("emailCardSubjYou", reSub);
    set("emailCardToAlex", youLine);
    set("emailCardSubjAlex", reSub);
    set("emailCardToFinal", alexAddr);
    set("emailCardSubjFinal", reSub);
  }

  function resetMailExchangeUi() {
    if (els.mailYourReply) els.mailYourReply.textContent = "";
    if (els.mailAlexReply) els.mailAlexReply.textContent = "";
    if (els.mailFinalReply) els.mailFinalReply.textContent = "";
    if (els.mailFinalWrap) els.mailFinalWrap.classList.add("hidden");
    if (els.mailExchange) els.mailExchange.classList.add("hidden");
    ["emailTimeYou", "emailTimeAlex", "emailTimeFinal"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "";
    });
  }

  function applyUrlStudyPromptConditionOverride() {
    if (!urlStudyPromptCondition) return;
    const v = String(urlStudyPromptCondition).trim().toLowerCase();
    if (v !== "formal" && v !== "informal" && v !== "auto") return;
    currentPromptMeta.prompt_formality = v;
  }

  async function assignRandomTextPrompts() {
    try {
      let bundleUrl = "/api/prompt_bundle?consume=1";
      if (urlTextPromptId)
        bundleUrl += `&text_prompt_id=${encodeURIComponent(urlTextPromptId)}`;
      const data = await fetchJSON(bundleUrl);
      const bundle = data.text_bundle || null;
      if (bundle) {
        applyTextPromptScenario({
          id: bundle.id,
          sms: bundle.sms,
          messenger: bundle.messenger,
          emailFrom: bundle.email_from,
          emailSubject: bundle.email_subject,
          emailBody: bundle.email_body,
          source: bundle.source,
          prompt_formality: bundle.prompt_formality || "",
        });
        applyUrlStudyPromptConditionOverride();
        return;
      }
    } catch {
      /* use local fallback */
    }
    applyTextPromptScenario(pickRandom(TEXT_PROMPT_SCENARIOS));
    applyUrlStudyPromptConditionOverride();
  }

  function nextPresentationParticipantId(existingIds) {
    const nums = (existingIds || [])
      .map((id) => {
        const m = /^P(\d{3,})$/.exec(String(id || "").trim());
        return m ? parseInt(m[1], 10) : NaN;
      })
      .filter((n) => Number.isFinite(n));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `P${String(next).padStart(3, "0")}`;
  }

  function fallbackParticipantId() {
    const stamp = Date.now().toString().slice(-6);
    return `P${stamp.padStart(6, "0")}`;
  }

  function setParticipantId(pid) {
    if (!pid) return;
    if (els.participantId) els.participantId.value = pid;
    try {
      localStorage.setItem("relay_participant_id", pid);
    } catch {
      /* storage optional */
    }
  }

  function ensureParticipantIdInitialized() {
    const already = els.participantId?.value?.trim();
    if (already) return;
    try {
      const cached =
        localStorage.getItem("relay_participant_id") ||
        sessionStorage.getItem("relay_participant_id");
      if (cached) {
        setParticipantId(cached);
        return;
      }
    } catch {
      /* ignore storage issues */
    }
    fetchJSON("/api/participants")
      .then((data) => {
        const next =
          (data.suggested_next_participant_id || "").trim() ||
          nextPresentationParticipantId(data.participants || []);
        setParticipantId(next);
      })
      .catch(() => {
        setParticipantId(fallbackParticipantId());
      });
  }

  /**
   * Pick a random prompt from study audio folders (server-built list).
   * Called when entering Voice mode.
   */
  function assignVoicePrompt() {
    const audio = els.promptAudio;
    if (!audio) return;
    audio.pause();
    if (!voicePromptList.length) {
      audio.removeAttribute("src");
      audio.load();
      if (els.promptTime) els.promptTime.textContent = "0:00";
      if (els.promptDuration) els.promptDuration.textContent = "—";
      showToast("Add prompts to VoiceFiles/ or audio/mp3/ (see README).");
      return;
    }
    const pick =
      voicePromptList[Math.floor(Math.random() * voicePromptList.length)];
    audio.src = pick.url;
    audio.load();
    if (els.promptTime) els.promptTime.textContent = "0:00";
    if (els.promptDuration) els.promptDuration.textContent = "…";
    promptShownAtMsByMedium.Voice = nowMs();
    startComposeEditTraceSession();
  }

  /** Invalidate draft playback + clear duration label (new take / discard). */
  function resetPlaybackDraftState() {
    playbackEpoch++;
    if (recordedObjectUrl) {
      URL.revokeObjectURL(recordedObjectUrl);
      recordedObjectUrl = null;
    }
    if (els.playbackAudio) {
      els.playbackAudio.pause();
      els.playbackAudio.removeAttribute("src");
      els.playbackAudio.load();
    }
    if (els.draftMeta) els.draftMeta.textContent = "";
  }

  /**
   * True duration from decoded PCM (reliable for MediaRecorder blobs).
   * Falls back to <audio> metadata only if decode fails.
   */
  async function applyRecordingDurationFromBlob(blob, epochWhenBlobWasCreated) {
    let seconds = NaN;
    try {
      const raw = await blob.arrayBuffer();
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      try {
        const buf = await ctx.decodeAudioData(raw.slice(0));
        seconds = buf.duration;
      } finally {
        await ctx.close();
      }
    } catch {
      /* decode unsupported or failed */
    }
    if (epochWhenBlobWasCreated !== playbackEpoch) return;
    if (isFinite(seconds) && seconds > 0) {
      if (els.draftMeta) els.draftMeta.textContent = formatAudioTime(seconds);
      return;
    }
    const a = els.playbackAudio;
    if (!a) return;
    const syncFromElement = () => {
      if (epochWhenBlobWasCreated !== playbackEpoch) return;
      const d = a.duration;
      if (isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY) {
        if (els.draftMeta) els.draftMeta.textContent = formatAudioTime(d);
      }
    };
    a.addEventListener("loadedmetadata", syncFromElement, { once: true });
    a.addEventListener("durationchange", syncFromElement, { once: true });
  }

  function resetTrialState() {
    trial.startedAtMs = null;
    trial.lastInputAtMs = null;
    trial.keypressCount = 0;
    trial.backspaceCount = 0;
    trial.pasteUsed = false;
    trial.correctionApplied = false;
  }

  function setDrawerOpen(open) {
    const d = els.drawer;
    const b = els.backdrop;
    if (!d || !b) return;
    d.classList.toggle("is-open", open);
    d.setAttribute("aria-hidden", open ? "false" : "true");
    b.hidden = !open;
    b.setAttribute("aria-hidden", open ? "false" : "true");
    if (els.menuBtn) {
      els.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    document.body.classList.toggle("pex-drawer-open", open);
  }

  function openDrawer() {
    if (els.app?.classList.contains("pex-study-controlled")) return;
    setDrawerOpen(true);
  }
  function closeDrawer() {
    setDrawerOpen(false);
  }

  if (els.menuBtn && !els.app?.classList.contains("pex-study-controlled")) {
    els.menuBtn.addEventListener("click", openDrawer);
  }
  if (els.drawerClose) els.drawerClose.addEventListener("click", closeDrawer);
  if (els.backdrop) els.backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener("click", () => {
      const cur = document.body.dataset.theme || "dark";
      document.body.dataset.theme = cur === "dark" ? "light" : "dark";
    });
  }

  function syncMailPreview() {
    if (!els.emailFromPreview || !els.emailSubjectPreview) return;
    const from =
      els.emailFrom?.textContent?.trim() || "someone@example.com";
    const sub = els.emailSubject?.textContent?.trim() || "Quick question";
    const shortName = from.includes("@") ? from.split("@")[0] : from;
    els.emailFromPreview.textContent = shortName || "Someone";
    els.emailSubjectPreview.textContent = sub;
    const toCompose = document.getElementById("emailToCompose");
    if (toCompose) toCompose.textContent = from;
  }
  syncMailPreview();

  function setEmailStep(step) {
    if (!els.mailApp) return;
    els.mailApp.dataset.emailStep = step;
    els.mailList?.classList.toggle("hidden", step !== "list");
    els.mailRead?.classList.toggle("hidden", step !== "read");
    els.mailCompose?.classList.toggle("hidden", step !== "compose");
  }

  if (els.mailOpenBtn)
    els.mailOpenBtn.addEventListener("click", () => {
      els.mailUnreadBadge?.classList.add("hidden");
      syncEmailThreadPeerCardFromDom();
      setEmailStep("read");
    });
  if (els.mailBackList)
    els.mailBackList.addEventListener("click", () => setEmailStep("list"));
  if (els.mailReplyBtn)
    els.mailReplyBtn.addEventListener("click", () => {
      setEmailStep("compose");
      startComposeEditTraceSession();
    });
  if (els.mailBackRead)
    els.mailBackRead.addEventListener("click", () => setEmailStep("read"));

  function showMode(medium) {
    const previousMedium = currentMedium;
    if (previousMedium === "Voice" && medium !== "Voice") {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        voiceAbortCurrentTake = true;
        mediaRecorder.stop();
        els.recordBtn?.classList.remove("is-recording");
        // Mic is released in onstop after chunks flush — do not stop tracks here mid-stop.
      } else {
        stopMeter();
        stopMediaStream();
      }
    }

    if (medium === "Voice") {
      currentMedium = "Voice";
      document.body.dataset.medium = "Voice";
      els.layoutSMS?.classList.add("hidden");
      els.layoutMessenger?.classList.add("hidden");
      els.layoutEmail?.classList.add("hidden");
      els.layoutVoice?.classList.remove("hidden");
      const labels = MODE_LABELS.Voice;
      if (els.title) els.title.textContent = labels.title;
      if (els.tagline) els.tagline.textContent = labels.tag;
      els.navBtns.forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.medium === "Voice");
      });
      assignVoicePrompt();
      if (els.studyInputMethod) syncStudyInstruction();
      syncMicrophoneBanner();
      closeDrawer();
      resetTrialState();
      return;
    }

    currentMedium = medium;
    if (medium !== "Voice") lastTextMedium = medium;
    document.body.dataset.medium = medium;
    els.layoutSMS?.classList.toggle("hidden", medium !== "SMS");
    els.layoutMessenger?.classList.toggle("hidden", medium !== "Messenger");
    els.layoutEmail?.classList.toggle("hidden", medium !== "Email");
    els.layoutVoice?.classList.toggle("hidden", medium !== "Voice");

    const labels = MODE_LABELS[medium] || MODE_LABELS.SMS;
    if (els.title) els.title.textContent = labels.title;
    if (els.tagline) els.tagline.textContent = labels.tag;

    els.navBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.medium === medium);
    });

    if (medium === "Email") {
      if (currentRun && currentRun.medium === "Email") {
        setEmailStep("read");
      } else {
        setEmailStep("list");
      }
    }
    if (els.studyInputMethod) syncStudyInstruction();
    syncMicrophoneBanner();
    closeDrawer();
    resetTrialState();
  }

  els.navBtns.forEach((btn) => {
    btn.addEventListener("click", () => showMode(btn.dataset.medium));
  });

  if (els.studyInputMethod) {
    els.studyInputMethod.addEventListener("change", () => {
      syncStudyInstruction();
      syncMicButtonVisibilityForInputMethod();
      syncMicrophoneBanner();
    });
  }

  function attachTypingTracking(textarea) {
    if (!textarea) return;
    textarea.addEventListener("keydown", (e) => {
      if (trial.startedAtMs == null) trial.startedAtMs = nowMs();
      trial.lastInputAtMs = nowMs();
      trial.keypressCount += 1;
      if (e.key === "Backspace") trial.backspaceCount += 1;

      // Enter without Shift should submit quick chat replies for SMS/Messenger
      if (e.key === "Enter" && !e.shiftKey) {
        // Only treat Enter as submit for single-line chat inputs (SMS/Messenger)
        if (textarea === els.replySMS || textarea === els.replyMsg) {
          e.preventDefault();
          if (studyEditTrace) {
            studyEditTrace.recordSendTrigger({
              source: "enter_chat_submit",
              medium: textarea === els.replySMS ? "SMS" : "Messenger",
            });
          }
          if (textarea === els.replySMS) {
            els.sendSMSBtn && els.sendSMSBtn.click();
          } else {
            els.sendMsgBtn && els.sendMsgBtn.click();
          }
          return;
        }
      }

      if (currentMedium === "Messenger" && els.typingIndicator) {
        els.typingIndicator.textContent = "typing…";
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          els.typingIndicator.textContent = "online";
        }, 900);
      }
    });
    textarea.addEventListener("paste", () => {
      trial.pasteUsed = true;
      trial.lastInputAtMs = nowMs();
    });
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 140) + "px";
      trial.lastInputAtMs = nowMs();
      buildLiveSuggestion(textarea);
    });
  }

  attachTypingTracking(els.replySMS);
  attachTypingTracking(els.replyMsg);
  attachTypingTracking(els.replyEmail);

  function buildSuggestion(text) {
    if (!text || text.length < 2) return "";
    let s = text.trim();
    if (!/^[A-Z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.!?]$/.test(s)) s += ".";
    return s;
  }

  function renderSuggestion(wrap, suggestion, textarea) {
    if (!wrap || !textarea) return;
    wrap.innerHTML = "";
    if (!suggestion || suggestion === textarea.value.trim()) return;
    const row = createEl("div", "pex-suggest-row");
    const chip = createEl("button", "pex-suggest-chip");
    chip.type = "button";
    chip.textContent = suggestion;
    chip.addEventListener("click", () => {
      textarea.value = suggestion;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      trial.correctionApplied = true;
      if (studyEditTrace) studyEditTrace.noteSuggestionChipApplied();
      wrap.innerHTML = "";
    });
    const hint = createEl("span", "pex-suggest-hint");
    hint.textContent = "Suggestion · tap to apply";
    row.appendChild(hint);
    row.appendChild(chip);
    wrap.appendChild(row);
  }

  function buildLiveSuggestion(textarea) {
    let wrap = null;
    if (currentMedium === "SMS") wrap = els.suggestionSMS;
    else if (currentMedium === "Messenger") wrap = els.suggestionMsg;
    else if (currentMedium === "Email") wrap = els.suggestionEmail;
    if (!textarea || !wrap) return;
    renderSuggestion(wrap, buildSuggestion(textarea.value), textarea);
  }

  function scrollThread(el) {
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  function appendOutgoing(thread, text, kind) {
    const art = createEl("article", "pex-bubble pex-bubble--out");
    if (kind === "sms") art.classList.add("pex-bubble--sms");
    else art.classList.add("pex-bubble--msg");
    const meta = createEl("div", "pex-bubble-meta-out");
    meta.textContent = formatTime(new Date());
    const body = createEl("div", "pex-bubble-text");
    body.innerHTML = escapeHtml(text);
    art.appendChild(meta);
    art.appendChild(body);
    if (kind === "msg") {
      const tail = createEl("div", "pex-bubble-tail pex-bubble-tail--out");
      tail.setAttribute("aria-hidden", "true");
      art.appendChild(tail);
    }
    thread.appendChild(art);
    scrollThread(thread);
  }

  function appendIncoming(thread, text, kind) {
    const art = createEl("article", "pex-bubble pex-bubble--in");
    art.classList.add(kind === "sms" ? "pex-bubble--sms" : "pex-bubble--msg");
    const name = kind === "sms" ? createEl("div", "pex-bubble-name") : null;
    if (name) {
      name.textContent = "Alex";
      art.appendChild(name);
    }
    const body = createEl("div", "pex-bubble-text");
    body.innerHTML = escapeHtml(text);
    art.appendChild(body);
    if (kind === "msg") {
      const tail = createEl("div", "pex-bubble-tail pex-bubble-tail--in");
      tail.setAttribute("aria-hidden", "true");
      art.appendChild(tail);
    }
    thread.appendChild(art);
    scrollThread(thread);
    if (thread === els.smsThread) promptShownAtMsByMedium.SMS = nowMs();
    else if (thread === els.messengerThread) promptShownAtMsByMedium.Messenger = nowMs();
  }

  function showTypingRow(thread, kind) {
    const row = createEl("div", "pex-typing");
    row.innerHTML =
      kind === "msg"
        ? '<span class="pex-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="pex-typing-label">Alex is typing</span>'
        : '<span class="pex-typing-label">Alex is typing</span><span class="pex-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>';
    thread.appendChild(row);
    scrollThread(thread);
    return row;
  }

  function getPromptText() {
    if (currentMedium === "SMS") return els.promptSMS?.textContent?.trim() || "";
    if (currentMedium === "Messenger")
      return els.promptMsg?.textContent?.trim() || "";
    if (currentMedium === "Email")
      return [
        `From: ${els.emailFrom?.textContent?.trim() || ""}`,
        `Subject: ${els.emailSubject?.textContent?.trim() || ""}`,
        "",
        els.promptEmail?.textContent?.trim() || "",
      ].join("\n");
    if (currentMedium === "Voice") {
      const a = els.promptAudio;
      if (a?.src) {
        try {
          const u = new URL(a.src, window.location.origin);
          return `[Voice prompt: ${u.pathname.split("/").pop() || "audio"}]`;
        } catch {
          return "[Voice prompt]";
        }
      }
      return "[Voice prompt]";
    }
    return "";
  }

  function getReplyText() {
    if (currentMedium === "SMS") return els.replySMS?.value?.trim() || "";
    if (currentMedium === "Messenger") return els.replyMsg?.value?.trim() || "";
    if (currentMedium === "Email") return els.replyEmail?.value?.trim() || "";
    // Voice analysis should be based on transcript field, not mirrored reply_text.
    if (currentMedium === "Voice") return "";
    return "";
  }

  function getSelectedInputMethod() {
    const selected = (els.studyInputMethod?.value || "").trim();
    if (selected === "Typing") return "Typing";
    if (selected === "Swipe typing") return "Swipe typing";
    if (selected === "Voice-to-text") return "Voice-to-text";
    return "Typing";
  }

  function startComposeEditTraceSession() {
    if (!studyEditTrace) return;
    studyEditTrace.startNewSession({
      medium: currentMedium,
      input_method: getSelectedInputMethod(),
    });
  }

  function syncMicButtonVisibilityForInputMethod() {
    const showMic = getSelectedInputMethod() === "Voice-to-text";
    ["SMS", "Messenger", "Email"].forEach((medium) => {
      const btn = textVoiceButtonForMedium(medium);
      if (!btn) return;
      btn.classList.toggle("hidden", !showMic);
    });
  }

  function textReplyBoxForMedium(medium) {
    if (medium === "SMS") return els.replySMS;
    if (medium === "Messenger") return els.replyMsg;
    if (medium === "Email") return els.replyEmail;
    return null;
  }

  function textVoiceButtonForMedium(medium) {
    if (medium === "SMS") return els.recordTextVoiceSMSBtn;
    if (medium === "Messenger") return els.recordTextVoiceMsgBtn;
    if (medium === "Email") return els.recordTextVoiceEmailBtn;
    return null;
  }

  function refreshTextVoiceButtons() {
    ["SMS", "Messenger", "Email"].forEach((medium) => {
      const btn = textVoiceButtonForMedium(medium);
      if (!btn) return;
      const isRecording =
        textVoiceRecorder &&
        textVoiceRecorder.state === "recording" &&
        textVoiceRecordingMedium === medium;
      btn.classList.toggle("is-recording", !!isRecording);
      btn.textContent = isRecording ? "Stop" : "Mic";
    });
    syncMicButtonVisibilityForInputMethod();
  }

  function clearTextVoiceDraft(medium) {
    if (!textVoiceDrafts[medium]) return;
    textVoiceDrafts[medium] = {
      audioFilename: "",
      transcript: "",
      transcriptStatus: "",
    };
  }

  function syncTextVoiceReplyFromDraft(medium) {
    const draft = textVoiceDrafts[medium];
    const box = textReplyBoxForMedium(medium);
    if (!draft || !box) return;
    if (draft.transcript) {
      if (studyEditTrace) studyEditTrace.noteVoiceTranscriptInserted(draft.transcript);
      box.value = draft.transcript;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function stopTextVoiceStream() {
    if (!textVoiceStream) return;
    try {
      textVoiceStream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    } finally {
      textVoiceStream = null;
    }
  }

  async function toggleTextVoiceRecording(medium) {
    if (textVoiceBusy) {
      showToast("Please wait for upload/transcription.");
      return;
    }
    if (
      textVoiceRecorder &&
      textVoiceRecorder.state === "recording" &&
      textVoiceRecordingMedium === medium
    ) {
      textVoiceRecorder.stop();
      return;
    }
    if (textVoiceRecorder && textVoiceRecorder.state === "recording") {
      showToast("Stop the current recording first.");
      return;
    }

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error(e);
      showToast(formatMicrophoneError(e));
      syncMicrophoneBanner();
      return;
    }

    promptShownAtMsByMedium[medium] = promptShownAtMsByMedium[medium] || nowMs();
    textVoiceChunks = [];
    textVoiceStream = stream;
    textVoiceRecordingMedium = medium;
    const mime = pickRecorderMime();
    textVoiceRecorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);

    textVoiceRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) textVoiceChunks.push(e.data);
    };
    textVoiceRecorder.onstop = async () => {
      textVoiceBusy = true;
      refreshTextVoiceButtons();
      try {
        stopTextVoiceStream();
        const blob = new Blob(textVoiceChunks, {
          type: textVoiceRecorder?.mimeType || "audio/webm",
        });
        textVoiceChunks = [];
        if (blob.size < 200) {
          showToast("Recording too short. Try again.");
          clearTextVoiceDraft(medium);
          return;
        }
        const form = new FormData();
        const ext = blob.type.includes("webm")
          ? "webm"
          : blob.type.includes("mp4")
            ? "m4a"
            : "dat";
        form.append("file", blob, `reply.${ext}`);

        const res = await fetchJSONWithTimeout(
          "/api/upload_audio",
          { method: "POST", body: form },
          20000
        );
        textVoiceDrafts[medium] = {
          audioFilename: res.audio_filename || "",
          transcript: (res.transcript || "").trim(),
          transcriptStatus: res.transcript_status || "",
        };
        syncTextVoiceReplyFromDraft(medium);
        if (textVoiceDrafts[medium].transcript) {
          showToast("Voice transcript ready. Tap send.");
        } else {
          showToast("Voice uploaded. Transcript unavailable.");
        }
      } catch (e) {
        console.error(e);
        clearTextVoiceDraft(medium);
        if (e?.name === "AbortError") {
          showToast("Voice upload timed out.");
        } else {
          showToast("Voice upload failed.");
        }
      } finally {
        textVoiceBusy = false;
        textVoiceRecordingMedium = "";
        refreshTextVoiceButtons();
      }
    };
    textVoiceRecorder.start(120);
    refreshTextVoiceButtons();
  }

  async function submitReply(extra = {}) {
    const pidRaw = els.participantId?.value?.trim() || fallbackParticipantId();
    const pid = normalizeStudyParticipantIdClient(pidRaw) || pidRaw;
    if (els.participantId) els.participantId.value = pid;
    setParticipantId(pid);

    /** Block duplicate sends while the first-turn assistant reply is still loading (fixes Email/SMS race). */
    if (
      currentRun &&
      currentRun.llm_reply_text === "" &&
      currentRun.final_text === ""
    ) {
      showToast("Waiting for assistant reply…");
      return;
    }

    const replyText =
      extra.replyText != null ? String(extra.replyText).trim() : getReplyText();
    const promptText =
      extra.promptText != null ? String(extra.promptText).trim() : getPromptText();
    const promptMetaForPayload = { ...currentPromptMeta };
    const selectedInputMethod = getSelectedInputMethod();
    const isLlmRow = selectedInputMethod === "LLM";
    let participantTurn = "";
    if (!isLlmRow) {
      if (!currentRun) participantTurn = "first";
      else if (currentRun.llm_reply_text && !currentRun.final_text)
        participantTurn = "final";
    }
    const isVoice =
      selectedInputMethod === "Voice-to-text" || currentMedium === "Voice";

    // For voice input, end time = now (Send press). For typing/swipe, end time =
    // last interaction event (keydown/paste/input), falling back to now.
    const endTime = isVoice ? nowMs() : (trial.lastInputAtMs ?? nowMs());

    const promptShownAtMs =
      extra.promptShownAtMs ?? promptShownAtMsByMedium[currentMedium] ?? null;

    // Participant response time: prompt (or latest Alex message) shown → Send.
    // Prefer wall-clock from promptShownAtMs so reading/thinking before first key counts.
    const startedAtMs = promptShownAtMs ?? trial.startedAtMs ?? null;

    const responseTimeSeconds =
      startedAtMs == null ? 0 : secondsBetween(startedAtMs, endTime);

    const body = {
      participant_id: pid,
      medium: currentMedium === "Voice" ? "Voice" : currentMedium,
      input_method: selectedInputMethod,
      prompt_text: promptText,
      reply_text: replyText,
      audio_filename: extra.audioFilename || "",
      transcript: extra.transcript != null ? extra.transcript : pendingVoiceTranscript,
      response_time_seconds: responseTimeSeconds,
      keypress_count: trial.keypressCount,
      backspace_count: trial.backspaceCount,
      paste_used: trial.pasteUsed,
      correction_applied: trial.correctionApplied,
      prompt_style: "",
      prompt_tone: promptMetaForPayload.prompt_tone || "",
      prompt_seriousness: promptMetaForPayload.prompt_seriousness || "",
      prompt_formality: promptMetaForPayload.prompt_formality || "",
      prompt_id: promptMetaForPayload.prompt_id || "",
      prompt_source: promptMetaForPayload.prompt_source || "",
      transcript_status: lastTranscriptStatus || "",
      transcript_source: lastTranscriptSource || "",
      ui_style_label: "",
      participant_turn: participantTurn,
    };

    const isPureVoiceLogRow = currentMedium === "Voice";

    try {
      if (!isPureVoiceLogRow && studyEditTrace) {
        const fin = studyEditTrace.finalize({
          finalText: replyText,
          medium: currentMedium,
          input_method: selectedInputMethod,
          row_role: "participant_reply",
          active_medium: currentMedium,
        });
        body.log_row_id = fin.log_row_id;
        body.edit_trace = fin.trace;
      } else if (typeof crypto !== "undefined" && crypto.randomUUID) {
        body.log_row_id = crypto.randomUUID();
      }

      await fetchJSON("/api/log_reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!(body.medium === "Email" && !currentRun)) {
        showToast("Sent");
      }
      if (els.studyCondition) {
        els.studyCondition.classList.add("hidden");
      }
      if (els.studyDeviceContext) {
        els.studyDeviceContext.classList.add("hidden");
      }
      if (els.studyInputInstruction) {
        els.studyInputInstruction.classList.add("hidden");
      }
      if (studyEditTrace) startComposeEditTraceSession();
    } catch (e) {
      if (studyEditTrace) startComposeEditTraceSession();
      console.error(e);
      showToast("Could not save — check connection.");
      throw e;
    }

    // If we don't yet have a run, this is the user's initial reply.
    if (!currentRun) {
      currentRun = {
        participant_id: body.participant_id,
        medium: body.medium,
        input_method: body.input_method,
        prompt_text: body.prompt_text,
        reply_text: body.reply_text,
        llm_reply_text: "",
        final_text: "",
      };

      const isChatMedium =
        currentRun.medium === "SMS" || currentRun.medium === "Messenger";
      const isEmail = currentRun.medium === "Email";

      const applyEmailExchangeAfterLlm = (llmTextForUi) => {
        if (!isEmail || !els.mailExchange) return;
        syncEmailFollowupMetaLines();
        if (els.mailYourReply) els.mailYourReply.textContent = currentRun.reply_text;
        if (els.mailAlexReply) els.mailAlexReply.textContent = llmTextForUi;
        if (els.mailFinalWrap) els.mailFinalWrap.classList.add("hidden");
        if (els.mailFinalReply) els.mailFinalReply.textContent = "";
        const ty = document.getElementById("emailTimeYou");
        const ta = document.getElementById("emailTimeAlex");
        if (ty) ty.textContent = formatMailCardTime();
        if (ta) ta.textContent = formatMailCardTime();
        els.mailExchange.classList.remove("hidden");
      };

      const updateInboxSnippetAfterAlex = (llmTextForUi) => {
        const snip = document.querySelector(".pex-mail-row-snippet");
        if (!snip) return;
        const t = String(llmTextForUi || "").trim();
        const short = t.length > 80 ? `${t.slice(0, 80)}…` : t;
        snip.textContent = short ? `Alex: ${short}` : snip.textContent;
      };

      const runAssistantAfterFirstLog = async () => {
        let typingRowEl = null;
        if (isChatMedium) {
          const thread = currentRun.medium === "SMS" ? els.smsThread : els.messengerThread;
          const kind = currentRun.medium === "SMS" ? "sms" : "msg";
          typingRowEl = showTypingRow(thread, kind);
        }
        if (isEmail && els.sendEmailBtn) els.sendEmailBtn.disabled = true;
        try {
          const gen = await fetchJSONWithTimeout("/api/generate_reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              participant_id: currentRun.participant_id,
              medium: currentRun.medium,
              prompt_text: currentRun.prompt_text,
              user_reply: currentRun.reply_text,
              target_formality: body.prompt_formality || "",
              prompt_style: body.prompt_style || "",
              prompt_tone: body.prompt_tone || "",
              prompt_seriousness: body.prompt_seriousness || "",
            }),
          }, 8000);
          const provider = String(gen?.meta?.provider || "");
          console.log("[generate_reply] provider:", provider || "unknown");

          if (provider === "fallback") {
            showToast(
              "Study notice: LLM fallback (not live OpenAI). Rows show llm_provider=fallback in CSV/admin."
            );
          }

          const llmText = (gen.reply || "").trim();
          if (!llmText) {
            throw new Error("Generated reply was empty.");
          }
          currentRun.llm_reply_text = llmText;

          if (isChatMedium) {
            const thread = currentRun.medium === "SMS" ? els.smsThread : els.messengerThread;
            const kind = currentRun.medium === "SMS" ? "sms" : "msg";
            appendIncoming(thread, llmText, kind);
          }
          applyEmailExchangeAfterLlm(llmText);
          if (isEmail) updateInboxSnippetAfterAlex(llmText);

          try {
            await fetchJSON("/api/log_reply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                log_row_id: crypto.randomUUID(),
                participant_id: currentRun.participant_id,
                medium: currentRun.medium,
                input_method: "LLM",
                prompt_text: currentRun.prompt_text,
                reply_text: llmText,
                llm_provider: provider,
                response_time_seconds: 0,
                keypress_count: 0,
                backspace_count: 0,
                paste_used: false,
                correction_applied: false,
                prompt_style: body.prompt_style || "",
                prompt_tone: body.prompt_tone || "",
                prompt_seriousness: body.prompt_seriousness || "",
                prompt_formality: body.prompt_formality || "",
              }),
            });
          } catch (e) {
            console.warn("Failed to log LLM reply", e);
          }
        } catch (e) {
          console.error("generate_reply failed", e);
          const msg =
            e?.name === "AbortError"
              ? "Assistant reply timed out."
              : "Assistant reply failed.";
          showToast(
            `${msg} Placeholder shown — not OpenAI (llm_provider=client_error in CSV).`
          );
          const placeholder = buildAutoReply(currentRun.reply_text);
          currentRun.llm_reply_text = placeholder;
          if (isChatMedium) {
            const thread = currentRun.medium === "SMS" ? els.smsThread : els.messengerThread;
            const kind = currentRun.medium === "SMS" ? "sms" : "msg";
            appendIncoming(thread, placeholder, kind);
          }
          applyEmailExchangeAfterLlm(placeholder);
          if (isEmail) updateInboxSnippetAfterAlex(placeholder);
          try {
            await fetchJSON("/api/log_reply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                log_row_id: crypto.randomUUID(),
                participant_id: currentRun.participant_id,
                medium: currentRun.medium,
                input_method: "LLM",
                prompt_text: currentRun.prompt_text,
                reply_text: placeholder,
                llm_provider: "client_error",
                response_time_seconds: 0,
                keypress_count: 0,
                backspace_count: 0,
                paste_used: false,
                correction_applied: false,
                prompt_style: body.prompt_style || "",
                prompt_tone: body.prompt_tone || "",
                prompt_seriousness: body.prompt_seriousness || "",
                prompt_formality: body.prompt_formality || "",
              }),
            });
          } catch (logErr) {
            console.warn("Failed to log placeholder LLM reply", logErr);
          }
        } finally {
          if (typingRowEl && typingRowEl.parentNode) typingRowEl.remove();
          if (isEmail && els.sendEmailBtn) els.sendEmailBtn.disabled = false;
        }
      };

      if (isEmail) {
        void runAssistantAfterFirstLog().finally(() => {
          resetTrialState();
        });
        return;
      }

      await runAssistantAfterFirstLog();
      resetTrialState();
      return;
    }

    // If we already have an LLM reply stored, treat this as the final reply.
    if (currentRun && currentRun.llm_reply_text && !currentRun.final_text) {
      currentRun.final_text = body.reply_text;

      const mailReadSnap =
        currentRun.medium === "Email"
          ? {
              promptBody: els.promptEmail?.textContent ?? "",
              subject: els.emailSubject?.textContent ?? "",
              from: els.emailFrom?.textContent ?? "",
              subjectPreview: els.emailSubjectPreview?.textContent ?? "",
              fromPreview: els.emailFromPreview?.textContent ?? "",
              inboxSnippet: document.querySelector(".pex-mail-row-snippet")?.textContent ?? "",
              your: currentRun.reply_text,
              alex: currentRun.llm_reply_text,
              final: body.reply_text,
            }
          : null;

      // Emit a per-run CSV via the server and then rotate prompts.
      try {
        const runPayload = {
          participant_id: currentRun.participant_id,
          medium: currentRun.medium,
          input_method: currentRun.input_method,
          prompt_text: currentRun.prompt_text,
          reply_text: currentRun.reply_text,
          llm_reply_text: currentRun.llm_reply_text,
          final_text: currentRun.final_text,
          response_time_seconds: body.response_time_seconds || 0,
          keypress_count: body.keypress_count || 0,
          backspace_count: body.backspace_count || 0,
          paste_used: body.paste_used || false,
          correction_applied: body.correction_applied || false,
          prompt_style: body.prompt_style || "",
          prompt_tone: body.prompt_tone || "",
          prompt_seriousness: body.prompt_seriousness || "",
        };
        const r = await fetchJSON("/api/log_run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(runPayload),
        });
        if (r && r.ok) {
          showToast("Run exported");
        }
      } catch (e) {
        console.error(e);
        showToast("Run export failed");
      }

      currentRun = null;
      resetTrialState();
      await assignRandomTextPrompts();

      if (mailReadSnap && els.promptEmail) {
        els.promptEmail.textContent = mailReadSnap.promptBody;
        if (els.emailSubject) els.emailSubject.textContent = mailReadSnap.subject;
        if (els.emailFrom) els.emailFrom.textContent = mailReadSnap.from;
        if (els.emailSubjectPreview)
          els.emailSubjectPreview.textContent = mailReadSnap.subjectPreview;
        if (els.emailFromPreview)
          els.emailFromPreview.textContent = mailReadSnap.fromPreview;
        const snip = document.querySelector(".pex-mail-row-snippet");
        if (snip) snip.textContent = mailReadSnap.inboxSnippet;
        const replySub = document.getElementById("replyEmailSubject");
        if (replySub) {
          replySub.textContent = mailReadSnap.subject
            ? `Re: ${mailReadSnap.subject}`
            : "Re:";
        }
        const emailTo = document.getElementById("emailToCompose");
        if (emailTo) emailTo.textContent = mailReadSnap.from || "someone@example.com";
        if (els.mailYourReply) els.mailYourReply.textContent = mailReadSnap.your;
        if (els.mailAlexReply) els.mailAlexReply.textContent = mailReadSnap.alex;
        if (els.mailFinalReply) els.mailFinalReply.textContent = mailReadSnap.final;
        if (els.mailFinalWrap) els.mailFinalWrap.classList.remove("hidden");
        if (els.mailExchange) els.mailExchange.classList.remove("hidden");
        syncMailPreview();
        syncEmailThreadPeerCardFromDom();
        syncEmailFollowupMetaLines();
        const tf = document.getElementById("emailTimeFinal");
        if (tf) tf.textContent = formatMailCardTime();
        setEmailStep("read");
      }

      return;
    }

    // Fallback: rotate prompts after normal reply logging.
    resetTrialState();
    await assignRandomTextPrompts();
  }

  async function handleChatSend(medium) {
    currentMedium = medium;
    const thread = medium === "SMS" ? els.smsThread : els.messengerThread;
    const ta = medium === "SMS" ? els.replySMS : els.replyMsg;
    const wrap = medium === "SMS" ? els.suggestionSMS : els.suggestionMsg;
    const selectedInputMethod = getSelectedInputMethod();
    const useVoiceInText = selectedInputMethod === "Voice-to-text";
    const draft = textVoiceDrafts[medium];
    let text = ta?.value?.trim() || "";
    const promptText = getPromptText();
    if (!thread || !ta) return;
    if (useVoiceInText) {
      if (!draft?.audioFilename) {
        showToast("Record voice first, then send.");
        return;
      }
      // Authoritative text is whatever is in the compose box at Send (user may edit the transcript).
      text = (ta?.value || "").trim();
      if (!text) {
        if (!(draft.transcript || "").trim()) {
          showToast("No transcript available. Please re-record.");
        } else {
          showToast("Write a reply first.");
        }
        return;
      }
    } else if (!text) {
      return;
    }
    // For typing/swipe, ensure we have a start time even if no keydown fired.
    // For voice-to-text, leave startedAtMs null so submitReply uses promptShownAtMs.
    if (!useVoiceInText && trial.startedAtMs == null) trial.startedAtMs = nowMs();
    trial.lastInputAtMs = nowMs();

    const kind = medium === "SMS" ? "sms" : "msg";
    appendOutgoing(thread, text, kind);
    ta.value = "";
    ta.style.height = "";
    if (wrap) wrap.innerHTML = "";

    try {
      lastTranscriptStatus = "";
      lastTranscriptSource = "";
      await submitReply({
        replyText: text,
        promptText,
        audioFilename: useVoiceInText ? draft.audioFilename : "",
        transcript: useVoiceInText ? draft.transcript : "",
        promptShownAtMs: promptShownAtMsByMedium[medium],
      });
      if (useVoiceInText) clearTextVoiceDraft(medium);
    } catch {
      return;
    }

    // Incoming reply will be provided by submitReply (LLM or fallback).
  }

  if (els.sendSMSBtn)
    els.sendSMSBtn.addEventListener("click", () => handleChatSend("SMS"));
  if (els.sendMsgBtn)
    els.sendMsgBtn.addEventListener("click", () => handleChatSend("Messenger"));

  if (els.sendEmailBtn) {
    els.sendEmailBtn.addEventListener("click", async () => {
      currentMedium = "Email";
      const selectedInputMethod = getSelectedInputMethod();
      const useVoiceInText = selectedInputMethod === "Voice-to-text";
      const draft = textVoiceDrafts.Email;
      let text = els.replyEmail?.value?.trim() || "";
      if (useVoiceInText) {
        if (!draft?.audioFilename) {
          showToast("Record voice first, then send.");
          return;
        }
        text = (els.replyEmail?.value || "").trim();
        if (!text) {
          if (!(draft.transcript || "").trim()) {
            showToast("No transcript available. Please re-record.");
          } else {
            showToast("Write a reply first.");
          }
          return;
        }
      } else if (!text) {
        showToast("Write a reply first.");
        return;
      }
      if (!useVoiceInText && trial.startedAtMs == null) trial.startedAtMs = nowMs();
      trial.lastInputAtMs = nowMs();
      const emailText = text;
      const promptText = getPromptText();
      try {
        lastTranscriptStatus = "";
        lastTranscriptSource = "";
        await submitReply({
          replyText: emailText,
          promptText,
          audioFilename: useVoiceInText ? draft.audioFilename : "",
          transcript: useVoiceInText ? draft.transcript : "",
          promptShownAtMs: promptShownAtMsByMedium.Email,
        });
        if (useVoiceInText) clearTextVoiceDraft("Email");
      } catch {
        return;
      }
      els.replyEmail.value = "";
      els.suggestionEmail && (els.suggestionEmail.innerHTML = "");
      const mailRun = currentRun;
      if (mailRun?.medium === "Email" && !mailRun.final_text) {
        const snip = document.querySelector(".pex-mail-row-snippet");
        if (!mailRun.llm_reply_text) {
          if (snip) snip.textContent = "Updating thread…";
        } else {
          const t = String(mailRun.llm_reply_text || "").trim();
          const short = t.length > 80 ? `${t.slice(0, 80)}…` : t;
          if (snip) snip.textContent = short ? `Alex: ${short}` : snip.textContent;
        }
        syncMailPreview();
        els.mailUnreadBadge?.classList.remove("hidden");
        setEmailStep("list");
        showToast("Reply sent");
      } else {
        els.mailUnreadBadge?.classList.add("hidden");
        setEmailStep("read");
        syncMailPreview();
        showToast("Message sent");
      }
    });
  }

  // ----- Prompt player (voice mode) -----
  function formatAudioTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function initPromptBars() {
    if (!els.voiceWave) return;
    els.voiceWave.innerHTML = "";
    for (let i = 0; i < 28; i++) {
      const b = createEl("span", "pex-voice-bar");
      b.style.height = "6px";
      els.voiceWave.appendChild(b);
    }
  }
  initPromptBars();

  function animatePromptBars(playing) {
    if (!els.voiceWave) return;
    els.voiceWave.classList.toggle("is-active", playing);
    if (!playing) {
      els.voiceWave.querySelectorAll(".pex-voice-bar").forEach((b) => {
        b.style.height = "6px";
      });
    }
  }

  if (els.promptAudio && els.promptPlayBtn) {
    const audio = els.promptAudio;
    audio.addEventListener("loadedmetadata", () => {
      if (els.promptDuration)
        els.promptDuration.textContent = formatAudioTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      if (els.promptTime)
        els.promptTime.textContent = formatAudioTime(audio.currentTime);
    });
    audio.addEventListener("play", () => {
      animatePromptBars(true);
      els.promptPlayBtn.classList.add("is-playing");
      const icon = els.promptPlayBtn.querySelector(".pex-voice-play-icon");
      if (icon) icon.textContent = "❚❚";
    });
    audio.addEventListener("pause", () => {
      animatePromptBars(false);
      els.promptPlayBtn.classList.remove("is-playing");
      const icon = els.promptPlayBtn.querySelector(".pex-voice-play-icon");
      if (icon) icon.textContent = "▶";
    });
    audio.addEventListener("ended", () => {
      animatePromptBars(false);
      els.promptPlayBtn.classList.remove("is-playing");
      const icon = els.promptPlayBtn.querySelector(".pex-voice-play-icon");
      if (icon) icon.textContent = "▶";
    });

    els.promptPlayBtn.addEventListener("click", () => {
      if (audio.paused) {
        audio.play().catch(() => {
          showToast("Unable to play audio on this device.");
        });
      } else {
        audio.pause();
      }
    });

    audio.addEventListener("error", () => {
      if (els.promptDuration) els.promptDuration.textContent = "—";
      showToast("Could not load voice prompt file.");
    });
  }

  // ----- Recording -----
  function pickRecorderMime() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const t of types) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  function stopMeter() {
    if (meterRaf) cancelAnimationFrame(meterRaf);
    meterRaf = 0;
    if (els.recordMeter) {
      els.recordMeter.innerHTML = "";
      els.recordMeter.classList.remove("is-active");
    }
  }

  /** Stop mic tracks so the browser and OS know recording ended. */
  function stopMediaStream() {
    if (!mediaStream) return;
    try {
      mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    } finally {
      mediaStream = null;
    }
  }

  function startMeter(stream) {
    if (!els.recordMeter) return;
    stopMeter();
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const src = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      const bins = analyser.frequencyBinCount;
      const data = new Uint8Array(bins);
      els.recordMeter.innerHTML = "";
      for (let i = 0; i < 20; i++) {
        els.recordMeter.appendChild(createEl("span", "pex-meter-bar"));
      }
      const bars = els.recordMeter.querySelectorAll(".pex-meter-bar");
      els.recordMeter.classList.add("is-active");

      function tick() {
        analyser.getByteFrequencyData(data);
        bars.forEach((bar, i) => {
          const v = data[Math.min(i * 3, data.length - 1)] / 255;
          const h = 4 + v * 28;
          bar.style.height = h + "px";
        });
        meterRaf = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      /* meter optional */
    }
  }

  /** Use a fresh recorder each take for better stability. */
  async function getMicStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia unavailable");
    }
    // Always use a fresh stream per take; previous takes must have called stopMediaStream().
    stopMediaStream();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return mediaStream;
  }

  if (els.recordBtn) {
    els.recordBtn.addEventListener("click", async () => {
      currentMedium = "Voice";

      if (mediaRecorder && mediaRecorder.state === "recording") {
        els.voiceStatus.textContent = "Processing…";
        mediaRecorder.stop();
        return;
      }

      if (voicePipelineBusy) {
        showToast("Please wait for the last clip to finish processing.");
        return;
      }

      let stream;
      try {
        stream = await getMicStream();
      } catch (e) {
        console.error(e);
        els.voiceStatus.textContent = formatMicrophoneError(e);
        syncMicrophoneBanner();
        return;
      }

      resetPlaybackDraftState();
      recordedChunks = [];
      pendingVoiceTranscript = "";
      recordedFilename = "";
      els.recordedClip?.classList.add("hidden");
      if (els.transcriptDisplay) {
        els.transcriptDisplay.textContent = "";
        els.transcriptDisplay.classList.add("hidden");
      }

      const mime = pickRecorderMime();
      mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const epochAtStop = playbackEpoch;
        voicePipelineBusy = true;
        els.recordBtn?.classList.remove("is-recording");
        try {
          stopMeter();
          // Release the mic as soon as recording stops — chunks are already buffered.
          stopMediaStream();

          if (voiceAbortCurrentTake) {
            voiceAbortCurrentTake = false;
            recordedChunks = [];
            els.voiceStatus.textContent = "Mic off. Tap the mic to record again.";
            return;
          }

          const rec = mediaRecorder;
          const blob = new Blob(recordedChunks, {
            type: rec?.mimeType || "audio/webm",
          });
          recordedChunks = [];

          if (blob.size < 200) {
            els.voiceStatus.textContent = "Recording too short. Try again.";
            return;
          }

          if (recordedObjectUrl) URL.revokeObjectURL(recordedObjectUrl);
          recordedObjectUrl = URL.createObjectURL(blob);
          if (els.playbackAudio) {
            els.playbackAudio.src = recordedObjectUrl;
          }

          void applyRecordingDurationFromBlob(blob, epochAtStop);

          const form = new FormData();
          const ext = blob.type.includes("webm")
            ? "webm"
            : blob.type.includes("mp4")
              ? "m4a"
              : "dat";
          form.append("file", blob, `reply.${ext}`);
          els.voiceStatus.textContent = "Uploading…";
          try {
            const res = await fetchJSONWithTimeout("/api/upload_audio", {
              method: "POST",
              body: form,
            }, 20000);
            if (epochAtStop !== playbackEpoch) return;
            recordedFilename = res.audio_filename || "";
            pendingVoiceTranscript = (res.transcript || "").trim();
            lastTranscriptStatus = res.transcript_status || "";
            lastTranscriptSource = res.transcript_source || "";
            if (els.replyMP3) els.replyMP3.value = pendingVoiceTranscript;

            els.recordedClip?.classList.remove("hidden");
            if (pendingVoiceTranscript && els.transcriptDisplay) {
              els.transcriptDisplay.textContent = pendingVoiceTranscript;
              els.transcriptDisplay.classList.remove("hidden");
            } else if (els.transcriptDisplay) {
              const status = res.transcript_status || "";
              if (status === "whisper_unavailable") {
                els.transcriptDisplay.textContent =
                  "Transcript unavailable in this environment (Whisper disabled).";
                els.transcriptDisplay.classList.remove("hidden");
              } else if (status === "transcription_failed") {
                els.transcriptDisplay.textContent =
                  "Transcript unavailable (transcription failed).";
                els.transcriptDisplay.classList.remove("hidden");
              } else {
                els.transcriptDisplay.classList.add("hidden");
              }
            }
            els.voiceStatus.textContent =
              "Ready to send, or discard to re-record.";
          } catch (e) {
            console.error(e);
            if (e?.name === "AbortError") {
              els.voiceStatus.textContent = "Upload/transcription timed out. You can re-record.";
              showToast("Voice upload timed out.");
            } else {
              els.voiceStatus.textContent = "Upload failed. Try again.";
              showToast("Voice upload failed.");
            }
          }
        } finally {
          voicePipelineBusy = false;
        }
      };

      try {
        await audioContext?.resume?.();
      } catch {
        /* ignore */
      }
      startMeter(stream);
      mediaRecorder.start(120);
      els.recordBtn.classList.add("is-recording");
      els.voiceStatus.textContent = "Recording… tap again to stop.";
    });
  }

  if (els.playbackToggleBtn && els.playbackAudio) {
    els.playbackToggleBtn.addEventListener("click", () => {
      if (els.playbackAudio.paused) {
        els.playbackAudio.play();
        els.playbackToggleBtn.textContent = "Pause";
      } else {
        els.playbackAudio.pause();
        els.playbackToggleBtn.textContent = "Play";
      }
    });
    els.playbackAudio.addEventListener("play", () => {
      els.playbackToggleBtn.textContent = "Pause";
    });
    els.playbackAudio.addEventListener("pause", () => {
      els.playbackToggleBtn.textContent = "Play";
    });
  }

  if (els.discardVoiceBtn) {
    els.discardVoiceBtn.addEventListener("click", () => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        voiceAbortCurrentTake = true;
        mediaRecorder.stop();
        showToast("Recording discarded");
        return;
      }
      pendingVoiceTranscript = "";
      recordedFilename = "";
      lastTranscriptStatus = "";
      lastTranscriptSource = "";
      resetPlaybackDraftState();
      els.recordedClip?.classList.add("hidden");
      if (els.replyMP3) els.replyMP3.value = "";
      stopMediaStream();
      els.voiceStatus.textContent = "Tap the mic to record again.";
      showToast("Discarded");
    });
  }

  if (els.sendVoiceBtn) {
    els.sendVoiceBtn.addEventListener("click", async () => {
      currentMedium = "Voice";
      if (!recordedFilename) {
        showToast("Record a reply first.");
        return;
      }
      if (!recordedObjectUrl || !els.playbackAudio?.src) {
        showToast("Nothing to send.");
        return;
      }
      // Do NOT set trial.startedAtMs here — submitReply falls back to
      // promptShownAtMs.Voice so response_time = prompt-shown → Send.

      /** Keep thread playback alive after draft cleanup. */
      let threadAudioUrl = "";
      try {
        const blob = await fetch(recordedObjectUrl).then((r) => r.blob());
        threadAudioUrl = URL.createObjectURL(blob);
      } catch {
        showToast("Could not prepare audio.");
        return;
      }

      const card = createEl("article", "pex-voice-sent-card");
      const lab = createEl("div", "pex-voice-sent-label");
      lab.textContent = "You · voice reply";
      const aud = createEl("audio");
      aud.controls = true;
      aud.preload = "metadata";
      aud.src = threadAudioUrl;
      card.appendChild(lab);
      card.appendChild(aud);
      if (pendingVoiceTranscript) {
        const t = createEl("p", "pex-voice-sent-transcript");
        t.textContent = pendingVoiceTranscript;
        card.appendChild(t);
      }
      els.voiceThread?.appendChild(card);
      scrollThread(els.voiceThread);

      try {
        await submitReply({
          audioFilename: recordedFilename,
          transcript: pendingVoiceTranscript,
          promptShownAtMs: promptShownAtMsByMedium.Voice,
        });
      } catch {
        card.remove();
        URL.revokeObjectURL(threadAudioUrl);
        return;
      }

      els.recordedClip?.classList.add("hidden");
      recordedFilename = "";
      pendingVoiceTranscript = "";
      lastTranscriptStatus = "";
      lastTranscriptSource = "";
      if (els.replyMP3) els.replyMP3.value = "";
      resetPlaybackDraftState();
      stopMediaStream();
      els.voiceStatus.textContent = "Tap the mic to record another reply.";
    });
  }

  if (els.recordTextVoiceSMSBtn) {
    els.recordTextVoiceSMSBtn.addEventListener("click", () =>
      toggleTextVoiceRecording("SMS")
    );
  }
  if (els.recordTextVoiceMsgBtn) {
    els.recordTextVoiceMsgBtn.addEventListener("click", () =>
      toggleTextVoiceRecording("Messenger")
    );
  }
  if (els.recordTextVoiceEmailBtn) {
    els.recordTextVoiceEmailBtn.addEventListener("click", () =>
      toggleTextVoiceRecording("Email")
    );
  }

  function applyParticipantUrlParams() {
    try {
      const sp = new URLSearchParams(window.location.search);
      const pidRaw = (sp.get("participant_id") || sp.get("pid") || "").trim();
      const pid = pidRaw ? normalizeStudyParticipantIdClient(pidRaw) : "";
      if (pid && els.participantId) {
        els.participantId.value = pid;
        try {
          localStorage.setItem("relay_participant_id", pid);
        } catch {
          /* optional */
        }
      }
      const medRaw = (sp.get("medium") || "").trim();
      const med = ["SMS", "Messenger", "Email", "Voice"].includes(medRaw)
        ? medRaw
        : "Messenger";
      const pcRaw = (sp.get("prompt_condition") || sp.get("prompt_formality") || "")
        .trim()
        .toLowerCase();
      const tpid = (sp.get("text_prompt_id") || "").trim();
      const taskFromUrl = {
        medium: med,
        input_method: sp.get("input_method") || "",
        device: sp.get("device") || "",
        prompt_condition:
          pcRaw === "formal" || pcRaw === "informal" || pcRaw === "auto" ? pcRaw : "auto",
        prompt_pick: /^[a-zA-Z][a-zA-Z0-9_\-]{0,63}$/.test(tpid) ? "selected" : "random",
        text_prompt_id: tpid,
      };
      applyStudyTaskSettings(taskFromUrl, { reloadPrompts: false });
    } catch {
      applyStudyTaskSettings({ medium: "Messenger" }, { reloadPrompts: false });
    }
  }

  applyParticipantUrlParams();
  refreshTextVoiceButtons();
  syncStudyInstruction();
  syncMicrophoneBanner();
  assignRandomTextPrompts();
  ensureParticipantIdInitialized();
  pollSessionPlanCurrent();
  setInterval(pollSessionPlanCurrent, 4000);
  refreshMicrophoneBannerFromServer();
}

// -----------------------------------------------------------------------------
// Admin (existing API)
// -----------------------------------------------------------------------------

function initAdminUI() {
  const VIEW_COPY = {
    overview: {
      title: "Overview",
      desc: "Messenger/Email-first snapshot; legacy SMS/Voice shown when present in logs.",
    },
    session: {
      title: "Study session",
      desc: "Participant ID, active task, and Save plan — phones pick up changes within a few seconds.",
    },
    participants: {
      title: "Participants",
      desc: "Who has submitted data and how many log rows they have in the global CSV.",
    },
    trials: {
      title: "Log rows & charts",
      desc: "Filter log rows, inspect messages, and open a row for full detail. A completed two-turn exercise is a task/run (several rows).",
    },
    editTraces: {
      title: "Keystrokes / Edit Traces",
      desc: "Browse rows with stored compose traces, filter by study fields, inspect JSON layers, and download single files or a bounded ZIP export.",
    },
    visualizations: {
      title: "Visualizations",
      desc: "Display-only charts: response time, input method, reply register model, prompt condition.",
    },
    prompts: {
      title: "Prompts",
      desc: "Prompt library (persistent JSON), next-exercise override, and voice prompt uploads.",
    },
    exports: {
      title: "Exports",
      desc: "Full raw CSV first; simplified export is optional.",
    },
    settings: {
      title: "About",
      desc: "What Relay records and how to read the metrics.",
    },
  };

  const els = {
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    serverPill: document.getElementById("serverPill"),
    adminFooterRefreshed: document.getElementById("adminFooterRefreshed"),
    participantFilter: document.getElementById("participantFilter"),
    exportParticipantSelect: document.getElementById("exportParticipantSelect"),
    dateFilter: document.getElementById("dateFilter"),
    mediumFilter: document.getElementById("mediumFilter"),
    includeGeneratedFilter: document.getElementById("includeGeneratedFilter"),
    promptConditionFilter: document.getElementById("promptConditionFilter"),
    downloadAllBtn: document.getElementById("downloadAllBtn"),
    downloadParticipantBtn: document.getElementById("downloadParticipantBtn"),
    resultsTableBody: document.getElementById("resultsTableBody"),
    trialDetailInner: document.getElementById("trialDetailInner"),
    pageTitle: document.getElementById("pexAdminPageTitle"),
    pageDesc: document.getElementById("pexAdminPageDesc"),
    navToggle: document.getElementById("pexAdminNavToggle"),
    sidebar: document.getElementById("pexAdminSidebar"),
    navBackdrop: document.getElementById("pexAdminNavBackdrop"),
    refreshBtn: document.getElementById("adminRefreshBtn"),
    participantStatsBody: document.getElementById("participantStatsBody"),
    participantSelectAll: document.getElementById("participantSelectAll"),
    deleteSelectedParticipantsBtn: document.getElementById("deleteSelectedParticipantsBtn"),
    kpiTotalTrials: document.getElementById("kpiTotalTrials"),
    kpiParticipantCount: document.getElementById("kpiParticipantCount"),
    kpiRefreshedAt: document.getElementById("kpiRefreshedAt"),
    promptPoolList: document.getElementById("adminPromptPoolList"),
    adminNextPromptSelect: document.getElementById("adminNextPromptSelect"),
    saveNextPromptBtn: document.getElementById("adminSaveNextPromptBtn"),
    saveCustomPromptBtn: document.getElementById("adminSaveCustomPromptBtn"),
    clearNextPromptBtn: document.getElementById("adminClearNextPromptBtn"),
    nextPromptStatus: document.getElementById("adminNextPromptStatus"),
    customSmsPrompt: document.getElementById("adminCustomSmsPrompt"),
    customEmailSubject: document.getElementById("adminCustomEmailSubject"),
    customEmailBody: document.getElementById("adminCustomEmailBody"),
    promptAudioFile: document.getElementById("adminPromptAudioFile"),
    uploadPromptAudioBtn: document.getElementById("adminUploadPromptAudioBtn"),
    promptAudioStatus: document.getElementById("adminPromptAudioStatus"),
    transcriptionRuntime: document.getElementById("adminTranscriptionRuntime"),
    adminNextPromptPreview: document.getElementById("adminNextPromptPreview"),
    sessionParticipantId: document.getElementById("sessionParticipantId"),
    sessionParticipantIdList: document.getElementById("sessionParticipantIdList"),
    sessionVttMicHint: document.getElementById("sessionVttMicHint"),
    sessionLiveNextAction: document.getElementById("sessionLiveNextAction"),
    sessionMedium: document.getElementById("sessionMedium"),
    sessionInputMethod: document.getElementById("sessionInputMethod"),
    sessionDevice: document.getElementById("sessionDevice"),
    sessionPromptCondition: document.getElementById("sessionPromptCondition"),
    sessionPromptPick: document.getElementById("sessionPromptPick"),
    sessionTextPromptId: document.getElementById("sessionTextPromptId"),
    sessionParticipantUrl: document.getElementById("sessionParticipantUrl"),
    sessionOpenParticipantBtn: document.getElementById("sessionOpenParticipantBtn"),
    sessionCopyLinkBtn: document.getElementById("sessionCopyLinkBtn"),
    sessionSuggestParticipantBtn: document.getElementById("sessionSuggestParticipantBtn"),
    exportParticipantRowsOnly: document.getElementById("exportParticipantRowsOnly"),
    vizChartType: document.getElementById("vizChartType"),
    vizParticipantFilter: document.getElementById("vizParticipantFilter"),
    vizMediumFilter: document.getElementById("vizMediumFilter"),
    vizInputMethodFilter: document.getElementById("vizInputMethodFilter"),
    vizPromptConditionFilter: document.getElementById("vizPromptConditionFilter"),
    vizIncludeLlm: document.getElementById("vizIncludeLlm"),
    vizApplyBtn: document.getElementById("vizApplyBtn"),
    vizMetaPanel: document.getElementById("vizMetaPanel"),
    vizChartCaption: document.getElementById("vizChartCaption"),
    vizCustomPanel: document.getElementById("vizCustomPanel"),
    vizCustomDimension: document.getElementById("vizCustomDimension"),
    vizCustomMetric: document.getElementById("vizCustomMetric"),
    vizCustomStyle: document.getElementById("vizCustomStyle"),
    studyExportAdvancedCols: document.getElementById("studyExportAdvancedCols"),
    downloadStudyAllBtn: document.getElementById("downloadStudyAllBtn"),
    downloadStudyParticipantBtn: document.getElementById("downloadStudyParticipantBtn"),
    adminStudyContextBanner: document.getElementById("adminStudyContextBanner"),
    sessionPlanJson: document.getElementById("sessionPlanJson"),
    sessionPlanSaveBtn: document.getElementById("sessionPlanSaveBtn"),
    sessionPlanReloadBtn: document.getElementById("sessionPlanReloadBtn"),
    sessionPlanAdvanceBtn: document.getElementById("sessionPlanAdvanceBtn"),
    sessionPlanApplyBtn: document.getElementById("sessionPlanApplyBtn"),
    sessionPlanRepeatBtn: document.getElementById("sessionPlanRepeatBtn"),
    sessionPlanSkipBtn: document.getElementById("sessionPlanSkipBtn"),
    sessionPlanAddTaskBtn: document.getElementById("sessionPlanAddTaskBtn"),
    sessionPlanImportJsonBtn: document.getElementById("sessionPlanImportJsonBtn"),
    sessionPlanTableBody: document.getElementById("sessionPlanTableBody"),
    sessionPlanSummary: document.getElementById("sessionPlanSummary"),
    sessionPlanCurrentTaskNum: document.getElementById("sessionPlanCurrentTaskNum"),
    sessionPlanStatus: document.getElementById("sessionPlanStatus"),
    etParticipantFilter: document.getElementById("etParticipantFilter"),
    etMediumFilter: document.getElementById("etMediumFilter"),
    etInputMethodFilter: document.getElementById("etInputMethodFilter"),
    etPromptConditionFilter: document.getElementById("etPromptConditionFilter"),
    etFormalityLabelFilter: document.getElementById("etFormalityLabelFilter"),
    etRowRoleFilter: document.getElementById("etRowRoleFilter"),
    etDateFromFilter: document.getElementById("etDateFromFilter"),
    etDateToFilter: document.getElementById("etDateToFilter"),
    etSchemaVersionFilter: document.getElementById("etSchemaVersionFilter"),
    etIncludeGeneratedFilter: document.getElementById("etIncludeGeneratedFilter"),
    etApplyFiltersBtn: document.getElementById("etApplyFiltersBtn"),
    etBrowseWarnings: document.getElementById("etBrowseWarnings"),
    etPageInfo: document.getElementById("etPageInfo"),
    etPagePrevBtn: document.getElementById("etPagePrevBtn"),
    etPageNextBtn: document.getElementById("etPageNextBtn"),
    etTableBody: document.getElementById("etTableBody"),
    etDetailInner: document.getElementById("etDetailInner"),
    etDownloadSelectedBtn: document.getElementById("etDownloadSelectedBtn"),
    etDownloadZipBtn: document.getElementById("etDownloadZipBtn"),
    plSearchInput: document.getElementById("plSearchInput"),
    plIncludeInactive: document.getElementById("plIncludeInactive"),
    plReloadBtn: document.getElementById("plReloadBtn"),
    plExportBtn: document.getElementById("plExportBtn"),
    plTableBody: document.getElementById("plLibraryTableBody"),
    plFormStatus: document.getElementById("plFormStatus"),
    plFieldId: document.getElementById("plFieldId"),
    plSms: document.getElementById("plSms"),
    plMessenger: document.getElementById("plMessenger"),
    plEmailFrom: document.getElementById("plEmailFrom"),
    plEmailSubject: document.getElementById("plEmailSubject"),
    plEmailBody: document.getElementById("plEmailBody"),
    plPromptKind: document.getElementById("plPromptKind"),
    plPromptCondition: document.getElementById("plPromptCondition"),
    plNotes: document.getElementById("plNotes"),
    plActive: document.getElementById("plActive"),
    plNewBtn: document.getElementById("plNewBtn"),
    plSaveBtn: document.getElementById("plSaveBtn"),
    plClearFormBtn: document.getElementById("plClearFormBtn"),
    plEditorPanel: document.getElementById("plEditorPanel"),
    plCloseEditorBtn: document.getElementById("plCloseEditorBtn"),
    plEditorTitle: document.getElementById("plEditorTitle"),
  };

  let responseTimeChart = null;
  let styleChart = null;
  let avgRtByInputChart = null;
  let overviewMediumChart = null;
  let overviewAvgRtByInputChart = null;
  let vizBuilderChart = null;
  /** Last rows rendered in the trial table (for detail selection). */
  let lastTrialRows = [];
  let participantAliasMap = {};
  let aliasToRawMap = {};
  let aliasOverrides = {};
  const selectedParticipants = new Set();
  let etBrowsePage = 1;
  const etBrowsePageSize = 25;
  let etBrowseTotal = 0;
  let etSelectedParticipantId = "";
  let etSelectedLogRowId = "";
  /** Active prompts from last /api/prompt_pool (for session-plan library pick). */
  let lastPromptPoolActiveRows = [];
  /** True when library form is editing an existing id (id field locked). */
  let plLibraryEditMode = false;

  function loadAliasOverrides() {
    try {
      aliasOverrides = JSON.parse(localStorage.getItem("relay_admin_aliases") || "{}");
      if (!aliasOverrides || typeof aliasOverrides !== "object") aliasOverrides = {};
    } catch {
      aliasOverrides = {};
    }
  }

  function saveAliasOverrides() {
    try {
      localStorage.setItem("relay_admin_aliases", JSON.stringify(aliasOverrides));
    } catch {
      /* storage optional */
    }
  }

  function cssColor(name, fallback) {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v || fallback;
  }

  function chartFontColor() {
    if (document.body.dataset.theme === "light") return "#0f172a";
    return cssColor("--text", "#e9ecf1");
  }

  function chartMutedColor() {
    if (document.body.dataset.theme === "light") return "#334155";
    return cssColor("--muted", "#a9b1c3");
  }

  function chartGridColor() {
    return cssColor("--line", "#2a2f3b");
  }

  function baseChartOptions() {
    const text = chartFontColor();
    const grid = chartGridColor();
    const muted = chartMutedColor();
    const tooltipBg = document.body.dataset.theme === "light" ? "#ffffff" : "#171a21";
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: text },
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: text,
          bodyColor: text,
          borderColor: grid,
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: muted, maxRotation: 45, minRotation: 0 },
          grid: { color: grid },
        },
        y: {
          ticks: { color: muted },
          grid: { color: grid },
        },
      },
    };
  }

  /**
   * Build optional display aliases from the given participant id set only.
   * Must use the full /api/participants list — never filtered trial rows —
   * or the same display alias will point at different raw ids after filtering.
   * Option values are always the real logged IDs; aliases are labels only.
   */
  function buildParticipantAliases(rows) {
    const ids = Array.from(
      new Set((rows || []).map((r) => (r.participant_id || "").trim()).filter(Boolean))
    ).sort();
    participantAliasMap = {};
    aliasToRawMap = {};
    ids.forEach((id) => {
      const alias = aliasOverrides[id] || id;
      participantAliasMap[id] = alias;
      if (alias !== id) {
        aliasToRawMap[alias] = id;
      }
    });
  }

  /** Resolve export / API participant id (never treat display-only aliases as folder names). */
  function rawParticipantIdForApi(sel) {
    const t = (sel || "").trim();
    if (!t) return "";
    return aliasToRawMap[t] || t;
  }

  function displayParticipantId(realId) {
    const rid = String(realId || "").trim();
    if (!rid) return "";
    return participantAliasMap[rid] || rid;
  }

  function setNavOpen(open) {
    els.sidebar?.classList.toggle("is-open", open);
    if (els.navBackdrop) els.navBackdrop.hidden = !open;
    if (els.navToggle) {
      els.navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  if (els.navToggle && els.sidebar) {
    els.navToggle.addEventListener("click", () => {
      const open = !els.sidebar.classList.contains("is-open");
      setNavOpen(open);
    });
  }
  if (els.navBackdrop) {
    els.navBackdrop.addEventListener("click", () => setNavOpen(false));
  }

  function syncAdminThemeToggleUi() {
    if (!els.themeToggleBtn) return;
    const theme = document.body.dataset.theme || "dark";
    const icon = els.themeToggleBtn.querySelector(".pex-theme-icon");
    if (icon) icon.textContent = theme === "dark" ? "◐" : "☀";
    els.themeToggleBtn.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    els.themeToggleBtn.title =
      theme === "dark" ? "Light mode" : "Dark mode";
  }

  if (els.themeToggleBtn) {
    syncAdminThemeToggleUi();
    els.themeToggleBtn.addEventListener("click", () => {
      const current = document.body.dataset.theme || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.body.dataset.theme = next;
      syncAdminThemeToggleUi();
      loadLogs();
      loadSummary();
    });
  }

  function stampAdminRefreshedAt() {
    const when = new Date().toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
    if (els.kpiRefreshedAt) els.kpiRefreshedAt.textContent = when;
    if (els.adminFooterRefreshed)
      els.adminFooterRefreshed.textContent = `Refreshed ${when}`;
  }

  fetchJSON("/api/health")
    .then((h) => {
      if (!els.serverPill) return;
      if (h.whisper_ok) {
        els.serverPill.textContent = h.openai_configured
          ? "API OK · OpenAI configured"
          : "API OK · OpenAI missing (fallback)";
        if (els.transcriptionRuntime)
          els.transcriptionRuntime.textContent =
            "Reply audio transcription enabled (Whisper). Prompt audio transcription is not enabled.";
      } else {
        const why = h.ffmpeg_ok === false ? "ffmpeg missing" : "whisper unavailable";
        const llm = h.openai_configured ? "OpenAI configured" : "OpenAI missing (fallback)";
        els.serverPill.textContent = `API OK · ${llm} · transcription limited (${why})`;
        if (els.transcriptionRuntime) {
          const err = (h.whisper_error || "").toString();
          els.transcriptionRuntime.textContent =
            `Reply audio transcription unavailable (${why}). ${err ? "Error: " + err : ""}`.trim();
        }
      }
    })
    .catch(() => {
      if (els.serverPill) els.serverPill.textContent = "API unreachable";
    });

  function showAdminView(viewKey) {
    const copy = VIEW_COPY[viewKey];
    if (copy) {
      if (els.pageTitle) els.pageTitle.textContent = copy.title;
      if (els.pageDesc) els.pageDesc.textContent = copy.desc;
    }
    document.querySelectorAll("[data-admin-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.adminView === viewKey);
    });
    document.querySelectorAll("[data-admin-view-panel]").forEach((panel) => {
      const show = panel.dataset.adminViewPanel === viewKey;
      panel.hidden = !show;
    });
    setNavOpen(false);
  }

  document.querySelectorAll("[data-admin-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.adminView;
      if (key) showAdminView(key);
      if (key === "visualizations") void runVisualizationUpdate();
      if (key === "prompts") {
        loadPromptPool();
        loadPromptLibraryTable();
      }
      if (key === "editTraces") {
        etBrowsePage = 1;
        loadEditTracesBrowse();
      }
      if (key === "session") {
        const ex = (els.exportParticipantSelect?.value || "").trim();
        if (els.sessionParticipantId && !els.sessionParticipantId.value.trim() && ex) {
          els.sessionParticipantId.value = ex;
        }
        onSessionFieldsChanged();
        loadPromptPool().then(() => {
          populateSessionTextPromptSelect(
            (els.sessionTextPromptId?.value || "").trim()
          );
          loadSessionPlan();
        });
      }
    });
  });

  showAdminView("overview");

  function populateParticipantSelects(participantIds) {
    const ids = Array.from(new Set(participantIds || [])).sort();
    buildParticipantAliases(ids.map((id) => ({ participant_id: id })));
    function fillSelect(select, includeAllLabel, allText, placeholderText) {
      if (!select) return;
      select.innerHTML = "";
      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = includeAllLabel ? allText : placeholderText;
      select.appendChild(opt0);
      ids.forEach((id) => {
        const o = document.createElement("option");
        o.value = id;
        const label = participantAliasMap[id] || id;
        o.textContent = label;
        o.title = id !== label ? `Logged ID: ${id}` : `Participant ID: ${id}`;
        select.appendChild(o);
      });
    }
    fillSelect(els.participantFilter, true, "All participants", "");
    fillSelect(els.exportParticipantSelect, true, "All participants", "");
    fillSelect(els.vizParticipantFilter, true, "All participants", "");
    fillSelect(els.etParticipantFilter, true, "All participants", "");
    if (els.sessionParticipantIdList) {
      els.sessionParticipantIdList.innerHTML = "";
      ids.forEach((id) => {
        const o = document.createElement("option");
        o.value = id;
        els.sessionParticipantIdList.appendChild(o);
      });
    }
  }

  function loadParticipants() {
    return fetchJSON("/api/participants")
      .then((data) => {
        const ids = data.participants || [];
        const previousParticipant = (els.participantFilter?.value || "").trim();
        const previousExport = (els.exportParticipantSelect?.value || "").trim();

        populateParticipantSelects(ids);

        // Restore only valid raw participant IDs; clear stale browser-restored values.
        if (els.participantFilter) {
          if (previousParticipant && ids.includes(previousParticipant)) {
            els.participantFilter.value = previousParticipant;
          } else {
            els.participantFilter.value = "";
          }
        }
        if (els.exportParticipantSelect) {
          if (previousExport && ids.includes(previousExport)) {
            els.exportParticipantSelect.value = previousExport;
          } else if (els.participantFilter?.value && ids.includes(els.participantFilter.value)) {
            els.exportParticipantSelect.value = els.participantFilter.value;
          } else {
            els.exportParticipantSelect.value = "";
          }
        }
      })
      .catch(() => {});
  }

  function formatAdminTimestamp(ts) {
    const raw = (ts || "").trim();
    if (!raw) return "—";
    const isoish = raw.includes("T") ? raw : raw.replace(" ", "T");
    const d = new Date(isoish);
    if (Number.isNaN(d.getTime())) return raw.length > 19 ? raw.slice(0, 19) : raw;
    return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function renderParticipantStats(stats) {
    const tbody = els.participantStatsBody;
    if (!tbody) return;
    tbody.innerHTML = "";
    const sorted = [...(stats || [])].sort((a, b) =>
      String(b.last_timestamp || "").localeCompare(String(a.last_timestamp || ""))
    );
    sorted.forEach((s) => {
      const pid = s.participant_id || "";
      const tr = document.createElement("tr");
      const tdSel = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedParticipants.has(pid);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedParticipants.add(pid);
        else selectedParticipants.delete(pid);
      });
      tdSel.appendChild(cb);

      const tdId = document.createElement("td");
      const disp = displayParticipantId(pid);
      tdId.textContent = disp;
      if (pid && pid !== disp) tdId.title = `Logged ID: ${pid}`;
      else if (pid) tdId.title = `Participant ID: ${pid}`;
      const tdCount = document.createElement("td");
      tdCount.textContent = String(s.log_row_count ?? s.trial_count ?? "");
      const tdRuns = document.createElement("td");
      tdRuns.textContent = String(s.completed_runs_count ?? "0");
      const tdLast = document.createElement("td");
      const ts = s.last_timestamp || "";
      tdLast.textContent = formatAdminTimestamp(ts);
      tdLast.title = ts || "";

      const tdMed = document.createElement("td");
      tdMed.textContent = (s.mediums || "").trim() || "—";
      tdMed.className = "small";
      const tdIm = document.createElement("td");
      tdIm.textContent = (s.input_methods || "").trim() || "—";
      tdIm.className = "small";
      const tdPrompt = document.createElement("td");
      const lastPid = (s.last_prompt_id || "").trim();
      const lastText = (s.last_prompt_text || s.last_prompt_preview || "").trim();
      const srcLbl = (s.last_prompt_source_label || formatPromptSourceLabel(s.last_prompt_source)).trim();
      tdPrompt.className = "small";
      tdPrompt.textContent = formatLastPromptLoggedCell(s);
      const tipParts = [];
      if (lastPid) tipParts.push(`Last prompt id: ${lastPid}`);
      else if (lastText) tipParts.push("No prompt_id on log row (older data); showing last prompt text.");
      if (srcLbl && srcLbl !== "—") tipParts.push(`Bundle source: ${srcLbl}`);
      if (s.prompt_ids_seen) tipParts.push(`Prompt ids in logs: ${s.prompt_ids_seen}`);
      if (lastText) tipParts.push(`Last prompt text: ${lastText}`);
      if (tipParts.length) tdPrompt.title = tipParts.join("\n");

      const tdReg = document.createElement("td");
      const fr = Number(s.formal_prompt_rows || 0);
      const ir = Number(s.informal_prompt_rows || 0);
      const bits = [];
      if (fr) bits.push(`Formal ${fr}`);
      if (ir) bits.push(`Informal ${ir}`);
      tdReg.textContent = bits.length ? bits.join(" · ") : "—";
      tdReg.className = "small";
      tdReg.title =
        "Counts from logged prompt_formality on CSV rows (not live Prompt Library settings).";

      const tdAct = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pex-admin-table-action";
      btn.textContent = "View log rows";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (els.participantFilter) els.participantFilter.value = pid;
        if (els.exportParticipantSelect) els.exportParticipantSelect.value = pid;
        showAdminView("trials");
        loadLogs();
      });
      const aliasBtn = document.createElement("button");
      aliasBtn.type = "button";
      aliasBtn.className = "pex-admin-table-action";
      aliasBtn.textContent = "Rename alias";
      aliasBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const current = displayParticipantId(pid);
        const next = window.prompt(`Display alias for ${pid}`, current || "");
        if (next == null) return;
        const trimmed = next.trim();
        if (!window.confirm(`Save alias "${trimmed || "(clear)"}" for ${pid}?`)) return;
        if (!trimmed) delete aliasOverrides[pid];
        else aliasOverrides[pid] = trimmed;
        saveAliasOverrides();
        loadLogs();
        loadSummary();
      });
      tdAct.appendChild(btn);
      tdAct.appendChild(aliasBtn);

      tr.appendChild(tdSel);
      tr.appendChild(tdId);
      tr.appendChild(tdCount);
      tr.appendChild(tdRuns);
      tr.appendChild(tdLast);
      tr.appendChild(tdMed);
      tr.appendChild(tdIm);
      tr.appendChild(tdPrompt);
      tr.appendChild(tdReg);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    if (els.participantSelectAll) {
      const pids = sorted.map((s) => s.participant_id || "").filter(Boolean);
      els.participantSelectAll.checked =
        pids.length > 0 && pids.every((pid) => selectedParticipants.has(pid));
    }
  }

  function renderOverviewCharts(mediumBreakdown, avgRtByInputMethod) {
    if (typeof Chart === "undefined") {
      console.warn("Chart.js not available; skipping admin charts.");
      return;
    }
    const ctxM = document.getElementById("overviewMediumChart");
    const ctxAvg = document.getElementById("overviewAvgRtByInputChart");
    if (!ctxM || !ctxAvg) return;

    const accent = cssColor("--accent", "#6ea8fe");
    const warn = cssColor("--warn", "#ffcc66");

    const mKeys = sortMediumKeysForDisplay(Object.keys(mediumBreakdown || {}));
    const mLabels = mKeys.map(formatMediumDisplayLabel);
    const mValues = mKeys.map((k) => mediumBreakdown[k]);

    if (overviewMediumChart) overviewMediumChart.destroy();
    if (overviewAvgRtByInputChart) overviewAvgRtByInputChart.destroy();

    const common = baseChartOptions();

    overviewMediumChart = new Chart(ctxM, {
      type: "bar",
      data: {
        labels: mLabels.length ? mLabels : ["—"],
        datasets: [
          {
            label: "Log rows",
            data: mValues.length ? mValues : [0],
            backgroundColor: accent,
          },
        ],
      },
      options: {
        ...common,
        plugins: { ...common.plugins, legend: { display: false } },
      },
    });

    const inputKeys = ["Typing", "Swipe typing", "Voice-to-text"];
    const avgVals = inputKeys.map((k) => {
      const v = (avgRtByInputMethod || {})[k];
      return typeof v === "number" && !Number.isNaN(v) ? v : 0;
    });

    overviewAvgRtByInputChart = new Chart(ctxAvg, {
      type: "bar",
      data: {
        labels: inputKeys,
        datasets: [
          {
            label: "Avg seconds",
            data: avgVals,
            backgroundColor: warn,
          },
        ],
      },
      options: {
        ...common,
        plugins: { ...common.plugins, legend: { display: false } },
        scales: {
          ...common.scales,
          y: { ...common.scales.y, beginAtZero: true },
        },
      },
    });
  }

  let lastAdminSummary = null;

  function refreshStudyContextBanner() {
    const bar = els.adminStudyContextBanner;
    if (!bar) return;
    const sid = (els.sessionParticipantId?.value || "").trim();
    const pid = normalizeStudyParticipantIdClient(sid);
    if (!sid || !/^P\d{3,}$/i.test(pid)) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const stats = (lastAdminSummary?.participant_stats || []).find(
      (s) => s.participant_id === pid
    );
    const logRows = stats?.log_row_count ?? stats?.trial_count ?? "—";
    const runs = stats?.completed_runs_count ?? "—";
    bar.textContent = `Session focus: ${pid} · ${logRows} log rows (global) · ${runs} completed tasks/runs (per-run exports) · display: ${displayParticipantId(pid)}`;
  }

  function loadSummary() {
    fetchJSON("/api/admin_summary")
      .then((data) => {
        lastAdminSummary = data;
        refreshStudyContextBanner();
        if (els.kpiTotalTrials)
          els.kpiTotalTrials.textContent = String(data.total_trials ?? 0);
        if (els.kpiParticipantCount)
          els.kpiParticipantCount.textContent = String(
            data.participant_count ?? 0
          );
        stampAdminRefreshedAt();
        renderParticipantStats(data.participant_stats || []);
        populateMediumFilter(
          Object.keys(data.medium_breakdown || {})
        );
        renderOverviewCharts(
          data.medium_breakdown || {},
          data.avg_rt_by_input_method || {}
        );
      })
      .catch(() => {});
  }

  function populateMediumFilter(values) {
    const currentBySelect = new Map();
    [els.mediumFilter, els.vizMediumFilter, els.etMediumFilter].forEach((sel) => {
      if (sel) currentBySelect.set(sel, (sel.value || "").trim());
    });
    const base = ["Messenger", "Email", "SMS", "Voice"];
    const fromData = Array.from(
      new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean))
    );
    const mediums = sortMediumKeysForDisplay(
      Array.from(new Set([...base, ...fromData]))
    );
    function fillMediumSelect(select) {
      if (!select) return;
      const current = currentBySelect.get(select) || "";
      select.innerHTML = '<option value="">All</option>';
      mediums.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = formatMediumDisplayLabel(m);
        select.appendChild(opt);
      });
      if (current && mediums.includes(current)) select.value = current;
    }
    fillMediumSelect(els.mediumFilter);
    fillMediumSelect(els.vizMediumFilter);
    fillMediumSelect(els.etMediumFilter);
  }

  function updateNextPromptPreview(data) {
    const el = els.adminNextPromptPreview;
    if (!el) return;
    const nextId = data.next_text_prompt_id || "";
    const custom = data.next_text_prompt_custom || {};
    const prompts = data.text_prompts || [];
    const lines = [];
    if (nextId) {
      const p = prompts.find((x) => (x.id || "") === nextId);
      if (p) {
        lines.push(`Next preset: ${nextId}`);
        lines.push(`SMS / Messenger:\n${p.sms || p.messenger || ""}`);
        lines.push(
          `Email\nSubject: ${p.email_subject || ""}\n\n${p.email_body || ""}`
        );
      } else {
        lines.push(`Next preset id: ${nextId}`);
      }
    } else if (custom && (custom.sms || custom.email_body || custom.messenger)) {
      lines.push("Next: custom one-shot prompt");
      if (custom.prompt_formality)
        lines.push(`Prompt condition (logged): ${custom.prompt_formality}`);
      lines.push(`SMS:\n${custom.sms || ""}`);
      lines.push(`Messenger:\n${custom.messenger || custom.sms || ""}`);
      lines.push(
        `Email\nSubject: ${custom.email_subject || ""}\n\n${custom.email_body || ""}`
      );
    } else {
      lines.push(
        "Next text prompt: random from the active prompt library (no server override)."
      );
    }
    el.textContent = lines.filter(Boolean).join("\n\n");
  }

  function loadPromptPool(opts) {
    const preserveFormality = !!(opts && opts.preserveFormalitySelect);
    const pfSel = document.getElementById("adminPromptFormality");
    const prevPf = preserveFormality && pfSel ? pfSel.value : null;
    return fetchJSON("/api/prompt_pool")
      .then((data) => {
        const prompts = data.text_prompts || [];
        lastPromptPoolActiveRows = prompts.filter((p) => p.active !== false);
        const nextId = data.next_text_prompt_id || "";
        const custom = data.next_text_prompt_custom || {};
        if (els.customSmsPrompt) els.customSmsPrompt.value = custom.sms || "";
        if (els.customEmailSubject)
          els.customEmailSubject.value = custom.email_subject || "";
        if (els.customEmailBody) els.customEmailBody.value = custom.email_body || "";
        if (pfSel) {
          if (preserveFormality && prevPf !== null) {
            pfSel.value = prevPf;
          } else {
            const pf = (custom.prompt_formality || "").trim().toLowerCase();
            if (pf === "formal" || pf === "informal") pfSel.value = pf;
            else pfSel.value = "";
          }
        }

        if (els.promptPoolList) {
          els.promptPoolList.innerHTML = prompts
            .map(
              (p) =>
                `<li><strong>${escapeHtml(p.id || "")}</strong> — SMS: ${escapeHtml(
                  p.sms || ""
                )}<br><span class="small">Email: ${escapeHtml(
                  p.email_subject || ""
                )}</span></li>`
            )
            .join("");
        }
        if (els.adminNextPromptSelect) {
          els.adminNextPromptSelect.innerHTML =
            '<option value="">Random (default)</option>' +
            lastPromptPoolActiveRows
              .map((p) => {
                const prev = (p.messenger || p.sms || "").slice(0, 48);
                return `<option value="${escapeHtml(p.id || "")}">${escapeHtml(
                  p.id || ""
                )} — ${escapeHtml(prev)}</option>`;
              })
              .join("");
          els.adminNextPromptSelect.value = nextId;
        }
        if (els.nextPromptStatus) {
          if (nextId) {
            els.nextPromptStatus.textContent = `Server: next preset = ${nextId}`;
          } else if (custom && (custom.sms || custom.email_body)) {
            els.nextPromptStatus.textContent = "Server: custom prompt queued for next bundle.";
          } else {
            els.nextPromptStatus.textContent =
              "Server: next text prompt = random from active library.";
          }
        }
        updateNextPromptPreview(data);
        populateSessionTextPromptSelect(
          (els.sessionTextPromptId?.value || "").trim()
        );
        syncSessionPromptPickUi();
      })
      .catch(() => {
        if (els.nextPromptStatus)
          els.nextPromptStatus.textContent = "Prompt pool unavailable.";
      });
  }

  function showPlEditorPanel(show, title) {
    if (!els.plEditorPanel) return;
    els.plEditorPanel.hidden = !show;
    if (els.plEditorTitle && title) els.plEditorTitle.textContent = title;
    if (show) els.plEditorPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function plSetFormStatus(msg) {
    if (els.plFormStatus) els.plFormStatus.textContent = msg || "";
  }

  function plClearLibraryForm() {
    plLibraryEditMode = false;
    if (els.plFieldId) {
      els.plFieldId.value = "";
      els.plFieldId.readOnly = false;
    }
    if (els.plSms) els.plSms.value = "";
    if (els.plMessenger) els.plMessenger.value = "";
    if (els.plEmailFrom) els.plEmailFrom.value = "";
    if (els.plEmailSubject) els.plEmailSubject.value = "";
    if (els.plEmailBody) els.plEmailBody.value = "";
    if (els.plPromptKind) els.plPromptKind.value = "all";
    if (els.plPromptCondition) els.plPromptCondition.value = "auto";
    if (els.plNotes) els.plNotes.value = "";
    if (els.plActive) els.plActive.checked = true;
    plSetFormStatus("Enter a unique ID and Messenger or Email text, then Save to library.");
    showPlEditorPanel(true, "New prompt");
  }

  function plFillLibraryForm(p) {
    if (!p) return;
    plLibraryEditMode = true;
    if (els.plFieldId) {
      els.plFieldId.value = p.id || "";
      els.plFieldId.readOnly = true;
    }
    if (els.plSms) els.plSms.value = p.sms || "";
    if (els.plMessenger) els.plMessenger.value = p.messenger || "";
    if (els.plEmailFrom) els.plEmailFrom.value = p.email_from || "";
    if (els.plEmailSubject) els.plEmailSubject.value = p.email_subject || "";
    if (els.plEmailBody) els.plEmailBody.value = p.email_body || "";
    if (els.plPromptKind) els.plPromptKind.value = p.prompt_kind || "all";
    if (els.plPromptCondition) els.plPromptCondition.value = p.prompt_condition || "auto";
    if (els.plNotes) els.plNotes.value = p.notes || "";
    if (p.category && els.plNotes && !els.plNotes.value.trim()) {
      const legacy = String(p.category || "").trim();
      if (legacy) els.plNotes.value = `[legacy category] ${legacy}`;
    }
    if (els.plActive) els.plActive.checked = p.active !== false;
    plSetFormStatus(`Editing ${p.id || ""} — save updates the library file.`);
    showPlEditorPanel(true, `Edit: ${p.id || ""}`);
  }

  function plPayloadFromForm() {
    return {
      id: (els.plFieldId?.value || "").trim(),
      sms: (els.plSms?.value || "").trim(),
      messenger: (els.plMessenger?.value || "").trim(),
      email_from: (els.plEmailFrom?.value || "").trim(),
      email_subject: (els.plEmailSubject?.value || "").trim(),
      email_body: (els.plEmailBody?.value || "").trim(),
      prompt_kind: (els.plPromptKind?.value || "all").trim(),
      prompt_condition: (els.plPromptCondition?.value || "auto").trim(),
      notes: (els.plNotes?.value || "").trim(),
      category: "",
      active: !!els.plActive?.checked,
    };
  }

  function loadPromptLibraryTable() {
    if (!els.plTableBody) return;
    const q = (els.plSearchInput?.value || "").trim();
    const inc = els.plIncludeInactive?.checked ? "1" : "0";
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    qs.set("include_inactive", inc);
    fetchJSON(`/api/admin/prompt_library?${qs.toString()}`)
      .then((d) => {
        if (!d?.ok) throw new Error("bad");
        const rows = d.prompts || [];
        els.plTableBody.innerHTML = rows
          .map((p) => {
            const act = p.active !== false ? "yes" : "no";
            const preview = escapeHtml(
              (p.messenger || p.sms || "").slice(0, 56)
            );
            return `<tr class="pex-prompts-row" data-pl-id="${escapeHtml(p.id || "")}" tabindex="0" role="button">
              <td>${act}</td>
              <td><code>${escapeHtml(p.id || "")}</code></td>
              <td>${escapeHtml(p.prompt_condition || "")}</td>
              <td>${escapeHtml(formatPromptKindLabel(p.prompt_kind))}</td>
              <td class="small">${preview}</td>
              <td class="small">${escapeHtml((p.notes || "").slice(0, 40))}</td>
              <td>
                <button type="button" class="pex-btn-ghost pl-edit-btn" data-pl-id="${escapeHtml(
                  p.id || ""
                )}">Edit</button>
                <button type="button" class="pex-btn-ghost pl-del-btn" data-pl-id="${escapeHtml(
                  p.id || ""
                )}">Delete</button>
              </td>
            </tr>`;
          })
          .join("");
      })
      .catch(() => {
        els.plTableBody.innerHTML =
          '<tr><td colspan="7" class="small">Could not load prompt library.</td></tr>';
      });
  }

  function etCollectFilters() {
    const rawPid = (els.etParticipantFilter?.value || "").trim();
    const pid = rawPid ? aliasToRawMap[rawPid] || rawPid : "";
    return {
      participant_id: pid ? normalizeStudyParticipantIdClient(pid) : "",
      medium: (els.etMediumFilter?.value || "").trim(),
      input_method: (els.etInputMethodFilter?.value || "").trim(),
      prompt_condition: (els.etPromptConditionFilter?.value || "").trim().toLowerCase(),
      formality_label: (els.etFormalityLabelFilter?.value || "").trim(),
      row_role: (els.etRowRoleFilter?.value || "").trim(),
      date_from: (els.etDateFromFilter?.value || "").trim(),
      date_to: (els.etDateToFilter?.value || "").trim(),
      schema_version: (els.etSchemaVersionFilter?.value || "").trim(),
      include_generated: !!els.etIncludeGeneratedFilter?.checked,
    };
  }

  function etUpdatePageControls() {
    const maxPage = Math.max(1, Math.ceil(etBrowseTotal / etBrowsePageSize) || 1);
    if (etBrowsePage > maxPage) etBrowsePage = maxPage;
    if (els.etPageInfo) {
      els.etPageInfo.textContent = `Page ${etBrowsePage} / ${maxPage} · ${etBrowseTotal} matching row(s)`;
    }
    if (els.etPagePrevBtn) els.etPagePrevBtn.disabled = etBrowsePage <= 1;
    if (els.etPageNextBtn) els.etPageNextBtn.disabled = etBrowsePage >= maxPage || etBrowseTotal === 0;
  }

  function etRenderDetail(trace) {
    if (!els.etDetailInner || !trace) return;
    const sv = trace.schema_version != null ? trace.schema_version : "—";
    const keys = trace.key_events || [];
    const muts = trace.text_mutations || [];
    const snaps = trace.snapshots || [];
    const legacy = trace.events || [];
    const met = trace.metrics || {};
    const j = JSON.stringify(trace, null, 2);
    const pre = (obj) =>
      `<pre class="pex-admin-trace-pre">${escapeHtml(JSON.stringify(obj, null, 2))}</pre>`;
    els.etDetailInner.innerHTML = `
      <div class="pex-admin-detail-block">
        <h3 class="pex-admin-detail-subhd">Selection</h3>
        <dl class="pex-admin-detail-meta">
          <dt>schema_version</dt><dd>${escapeHtml(String(sv))}</dd>
          <dt>log_row_id</dt><dd><code>${escapeHtml(String(trace.log_row_id || ""))}</code></dd>
        </dl>
      </div>
      <div class="pex-admin-trace-layers">
        <details open>
          <summary>Summary (metrics)</summary>
          ${pre(met)}
        </details>
        <details>
          <summary>Key events (${Array.isArray(keys) ? keys.length : 0})</summary>
          ${pre(keys)}
        </details>
        <details>
          <summary>Text mutations (${Array.isArray(muts) ? muts.length : 0})</summary>
          ${pre(muts)}
        </details>
        <details>
          <summary>Snapshots (${Array.isArray(snaps) ? snaps.length : 0})</summary>
          ${pre(snaps)}
        </details>
        ${
          legacy.length
            ? `<details><summary>Legacy events (${legacy.length})</summary>${pre(legacy)}</details>`
            : ""
        }
        <details>
          <summary>Raw JSON</summary>
          <pre class="pex-admin-trace-pre">${escapeHtml(j)}</pre>
        </details>
      </div>`;
  }

  function etLoadDetail(participantId, logRowId) {
    if (!els.etDetailInner || !participantId || !logRowId) return;
    els.etDetailInner.innerHTML =
      '<p class="pex-admin-detail-placeholder">Loading trace…</p>';
    const q = new URLSearchParams({
      participant_id: participantId,
      log_row_id: logRowId,
    });
    fetchJSON(`/api/admin/edit_trace_json?${q.toString()}`)
      .then((data) => {
        if (!data.ok || !data.trace) throw new Error();
        etRenderDetail(data.trace);
      })
      .catch(() => {
        els.etDetailInner.innerHTML =
          '<p class="pex-admin-detail-placeholder">Could not load trace JSON (missing file, bad UUID, or server error).</p>';
      });
  }

  function etClearSelection() {
    etSelectedParticipantId = "";
    etSelectedLogRowId = "";
    document.querySelectorAll("#etTableBody tr.is-selected").forEach((tr) => {
      tr.classList.remove("is-selected");
    });
    if (els.etDownloadSelectedBtn) els.etDownloadSelectedBtn.disabled = true;
    if (els.etDetailInner) {
      els.etDetailInner.innerHTML =
        '<p class="pex-admin-detail-placeholder">Select a row to load key / mutation layers.</p>';
    }
  }

  function etRenderTable(rows) {
    if (!els.etTableBody) return;
    els.etTableBody.innerHTML = "";
    etClearSelection();
    (rows || []).forEach((r) => {
      const tr = createEl("tr", "");
      const pid = (r.participant_id || "").trim();
      const lid = (r.log_row_id || "").trim();
      tr.dataset.participantId = pid;
      tr.dataset.logRowId = lid;
      const pf = String(r.prompt_formality || "").trim();
      const pfShort = pf.length > 20 ? `${pf.slice(0, 20)}…` : pf;
      const sch = r.trace_schema_version != null ? String(r.trace_schema_version) : "—";
      const kc = r.key_event_count != null ? String(r.key_event_count) : "—";
      const mc = r.text_mutation_count != null ? String(r.text_mutation_count) : "—";
      const sc = r.snapshot_count != null ? String(r.snapshot_count) : "—";
      const lidShort = lid.length > 10 ? `${lid.slice(0, 8)}…` : lid;
      const traceOk = r.trace_found !== false;
      const traceCell = traceOk
        ? '<span style="color:#6bc86b">ok</span>'
        : '<span style="color:var(--warn,#e8a849)" title="CSV says trace exists but sidecar file was not found">missing</span>';
      tr.innerHTML = `
        <td>${escapeHtml((r.timestamp || "").slice(0, 19))}</td>
        <td>${escapeHtml(participantAliasMap[pid] || pid)}</td>
        <td>${escapeHtml(r.medium || "")}</td>
        <td>${escapeHtml(r.input_method || "")}</td>
        <td title="${escapeHtml(pf)}">${escapeHtml(pfShort || "—")}</td>
        <td>${escapeHtml(r.reply_preview || "")}</td>
        <td>${escapeHtml(formatSecondsCell(r.response_time_seconds))}</td>
        <td>${escapeHtml(String(r.revision_count ?? ""))}</td>
        <td>${escapeHtml(kc)}</td>
        <td>${escapeHtml(mc)}</td>
        <td>${escapeHtml(sc)}</td>
        <td>${escapeHtml(sch)}</td>
        <td>${traceCell}</td>
        <td title="${escapeHtml(lid)}"><code>${escapeHtml(lidShort)}</code></td>`;
      tr.addEventListener("click", () => {
        document.querySelectorAll("#etTableBody tr.is-selected").forEach((x) => {
          x.classList.remove("is-selected");
        });
        tr.classList.add("is-selected");
        etSelectedParticipantId = pid;
        etSelectedLogRowId = lid;
        if (els.etDownloadSelectedBtn) els.etDownloadSelectedBtn.disabled = !pid || !lid;
        etLoadDetail(pid, lid);
      });
      els.etTableBody.appendChild(tr);
    });
  }

  function loadEditTracesBrowse() {
    if (!els.etTableBody) return;
    const filters = etCollectFilters();
    fetchJSON("/api/admin/edit_traces/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...filters,
        page: etBrowsePage,
        page_size: etBrowsePageSize,
      }),
    })
      .then((data) => {
        if (!data || data.ok === false) throw new Error();
        etBrowseTotal = Number(data.total) || 0;
        if (els.etBrowseWarnings) {
          const w = (data.warnings || []).filter(Boolean);
          if ((data.rows || []).some((x) => x.trace_found === false)) {
            w.unshift(
              "Some rows have no JSON on disk (column JSON = missing); detail/ZIP may skip those files."
            );
          }
          els.etBrowseWarnings.textContent = w.join(" · ");
        }
        etRenderTable(data.rows || []);
        etUpdatePageControls();
      })
      .catch(() => {
        etBrowseTotal = 0;
        if (els.etBrowseWarnings) els.etBrowseWarnings.textContent = "Browse request failed.";
        etRenderTable([]);
        etUpdatePageControls();
      });
  }

  function loadLogs() {
    const params = new URLSearchParams();
    const selectedParticipant = (els.participantFilter?.value || "").trim();
    if (selectedParticipant) {
      // Safety: if an alias string is ever used as value, map it back to raw ID.
      const rawId = aliasToRawMap[selectedParticipant] || selectedParticipant;
      params.set("participant_id", rawId);
    }
    if (els.mediumFilter?.value) params.set("medium", els.mediumFilter.value);
    if (els.dateFilter?.value) params.set("date", els.dateFilter.value);

    const showGeneratedRows = !!els.includeGeneratedFilter?.checked;
    const conditionVal = (els.promptConditionFilter?.value || "").trim().toLowerCase();
    fetchJSON("/api/logs?" + params.toString())
      .then((data) => {
        const rowsAll = data.rows || [];
        let rows = showGeneratedRows
          ? rowsAll
          : rowsAll.filter((r) => (r.input_method || "").trim() !== "LLM");
        if (conditionVal) {
          rows = rows.filter(
            (r) => (r.prompt_formality || "").trim().toLowerCase() === conditionVal
          );
        }
        populateMediumFilter(rows.map((r) => r.medium));
        renderTable(rows);
        renderCharts(rows);
        renderConditionTables(rowsAll);
      })
      .catch(() => {});
  }

  function refreshAll() {
    loadParticipants().then(() => {
      loadLogs();
    });
    loadSummary();
    loadPromptPool();
    stampAdminRefreshedAt();
  }

  if (els.refreshBtn) els.refreshBtn.addEventListener("click", refreshAll);

  if (els.participantFilter) {
    els.participantFilter.addEventListener("change", () => {
      if (els.exportParticipantSelect)
        els.exportParticipantSelect.value = els.participantFilter.value;
      if (els.etParticipantFilter) els.etParticipantFilter.value = els.participantFilter.value;
      loadLogs();
    });
  }
  if (els.mediumFilter) els.mediumFilter.addEventListener("change", loadLogs);
  if (els.dateFilter) els.dateFilter.addEventListener("change", loadLogs);
  if (els.includeGeneratedFilter) {
    els.includeGeneratedFilter.addEventListener("change", loadLogs);
  }
  if (els.promptConditionFilter) {
    els.promptConditionFilter.addEventListener("change", loadLogs);
  }

  if (els.etApplyFiltersBtn) {
    els.etApplyFiltersBtn.addEventListener("click", () => {
      etBrowsePage = 1;
      loadEditTracesBrowse();
    });
  }
  if (els.etPagePrevBtn) {
    els.etPagePrevBtn.addEventListener("click", () => {
      if (etBrowsePage <= 1) return;
      etBrowsePage -= 1;
      loadEditTracesBrowse();
    });
  }
  if (els.etPageNextBtn) {
    els.etPageNextBtn.addEventListener("click", () => {
      const maxPage = Math.max(1, Math.ceil(etBrowseTotal / etBrowsePageSize));
      if (etBrowsePage >= maxPage) return;
      etBrowsePage += 1;
      loadEditTracesBrowse();
    });
  }
  if (els.etDownloadSelectedBtn) {
    els.etDownloadSelectedBtn.addEventListener("click", () => {
      if (!etSelectedParticipantId || !etSelectedLogRowId) return;
      const u = `/api/download_edit_trace?participant_id=${encodeURIComponent(
        etSelectedParticipantId
      )}&log_row_id=${encodeURIComponent(etSelectedLogRowId)}`;
      window.open(u, "_blank", "noopener,noreferrer");
    });
  }
  if (els.etDownloadZipBtn) {
    els.etDownloadZipBtn.addEventListener("click", () => {
      const filters = etCollectFilters();
      fetch("/api/admin/edit_traces/export_zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      })
        .then(async (res) => {
          if (!res.ok) {
            let msg = "ZIP export failed.";
            try {
              const j = await res.json();
              if (j && j.error) msg = String(j.error);
            } catch {
              /* ignore */
            }
            alert(msg);
            return null;
          }
          return res.blob();
        })
        .then((blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          const u = URL.createObjectURL(blob);
          a.href = u;
          a.download = "edit_traces_export.zip";
          a.click();
          URL.revokeObjectURL(u);
        })
        .catch(() => {
          alert("ZIP export failed.");
        });
    });
  }

  if (els.exportParticipantSelect) {
    els.exportParticipantSelect.addEventListener("change", () => {
      if (els.participantFilter)
        els.participantFilter.value = els.exportParticipantSelect.value;
    });
  }

  function exportRawIncludeGeneratedQuery() {
    const cb = els.exportParticipantRowsOnly;
    const participantOnly = cb && cb.checked;
    if (participantOnly) return "";
    return "&include_generated=1";
  }

  function syncSessionUrlPreview() {
    if (!els.sessionParticipantUrl) return;
    const base = `${window.location.origin}/`;
    const pid = normalizeStudyParticipantIdClient(
      (els.sessionParticipantId?.value || "").trim()
    );
    const med = (els.sessionMedium?.value || "Messenger").trim();
    const im = (els.sessionInputMethod?.value || "Typing").trim();
    const dev = (els.sessionDevice?.value || "").trim();
    const pcond = (els.sessionPromptCondition?.value || "auto").trim().toLowerCase();
    const tpid = (els.sessionTextPromptId?.value || "").trim();
    const sp = new URLSearchParams();
    if (pid) sp.set("participant_id", pid);
    if (med) sp.set("medium", med);
    if (im) sp.set("input_method", im);
    if (dev) sp.set("device", dev);
    if (pcond === "formal" || pcond === "informal" || pcond === "auto")
      sp.set("prompt_condition", pcond);
    const pick = (els.sessionPromptPick?.value || "random").trim().toLowerCase();
    if (
      pick === "selected" &&
      /^[a-zA-Z][a-zA-Z0-9_\-]{0,63}$/.test(tpid)
    )
      sp.set("text_prompt_id", tpid);
    const q = sp.toString();
    els.sessionParticipantUrl.textContent = q ? `${base}?${q}` : base;
    refreshStudyContextBanner();
  }

  let sessionPlanBusy = false;
  /** Mirrors server current_index while the table is being edited (0-based). */
  let sessionPlanLocalCurrentIndex = 0;

  function setSessionPlanStatus(msg) {
    if (els.sessionPlanStatus) els.sessionPlanStatus.textContent = msg || "";
  }

  function sessionPlanParticipantId() {
    return normalizeStudyParticipantIdClient((els.sessionParticipantId?.value || "").trim());
  }

  function defaultSessionPlanTask() {
    return normalizeStudyTaskClient({
      medium: "Messenger",
      input_method: "Typing",
      device: "",
      prompt_condition: "auto",
      prompt_pick: "random",
      text_prompt_id: "",
    });
  }

  function normalizeSessionPlanTask(t) {
    return normalizeStudyTaskClient(t);
  }

  function describeSessionPlanTask(t) {
    const d = normalizeSessionPlanTask(t);
    const devBit = d.device ? ` · ${d.device}` : "";
    const pickBit =
      d.prompt_pick === "selected" && d.text_prompt_id
        ? ` · selected:${d.text_prompt_id}`
        : ` · ${d.prompt_pick}`;
    return `${d.medium} · ${d.input_method}${devBit} · ${d.prompt_condition}${pickBit}`;
  }

  function sessionPlanSelectOptions(selected, choices) {
    return choices
      .map(
        ([val, label]) =>
          `<option value="${escapeHtml(val)}"${val === selected ? " selected" : ""}>${escapeHtml(
            label
          )}</option>`
      )
      .join("");
  }

  function buildSessionPlanPromptIdSelectHtml(selectedId, pick) {
    let opts = '<option value="">— choose —</option>';
    lastPromptPoolActiveRows.forEach((p) => {
      const id = p.id || "";
      if (!id) return;
      const sel = id === selectedId ? " selected" : "";
      opts += `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(id)}</option>`;
    });
    const dis = pick === "random" ? " disabled" : "";
    return `<select class="session-plan-text-prompt-id"${dis}>${opts}</select>`;
  }

  function buildSessionPlanRowHtml(index, task) {
    const d = normalizeSessionPlanTask(task);
    const medChoices = studyMediumChoicesForSelect(d.medium);
    const imChoices = [
      ["Typing", "Typing"],
      ["Swipe typing", "Swipe typing"],
      ["Voice-to-text", "Voice-to-text"],
    ];
    const devChoices = [
      ["", "—"],
      ["phone", "phone"],
      ["laptop", "laptop"],
    ];
    const pcChoices = [
      ["auto", "auto"],
      ["formal", "formal"],
      ["informal", "informal"],
    ];
    const ppChoices = [
      ["random", "random"],
      ["selected", "selected library"],
    ];
    return `<tr data-plan-row="1" data-task-index="${index}">
      <td>${index + 1}</td>
      <td><select class="session-plan-medium" aria-label="Medium">${sessionPlanSelectOptions(
        d.medium,
        medChoices
      )}</select></td>
      <td><select class="session-plan-input-method" aria-label="Input method">${sessionPlanSelectOptions(
        d.input_method,
        imChoices
      )}</select></td>
      <td><select class="session-plan-device" aria-label="Device">${sessionPlanSelectOptions(
        d.device,
        devChoices
      )}</select></td>
      <td><select class="session-plan-prompt-condition" aria-label="Prompt condition">${sessionPlanSelectOptions(
        d.prompt_condition,
        pcChoices
      )}</select></td>
      <td><select class="session-plan-prompt-pick" aria-label="Prompt pick">${sessionPlanSelectOptions(
        d.prompt_pick,
        ppChoices
      )}</select></td>
      <td>${buildSessionPlanPromptIdSelectHtml(d.text_prompt_id, d.prompt_pick)}</td>
      <td><button type="button" class="pex-btn-ghost session-plan-remove" data-remove-index="${index}">Remove</button></td>
    </tr>`;
  }

  function renderSessionPlanTable(tasks) {
    const list = (tasks || []).map(normalizeSessionPlanTask);
    if (!els.sessionPlanTableBody) return;
    if (!list.length) {
      els.sessionPlanTableBody.innerHTML =
        '<tr><td colspan="8" class="small" style="padding:10px;color:var(--muted);">No tasks yet. Click “Add task”.</td></tr>';
    } else {
      els.sessionPlanTableBody.innerHTML = list
        .map((t, i) => buildSessionPlanRowHtml(i, t))
        .join("");
    }
    syncSessionPlanJsonFromState(list, sessionPlanLocalCurrentIndex);
    renderSessionPlanSummary(list, sessionPlanLocalCurrentIndex);
    if (els.sessionPlanCurrentTaskNum) {
      const n = list.length;
      els.sessionPlanCurrentTaskNum.disabled = !n;
      els.sessionPlanCurrentTaskNum.max = n ? String(n) : "1";
      const show = n ? Math.min(sessionPlanLocalCurrentIndex + 1, n) : 1;
      els.sessionPlanCurrentTaskNum.value = String(show);
    }
  }

  function syncSessionPlanJsonFromState(tasks, idx) {
    if (!els.sessionPlanJson) return;
    const plan = { tasks: (tasks || []).map(normalizeSessionPlanTask), current_index: Number(idx) || 0 };
    els.sessionPlanJson.value = JSON.stringify(plan, null, 2);
  }

  function collectSessionPlanTasksFromTable() {
    const tb = els.sessionPlanTableBody;
    if (!tb) return [];
    const rows = tb.querySelectorAll("tr[data-plan-row]");
    if (!rows.length) return [];
    const out = [];
    rows.forEach((tr) => {
      out.push({
        medium: tr.querySelector(".session-plan-medium")?.value || "Messenger",
        input_method: tr.querySelector(".session-plan-input-method")?.value || "Typing",
        device: tr.querySelector(".session-plan-device")?.value || "",
        prompt_condition: tr.querySelector(".session-plan-prompt-condition")?.value || "auto",
        prompt_pick: tr.querySelector(".session-plan-prompt-pick")?.value || "random",
        text_prompt_id: tr.querySelector(".session-plan-text-prompt-id")?.value || "",
      });
    });
    return out.map(normalizeSessionPlanTask);
  }

  function populateSessionTextPromptSelect(selectedId) {
    if (!els.sessionTextPromptId) return;
    const sel = els.sessionTextPromptId;
    const prev = (selectedId || sel.value || "").trim();
    let html = '<option value="">— choose prompt —</option>';
    lastPromptPoolActiveRows.forEach((p) => {
      const id = (p.id || "").trim();
      if (!id) return;
      html += `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`;
    });
    sel.innerHTML = html;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function syncSessionPromptPickUi() {
    const pick = (els.sessionPromptPick?.value || "random").trim().toLowerCase();
    const useSelected = pick === "selected";
    if (els.sessionTextPromptId) els.sessionTextPromptId.disabled = !useSelected;
    const wrap = document.getElementById("sessionLibraryPromptField");
    if (wrap) wrap.classList.toggle("is-muted", !useSelected);
  }

  function applyTaskToSessionLinkFields(t) {
    const task = normalizeSessionPlanTask(t || {});
    const med = String(task.medium || "").trim();
    const im = String(task.input_method || "").trim();
    const dev = String(task.device || "").trim().toLowerCase();
    if (med && ["SMS", "Messenger", "Email", "Voice"].includes(med) && els.sessionMedium)
      els.sessionMedium.value = med;
    const allowedIm = ["Typing", "Swipe typing", "Voice-to-text"];
    if (im && allowedIm.includes(im) && els.sessionInputMethod)
      els.sessionInputMethod.value = im;
    if (els.sessionDevice) {
      if (dev === "phone" || dev === "laptop") els.sessionDevice.value = dev;
      else els.sessionDevice.value = "";
    }
    if (els.sessionPromptCondition) {
      const pc = task.prompt_condition || "auto";
      if (["formal", "informal", "auto"].includes(pc)) els.sessionPromptCondition.value = pc;
    }
    const pick =
      task.prompt_pick === "selected" && task.text_prompt_id ? "selected" : "random";
    if (els.sessionPromptPick) els.sessionPromptPick.value = pick;
    populateSessionTextPromptSelect(
      pick === "selected" ? task.text_prompt_id || "" : ""
    );
    if (els.sessionTextPromptId) {
      els.sessionTextPromptId.value =
        pick === "selected" ? task.text_prompt_id || "" : "";
    }
    syncSessionPromptPickUi();
  }

  function pushActiveTaskFieldsFromCurrentPlanRow() {
    const tasks = collectSessionPlanTasksFromTable();
    if (!tasks.length) return;
    const idx = readSessionPlanCurrentIndexForSave(tasks.length);
    sessionPlanLocalCurrentIndex = idx;
    applyTaskToSessionLinkFields(tasks[idx]);
    onSessionFieldsChanged();
  }

  function taskFromSessionLinkFields() {
    const pick = (els.sessionPromptPick?.value || "random").trim().toLowerCase();
    const tpid = (els.sessionTextPromptId?.value || "").trim();
    const useSelected = pick === "selected" && /^[a-zA-Z][a-zA-Z0-9_\-]{0,63}$/.test(tpid);
    return normalizeSessionPlanTask({
      medium: els.sessionMedium?.value || "Messenger",
      input_method: els.sessionInputMethod?.value || "Typing",
      device: els.sessionDevice?.value || "",
      prompt_condition: els.sessionPromptCondition?.value || "auto",
      prompt_pick: useSelected ? "selected" : "random",
      text_prompt_id: useSelected ? tpid : "",
    });
  }

  /** Copy Study session link controls into the current plan row (live collection workflow). */
  function syncSessionLinkFieldsToCurrentPlanRow() {
    let tasks = collectSessionPlanTasksFromTable();
    const patch = taskFromSessionLinkFields();
    if (!tasks.length) {
      renderSessionPlanTable([patch]);
      sessionPlanLocalCurrentIndex = 0;
      return;
    }
    const idx = readSessionPlanCurrentIndexForSave(tasks.length);
    tasks[idx] = { ...tasks[idx], ...patch };
    sessionPlanLocalCurrentIndex = idx;
    renderSessionPlanTable(tasks);
  }

  function readSessionPlanCurrentIndexForSave(taskCount) {
    const n = Math.max(0, taskCount | 0);
    if (!n) return 0;
    const raw = Number(els.sessionPlanCurrentTaskNum?.value);
    const oneBased = Number.isFinite(raw) ? raw : 1;
    const clamped = Math.max(1, Math.min(oneBased, n));
    return clamped - 1;
  }

  function renderSessionPlanSummary(tasks, idx) {
    if (!els.sessionPlanSummary) return;
    const pid = sessionPlanParticipantId();
    const n = tasks.length;
    if (!n) {
      els.sessionPlanSummary.innerHTML = `<strong>Participant:</strong> ${escapeHtml(
        pid || "—"
      )}<br />No tasks in plan.`;
      return;
    }
    const i = Math.max(0, Math.min(Number(idx) || 0, n - 1));
    const cur = tasks[i];
    const next = i + 1 < n ? tasks[i + 1] : null;
    const completed = i;
    const nextLabel = next ? describeSessionPlanTask(next) : "— (end of plan)";
    els.sessionPlanSummary.innerHTML = `<strong>Active:</strong> task ${i + 1} of ${n} — ${escapeHtml(
      describeSessionPlanTask(cur)
    )}<br />
<strong>Up next:</strong> ${escapeHtml(nextLabel)} · <strong>Done before current:</strong> ${completed}`;
    updateSessionLiveNextAction();
  }

  function setSessionPlanControlsDisabled(disabled) {
    const btns = [
      els.sessionPlanReloadBtn,
      els.sessionPlanSaveBtn,
      els.sessionPlanApplyBtn,
      els.sessionPlanRepeatBtn,
      els.sessionPlanAdvanceBtn,
      els.sessionPlanSkipBtn,
      els.sessionPlanAddTaskBtn,
      els.sessionPlanImportJsonBtn,
    ];
    btns.forEach((b) => {
      if (b) b.disabled = disabled;
    });
    if (els.sessionPlanCurrentTaskNum) els.sessionPlanCurrentTaskNum.disabled = disabled || !collectSessionPlanTasksFromTable().length;
    document.querySelectorAll(".session-plan-remove").forEach((b) => {
      b.disabled = disabled;
    });
    document.querySelectorAll("#sessionPlanTableBody select").forEach((el) => {
      el.disabled = disabled;
    });
  }

  function applyPlanToLocalState(plan) {
    const p = plan || { tasks: [], current_index: 0 };
    const tasks = (p.tasks || []).map(normalizeSessionPlanTask);
    sessionPlanLocalCurrentIndex = Math.max(
      0,
      Math.min(Number(p.current_index || 0), Math.max(0, tasks.length - 1))
    );
    renderSessionPlanTable(tasks);
    if (tasks.length) pushActiveTaskFieldsFromCurrentPlanRow();
  }

  function loadSessionPlan() {
    const pid = sessionPlanParticipantId();
    if (!pid || !/^P\d{3,}$/i.test(pid)) {
      setSessionPlanStatus("Enter a participant ID (e.g. P010) first.");
      if (els.sessionPlanSummary)
        els.sessionPlanSummary.innerHTML =
          "<strong>Participant:</strong> —<br />Enter a participant ID (e.g. P010) to load a plan.";
      renderSessionPlanTable([]);
      return;
    }
    if (sessionPlanBusy) return;
    sessionPlanBusy = true;
    setSessionPlanControlsDisabled(true);
    fetchJSON(`/api/admin/session_plan?participant_id=${encodeURIComponent(pid)}`)
      .then((d) => {
        if (!d?.ok) throw new Error("bad");
        const plan = d.plan || { tasks: [], current_index: 0 };
        applyPlanToLocalState(plan);
        const t = (plan.tasks || []).length;
        const i = Number(plan.current_index || 0);
        const labelCur = t ? Math.min(i + 1, t) : 0;
        setSessionPlanStatus(
          `Loaded: ${t} task(s), current_index=${i} (${labelCur} of ${t}).`
        );
      })
      .catch(() => {
        setSessionPlanStatus("Could not load session plan.");
      })
      .finally(() => {
        sessionPlanBusy = false;
        setSessionPlanControlsDisabled(false);
      });
  }

  function importSessionPlanFromJsonTextarea() {
    try {
      const raw = (els.sessionPlanJson?.value || "").trim();
      const parsed = raw ? JSON.parse(raw) : {};
      let tasks = [];
      if (Array.isArray(parsed)) tasks = parsed;
      else if (Array.isArray(parsed.tasks)) tasks = parsed.tasks;
      let cur = Number(parsed.current_index);
      if (!Number.isFinite(cur)) cur = 0;
      tasks = tasks.map(normalizeSessionPlanTask);
      const maxI = Math.max(0, tasks.length - 1);
      cur = Math.max(0, Math.min(cur, maxI));
      sessionPlanLocalCurrentIndex = tasks.length ? cur : 0;
      renderSessionPlanTable(tasks);
      setSessionPlanStatus("Imported JSON into the task table (not saved to server yet).");
    } catch {
      alert("Session plan JSON is invalid.");
    }
  }

  function saveSessionPlan() {
    const pid = sessionPlanParticipantId();
    if (!pid || !/^P\d{3,}$/i.test(pid)) {
      alert("Enter a participant ID (e.g. P010) first.");
      return;
    }
    if (sessionPlanBusy) return;
    syncSessionLinkFieldsToCurrentPlanRow();
    let payloadTasks = collectSessionPlanTasksFromTable();
    if (!payloadTasks.length) {
      try {
        const raw = (els.sessionPlanJson?.value || "").trim();
        const parsed = raw ? JSON.parse(raw) : {};
        if (Array.isArray(parsed)) payloadTasks = parsed.map(normalizeSessionPlanTask);
        else if (Array.isArray(parsed.tasks))
          payloadTasks = parsed.tasks.map(normalizeSessionPlanTask);
      } catch {
        alert("Session plan JSON is invalid (or table is empty).");
        return;
      }
    }
    const curIdx = readSessionPlanCurrentIndexForSave(payloadTasks.length);
    sessionPlanBusy = true;
    setSessionPlanControlsDisabled(true);
    fetchJSON("/api/admin/session_plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: pid,
        tasks: payloadTasks,
        current_index: curIdx,
      }),
    })
      .then((d) => {
        if (!d?.ok) throw new Error("bad");
        applyPlanToLocalState(d.plan);
        setSessionPlanStatus("Session plan saved.");
      })
      .catch(() => setSessionPlanStatus("Save failed."))
      .finally(() => {
        sessionPlanBusy = false;
        setSessionPlanControlsDisabled(false);
      });
  }

  function advanceSessionPlan() {
    const pid = sessionPlanParticipantId();
    if (!pid || !/^P\d{3,}$/i.test(pid)) {
      alert("Enter a participant ID (e.g. P010) first.");
      return;
    }
    if (sessionPlanBusy) return;
    sessionPlanBusy = true;
    setSessionPlanControlsDisabled(true);
    fetchJSON("/api/admin/session_plan/advance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: pid }),
    })
      .then((d) => {
        if (!d?.ok) throw new Error("bad");
        const plan = d.plan || { tasks: [], current_index: 0 };
        applyPlanToLocalState(plan);
        const t = (plan.tasks || []).length;
        if (d.done)
          setSessionPlanStatus(
            t ? "Already at last task (no further advance)." : "No tasks in plan."
          );
        else
          setSessionPlanStatus(
            `Advanced to task ${Number(plan.current_index || 0) + 1} of ${t}. Use “Apply current task to link” before opening the participant UI.`
          );
      })
      .catch(() => setSessionPlanStatus("Advance failed."))
      .finally(() => {
        sessionPlanBusy = false;
        setSessionPlanControlsDisabled(false);
      });
  }

  function applySessionPlanToSessionLink() {
    const pid = sessionPlanParticipantId();
    if (!pid || !/^P\d{3,}$/i.test(pid)) {
      alert("Enter a participant ID (e.g. P010) first.");
      return;
    }
    if (sessionPlanBusy) return;
    sessionPlanBusy = true;
    setSessionPlanControlsDisabled(true);
    fetchJSON(`/api/admin/session_plan?participant_id=${encodeURIComponent(pid)}`)
      .then((d) => {
        if (!d?.ok) throw new Error("bad");
        const plan = d.plan || { tasks: [], current_index: 0 };
        const tasks = plan.tasks || [];
        if (!tasks.length) {
          setSessionPlanStatus("No tasks in plan — add tasks and save first.");
          return;
        }
        let idx = Number(plan.current_index || 0);
        if (idx < 0) idx = 0;
        if (idx >= tasks.length) idx = tasks.length - 1;
        applyTaskToSessionLinkFields(normalizeSessionPlanTask(tasks[idx] || {}));
        onSessionFieldsChanged();
        setSessionPlanStatus(`Applied plan task ${idx + 1} of ${tasks.length} to session link.`);
      })
      .catch(() => setSessionPlanStatus("Could not load plan to apply."))
      .finally(() => {
        sessionPlanBusy = false;
        setSessionPlanControlsDisabled(false);
      });
  }

  function syncSessionVttMicHint() {
    if (!els.sessionVttMicHint) return;
    const im = (els.sessionInputMethod?.value || "").trim();
    els.sessionVttMicHint.hidden = im !== "Voice-to-text";
  }

  function updateSessionLiveNextAction() {
    if (!els.sessionLiveNextAction) return;
    const pid = sessionPlanParticipantId();
    const med = (els.sessionMedium?.value || "Messenger").trim();
    const im = (els.sessionInputMethod?.value || "Typing").trim();
    if (!pid || !/^P\d{3,}$/i.test(pid)) {
      els.sessionLiveNextAction.textContent =
        "Next: enter a participant ID (e.g. P010), set the task, then Save plan.";
      return;
    }
    els.sessionLiveNextAction.textContent = `Next for ${pid}: edit ${med} · ${im} if needed → Save plan → participant updates live.`;
  }

  function onSessionFieldsChanged() {
    syncSessionUrlPreview();
    refreshStudyContextBanner();
    syncSessionVttMicHint();
    updateSessionLiveNextAction();
  }

  if (els.sessionPlanTableBody) {
    els.sessionPlanTableBody.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest && ev.target.closest(".session-plan-remove");
      if (!btn || sessionPlanBusy) return;
      const ix = Number(btn.getAttribute("data-remove-index"));
      if (!Number.isFinite(ix)) return;
      const tasks = collectSessionPlanTasksFromTable();
      if (!tasks.length) return;
      tasks.splice(ix, 1);
      if (ix < sessionPlanLocalCurrentIndex) sessionPlanLocalCurrentIndex -= 1;
      else if (sessionPlanLocalCurrentIndex >= tasks.length)
        sessionPlanLocalCurrentIndex = Math.max(0, tasks.length - 1);
      renderSessionPlanTable(tasks);
      setSessionPlanStatus("Row removed (not saved to server until you click Save plan).");
    });
    els.sessionPlanTableBody.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.classList && t.classList.contains("session-plan-prompt-pick")) {
        const tr = t.closest("tr");
        const tidSel = tr && tr.querySelector(".session-plan-text-prompt-id");
        if (tidSel) {
          if ((t.value || "") === "random") {
            tidSel.value = "";
            tidSel.disabled = true;
          } else {
            tidSel.disabled = false;
          }
        }
      }
    });
  }

  if (els.sessionPlanAddTaskBtn) {
    els.sessionPlanAddTaskBtn.addEventListener("click", () => {
      if (sessionPlanBusy) return;
      const tasks = collectSessionPlanTasksFromTable();
      tasks.push(defaultSessionPlanTask());
      renderSessionPlanTable(tasks);
      setSessionPlanStatus("Task added to table (not saved yet).");
    });
  }

  if (els.sessionPlanImportJsonBtn) {
    els.sessionPlanImportJsonBtn.addEventListener("click", () => {
      if (sessionPlanBusy) return;
      importSessionPlanFromJsonTextarea();
    });
  }

  if (els.sessionPlanCurrentTaskNum) {
    els.sessionPlanCurrentTaskNum.addEventListener("change", () => {
      const tasks = collectSessionPlanTasksFromTable();
      if (!tasks.length) return;
      sessionPlanLocalCurrentIndex = readSessionPlanCurrentIndexForSave(tasks.length);
      renderSessionPlanSummary(tasks, sessionPlanLocalCurrentIndex);
      syncSessionPlanJsonFromState(tasks, sessionPlanLocalCurrentIndex);
      pushActiveTaskFieldsFromCurrentPlanRow();
    });
  }

  if (els.sessionPlanReloadBtn) {
    els.sessionPlanReloadBtn.addEventListener("click", () => loadSessionPlan());
  }
  if (els.sessionPlanSaveBtn) {
    els.sessionPlanSaveBtn.addEventListener("click", () => saveSessionPlan());
  }
  if (els.sessionPlanAdvanceBtn) {
    els.sessionPlanAdvanceBtn.addEventListener("click", () => advanceSessionPlan());
  }
  if (els.sessionPlanSkipBtn) {
    els.sessionPlanSkipBtn.addEventListener("click", () => advanceSessionPlan());
  }
  if (els.sessionPlanApplyBtn) {
    els.sessionPlanApplyBtn.addEventListener("click", () => applySessionPlanToSessionLink());
  }
  if (els.sessionPlanRepeatBtn) {
    els.sessionPlanRepeatBtn.addEventListener("click", () => applySessionPlanToSessionLink());
  }

  if (els.downloadAllBtn) {
    els.downloadAllBtn.addEventListener("click", () => {
      const inc = exportRawIncludeGeneratedQuery();
      window.location.href = "/api/download_csv?scope=all" + inc;
    });
  }

  if (els.downloadParticipantBtn) {
    els.downloadParticipantBtn.addEventListener("click", () => {
      const id = rawParticipantIdForApi(els.exportParticipantSelect?.value);
      if (!id) {
        alert("Choose a participant in the list (or pick “All participants” only for the all-participants download).");
        return;
      }
      const inc = exportRawIncludeGeneratedQuery();
      window.location.href =
        "/api/download_csv?scope=participant&participant_id=" +
        encodeURIComponent(id) +
        inc;
    });
  }

  let plSearchDebounce = null;
  if (els.plTableBody) {
    els.plTableBody.addEventListener("click", (ev) => {
      const row = ev.target && ev.target.closest && ev.target.closest("tr.pex-prompts-row");
      const ed = ev.target && ev.target.closest && ev.target.closest(".pl-edit-btn");
      const del = ev.target && ev.target.closest && ev.target.closest(".pl-del-btn");
      const btn = ed || del;
      if (row && !btn) {
        const id = (row.getAttribute("data-pl-id") || "").trim();
        if (!id) return;
        fetchJSON(`/api/admin/prompt_library?q=${encodeURIComponent(id)}`)
          .then((d) => {
            if (!d?.ok) throw new Error("bad");
            const rows = d.prompts || [];
            const hit = rows.find((r) => (r.id || "") === id) || rows[0];
            if (hit) plFillLibraryForm(hit);
            else plSetFormStatus("Prompt not found.");
          })
          .catch(() => plSetFormStatus("Could not load prompt for edit."));
        return;
      }
      if (!btn) return;
      const id = (btn.getAttribute("data-pl-id") || "").trim();
      if (!id) return;
      if (ed) {
        fetchJSON(`/api/admin/prompt_library?q=${encodeURIComponent(id)}`)
          .then((d) => {
            if (!d?.ok) throw new Error("bad");
            const rows = d.prompts || [];
            const row = rows.find((r) => (r.id || "") === id) || rows[0];
            if (row) plFillLibraryForm(row);
            else plSetFormStatus("Prompt not found.");
          })
          .catch(() => plSetFormStatus("Could not load prompt for edit."));
      } else {
        if (
          !window.confirm(
            `Delete "${id}" from the library file? Built-in ids fall back to code defaults.`
          )
        )
          return;
        fetchJSON(`/api/admin/prompt_library/${encodeURIComponent(id)}`, {
          method: "DELETE",
        })
          .then((d) => {
            if (!d?.ok) throw new Error("bad");
            loadPromptLibraryTable();
            loadPromptPool();
            plSetFormStatus("Deleted.");
            if ((els.plFieldId?.value || "").trim() === id) plClearLibraryForm();
          })
          .catch(() => alert("Delete failed."));
      }
    });
  }
  if (els.plReloadBtn) els.plReloadBtn.addEventListener("click", () => loadPromptLibraryTable());
  if (els.plExportBtn)
    els.plExportBtn.addEventListener("click", () => {
      window.location.href = "/api/admin/prompt_library/export";
    });
  if (els.plNewBtn) els.plNewBtn.addEventListener("click", () => plClearLibraryForm());
  if (els.plClearFormBtn) els.plClearFormBtn.addEventListener("click", () => plClearLibraryForm());
  if (els.plCloseEditorBtn)
    els.plCloseEditorBtn.addEventListener("click", () => showPlEditorPanel(false));
  if (els.plIncludeInactive)
    els.plIncludeInactive.addEventListener("change", () => loadPromptLibraryTable());
  if (els.plSearchInput) {
    els.plSearchInput.addEventListener("input", () => {
      clearTimeout(plSearchDebounce);
      plSearchDebounce = setTimeout(() => loadPromptLibraryTable(), 320);
    });
  }
  if (els.plSaveBtn) {
    els.plSaveBtn.addEventListener("click", () => {
      const body = plPayloadFromForm();
      if (!body.id) {
        alert("Prompt id is required.");
        return;
      }
      if (!body.messenger && !body.email_body) {
        alert("Enter a Messenger message and/or Email body.");
        return;
      }
      const edit = plLibraryEditMode;
      const url = edit
        ? `/api/admin/prompt_library/${encodeURIComponent(body.id)}`
        : "/api/admin/prompt_library";
      const method = edit ? "PUT" : "POST";
      fetchJSON(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((d) => {
          if (!d?.ok) throw new Error(d.error || "Save failed");
          plSetFormStatus("Saved.");
          loadPromptLibraryTable();
          loadPromptPool({ preserveFormalitySelect: true });
          if (d.prompt) plFillLibraryForm(d.prompt);
        })
        .catch((err) => {
          plSetFormStatus(err?.message || "Save failed.");
        });
    });
  }

  if (els.saveNextPromptBtn) {
    els.saveNextPromptBtn.addEventListener("click", () => {
      const id = els.adminNextPromptSelect?.value || "";
      if (!window.confirm("Save this prompt for the next exercise?")) return;
      fetchJSON("/api/prompt_pool/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text_prompt_id: id }),
      })
        .then(() => loadPromptPool())
        .catch(() => {
          if (els.nextPromptStatus)
            els.nextPromptStatus.textContent = "Could not save next prompt.";
        });
    });
  }
  function syncAdminCustomPromptPanes() {
    const kind =
      document.querySelector('input[name="adminCustomPromptKind"]:checked')
        ?.value || "sms_msg";
    document
      .getElementById("adminCustomSmsFields")
      ?.classList.toggle("hidden", kind !== "sms_msg");
    document
      .getElementById("adminCustomEmailFields")
      ?.classList.toggle("hidden", kind !== "email");
  }
  document
    .querySelectorAll('input[name="adminCustomPromptKind"]')
    .forEach((r) => r.addEventListener("change", syncAdminCustomPromptPanes));
  syncAdminCustomPromptPanes();

  if (els.saveCustomPromptBtn) {
    els.saveCustomPromptBtn.addEventListener("click", () => {
      const kind =
        document.querySelector('input[name="adminCustomPromptKind"]:checked')
          ?.value || "sms_msg";
      const formalitySel = document.getElementById("adminPromptFormality");
      const promptFormality = formalitySel ? formalitySel.value : "";
      let sms = (els.customSmsPrompt?.value || "").trim();
      let emailSubject = (els.customEmailSubject?.value || "").trim();
      let emailBody = (els.customEmailBody?.value || "").trim();
      if (kind === "sms_msg") {
        emailSubject = "";
        emailBody = "";
        if (!sms) {
          alert("Enter SMS/Messenger prompt text.");
          return;
        }
      } else {
        sms = "";
        if (!emailSubject && !emailBody) {
          alert("Enter email subject and/or body.");
          return;
        }
      }
      if (!window.confirm("Save this custom prompt for the next exercise?")) return;
      fetchJSON("/api/prompt_pool/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custom_sms: sms,
          custom_messenger: sms,
          custom_email_subject: emailSubject,
          custom_email_body: emailBody,
          prompt_formality: promptFormality,
        }),
      })
        .then(() => loadPromptPool())
        .catch(() => {
          if (els.nextPromptStatus)
            els.nextPromptStatus.textContent = "Could not save custom prompt.";
        });
    });
  }
  if (els.clearNextPromptBtn) {
    els.clearNextPromptBtn.addEventListener("click", () => {
      if (!window.confirm("Clear the next-prompt override and return to random?")) return;
      fetchJSON("/api/prompt_pool/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text_prompt_id: "" }),
      })
        .then(() => loadPromptPool())
        .catch(() => {
          if (els.nextPromptStatus)
            els.nextPromptStatus.textContent = "Could not clear next prompt.";
        });
    });
  }
  if (els.uploadPromptAudioBtn) {
    els.uploadPromptAudioBtn.addEventListener("click", () => {
      const file = els.promptAudioFile?.files?.[0];
      if (!file) {
        if (els.promptAudioStatus) els.promptAudioStatus.textContent = "Choose an audio file first.";
        return;
      }
      if (!window.confirm("Upload this file to the voice prompt pool?")) return;
      const fd = new FormData();
      fd.append("file", file);
      fetch("/api/prompt_audio_upload", { method: "POST", body: fd })
        .then((r) => r.json())
        .then((data) => {
          if (!data.ok) throw new Error(data.error || "upload failed");
          if (els.promptAudioStatus)
            els.promptAudioStatus.textContent = `Uploaded: ${data.filename}`;
          loadPromptPool();
        })
        .catch(() => {
          if (els.promptAudioStatus)
            els.promptAudioStatus.textContent = "Could not upload prompt audio.";
        });
    });
  }
  if (els.participantSelectAll) {
    els.participantSelectAll.addEventListener("change", () => {
      const checked = !!els.participantSelectAll?.checked;
      if (checked) {
        Object.keys(participantAliasMap).forEach((pid) => selectedParticipants.add(pid));
      } else {
        selectedParticipants.clear();
      }
      loadSummary();
    });
  }
  if (els.deleteSelectedParticipantsBtn) {
    els.deleteSelectedParticipantsBtn.addEventListener("click", () => {
      const ids = Array.from(selectedParticipants);
      if (!ids.length) {
        alert("Select at least one participant.");
        return;
      }
      if (!window.confirm(`Delete ${ids.length} selected participant(s) and their rows?`)) return;
      fetchJSON("/api/admin/delete_participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_ids: ids }),
      })
        .then(() => {
          selectedParticipants.clear();
          if (els.participantSelectAll) els.participantSelectAll.checked = false;
          refreshAll();
        })
        .catch(() => {
          alert("Could not delete selected participants.");
        });
    });
  }

  function clearTrialDetailSelection() {
    document
      .querySelectorAll("#resultsTableBody tr.is-selected")
      .forEach((r) => r.classList.remove("is-selected"));
  }

  function renderTrialDetail(row) {
    const wrap = els.trialDetailInner;
    if (!wrap || !row) return;

    wrap.innerHTML = '<p class="pex-admin-detail-placeholder">Loading…</p>';

    fetch("/api/admin/trial_detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...row,
        participant_display: displayParticipantId(row.participant_id || ""),
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("detail fetch failed");
        return res.text();
      })
      .then((html) => {
        wrap.innerHTML = html;
        const delBtn = wrap.querySelector("#adminDeleteTrialBtn");
        delBtn?.addEventListener("click", () => {
          const ok = window.confirm("Delete this log row from CSV logs? This cannot be undone.");
          if (!ok) return;
          fetchJSON("/api/admin/delete_trial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timestamp: row.timestamp || "",
              participant_id: row.participant_id || "",
              medium: row.medium || "",
              prompt_text: row.prompt_text || "",
              reply_text: row.reply_text || "",
              audio_filename: row.audio_filename || "",
            }),
          })
            .then((res) => {
              if (!res.ok) throw new Error("delete failed");
              loadLogs();
              loadSummary();
              if (els.trialDetailInner) {
                els.trialDetailInner.innerHTML =
                  '<p class="pex-admin-detail-placeholder">Trial deleted. Select another row to inspect details.</p>';
              }
            })
            .catch(() => {
              alert("Could not delete trial row.");
            });
        });
      })
      .catch(() => {
        // Fallback to client-side builder if server render fails.
        if (typeof buildTrialDetailHtml === "function") {
          wrap.innerHTML = buildTrialDetailHtml(row);
        } else {
          wrap.innerHTML = `<pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>`;
        }
        const delBtn = wrap.querySelector("#adminDeleteTrialBtn");
        delBtn?.addEventListener("click", () => {
          const ok = window.confirm("Delete this log row from CSV logs? This cannot be undone.");
          if (!ok) return;
          fetchJSON("/api/admin/delete_trial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timestamp: row.timestamp || "",
              participant_id: row.participant_id || "",
              medium: row.medium || "",
              prompt_text: row.prompt_text || "",
              reply_text: row.reply_text || "",
              audio_filename: row.audio_filename || "",
            }),
          })
            .then((res) => {
              if (!res.ok) throw new Error("delete failed");
              loadLogs();
              loadSummary();
              if (els.trialDetailInner) {
                els.trialDetailInner.innerHTML =
                  '<p class="pex-admin-detail-placeholder">Trial deleted. Select another row to inspect details.</p>';
              }
            })
            .catch(() => {
              alert("Could not delete trial row.");
            });
        });
      });
  }

  function selectTrialRow(index) {
    const row = lastTrialRows[index];
    if (!row) return;
    clearTrialDetailSelection();
    const tr = document.querySelector(
      `#resultsTableBody tr[data-row-index="${index}"]`
    );
    tr?.classList.add("is-selected");
    renderTrialDetail(row);
  }

  function renderTable(rows) {
    const tbody = els.resultsTableBody;
    if (!tbody) return;
    lastTrialRows = rows;
    clearTrialDetailSelection();
    if (els.trialDetailInner) {
      els.trialDetailInner.innerHTML =
        '<p class="pex-admin-detail-placeholder">Select a row for details.</p>';
    }

    tbody.innerHTML = "";
    rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.rowIndex = String(idx);
      tr.tabIndex = 0;
      const isGenerated = (row.input_method || "").trim() === "LLM";
      if (isGenerated) tr.classList.add("is-generated-row");
      const preview = (row.reply_text || row.transcript || "").toString();
      const previewWithRole = isGenerated ? `[SYSTEM] ${preview}` : preview;
      const pidRaw = String(row.participant_id || "").trim();
      const pidDisp = displayParticipantId(pidRaw);
      const pidTitle =
        pidRaw && pidRaw !== pidDisp
          ? escapeHtml(`Logged ID: ${pidRaw}`)
          : pidRaw
            ? escapeHtml(`Participant ID: ${pidRaw}`)
            : "";
      const promptId = String(row.prompt_id || "").trim();
      const pcond = String(row.prompt_formality || "").trim() || "—";
      const psrc = formatPromptSourceLabel(row.prompt_source);
      const promptText = String(row.prompt_text || "").trim();
      tr.innerHTML = `
        <td>${escapeHtml((row.timestamp || "").slice(0, 19))}</td>
        <td title="${pidTitle}">${escapeHtml(pidDisp)}</td>
        <td>${escapeHtml(row.medium || "")}</td>
        <td>${escapeHtml(row.input_method || "")}</td>
        <td title="${escapeHtml([promptId && `id: ${promptId}`, psrc && `source: ${psrc}`].filter(Boolean).join(" · "))}"><code class="small">${escapeHtml(promptId || "—")}</code></td>
        <td title="${escapeHtml(pcond)}">${escapeHtml(pcond.length > 18 ? `${pcond.slice(0, 18)}…` : pcond)}</td>
        <td title="${escapeHtml(promptText)}">${escapeHtml(previewWithRole.slice(0, 56))}${previewWithRole.length > 56 ? "…" : ""}</td>
        <td>${escapeHtml(formatSecondsCell(row.response_time_seconds))}</td>
        <td title="${escapeHtml((row.formality_label || "").trim() || "—")}">${escapeHtml(
          displayFormalityRegisterLabel((row.formality_label || "").trim())
        )}</td>
      `;
      tr.addEventListener("click", () => selectTrialRow(idx));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectTrialRow(idx);
        }
      });
      tbody.appendChild(tr);
    });
  }

  function renderConditionTables(allRows) {
    const formalBody = document.getElementById("formalTasksBody");
    const informalBody = document.getElementById("informalTasksBody");
    if (!formalBody || !informalBody) return;

    const sel = (els.participantFilter?.value || "").trim();
    const rawSel = sel ? aliasToRawMap[sel] || sel : "";

    let humanRows = allRows.filter(
      (r) => (r.input_method || "").trim() !== "LLM"
    );
    if (rawSel) {
      humanRows = humanRows.filter(
        (r) => (r.participant_id || "").trim() === rawSel
      );
    }
    const formal = humanRows.filter(
      (r) => promptConditionBucket(r.prompt_formality) === "formal"
    );
    const informal = humanRows.filter(
      (r) => promptConditionBucket(r.prompt_formality) === "informal"
    );

    function fillBody(tbody, rows) {
      tbody.innerHTML = "";
      if (!rows.length) {
        tbody.innerHTML =
          '<tr><td colspan="11" style="text-align:center;color:var(--muted);">No matching log rows</td></tr>';
        return;
      }
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        const reply = (row.reply_text || row.participant_reply_text || "").toString();
        const prompt = (row.prompt_text || "").toString();
        const pcond = String(row.prompt_formality || "").trim() || "—";
        const promptId = String(row.prompt_id || "").trim() || "—";
        tr.innerHTML = `
          <td>${escapeHtml(row.medium || "")}</td>
          <td>${escapeHtml(row.input_method || "")}</td>
          <td><code class="small">${escapeHtml(promptId)}</code></td>
          <td title="${escapeHtml(pcond)}">${escapeHtml(pcond.slice(0, 24))}${pcond.length > 24 ? "…" : ""}</td>
          <td title="${escapeHtml(prompt)}">${escapeHtml(prompt.slice(0, 40))}${prompt.length > 40 ? "…" : ""}</td>
          <td title="${escapeHtml(reply)}">${escapeHtml(reply.slice(0, 40))}${reply.length > 40 ? "…" : ""}</td>
          <td>${escapeHtml(formatSecondsCell(row.response_time_seconds))}</td>
          <td>${escapeHtml(displayFormalityRegisterLabel((row.formality_label || "").trim()))}</td>
          <td>${escapeHtml(formatConfidenceCell(row.formality_confidence))}</td>
          <td>${escapeHtml(String(row.keypress_count ?? ""))}</td>
          <td>${escapeHtml(String(row.backspace_count ?? ""))}</td>
        `;
        tbody.appendChild(tr);
      });
    }
    fillBody(formalBody, formal);
    fillBody(informalBody, informal);

    const sum = document.getElementById("conditionTablesSummary");
    if (sum) {
      const who = rawSel
        ? `participant ${displayParticipantId(rawSel) || rawSel}`
        : "all participants (pick one above to narrow)";
      sum.textContent = `Log rows by prompt condition — ${who}: ${formal.length} formal-condition, ${informal.length} informal-condition (each row is one message, not a full task/run)`;
    }
  }

  function renderCharts(rows) {
    if (typeof Chart === "undefined") {
      console.warn("Chart.js not available; skipping admin charts.");
      return;
    }
    const ctxResponse = document.getElementById("responseTimeChart");
    const ctxStyle = document.getElementById("styleChart");
    const ctxAvgRt = document.getElementById("avgRtByInputChart");
    if (!ctxResponse || !ctxStyle || !ctxAvgRt) return;

    const styleCounts = {};
    const responseTimes = [];

    rows.forEach((row) => {
      if ((row.input_method || "").trim() === "LLM") return;
      const fLab = (row.formality_label || "").trim();
      const style = fLab ? displayFormalityRegisterLabel(fLab) : "(no label)";
      styleCounts[style] = (styleCounts[style] || 0) + 1;
    });

    const rowsChrono = [...(rows || [])].sort((a, b) =>
      String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
    );
    rowsChrono.forEach((row) => {
      if ((row.input_method || "").trim() === "LLM") return;
      const rt = parseFloat(row.response_time_seconds || "0");
      if (!Number.isNaN(rt) && rt > 0) responseTimes.push(rt);
    });

    const styleLabels = Object.keys(styleCounts);
    const styleValues = styleLabels.map((k) => styleCounts[k]);
    const rtLabels = responseTimes.map((_, i) => String(i + 1));

    const accent = cssColor("--accent", "#6ea8fe");
    const good = cssColor("--good", "#7ee787");
    const warn = cssColor("--warn", "#ffcc66");

    if (responseTimeChart) responseTimeChart.destroy();
    if (styleChart) styleChart.destroy();
    if (avgRtByInputChart) avgRtByInputChart.destroy();

    const base = baseChartOptions();

    const inputMethodKeys = ["Typing", "Swipe typing", "Voice-to-text"];
    const rtSumByIm = Object.fromEntries(inputMethodKeys.map((k) => [k, 0]));
    const rtCountByIm = Object.fromEntries(inputMethodKeys.map((k) => [k, 0]));
    (rows || []).forEach((row) => {
      if ((row.input_method || "").trim() === "LLM") return;
      const im = (row.input_method || "").trim();
      if (!inputMethodKeys.includes(im)) return;
      const rt = parseFloat(row.response_time_seconds || "0");
      if (Number.isNaN(rt) || rt <= 0) return;
      rtSumByIm[im] += rt;
      rtCountByIm[im] += 1;
    });
    const avgRtValues = inputMethodKeys.map((k) =>
      rtCountByIm[k] ? rtSumByIm[k] / rtCountByIm[k] : 0
    );

    responseTimeChart = new Chart(ctxResponse, {
      type: "line",
      data: {
        labels: rtLabels.length ? rtLabels : ["—"],
        datasets: [
          {
            label: "Seconds",
            data: responseTimes.length ? responseTimes : [0],
            borderColor: good,
            tension: 0.25,
            fill: false,
          },
        ],
      },
      options: {
        ...base,
        plugins: { ...base.plugins, legend: { display: false } },
        scales: {
          ...base.scales,
          x: {
            ...base.scales.x,
            title: {
              display: true,
              text: "Log row # (oldest → newest in this view)",
              color: chartMutedColor(),
            },
          },
        },
      },
    });

    styleChart = new Chart(ctxStyle, {
      type: "doughnut",
      data: {
        labels: styleLabels.length ? styleLabels : ["—"],
        datasets: [
          {
            data: styleValues.length ? styleValues : [1],
            backgroundColor: [accent, good, warn, "#b197fc"],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: chartFontColor() } },
          title: {
            display: true,
            text: "Reply register (model on participant text)",
            color: chartMutedColor(),
            font: { size: 12 },
          },
          subtitle: {
            display: true,
            text: "Excludes LLM rows. Do not compare to prompt condition in the row inspector.",
            color: chartMutedColor(),
            font: { size: 10 },
            padding: { bottom: 4 },
          },
        },
      },
    });

    avgRtByInputChart = new Chart(ctxAvgRt, {
      type: "bar",
      data: {
        labels: inputMethodKeys,
        datasets: [
          {
            label: "Avg seconds",
            data: avgRtValues,
            backgroundColor: warn,
          },
        ],
      },
      options: {
        ...base,
        plugins: { ...base.plugins, legend: { display: false } },
        scales: {
          ...base.scales,
          x: {
            ...base.scales.x,
            title: {
              display: true,
              text: "Input method (participant rows) — not directly comparable",
              color: chartMutedColor(),
            },
          },
          y: {
            ...base.scales.y,
            title: {
              display: true,
              text: "Avg response time (s)",
              color: chartMutedColor(),
            },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function filterVisualizationRows(rowsAll, opts) {
    const { participant, medium, inputMethod, includeLlm, promptCondition } = opts;
    let rows = rowsAll || [];
    if (!includeLlm) {
      rows = rows.filter((r) => (r.input_method || "").trim() !== "LLM");
    }
    const pid = (participant || "").trim();
    if (pid) {
      const rawId = aliasToRawMap[pid] || pid;
      rows = rows.filter((r) => (r.participant_id || "").trim() === rawId);
    }
    const med = (medium || "").trim();
    if (med) rows = rows.filter((r) => (r.medium || "").trim() === med);
    const im = (inputMethod || "").trim();
    if (im) rows = rows.filter((r) => (r.input_method || "").trim() === im);
    const pc = (promptCondition || "").trim().toLowerCase();
    if (pc === "formal" || pc === "informal") {
      rows = rows.filter(
        (r) => (r.prompt_formality || "").trim().toLowerCase() === pc
      );
    } else if (pc === "other") {
      rows = rows.filter((r) => {
        const pf = (r.prompt_formality || "").trim().toLowerCase();
        return pf && pf !== "formal" && pf !== "informal";
      });
    }
    return rows;
  }

  const VIZ_HELP = {
    medium: {
      title: "Log rows by medium",
      body: "Row counts per interface (Messenger, Email; legacy SMS/Voice if present) after filters. Participant replies only unless you include AI-generated rows.",
    },
    response_time: {
      title: "Response time",
      body: "Each point is one row’s response time in seconds, oldest to newest in the filtered set. Non-positive times are omitted.",
    },
    avg_rt_input: {
      title: "Avg response time by input method",
      body: "Mean seconds for Typing, Swipe typing, and Voice-to-text where response time is recorded and positive.",
    },
    formality: {
      title: "Reply register (model)",
      body: "Distribution of reply register labels from the trained classifier (Formal/Informal in the UI; raw LABEL_* only in advanced export).",
    },
    input_method: {
      title: "Log rows by input method",
      body: "Row counts for Typing, Swipe typing, Voice-to-text, and LLM (if included) after filters.",
    },
    custom: {
      title: "Custom chart",
      body: "Grouped summary from filtered log rows. Choose group-by (X) and measure (Y) in the custom panel.",
    },
    prompt_condition: {
      title: "Prompt condition",
      body: "Counts rows by logged prompt_formality (formal / informal / other). Useful when prompts were tagged in the Prompts screen.",
    },
  };

  function syncVizCustomPanelVisibility() {
    const isCustom = (els.vizChartType?.value || "") === "custom";
    if (els.vizCustomPanel) els.vizCustomPanel.hidden = !isCustom;
  }

  function vizDimensionKey(row, dimension) {
    const d = String(dimension || "medium").trim();
    if (d === "medium") return (row.medium || "—").trim() || "—";
    if (d === "input_method") return (row.input_method || "—").trim() || "—";
    if (d === "prompt_formality") {
      const pf = (row.prompt_formality || "").trim().toLowerCase();
      if (pf === "formal" || pf === "informal") return pf;
      return pf ? pf : "(none)";
    }
    if (d === "participant_id") {
      const raw = (row.participant_id || "").trim();
      return displayParticipantId(raw) || raw || "—";
    }
    if (d === "log_date") {
      const ts = String(row.timestamp || "").trim();
      return ts.length >= 10 ? ts.slice(0, 10) : "(no date)";
    }
    return "—";
  }

  function aggregateRowsForCustomViz(rows, dimension, metric) {
    const buckets = {};
    (rows || []).forEach((row) => {
      const key = vizDimensionKey(row, dimension);
      if (!buckets[key]) buckets[key] = { count: 0, rtSum: 0, rtN: 0 };
      buckets[key].count += 1;
      const rt = parseFloat(row.response_time_seconds || "0");
      if (!Number.isNaN(rt) && rt > 0) {
        buckets[key].rtSum += rt;
        buckets[key].rtN += 1;
      }
    });
    let keys = Object.keys(buckets);
    if (dimension === "log_date") keys.sort();
    else if (dimension === "medium") keys = sortMediumKeysForDisplay(keys);
    else keys.sort((a, b) => buckets[b].count - buckets[a].count || a.localeCompare(b));
    if (dimension === "participant_id" && keys.length > 15) keys = keys.slice(0, 15);
    const labels =
      dimension === "medium" ? keys.map(formatMediumDisplayLabel) : keys;
    const values = keys.map((k) => {
      const b = buckets[k];
      if (metric === "avg_rt") return b.rtN ? b.rtSum / b.rtN : 0;
      return b.count;
    });
    return { keys: labels, values, buckets };
  }

  async function runVisualizationUpdate() {
    const canvas = document.getElementById("vizBuilderChart");
    if (!canvas || typeof Chart === "undefined") {
      console.warn("Chart.js or canvas missing; skipping visualization builder.");
      return;
    }
    const rawPid = (els.vizParticipantFilter?.value || "").trim();
    const params = new URLSearchParams();
    if (rawPid) {
      const idForApi = aliasToRawMap[rawPid] || rawPid;
      params.set("participant_id", idForApi);
    }
    let rowsAll = [];
    try {
      const data = await fetchJSON("/api/logs?" + params.toString());
      rowsAll = data.rows || [];
    } catch {
      rowsAll = [];
    }
    const includeLlm = !!els.vizIncludeLlm?.checked;
    const medium = (els.vizMediumFilter?.value || "").trim();
    const inputMethod = (els.vizInputMethodFilter?.value || "").trim();
    const promptCondition = (els.vizPromptConditionFilter?.value || "").trim();
    const rows = filterVisualizationRows(rowsAll, {
      participant: rawPid,
      medium,
      inputMethod,
      includeLlm,
      promptCondition,
    });

    const chartType = (els.vizChartType?.value || "medium").trim();
    const detailEl = document.querySelector('input[name="vizDetailLevel"]:checked');
    const detailed = detailEl && detailEl.value === "detailed";

    if (vizBuilderChart) vizBuilderChart.destroy();

    const accent = cssColor("--accent", "#6ea8fe");
    const good = cssColor("--good", "#7ee787");
    const warn = cssColor("--warn", "#ffcc66");
    const base = baseChartOptions();
    const help = VIZ_HELP[chartType] || VIZ_HELP.medium;

    if (els.vizMetaPanel) {
      if (detailed) {
        els.vizMetaPanel.classList.remove("hidden");
        const dispPid = rawPid ? displayParticipantId(rawPid) || rawPid : "All";
        const mf = medium ? formatMediumDisplayLabel(medium) : "All";
        const imf = inputMethod || "All";
        const pcf =
          promptCondition === "formal"
            ? "Formal"
            : promptCondition === "informal"
              ? "Informal"
              : promptCondition === "other"
                ? "Other / auto"
                : "All";
        const gen = includeLlm ? "Include AI-generated rows" : "Participant replies only";
        const nRt = rows.filter((r) => {
          const x = parseFloat(r.response_time_seconds || "0");
          return !Number.isNaN(x) && x > 0;
        }).length;
        els.vizMetaPanel.innerHTML = `
          <div class="pex-admin-viz-meta-title">${escapeHtml(help.title)}</div>
          <p class="pex-admin-viz-meta-text">${escapeHtml(help.body)}</p>
          <ul class="pex-admin-viz-meta-list">
            <li><strong>Rows in chart:</strong> ${rows.length}</li>
            <li><strong>With response time &gt; 0:</strong> ${nRt}</li>
            <li><strong>Participant:</strong> ${escapeHtml(dispPid)}</li>
            <li><strong>Medium:</strong> ${escapeHtml(mf)}</li>
            <li><strong>Input method:</strong> ${escapeHtml(imf)}</li>
            <li><strong>Prompt condition:</strong> ${escapeHtml(pcf)}</li>
            <li><strong>Rows setting:</strong> ${escapeHtml(gen)}</li>
          </ul>`;
      } else {
        els.vizMetaPanel.classList.add("hidden");
        els.vizMetaPanel.innerHTML = "";
      }
    }

    if (chartType === "custom") {
      const dimension = (els.vizCustomDimension?.value || "medium").trim();
      let metric = (els.vizCustomMetric?.value || "count").trim();
      let style = (els.vizCustomStyle?.value || "bar").trim();
      if (metric === "avg_rt" && style === "doughnut") style = "bar";
      const { keys, values } = aggregateRowsForCustomViz(rows, dimension, metric);
      const labels = keys.length ? keys : ["—"];
      const data = values.length ? values : [0];
      const yTitle =
        metric === "avg_rt" ? "Avg response time (s)" : "Log row count";
      const datasetLabel = metric === "avg_rt" ? "Avg seconds" : "Rows";
      if (style === "line") {
        vizBuilderChart = new Chart(canvas, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: datasetLabel,
                data,
                borderColor: good,
                tension: 0.2,
                fill: false,
              },
            ],
          },
          options: {
            ...base,
            plugins: { ...base.plugins, legend: { display: false } },
            scales: {
              ...base.scales,
              y: { ...base.scales.y, beginAtZero: true, title: { display: true, text: yTitle, color: chartMutedColor() } },
            },
          },
        });
      } else if (style === "doughnut") {
        vizBuilderChart = new Chart(canvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [
              {
                data: data.some((v) => v > 0) ? data : [1],
                backgroundColor: [accent, good, warn, "#b197fc", "#94a3b8"],
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: "bottom", labels: { color: chartFontColor() } },
            },
          },
        });
      } else {
        vizBuilderChart = new Chart(canvas, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: datasetLabel,
                data,
                backgroundColor: accent,
              },
            ],
          },
          options: {
            ...base,
            plugins: { ...base.plugins, legend: { display: false } },
            scales: {
              ...base.scales,
              y: { ...base.scales.y, beginAtZero: true, title: { display: true, text: yTitle, color: chartMutedColor() } },
            },
          },
        });
      }
    } else if (chartType === "medium") {
      const counts = {};
      rows.forEach((r) => {
        const m = (r.medium || "—").trim() || "—";
        counts[m] = (counts[m] || 0) + 1;
      });
      const keys = sortMediumKeysForDisplay(Object.keys(counts));
      const labels = keys.map(formatMediumDisplayLabel);
      const values = keys.map((k) => counts[k]);
      vizBuilderChart = new Chart(canvas, {
        type: "bar",
        data: {
          labels: labels.length ? labels : ["—"],
          datasets: [
            {
              label: detailed ? "Rows" : "Log rows",
              data: values.length ? values : [0],
              backgroundColor: accent,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            legend: { display: detailed && !!labels.length },
            title: detailed
              ? {
                  display: true,
                  text: "Log rows by medium",
                  color: chartMutedColor(),
                  font: { size: 13 },
                }
              : { display: false },
          },
          scales: {
            ...base.scales,
            x: {
              ...base.scales.x,
              title: {
                display: detailed,
                text: "Medium",
                color: chartMutedColor(),
              },
            },
            y: {
              ...base.scales.y,
              beginAtZero: true,
              title: {
                display: detailed,
                text: "Row count",
                color: chartMutedColor(),
              },
            },
          },
        },
      });
    } else if (chartType === "input_method") {
      const imOrder = [
        "Typing",
        "Swipe typing",
        "Voice-to-text",
        "LLM",
      ];
      const counts = {};
      rows.forEach((r) => {
        const im = (r.input_method || "—").trim() || "—";
        counts[im] = (counts[im] || 0) + 1;
      });
      const keys = [
        ...imOrder.filter((k) => counts[k]),
        ...Object.keys(counts).filter((k) => !imOrder.includes(k)).sort(),
      ];
      const labels = keys.length ? keys : ["—"];
      const values = keys.map((k) => counts[k] || 0);
      vizBuilderChart = new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Log rows",
              data: values.length ? values : [0],
              backgroundColor: accent,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            legend: { display: false },
            title: detailed
              ? {
                  display: true,
                  text: "Log rows by input method",
                  color: chartMutedColor(),
                  font: { size: 13 },
                }
              : { display: false },
          },
          scales: {
            ...base.scales,
            y: { ...base.scales.y, beginAtZero: true },
          },
        },
      });
    } else if (chartType === "response_time") {
      const chrono = [...rows].sort((a, b) =>
        String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
      );
      const times = [];
      chrono.forEach((r) => {
        const rt = parseFloat(r.response_time_seconds || "0");
        if (!Number.isNaN(rt) && rt > 0) times.push(rt);
      });
      const labels = times.map((_, i) => String(i + 1));
      vizBuilderChart = new Chart(canvas, {
        type: "line",
        data: {
          labels: labels.length ? labels : ["—"],
          datasets: [
            {
              label: detailed ? "Seconds" : "Response time",
              data: times.length ? times : [0],
              borderColor: good,
              tension: 0.25,
              fill: false,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            legend: { display: false },
            title: detailed
              ? {
                  display: true,
                  text: "Response time by trial (ordered)",
                  color: chartMutedColor(),
                  font: { size: 13 },
                }
              : { display: false },
          },
          scales: {
            ...base.scales,
            x: {
              ...base.scales.x,
              display: detailed,
              title: detailed
                ? { display: true, text: "Trial order", color: chartMutedColor() }
                : { display: false },
            },
            y: {
              ...base.scales.y,
              beginAtZero: true,
              title: {
                display: true,
                text: "Seconds",
                color: chartMutedColor(),
              },
            },
          },
        },
      });
    } else if (chartType === "avg_rt_input") {
      const inputKeys = ["Typing", "Swipe typing", "Voice-to-text"];
      const rtSum = Object.fromEntries(inputKeys.map((k) => [k, 0]));
      const rtCnt = Object.fromEntries(inputKeys.map((k) => [k, 0]));
      rows.forEach((r) => {
        if ((r.input_method || "").trim() === "LLM") return;
        const im = (r.input_method || "").trim();
        if (!inputKeys.includes(im)) return;
        const rt = parseFloat(r.response_time_seconds || "0");
        if (Number.isNaN(rt) || rt <= 0) return;
        rtSum[im] += rt;
        rtCnt[im] += 1;
      });
      const avgVals = inputKeys.map((k) => (rtCnt[k] ? rtSum[k] / rtCnt[k] : 0));
      vizBuilderChart = new Chart(canvas, {
        type: "bar",
        data: {
          labels: inputKeys,
          datasets: [
            {
              label: detailed ? "Avg seconds" : "Avg s",
              data: avgVals,
              backgroundColor: warn,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            legend: { display: false },
            title: detailed
              ? {
                  display: true,
                  text: "Avg response time by input method",
                  color: chartMutedColor(),
                  font: { size: 13 },
                }
              : { display: false },
          },
          scales: {
            ...base.scales,
            x: {
              ...base.scales.x,
              title: {
                display: detailed,
                text: "Input method",
                color: chartMutedColor(),
              },
            },
            y: {
              ...base.scales.y,
              beginAtZero: true,
              title: {
                display: true,
                text: detailed ? "Average seconds" : "Seconds",
                color: chartMutedColor(),
              },
            },
          },
        },
      });
    } else if (chartType === "prompt_condition") {
      const bucket = (r) => {
        const pf = (r.prompt_formality || "").trim().toLowerCase();
        if (pf === "formal") return "Formal";
        if (pf === "informal") return "Informal";
        if (pf) return "Other / auto";
        return "(unset)";
      };
      const counts = {};
      rows.forEach((r) => {
        const b = bucket(r);
        counts[b] = (counts[b] || 0) + 1;
      });
      const labels = Object.keys(counts);
      const values = labels.map((k) => counts[k]);
      vizBuilderChart = new Chart(canvas, {
        type: "bar",
        data: {
          labels: labels.length ? labels : ["—"],
          datasets: [
            {
              label: detailed ? "Rows" : "Log rows",
              data: values.length ? values : [0],
              backgroundColor: good,
            },
          ],
        },
        options: {
          ...base,
          plugins: {
            ...base.plugins,
            legend: { display: false },
            title: detailed
              ? {
                  display: true,
                  text: "Log rows by prompt condition",
                  color: chartMutedColor(),
                  font: { size: 13 },
                }
              : { display: false },
          },
          scales: {
            ...base.scales,
            x: {
              ...base.scales.x,
              title: {
                display: detailed,
                text: "Prompt condition",
                color: chartMutedColor(),
              },
            },
            y: {
              ...base.scales.y,
              beginAtZero: true,
              title: {
                display: true,
                text: "Row count",
                color: chartMutedColor(),
              },
            },
          },
        },
      });
    } else if (chartType === "formality") {
      const styleCounts = {};
      rows.forEach((row) => {
        if ((row.input_method || "").trim() === "LLM") return;
        const fLab = (row.formality_label || "").trim();
        const style = fLab ? displayFormalityRegisterLabel(fLab) : "(no label)";
        styleCounts[style] = (styleCounts[style] || 0) + 1;
      });
      const styleLabels = Object.keys(styleCounts);
      const styleValues = styleLabels.map((k) => styleCounts[k]);
      vizBuilderChart = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: styleLabels.length ? styleLabels : ["—"],
          datasets: [
            {
              data: styleValues.length ? styleValues : [1],
              backgroundColor: [accent, good, warn, "#b197fc", "#94a3b8"],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: detailed ? "bottom" : "right",
              labels: { color: chartFontColor(), boxWidth: detailed ? 12 : 10 },
            },
            title: detailed
              ? {
                  display: true,
                  text: "Reply register (participant text)",
                  color: chartMutedColor(),
                  font: { size: 13 },
                }
              : { display: false },
          },
        },
      });
    }

    if (els.vizChartCaption) {
      const n = rows.length;
      els.vizChartCaption.textContent = n
        ? `${help.title} — ${n} log row(s) after filters`
        : `${help.title} — no rows match the current filters`;
    }
  }

  if (els.vizChartType) {
    els.vizChartType.addEventListener("change", syncVizCustomPanelVisibility);
    syncVizCustomPanelVisibility();
  }

  if (els.vizApplyBtn) {
    els.vizApplyBtn.addEventListener("click", () => {
      void runVisualizationUpdate();
    });
  }

  if (els.sessionParticipantId)
    els.sessionParticipantId.addEventListener("input", onSessionFieldsChanged);
  if (els.sessionMedium)
    els.sessionMedium.addEventListener("change", onSessionFieldsChanged);
  if (els.sessionInputMethod)
    els.sessionInputMethod.addEventListener("change", onSessionFieldsChanged);
  if (els.sessionDevice)
    els.sessionDevice.addEventListener("change", onSessionFieldsChanged);
  if (els.sessionPromptCondition)
    els.sessionPromptCondition.addEventListener("change", onSessionFieldsChanged);
  if (els.sessionPromptPick) {
    els.sessionPromptPick.addEventListener("change", () => {
      syncSessionPromptPickUi();
      onSessionFieldsChanged();
    });
  }
  if (els.sessionTextPromptId)
    els.sessionTextPromptId.addEventListener("change", onSessionFieldsChanged);
  if (els.sessionSuggestParticipantBtn) {
    els.sessionSuggestParticipantBtn.addEventListener("click", () => {
      fetchJSON("/api/participants")
        .then((data) => {
          const next =
            (data.suggested_next_participant_id || "").trim() ||
            nextPresentationParticipantId(data.participants || []);
          if (els.sessionParticipantId) els.sessionParticipantId.value = next;
          onSessionFieldsChanged();
        })
        .catch(() => {});
    });
  }
  if (els.sessionOpenParticipantBtn) {
    els.sessionOpenParticipantBtn.addEventListener("click", () => {
      const url = (els.sessionParticipantUrl?.textContent || "").trim();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
  }
  if (els.sessionCopyLinkBtn) {
    els.sessionCopyLinkBtn.addEventListener("click", async () => {
      const url = (els.sessionParticipantUrl?.textContent || "").trim();
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard.");
      } catch {
        alert(url);
      }
    });
  }

  if (els.downloadStudyAllBtn) {
    els.downloadStudyAllBtn.addEventListener("click", () => {
      const adv = els.studyExportAdvancedCols?.checked ? "&study_advanced=1" : "";
      window.location.href = "/api/download_csv?scope=all&layout=study" + adv;
    });
  }
  if (els.downloadStudyParticipantBtn) {
    els.downloadStudyParticipantBtn.addEventListener("click", () => {
      const id = rawParticipantIdForApi(els.exportParticipantSelect?.value);
      if (!id) {
        alert("Choose a participant first.");
        return;
      }
      const adv = els.studyExportAdvancedCols?.checked ? "&study_advanced=1" : "";
      window.location.href =
        "/api/download_csv?scope=participant&participant_id=" +
        encodeURIComponent(id) +
        "&layout=study" +
        adv;
    });
  }

  syncSessionUrlPreview();
  refreshStudyContextBanner();
  syncSessionVttMicHint();
  syncSessionPromptPickUi();
  updateSessionLiveNextAction();

  loadAliasOverrides();
  // Load logs after filter options are ready so stale values do not hide rows.
  loadParticipants().then(() => {
    loadLogs();
  });
  loadSummary();
  loadPromptPool();
  if (typeof window.initAdminHelp === "function") window.initAdminHelp();
}

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------

const _body = document.body;
if (_body.dataset.role === "participant") {
  initParticipantUI();
} else {
  initAdminUI();
}
