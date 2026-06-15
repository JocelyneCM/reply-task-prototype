#!/usr/bin/env python3
"""RQ1 figure: first-reply formality confidence by modality and predicted label.

Usage (from repo root):
  pip install matplotlib numpy
  python docs/exports/plot_rq1_formality_confidence.py

Input:
  data/good_labeled_data.csv

Outputs:
  figures/rq1_formality_confidence.pdf
  figures/rq1_formality_confidence.png
"""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

BASE = Path(__file__).resolve().parent
GOOD = BASE / "data" / "good_labeled_data.csv"
OUT_DIR = BASE / "figures"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MODALITIES = [
    ("Laptop keyboard typing", "Laptop\nkeyboard"),
    ("Mobile keyboard typing", "Mobile\nkeyboard"),
    ("Mobile swipe typing", "Mobile\nswipe"),
]
LABELS = [("formal", "Formal"), ("informal", "Informal")]
COLORS = {"formal": "#2C5282", "informal": "#90CDF4"}
SPINE_COLOR = "#4A5568"
TEXT_COLOR = "#2D3748"


def apply_figure_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "sans-serif",
            "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
            "axes.labelcolor": TEXT_COLOR,
            "xtick.color": TEXT_COLOR,
            "ytick.color": TEXT_COLOR,
        }
    )


def study_modality(device: str, method: str) -> str:
    d = (device or "").strip().lower()
    im = (method or "").strip().lower()
    if d in ("pc", "laptop") and im == "typing":
        return "Laptop keyboard typing"
    if d in ("mobile", "phone") and im == "typing":
        return "Mobile keyboard typing"
    if d in ("mobile", "phone") and "swipe" in im:
        return "Mobile swipe typing"
    return ""


def norm_label(label: str) -> str:
    lab = (label or "").strip().lower()
    if lab in ("formal", "label_1"):
        return "formal"
    if lab in ("informal", "label_0"):
        return "informal"
    return lab


def load_data() -> dict[str, dict[str, list[float]]]:
    if not GOOD.exists():
        raise SystemExit(f"Missing {GOOD}")

    data: dict[str, dict[str, list[float]]] = {
        mod: {"formal": [], "informal": []} for mod, _ in MODALITIES
    }
    with GOOD.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            mod = study_modality(row.get("Device", ""), row.get("input_method", ""))
            if not mod:
                continue
            label = norm_label(row.get("reply_formality_label", ""))
            if label not in ("formal", "informal"):
                continue
            conf = float(row.get("reply_formality_confidence") or 0)
            data[mod][label].append(conf)
    return data


def main() -> None:
    apply_figure_style()
    data = load_data()

    fig, axes = plt.subplots(1, 3, figsize=(7.0, 2.8), sharey=True)
    rng = np.random.default_rng(42)

    for ax, (mod_key, mod_title) in zip(axes, MODALITIES):
        positions = [1, 2]
        box_data = [data[mod_key]["formal"], data[mod_key]["informal"]]
        bp = ax.boxplot(
            box_data,
            positions=positions,
            widths=0.55,
            patch_artist=True,
            showfliers=False,
            medianprops={"color": "#1A202C", "linewidth": 1.2},
            whiskerprops={"color": "#4A5568", "linewidth": 0.8},
            capprops={"color": "#4A5568", "linewidth": 0.8},
            boxprops={"linewidth": 0.8},
        )
        for patch, (label_key, _) in zip(bp["boxes"], LABELS):
            patch.set_facecolor(COLORS[label_key])
            patch.set_alpha(0.85)

        for pos, (label_key, _), vals in zip(positions, LABELS, box_data):
            if not vals:
                continue
            jitter = rng.uniform(-0.10, 0.10, size=len(vals))
            ax.scatter(
                np.full(len(vals), pos) + jitter,
                vals,
                s=10,
                color=COLORS[label_key],
                alpha=0.35,
                edgecolors="none",
                zorder=3,
            )
            ax.text(
                pos,
                0.36,
                f"n={len(vals)}",
                ha="center",
                va="bottom",
                fontsize=7.5,
                color="#2D3748",
            )

        ax.set_xticks(positions)
        ax.set_xticklabels([title for _, title in LABELS], fontsize=8)
        ax.set_title(mod_title, fontsize=9, pad=6)
        ax.set_xlim(0.4, 2.6)
        ax.set_ylim(0.35, 1.0)
        ax.set_yticks([0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
        ax.grid(axis="y", linestyle=":", linewidth=0.6, alpha=0.5, color="#CCCCCC")
        ax.set_axisbelow(True)
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines["left"].set_color(SPINE_COLOR)
        ax.spines["bottom"].set_color(SPINE_COLOR)

    axes[0].set_ylabel("Formality confidence", fontsize=9)
    fig.suptitle(
        "First-reply formality confidence by input modality and predicted label",
        fontsize=10,
        fontweight="bold",
        y=1.06,
        color=TEXT_COLOR,
    )

    handles = [
        plt.Line2D(
            [0],
            [0],
            marker="s",
            color="w",
            markerfacecolor=COLORS["formal"],
            markersize=7,
            label="Formal (predicted)",
        ),
        plt.Line2D(
            [0],
            [0],
            marker="s",
            color="w",
            markerfacecolor=COLORS["informal"],
            markersize=7,
            label="Informal (predicted)",
        ),
    ]
    fig.legend(
        handles=handles,
        loc="lower center",
        bbox_to_anchor=(0.5, -0.08),
        ncol=2,
        frameon=False,
        fontsize=8,
    )
    fig.tight_layout()
    fig.savefig(OUT_DIR / "rq1_formality_confidence.pdf", bbox_inches="tight")
    fig.savefig(OUT_DIR / "rq1_formality_confidence.png", dpi=300, bbox_inches="tight")
    print(f"Wrote {OUT_DIR / 'rq1_formality_confidence.pdf'}")
    print(f"Wrote {OUT_DIR / 'rq1_formality_confidence.png'}")


if __name__ == "__main__":
    main()
