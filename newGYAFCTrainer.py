import pandas as pd
import numpy as np
import torch
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer
)
from sklearn.metrics import accuracy_score, f1_score

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

MODEL_NAME = "roberta-base"
MAX_LENGTH = 128

DOMAINS = {
    "entertainment_music": "GYAFC_Corpus/Entertainment_Music",
    "family_relationships": "GYAFC_Corpus/Family_Relationships",
}

def load_split(domain_path: str, split: str) -> pd.DataFrame:
    """Load formal and informal files for a given domain and split (train/test/tune)."""
    records = []
    for label, label_id in [("formal", 1), ("informal", 0)]:
        path = f"{domain_path}/{split}/{label}"
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append({"text": line, "labels": label_id})
    return pd.DataFrame(records)

print("Loading GYAFC corpus...")
train_frames = []
for domain, path in DOMAINS.items():
    df = load_split(path, "train")
    print(f"  {domain} train: {len(df)} samples")
    train_frames.append(df)

df = pd.concat(train_frames, ignore_index=True).sample(frac=1, random_state=42)
print(f"Total training samples: {len(df)}")

label_names = ["informal", "formal"]  # index 0 and 1

dataset = Dataset.from_pandas(df)
dataset = dataset.train_test_split(test_size=0.1, seed=42)
print(f"Train: {len(dataset['train'])}  Val: {len(dataset['test'])}")

print(f"Loading tokenizer: {MODEL_NAME}")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

def tokenize_function(examples):
    return tokenizer(
        examples["text"],
        padding="max_length",
        max_length=MAX_LENGTH,
        truncation=True
    )

tokenized_datasets = dataset.map(tokenize_function, batched=True)
tokenized_datasets = tokenized_datasets.remove_columns(["text"])
tokenized_datasets.set_format("torch")

model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=len(label_names)
)

def compute_metrics(eval_pred):
    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)
    return {
        "accuracy": accuracy_score(labels, predictions),
        "f1": f1_score(labels, predictions, average="weighted")
    }

training_args = TrainingArguments(
    output_dir="./new_formality_model",
    num_train_epochs=3,
    per_device_train_batch_size=16,
    per_device_eval_batch_size=32,
    learning_rate=2e-5,
    weight_decay=0.01,
    warmup_ratio=0.1,
    save_strategy="epoch",
    eval_strategy="epoch",
    load_best_model_at_end=True,
    metric_for_best_model="f1",
    logging_steps=50,
    fp16=True,
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_datasets["train"],
    eval_dataset=tokenized_datasets["test"],
    compute_metrics=compute_metrics,
)

print("Training...")
trainer.train()

model.save_pretrained("./new_formality_model")
tokenizer.save_pretrained("./new_formality_model")
print("Saved to ./new_formality_model")

def classify_formality(text):
    inputs = tokenizer(
        text,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=MAX_LENGTH
    ).to(device)
    model.to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    logits = outputs.logits
    pred_id = torch.argmax(logits, dim=-1).item()
    confidence = torch.softmax(logits, dim=-1)[0][pred_id].item()
    return {
        "text": text,
        "label": label_names[pred_id],
        "confidence": confidence
    }

if __name__ == "__main__":
    test_texts = [
        "Hello, how are you doing today?",
        "Yo, what's up?",
        "I would like to inquire about the status of my application.",
    ]
    for text in test_texts:
        result = classify_formality(text)
        print(f"\nText: {result['text']}")
        print(f"Label: {result['label']} ({result['confidence']:.2%})")