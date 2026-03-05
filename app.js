// Web prototype (front-end)
// - Logs timing + typing behaviour
// - Calls Flask for sentiment (/analyze) + saving to CSV (/log)
// Acronyms:
// - CSV = Comma-Separated Values (spreadsheet-like file)
// - SVM = Support Vector Machine (ML classifier) - placeholder here

const els = {
  medium: document.getElementById("medium"),
  inputMethod: document.getElementById("inputMethod"),
  model: document.getElementById("model"),
  notes: document.getElementById("notes"),

  readyPill: document.getElementById("readyPill"),
  statusText: document.getElementById("statusText"),
  serverPill: document.getElementById("serverPill"),

  timeVal: document.getElementById("timeVal"),
  keysVal: document.getElementById("keysVal"),
  backsVal: document.getElementById("backsVal"),
  pasteVal: document.getElementById("pasteVal"),

  manualCorrection: document.getElementById("manualCorrection"),
  corrStatus: document.getElementById("corrStatus"),

  analyzeBtn: document.getElementById("analyzeBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),

  resultText: document.getElementById("resultText"),
  sentenceTableWrap: document.getElementById("sentenceTableWrap"),

  // layouts
  layoutSMS: document.getElementById("layoutSMS"),
  layoutEmail: document.getElementById("layoutEmail"),
  layoutMessenger: document.getElementById("layoutMessenger"),

  // SMS inputs
  promptSMS: document.getElementById("promptSMS"),
  replySMS: document.getElementById("replySMS"),

  // Email inputs
  emailFrom: document.getElementById("emailFrom"),
  emailSubject: document.getElementById("emailSubject"),
  promptEmail: document.getElementById("promptEmail"),
  emailTo: document.getElementById("emailTo"),
  replyEmailSubject: document.getElementById("replyEmailSubject"),
  replyEmail: document.getElementById("replyEmail"),

  // Messenger inputs
  promptMsg: document.getElementById("promptMsg"),
  replyMsg: document.getElementById("replyMsg"),
};

// --- trial state ---
let trial = resetTrialState();
let rows = []; // browser copy for "Download CSV"

function resetTrialState() {
  return {
    startedAtMs: null,
    keypressCount: 0,
    backspaceCount: 0,
    pasteUsed: false,
  };
}

function nowMs() {
  return performance.now();
}

function secondsBetween(a, b) {
  return Math.max(0, (b - a) / 1000);
}

function setReadyState(text) {
  els.readyPill.textContent = "Ready";
  els.statusText.textContent = text;
}

function setRunningState(text) {
  els.readyPill.textContent = "Running";
  els.statusText.textContent = text;
}

function updateMetricsLive() {
  if (trial.startedAtMs == null) {
    els.timeVal.textContent = "0.000";
  } else {
    els.timeVal.textContent = secondsBetween(trial.startedAtMs, nowMs()).toFixed(3);
  }
  els.keysVal.textContent = String(trial.keypressCount);
  els.backsVal.textContent = String(trial.backspaceCount);
  els.pasteVal.textContent = trial.pasteUsed ? "yes" : "no";
}

function getActiveReplyEl() {
  const m = els.medium.value;
  if (m === "SMS") return els.replySMS;
  if (m === "Email") return els.replyEmail;
  return els.replyMsg;
}

function getActivePromptText() {
  const m = els.medium.value;
  if (m === "SMS") {
    return (els.promptSMS.value || "").trim();
  }
  if (m === "Email") {
    const from = (els.emailFrom.value || "").trim();
    const subj = (els.emailSubject.value || "").trim();
    const body = (els.promptEmail.value || "").trim();
    return `From: ${from}\nSubject: ${subj}\n\n${body}`.trim();
  }
  // Messenger
  return (els.promptMsg.value || "").trim();
}

function getActiveReplyText() {
  const m = els.medium.value;
  if (m === "SMS") {
    return (els.replySMS.value || "").trim();
  }
  if (m === "Email") {
    const to = (els.emailTo.value || "").trim();
    const subj = (els.replyEmailSubject.value || "").trim();
    const body = (els.replyEmail.value || "").trim();
    return `To: ${to}\nSubject: ${subj}\n\n${body}`.trim();
  }
  // Messenger
  return (els.replyMsg.value || "").trim();
}

function showLayout(medium) {
  document.body.dataset.medium = medium;

  els.layoutSMS.classList.toggle("hidden", medium !== "SMS");
  els.layoutEmail.classList.toggle("hidden", medium !== "Email");
  els.layoutMessenger.classList.toggle("hidden", medium !== "Messenger");

  // reset timing when switching medium so trials don't mix
  trial = resetTrialState();
  updateMetricsLive();
  setReadyState("Medium changed. Ready for a new trial.");
  renderSentenceTable();
}

// attach typing listeners to all reply boxes
function attachReplyListeners(textarea) {
  textarea.addEventListener("keydown", (e) => {
    // only track if this is the currently active reply box
    if (textarea !== getActiveReplyEl()) return;

    if (trial.startedAtMs == null) {
      trial.startedAtMs = nowMs();
      setRunningState("Timing started (first keypress in reply).");
    }

    trial.keypressCount += 1;

    if (e.key === "Backspace") trial.backspaceCount += 1;

    updateMetricsLive();
  });

  textarea.addEventListener("paste", () => {
    if (textarea !== getActiveReplyEl()) return;
    trial.pasteUsed = true;
    updateMetricsLive();
  });

  textarea.addEventListener("input", () => {
    if (textarea !== getActiveReplyEl()) return;
    renderSentenceTable();
  });
}

attachReplyListeners(els.replySMS);
attachReplyListeners(els.replyEmail);
attachReplyListeners(els.replyMsg);

// prompt inputs update sentence table too
[els.promptSMS, els.promptEmail, els.promptMsg].forEach((t) => {
  t.addEventListener("input", renderSentenceTable);
});

// manual correction toggle
els.manualCorrection.addEventListener("change", () => {
  els.corrStatus.textContent = els.manualCorrection.checked
    ? "Correction: user says they corrected"
    : "Correction: none";
});

// live timer refresh
setInterval(updateMetricsLive, 120);

// medium change
els.medium.addEventListener("change", () => showLayout(els.medium.value));

// reset trial
els.resetBtn.addEventListener("click", () => {
  trial = resetTrialState();

  // clear only the active reply box (keeps prompt so you can reuse it)
  const replyEl = getActiveReplyEl();
  replyEl.value = "";

  els.notes.value = "";
  els.manualCorrection.checked = false;
  els.corrStatus.textContent = "Correction: none";

  els.resultText.textContent = "Results will appear here after you click Analyze + Save.";
  setReadyState("Trial reset. Waiting for you to start typing…");
  updateMetricsLive();
  renderSentenceTable();
});

// ---------- Flask calls ----------
async function checkServer() {
  try {
    const res = await fetch("/health");
    if (!res.ok) throw new Error("health not ok");
    const data = await res.json();

    els.serverPill.textContent = data.vader_ok ? "OK (VADER ready)" : "OK (no VADER)";
    els.serverPill.classList.remove("subtle");
    return true;
  } catch (e) {
    els.serverPill.textContent = "Not running";
    els.serverPill.classList.add("subtle");
    return false;
  }
}

async function analyzeReply(replyText) {
  const res = await fetch("/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply_text: replyText }),
  });

  if (!res.ok) throw new Error("Analyze failed");
  return await res.json();
}

async function logTrial(payload) {
  const res = await fetch("/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("Log failed");
  return await res.json();
}

// Analyze + Save
els.analyzeBtn.addEventListener("click", async () => {
  const promptText = getActivePromptText();
  const replyText = getActiveReplyText();

  if (!replyText) {
    alert("Please type a reply first.");
    return;
  }

  // end time on click
  const endMs = nowMs();
  const startMs = trial.startedAtMs ?? endMs;
  const responseTime = secondsBetween(startMs, endMs);

  // SVM placeholder behaviour
  if (els.model.value === "SVM (TODO)") {
    alert("SVM is not implemented yet. For now this logs TextBlob/VADER via Flask.");
  }

  let analysis;
  try {
    analysis = await analyzeReply(replyText);
  } catch (e) {
    els.resultText.textContent =
      "Could not analyze. Is the Flask server running? (Run: python3 server.py)";
    return;
  }

  // show result
  const tbPol = Number(analysis.reply_tb_polarity ?? 0);
  const tbSub = Number(analysis.reply_tb_subjectivity ?? 0);
  const vaderComp = analysis.reply_vader_compound;

  let resultLine =
    `TextBlob: polarity=${tbPol.toFixed(3)}, subjectivity=${tbSub.toFixed(3)}`;

  if (vaderComp !== null && vaderComp !== undefined && vaderComp !== "") {
    resultLine += ` | VADER: compound=${Number(vaderComp).toFixed(3)}`;
  } else {
    resultLine += " | VADER: not available";
  }

  els.resultText.textContent = resultLine;

  // payload for server CSV
  const payload = {
    medium: els.medium.value,
    input_method: els.inputMethod.value,
    model_choice: els.model.value,
    prompt_text: promptText,
    reply_text: replyText,

    response_time_seconds: responseTime.toFixed(3),
    keypress_count: trial.keypressCount,
    backspace_count: trial.backspaceCount,
    paste_used: trial.pasteUsed ? "yes" : "no",
    correction_manual: els.manualCorrection.checked ? "yes" : "no",
    notes: (els.notes.value || "").trim(),

    reply_tb_polarity: tbPol,
    reply_tb_subjectivity: tbSub,
    reply_vader_compound: vaderComp ?? "",
  };

  // log server-side
  try {
    await logTrial(payload);
  } catch (e) {
    els.resultText.textContent =
      "Analyzed OK, but failed to save to CSV (server log endpoint failed).";
    return;
  }

  // also keep browser copy for Download CSV
  rows.push({
    timestamp: new Date().toISOString(),
    ...payload,
  });

  // reset timing for next trial but keep text on screen
  trial = resetTrialState();
  setReadyState("Saved. Ready for next trial.");
  updateMetricsLive();
  renderSentenceTable();
});

// Download CSV (browser copy)
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

// CSV helpers
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

function csvEscape(value) {
  if (value.includes('"')) value = value.replaceAll('"', '""');
  if (/[,"\n]/.test(value)) return `"${value}"`;
  return value;
}

// sentence breakdown (simple split)
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderSentenceTable() {
  const promptS = splitSentences(getActivePromptText());
  const replyS = splitSentences(getActiveReplyText());

  const html = `
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>#</th>
          <th>Sentence</th>
          <th>Sentiment</th>
        </tr>
      </thead>
      <tbody>
        ${promptS.map((s, i) => `<tr><td>prompt</td><td>${i + 1}</td><td>${escapeHtml(s)}</td><td>later</td></tr>`).join("")}
        ${replyS.map((s, i) => `<tr><td>reply</td><td>${i + 1}</td><td>${escapeHtml(s)}</td><td>later</td></tr>`).join("")}
      </tbody>
    </table>
  `;
  els.sentenceTableWrap.innerHTML = html;
}

function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// init
renderSentenceTable();
updateMetricsLive();
setReadyState("Waiting for you to start typing…");
showLayout(els.medium.value);
checkServer();