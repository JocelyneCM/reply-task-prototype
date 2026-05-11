"""
LLM prompt construction for /api/generate_reply.

Keeps wording and control flow aligned with prototype.server.api_generate_reply
so behavior stays identical when strings are edited here only.
"""

from __future__ import annotations

from typing import Callable, Tuple

OPENAI_CHAT_MODEL = "gpt-3.5-turbo"


def _compute_desired_style(
    prompt_text: str,
    target_formality: str,
    classify_style_fn: Callable[[str], str],
) -> str:
    inferred_prompt_style = classify_style_fn(prompt_text)
    return (target_formality or inferred_prompt_style or "neutral").strip().lower()


def build_openai_generate_reply_system_and_user_content(
    prompt_text: str,
    user_reply: str,
    target_formality: str,
    classify_style_fn: Callable[[str], str],
) -> Tuple[str, str]:
    desired_style = _compute_desired_style(
        prompt_text, target_formality, classify_style_fn
    )
    system = (
        "You write ONE short follow-up: generated_reply.\n\n"
        "Definitions (never swap):\n"
        "- original_message = Alex's first message TO the participant (what Alex asked for).\n"
        "- user_reply = the participant's reply TO Alex.\n"
        "- generated_reply = Alex's NEXT message back — you output only this.\n\n"
        "Context rule: Stay inside the same request Alex started. If Alex asked the participant to review, "
        "send feedback, confirm, or act by a time, then user_reply is their answer to THAT request. "
        "Alex should acknowledge their answer briefly (e.g. thanks, sounds good, see you then) and lightly "
        "close or nudge the thread—not invent a new task, and not flip who is asking whom.\n\n"
        "Role guard: The work or deliverable in the scenario is consistent with Alex's message. "
        "Do NOT write as if the participant had just asked Alex to send them the same plan/document "
        "Alex had asked the participant to look at (e.g. avoid “I’ll send it over to you now” when Alex "
        "had asked them for review). Do NOT sound like a generic assistant helping the participant with the app.\n\n"
        "Match tone and formality of original_message. One or two short sentences."
    )
    user_content = (
        "<original_message>\n"
        f"{prompt_text}\n"
        "</original_message>\n\n"
        "<user_reply>\n"
        f"{user_reply}\n"
        "</user_reply>\n\n"
        "Write generated_reply as plain text only — Alex responding directly to user_reply in the situation "
        "set up by original_message. If they agreed to help (e.g. \"yes, no worries\"), a good Alex reply is "
        "short gratitude or confirmation, not offering to email them materials they were supposed to review."
    )
    if desired_style:
        user_content += f"\nOverall style/register hint: {desired_style}"
    if target_formality:
        user_content += f"\nDesired formality hint: {target_formality}"
    return system, user_content


def build_fallback_reply_text(
    prompt_text: str,
    target_formality: str,
    classify_style_fn: Callable[[str], str],
) -> str:
    desired_style = _compute_desired_style(
        prompt_text, target_formality, classify_style_fn
    )
    if desired_style == "formal":
        return (
            "Thank you for your reply. If there is one brief detail you could add, "
            "that would help me wrap this up."
        )
    if desired_style == "informal":
        return (
            "Sounds good — thanks. One quick thing and we can leave it there."
        )
    return (
        "Thanks for that. Anything else you want to add before we leave it here?"
    )
