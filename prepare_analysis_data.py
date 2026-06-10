"""
Prepare formality data for graph and correlation analysis.

Generates:
1. Averages by prompt_id
2. Averages by participant_id
3. Combined analysis data for correlation
"""

import pandas as pd
import json

def prepare_analysis_data(input_path, output_base):
    """
    Prepare formality data for visualization and correlation analysis.
    
    Creates:
    - {output_base}_by_prompt.csv: averages by prompt_id
    - {output_base}_by_participant.csv: averages by participant_id
    - {output_base}_detailed.csv: detailed record with formality data
    - {output_base}_summary.json: summary statistics
    """
    print(f"Loading data: {input_path}")
    df = pd.read_csv(input_path, encoding='utf-8', on_bad_lines='skip')
    
    print(f"Loaded {len(df)} rows")
    print(f"Columns: {df.columns.tolist()}")
    
    # Define formality columns
    formality_cols = {
        'prompt': ('prompt_formality_label', 'prompt_formality_confidence'),
        'reply': ('reply_formality_label', 'reply_formality_confidence'),
        'llm_reply': ('llm_reply_formality_label', 'llm_reply_formality_confidence'),
        'final_reply': ('final_reply_formality_label', 'final_reply_formality_confidence'),
    }
    
    # Create detailed output with relevant columns
    core_cols = [
        'timestamp', 'participant_id', 'Device', 'medium', 'input_method',
        'prompt_id', 'prompt_text', 'participant_reply_text', 
        'llm_reply_text', 'final_reply_text'
    ]
    
    # Add formality columns
    for field_name, (label_col, conf_col) in formality_cols.items():
        if label_col in df.columns and conf_col in df.columns:
            core_cols.extend([label_col, conf_col])
    
    # Filter to only existing columns
    available_cols = [col for col in core_cols if col in df.columns]
    df_detailed = df[available_cols].copy()
    
    print(f"\nDetailed output columns: {available_cols}")
    
    # Save detailed data
    detail_output = f"{output_base}_detailed.csv"
    df_detailed.to_csv(detail_output, index=False)
    print(f"✓ Saved: {detail_output}")
    
    # Calculate averages by prompt_id
    print("\n--- Calculating by Prompt ID ---")
    prompt_groupby = ['prompt_id']
    
    # Confidence columns only
    conf_cols_in_df = [conf for _, (_, conf) in formality_cols.items() if conf in df.columns]
    
    if conf_cols_in_df:
        df_by_prompt = df.groupby(prompt_groupby)[conf_cols_in_df].agg(['mean', 'std', 'count']).reset_index()
        df_by_prompt.columns = ['_'.join(col).strip('_') if col[1] else col[0] for col in df_by_prompt.columns.values]
        
        prompt_output = f"{output_base}_by_prompt.csv"
        df_by_prompt.to_csv(prompt_output, index=False)
        print(f"✓ Saved: {prompt_output}")
        print(df_by_prompt)
    
    # Calculate averages by participant_id
    print("\n--- Calculating by Participant ID ---")
    participant_groupby = ['participant_id']
    
    if conf_cols_in_df:
        df_by_participant = df.groupby(participant_groupby)[conf_cols_in_df].agg(['mean', 'std', 'count']).reset_index()
        df_by_participant.columns = ['_'.join(col).strip('_') if col[1] else col[0] for col in df_by_participant.columns.values]
        
        participant_output = f"{output_base}_by_participant.csv"
        df_by_participant.to_csv(participant_output, index=False)
        print(f"✓ Saved: {participant_output}")
        print(df_by_participant)
    
    # Calculate summary statistics
    print("\n--- Summary Statistics ---")
    summary = {
        'total_records': len(df),
        'unique_prompts': df['prompt_id'].nunique() if 'prompt_id' in df.columns else 0,
        'unique_participants': df['participant_id'].nunique() if 'participant_id' in df.columns else 0,
        'formality_fields': list(formality_cols.keys()),
    }
    
    # Average confidence by field
    for field_name, (label_col, conf_col) in formality_cols.items():
        if conf_col in df.columns:
            mean_conf = df[conf_col].mean()
            std_conf = df[conf_col].std()
            summary[f'{field_name}_avg_confidence'] = round(mean_conf, 4)
            summary[f'{field_name}_std_confidence'] = round(std_conf, 4)
    
    summary_output = f"{output_base}_summary.json"
    with open(summary_output, 'w') as f:
        json.dump(summary, f, indent=2)
    print(f"✓ Saved: {summary_output}")
    print(json.dumps(summary, indent=2))
    
    # Create correlation matrix data
    print("\n--- Preparing Correlation Data ---")
    corr_cols = [conf for _, (_, conf) in formality_cols.items() if conf in df.columns]
    if corr_cols:
        corr_data = df[['participant_id', 'prompt_id'] + corr_cols].copy()
        corr_output = f"{output_base}_correlation.csv"
        corr_data.to_csv(corr_output, index=False)
        print(f"✓ Saved: {corr_output}")
        
        # Show correlation matrix
        print("\nCorrelation Matrix:")
        corr_matrix = df[corr_cols].corr()
        print(corr_matrix)


if __name__ == '__main__':
    input_csv = 'good_labeled_data.csv'
    output_base = 'formality_analysis'
    
    prepare_analysis_data(input_csv, output_base)
    
    print("\n" + "="*60)
    print("Analysis complete! Generated files:")
    print(f"  - {output_base}_detailed.csv (all data with formality labels)")
    print(f"  - {output_base}_by_prompt.csv (averages grouped by prompt_id)")
    print(f"  - {output_base}_by_participant.csv (averages grouped by participant_id)")
    print(f"  - {output_base}_correlation.csv (data for correlation analysis)")
    print(f"  - {output_base}_summary.json (summary statistics)")
    print("="*60)
