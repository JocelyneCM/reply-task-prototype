// RQ1 and RQ2 Results — descriptive only (N=19, 116 task-level trials)
// Source: formality_analysis_fixed_detailed.csv + good_labeled_data.csv

== RQ1: Linguistic formality

We analyzed the first and final participant replies from 116 task-level trials (19 participants) using the fine-tuned DistilBERT formality classifier described in Section IV. For each reply, we report the predicted label (formal or informal) and softmax confidence. Prompt register was assigned between subjects (six formal-assigned, thirteen informal-assigned); task medium (Messenger vs. Email) varied within participants. Inferential tests were not conducted; we report task-level descriptive statistics.

=== First participant replies

#figure(
  table(
    columns: 5,
    table.header[Input modality][n][Mean confidence][SD][Classified formal],
    [Laptop keyboard typing], [38], [0.881], [0.133], [42.1% (16/38)],
    [Mobile keyboard typing], [38], [0.869], [0.134], [26.3% (10/38)],
    [Mobile swipe typing], [40], [0.829], [0.139], [27.5% (11/40)],
  ),
  caption: [First-reply formality classifier outputs by input modality.],
) <tbl:rq1-reply>

Mean reply formality confidence ranged from 0.829 (mobile swipe typing) to 0.881 (laptop keyboard typing). The proportion of first replies classified as formal was 42.1% for laptop keyboard typing, 26.3% for mobile keyboard typing, and 27.5% for mobile swipe typing. Prompt-label agreement (prompt classifier label matched reply classifier label) was 68.4% for laptop keyboard trials, 78.9% for mobile keyboard trials, and 75.0% for mobile swipe trials.

#figure(
  image("figures/rq1_formality_confidence.pdf", width: 100%),
  caption: [
    Distribution of formality-classification confidence scores across input modalities.
    Responses are grouped by predicted formality label (formal/informal).
    Points represent individual task-level first replies; boxplots show median and interquartile range.
  ],
) <fig-rq1-confidence>

=== Final participant replies

#figure(
  table(
    columns: 5,
    table.header[Input modality][n][Mean confidence][SD][Classified formal],
    [Laptop keyboard typing], [38], [0.904], [0.107], [36.8% (14/38)],
    [Mobile keyboard typing], [38], [0.879], [0.131], [44.7% (17/38)],
    [Mobile swipe typing], [40], [0.870], [0.111], [27.5% (11/40)],
  ),
  caption: [Final-reply formality classifier outputs by input modality.],
) <tbl:rq1-final>

Mean final-reply confidence ranged from 0.870 (mobile swipe typing) to 0.904 (laptop keyboard typing). The proportion classified as formal was 44.7% for mobile keyboard typing, 36.8% for laptop keyboard typing, and 27.5% for mobile swipe typing. Prompt-label agreement for final replies was 63.2% (laptop keyboard), 50.0% (mobile keyboard), and 60.0% (mobile swipe).

=== Task medium and assigned prompt register

By task medium, mean first-reply confidence was 0.858 (SD = 0.145, n = 60) for Email and 0.860 (SD = 0.127, n = 56) for Messenger. The proportion of first replies classified as formal was 35.0% in Email trials and 28.6% in Messenger trials.

By assigned prompt register (between subjects), mean first-reply confidence was 0.874 (SD = 0.147, n = 38) for formal-assigned participants and 0.852 (SD = 0.131, n = 78) for informal-assigned participants. The proportion classified as formal was 52.6% and 21.8%, respectively.

== RQ2: Response characteristics

We examined logged characteristics of first participant replies across the same 116 trials. Metrics included word count, character count, estimated sentence count, response time (seconds), words per minute, keypress count, and backspace count. Final replies were shorter than first replies across modalities. Inferential tests were not conducted.

=== First participant replies

#figure(
  table(
    columns: 4,
    table.header[Input modality][n][Words (M, SD)][Characters (M, SD)],
    [Laptop keyboard typing], [38], [12.26, 10.88], [67.08, 55.65],
    [Mobile keyboard typing], [38], [10.08, 8.95], [54.05, 47.06],
    [Mobile swipe typing], [40], [9.05, 9.55], [49.45, 50.75],
  ),
  caption: [First-reply length by input modality.],
) <tbl:rq2-length>

#figure(
  table(
    columns: 4,
    table.header[Input modality][n][Response time s (M, SD)][WPM (M, SD)],
    [Laptop keyboard typing], [38], [68.69, 46.95], [11.65, 9.03],
    [Mobile keyboard typing], [38], [56.83, 37.61], [10.76, 7.54],
    [Mobile swipe typing], [40], [76.44, 52.15], [8.03, 6.98],
  ),
  caption: [First-reply timing and throughput by input modality.],
) <tbl:rq2-timing>

Mean first-reply word count was highest for laptop keyboard typing (M = 12.26, SD = 10.88) and lowest for mobile swipe typing (M = 9.05, SD = 9.55). Mean estimated sentence count per first reply was near one across modalities (laptop: M = 1.16, SD = 0.37; mobile keyboard: M = 1.05, SD = 0.32; mobile swipe: M = 1.12, SD = 0.33). Mean response time was longest for mobile swipe typing (M = 76.44 s, SD = 52.15) and shortest for mobile keyboard typing (M = 56.83 s, SD = 37.61). Mean words per minute was highest for laptop keyboard typing (M = 11.65, SD = 9.03) and lowest for mobile swipe typing (M = 8.03, SD = 6.98).

Mean keypress count was highest for laptop keyboard typing (M = 88.76, SD = 70.60) and lowest for mobile swipe typing (M = 42.30, SD = 49.21). Mean backspace count was highest for laptop keyboard typing (M = 7.47, SD = 8.57) and lowest for mobile keyboard typing (M = 4.63, SD = 5.31).

By task medium, mean first-reply word count was 11.77 (SD = 10.20, n = 60) for Email and 9.02 (SD = 9.29, n = 56) for Messenger.

=== Final participant replies

Mean final-reply word count was 5.84 (SD = 5.26, n = 38) for laptop keyboard typing, 3.42 (SD = 3.01, n = 38) for mobile keyboard typing, and 3.70 (SD = 3.35, n = 40) for mobile swipe typing.
