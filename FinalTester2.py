import json
from formality_classifier import FormalityClassifier

# Load model
classifier = FormalityClassifier("./formality_model")

# Load prompts
with open("./prototype/data/prompt_library.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Extract SMS prompts
sms_texts = [
    prompt["sms"]
    for prompt in data["prompts"]
    if prompt.get("sms")
]

# Classify
results = classifier.batch_classify(
    sms_texts,
    return_probabilities=True
)

# Print results
for text, result in zip(sms_texts, results):
    print("\nTEXT:")
    print(text)
    print(f"Label: {result['label']}")
    print(f"Confidence: {result['confidence']:.3f}")
    print(
        f"Informal={result['probabilities']['informal']:.3f}, "
        f"Formal={result['probabilities']['formal']:.3f}"
    )