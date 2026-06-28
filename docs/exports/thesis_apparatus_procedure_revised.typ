// Revised Apparatus + Procedure device wording (truthful: mixed personal and provided devices)

== Apparatus

The study was administered through a web-based application accessed in a standard browser on laptop and mobile devices. Sessions were held in everyday settings chosen at the time of participation (e.g., home, campus study areas, library) and were not conducted in a controlled usability laboratory.

Participants completed tasks on laptop and mobile hardware that was either their own or made available for the session by the researchers. Device assignment depended on what each participant had available; in some sessions, mobile tasks were completed on a researcher-provided phone when the participant did not use a personal device for that portion of the study. The application presented Messenger-style and Email-style interfaces, recorded responses and input method, and logged timing and interaction metadata. A backend assigned counterbalanced condition order, stored responses, and recorded session data. Brief LLM-generated conversational continuations were produced via the OpenAI Chat Completions API using GPT-3.5-turbo. If the API was unavailable, the application returned a short heuristic fallback reply.

== Procedure

Participants completed the study individually with a moderator present or available for setup. At the start of the session, participants received a brief introduction to the procedure and provided informed consent electronically. Each participant was assigned a unique study ID that determined counterbalanced task order.

For each trial, participants saw a naturalistic conversation starter in either a Messenger-style or Email-style interface. Prompt register (formal vs. informal) was assigned between subjects and was not labeled for participants. Participants composed a first reply using the assigned input modality (laptop keyboard typing, mobile keyboard typing, or mobile swipe typing) on the laptop or mobile device used for that session. After an LLM-generated reply, participants composed a final reply using the same modality. This three-turn structure (prompt, participant reply, LLM reply, participant reply) was repeated across six trials per participant.

Responses and metadata (input method, task medium, condition order, device type, and timing) were logged automatically. After the task block, participants completed NASA-TLX ratings for each trial. Sessions lasted approximately 15-30 minutes. Participants were instructed to respond as they naturally would in everyday messaging or email.
