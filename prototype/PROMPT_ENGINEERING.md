Prompt engineering notes — Relay prototype
=======================================

Summary
-------
The server constructs an LLM call in `prototype/server.py` using a compact system message and a single user message that contains the prompt text and the participant's reply. The current system/user content is intentionally minimal:

- System: "You are a helpful assistant. Match the requested formality where possible."
- User: "Prompt: {prompt_text}\nUser reply: {user_reply}\nGenerate a single reply that continues the conversation." (+ optional "Desired formality: {target_formality}")

Findings
--------
- This approach is simple and effective for short continuation-style replies.
- The system instruction biases the model toward matching requested formality, but does not provide examples or explicit constraints (e.g., length, politeness, brevity).
- When `target_formality` is provided we append it verbatim. This helps guide outputs but relies on the LLM respecting a short instruction.

Recommendations
---------------
1. If you need stronger adherence to formality, consider a few-shot template with 2–3 examples showing desired formality transformations (informal → formal, formal → informal) and a short rubric (e.g., avoid slang, use full sentences).
2. Add explicit output constraints in the prompt: maximum length, whether to ask a follow-up question, and whether to sign off (useful for email-style replies).
3. Include a clarifying instruction when the participant reply is ambiguous: "If the user's reply is a question, provide a concise answer; if it's a statement, respond with a follow-up question." This reduces hallucination.
4. For reproducible experiments, record the exact prompt payload (system + messages) alongside the LLM response in the per-run CSV.

Example: stronger system + few-shot user message
------------------------------------------------
System:
```
You are a helpful assistant. Match the requested formality where possible. Prefer short, polite replies. Do not invent facts.
```

User (few-shot examples):
```
Example 1 — informal → formal
Prompt: "Can you look this over?"
User reply: "Yeah I'll check it out"
Desired formality: formal
Assistant: "Thank you — I'll review the document and send feedback by EOD."

Example 2 — formal → informal
Prompt: "Please let me know your availability."
User reply: "I am available tomorrow at 10am."
Desired formality: informal
Assistant: "That works — see you then!"

Now continue:
Prompt: {prompt_text}
User reply: {user_reply}
Desired formality: {target_formality}
```

Where to change in the code
---------------------------
- `prototype/server.py` — the system string and user message are defined near the `api_generate_reply` handler. Edit them to adopt any of the above recommendations.
- The server logs the final payload and response; ensure you persist the exact `messages` array if you need full experiment reproducibility.

Notes
-----
- The current implementation intentionally returns an explicit error when the LLM provider is not configured or unreachable. This keeps behavior deterministic for experiments and avoids silent local fallbacks that would contaminate results.
