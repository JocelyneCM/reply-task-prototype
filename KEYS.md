Keys and secrets — local setup
=================================

This repository does not store API keys in version control. The server and scripts expect
an OpenAI API key to be provided via an environment variable.

How to provide an OpenAI API key (recommended)
---------------------------------------------
1. In your shell, set the environment variable before running the server:

   export OPENAI_API_KEY="sk-..."

2. Start the server from the repo root:

   PYTHONPATH=. python3 -m prototype.server

Alternative (not recommended):
--------------------------------
Some legacy scripts may look for a `keys.json` file in the project root. If you prefer
to use a JSON file, create it yourself and do NOT commit it. Example structure:

```
{
  "openai_api_key": "sk-..."
}
```

Security notes
--------------
- Do not commit secrets. This repository's `.gitignore` already includes `keys.json`.
- If you accidentally committed a key, rotate it immediately and consider removing
  it from the git history (use `git rm --cached keys.json` and force-push or tools like BFG).
- Prefer environment variables or a secrets manager for CI/deployment.

If you want, I can also add a small script to load `.env` files locally and export
`OPENAI_API_KEY` for development.
