"""
Batch formality classifier for CSV files.

Usage examples:
  python classify_formality_csv.py --input data.csv --output data_with_labels.csv
  python classify_formality_csv.py --input data.csv --output out.csv --columns prompt_text,participant_reply_text,llm_reply_text,final_reply_text --probabilities

The script adds columns for each input column:
  <col>_label ("formal"/"informal")
  <col>_confidence (float 0-1)
If `--probabilities` is set, also adds:
  <col>_prob_informal
  <col>_prob_formal

Relies on the existing `formality_classifier.py` in the repository.
"""

import argparse
import pandas as pd
import sys
from formality_classifier import FormalityClassifier

DEFAULT_COLUMNS = [
    "prompt_text",
    "participant_reply_text",
    "llm_reply_text",
    "final_reply_text",
]


def process_file(input_path, output_path, columns, include_probs, encoding=None):
  print(f"Loading CSV: {input_path}")
  # If an encoding is specified, use it. Otherwise try common encodings.
  if encoding:
    print(f"Using encoding: {encoding}")
    df = pd.read_csv(input_path, encoding=encoding)
  else:
    tried = []
    encodings_to_try = ["utf-8", "utf-8-sig", "cp1252", "latin-1"]
    df = None
    for enc in encodings_to_try:
      try:
        tried.append(enc)
        df = pd.read_csv(input_path, encoding=enc)
        print(f"Successfully read CSV with encoding: {enc}")
        break
      except Exception as e:
        print(f"Failed with encoding {enc}: {e}")
    if df is None:
      # Final fallback: read with replacement to avoid decode errors
      print(f"All encodings {tried} failed — reading with 'latin-1' and replacing decode errors.")
      df = pd.read_csv(input_path, encoding='latin-1', errors='replace')

    classifier = FormalityClassifier()

    for col in columns:
        if col not in df.columns:
            print(f"Warning: column '{col}' not found in CSV — filling with empty strings")
            df[col] = ""

        texts = df[col].fillna("").astype(str).tolist()
        print(f"Classifying column '{col}' ({len(texts)} rows)")
        results = classifier.batch_classify(texts, return_probabilities=include_probs)

        labels = [r['label'] for r in results]
        # Round confidences to two decimals for clearer CSV output
        confidences = [round(float(r['confidence']), 2) for r in results]

        df[f"{col}_label"] = labels
        df[f"{col}_confidence"] = confidences

        if include_probs:
            # Round probabilities to two decimals
            prob_informal = [round(float(r['probabilities']['informal']), 2) for r in results]
            prob_formal = [round(float(r['probabilities']['formal']), 2) for r in results]
            df[f"{col}_prob_informal"] = prob_informal
            df[f"{col}_prob_formal"] = prob_formal

    print(f"Writing output CSV: {output_path}")
    df.to_csv(output_path, index=False)
    print("Done.")


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description="Batch formality classifier for CSV columns")
  parser.add_argument('--input', '-i', required=True, help='Input CSV path')
  parser.add_argument('--output', '-o', required=True, help='Output CSV path')
  parser.add_argument('--columns', '-c', default=','.join(DEFAULT_COLUMNS),
            help=f"Comma-separated column names to classify (default: {','.join(DEFAULT_COLUMNS)})")
  parser.add_argument('--probabilities', action='store_true', help='Include class probabilities in output')
  parser.add_argument('--encoding', help='Specify encoding to use when reading CSV (overrides auto-detect)')

  args = parser.parse_args()

  cols = [c.strip() for c in args.columns.split(',') if c.strip()]
  if not cols:
    print("No columns specified, exiting.")
    sys.exit(1)

  process_file(args.input, args.output, cols, args.probabilities, encoding=args.encoding)
