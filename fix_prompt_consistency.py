"""
Fix inconsistent prompt formality confidence values.

For each prompt_id, the prompt_formality_confidence should be the same
across all participant rows since the prompt text is identical.

This script:
1. Identifies the most common/reliable confidence value per prompt
2. Standardizes all rows with that prompt_id
3. Creates a corrected CSV
"""

import pandas as pd
from collections import Counter

def fix_prompt_consistency(input_path, output_path):
    """
    Standardize prompt formality confidence across all rows.
    """
    print(f"Loading data: {input_path}")
    df = pd.read_csv(input_path, encoding='utf-8', on_bad_lines='skip')
    
    print(f"Loaded {len(df)} rows\n")
    
    # Group by prompt_id and find inconsistencies
    print("Analyzing prompt formality consistency...")
    inconsistencies = []
    
    for prompt_id in df['prompt_id'].unique():
        prompt_rows = df[df['prompt_id'] == prompt_id]
        
        # Get all confidence values for this prompt
        conf_values = prompt_rows['prompt_formality_confidence'].unique()
        label_values = prompt_rows['prompt_formality_label'].unique()
        
        if len(conf_values) > 1 or len(label_values) > 1:
            inconsistencies.append({
                'prompt_id': prompt_id,
                'conf_min': conf_values.min(),
                'conf_max': conf_values.max(),
                'labels': label_values.tolist(),
                'count': len(prompt_rows)
            })
    
    if inconsistencies:
        print(f"\nFound {len(inconsistencies)} prompts with inconsistent values")
        for item in inconsistencies[:5]:
            print(f"  {item['prompt_id']}: confidence {item['conf_min']}-{item['conf_max']}, labels: {item['labels']}")
    
    # Strategy: Use the mode (most common) confidence value for each prompt
    print("\n--- Standardizing prompt formality values ---")
    
    prompt_standard = {}
    for prompt_id in df['prompt_id'].unique():
        prompt_rows = df[df['prompt_id'] == prompt_id]
        
        # Use the most common confidence value
        conf_counts = prompt_rows['prompt_formality_confidence'].value_counts()
        standard_conf = conf_counts.idxmax()  # Most common value
        
        # Use the most common label
        label_counts = prompt_rows['prompt_formality_label'].value_counts()
        standard_label = label_counts.idxmax()
        
        prompt_standard[prompt_id] = {
            'confidence': standard_conf,
            'label': standard_label
        }
    
    print(f"Determined standard values for {len(prompt_standard)} prompts")
    
    # Apply standardization
    print("\nApplying standardization...")
    df_fixed = df.copy()
    
    for prompt_id, standard_vals in prompt_standard.items():
        mask = df_fixed['prompt_id'] == prompt_id
        df_fixed.loc[mask, 'prompt_formality_confidence'] = standard_vals['confidence']
        df_fixed.loc[mask, 'prompt_formality_label'] = standard_vals['label']
    
    # Verify consistency
    print("\nVerifying consistency...")
    all_consistent = True
    for prompt_id in df_fixed['prompt_id'].unique():
        prompt_rows = df_fixed[df_fixed['prompt_id'] == prompt_id]
        conf_values = prompt_rows['prompt_formality_confidence'].unique()
        label_values = prompt_rows['prompt_formality_label'].unique()
        
        if len(conf_values) > 1 or len(label_values) > 1:
            print(f"  ⚠ {prompt_id}: Still inconsistent!")
            all_consistent = False
    
    if all_consistent:
        print("  ✓ All prompts now have consistent formality values!")
    
    # Save corrected data
    df_fixed.to_csv(output_path, index=False)
    print(f"\n✓ Saved corrected data: {output_path}")
    
    # Print summary
    print("\n--- Standardization Summary ---")
    print(f"Original records: {len(df)}")
    print(f"Fixed records: {len(df_fixed)}")
    print(f"Unique prompts: {df_fixed['prompt_id'].nunique()}")
    print(f"Unique participants: {df_fixed['participant_id'].nunique()}")
    
    # Show the standardized prompt values
    print("\n--- Standardized Prompt Formality Values ---")
    for prompt_id in sorted(df_fixed['prompt_id'].unique()):
        prompt_rows = df_fixed[df_fixed['prompt_id'] == prompt_id].iloc[0]
        print(f"{prompt_id}: {prompt_rows['prompt_formality_label']} (confidence: {prompt_rows['prompt_formality_confidence']})")
    
    return df_fixed


if __name__ == '__main__':
    input_csv = 'good_labeled_data.csv'
    output_csv = 'good_labeled_data_fixed.csv'
    
    df_fixed = fix_prompt_consistency(input_csv, output_csv)
