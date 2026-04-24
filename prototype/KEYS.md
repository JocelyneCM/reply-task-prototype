OpenAI Key (development)

This project supports two ways to provide an OpenAI API key for local development.

1) Environment variable (recommended)

   export OPENAI_API_KEY="sk-..."
2) Local keys.json (dev only)

   Create a file at the repository root named `keys.json` with this structure:

   {
   "openai_api_key": "sk-..."
   }

Notes:

- Prefer the environment variable in CI / production.
- Do NOT commit real keys to source control. Add `keys.json` to .gitignore if you create one.
- The server checks `OPENAI_API_KEY` first, then falls back to keys.json.
