"""
Evaluation script for GYAFC Formality Classifier
Evaluates the trained model on various test sets
"""

import os
import pandas as pd
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix, roc_auc_score
import json

MODEL_PATH = "./formality_model"
GYAFC_PATH = os.getenv("GYAFC_PATH", "./GYAFC_Corpus")
DOMAINS = ["Entertainment_Music", "Family_Relationships"]

def load_test_split(split_name="test"):
    """Load test split from GYAFC corpus"""
    data = {"text": [], "label": []}
    
    for domain in DOMAINS:
        domain_path = Path(GYAFC_PATH) / domain / split_name
        
        if domain_path.exists():
            # Load formal texts (label=1)
            formal_file = domain_path / "formal"
            if formal_file.exists():
                with open(formal_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        text = line.strip()
                        if text:
                            data["text"].append(text)
                            data["label"].append(1)
            
            # Load informal texts (label=0)
            informal_file = domain_path / "informal"
            if informal_file.exists():
                with open(informal_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        text = line.strip()
                        if text:
                            data["text"].append(text)
                            data["label"].append(0)
    
    return pd.DataFrame(data)

def evaluate_model():
    """Evaluate trained model on test sets"""
    
    if not os.path.exists(MODEL_PATH):
        print(f"Error: Model not found at {MODEL_PATH}")
        print("Please train the model first using gyafcTrainer.py")
        return
    
    print("Loading model and tokenizer...")
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    
    # Use GPU if available
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device)
    model.eval()
    
    print(f"Model loaded on {device}")
    print()
    
    # Evaluate on different splits
    for split in ["test", "tune"]:
        print(f"Loading {split} split...")
        df_test = load_test_split(split)
        
        if len(df_test) == 0:
            print(f"No data found for {split} split\n")
            continue
        
        print(f"Evaluating on {len(df_test)} samples from {split} split...")
        
        # Tokenize
        inputs = tokenizer(
            df_test["text"].tolist(),
            truncation=True,
            max_length=128,
            padding=True,
            return_tensors="pt"
        )
        
        # Move to device
        for key in inputs:
            inputs[key] = inputs[key].to(device)
        
        # Predict
        with torch.no_grad():
            outputs = model(**inputs)
        
        logits = outputs.logits
        predictions = torch.argmax(logits, dim=-1).cpu().numpy()
        probabilities = torch.softmax(logits, dim=-1).cpu().numpy()
        
        # Calculate metrics
        accuracy = accuracy_score(df_test["label"], predictions)
        precision, recall, f1, _ = precision_recall_fscore_support(
            df_test["label"], predictions, average='binary'
        )
        roc_auc = roc_auc_score(df_test["label"], probabilities[:, 1])
        
        # Confusion matrix
        cm = confusion_matrix(df_test["label"], predictions)
        
        # Print results
        print(f"\n{'='*50}")
        print(f"Results for {split} split:")
        print(f"{'='*50}")
        print(f"Accuracy:  {accuracy:.4f}")
        print(f"Precision: {precision:.4f}")
        print(f"Recall:    {recall:.4f}")
        print(f"F1 Score:  {f1:.4f}")
        print(f"ROC AUC:   {roc_auc:.4f}")
        print(f"\nConfusion Matrix:")
        print(f"  Predicted Informal  Predicted Formal")
        print(f"Actual Informal {cm[0, 0]:>6d}            {cm[0, 1]:>6d}")
        print(f"Actual Formal   {cm[1, 0]:>6d}            {cm[1, 1]:>6d}")
        
        # Error analysis
        errors_idx = predictions != df_test["label"].values
        if errors_idx.sum() > 0:
            print(f"\nMisclassified samples ({errors_idx.sum()} total):")
            error_samples = df_test[errors_idx].copy()
            error_samples["prediction"] = predictions[errors_idx]
            error_samples["confidence"] = probabilities[errors_idx, predictions[errors_idx]]
            
            # Show some examples
            for i, (idx, row) in enumerate(error_samples.head(5).iterrows()):
                actual = "Formal" if row["label"] == 1 else "Informal"
                pred = "Formal" if row["prediction"] == 1 else "Informal"
                print(f"\n  Example {i+1}:")
                print(f"    Text: {row['text'][:80]}...")
                print(f"    Actual: {actual}, Predicted: {pred} (confidence: {row['confidence']:.4f})")
        
        print("\n")

def classify_text(text):
    """Classify a single text"""
    
    if not os.path.exists(MODEL_PATH):
        print(f"Error: Model not found at {MODEL_PATH}")
        return
    
    print("Loading model and tokenizer...")
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_PATH)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device)
    model.eval()
    
    # Tokenize and classify
    inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True, max_length=128)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    with torch.no_grad():
        outputs = model(**inputs)
    
    logits = outputs.logits
    prediction = torch.argmax(logits, dim=-1).item()
    probabilities = torch.softmax(logits, dim=-1)[0].cpu().numpy()
    
    label = "Formal" if prediction == 1 else "Informal"
    confidence = probabilities[prediction]
    
    print(f"\nText: {text}")
    print(f"Classification: {label} (confidence: {confidence:.4f})")
    print(f"  Informal confidence: {probabilities[0]:.4f}")
    print(f"  Formal confidence:   {probabilities[1]:.4f}")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "classify":
        if len(sys.argv) > 2:
            text = " ".join(sys.argv[2:])
            classify_text(text)
        else:
            print("Usage: python evaluate.py classify 'Your text here'")
    else:
        evaluate_model()
