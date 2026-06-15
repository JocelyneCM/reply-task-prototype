# LLM configuration evidence (study data collection)

Evidence from repository code and git history. Use for Apparatus wording only;
do not cite file modification dates in the paper—cite commit dates if needed.

## Active study path

| Item | Detail |
|---|---|
| **Server** | `prototype/server.py` |
| **Run command** | `python -m prototype.server` (see `README.md`) |
| **Endpoint** | `/api/generate_reply` |
| **Model constant** | `prototype/utils/prompt_engineering.py` → `OPENAI_CHAT_MODEL = "gpt-3.5-turbo"` |
| **API** | OpenAI Chat Completions (`https://api.openai.com/v1/chat/completions`) |
| **Fallback** | Heuristic short reply if no API key or call fails |

**Git:** `gpt-3.5-turbo` added to `prototype/server.py` on **2026-04-22** (`fdbc7c9`);
extracted to `prompt_engineering.py` on **2026-05-11** (`0762637`). Behavioural data
in `good_labeled_data.csv` spans **2026-05-20 – 2026-05-31**.

## Legacy / unused paths

| File | Model reference | Used in study? |
|---|---|---|
| `server.py` (repo root) | `microsoft/DialoGPT-medium` (variable `llama_model_name`) | **No** — README: legacy stack |
| `server.py` (repo root) | `gpt-4o-mini` on `/chat` | **No** |
| `test.py` | `gpt-4o-mini` | **No** — test script only |

The root `server.py` names a variable `llama_model_name` but loads **DialoGPT-medium**
(Hugging Face), not Meta Llama.

## Log evidence (partial)

- Raw logs for P020, P026, P030 show `llm_provider=openai` on LLM rows.
- Older participants often have an empty `llm_provider` field (logging added/refined
  during development); absence does not imply a different model.

## Evidence-based paper wording (recommended)

> Brief LLM-generated conversational continuations were produced via the OpenAI
> Chat Completions API. The study application was configured to use **GPT-3.5-turbo**
> (`prototype/server.py`). If the API was unavailable, the system returned a short
> heuristic fallback reply.

## Claims not supported by study prototype code

- GPT-4o / GPT-4o-mini as the **study** model (test/legacy files only)
- Meta Llama via API
- DialoGPT as the **deployed study** backend (legacy root `server.py` only)

**Confidence:** High for configured study model (code + timeline); low–medium for
per-trial runtime verification from logs alone.
