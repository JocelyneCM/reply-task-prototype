import pandas as pd
import textstat
from scipy.stats import pearsonr

# Load data
df = pd.read_csv(
    "C:/Users/Jakob/Documents/reply-task-prototype/Files_For_Graphs/formality_analysis_fixed_by_prompt_expanded.csv"
)

text_columns = [
    "prompt_text",
    "participant_reply_text",
    "llm_reply_text",
    "final_reply_text"
]

# Calculate Flesch-Kincaid Grade Level
for col in text_columns:
    df[f"{col}_fk"] = (
        df[col]
        .fillna("")
        .astype(str)
        .apply(lambda x: textstat.flesch_kincaid_grade(x) if x.strip() else None)
    )

# Average readability by formality condition
print("\nAverage Flesch-Kincaid Grade Level")
print(
    df.groupby("prompt_formality_label")[
        [f"{c}_fk" for c in text_columns]
    ].mean().round(2)
)

# Correlation between prompt and participant reply readability
valid = df[
    ["prompt_text_fk", "participant_reply_text_fk"]
].dropna()

r, p = pearsonr(
    valid["prompt_text_fk"],
    valid["participant_reply_text_fk"]
)

print(f"\nCorrelation (Prompt FK vs Participant FK)")
print(f"r = {r:.3f}")
print(f"p = {p:.4f}")