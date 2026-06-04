import pandas as pd
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForSequenceClassification, TrainingArguments, Trainer
import torch
import numpy as np
import os
from pathlib import Path

# GYAFC Corpus path - auto-detect or use environment variable
def validate_gyafc_path(path):
    """Check if path contains valid GYAFC structure"""
    path = Path(path)
    if not path.exists():
        return False
    # Check for required subdirectories
    return (path / "Entertainment_Music").exists() and (path / "Family_Relationships").exists()

def find_gyafc_path():
    """Find GYAFC_Corpus directory in common locations"""
    # Check environment variable first
    if "GYAFC_PATH" in os.environ:
        path = Path(os.environ["GYAFC_PATH"])
        if validate_gyafc_path(path):
            return path
    
    # Check current directory
    if validate_gyafc_path("GYAFC_Corpus"):
        return Path("GYAFC_Corpus")
    
    # Check parent directory
    if validate_gyafc_path("../GYAFC_Corpus"):
        return Path("../GYAFC_Corpus").resolve()
    
    # Check Downloads (Windows) - look for any folder with proper structure
    downloads_parent = Path.home() / "Downloads"
    if downloads_parent.exists():
        for folder in downloads_parent.iterdir():
            if folder.is_dir() and "GYAFC" in folder.name:
                # Check if this folder directly contains the domains
                if validate_gyafc_path(folder):
                    return folder
                # Or check if it contains a GYAFC_Corpus subfolder
                gyafc_subfolder = folder / "GYAFC_Corpus"
                if validate_gyafc_path(gyafc_subfolder):
                    return gyafc_subfolder
    
    # Default fallback
    return Path(os.getenv("GYAFC_PATH", "./GYAFC_Corpus"))

GYAFC_PATH = find_gyafc_path()
DOMAINS = ["Entertainment_Music", "Family_Relationships"]

print(f"GYAFC_Corpus path: {GYAFC_PATH}")
if not GYAFC_PATH.exists():
    print(f"Warning: GYAFC_Corpus not found at {GYAFC_PATH}")
    print("Please set GYAFC_PATH environment variable or place GYAFC_Corpus in current directory")


def load_gyafc_data():
    """Load formal and informal text pairs from GYAFC corpus"""
    data = {"text": [], "label": []}
    
    for domain in DOMAINS:
        domain_path = Path(GYAFC_PATH) / domain
        
        # Load training data
        for split in ["train", "tune"]:  # Use train and tune for training
            split_path = domain_path / split
            
            if split_path.exists():
                # Load formal texts (label=1)
                formal_file = split_path / "formal"
                if formal_file.exists():
                    with open(formal_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            text = line.strip()
                            if text:
                                data["text"].append(text)
                                data["label"].append(1)  # 1 = formal
                
                # Load informal texts (label=0)
                informal_file = split_path / "informal"
                if informal_file.exists():
                    with open(informal_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            text = line.strip()
                            if text:
                                data["text"].append(text)
                                data["label"].append(0)  # 0 = informal
    
    return pd.DataFrame(data)

# Load the GYAFC corpus
print("Loading GYAFC dataset...")
df = load_gyafc_data()

if len(df) == 0:
    print("\nError: No data loaded from GYAFC_Corpus!")
    print(f"Checked path: {GYAFC_PATH}")
    print("\nPlease ensure:")
    print("2. Set GYAFC_PATH environment variable or place it in current directory")
    print("3. Verify the structure contains Entertainment_Music/ and Family_Relationships/ folders")
    exit(1)

print(f"Loaded {len(df)} samples")
print(f"Label distribution:\n{df['label'].value_counts()}")
print("Label mapping: 0 = informal, 1 = formal")
print(f"Sample formal: {df[df['label']==1]['text'].iloc[0] if len(df) > 0 else 'N/A'}")
print(f"Sample informal: {df[df['label']==0]['text'].iloc[0] if len(df) > 0 else 'N/A'}")

# Create HuggingFace dataset
print("\nConverting to HuggingFace dataset...")
dataset = Dataset.from_pandas(df)
# 80% train, 20% test split
dataset = dataset.train_test_split(test_size=0.2)

# Model configuration
MODEL_NAME = "distilbert-base-uncased"
print(f"\nLoading tokenizer from {MODEL_NAME}...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

# Check device availability (ROCm for AMD 9070 XT)
if torch.cuda.is_available():
    device = torch.device("cuda")
    print(f"GPU available: {torch.cuda.get_device_name(0)}")
    print(f"CUDA version: {torch.version.cuda}")
else:
    device = torch.device("cpu")
    print("No GPU available, using CPU")

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

# Compute metrics function
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

def compute_metrics(eval_pred):
    predictions, labels = eval_pred
    predictions = np.argmax(predictions, axis=1)
    accuracy = accuracy_score(labels, predictions)
    precision, recall, f1, _ = precision_recall_fscore_support(labels, predictions, average='binary')
    return {
        'accuracy': accuracy,
        'precision': precision,
        'recall': recall,
        'f1': f1,
    }

# Load model
print(f"\nLoading model from {MODEL_NAME}...")
num_labels = len(df['label'].unique())
print(f"Number of classes: {num_labels}")
model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=num_labels
)

# Training arguments
training_args = TrainingArguments(
    output_dir="./formality_model",
    num_train_epochs=5,
    per_device_train_batch_size=32,
    per_device_eval_batch_size=32,
    learning_rate=2e-5,
    weight_decay=0.01,
    save_strategy="epoch",
    eval_strategy="epoch",
    load_best_model_at_end=True,
    logging_steps=100,
    metric_for_best_model="accuracy",
    greater_is_better=True,
    seed=42,
)

from pathlib import Path

# Create trainer
print("\nInitializing trainer...")
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_datasets["train"],
    eval_dataset=tokenized_datasets["test"],
    compute_metrics=compute_metrics,
)

# Train model
print("Starting training...")
output_dir = Path(training_args.output_dir)
checkpoint_paths = sorted(
    [p for p in output_dir.glob("checkpoint-*") if p.is_dir()],
    key=lambda p: int(p.name.split("-")[1]) if p.name.split("-")[1].isdigit() else -1,
)
resume_checkpoint = str(checkpoint_paths[-1]) if checkpoint_paths else True
if checkpoint_paths:
    print(f"Resuming from latest checkpoint: {resume_checkpoint}")

trainer.train(resume_from_checkpoint=resume_checkpoint)

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
    
    # Map label ID to label name based on training labels
    # 0 = informal, 1 = formal
    label_names = {0: "informal", 1: "formal"}
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