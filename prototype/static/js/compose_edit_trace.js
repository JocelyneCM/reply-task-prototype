/**
 * Bounded compose-field tracing in three layers:
 * 1) key_events — browser keyboard/pointer-related signals (not full content logging).
 * 2) text_mutations — DOM input / value-diff / voice transcript / composition (bounded).
 * 3) snapshots — value fingerprints (hash/len/prefix), throttled.
 *
 * schema_version 1 traces used a single `events` array; v2 uses the three layers.
 */
(function () {
  const SCHEMA_VERSION = 2;

  const KEY_EVENT_CAP = 220;
  const TEXT_MUTATION_CAP = 120;
  const SNAPSHOT_CAP = 40;
  const SAMPLE_PREFIX_LEN = 48;
  const REVISION_MIN_DELTA = 2;
  const COMPOSITION_UPDATE_THROTTLE_MS = 160;
  const LEGACY_EVENT_CAP = 200;

  const DISCLAIMERS = [
    "Free-text replies have no gold target; metrics describe edit/revision behaviour, not true error rate.",
    "Voice-to-text: key_events reflect manual edits after transcript only; speech production is not in key_events. voice_transcript_insert marks the first transcript layer in text_mutations (one marker per session).",
    "voice_transcript_marker and manual_edit_chars_after_transcript_est compare the final sent text to the first inserted transcript string in that trace session (re-dictation does not replace that anchor).",
    "inserted_chars_est and deleted_chars_est are cumulative sums of greedy per-step deltas on the active compose field only; they measure edit churn, not unique keystrokes and not a copy-typing error count.",
    "Swipe typing: browser key/input events are approximate and not comparable to one-keystroke-per-character typing.",
    "Single-character data_char on insertText is stored only when length===1 for mutation–key linkage, not as full content logging.",
  ];

  function fnv1a32Hex(str) {
    let h = 0x811c9dc5;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function hashSample(s) {
    const t = String(s ?? "");
    return {
      len: t.length,
      hash: fnv1a32Hex(t),
      sample_prefix: t.slice(0, SAMPLE_PREFIX_LEN),
    };
  }

  /** Greedy prefix/suffix strip; middle treated as replace block (rough insert/delete). */
  function roughInsertDelete(oldStr, newStr) {
    const a = String(oldStr ?? "");
    const b = String(newStr ?? "");
    let i = 0;
    const al = a.length;
    const bl = b.length;
    while (i < al && i < bl && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    let ei = al - 1;
    let ej = bl - 1;
    while (ei >= i && ej >= i && a.charCodeAt(ei) === b.charCodeAt(ej)) {
      ei--;
      ej--;
    }
    const deleted = ei >= i ? ei - i + 1 : 0;
    const inserted = ej >= i ? ej - i + 1 : 0;
    return { inserted, deleted };
  }

  function selectionSlice(ta) {
    if (!ta || typeof ta.selectionStart !== "number") return {};
    try {
      return {
        selectionStart: ta.selectionStart,
        selectionEnd: ta.selectionEnd,
      };
    } catch {
      return {};
    }
  }

  class ComposeEditTraceTracker {
    constructor() {
      this._boxes = new Set();
      this._lastByEl = new WeakMap();
      this._mediumByEl = new WeakMap();
      this._detach = [];
      this.reset();
    }

    reset() {
      this.logRowId = null;
      this.sessionMedium = "";
      this.sessionInputMethod = "";
      this.key_events = [];
      this.text_mutations = [];
      this.snapshots = [];
      this._snapshotCount = 0;
      this._insTotal = 0;
      this._delTotal = 0;
      this._revisionEpisodes = 0;
      this._initialLen = 0;
      this._voiceTranscript = null;
      this._voiceTranscriptAtMs = null;
      this._startedAtMs = null;
      this._perfBase = typeof performance !== "undefined" ? performance.now() : 0;
      this._lastSnapshotAt = 0;
      this._lastCompUpdateAt = 0;
    }

    _tRel() {
      if (typeof performance === "undefined") return 0;
      return Math.round(performance.now() - this._perfBase);
    }

    attachTextareas(smsEl, msgEl, emailEl) {
      const pairs = [
        [smsEl, "SMS"],
        [msgEl, "Messenger"],
        [emailEl, "Email"],
      ].filter(([el]) => el);
      this.detach();
      for (const [el, medium] of pairs) {
        this._boxes.add(el);
        this._mediumByEl.set(el, medium);
        this._lastByEl.set(el, "");

        const onBeforeInput = (e) => {
          if (this.text_mutations.length >= TEXT_MUTATION_CAP) return;
          const it = (e && e.inputType) || "";
          let data_len = 0;
          try {
            if (e && typeof e.data === "string") data_len = e.data.length;
          } catch {
            data_len = 0;
          }
          this._pushTextMutation({
            kind: "beforeinput",
            t: this._tRel(),
            inputType: String(it).slice(0, 64),
            data_len,
          });
        };

        const onPaste = (e) => {
          let approxLen = null;
          try {
            const txt = e && e.clipboardData && e.clipboardData.getData("text/plain");
            if (typeof txt === "string") approxLen = txt.length;
          } catch {
            approxLen = null;
          }
          this._pushKeyEvent({
            type: "paste",
            t: this._tRel(),
            approx_paste_char_len: approxLen,
          });
        };

        const onCut = () => {
          this._pushKeyEvent({
            type: "cut",
            t: this._tRel(),
          });
        };

        const onInput = (e) => {
          const ta = e.target;
          if (!ta || typeof ta.value !== "string") return;
          const isInputEvent =
            typeof InputEvent === "function" && e instanceof InputEvent;
          if (isInputEvent && this.text_mutations.length < TEXT_MUTATION_CAP) {
            const it = e.inputType != null ? String(e.inputType).slice(0, 64) : "";
            const d = e.data;
            let data_len = d == null || typeof d !== "string" ? 0 : d.length;
            const mut = {
              kind: "dom_input",
              t: this._tRel(),
              inputType: it,
              data_len,
            };
            if (it === "insertText" && data_len === 1) {
              mut.data_char = String(d).slice(0, 1);
            }
            this._pushTextMutation(mut);
          }
          this._handleValueChange(ta, ta.value, isInputEvent ? "input" : "synthetic_input");
        };

        const onCompStart = () => {
          this._pushTextMutation({ kind: "compositionstart", t: this._tRel() });
        };

        const onCompUpdate = (e) => {
          const now = this._tRel();
          if (now - this._lastCompUpdateAt < COMPOSITION_UPDATE_THROTTLE_MS) return;
          this._lastCompUpdateAt = now;
          let composed_segment_len = 0;
          try {
            if (e && typeof e.data === "string") composed_segment_len = e.data.length;
          } catch {
            composed_segment_len = 0;
          }
          this._pushTextMutation({
            kind: "compositionupdate",
            t: now,
            composed_segment_len,
          });
        };

        const onCompEnd = (e) => {
          this._pushTextMutation({ kind: "compositionend", t: this._tRel() });
          // Value change is recorded on the following trusted `input` event to avoid
          // double-counting the same IME commit in metrics (compositionend + input).
        };

        const onKeydown = (e) => {
          this._pushKeyEvent({
            type: "keydown",
            t: this._tRel(),
            key: String(e.key || "").slice(0, 32),
            code: String(e.code || "").slice(0, 32),
            shiftKey: !!e.shiftKey,
            ctrlKey: !!e.ctrlKey,
            altKey: !!e.altKey,
            metaKey: !!e.metaKey,
            ...selectionSlice(e.target),
          });
        };

        const onKeyup = (e) => {
          this._pushKeyEvent({
            type: "keyup",
            t: this._tRel(),
            key: String(e.key || "").slice(0, 32),
            code: String(e.code || "").slice(0, 32),
            shiftKey: !!e.shiftKey,
            ctrlKey: !!e.ctrlKey,
            altKey: !!e.altKey,
            metaKey: !!e.metaKey,
            ...selectionSlice(e.target),
          });
        };

        el.addEventListener("beforeinput", onBeforeInput);
        el.addEventListener("paste", onPaste);
        el.addEventListener("cut", onCut);
        el.addEventListener("input", onInput);
        el.addEventListener("compositionstart", onCompStart);
        el.addEventListener("compositionupdate", onCompUpdate);
        el.addEventListener("compositionend", onCompEnd);
        el.addEventListener("keydown", onKeydown);
        el.addEventListener("keyup", onKeyup);
        this._detach.push(() => {
          el.removeEventListener("beforeinput", onBeforeInput);
          el.removeEventListener("paste", onPaste);
          el.removeEventListener("cut", onCut);
          el.removeEventListener("input", onInput);
          el.removeEventListener("compositionstart", onCompStart);
          el.removeEventListener("compositionupdate", onCompUpdate);
          el.removeEventListener("compositionend", onCompEnd);
          el.removeEventListener("keydown", onKeydown);
          el.removeEventListener("keyup", onKeyup);
        });
      }
    }

    detach() {
      for (const fn of this._detach) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
      this._detach = [];
      this._boxes.clear();
    }

    /**
     * SMS/Messenger: Enter alone triggers send (handled in app.js); call this right before synthetic send click.
     */
    recordSendTrigger(detail) {
      this._pushKeyEvent({
        type: "send",
        t: this._tRel(),
        source: String((detail && detail.source) || "enter_chat_submit").slice(0, 64),
        medium: String((detail && detail.medium) || "").slice(0, 32),
      });
    }

    startNewSession(meta) {
      this.reset();
      this.logRowId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `row_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      this.sessionMedium = (meta && meta.medium) || "";
      this.sessionInputMethod = (meta && meta.input_method) || "";
      this._startedAtMs = Date.now();
      this._perfBase = typeof performance !== "undefined" ? performance.now() : 0;
      this._pushTextMutation({
        kind: "trace_session",
        t: 0,
        medium: this.sessionMedium,
        input_method: this.sessionInputMethod,
        note: "session marker; not a text edit",
      });
    }

    noteVoiceTranscriptInserted(text) {
      const t = String(text || "");
      if (!t) return;
      for (const el of this._boxes) {
        if (el && typeof el.value === "string") this._lastByEl.set(el, el.value);
      }
      if (this._voiceTranscript != null && this._voiceTranscript !== "") {
        return;
      }
      this._voiceTranscript = t;
      this._voiceTranscriptAtMs = Date.now();
      this._pushTextMutation({
        kind: "voice_transcript_insert",
        t: this._tRel(),
        layer: "voice_transcript",
        marker: hashSample(t),
      });
    }

    noteSuggestionChipApplied() {
      this._pushTextMutation({
        kind: "suggestion_autocomplete_apply",
        t: this._tRel(),
        layer: "manual_ui",
      });
    }

    _pushKeyEvent(row) {
      if (this.key_events.length >= KEY_EVENT_CAP) return;
      this.key_events.push(row);
    }

    _pushTextMutation(row) {
      if (this.text_mutations.length >= TEXT_MUTATION_CAP) return;
      this.text_mutations.push(row);
    }

    _maybeSnapshot(value) {
      if (this._snapshotCount >= SNAPSHOT_CAP) return;
      const now = Date.now();
      if (now - this._lastSnapshotAt < 400 && this._snapshotCount > 0) return;
      this._lastSnapshotAt = now;
      this._snapshotCount++;
      this.snapshots.push({
        tMs: now,
        t_rel: this._tRel(),
        field: hashSample(value),
      });
    }

    _handleValueChange(el, newVal, sourceTag) {
      const prev = this._lastByEl.has(el) ? String(this._lastByEl.get(el) ?? "") : "";
      const next = String(newVal ?? "");
      const { inserted, deleted } = roughInsertDelete(prev, next);
      this._insTotal += inserted;
      this._delTotal += deleted;
      if (inserted + deleted >= REVISION_MIN_DELTA) this._revisionEpisodes += 1;
      this._lastByEl.set(el, next);
      this._pushTextMutation({
        kind: "value_diff",
        source: String(sourceTag).slice(0, 32),
        t: this._tRel(),
        ins: inserted,
        del: deleted,
        len: next.length,
      });
      this._maybeSnapshot(next);
    }

    finalize(options) {
      const finalText = String((options && options.finalText) ?? "");
      const medium = (options && options.medium) || this.sessionMedium || "";
      const inputMethod = (options && options.input_method) || this.sessionInputMethod || "";
      const rowRole = (options && options.row_role) || "participant_reply";
      const activeMedium = String((options && options.active_medium) || medium || "").trim();

      for (const el of this._boxes) {
        if (!el || typeof el.value !== "string") continue;
        const elMedium = this._mediumByEl.get(el);
        if (activeMedium && elMedium !== activeMedium) {
          continue;
        }
        const lv = this._lastByEl.get(el);
        if (lv !== finalText) {
          const prev = this._lastByEl.has(el) ? String(this._lastByEl.get(el) ?? "") : "";
          const { inserted, deleted } = roughInsertDelete(prev, finalText);
          this._insTotal += inserted;
          this._delTotal += deleted;
          if (inserted + deleted >= REVISION_MIN_DELTA) this._revisionEpisodes += 1;
          this._lastByEl.set(el, finalText);
          this._pushTextMutation({
            kind: "finalize_align",
            t: this._tRel(),
            ins: inserted,
            del: deleted,
            len: finalText.length,
            source: "finalize_active_field",
          });
        }
      }

      const netCharChange = finalText.length - this._initialLen;
      let voiceInitial = 0;
      let manualAfterVoice = 0;
      let voiceMarker = null;
      if (this._voiceTranscript != null) {
        voiceInitial = this._voiceTranscript.length;
        const d = roughInsertDelete(this._voiceTranscript, finalText);
        manualAfterVoice = d.inserted + d.deleted;
        voiceMarker = hashSample(this._voiceTranscript);
      }

      const metrics = {
        revision_count: this._revisionEpisodes,
        inserted_chars_est: this._insTotal,
        deleted_chars_est: this._delTotal,
        net_char_change: netCharChange,
        manual_edit_chars_after_transcript_est: manualAfterVoice,
        voice_transcript_initial_chars: voiceInitial,
        key_event_count: this.key_events.length,
        text_mutation_count: this.text_mutations.length,
        snapshot_count: this.snapshots.length,
      };

      const trace = {
        schema_version: SCHEMA_VERSION,
        log_row_id: this.logRowId,
        disclaimers: DISCLAIMERS,
        medium,
        input_method: inputMethod,
        row_role: rowRole,
        session_started_ms: this._startedAtMs,
        finalized_ms: Date.now(),
        voice_transcript_marker: voiceMarker,
        key_events: this.key_events.slice(0, KEY_EVENT_CAP),
        text_mutations: this.text_mutations.slice(0, TEXT_MUTATION_CAP),
        snapshots: this.snapshots.slice(0, SNAPSHOT_CAP),
        metrics,
      };

      return {
        log_row_id: this.logRowId,
        metrics,
        trace,
      };
    }
  }

  /** Legacy caps for unit tests / old clients posting schema_version 1. */
  ComposeEditTraceTracker.LEGACY_EVENT_CAP = LEGACY_EVENT_CAP;
  ComposeEditTraceTracker.SCHEMA_VERSION = SCHEMA_VERSION;

  globalThis.ComposeEditTraceTracker = ComposeEditTraceTracker;
})();
