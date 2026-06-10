"""
Restructure CSV columns and classify formality for multiple text fields.
"""

import pandas as pd
import sys
from formality_classifier import FormalityClassifier

def restructure_csv(input_path, output_path):
    """
    Restructure CSV to have formality classifications for:
    - prompt_text
    - participant_reply_text
    - llm_reply_text
    - final_reply_text
    """
    print(f"Loading CSV: {input_path}")
    try:
        # Try with the default C engine first
        df = pd.read_csv(input_path, encoding='utf-8', on_bad_lines='skip')
    except Exception as e:
        print(f"Error with utf-8: {e}")
        # Fallback to other encodings
        try:
            df = pd.read_csv(input_path, encoding='latin-1', on_bad_lines='skip')
            print("Successfully loaded with latin-1 encoding")
        except Exception as e2:
            print(f"Error with latin-1: {e2}")
            raise
    
    # Define text columns to classify and their output names (with _formality_ naming convention)
    columns_to_classify = {
        'prompt_text': ('prompt_formality_label', 'prompt_formality_confidence'),
        'participant_reply_text': ('reply_formality_label', 'reply_formality_confidence'),
        'llm_reply_text': ('llm_reply_formality_label', 'llm_reply_formality_confidence'),
        'final_reply_text': ('final_reply_formality_label', 'final_reply_formality_confidence'),
    }
    
    # Define the exact column order and selection for output
    desired_columns = [
        'timestamp', 'participant_id', 'Device', 'medium', 'input_method',
        'prompt_text', 'participant_reply_text', 'llm_reply_text', 'final_reply_text',
        'response_time_seconds', 'words_per_minute', 'keypress_count', 'backspace_count',
        'paste_used', 'correction_applied', 'manual_edit_count', 'edit_ratio',
        'keystrokes_per_character', 'backspaces_per_word',
        'prompt_formality', 'prompt_id',
        'prompt_formality_label', 'prompt_formality_confidence',
        'reply_formality_label', 'reply_formality_confidence',
        'llm_reply_formality_label', 'llm_reply_formality_confidence',
        'final_reply_formality_label', 'final_reply_formality_confidence',
        'revision_count', 'inserted_chars_est', 'deleted_chars_est',
        'net_char_change', 'manual_edit_chars_after_transcript_est', 'edit_trace_path'
    ]
    
    # Remove old classification columns if they exist
    old_cols = ['formality_label', 'formality_confidence', 'formality_match_prompt_reply', 
                'bert_label', 'bert_raw', 'bert_confidence',
                'prompt_text_label', 'prompt_text_confidence',
                'participant_reply_text_label', 'participant_reply_text_confidence',
                'llm_reply_text_label', 'llm_reply_text_confidence',
                'final_reply_text_label', 'final_reply_text_confidence',
                'row_role', 'prompt_style', 'prompt_tone', 'prompt_seriousness', 'prompt_source',
                'reply_style', 'reply_analysis_status', 'reply_analysis_basis',
                'transcript_status', 'transcript_source', 'audio_filename', 'log_row_id',
                'edit_trace_available', 'voice_transcript_initial_chars', 'edit_activity_compact']
    df = df.drop(columns=[col for col in old_cols if col in df.columns], errors='ignore')
    
    print(f"CSV loaded with {len(df)} rows")
    
    # Remove any unnamed columns (typically from trailing commas in CSV)
    unnamed_cols = [col for col in df.columns if 'Unnamed' in col]
    if unnamed_cols:
        print(f"Removing {len(unnamed_cols)} unnamed columns: {unnamed_cols}")
        df = df.drop(columns=unnamed_cols)
    
    print(f"Columns: {list(df.columns)}")
    
    # Initialize classifier
    classifier = FormalityClassifier()
    
    # Process each text column
    for col_name, (label_col, conf_col) in columns_to_classify.items():
        if col_name not in df.columns:
            print(f"Warning: column '{col_name}' not found in CSV")
            df[label_col] = ""
            df[conf_col] = ""
            continue
        
        texts = df[col_name].fillna("").astype(str).tolist()
        print(f"\nClassifying '{col_name}' ({len(texts)} rows)")
        
        results = classifier.batch_classify(texts, return_probabilities=False)
        
        labels = [r['label'] for r in results]
        confidences = [round(float(r['confidence']), 2) for r in results]
        
        df[label_col] = labels
        df[conf_col] = confidences
        
        print(f"  → Added {label_col} and {conf_col}")
    
    # Keep only the desired columns in the desired order
    # Only include columns that exist in the dataframe
    existing_desired_cols = [col for col in desired_columns if col in df.columns]
    df = df[existing_desired_cols]
    
    print(f"\nFinal column structure:")
    print(f"Total columns: {len(df.columns)}")
    print(f"Columns: {list(df.columns)}")
    
    print(f"\nWriting output CSV: {output_path}")
    df.to_csv(output_path, index=False)
    print("Done!")
    return df
    
if __name__ == '__main__':
    input_csv = 'sentiment_log(merged)_all_participants_Corrected_again.csv'
    output_csv = 'sentiment_log_with_formality_classified.csv'
    
    df = restructure_csv(input_csv, output_csv)
    
    print("\nNew column structure:")
    print(f"Total columns: {len(df.columns)}")
    print("\nFormality classification columns:")
    formality_cols = [c for c in df.columns if 'formality' in c.lower() or 'confidence' in c.lower()]
    for col in sorted(formality_cols):
        print(f"  - {col}")
