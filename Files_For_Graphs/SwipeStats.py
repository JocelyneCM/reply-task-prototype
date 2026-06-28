import pandas as pd
from scipy.stats import f_oneway

df = pd.read_csv("NASA TLX Thesis.csv")

no = ['P001', 'P002', 'P006', 'P008', 'P007', 'P018', 'P020', 'P019']
yes = ['P004', 'P005', 'P022', 'P024', 'P026', 'P030', 'P017', 'P021']

cols = [
    'Mental Demand',
    'Physical Demand',
    'Temporal Demand',
    'Performance',
    'Effort',
    'Frustration'
]

df[cols] = df[cols].apply(pd.to_numeric, errors='coerce')

# Swipe Typing only
swipe = df[df['Input_method'] == 'Swipe Typing']

# Means
no_means = swipe[swipe['Subject ID'].isin(no)][cols].mean()
yes_means = swipe[swipe['Subject ID'].isin(yes)][cols].mean()

print("Means")
print(pd.DataFrame({
    'No': no_means,
    'Yes': yes_means
}).round(2))

print("\nANOVA Results")

for col in cols:
    no_values = swipe.loc[
        swipe['Subject ID'].isin(no), col
    ].dropna()

    yes_values = swipe.loc[
        swipe['Subject ID'].isin(yes), col
    ].dropna()

    f_stat, p_value = f_oneway(no_values, yes_values)

    print(
        f"{col:<20} "
        f"F={f_stat:.3f} "
        f"p={p_value:.4f}"
    )