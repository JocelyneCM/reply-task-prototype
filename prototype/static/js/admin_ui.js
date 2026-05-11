// Admin UI helpers separated from app.js to keep app.js responsibilities smaller.

function resolveAudioSrc(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  if (/^https?:\/\//i.test(n)) return n;
  if (n.startsWith("/static/audio/")) return n;
  if (n.startsWith("static/audio/")) return "/" + n;
  const base = n.split("/").pop() || n;
  return "/static/audio/" + encodeURIComponent(base);
}

function buildTrialDetailHtml(row) {
  if (!row) return "";
  const imethod = String(row.input_method || "");
  const showLlm =
    String(row.llm_provider || "").trim() !== "" || imethod === "LLM";
  const pidDisp = escapeHtml(displayParticipantId(row.participant_id || ""));
  const pidRaw = escapeHtml(row.participant_id || "");
  const reply = (row.reply_text || "").trim();
  const prompt = (row.prompt_text || "").trim();
  const audioName = (row.audio_filename || "").trim();
  const audioSrc = resolveAudioSrc(audioName);
  const trans = (row.transcript || "").trim();
  const analysisStatus = (row.reply_analysis_status || "").trim();
  const analysisBasis = (row.reply_analysis_basis || "").trim();
  const transcriptStatus = (row.transcript_status || "").trim();
  const transcriptSource = (row.transcript_source || "").trim();

  const rowType =
    imethod === "LLM"
      ? "Generated (AI assistant)"
      : (row.row_role && String(row.row_role).trim())
        ? String(row.row_role)
        : "Participant";

  const llmDd = showLlm
    ? `<dt>LLM provider</dt><dd>${escapeHtml(row.llm_provider || "—")}</dd>`
    : "";

  const audioBlock =
    audioName &&
    `<h3 class="pex-admin-detail-subhd">Audio</h3>
    <audio class="pex-admin-audio" controls preload="metadata" src="${escapeHtml(audioSrc)}"></audio>
    <p class="small" style="margin-top:8px;color:var(--muted)">${escapeHtml(audioName)}</p>`;

  const transBlock =
    trans &&
    `<h3 class="pex-admin-detail-subhd">Transcript</h3>
    <p class="pex-admin-detail-text">${escapeHtml(trans)}</p>`;
  const voiceNoTrans =
    !trans &&
    row.medium === "Voice" &&
    `<p class="small"><em>No transcript stored.</em></p>`;

  const html = `
    <div class="pex-admin-detail-block">
      <h3>Row</h3>
      <dl class="pex-admin-detail-meta">
        <dt>Time</dt><dd>${escapeHtml(row.timestamp || "")}</dd>
        <dt>Participant</dt><dd title="${pidRaw ? `Logged ID: ${pidRaw}` : ""}">${pidDisp}</dd>
        <dt>Medium</dt><dd>${escapeHtml(row.medium || "")}</dd>
        <dt>Input method</dt><dd>${escapeHtml(imethod)}</dd>
        <dt>Row type</dt><dd>${escapeHtml(String(rowType))}</dd>
        ${llmDd}
      </dl>
    </div>
    <div class="pex-admin-detail-block">
      <h3>Prompt</h3>
      <p class="pex-admin-detail-text">${prompt ? escapeHtml(prompt) : "<em class='small'>—</em>"}</p>
    </div>
    <div class="pex-admin-detail-block">
      <h3>Reply text</h3>
      <p class="pex-admin-detail-text">${reply ? escapeHtml(reply) : "<em class='small'>—</em>"}</p>
    </div>
    <div class="pex-admin-detail-block">
      <h3>Timing &amp; behaviour</h3>
      <dl class="pex-admin-detail-meta">
        <dt>Response time (s)</dt><dd>${escapeHtml(String(row.response_time_seconds ?? ""))}</dd>
        <dt>Words per minute</dt><dd>${escapeHtml(String(row.words_per_minute ?? ""))}</dd>
        <dt>Keystrokes</dt><dd>${escapeHtml(String(row.keypress_count ?? ""))}</dd>
        <dt>Backspaces</dt><dd>${escapeHtml(String(row.backspace_count ?? ""))}</dd>
        <dt>Paste</dt><dd>${escapeHtml(row.paste_used || "")}</dd>
        <dt>Correction</dt><dd>${escapeHtml(row.correction_applied || "")}</dd>
      </dl>
    </div>
    <div class="pex-admin-detail-block">
      <h3>Formality model</h3>
      <dl class="pex-admin-detail-meta">
        <dt>Register</dt><dd>${escapeHtml(
          typeof displayFormalityRegisterLabel === "function"
            ? displayFormalityRegisterLabel(row.formality_label)
            : String(row.formality_label || "—")
        )}</dd>
        <dt>Confidence</dt><dd>${escapeHtml(String(row.formality_confidence ?? ""))}</dd>
      </dl>
      <div style="margin-top:10px">
        <button type="button" class="pex-admin-table-action" id="adminDeleteTrialBtn">Delete this trial…</button>
      </div>
    </div>
    <details class="pex-admin-advanced">
      <summary>Advanced (raw model codes, transcripts, exploratory sentiment)</summary>
      <div class="pex-admin-detail-block">
        <h3 class="pex-admin-detail-subhd">Formality model (raw)</h3>
        <dl class="pex-admin-detail-meta">
          <dt>Model label code</dt><dd>${escapeHtml(row.formality_label || "—")}</dd>
        </dl>
        <h3 class="pex-admin-detail-subhd">Participant</h3>
        <dl class="pex-admin-detail-meta">
          <dt>Logged ID</dt><dd>${pidRaw}</dd>
        </dl>
        ${transBlock || voiceNoTrans || ""}
        ${audioBlock || ""}
        <h3 class="pex-admin-detail-subhd">BERT sentiment (exploratory)</h3>
        <dl class="pex-admin-detail-meta">
          <dt>Normalized label</dt><dd>${escapeHtml(normalizeBertLabel(row.bert_label || ""))}</dd>
          <dt>Raw</dt><dd>${escapeHtml(row.bert_raw || row.bert_label || "")}</dd>
          <dt>Confidence</dt><dd>${escapeHtml(String(row.bert_confidence ?? ""))}</dd>
        </dl>
        <h3 class="pex-admin-detail-subhd">Heuristics</h3>
        <dl class="pex-admin-detail-meta">
          <dt>Prompt style / register (rules)</dt><dd>${escapeHtml(row.prompt_style || "")}</dd>
          <dt>Reply style / register (rules)</dt><dd>${escapeHtml(row.reply_style || "")}</dd>
          <dt>Prompt tone (tag)</dt><dd>${escapeHtml(row.prompt_tone || "")}</dd>
          <dt>Prompt seriousness (tag)</dt><dd>${escapeHtml(row.prompt_seriousness || "")}</dd>
          <dt>Prompt formality (tag)</dt><dd>${escapeHtml(row.prompt_formality || "")}</dd>
          <dt>reply_analysis_status</dt><dd>${escapeHtml(analysisStatus || "")}</dd>
          <dt>reply_analysis_basis</dt><dd>${escapeHtml(analysisBasis || "")}</dd>
          <dt>transcript_status</dt><dd>${escapeHtml(transcriptStatus)}</dd>
          <dt>transcript_source</dt><dd>${escapeHtml(transcriptSource)}</dd>
        </dl>
      </div>
    </details>
  `;

  return html;
}
