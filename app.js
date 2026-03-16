// app.js
// Reply Task Prototype front-end
//
// What this file does:
// 1. Tracks typing behaviour and timing
// 2. Switches between SMS / Email / Messenger / MP3 layouts
// 3. Supports light/dark mode and participant/admin view
// 4. Builds a simple rule-based style label: formal / informal / neutral
// 5. Offers a simple correction suggestion system
// 6. Supports Send buttons for all mediums
// 7. Generates a simple follow-up auto reply after sending
// 8. Calls Flask routes:
//    - /health
//    - /analyze
//    - /log
//
// Important notes:
// - The "record" button is only simulated for now
// - MP3 audio is NOT truly analyzed yet
// - For MP3, text analysis still uses the typed fallback reply
// - Analyze + Save uses the last sent reply if one exists
// - Email analysis/logging now uses the body text only
//   so "From / To / Subject" are NOT treated as the actual message content

const els = {
  // Top controls
  medium: document.getElementById("medium"),
  inputMethod: document.getElementById("inputMethod"),
  model: document.getElementById("model"),
  participantId: document.getElementById("participantId"),
  notes: document.getElementById("notes"),

  // Status pills / top text
  readyPill: document.getElementById("readyPill"),
  statusText: document.getElementById("statusText"),
  serverPill: document.getElementById("serverPill"),

  // Theme / role buttons
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  roleToggleBtn: document.getElementById("roleToggleBtn"),

  // Live metrics
  timeVal: document.getElementById("timeVal"),
  keysVal: document.getElementById("keysVal"),
  backsVal: document.getElementById("backsVal"),
  pasteVal: document.getElementById("pasteVal"),

  // Correction controls
  manualCorrection: document.getElementById("manualCorrection"),
  corrStatus: document.getElementById("corrStatus"),
  suggestBtn: document.getElementById("suggestBtn"),
  suggestionStatus: document.getElementById("suggestionStatus"),

  // Buttons
  analyzeBtn: document.getElementById("analyzeBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),
  randomPromptBtn: document.getElementById("randomPromptBtn"),

  // Send buttons
  sendSMSBtn: document.getElementById("sendSMSBtn"),
  sendEmailBtn: document.getElementById("sendEmailBtn"),
  sendMsgBtn: document.getElementById("sendMsgBtn"),
  sendMP3Btn: document.getElementById("sendMP3Btn"),

  // Result / table
  resultText: document.getElementById("resultText"),
  sentenceTableWrap: document.getElementById("sentenceTableWrap"),

  // Layout sections
  layoutSMS: document.getElementById("layoutSMS"),
  layoutEmail: document.getElementById("layoutEmail"),
  layoutMessenger: document.getElementById("layoutMessenger"),
  layoutMP3: document.getElementById("layoutMP3"),

  // SMS fields
  promptSMS: document.getElementById("promptSMS"),
  replySMS: document.getElementById("replySMS"),
  smsThread: document.getElementById("smsThread"),
  smsAutoReplyWrap: document.getElementById("smsAutoReplyWrap"),

  // Email fields
  emailFrom: document.getElementById("emailFrom"),
  emailSubject: document.getElementById("emailSubject"),
  promptEmail: document.getElementById("promptEmail"),
  emailTo: document.getElementById("emailTo"),
  replyEmailSubject: document.getElementById("replyEmailSubject"),
  replyEmail: document.getElementById("replyEmail"),
  emailAutoReplyWrap: document.getElementById("emailAutoReplyWrap"),

  // Messenger fields
  promptMsg: document.getElementById("promptMsg"),
  replyMsg: document.getElementById("replyMsg"),
  messengerThread: document.getElementById("messengerThread"),
  msgAutoReplyWrap: document.getElementById("msgAutoReplyWrap"),

  // MP3 fields
  promptAudio: document.getElementById("promptAudio"),
  replyMP3: document.getElementById("replyMP3"),
  recordBtn: document.getElementById("recordBtn"),
  playBtn: document.getElementById("playBtn"),
  recordStatus: document.getElementById("recordStatus"),
  mp3AutoReplyWrap: document.getElementById("mp3AutoReplyWrap"),

  // Suggestion containers for each layout
  suggestionSMS: document.getElementById("suggestionSMS"),
  suggestionEmail: document.getElementById("suggestionEmail"),
  suggestionMsg: document.getElementById("suggestionMsg"),
  suggestionMP3: document.getElementById("suggestionMP3"),
};

// Example prompts used by "Random Prompt"
const conversationPrompts = {
  SMS: [
    "Hey! What's up?",
    "Good morning! How's your day going?",
    "Hi there! Long time no chat 😊",
    "Hey, quick question for you...",
    "Can you help me with something real quick?",
    "I need your opinion on this..."
  ],
  Messenger: [
    "Hey! Saw your story, that looks amazing! 📸",
    "That meme you sent yesterday had me dying 😂",
    "Group project meeting - who's free tomorrow?",
    "How are you really doing? Like, genuinely?",
    "Can I vent to you for a minute?"
  ],
  Email: [
    "Following up on our discussion from yesterday...",
    "I wanted to share some updates on the project...",
    "Could you please review the attached document?",
    "Regarding our meeting next week...",
    "Hope you're doing well! Just wanted to check in..."
  ],
  MP3: [
    "VoiceFiles/Voice1.mp3",
    "VoiceFiles/Voice2.mp3",
    "VoiceFiles/Voice3.mp3"
  ]
};

// Current trial state
let trial = resetTrialState();

// In-browser copy of saved rows
// This is what "Download CSV" uses
let rows = [];

// Current correction suggestion
let currentSuggestion = "";

// Store the most recent sent reply for each medium
// This helps because the composer gets cleared after Send.
let lastSentReplies = {
  SMS: "",
  Email: "",
  Messenger: "",
  MP3: ""
};

// Create a fresh trial state
function resetTrialState() {
  return {
    startedAtMs: null,
    lastInputAtMs: null,
    keypressCount: 0,
    backspaceCount: 0,
    pasteUsed: false,
    correctionApplied: "no",
  };
}

// Current high-resolution timestamp in the browser
function nowMs() {
  return performance.now();
}

// Safe seconds between two timestamps
function secondsBetween(a, b) {
  return Math.max(0, (b - a) / 1000);
}

// Update the top pill to Ready
function setReadyState(text) {
  if (els.readyPill) els.readyPill.textContent = "Ready";
  if (els.statusText) els.statusText.textContent = text;
}

// Update the top pill to Running
function setRunningState(text) {
  if (els.readyPill) els.readyPill.textContent = "Running";
  if (els.statusText) els.statusText.textContent = text;
}

// Update time / keys / backspace / paste in the UI
function updateMetricsLive() {
  if (!els.timeVal || !els.keysVal || !els.backsVal || !els.pasteVal) return;

  if (trial.startedAtMs == null) {
    els.timeVal.textContent = "0.000";
  } else {
    const endPoint = trial.lastInputAtMs ?? nowMs();
    els.timeVal.textContent = secondsBetween(trial.startedAtMs, endPoint).toFixed(3);
  }

  els.keysVal.textContent = String(trial.keypressCount);
  els.backsVal.textContent = String(trial.backspaceCount);
  els.pasteVal.textContent = trial.pasteUsed ? "yes" : "no";
}

// Return the active reply textarea depending on current medium
function getActiveReplyEl() {
  const m = els.medium?.value || "SMS";
  if (m === "SMS") return els.replySMS;
  if (m === "Email") return els.replyEmail;
  if (m === "Messenger") return els.replyMsg;
  return els.replyMP3;
}

// Return the suggestion wrapper matching the current medium
function getActiveSuggestionWrap() {
  const m = els.medium?.value || "SMS";
  if (m === "SMS") return els.suggestionSMS;
  if (m === "Email") return els.suggestionEmail;
  if (m === "Messenger") return els.suggestionMsg;
  return els.suggestionMP3;
}

// Return prompt body only
// For Email, we only use the actual body.
function getPromptBodyOnly() {
  const m = els.medium?.value || "SMS";

  if (m === "SMS") return (els.promptSMS?.value || "").trim();
  if (m === "Email") return (els.promptEmail?.value || "").trim();
  if (m === "Messenger") return (els.promptMsg?.value || "").trim();

  // MP3 still has no transcript field, so this stays placeholder text.
  return els.promptAudio?.src ? `[Audio: ${els.promptAudio.src.split("/").pop()}]` : "";
}

// Return the prompt text saved to the dataset
// For Email, we log only the body, not the header fields.
function getActivePromptText() {
  const m = els.medium?.value || "SMS";

  if (m === "SMS") return (els.promptSMS?.value || "").trim();
  if (m === "Email") return (els.promptEmail?.value || "").trim();
  if (m === "Messenger") return (els.promptMsg?.value || "").trim();

  return els.promptAudio?.src ? `[Audio file: ${els.promptAudio.src.split("/").pop()}]` : "";
}

// Return the current unsent reply text from the composer
// For Email, this returns body only.
function getComposerReplyText() {
  const m = els.medium?.value || "SMS";

  if (m === "SMS") return (els.replySMS?.value || "").trim();
  if (m === "Email") return (els.replyEmail?.value || "").trim();
  if (m === "Messenger") return (els.replyMsg?.value || "").trim();
  return (els.replyMP3?.value || "").trim();
}

// Return the reply text saved to the dataset
// If a sent reply exists, we prefer that over the current composer contents.
function getActiveReplyText() {
  const m = els.medium?.value || "SMS";
  const sent = (lastSentReplies[m] || "").trim();
  if (sent) return sent;
  return getComposerReplyText();
}

// Show the matching layout and hide the others
function showLayout(medium) {
  document.body.dataset.medium = medium;

  if (els.layoutSMS) els.layoutSMS.classList.toggle("hidden", medium !== "SMS");
  if (els.layoutEmail) els.layoutEmail.classList.toggle("hidden", medium !== "Email");
  if (els.layoutMessenger) els.layoutMessenger.classList.toggle("hidden", medium !== "Messenger");
  if (els.layoutMP3) els.layoutMP3.classList.toggle("hidden", medium !== "MP3");

  // When switching to MP3, auto-load a random audio prompt
  if (medium === "MP3" && els.promptAudio) {
    const prompts = conversationPrompts.MP3;
    const randomMP3 = prompts[Math.floor(Math.random() * prompts.length)];
    els.promptAudio.src = randomMP3;
    els.promptAudio.load();
  }

  // Reset trial state so mediums don't mix
  trial = resetTrialState();
  currentSuggestion = "";
  clearSuggestionUI();
  clearSentAndAutoReplyUIForMedium(medium);
  lastSentReplies[medium] = "";
  updateMetricsLive();
  setReadyState("Medium changed. Ready for a new trial.");
  renderSentenceTable();
}

// Attach listeners to one reply textarea
function attachReplyListeners(textarea) {
  if (!textarea) return;

  textarea.addEventListener("keydown", (e) => {
    if (textarea !== getActiveReplyEl()) return;

    // Start timing on first keypress
    if (trial.startedAtMs == null) {
      trial.startedAtMs = nowMs();
      setRunningState("Timing started.");
    }

    trial.lastInputAtMs = nowMs();
    trial.keypressCount += 1;

    if (e.key === "Backspace") {
      trial.backspaceCount += 1;
    }

    updateMetricsLive();
  });

  textarea.addEventListener("paste", () => {
    if (textarea !== getActiveReplyEl()) return;
    trial.pasteUsed = true;
    trial.lastInputAtMs = nowMs();
    updateMetricsLive();
  });

  textarea.addEventListener("input", () => {
    if (textarea !== getActiveReplyEl()) return;

    // If the user begins typing again after a send, treat it as a fresh draft
    const m = els.medium?.value || "SMS";
    lastSentReplies[m] = "";

    trial.lastInputAtMs = nowMs();
    updateMetricsLive();
    maybeBuildLiveSuggestion();
    renderSentenceTable();
  });
}

// Attach tracking to all reply boxes
attachReplyListeners(els.replySMS);
attachReplyListeners(els.replyEmail);
attachReplyListeners(els.replyMsg);
attachReplyListeners(els.replyMP3);

// Rebuild sentence table when prompt text changes
[
  els.promptSMS,
  els.promptEmail,
  els.promptMsg,
  els.emailFrom,
  els.emailSubject,
  els.emailTo,
  els.replyEmailSubject
].forEach((t) => {
  if (t) t.addEventListener("input", renderSentenceTable);
});

// Manual correction checkbox behaviour
if (els.manualCorrection) {
  els.manualCorrection.addEventListener("change", () => {
    if (!els.corrStatus) return;
    els.corrStatus.textContent = els.manualCorrection.checked
      ? "Correction: manual yes"
      : "Correction: none";
  });
}

// Medium dropdown behaviour
if (els.medium) {
  els.medium.addEventListener("change", () => showLayout(els.medium.value));
}

// Theme toggle
if (els.themeToggleBtn) {
  els.themeToggleBtn.addEventListener("click", () => {
    const current = document.body.dataset.theme;
    const next = current === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    els.themeToggleBtn.textContent = next === "dark" ? "Light mode" : "Dark mode";
  });
}

// Role toggle
if (els.roleToggleBtn) {
  els.roleToggleBtn.addEventListener("click", () => {
    const current = document.body.dataset.role;
    const next = current === "admin" ? "participant" : "admin";
    document.body.dataset.role = next;
    els.roleToggleBtn.textContent =
      next === "admin" ? "Switch to participant view" : "Switch to admin view";
  });
}

// Random prompt button
if (els.randomPromptBtn) {
  els.randomPromptBtn.addEventListener("click", () => {
    const medium = els.medium?.value || "SMS";
    const prompts = conversationPrompts[medium];

    if (!prompts?.length) return;

    const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];

    if (medium === "SMS" && els.promptSMS) els.promptSMS.value = randomPrompt;
    else if (medium === "Email" && els.promptEmail) els.promptEmail.value = randomPrompt;
    else if (medium === "Messenger" && els.promptMsg) els.promptMsg.value = randomPrompt;
    else if (medium === "MP3" && els.promptAudio) {
      els.promptAudio.src = randomPrompt;
      els.promptAudio.load();
    }

    renderSentenceTable();
    setReadyState("Random prompt loaded.");
  });
}

// Reset current trial
if (els.resetBtn) {
  els.resetBtn.addEventListener("click", () => {
    const medium = els.medium?.value || "SMS";

    trial = resetTrialState();
    currentSuggestion = "";
    lastSentReplies[medium] = "";
    clearSuggestionUI();
    clearSentAndAutoReplyUIForMedium(medium);

    const replyEl = getActiveReplyEl();
    if (replyEl) replyEl.value = "";

    if (els.notes) els.notes.value = "";
    if (els.manualCorrection) els.manualCorrection.checked = false;
    if (els.corrStatus) els.corrStatus.textContent = "Correction: none";
    if (els.suggestionStatus) els.suggestionStatus.textContent = "Suggestion: none";
    if (els.resultText) {
      els.resultText.textContent = "Results will appear here after you click Analyze + Save.";
    }

    if (els.recordStatus) {
      els.recordStatus.textContent = "Voice reply is currently simulated.";
    }

    setReadyState("Trial reset. Waiting for you to start typing…");
    updateMetricsLive();
    renderSentenceTable();
  });
}

// Simulated record button
if (els.recordBtn) {
  els.recordBtn.addEventListener("click", () => {
    els.recordBtn.disabled = true;
    els.recordBtn.textContent = "Recording…";

    if (els.recordStatus) {
      els.recordStatus.textContent = "Recording simulation in progress…";
    }

    setTimeout(() => {
      els.recordBtn.disabled = false;
      els.recordBtn.textContent = "🎤 Start Recording";

      if (els.playBtn) {
        els.playBtn.disabled = false;
      }

      if (els.recordStatus) {
        els.recordStatus.textContent = "Recording is simulated in this prototype.";
      }

      alert("Recording is not implemented yet. This button currently simulates the interaction.");
    }, 1800);
  });
}

// Simulated playback button
if (els.playBtn) {
  els.playBtn.addEventListener("click", () => {
    alert("Playback of a recorded reply is not implemented yet. This is only a simulated control.");
  });
}

// Suggestion button
if (els.suggestBtn) {
  els.suggestBtn.addEventListener("click", () => {
    buildSuggestion(true);
  });
}

// Build suggestions live while typing
function maybeBuildLiveSuggestion() {
  const text = getComposerReplyText();

  if (!text) {
    currentSuggestion = "";
    clearSuggestionUI();
    return;
  }

  const suggestion = basicCorrectionSuggestion(text);

  if (suggestion && suggestion !== text) {
    currentSuggestion = suggestion;
    renderSuggestionUI(suggestion);
    if (els.suggestionStatus) els.suggestionStatus.textContent = "Suggestion available";
  } else {
    currentSuggestion = "";
    clearSuggestionUI();
    if (els.suggestionStatus) els.suggestionStatus.textContent = "Suggestion: none";
  }
}

// Build suggestion manually on button click
function buildSuggestion(force = false) {
  const text = getComposerReplyText();

  if (!text) {
    if (force) alert("Type a reply first.");
    return;
  }

  const suggestion = basicCorrectionSuggestion(text);

  if (suggestion && suggestion !== text) {
    currentSuggestion = suggestion;
    renderSuggestionUI(suggestion);
    if (els.suggestionStatus) els.suggestionStatus.textContent = "Suggestion available";
  } else if (force) {
    currentSuggestion = "";
    clearSuggestionUI();
    if (els.suggestionStatus) els.suggestionStatus.textContent = "Suggestion: none";
    alert("No obvious suggestion found.");
  }
}

// Very simple homemade correction rules
// This is NOT a real spellchecker model
function basicCorrectionSuggestion(text) {
  let out = ` ${text} `;

  const replacements = [
    [/\bholaa\b/gi, "hola"],
    [/\bhelo\b/gi, "hello"],
    [/\bhelllo\b/gi, "hello"],
    [/\bpls\b/gi, "please"],
    [/\bthx\b/gi, "thanks"],
    [/\bu\b/gi, "you"],
    [/\bur\b/gi, "your"],
    [/\bim\b/gi, "I'm"],
    [/\bdont\b/gi, "don't"],
    [/\bcant\b/gi, "can't"],
    [/\bwont\b/gi, "won't"],
    [/\bive\b/gi, "I've"],
    [/\bidk\b/gi, "I don't know"],
    [/\bmsg\b/gi, "message"],
    [/\bteh\b/gi, "the"],
    [/\brecieve\b/gi, "receive"],
    [/\bdefinately\b/gi, "definitely"]
  ];

  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, ` ${replacement} `);
  }

  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

// Show a clickable suggestion chip
function renderSuggestionUI(suggestion) {
  const wrap = getActiveSuggestionWrap();
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="suggestionChip">
      <span>Suggestion: ${escapeHtml(suggestion)}</span>
      <button type="button" class="applySuggestionBtn">Apply</button>
    </div>
  `;

  const btn = wrap.querySelector(".applySuggestionBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      const replyEl = getActiveReplyEl();
      if (!replyEl) return;

      replyEl.value = suggestion;

      trial.correctionApplied = "yes";
      if (els.manualCorrection) els.manualCorrection.checked = true;
      if (els.corrStatus) els.corrStatus.textContent = "Correction: manual yes";
      if (els.suggestionStatus) els.suggestionStatus.textContent = "Suggestion applied";
      currentSuggestion = suggestion;

      renderSentenceTable();
    });
  }
}

// Remove suggestion UI from all layouts
function clearSuggestionUI() {
  [els.suggestionSMS, els.suggestionEmail, els.suggestionMsg, els.suggestionMP3].forEach((wrap) => {
    if (wrap) wrap.innerHTML = "";
  });
}

// Rule-based style classifier
// Returns formal / informal / neutral
function classifyStyle(text) {
  const t = (text || "").trim();
  if (!t) return { label: "neutral", formalScore: 0, informalScore: 0 };

  let formalScore = 0;
  let informalScore = 0;

  // Formal clues
  if (/^(dear|hello|good morning|good afternoon|good evening)/i.test(t)) formalScore += 2;
  if (/\b(regards|kind regards|sincerely|best regards)\b/i.test(t)) formalScore += 2;
  if (/\b(please|could you|would you|thank you)\b/i.test(t)) formalScore += 2;
  if (/[;]/.test(t)) formalScore += 1;
  if (t.length > 120) formalScore += 1;

  // Informal clues
  if (/\b(hey|yo|lol|omg|haha|bro|dude|pls|thx)\b/i.test(t)) informalScore += 2;
  if (/[!?]{2,}/.test(t)) informalScore += 1;
  if (/[😂🤣😊🔥💀😍😭]/u.test(t)) informalScore += 2;
  if (/\b(u|ur|idk)\b/i.test(t)) informalScore += 2;
  if (/\b(can't|don't|won't|i'm|i've)\b/i.test(t)) informalScore += 1;

  let label = "neutral";
  if (formalScore >= informalScore + 2) label = "formal";
  else if (informalScore >= formalScore + 2) label = "informal";

  return { label, formalScore, informalScore };
}

// Build a small follow-up auto reply based on simple cues
function buildAutoReply(text) {
  const t = (text || "").toLowerCase().trim();

  if (!t) return "Okay.";

  if (/\b(thank|thanks|thank you)\b/.test(t)) {
    return "You’re welcome!";
  }

  if (/\b(sad|upset|bad|angry|hate|terrible|awful|cry|stressed)\b/.test(t)) {
    return "I’m sorry to hear that. Do you want to talk about it?";
  }

  if (/\b(happy|great|good|excited|love|amazing|nice)\b/.test(t)) {
    return "That sounds really nice 😊";
  }

  if (/\b(help|can you|could you|would you)\b/.test(t)) {
    return "Yes, of course. What do you need help with?";
  }

  if (/\?\s*$/.test(t)) {
    return "Hmm, let me think about that.";
  }

  return "Got it.";
}

// Remove any old sent/auto-reply UI for a given medium
function clearSentAndAutoReplyUIForMedium(medium) {
  if (medium === "SMS" && els.smsAutoReplyWrap) {
    els.smsAutoReplyWrap.innerHTML = "";
  }

  if (medium === "Email" && els.emailAutoReplyWrap) {
    els.emailAutoReplyWrap.innerHTML = "";
  }

  if (medium === "Messenger" && els.msgAutoReplyWrap) {
    els.msgAutoReplyWrap.innerHTML = "";
  }

  if (medium === "MP3" && els.mp3AutoReplyWrap) {
    els.mp3AutoReplyWrap.innerHTML = "";
  }
}

// Send the current reply
// This turns the typed reply into visible sent UI and stores it for later analysis.
function sendCurrentReply() {
  const medium = els.medium?.value || "SMS";
  const replyText = getComposerReplyText();

  if (!replyText) {
    alert("Please type a reply first.");
    return;
  }

  if (trial.startedAtMs == null) {
    trial.startedAtMs = nowMs();
  }

  trial.lastInputAtMs = nowMs();
  lastSentReplies[medium] = replyText;

  const autoReply = buildAutoReply(replyText);

  clearSentAndAutoReplyUIForMedium(medium);

  // SMS sent + reply
  if (medium === "SMS" && els.smsAutoReplyWrap) {
    els.smsAutoReplyWrap.innerHTML = `
      <div class="bubble outgoing sentBlock">
        <div class="bubbleMeta">Sent</div>
        <div>${escapeHtml(replyText)}</div>
      </div>
      <div class="bubble incoming autoReplyBlock">
        <div class="bubbleMeta">Reply</div>
        <div>${escapeHtml(autoReply)}</div>
      </div>
    `;

    if (els.replySMS) els.replySMS.value = "";
  }

  // Email sent + reply
  if (medium === "Email" && els.emailAutoReplyWrap) {
    els.emailAutoReplyWrap.innerHTML = `
      <div class="emailCard sentBlock">
        <div class="emailCardTitle">Sent reply</div>
        <div class="small">Reply body only</div>
        <div class="messageBlock">${escapeHtml(replyText)}</div>
      </div>

      <div class="emailCard autoReplyBlock" style="margin-top:12px;">
        <div class="emailCardTitle">Follow-up reply</div>
        <div class="messageBlock">${escapeHtml(autoReply)}</div>
      </div>
    `;

    if (els.replyEmail) els.replyEmail.value = "";
  }

  // Messenger sent + reply
  if (medium === "Messenger" && els.msgAutoReplyWrap) {
    els.msgAutoReplyWrap.innerHTML = `
      <div class="msg outgoingMsg sentBlock">
        <div class="msgMeta">Sent</div>
        <div>${escapeHtml(replyText)}</div>
      </div>
      <div class="msg incomingMsg autoReplyBlock">
        <div class="msgMeta">Reply</div>
        <div>${escapeHtml(autoReply)}</div>
      </div>
    `;

    if (els.replyMsg) els.replyMsg.value = "";
  }

  // MP3 sent + reply
  if (medium === "MP3" && els.mp3AutoReplyWrap) {
    els.mp3AutoReplyWrap.innerHTML = `
      <div class="audioCard sentBlock" style="margin-top:12px;">
        <div class="audioCardTitle">Sent fallback reply</div>
        <div class="messageBlock">${escapeHtml(replyText)}</div>
      </div>

      <div class="audioCard autoReplyBlock" style="margin-top:12px;">
        <div class="audioCardTitle">Follow-up reply</div>
        <div class="messageBlock">${escapeHtml(autoReply)}</div>
      </div>
    `;

    if (els.replyMP3) els.replyMP3.value = "";
  }

  clearSuggestionUI();
  currentSuggestion = "";
  if (els.suggestionStatus) els.suggestionStatus.textContent = "Suggestion: none";

  updateMetricsLive();
  renderSentenceTable();
  setRunningState("Reply sent. Ready to analyze or continue.");
}

// Wire send buttons
if (els.sendSMSBtn) els.sendSMSBtn.addEventListener("click", sendCurrentReply);
if (els.sendEmailBtn) els.sendEmailBtn.addEventListener("click", sendCurrentReply);
if (els.sendMsgBtn) els.sendMsgBtn.addEventListener("click", sendCurrentReply);
if (els.sendMP3Btn) els.sendMP3Btn.addEventListener("click", sendCurrentReply);

// Check whether Flask is running
async function checkServer() {
  try {
    const res = await fetch("/health", { cache: "no-store" });
    if (!res.ok) throw new Error("health not ok");

    const data = await res.json();
    if (els.serverPill) {
      els.serverPill.textContent = data.vader_ok ? "OK (VADER ready)" : "OK (no VADER)";
      els.serverPill.classList.remove("subtle");
    }
    return true;
  } catch {
    if (els.serverPill) {
      els.serverPill.textContent = "Not running";
      els.serverPill.classList.add("subtle");
    }
    return false;
  }
}

// Ask Flask to analyze reply sentiment
async function analyzeReply(replyText) {
  const res = await fetch("/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply_text: replyText }),
  });

  if (!res.ok) throw new Error("Analyze failed");
  return await res.json();
}

// Ask Flask to log one trial row
async function logTrial(payload) {
  const res = await fetch("/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("Log failed");
  return await res.json();
}

// Analyze + Save button
if (els.analyzeBtn) {
  els.analyzeBtn.addEventListener("click", async () => {
    const promptText = getActivePromptText();
    const replyText = getActiveReplyText();

    if (!replyText) {
      alert("Please type a reply first.");
      return;
    }

    // Stop timing at last input, not at button click
    const endMs = trial.lastInputAtMs ?? nowMs();
    const startMs = trial.startedAtMs ?? endMs;
    const responseTime = secondsBetween(startMs, endMs);

    let analysis;
    try {
      analysis = await analyzeReply(replyText);
    } catch {
      if (els.resultText) {
        els.resultText.textContent = "Could not analyze. Is the Flask server running?";
      }
      return;
    }

    // Rule-based style labels
    const replyStyle = classifyStyle(replyText);
    const promptStyle = classifyStyle(promptText);

    // Sentiment values from Flask
    const tbPol = Number(analysis.reply_tb_polarity ?? 0);
    const tbSub = Number(analysis.reply_tb_subjectivity ?? 0);
    const vaderComp = analysis.reply_vader_compound;

    // Show analysis result in the result box
    const resultLine = `
      <div><strong>Reply style:</strong> <span class="tag ${replyStyle.label}">${replyStyle.label}</span></div>
      <div><strong>Prompt style:</strong> <span class="tag ${promptStyle.label}">${promptStyle.label}</span></div>
      <div><strong>TextBlob:</strong> polarity=${tbPol.toFixed(3)}, subjectivity=${tbSub.toFixed(3)}</div>
      <div><strong>VADER:</strong> ${
        vaderComp !== null && vaderComp !== undefined && vaderComp !== ""
          ? Number(vaderComp).toFixed(3)
          : "not available"
      }</div>
    `;

    if (els.resultText) {
      els.resultText.innerHTML = resultLine;
    }

    // Payload to Flask /log
    const payload = {
      participant_id: (els.participantId?.value || "").trim(),
      medium: els.medium?.value || "SMS",
      input_method: els.inputMethod?.value || "",
      model_choice: els.model?.value || "",
      prompt_text: promptText,
      reply_text: replyText,
      prompt_style: promptStyle.label,
      reply_style: replyStyle.label,
      correction_applied: trial.correctionApplied,
      response_time_seconds: responseTime.toFixed(3),
      keypress_count: trial.keypressCount,
      backspace_count: trial.backspaceCount,
      paste_used: trial.pasteUsed ? "yes" : "no",
      correction_manual: els.manualCorrection?.checked ? "yes" : "no",
      notes: (els.notes?.value || "").trim(),
      reply_tb_polarity: tbPol,
      reply_tb_subjectivity: tbSub,
      reply_vader_compound: vaderComp ?? "",
    };

    try {
      await logTrial(payload);
    } catch {
      if (els.resultText) {
        els.resultText.textContent = "Analyzed OK, but failed to save to CSV.";
      }
      return;
    }

    // Keep browser copy too
    rows.push({
      timestamp: new Date().toISOString(),
      ...payload,
    });

    trial = resetTrialState();
    setReadyState("Saved. Ready for next trial.");
    updateMetricsLive();
    renderSentenceTable();
  });
}

// Download CSV from in-browser saved rows
if (els.downloadBtn) {
  els.downloadBtn.addEventListener("click", () => {
    if (rows.length === 0) {
      alert("No trials saved yet.");
      return;
    }

    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sentiment_log_web.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

// Convert array of objects into CSV text
function rowsToCsv(data) {
  const headers = Object.keys(data[0]);
  const lines = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((h) => csvEscape(String(row[h] ?? ""))).join(",")
    ),
  ];
  return lines.join("\n");
}

// Escape CSV cell text
function csvEscape(value) {
  if (value.includes('"')) value = value.replaceAll('"', '""');
  if (/[,"\n]/.test(value)) return `"${value}"`;
  return value;
}

// Very simple sentence split
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Rebuild the sentence breakdown table
function renderSentenceTable() {
  if (!els.sentenceTableWrap) return;

  const promptBody = getPromptBodyOnly();
  const replyBody = getActiveReplyText();

  const promptS = splitSentences(promptBody);
  const replyS = splitSentences(replyBody);

  const promptRows = promptS.map((s, i) => {
    const c = classifyStyle(s);
    return `<tr>
      <td>prompt</td>
      <td>${i + 1}</td>
      <td>${escapeHtml(s)}</td>
      <td><span class="tag ${c.label}">${c.label}</span></td>
    </tr>`;
  }).join("");

  const replyRows = replyS.map((s, i) => {
    const c = classifyStyle(s);
    return `<tr>
      <td>reply</td>
      <td>${i + 1}</td>
      <td>${escapeHtml(s)}</td>
      <td><span class="tag ${c.label}">${c.label}</span></td>
    </tr>`;
  }).join("");

  els.sentenceTableWrap.innerHTML = `
    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>#</th>
            <th>Sentence</th>
            <th>Rule label</th>
          </tr>
        </thead>
        <tbody>
          ${promptRows}
          ${replyRows}
        </tbody>
      </table>
    </div>
  `;
}

// Safe HTML escape
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Keep metrics ticking
setInterval(updateMetricsLive, 120);

// Initial UI setup
renderSentenceTable();
updateMetricsLive();
setReadyState("Waiting for you to start typing…");
showLayout(els.medium?.value || "SMS");
checkServer();
