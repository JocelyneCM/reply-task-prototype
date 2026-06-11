import pandas as pd

# ------------------------------------------------------------------
# Load data
# ------------------------------------------------------------------

INPUT_FILE = "formality_analysis_fixed_by_prompt_expanded.csv"
OUTPUT_FILE = "prompt_level_formality_correlations.csv"

df = pd.read_csv(INPUT_FILE)

# ------------------------------------------------------------------
# Convert classifier outputs to continuous formality scores
# 0 = maximally informal
# 1 = maximally formal
# ------------------------------------------------------------------

def formality_score(label, confidence):
    label = str(label).strip().upper()

    if label == "FORMAL":
        return confidence
    elif label == "INFORMAL":
        return 1.0 - confidence
    else:
        return None

# Adjust these column names if your CSV differs
column_pairs = {
    "prompt": ("prompt_formality_label", "prompt_formality_confidence"),
    "reply": ("reply_formality_label", "reply_formality_confidence"),
    "llm_reply": ("llm_reply_formality_label", "llm_reply_formality_confidence"),
    "final_reply": ("final_reply_formality_label", "final_reply_formality_confidence"),
}

for prefix, (label_col, conf_col) in column_pairs.items():
    df[f"{prefix}_score"] = df.apply(
        lambda row: formality_score(
            row[label_col],
            row[conf_col]
        ),
        axis=1
    )

# ------------------------------------------------------------------
# Aggregate by prompt
# ------------------------------------------------------------------

prompt_level = (
    df.groupby("prompt_id")
      .agg(
          prompt_score=("prompt_score", "first"),
          mean_reply_score=("reply_score", "mean"),
          mean_llm_reply_score=("llm_reply_score", "mean"),
          mean_final_reply_score=("final_reply_score", "mean"),
          participant_count=("reply_score", "count")
      )
      .reset_index()
)

# ------------------------------------------------------------------
# Compute correlations
# ------------------------------------------------------------------

results = pd.DataFrame([
    {
        "comparison": "Prompt vs Participant Reply",
        "pearson_r": prompt_level["prompt_score"].corr(
            prompt_level["mean_reply_score"]
        )
    },
    {
        "comparison": "Prompt vs LLM Reply",
        "pearson_r": prompt_level["prompt_score"].corr(
            prompt_level["mean_llm_reply_score"]
        )
    },
    {
        "comparison": "Prompt vs Final Reply",
        "pearson_r": prompt_level["prompt_score"].corr(
            prompt_level["mean_final_reply_score"]
        )
    }
])

# ------------------------------------------------------------------
# Save outputs
# ------------------------------------------------------------------

results.to_csv(OUTPUT_FILE, index=False)

prompt_level.to_csv(
    "prompt_level_formality_scores.csv",
    index=False
)

# ------------------------------------------------------------------
# Print summary
# ------------------------------------------------------------------

print("\nPrompt-level correlations")
print("=" * 50)
print(results.to_string(index=False))

print(f"\nSaved:")
print(f"  {OUTPUT_FILE}")
print("  prompt_level_formality_scores.csv")