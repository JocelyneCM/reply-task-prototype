# Results data bundle — quick guide (N = 19)

Everything you need to reproduce the Results section: **19 participants, 116 tasks**.

**Start here:** open `data/good_labeled_data.csv` — that is the main study file.

---

## Which file is which?

| Question | File |
|---|---|
| **Main study data?** | `data/good_labeled_data.csv` (116 rows — replies, timing, formality scores, etc.) |
| **TLX (workload) data?** | `data/NASA_TLX_Thesis.xlsx` |
| **Formality agreement numbers?** | `data/formality_analysis_fixed_detailed.csv` |

Optional extras in `data/`: participant/prompt formality summaries (`.csv` / `.json`) and `_analysis_summary.json` (precomputed TLX stats).

---

## Why two RQ1 files?

Most RQ1 numbers (mean confidence, % formal, breakdowns by modality) come from **`good_labeled_data.csv`**.

The **prompt–reply agreement** percentages (e.g. 68.4% laptop keyboard, first reply) come from **`formality_analysis_fixed_detailed.csv`**.

Reason: on **2 trials** (P007, P009), the prompt formality label differs between those two files. Everything else matches. Use the detailed file **only** for agreement stats.

---

## Which file supports each research question?

| RQ | What it covers | File |
|---|---|---|
| **RQ1** Formality | Confidence, formal/informal counts, medium & register | `good_labeled_data.csv` |
| **RQ1** Agreement | Prompt label vs reply label match rates | `formality_analysis_fixed_detailed.csv` |
| **RQ2** Response stats | Word count, time, WPM, keypresses, backspaces | `good_labeled_data.csv` |
| **RQ3** Workload | NASA-TLX dimension means and composites | `NASA_TLX_Thesis.xlsx` + participant list from `good_labeled_data.csv` |

**Cohort:** P003–P030 except P002, P013, P017, P019, P021. P015 has no TLX → 108 TLX ratings from 18 people.

---

## Which script makes which figure?

Run from the **repo root** (needs Python 3, `matplotlib`, `numpy`):

```bash
pip install matplotlib numpy
python docs/exports/plot_nasa_tlx_modality.py
python docs/exports/plot_rq1_formality_confidence.py
```

| Script | Reads | Writes |
|---|---|---|
| `plot_nasa_tlx_modality.py` | `good_labeled_data.csv` + `NASA_TLX_Thesis.xlsx` | `figures/nasa_tlx_by_modality.pdf` / `.png` (Fig. 4) |
| `plot_rq1_formality_confidence.py` | `good_labeled_data.csv` | `figures/rq1_formality_confidence.pdf` / `.png` |

---

## Suggested reading order for a new teammate

1. **This file** — orientation
2. **`data/good_labeled_data.csv`** — one row per task; check columns and participant IDs
3. **`docs/exports/thesis_rq1_rq2_results.typ`** — text that was written from these files
4. **`data/formality_analysis_fixed_detailed.csv`** — only if checking agreement numbers
5. **`data/NASA_TLX_Thesis.xlsx`** — only for RQ3 / TLX figure
6. **`docs/exports/LLM_EVIDENCE.md`** — what model the app was configured to use (separate from Results numbers)
