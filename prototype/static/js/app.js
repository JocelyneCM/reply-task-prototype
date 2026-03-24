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
    participantId: document.getElementById("participantId"),
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
    sendEmailBtn: document.getElementById("sendEmailBtn"),
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

  const trial = {
    startedAtMs: null,
    lastInputAtMs: null,
    keypressCount: 0,
    backspaceCount: 0,
    pasteUsed: false,
    correctionApplied: false,
  };

  let currentMedium = "SMS";
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
    prompt_tone: "neutral",
    prompt_seriousness: "medium",
    prompt_formality: "neutral",
    prompt_id: "",
    prompt_source: "local",
  };
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
    const baseText = String(scenario.emailBody || scenario.sms || "");
    currentPromptMeta = {
      ...derivePromptMetaFromText(baseText),
      prompt_id: scenario.id || "",
      prompt_source: scenario.source || "local",
    };
  }

  async function assignRandomTextPrompts() {
    try {
      const data = await fetchJSON("/api/prompt_bundle?consume=1");
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
        });
        return;
      }
    } catch {
      /* use local fallback */
    }
    applyTextPromptScenario(pickRandom(TEXT_PROMPT_SCENARIOS));
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
      sessionStorage.setItem("relay_participant_id", pid);
    } catch {
      /* storage optional */
    }
  }

  function ensureParticipantIdInitialized() {
    const already = els.participantId?.value?.trim();
    if (already) return;
    try {
      const cached = sessionStorage.getItem("relay_participant_id");
      if (cached) {
        setParticipantId(cached);
        return;
      }
    } catch {
      /* ignore storage issues */
    }
    fetchJSON("/api/participants")
      .then((data) => {
        const pid = nextPresentationParticipantId(data.participants || []);
        setParticipantId(pid);
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
    setDrawerOpen(true);
  }
  function closeDrawer() {
    setDrawerOpen(false);
  }

  if (els.menuBtn) els.menuBtn.addEventListener("click", openDrawer);
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
    els.mailOpenBtn.addEventListener("click", () => setEmailStep("read"));
  if (els.mailBackList)
    els.mailBackList.addEventListener("click", () => setEmailStep("list"));
  if (els.mailReplyBtn)
    els.mailReplyBtn.addEventListener("click", () => setEmailStep("compose"));
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

    currentMedium = medium;
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

    if (medium === "Email") setEmailStep("list");
    if (medium === "Voice") assignVoicePrompt();
    closeDrawer();
    resetTrialState();
  }

  els.navBtns.forEach((btn) => {
    btn.addEventListener("click", () => showMode(btn.dataset.medium));
  });

  function attachTypingTracking(textarea) {
    if (!textarea) return;
    textarea.addEventListener("keydown", (e) => {
      if (trial.startedAtMs == null) trial.startedAtMs = nowMs();
      trial.lastInputAtMs = nowMs();
      trial.keypressCount += 1;
      if (e.key === "Backspace") trial.backspaceCount += 1;
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

  async function submitReply(extra = {}) {
    const pid = els.participantId?.value?.trim() || fallbackParticipantId();
    if (els.participantId) els.participantId.value = pid;
    setParticipantId(pid);

    const replyText =
      extra.replyText != null ? String(extra.replyText).trim() : getReplyText();
    const promptText =
      extra.promptText != null ? String(extra.promptText).trim() : getPromptText();
    const promptMetaForPayload = {
      ...currentPromptMeta,
      ...derivePromptMetaFromText(promptText),
    };
    const endTime = trial.lastInputAtMs ?? nowMs();
    const responseTimeSeconds =
      trial.startedAtMs == null ? 0 : secondsBetween(trial.startedAtMs, endTime);

    const body = {
      participant_id: pid,
      medium: currentMedium === "Voice" ? "Voice" : currentMedium,
      input_method: currentMedium === "Voice" ? "Speech" : "Keyboard",
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
      transcript_status: lastTranscriptStatus || "",
      transcript_source: lastTranscriptSource || "",
      ui_style_label: "",
    };

    try {
      await fetchJSON("/api/log_reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      showToast("Sent");
    } catch (e) {
      console.error(e);
      showToast("Could not save — check connection.");
      throw e;
    }
    resetTrialState();
    // Rotate prompts for the next task while preserving this trial's prompt.
    assignRandomTextPrompts();
  }

  async function handleChatSend(medium) {
    currentMedium = medium;
    const thread = medium === "SMS" ? els.smsThread : els.messengerThread;
    const ta = medium === "SMS" ? els.replySMS : els.replyMsg;
    const wrap = medium === "SMS" ? els.suggestionSMS : els.suggestionMsg;
    const text = ta?.value?.trim() || "";
    const promptText = getPromptText();
    if (!text || !thread || !ta) return;
    if (trial.startedAtMs == null) trial.startedAtMs = nowMs();
    trial.lastInputAtMs = nowMs();

    const kind = medium === "SMS" ? "sms" : "msg";
    appendOutgoing(thread, text, kind);
    ta.value = "";
    ta.style.height = "";
    if (wrap) wrap.innerHTML = "";

    try {
      lastTranscriptStatus = "";
      lastTranscriptSource = "";
      await submitReply({ replyText: text, promptText });
    } catch {
      return;
    }

    const typingEl = showTypingRow(thread, kind);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600));
    typingEl.remove();
    appendIncoming(thread, buildAutoReply(text), kind);
  }

  if (els.sendSMSBtn)
    els.sendSMSBtn.addEventListener("click", () => handleChatSend("SMS"));
  if (els.sendMsgBtn)
    els.sendMsgBtn.addEventListener("click", () => handleChatSend("Messenger"));

  if (els.sendEmailBtn) {
    els.sendEmailBtn.addEventListener("click", async () => {
      currentMedium = "Email";
      const text = els.replyEmail?.value?.trim() || "";
      if (!text) {
        showToast("Write a reply first.");
        return;
      }
      if (trial.startedAtMs == null) trial.startedAtMs = nowMs();
      trial.lastInputAtMs = nowMs();
      const emailText = text;
      const promptText = getPromptText();
      try {
        lastTranscriptStatus = "";
        lastTranscriptSource = "";
        await submitReply({ replyText: emailText, promptText });
      } catch {
        return;
      }
      els.replyEmail.value = "";
      els.suggestionEmail && (els.suggestionEmail.innerHTML = "");
      setEmailStep("read");
      showToast("Message sent");
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
        els.voiceStatus.textContent = "Could not access microphone.";
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
            const res = await fetchJSON("/api/upload_audio", {
              method: "POST",
              body: form,
            });
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
            els.voiceStatus.textContent = "Upload failed. Try again.";
            showToast("Upload failed");
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
      if (trial.startedAtMs == null) trial.startedAtMs = nowMs();
      trial.lastInputAtMs = nowMs();

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

  showMode("SMS");
  assignRandomTextPrompts();
  ensureParticipantIdInitialized();
}

// -----------------------------------------------------------------------------
// Admin (existing API)
// -----------------------------------------------------------------------------

function initAdminUI() {
  const VIEW_COPY = {
    overview: {
      title: "Overview",
      desc: "Snapshot of trials, mediums, and sentiment across the whole log.",
    },
    participants: {
      title: "Participants",
      desc: "Who has submitted trials and how many rows they have in the global log.",
    },
    trials: {
      title: "Trials & charts",
      desc: "Filter the log, explore charts, and open a trial for full detail.",
    },
    exports: {
      title: "Exports",
      desc: "Download the same CSV files the server writes under data/logs and data/participants.",
    },
    settings: {
      title: "About",
      desc: "How the participant UI, APIs, and this console connect.",
    },
  };

  const els = {
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    serverPill: document.getElementById("serverPill"),
    participantFilter: document.getElementById("participantFilter"),
    exportParticipantSelect: document.getElementById("exportParticipantSelect"),
    dateFilter: document.getElementById("dateFilter"),
    mediumFilter: document.getElementById("mediumFilter"),
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
  };

  let sentimentChart = null;
  let responseTimeChart = null;
  let styleChart = null;
  let overviewMediumChart = null;
  let overviewBertChart = null;
  /** Last rows rendered in the trial table (for detail selection). */
  let lastTrialRows = [];
  let participantAliasMap = {};
  let aliasToRawMap = {};
  let aliasOverrides = {};
  const selectedParticipants = new Set();

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

  function normalizeBertLabel(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return "ok";
    if (s.includes("unavailable")) return "ok";
    if (s === "ok") return "ok";
    const star = /([1-5])\s*star/.exec(s);
    if (star) {
      const n = parseInt(star[1], 10);
      if (n <= 2) return "negative";
      if (n === 3) return "neutral";
      return "positive";
    }
    if (s.includes("negative")) return "negative";
    if (s.includes("positive")) return "positive";
    if (s.includes("neutral")) return "neutral";
    return "ok";
  }

  function buildParticipantAliases(rows) {
    const ids = Array.from(
      new Set((rows || []).map((r) => (r.participant_id || "").trim()).filter(Boolean))
    ).sort();
    participantAliasMap = {};
    aliasToRawMap = {};
    ids.forEach((id, idx) => {
      const alias = aliasOverrides[id] || `P${String(idx + 1).padStart(3, "0")}`;
      participantAliasMap[id] = alias;
      aliasToRawMap[alias] = id;
    });
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

  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener("click", () => {
      const current = document.body.dataset.theme || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.body.dataset.theme = next;
      els.themeToggleBtn.textContent =
        next === "dark" ? "Light mode" : "Dark mode";
      loadLogs();
      loadSummary();
    });
  }

  fetchJSON("/api/health")
    .then((h) => {
      if (!els.serverPill) return;
      if (h.whisper_ok) {
        els.serverPill.textContent = "API OK · transcription enabled";
        if (els.transcriptionRuntime)
          els.transcriptionRuntime.textContent =
            "Reply audio transcription enabled (Whisper). Prompt audio transcription is not enabled.";
      } else {
        const why = h.ffmpeg_ok === false ? "ffmpeg missing" : "whisper unavailable";
        els.serverPill.textContent = `API OK · transcription limited (${why})`;
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
        o.textContent = `${participantAliasMap[id] || id} (${id})`;
        select.appendChild(o);
      });
    }
    fillSelect(els.participantFilter, true, "All participants", "");
    fillSelect(els.exportParticipantSelect, false, "", "Choose…");
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

  function renderParticipantStats(stats) {
    const tbody = els.participantStatsBody;
    if (!tbody) return;
    tbody.innerHTML = "";
    (stats || []).forEach((s) => {
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
      tdId.textContent = displayParticipantId(pid);
      const tdCount = document.createElement("td");
      tdCount.textContent = String(s.trial_count ?? "");
      const tdLast = document.createElement("td");
      tdLast.textContent = s.last_timestamp || "";

      const tdAct = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pex-admin-table-action";
      btn.textContent = "View trials";
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
      tr.appendChild(tdLast);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    if (els.participantSelectAll) {
      const pids = (stats || []).map((s) => s.participant_id || "").filter(Boolean);
      els.participantSelectAll.checked =
        pids.length > 0 && pids.every((pid) => selectedParticipants.has(pid));
    }
  }

  function renderOverviewCharts(mediumBreakdown, bertBreakdown) {
    const ctxM = document.getElementById("overviewMediumChart");
    const ctxB = document.getElementById("overviewBertChart");
    if (!ctxM || !ctxB) return;

    const accent = cssColor("--accent", "#6ea8fe");
    const good = cssColor("--good", "#7ee787");
    const warn = cssColor("--warn", "#ffcc66");

    const mLabels = Object.keys(mediumBreakdown || {});
    const mValues = mLabels.map((k) => mediumBreakdown[k]);
    const bertNorm = {};
    Object.entries(bertBreakdown || {}).forEach(([k, v]) => {
      const nk = normalizeBertLabel(k);
      bertNorm[nk] = (bertNorm[nk] || 0) + Number(v || 0);
    });
    const bLabels = Object.keys(bertNorm);
    const bValues = bLabels.map((k) => bertNorm[k]);

    if (overviewMediumChart) overviewMediumChart.destroy();
    if (overviewBertChart) overviewBertChart.destroy();

    const common = baseChartOptions();

    overviewMediumChart = new Chart(ctxM, {
      type: "bar",
      data: {
        labels: mLabels.length ? mLabels : ["—"],
        datasets: [
          {
            label: "Trials",
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

    overviewBertChart = new Chart(ctxB, {
      type: "doughnut",
      data: {
        labels: bLabels.length ? bLabels : ["—"],
        datasets: [
          {
            data: bValues.length ? bValues : [1],
            backgroundColor: [accent, good, warn, "#b197fc", "#89ddff"],
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
  }

  function loadSummary() {
    fetchJSON("/api/admin_summary")
      .then((data) => {
        if (els.kpiTotalTrials)
          els.kpiTotalTrials.textContent = String(data.total_trials ?? 0);
        if (els.kpiParticipantCount)
          els.kpiParticipantCount.textContent = String(
            data.participant_count ?? 0
          );
        if (els.kpiRefreshedAt) {
          els.kpiRefreshedAt.textContent = new Date().toLocaleString([], {
            dateStyle: "medium",
            timeStyle: "short",
          });
        }
        renderParticipantStats(data.participant_stats || []);
        renderOverviewCharts(data.medium_breakdown || {}, data.bert_breakdown || {});
      })
      .catch(() => {});
  }

  function loadPromptPool() {
    fetchJSON("/api/prompt_pool")
      .then((data) => {
        const prompts = data.text_prompts || [];
        const nextId = data.next_text_prompt_id || "";
        const custom = data.next_text_prompt_custom || {};
        if (els.customSmsPrompt) els.customSmsPrompt.value = custom.sms || "";
        if (els.customEmailSubject)
          els.customEmailSubject.value = custom.email_subject || "";
        if (els.customEmailBody) els.customEmailBody.value = custom.email_body || "";

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
            prompts
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.id || "")}">${escapeHtml(
                    p.id || ""
                  )} — ${escapeHtml((p.sms || "").slice(0, 48))}</option>`
              )
              .join("");
          els.adminNextPromptSelect.value = nextId;
        }
        if (els.nextPromptStatus) {
          if (nextId) {
            els.nextPromptStatus.textContent = `Next exercise preset: ${nextId}`;
          } else if (custom && (custom.sms || custom.email_body)) {
            els.nextPromptStatus.textContent = "Next exercise preset: custom prompt";
          } else {
            els.nextPromptStatus.textContent = "Next exercise prompt: random";
          }
        }
      })
      .catch(() => {
        if (els.nextPromptStatus)
          els.nextPromptStatus.textContent = "Prompt pool unavailable.";
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

    fetchJSON("/api/logs?" + params.toString())
      .then((data) => {
        const rows = data.rows || [];
        buildParticipantAliases(rows);
        renderTable(rows);
        renderCharts(rows);
      })
      .catch(() => {});
  }

  function refreshAll() {
    loadParticipants().then(() => {
      loadLogs();
    });
    loadSummary();
    loadPromptPool();
  }

  if (els.refreshBtn) els.refreshBtn.addEventListener("click", refreshAll);

  if (els.participantFilter) {
    els.participantFilter.addEventListener("change", () => {
      if (els.exportParticipantSelect)
        els.exportParticipantSelect.value = els.participantFilter.value;
      loadLogs();
    });
  }
  if (els.mediumFilter) els.mediumFilter.addEventListener("change", loadLogs);
  if (els.dateFilter) els.dateFilter.addEventListener("change", loadLogs);

  if (els.exportParticipantSelect) {
    els.exportParticipantSelect.addEventListener("change", () => {
      if (els.participantFilter)
        els.participantFilter.value = els.exportParticipantSelect.value;
    });
  }

  if (els.downloadAllBtn) {
    els.downloadAllBtn.addEventListener("click", () => {
      window.location.href = "/api/download_csv?scope=all";
    });
  }

  if (els.downloadParticipantBtn) {
    els.downloadParticipantBtn.addEventListener("click", () => {
      const id = els.exportParticipantSelect?.value;
      if (!id) {
        alert("Choose a participant first.");
        return;
      }
      window.location.href =
        "/api/download_csv?scope=participant&participant_id=" +
        encodeURIComponent(id);
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
  if (els.saveCustomPromptBtn) {
    els.saveCustomPromptBtn.addEventListener("click", () => {
      const sms = (els.customSmsPrompt?.value || "").trim();
      const emailSubject = (els.customEmailSubject?.value || "").trim();
      const emailBody = (els.customEmailBody?.value || "").trim();
      if (!sms && !emailSubject && !emailBody) {
        alert("Enter at least one custom prompt field.");
        return;
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

    const audioName = (row.audio_filename || "").trim();
    function resolveAudioSrc(name) {
      const n = String(name || "").trim();
      if (!n) return "";
      if (/^https?:\/\//i.test(n)) return n;
      if (n.startsWith("/static/audio/")) return n;
      if (n.startsWith("static/audio/")) return "/" + n;
      const base = n.split("/").pop() || n;
      return "/static/audio/" + encodeURIComponent(base);
    }
    const audioSrc = resolveAudioSrc(audioName);
    const audioBlock =
      audioName &&
      `<div class="pex-admin-detail-block">
        <h3>Audio</h3>
        <audio class="pex-admin-audio" controls preload="metadata" src="${escapeHtml(audioSrc)}"></audio>
        <p class="small" style="margin-top:8px;color:var(--muted)">${escapeHtml(audioName)}</p>
      </div>`;

    const reply = (row.reply_text || "").trim();
    const trans = (row.transcript || "").trim();
    const prompt = (row.prompt_text || "").trim();
    const analysisStatus = (row.reply_analysis_status || "").trim();
    const analysisBasis = (row.reply_analysis_basis || "").trim();
    const transcriptStatus = (row.transcript_status || "").trim();
    const transcriptSource = (row.transcript_source || "").trim();

    const transcriptDisplay = trans || (row.medium === "Voice" ? "No transcript stored." : "");
    const analysisAvailabilityNote =
      row.medium === "Voice" && (!trans || analysisStatus.includes("unavailable"))
        ? "Reply-text sentiment/style analysis is unavailable for this voice trial because no transcript was captured."
        : "";
    const transcriptNote =
      row.medium === "Voice"
        ? transcriptStatus === "ffmpeg_missing"
          ? "Transcription unavailable: ffmpeg is missing on server."
          : transcriptStatus === "whisper_unavailable"
          ? "Transcription backend unavailable in this environment (Whisper disabled)."
          : transcriptStatus === "transcription_failed"
            ? "Transcription attempted but failed."
            : transcriptStatus === "empty"
              ? "Transcription ran but returned empty text."
              : transcriptStatus === "ok"
                ? "Transcript captured by Whisper."
                : "Transcript status not recorded."
        : "";
    wrap.innerHTML = `
      <div class="pex-admin-detail-block">
        <h3>When &amp; who</h3>
        <dl class="pex-admin-detail-meta">
          <dt>Timestamp</dt><dd>${escapeHtml(row.timestamp || "")}</dd>
          <dt>Participant</dt><dd>${escapeHtml(displayParticipantId(row.participant_id || ""))}</dd>
          <dt>Medium</dt><dd>${escapeHtml(row.medium || "")}</dd>
          <dt>Input</dt><dd>${escapeHtml(row.input_method || "")}</dd>
        </dl>
      </div>
      <div class="pex-admin-detail-block">
        <h3>Reply text</h3>
        <p>${reply ? escapeHtml(reply) : "<em class='small'>—</em>"}</p>
      </div>
      <div class="pex-admin-detail-block">
        <h3>Transcript</h3>
        <p>${transcriptDisplay ? escapeHtml(transcriptDisplay) : "<em class='small'>—</em>"}</p>
        ${transcriptNote ? `<p class="small">${escapeHtml(transcriptNote)}</p>` : ""}
        ${analysisAvailabilityNote ? `<p class="small pex-admin-warn">${escapeHtml(analysisAvailabilityNote)}</p>` : ""}
      </div>
      ${audioBlock || ""}
      <div class="pex-admin-detail-block">
        <h3>Prompt (excerpt)</h3>
        <p>${prompt ? escapeHtml(prompt.slice(0, 2000)) : "<em class='small'>—</em>"}</p>
      </div>
      <div class="pex-admin-detail-block">
        <h3>Timing &amp; behaviour</h3>
        <dl class="pex-admin-detail-meta">
          <dt>Response (s)</dt><dd>${escapeHtml(String(row.response_time_seconds ?? ""))}</dd>
          <dt>Keypresses</dt><dd>${escapeHtml(String(row.keypress_count ?? ""))}</dd>
          <dt>Backspaces</dt><dd>${escapeHtml(String(row.backspace_count ?? ""))}</dd>
          <dt>Paste</dt><dd>${escapeHtml(row.paste_used || "")}</dd>
          <dt>Correction</dt><dd>${escapeHtml(row.correction_applied || "")}</dd>
        </dl>
      </div>
      <div class="pex-admin-detail-block">
        <h3>Primary analysis</h3>
        <dl class="pex-admin-detail-meta">
          <dt>Reply analysis status</dt><dd>${escapeHtml(analysisStatus || "ok")}</dd>
          <dt>Analysis basis</dt><dd>${escapeHtml(analysisBasis || "reply_text")}</dd>
          <dt>Reply formality/style</dt><dd>${escapeHtml(row.reply_style || "")}</dd>
          <dt>Prompt formality/style</dt><dd>${escapeHtml(row.prompt_style || "")}</dd>
          <dt>BERT (normalized)</dt><dd>${escapeHtml(normalizeBertLabel(row.bert_label || ""))}</dd>
        </dl>
        <div style="margin-top:10px">
          <button type="button" class="pex-admin-table-action" id="adminDeleteTrialBtn">Delete this trial…</button>
        </div>
      </div>
      <details class="pex-admin-advanced">
        <summary>Advanced analysis details</summary>
        <div class="pex-admin-detail-block">
          <dl class="pex-admin-detail-meta">
            <dt>Participant raw ID</dt><dd>${escapeHtml(row.participant_id || "")}</dd>
            <dt>BERT raw</dt><dd>${escapeHtml(row.bert_raw || row.bert_label || "")}</dd>
            <dt>BERT confidence</dt><dd>${escapeHtml(String(row.bert_confidence ?? ""))}</dd>
            <dt>TextBlob polarity</dt><dd>${escapeHtml(String(row.textblob_polarity ?? ""))}</dd>
            <dt>TextBlob subjectivity</dt><dd>${escapeHtml(String(row.textblob_subjectivity ?? ""))}</dd>
            <dt>VADER compound</dt><dd>${escapeHtml(String(row.vader_compound ?? ""))}</dd>
            <dt>Transcript status</dt><dd>${escapeHtml(transcriptStatus)}</dd>
            <dt>Transcript source</dt><dd>${escapeHtml(transcriptSource)}</dd>
            <dt>Prompt tone</dt><dd>${escapeHtml(row.prompt_tone || "")}</dd>
            <dt>Prompt seriousness</dt><dd>${escapeHtml(row.prompt_seriousness || "")}</dd>
            <dt>Prompt formality</dt><dd>${escapeHtml(row.prompt_formality || "")}</dd>
          </dl>
        </div>
      </details>
    `;
    const delBtn = wrap.querySelector("#adminDeleteTrialBtn");
    delBtn?.addEventListener("click", () => {
      const ok = window.confirm("Delete this trial row from CSV logs? This cannot be undone.");
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
        '<p class="pex-admin-detail-placeholder">Select a trial on the left to see full fields, sentiment scores, and audio.</p>';
    }

    tbody.innerHTML = "";
    rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.rowIndex = String(idx);
      tr.tabIndex = 0;
      const preview = (row.reply_text || row.transcript || "").toString();
      tr.innerHTML = `
        <td>${escapeHtml((row.timestamp || "").slice(0, 19))}</td>
        <td>${escapeHtml(displayParticipantId(row.participant_id || ""))}</td>
        <td>${escapeHtml(row.medium || "")}</td>
        <td>${escapeHtml(preview.slice(0, 72))}${preview.length > 72 ? "…" : ""}</td>
        <td>${escapeHtml(normalizeBertLabel(row.bert_label || ""))}</td>
        <td>${escapeHtml(String(row.response_time_seconds ?? ""))}</td>
        <td>${escapeHtml(row.reply_style || "")}</td>
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

  function renderCharts(rows) {
    const ctxSentiment = document.getElementById("sentimentChart");
    const ctxResponse = document.getElementById("responseTimeChart");
    const ctxStyle = document.getElementById("styleChart");
    if (!ctxSentiment || !ctxResponse || !ctxStyle) return;

    const sentimentCounts = {};
    const styleCounts = {};
    const responseTimes = [];

    rows.forEach((row) => {
      const label = normalizeBertLabel(row.bert_label || "neutral");
      sentimentCounts[label] = (sentimentCounts[label] || 0) + 1;
      const style = row.reply_style || "neutral";
      styleCounts[style] = (styleCounts[style] || 0) + 1;
      const rt = parseFloat(row.response_time_seconds || "0");
      if (!Number.isNaN(rt) && rt > 0) responseTimes.push(rt);
    });

    const sentimentLabels = Object.keys(sentimentCounts);
    const sentimentValues = sentimentLabels.map((k) => sentimentCounts[k]);
    const styleLabels = Object.keys(styleCounts);
    const styleValues = styleLabels.map((k) => styleCounts[k]);
    const rtLabels = responseTimes.map((_, i) => String(i + 1));

    const accent = cssColor("--accent", "#6ea8fe");
    const good = cssColor("--good", "#7ee787");
    const warn = cssColor("--warn", "#ffcc66");

    if (sentimentChart) sentimentChart.destroy();
    if (responseTimeChart) responseTimeChart.destroy();
    if (styleChart) styleChart.destroy();

    const base = baseChartOptions();

    sentimentChart = new Chart(ctxSentiment, {
      type: "bar",
      data: {
        labels: sentimentLabels.length ? sentimentLabels : ["—"],
        datasets: [
          {
            label: "Count",
            data: sentimentValues.length ? sentimentValues : [0],
            backgroundColor: accent,
          },
        ],
      },
      options: {
        ...base,
        plugins: { ...base.plugins, legend: { display: false } },
      },
    });

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
          x: { ...base.scales.x, title: { display: true, text: "Trial #", color: chartMutedColor() } },
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
        },
      },
    });
  }

  loadAliasOverrides();
  // Load logs after filter options are ready so stale values do not hide rows.
  loadParticipants().then(() => {
    loadLogs();
  });
  loadSummary();
  loadPromptPool();
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
