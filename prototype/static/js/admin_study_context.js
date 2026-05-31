/**
 * Admin server status + remote/ngrok guardrails (team URL in localStorage).
 */
(function () {
  const STORAGE_TEAM_BASE = "relay_team_base_url";

  function readTeamBaseUrl() {
    try {
      return (localStorage.getItem(STORAGE_TEAM_BASE) || "").trim();
    } catch {
      return "";
    }
  }

  function writeTeamBaseUrl(url) {
    try {
      const v = String(url || "").trim().replace(/\/$/, "");
      if (v) localStorage.setItem(STORAGE_TEAM_BASE, v);
      else localStorage.removeItem(STORAGE_TEAM_BASE);
    } catch {
      /* ignore */
    }
  }

  function currentBaseUrl() {
    return `${window.location.origin}`.replace(/\/$/, "");
  }

  function schemeLabel(isSecure) {
    return isSecure
      ? "HTTPS (secure origin)"
      : "HTTP (typing/swipe OK; phone mic usually blocked)";
  }

  function hostMismatch(teamBase, current) {
    if (!teamBase || !current) return false;
    try {
      return new URL(teamBase).origin !== new URL(current).origin;
    } catch {
      return teamBase !== current;
    }
  }

  function updateAdminServerFooter(health) {
    const statusEl = document.getElementById("adminServerStatusPill");
    const hostEl = document.getElementById("adminServerHostLine");
    const schemeEl = document.getElementById("adminServerSchemeLine");
    const warnEl = document.getElementById("adminServerWarn");
    const apiPill = document.getElementById("serverPill");

    const base = currentBaseUrl();
    const isSecure =
      !!window.isSecureContext || !!(health && health.request_is_secure);
    const connected = health == null ? false : !!health.ok;

    if (statusEl) {
      statusEl.textContent = connected ? "Server connected" : "Server unreachable";
      statusEl.classList.toggle("is-ok", connected);
      statusEl.classList.toggle("is-bad", !connected);
    }

    if (hostEl) {
      hostEl.textContent = `This page: ${base}`;
      hostEl.title = "All researchers should use the same server URL during a study block.";
    }

    if (schemeEl) schemeEl.textContent = schemeLabel(isSecure);

    const hostIsLocal =
      health && Object.prototype.hasOwnProperty.call(health, "request_host_is_local")
        ? !!health.request_host_is_local
        : ["localhost", "127.0.0.1", "::1"].includes(
            String(window.location.hostname || "").toLowerCase()
          );
    const adminPasswordSet = !!(health && health.admin_password_set);
    const teamBase = readTeamBaseUrl();

    if (warnEl) {
      if (!hostIsLocal && !adminPasswordSet) {
        warnEl.hidden = false;
        warnEl.textContent =
          "This admin page is reachable through a non-local link. Set RELAY_ADMIN_PASSWORD before sharing widely.";
      } else if (teamBase && hostMismatch(teamBase, base)) {
        warnEl.hidden = false;
        warnEl.textContent = `Warning: team server is ${teamBase} but you are on ${base}. Data may split across servers.`;
      } else if (!teamBase) {
        warnEl.hidden = false;
        warnEl.textContent =
          'Tip: click "Set as team server" so everyone uses the same host during remote collection.';
      } else {
        warnEl.hidden = true;
        warnEl.textContent = "";
      }
    }

    if (apiPill && health) {
      if (health.whisper_ok) {
        apiPill.textContent = health.openai_configured
          ? "API OK · OpenAI"
          : "API OK · OpenAI missing";
      } else {
        const why = health.ffmpeg_ok === false ? "ffmpeg missing" : "whisper limited";
        apiPill.textContent = `API OK · ${why}`;
      }
    } else if (apiPill && !health) {
      apiPill.textContent = "API unreachable";
    }
  }

  function initAdminStudyContext() {
    const teamBtn = document.getElementById("adminSetTeamServerBtn");
    if (teamBtn && !teamBtn.dataset.bound) {
      teamBtn.dataset.bound = "1";
      teamBtn.addEventListener("click", () => {
        writeTeamBaseUrl(currentBaseUrl());
        updateAdminServerFooter({ ok: true, admin_password_set: false, request_host_is_local: false });
        teamBtn.textContent = "Team server saved ✓";
        setTimeout(() => {
          teamBtn.textContent = "Set as team server";
        }, 2000);
      });
    }
    updateAdminServerFooter({ ok: true });
  }

  window.initAdminStudyContext = initAdminStudyContext;
  window.updateAdminServerFooter = updateAdminServerFooter;
})();
