import pandas as pd
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForSequenceClassification, TrainingArguments, Trainer
import torch
import numpy as np

# Load the parquet file
print("Loading dataset...")
df = pd.read_parquet("GYAFC/Train/UkrToEn/train-00000-of-00001_en.parquet")
print(f"Loaded {len(df)} samples")
print(f"Columns: {df.columns.tolist()}")
print(f"Sample: {df.head(1)}")

# Create HuggingFace dataset
print("\nConverting to HuggingFace dataset...")
dataset = Dataset.from_pandas(df)
dataset = dataset.train_test_split(test_size=0.1)

# Model configuration
MODEL_NAME = "distilbert-base-uncased"
print(f"\nLoading tokenizer from {MODEL_NAME}...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

# Tokenize function
def tokenize_function(examples):
    return tokenizer(
        examples["text"],
        padding="max_length",
        max_length=128,
        truncation=True
    )

# Tokenize datasets
print("Tokenizing datasets...")
tokenized_datasets = dataset.map(tokenize_function, batched=True)

# Remove unnecessary columns and set format
tokenized_datasets = tokenized_datasets.remove_columns(["text"])
# Column is already named "labels", no need to rename
tokenized_datasets.set_format("torch")

print(f"Training set size: {len(tokenized_datasets['train'])}")
print(f"Test set size: {len(tokenized_datasets['test'])}")

# Load model
print(f"\nLoading model from {MODEL_NAME}...")
num_labels = len(df['labels'].unique())
print(f"Number of classes: {num_labels}")
model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=num_labels
)

# Training arguments
training_args = TrainingArguments(
    output_dir="./formality_model",
    num_train_epochs=3,
    per_device_train_batch_size=16,
    per_device_eval_batch_size=16,
    learning_rate=2e-5,
    weight_decay=0.01,
    save_strategy="epoch",
    eval_strategy="epoch",
    load_best_model_at_end=True,
    logging_steps=50,
)

# Create trainer
print("\nInitializing trainer...")
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_datasets["train"],
    eval_dataset=tokenized_datasets["test"],
)

# Train model
print("Starting training...")
trainer.train()

# Save model
print("\nSaving model...")
model.save_pretrained("./formality_model")
tokenizer.save_pretrained("./formality_model")

# Inference function
def classify_formality(text):
    """Classify the formality of input text"""
    inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=128)
    with torch.no_grad():
        outputs = model(**inputs)
    logits = outputs.logits
    predictions = torch.argmax(logits, dim=-1)
    confidence = torch.softmax(logits, dim=-1)
    
    label_id = predictions[0].item()
    confidence_score = confidence[0][label_id].item()
    
    # Map label ID to label name (adjust based on your actual labels)
    label_names = {0: "formal", 1: "informal"}  # Update if different
    label_name = label_names.get(label_id, f"class_{label_id}")
    
    return {
        "text": text,
        "label": label_name,
        "confidence": confidence_score
    }

# Example usage
if __name__ == "__main__":
    print("\n" + "="*50)
    print("Testing inference on sample texts:")
    print("="*50)
    
    test_texts = [
        "Hello, how are you doing today?",
        "Yo, what's up?",
        "I would like to inquire about the status of my application.",
    ]
    
    for text in test_texts:
        result = classify_formality(text)
        print(f"\nText: {result['text']}")
        print(f"Label: {result['label']} (confidence: {result['confidence']:.2%})")