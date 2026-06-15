#!/usr/bin/env python3
"""Generate NASA-TLX grouped bar chart by input modality (N=19 cohort).

Usage (from repo root):
  pip install matplotlib numpy
  python docs/exports/plot_nasa_tlx_modality.py

Inputs (relative to this script):
  data/good_labeled_data.csv
  data/NASA_TLX_Thesis.xlsx

Outputs:
  figures/nasa_tlx_by_modality.pdf
  figures/nasa_tlx_by_modality.png
"""

from __future__ import annotations

import csv
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
GOOD = DATA / "good_labeled_data.csv"
TLX = DATA / "NASA_TLX_Thesis.xlsx"
OUT_DIR = BASE / "figures"
OUT_DIR.mkdir(parents=True, exist_ok=True)

DIMS = [
    ("Mental Demand", "Mental"),
    ("Physical Demand", "Physical"),
    ("Temporal Demand", "Temporal"),
    ("Performance", "Performance"),
    ("Effort", "Effort"),
    ("Frustration", "Frustration"),
]
MODALITIES = [
    ("Laptop keyboard typing", "Laptop keyboard"),
    ("Mobile keyboard typing", "Mobile keyboard"),
    ("Mobile swipe typing", "Mobile swipe"),
]
MODALITY_COLORS = ["#4C72B0", "#55A868", "#C44E52"]
SPINE_COLOR = "#4A5568"
TEXT_COLOR = "#2D3748"
ERROR_COLOR = "#333333"


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


def norm_device(d: str) -> str:
    d = (d or "").strip().lower()
    if d in ("pc", "laptop"):
        return "PC"
    if d in ("mobile", "phone"):
        return "Mobile"
    return d


def norm_method(im: str) -> str:
    low = (im or "").strip().lower()
    if low == "typing":
        return "Typing"
    if "swipe" in low:
        return "Swipe typing"
    return (im or "").strip()


def study_modality(device: str, method: str) -> str:
    d, m = norm_device(device), norm_method(method)
    if d == "PC" and m == "Typing":
        return "Laptop keyboard typing"
    if d == "Mobile" and m == "Typing":
        return "Mobile keyboard typing"
    if d == "Mobile" and m == "Swipe typing":
        return "Mobile swipe typing"
    return ""


def read_xlsx(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for si in root.findall(".//m:si", ns):
                texts = [t.text or "" for t in si.findall(".//m:t", ns)]
                shared.append("".join(texts))
        sf = sorted(
            n for n in z.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")
        )[0]
        root = ET.fromstring(z.read(sf))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rows_out: list[list[str]] = []
        for row in root.findall(".//m:sheetData/m:row", ns):
            vals: list[str] = []
            for c in row.findall("m:c", ns):
                t = c.attrib.get("t")
                v = c.find("m:v", ns)
                if v is None or v.text is None:
                    vals.append("")
                elif t == "s":
                    vals.append(shared[int(v.text)])
                else:
                    vals.append(v.text)
            rows_out.append(vals)
    hdr = rows_out[0]
    out = []
    for r in rows_out[1:]:
        d = dict(zip(hdr, r + [""] * (len(hdr) - len(r))))
        if d.get("Subject ID"):
            out.append(d)
    return out


def main() -> None:
    if not GOOD.exists():
        raise SystemExit(f"Missing {GOOD}")
    if not TLX.exists():
        raise SystemExit(f"Missing {TLX}")

    cohort = {r["participant_id"] for r in csv.DictReader(GOOD.open(encoding="utf-8-sig"))}
    tlx_rows = read_xlsx(TLX)

    by_mod_dim: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in tlx_rows:
        pid = row["Subject ID"].strip().upper()
        if not re.match(r"P\d+", pid):
            m = re.match(r"P?(\d+)", pid, re.I)
            pid = f"P{int(m.group(1)):03d}" if m else pid
        if pid not in cohort:
            continue
        mod = study_modality(row.get("Device", ""), row.get("Input_method", ""))
        if not mod:
            continue
        for dim, _ in DIMS:
            by_mod_dim[mod][dim].append(float(row[dim]))

    means, sems = [], []
    for mod, _ in MODALITIES:
        m_row, s_row = [], []
        for dim, _ in DIMS:
            vals = by_mod_dim[mod][dim]
            m_row.append(float(np.mean(vals)) if vals else 0.0)
            s_row.append(
                float(np.std(vals, ddof=1) / np.sqrt(len(vals))) if len(vals) > 1 else 0.0
            )
        means.append(m_row)
        sems.append(s_row)

    apply_figure_style()

    x = np.arange(len(DIMS))
    width = 0.25
    fig, ax = plt.subplots(figsize=(7.0, 3.2))
    for i, ((_, label), color) in enumerate(zip(MODALITIES, MODALITY_COLORS)):
        offset = (i - 1) * width
        ax.bar(
            x + offset,
            means[i],
            width,
            yerr=sems[i],
            capsize=3,
            label=label,
            color=color,
            edgecolor="none",
            linewidth=0,
            error_kw={
                "ecolor": ERROR_COLOR,
                "elinewidth": 1.0,
                "capthick": 1.0,
            },
            zorder=3,
        )

    ax.set_ylabel("NASA-TLX rating (0–20)", fontsize=9)
    ax.set_xticks(x)
    ax.set_xticklabels([short for _, short in DIMS], fontsize=9)
    ax.set_ylim(0, 20)
    ax.set_yticks(range(0, 21, 2))
    ax.tick_params(axis="both", labelsize=9)
    ax.grid(axis="y", linestyle=":", linewidth=0.6, alpha=0.5, color="#CCCCCC", zorder=0)
    ax.set_axisbelow(True)
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines["left"].set_color(SPINE_COLOR)
    ax.spines["bottom"].set_color(SPINE_COLOR)

    fig.suptitle(
        "Mean NASA-TLX ratings by input modality",
        fontsize=10,
        fontweight="bold",
        y=1.06,
        color=TEXT_COLOR,
    )
    legend_handles = [
        Patch(facecolor=color, edgecolor="none", label=label)
        for (_, label), color in zip(MODALITIES, MODALITY_COLORS)
    ]
    fig.legend(
        handles=legend_handles,
        loc="upper center",
        bbox_to_anchor=(0.5, 0.995),
        ncol=3,
        frameon=False,
        fontsize=8,
        handlelength=1.1,
        handleheight=1.1,
        columnspacing=1.6,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.90))
    fig.savefig(OUT_DIR / "nasa_tlx_by_modality.pdf", bbox_inches="tight")
    fig.savefig(OUT_DIR / "nasa_tlx_by_modality.png", dpi=300, bbox_inches="tight")
    print(f"Wrote {OUT_DIR / 'nasa_tlx_by_modality.pdf'}")
    print(f"Wrote {OUT_DIR / 'nasa_tlx_by_modality.png'}")


if __name__ == "__main__":
    main()
