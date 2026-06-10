"""Train a simple formality classifier on the GYAFC corpus.

This script loads the GYAFC_Corpus data (both domains by default), builds
a binary classification dataset (formal vs informal), tokenizes, and
trains a Hugging Face `AutoModelForSequenceClassification` model.

It is written to be run in an environment where PyTorch is built for
your hardware (ROCm for AMD GPUs). For Docker + ROCm recommendations,
see DOCS_ROCM.md.
"""

import argparse
import os
import pandas as pd
from datasets import Dataset, DatasetDict
from transformers import AutoTokenizer, AutoModelForSequenceClassification, TrainingArguments, Trainer
import torch
import numpy as np
from sklearn.metrics import accuracy_score, f1_score


def read_parallel_pair(path_formal, path_informal):
    rows = []
    if os.path.exists(path_formal):
        with open(path_formal, "r", encoding="utf-8") as f:
            for l in f:
                t = l.strip()
                if t:
                    rows.append({"text": t, "labels": 0})
    if os.path.exists(path_informal):
        with open(path_informal, "r", encoding="utf-8") as f:
            for l in f:
                t = l.strip()
                if t:
                    rows.append({"text": t, "labels": 1})
    return rows


def load_gyafc(data_root, domains=None, split="train"):
    """Load GYAFC parallel files and return a pandas DataFrame with columns `text` and `labels`.

    `domains` may be a list like ["Entertainment_Music", "Family_Relationships"].
    If None, we'll load all folders found under `data_root`.
    """
    if domains is None:
        domains = [d for d in os.listdir(data_root) if os.path.isdir(os.path.join(data_root, d))]

    all_rows = []
    for domain in domains:
        domain_dir = os.path.join(data_root, domain)
        formal = os.path.join(domain_dir, split, "formal")
        informal = os.path.join(domain_dir, split, "informal")
        if os.path.exists(formal) or os.path.exists(informal):
            rows = read_parallel_pair(formal, informal)
            print(f"Loaded {len(rows)} examples from {domain}/{split}")
            all_rows.extend(rows)
        else:
            print(f"Warning: no {split} files for domain {domain} (checked {formal}, {informal})")

    df = pd.DataFrame(all_rows)
    if df.empty:
        raise RuntimeError(f"No data found in {data_root} for domains={domains} split={split}")
    return df


def compute_metrics(pred):
    preds = pred.predictions
    if isinstance(preds, tuple):
        preds = preds[0]
    if preds.ndim > 1:
        preds = np.argmax(preds, axis=1)
    labels = pred.label_ids
    acc = accuracy_score(labels, preds)
    f1 = f1_score(labels, preds, average="binary")
    return {"accuracy": acc, "f1": f1}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_dir", default="data2/GYAFC_Corpus", help="Path to GYAFC_Corpus folder")
    parser.add_argument("--domains", nargs="*", help="Domains to include (default: both)")
    parser.add_argument("--model_name", default="distilbert-base-uncased")
    parser.add_argument("--output_dir", default="./formality_model")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=16)
    parser.add_argument("--learning_rate", type=float, default=2e-5)
    parser.add_argument("--max_length", type=int, default=128)
    parser.add_argument("--use_tune_split", action="store_true", help="Use the 'tune' split as validation when available")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    data_root = args.data_dir
    if not os.path.exists(data_root):
        raise FileNotFoundError(f"Data root not found: {data_root}")

    if args.domains:
        domains = args.domains
    else:
        domains = [d for d in os.listdir(data_root) if os.path.isdir(os.path.join(data_root, d))]

    print("Loading training data...")
    train_df = load_gyafc(data_root, domains=domains, split="train")

    if args.use_tune_split:
        print("Loading tune/validation data...")
        try:
            val_df = load_gyafc(data_root, domains=domains, split="tune")
        except RuntimeError:
            print("No tune data found; falling back to 10% split from train")
            val_df = None
    else:
        val_df = None

    if val_df is None:
        print("Creating HF dataset and splitting train/validation...")
        ds = Dataset.from_pandas(train_df)
        ds = ds.train_test_split(test_size=0.1, seed=args.seed)
        train_ds = ds["train"]
        val_ds = ds["test"]
    else:
        train_ds = Dataset.from_pandas(train_df)
        val_ds = Dataset.from_pandas(val_df)

    num_labels = int(train_df["labels"].nunique())
    print(f"Num labels: {num_labels}")

    print(f"Loading tokenizer: {args.model_name}")
    tokenizer = AutoTokenizer.from_pretrained(args.model_name)

    def tokenize_function(examples):
        return tokenizer(examples["text"], padding="max_length", truncation=True, max_length=args.max_length)

    print("Tokenizing datasets...")
    tokenized_train = train_ds.map(tokenize_function, batched=True)
    tokenized_val = val_ds.map(tokenize_function, batched=True)

    cols_to_remove = [c for c in tokenized_train.column_names if c not in ("input_ids", "attention_mask", "labels")]
    if cols_to_remove:
        tokenized_train = tokenized_train.remove_columns(cols_to_remove)
        tokenized_val = tokenized_val.remove_columns(cols_to_remove)

    tokenized_train.set_format(type="torch")
    tokenized_val.set_format(type="torch")

    print("Loading model...")
    model = AutoModelForSequenceClassification.from_pretrained(args.model_name, num_labels=num_labels)

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        save_strategy="epoch",
        evaluation_strategy="epoch",
        load_best_model_at_end=True,
        logging_steps=50,
        seed=args.seed,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_train,
        eval_dataset=tokenized_val,
        tokenizer=tokenizer,
        compute_metrics=compute_metrics,
    )

    print("Starting training...")
    trainer.train()

    print("Saving model and tokenizer...")
    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)


if __name__ == "__main__":
    main()