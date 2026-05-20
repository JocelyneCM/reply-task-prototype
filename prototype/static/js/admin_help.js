/**
 * Contextual help for the Relay research console (admin).
 * Wire-up: initAdminHelp() from initAdminUI in app.js.
 */
(function () {
  const ADMIN_HELP = {
    overview: {
      title: "Overview",
      body: `Quick snapshot of your study so far.

**What you see:** total log rows, how many participants have data, and simple charts (Messenger/Email first; legacy SMS if old rows exist).

**Typical use:** open at the start of a lab day to confirm logging is working, or after a session to spot obvious gaps.`,
    },
    session: {
      title: "Study session",
      body: `Run a live collection block with one participant at a time.

**Workflow:** set Participant ID → set the active task (medium, input, prompts) → **Save plan** → send the participant link. Open phones pick up task changes within a few seconds without reopening the link.

**Common mistake:** editing the task but forgetting **Save plan** — the participant will keep the old task until you save.`,
    },
    "session-participant": {
      title: "Participant ID",
      body: `The ID ties everything together (logs, session plan, exports).

Use the same code on every link for that person (e.g. **P006**). You can type a new ID or pick an existing one from suggestions.

**Common mistake:** one participant using two different IDs — their data will look split across two people.`,
    },
    "session-active-task": {
      title: "Active task",
      body: `These fields define what the participant should do **right now** (current task number in the plan).

Change them between trials, then **Save plan**. For a single repeated condition, you can keep one row in the full task list and only edit here.`,
    },
    "session-prompt-condition": {
      title: "Prompt condition",
      body: `Controls formal vs informal vs auto for **this task**.

- **auto** — the system may infer style when the message is logged  
- **formal** / **informal** — force that tag on participant rows for this task  

Saved in CSV as \`prompt_formality\`. This is separate from the Prompt library’s default condition.`,
    },
    "session-prompt-pick": {
      title: "Prompt pick",
      body: `How the opening message is chosen for this task:

- **Random from library** — next active prompt from the library (fair rotation)  
- **Specific library prompt** — always use one preset ID you choose  

Does not edit the library itself — only this participant’s current task.`,
    },
    "session-library-prompt": {
      title: "Library prompt",
      body: `Pick which saved preset to use when **Prompt pick** = Specific library prompt.

The list shows **active** library prompts. Inactive ones are hidden from random picks too.

After changing this, click **Save plan** so live participant pages update.`,
    },
    "session-save-plan": {
      title: "Save plan",
      body: `Writes the task list and current task index to the server for this participant.

**Always click Save** after changing medium, input method, device, or prompts. **Advance task** moves to the next row in the full task list (multi-task protocols).`,
    },
    "session-live-update": {
      title: "Live updates",
      body: `Participant pages poll the server every few seconds. When you **Save plan**, open sessions with the same Participant ID apply the new task automatically.

They do **not** need a new link unless you change URL parameters on purpose (e.g. a one-off text_prompt_id in the link bar).`,
    },
    "session-phone-mic": {
      title: "Phone microphone & voice-to-text",
      body: `**Short answer:** On phones, voice-to-text almost always needs an **https://** link. Normal lab **http://192.168.x.x** links cannot reliably open the mic — that is a **browser security rule**, not a Relay bug.

**What works on HTTP LAN:** typing and swipe typing on phones and laptops.

**What needs HTTPS (e.g. ngrok):** voice-to-text on a **phone** browser.

**Simple setup:**
1. Start Relay on the laptop: \`flask run --host=0.0.0.0 --port=8000\`
2. In another terminal: \`ngrok http 8000\`
3. Copy the **https://** forwarding URL
4. Open **admin** and build the participant link on that HTTPS host
5. Open that link on the phone (same participant_id as usual)

Laptop localhost (\`http://127.0.0.1\`) is treated as secure; Wi‑Fi IP addresses are not.

**Checklist:** Flask running → ngrok \`http 8000\` → copy **https://** URL → open admin on that URL → copy participant link → open on phone.`,
    },
    participants: {
      title: "Participants",
      body: `Directory built from **logged CSV rows** — not from session settings.

Use it to see who has data and how many rows. To change what someone sees live, use **Study session**, not this table.`,
    },
    trials: {
      title: "Log rows & charts",
      body: `Inspect individual messages and filter the log.

One **task** (a full exercise) usually creates **several rows** (participant message, AI reply, etc.). Use filters, then click a row for full detail.`,
    },
    "edit-traces": {
      title: "Keystrokes / edit traces",
      body: `Optional fine-grained typing traces when enabled for a session.

Browse and export JSON trace files. Most daily lab work stays in **Log rows** and CSV exports.`,
    },
    visualizations: {
      title: "Visualizations",
      body: `Quick charts from the same log data as CSV exports — for sanity checks and demos.

**Presets** = one-click common views. **Custom chart** = pick group-by (X), measure (Y), and chart style.

Charts are **display-only**; they do not change stored logs. For publication analysis, Jakob’s CSV workflow may still be primary.`,
    },
    "viz-filters": {
      title: "Chart filters",
      body: `Narrow which log rows go into the chart (same idea as Log rows filters).

- **Participant** — one person or everyone  
- **Medium / input method / prompt condition** — slice the study  
- **Include AI-generated rows** — turn on to count assistant/LLM rows; off = participant rows only  

Click **Update chart** after changing filters.`,
    },
    "viz-custom": {
      title: "Custom chart",
      body: `Build a simple chart from logged fields:

- **Group by (X)** — what each bar/slice represents (medium, input method, day, etc.)  
- **Measure (Y)** — row count or average response time  
- **Chart style** — bar, line (best for dates), or doughnut (counts only)  

**Limits:** only safe, known columns — not a full spreadsheet pivot. Wrong combos (e.g. average RT on doughnut) are blocked or simplified.`,
    },
    prompts: {
      title: "Prompts",
      body: `Two layers — don’t mix them up:

1. **Prompt library** — reusable message templates (Messenger/Email). Edit here for future tasks.  
2. **Study session** — which prompt this participant gets **now** (random vs specific + Save plan).  
3. **Next exercise override** (collapsed) — optional one-shot global queue; most labs use the library + session plan instead.`,
    },
    "prompts-library": {
      title: "Prompt library table",
      body: `All saved presets. Click a row to edit. **New prompt** clears the editor.

**Notes** = private reminders for researchers (not shown to participants). Not used in automatic analysis — use **Notes** instead of the old unused “Category” field.`,
    },
    "prompts-override": {
      title: "Next exercise override",
      body: `Optional **global** one-shot: the next participant who needs a new prompt gets this text once, then it clears.

Most studies rely on **Study session → Save plan** instead. Use override only for quick experiments.`,
    },
    exports: {
      title: "Exports",
      body: `Download CSV files for analysis in R, Excel, etc.

**Study export** = simplified columns for common paper tables. **Raw export** = full detail. Filter by participant when you only need one person.`,
    },
    about: {
      title: "About",
      body: `What Relay records, how response time is defined, and metric caveats.

Read this once when training new researchers. Expand subsections for typing metrics and formality model details.`,
    },
  };

  function markdownLiteToHtml(text) {
    const escaped = String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function renderMicHelpActionsHtml() {
    return `<div class="pex-help-dialog-links">
      <a href="https://ngrok.com/download" class="pex-btn-ghost pex-btn-ghost--compact" target="_blank" rel="noopener noreferrer">Open ngrok download</a>
      <a href="https://dashboard.ngrok.com/get-started/setup" class="pex-btn-ghost pex-btn-ghost--compact" target="_blank" rel="noopener noreferrer">ngrok setup guide</a>
    </div>`;
  }

  function openHelp(id) {
    const dialog = document.getElementById("pexHelpDialog");
    const titleEl = document.getElementById("pexHelpDialogTitle");
    const bodyEl = document.getElementById("pexHelpDialogBody");
    const actionsEl = document.getElementById("pexHelpDialogActions");
    if (!dialog || !titleEl || !bodyEl) return;
    const topic = ADMIN_HELP[id] || {
      title: "Help",
      body: "No help text is defined for this topic yet.",
    };
    titleEl.textContent = topic.title;
    bodyEl.innerHTML = markdownLiteToHtml(topic.body);
    if (actionsEl) {
      if (id === "session-phone-mic") {
        actionsEl.innerHTML = renderMicHelpActionsHtml();
        actionsEl.hidden = false;
      } else {
        actionsEl.innerHTML = "";
        actionsEl.hidden = true;
      }
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else {
      dialog.hidden = false;
      dialog.setAttribute("open", "");
    }
  }

  function closeHelp() {
    const dialog = document.getElementById("pexHelpDialog");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.hidden = true;
      dialog.removeAttribute("open");
    }
  }

  function initAdminHelp() {
    document.querySelectorAll("[data-help-id]").forEach((btn) => {
      if (btn.dataset.helpBound === "1") return;
      btn.dataset.helpBound = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHelp(btn.getAttribute("data-help-id") || "");
      });
    });
    const dialog = document.getElementById("pexHelpDialog");
    const closeBtn = document.getElementById("pexHelpDialogClose");
    if (closeBtn && closeBtn.dataset.helpBound !== "1") {
      closeBtn.dataset.helpBound = "1";
      closeBtn.addEventListener("click", () => closeHelp());
    }
    if (dialog && dialog.dataset.helpBound !== "1") {
      dialog.dataset.helpBound = "1";
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) closeHelp();
      });
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        closeHelp();
      });
    }
    function bindMicHelpBtn(el) {
      if (!el || el.dataset.helpBound === "1") return;
      el.dataset.helpBound = "1";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        openHelp("session-phone-mic");
      });
    }
    bindMicHelpBtn(document.getElementById("sessionPhoneMicHelpBtn"));
    bindMicHelpBtn(document.getElementById("sessionPhoneMicQuickBtn"));
  }

  window.ADMIN_HELP = ADMIN_HELP;
  window.initAdminHelp = initAdminHelp;
  window.openAdminHelp = openHelp;
})();
