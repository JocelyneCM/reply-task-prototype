import pandas as pd
from formality_classifier import FormalityClassifier

# Load data
df = pd.read_csv("./Files_For_Graphs/formality_analysis_fixed_detailed.csv")

# Load model
classifier = FormalityClassifier("./formality_model")

# Classify all participant replies
results = classifier.batch_classify(
    df["participant_reply_text"].fillna("").tolist(),
    return_probabilities=True
)

# Save results
df["participant_reply_formality"] = [r["label"] for r in results]
df["participant_reply_confidence"] = [r["confidence"] for r in results]

df.to_csv("responses_reclassified.csv", index=False)