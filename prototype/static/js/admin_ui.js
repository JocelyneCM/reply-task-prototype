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
  const audioName = (row.audio_filename || "").trim();
  const audioSrc = resolveAudioSrc(audioName);
  const audioBlock = audioName
    ? `<div class="pex-admin-detail-block">
        <h3>Audio</h3>
        <audio class="pex-admin-audio" controls preload="metadata" src="${escapeHtml(audioSrc)}"></audio>
        <p class="small" style="margin-top:8px;color:var(--muted)">${escapeHtml(audioName)}</p>
      </div>`
    : "";

  const reply = (row.reply_text || "").trim();
  const trans = (row.transcript || "").trim();
  const prompt = (row.prompt_text || "").trim();
  const analysisStatus = (row.reply_analysis_status || "").trim();
  const analysisBasis = (row.reply_analysis_basis || "").trim();
  const transcriptStatus = (row.transcript_status || "").trim();
  const transcriptSource = (row.transcript_source || "").trim();
  const rowType = row.input_method === "LLM"
    ? "system/generated reply"
    : "participant response";

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

  const html = `
    <div class="pex-admin-detail-block">
      <h3>When &amp; who</h3>
      <dl class="pex-admin-detail-meta">
        <dt>Timestamp</dt><dd>${escapeHtml(row.timestamp || "")}</dd>
        <dt>Participant</dt><dd>${escapeHtml(displayParticipantId(row.participant_id || ""))}</dd>
        <dt>Medium</dt><dd>${escapeHtml(row.medium || "")}</dd>
        <dt>Input</dt><dd>${escapeHtml(row.input_method || "")}</dd>
        <dt>LLM provider</dt><dd>${escapeHtml(row.llm_provider || "")}</dd>
        <dt>Row type</dt><dd>${escapeHtml(rowType)}</dd>
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
          <dt>Formality (model)</dt><dd>${escapeHtml(String(row.formality_label ?? ""))} (${escapeHtml(String(row.formality_confidence ?? ""))})</dd>
          <dt>Transcript status</dt><dd>${escapeHtml(transcriptStatus)}</dd>
          <dt>Transcript source</dt><dd>${escapeHtml(transcriptSource)}</dd>
          <dt>Prompt tone</dt><dd>${escapeHtml(row.prompt_tone || "")}</dd>
          <dt>Prompt seriousness</dt><dd>${escapeHtml(row.prompt_seriousness || "")}</dd>
          <dt>Prompt formality</dt><dd>${escapeHtml(row.prompt_formality || "")}</dd>
        </dl>
      </div>
    </details>
  `;

  return html;
}
