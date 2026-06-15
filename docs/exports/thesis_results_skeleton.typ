// CHI-style Results skeleton — paste into Section V
// Data: formality_analysis_fixed_*.csv + NASA TLX Thesis.xlsx (N=19, 116 tasks)
// Style: descriptive reporting; move interpretation to Discussion

= Results

Nineteen participants contributed 116 task-level conversational trials. NASA-TLX was available for 18 participants (108 task-level ratings); P015 did not submit TLX. Unless stated otherwise, inferential tests were not conducted; we report descriptive means and standard deviations at the task level and note design constraints (within-subjects modality; between-subjects prompt register).

== RQ1: Linguistic formality

We analyzed participant replies and final replies using the fine-tuned DistilBERT formality classifier (Section IV). For each text, we report the predicted label (formal/informal) and softmax confidence.

=== First participant reply

Table @tbl:formality-reply summarises reply-level formality by input modality.

#figure(
  table(
    columns: 5,
    table.header[Modality][n][Mean confidence][SD][% classified formal],
    [Laptop keyboard], [38], [0.881], [0.133], [42.1%],
    [Mobile keyboard], [38], [0.869], [0.134], [26.3%],
    [Mobile swipe], [40], [0.829], [0.139], [27.5%],
  ),
  caption: [Reply-level formality classifier outputs by input modality (task-level, N = 19).],
) <tbl:formality-reply>

Across modalities, mean reply formality confidence ranged from 0.829 (mobile swipe) to 0.881 (laptop keyboard). The proportion of replies classified as formal was highest for laptop keyboard typing (42.1%) and lower for mobile keyboard (26.3%) and mobile swipe typing (27.5%). Prompt–reply label agreement (classifier labels) was 68.4% for laptop keyboard, 78.9% for mobile keyboard, and 75.0% for mobile swipe.

=== Final participant reply

#figure(
  table(
    columns: 5,
    table.header[Modality][n][Mean confidence][SD][% classified formal],
    [Laptop keyboard], [38], [0.904], [0.107], [36.8%],
    [Mobile keyboard], [38], [0.879], [0.131], [44.7%],
    [Mobile swipe], [40], [0.870], [0.111], [27.5%],
  ),
  caption: [Final-reply formality classifier outputs by input modality.],
) <tbl:formality-final>

=== Task medium (Messenger vs Email)

Mean reply formality confidence was similar for Email (M = 0.858, SD = 0.145, n = 60) and Messenger (M = 0.860, SD = 0.127, n = 56).

// Optional figure: grouped bar chart of % formal by modality (Jakob to match team palette)
// #figure(image("figures/formality_by_modality.pdf"), caption: [...]) <fig:formality-modality>

== RQ2: Response characteristics

We examined first participant replies using logged text length, sentence count, response time, and words per minute from the study platform.

#figure(
  table(
    columns: 5,
    table.header[Modality][n][Words (M, SD)][Chars (M, SD)][Response time s (M, SD)],
    [Laptop keyboard], [38], [12.26, 10.88], [67.08, 55.65], [68.69, 46.95],
    [Mobile keyboard], [38], [10.08, 8.95], [54.05, 47.06], [56.83, 37.61],
    [Mobile swipe], [40], [9.05, 9.55], [49.45, 50.75], [76.44, 52.15],
  ),
  caption: [First-reply response characteristics by input modality.],
) <tbl:response-chars>

Mean word count was highest for laptop keyboard replies (M = 12.26, SD = 10.88) and lowest for mobile swipe (M = 9.05, SD = 9.55). Mean words per minute followed the same pattern: laptop keyboard (M = 11.65, SD = 9.03), mobile keyboard (M = 10.76, SD = 7.54), and mobile swipe (M = 8.03, SD = 6.98). Mean sentence count per reply was near one across modalities (laptop: M = 1.16; mobile keyboard: M = 1.05; mobile swipe: M = 1.12).

Final replies were shorter than first replies (laptop: M = 5.84 words; mobile keyboard: M = 3.42; mobile swipe: M = 3.70).

== RQ3: Perceived workload (NASA-TLX)

Task-level NASA-TLX ratings (0–20 scale; n = 108 from 18 participants) showed the highest composite workload for mobile swipe typing (M = 7.98, SD = 3.17), followed by mobile keyboard typing (M = 6.00, SD = 3.65) and laptop keyboard typing (M = 5.02, SD = 2.21). Composite workload was computed from Mental Demand, Physical Demand, Temporal Demand, Effort, Frustration, and recoded Performance (20 − Performance).

Swipe typing had the highest mean dimension ratings for mental demand (M = 8.22), effort (M = 8.51), and frustration (M = 6.92). Laptop keyboard typing had the lowest mean ratings for frustration (M = 1.61) and temporal demand (M = 2.94). Informal-assigned participants had higher mean composite workload (M = 6.85, SD = 3.60) than formal-assigned participants (M = 5.06, SD = 1.73); prompt register was assigned between subjects (five formal-assigned participants with TLX vs. thirteen informal-assigned). TLX data were missing for P015.

#figure(
  image("figures/nasa_tlx_by_modality.pdf", width: 100%),
  caption: [
    Mean NASA-TLX ratings (0–20) by input modality.
    Error bars show standard error of the mean across task-level ratings (n = 18 participants).
    Performance is shown as raw ratings (higher = poorer self-rated performance).
  ],
) <fig-tlx-modality>
