import os
from openai import OpenAI
import csv
import time

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

print("Commands: 'formal', 'informal', 'quit'\n")

# -----------------------------
# SYSTEM PROMPT (CONTROLLED)
# -----------------------------
SYSTEM_PROMPT = """
You are a neutral conversational agent used in a controlled linguistic study.

STRICT 4-TURN PROTOCOL:
1. User responds to prompt (data)
2. You respond with 1 short neutral acknowledgment only
3. The session ends immediately after your response

RULES:
- No questions
- No topic expansion
- No style mirroring
- Max 1 sentence
- Only neutral acknowledgments
"""

# -----------------------------
# PROMPTS (CLEAN + CONTROLLED)
# -----------------------------
FORMAL_PROMPTS = [
    "Please describe your plans for today in detail."
]

INFORMAL_PROMPTS = [
    "What are you up to today?"
]

# -----------------------------
# LOGGING SETUP
# -----------------------------
LOG_FILE = "experiment_data.csv"

with open(LOG_FILE, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow([
        "timestamp",
        "session_type",
        "turn",
        "speaker",
        "text"
    ])

def log(session_type, turn, speaker, text):
    with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            time.time(),
            session_type,
            turn,
            speaker,
            text
        ])

# -----------------------------
# SESSION RUNNER
# -----------------------------
def run_session(session_type):

    prompt = FORMAL_PROMPTS[0] if session_type == "formal" else INFORMAL_PROMPTS[0]

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt}
    ]

    print("\n📝 PROMPT:\n" + prompt + "\n")
    log(session_type, 0, "system", prompt)

    # -------------------------
    # TURN 1: USER
    # -------------------------
    user1 = input("You (Turn 1): ").strip()
    log(session_type, 1, "user", user1)
    messages.append({"role": "user", "content": user1})

    # -------------------------
    # TURN 2: LLM
    # -------------------------
    r1 = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        max_tokens=60
    )

    llm1 = r1.choices[0].message.content.strip()
    print("\nLLM (Turn 2):", llm1, "\n")

    log(session_type, 2, "assistant", llm1)
    messages.append({"role": "assistant", "content": llm1})


    print("✅ SESSION COMPLETE\n")
    print("--- NEXT PARTICIPANT ---\n")


# -----------------------------
# MAIN LOOP
# -----------------------------
while True:
    cmd = input("Command: ").strip().lower()

    if cmd in ["formal", "informal"]:
        run_session(cmd)

    elif cmd == "quit":
        break

    else:
        print("Invalid command. Use 'formal', 'informal', or 'quit'.\n")