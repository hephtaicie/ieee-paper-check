#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib", "reportlab", "pikepdf"]
# ///
"""Generate the IEEE paper validation corpus.

Produces corpus/pdfs/<name>.pdf plus corpus/ground-truth.json.
Each mutant violates exactly one validation criterion; all other checks pass.

Usage: uv run tools/generate/make_corpus.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TECTONIC = ROOT / "tools" / "bin" / "tectonic"
SRC = ROOT / "corpus" / "src" / "latex"
VARIANTS = SRC / "variants"
FIGS = SRC / "figs"
OUT_PDFS = ROOT / "corpus" / "pdfs"
OUT_BUILD = ROOT / "corpus" / "build"

TITLE = (
    "A Data-Aware Approach for Parallel-in-Time AllReduce Simulation "
    "of Smart-Grid Workloads with PwrSim: A GNN Feasibility Study"
)

COPYRIGHT_TEXT = (
    r"978-1-6654-1234-5/25/\$31.00~\textcopyright~2025~IEEE\\ "
    r"2025 Fake Conference on Everything (FCE)"
)

COPYRIGHT_CMD = r"\IEEEcopyrightline{" + COPYRIGHT_TEXT + "}"

AUTHORS = r"""\author{\IEEEauthorblockN{Alice Dupont}
\IEEEauthorblockA{\textit{Department of Computer Science} \\
\textit{University of Lyon}\\
Lyon, France \\
alice.dupont@example.org}
\and
\IEEEauthorblockN{Robert Martin}
\IEEEauthorblockA{\textit{Department of Electrical Engineering} \\
\textit{Westgate Institute of Technology}\\
Boston, USA \\
robert.martin@example.org}
}"""

ANON_AUTHORS = r"""\author{\IEEEauthorblockN{Anonymous Author(s)}
\IEEEauthorblockA{Paper ID: 42 \\
Anonymous Affiliation \\
anon@anonymous.org}
}"""

PARAGRAPHS = [
    ("Parallel-in-time methods exploit concurrency across time steps to "
    "accelerate the numerical solution of initial value problems. When the "
    "underlying workload is data-aware, however, the coupling between "
    "storage latencies and coarse-grid corrections becomes the dominant "
    "cost factor. In this work we revisit the interaction between the "
    "iteration budget of a multigrid reduction-in-time scheme and the "
    "placement of its checkpointed state."),
    ("The smart-grid workload we target couples a power-flow solver with a "
    "short-term load forecast. Each forecast update triggers a re-solve of "
    "the coupled system, and the input impedance of the distribution feeder "
    "varies with the aggregated DER output. We model this as a parametrised "
    "nonlinear system whose Jacobian is refreshed only when the parameter "
    "drift exceeds a fixed threshold."),
    ("Data-aware scheduling treats checkpoint size, restart cost, and I/O "
    "bandwidth as first-class citizens of the placement problem. Previous "
    "studies assumed homogeneous storage tiers; we relax this assumption "
    "and show that a simple bandwidth-aware heuristic recovers most of the "
    "performance gap at a fraction of the engineering effort."),
    ("Our evaluation uses a 128-bus synthetic feeder driven by one year of "
    "hourly load measurements. We compare against a classical windowed "
    "checkpointing policy and against a recent pipelined Parareal variant. "
    "Across the full parameter sweep, the data-aware variant achieves a "
    "mean speedup of 3.4 with a tail latency under 40 ms per restart."),
    ("The theoretical iteration bound of the two-level scheme carries over "
    "to our setting with minor modifications: the coarse operator only "
    "needs to preserve the Lipschitz estimate of the fine propagator with "
    "respect to the checkpointed state. We verify this empirically by "
    "measuring the contraction factor over 500 consecutive windows."),
    ("Memory pressure is the second limiting factor. Because the state "
    "vector of the coupled solver is 18 GB per window, a naive in-memory "
    "scheme exhausts the node budget within three windows. We introduce a "
    "tiered eviction policy guided by the predicted reuse distance of each "
    "checkpoint, which reduces peak resident memory by 61 percent."),
    ("Failure handling differs from batch checkpointing: a lost fine window "
    "is recomputed concurrently with the ongoing sweep rather than "
    "serially. This requires the scheduler to reserve slack capacity in the "
    "following window. Our policy sizes this slack from the measured "
    "failure rate, converging to the reservation that minimises expected "
    "wall-clock time."),
    ("We finally discuss the portability of the approach to exascale "
    "systems with burst-buffer hierarchies. Early results on a two-tier "
    "storage simulator suggest the heuristic transfers without "
    "retuning, although the tail behaviour under concurrent failures "
    "warrants further study."),
]


def body(n_blocks: int) -> str:
    parts = [
        r"\section{Introduction}",
        ("Smart-grid simulation increasingly couples forecast-driven data "
        "pipelines with legacy time-stepping solvers, and the resulting "
        "workloads are both I/O-heavy and latency-sensitive. We propose a "
        "data-aware scheduling layer for parallel-in-time integration that "
        "co-locates checkpoints with the windows that consume them."),
    ]
    for i in range(n_blocks):
        parts.append(rf"\section{{Study {i + 1}: Sensitivity Analysis}}")
        for j in range(3):
            parts.append(PARAGRAPHS[(i * 3 + j) % len(PARAGRAPHS)])
        parts.append(
            "The results reported here follow the methodology of "
            "Section~\\ref{sec:method} and use the notation of "
            "Eq.~\\eqref{eq:main}."
        )
    parts.extend(
        [
            r"\section{Method}\label{sec:method}",
            ("The scheduler minimises the expected completion time subject "
            "to a memory budget and a per-window deadline. The core update "
            "reads:"),
            (r"\begin{equation}\tau_{k+1} = \alpha\,\tau_k + "
            r"(1-\alpha)\,\frac{B_k}{R_k}\label{eq:main}\end{equation}"),
            ("where $B_k$ is the residual bandwidth of tier $k$, $R_k$ its "
            "observed restart rate, and $\\alpha$ a smoothing factor."),
            r"\section{Evaluation}",
            ("We run the feeder model on 64 nodes for one simulated year. "
            "The baseline completes in 11.2 hours; the data-aware variant "
            "in 3.3 hours. Restart overheads remain below five percent "
            "for all windows with reuse distance under 20."),
            r"\section{Conclusion}",
            ("Bandwidth-aware checkpoint placement closes most of the gap "
            "between ideal and measured speedup for data-aware "
            "parallel-in-time workloads, at low engineering cost."),
            r"\section*{Acknowledgment}",
            "The authors thank the anonymous operators of the test feeder.",
        ]
    )
    return "\n\n".join(parts)


def make_bib(n: int) -> str:
    return "\n\n".join(
        rf"\bibitem{{b{i}}} A. Author{i}, ``Study {i} on parallel-in-time "
        rf"integration of data-aware workloads,'' J. Simul. Workloads, "
        rf"vol. {i + 1}, no. 2, pp. {10 * i}--{10 * i + 9}, 2020."
        for i in range(1, n + 1)
    )


BIB = make_bib(12)

BASE_TEMPLATE = r"""\documentclass[conference]{IEEEtran}
\IEEEoverridecommandlockouts
\usepackage{cite}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{textcomp}
\usepackage{tikz}
% Copyright line anchored below the text block, bottom-left of page 1,
% as inserted by IEEE PDF eXpress in camera-ready papers.
\newcommand{\IEEEcopyrightline}[1]{%
\begin{tikzpicture}[overlay,remember picture]
\node[anchor=south west,inner sep=0,text width=2.6in,
      align=left,font=\footnotesize]
  at ([xshift=0.75in,yshift=0.32in]current page.south west)
  {#1};
\end{tikzpicture}%
}
\begin{document}

\title{__TITLE__}

__AUTHORS__

\maketitle
__COPYRIGHT__

\begin{abstract}
Parallel-in-time integration is attractive for coupled smart-grid
simulations, but checkpoint placement is usually data-oblivious. We
propose a data-aware scheduler that co-places coarse-grid corrections
with their consuming fine windows, guided by predicted reuse distance.
On a one-year synthetic feeder trace our method reaches a mean speedup
of 3.4 over windowed checkpointing while capping restart latency.
\end{abstract}

\begin{IEEEkeywords}
parallel-in-time, data-aware scheduling, smart grid, checkpointing.
\end{IEEEkeywords}

__COPYRIGHT__

__BODY__

__PRE_REFS__
\begin{thebibliography}{00}
__BIB__
\end{thebibliography}

__EXTRA__
\end{document}
"""


def render(
    title: str = TITLE,
    authors: str = AUTHORS,
    copyright: str = COPYRIGHT_CMD,
    n_blocks: int = 20,
    extra: str = "",
    preamble: str = "",
    pre_refs: str = "",
    bib: str = BIB,
) -> str:
    tex = BASE_TEMPLATE
    if preamble:
        tex = tex.replace("\\IEEEoverridecommandlockouts", preamble + "\\IEEEoverridecommandlockouts")
    tex = tex.replace("__TITLE__", title)
    tex = tex.replace("__AUTHORS__", authors)
    tex = tex.replace("__COPYRIGHT__", copyright)
    tex = tex.replace("__BODY__", body(n_blocks))
    tex = tex.replace("__PRE_REFS__", pre_refs)
    tex = tex.replace("__BIB__", bib)
    tex = tex.replace("__EXTRA__", extra)
    return tex


SC_PREAMBLE = (
    "\\usepackage{fontspec}\n\\setmainfont{TeX Gyre Termes}\n"
)

ARTIFACT_EXTRA = r"""
\appendices
\section{Artifact Description}
The complete source tree of the simulator, the scheduler, and the
analysis scripts is archived on Zenodo with DOI 10.5281/zenodo.0000000.

\section{Artifact Evaluation}
The artifact was evaluated against the reproducibility checklist of the
evaluated track. All results in Section IV were regenerated within the
two-hour evaluation window.
"""

UNDEF_REFS_APPEND = (
    "As established by the baseline protocol of Fig.~\\ref{missing-fig} "
    "and the taxonomy of Section~\\ref{missing-sec}, our measurements "
    "confirm the trend. See also \\cite{missing-cite}."
)

VARIANTS_SPEC: dict[str, dict] = {
    # name: {tex: str, expected: {check: "FAIL"|...}}
    "good": {
        "tex": render(),
        "expected": {},
    },
    # Edge case: content ends on p12, references spill onto p13 -> PASS.
    "good_refs_spill": {
        "tex": render(n_blocks=53),
        "expected": {},
    },
    # Edge case: content ends on p12, References heading opens p13 and the
    # bibliography runs through p14 -> PASS (references excluded).
    "good_refs_start13": {
        "tex": render(n_blocks=53, pre_refs=r"\clearpage", bib=make_bib(60)),
        "expected": {},
    },
    # Edge case: references start on p11 and span three pages -> PASS.
    "good_refs_long": {
        "tex": render(n_blocks=48, bib=make_bib(60)),
        "expected": {},
    },
    "bad_copyright": {
        "tex": render(copyright="% copyright removed\n"),
        "expected": {"copyright": "FAIL"},
    },
    "bad_title_case": {
        "tex": render(
            title="A data-aware approach for Parallel-in-time Simulation "
            "of smart-grid Workloads"
        ),
        "expected": {"title": "FAIL"},
    },
    "bad_title_allcaps": {
        "tex": render(title=TITLE.upper()),
        "expected": {"title": "FAIL"},
    },
    "bad_title_smallcaps": {
        "tex": render(
            title="\\textsc{A Data-Aware Approach for Parallel-in-Time "
            "Simulation of Smart-Grid Workloads}",
            preamble=SC_PREAMBLE,
        ),
        "expected": {"title": "FAIL"},
    },
    "bad_undef_refs": {
        "tex": render(n_blocks=6)
        .replace(
            "data-oblivious. We",
            "data-oblivious (" + UNDEF_REFS_APPEND + "). We",
            1,
        ),
        "expected": {"undefined_refs": "FAIL"},
    },
    "bad_pagenumbers": {
        "tex": render(n_blocks=6).replace(
            "\\maketitle", "\\maketitle\n\\pagestyle{plain}\n\\thispagestyle{plain}"
        ),
        "expected": {"page_numbers": "FAIL"},
    },
    "bad_too_long": {
        "tex": render(n_blocks=60),
        "expected": {"page_limit": "FAIL"},
    },
    # Style mutants: one violation each of the camera-ready style rules.
    "bad_style_colored": {
        "tex": render(n_blocks=6).replace(
            "data-oblivious. We",
            "data-oblivious. {\\color{red}Beware that checkpoint placement "
            "must never be tuned on the evaluation trace, or the reported "
            "speedup is optimistic.} We",
            1,
        ),
        "expected": {"style": "FAIL"},
    },
    "bad_style_size": {
        "tex": render(n_blocks=6, preamble="\\usepackage{xcolor}\n").replace(
            "The smart-grid workload we target couples",
            "{\\fontsize{9}{10.8}\\selectfont The smart-grid workload we target couples",
            1,
        ).replace(
            "varies with the aggregated DER output. We model this as a parametrised",
            "varies with the aggregated DER output.} We model this as a parametrised",
            1,
        ),
        "expected": {"style": "FAIL"},
    },
    "bad_style_bibfont": {
        "tex": render(n_blocks=6, preamble="\\usepackage{lmodern}\n").replace(
            r"\begin{thebibliography}{00}",
            r"\begin{thebibliography}{00}\sffamily",
        ),
        "expected": {"style": "FAIL"},
    },
    "bad_artifact": {
        "tex": render(n_blocks=6, extra=ARTIFACT_EXTRA),
        "expected": {"artifact_appendix": "FAIL", "appendix": "FAIL"},
    },
    "bad_anonymized": {
        "tex": render(authors=ANON_AUTHORS, n_blocks=6),
        "expected": {"anonymized": "FAIL"},
    },
}

ALL_CHECKS = [
    "copyright",
    "appendix",
    "title",
    "artifact_appendix",
    "anonymized",
    "undefined_refs",
    "page_limit",
    "page_numbers",
    "fonts_embedded",
    "fonts_type3",
]


def make_fig_type3(path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["pdf.fonttype"] = 3  # classic Type 3 offender
    fig, ax = plt.subplots(figsize=(4, 3))
    xs = list(range(1, 21))
    ax.plot(xs, [x**2 for x in xs], label=r"$f(x)=x^2$")
    ax.set_xlabel(r"window index $k$")
    ax.set_ylabel(r"cost $\tau_k$")
    ax.legend()
    fig.savefig(path, format="pdf")
    plt.close(fig)


def make_fig_unembedded(path: Path) -> None:
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=(288, 216))
    c.setFont("Times-Roman", 12)  # base-14: never embedded by reportlab
    c.drawString(20, 180, "Baseline restart cost over 20 windows")
    c.setFont("Times-Italic", 10)
    c.drawString(20, 160, "Times-Roman, Helvetica and Courier are base-14")
    c.drawString(20, 146, "fonts that remain unembedded in the PDF.")
    steps = [i**2 for i in range(20)]
    c.setFont("Times-Roman", 8)
    for i, s in enumerate(steps):
        c.line(20 + i * 12, 20, 20 + i * 12, 20 + s / 4)
    c.showPage()
    c.save()


def compile_variant(name: str, tex: str) -> Path | None:
    vdir = VARIANTS / name
    vdir.mkdir(parents=True, exist_ok=True)
    cls = SRC / "IEEEtran.cls"
    if not (vdir / "IEEEtran.cls").exists():
        shutil.copy(cls, vdir / "IEEEtran.cls")
    texfile = vdir / f"{name}.tex"
    texfile.write_text(tex)
    bdir = OUT_BUILD / name
    bdir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [str(TECTONIC), "--outdir", str(bdir), str(texfile)],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    pdf = bdir / f"{name}.pdf"
    if proc.returncode != 0 or not pdf.exists():
        print(f"[{name}] COMPILE FAILED\n{proc.stdout}\n{proc.stderr}", file=sys.stderr)
        return None
    return pdf


def lowercase_tounicode(src: Path, dest: Path) -> None:
    """Make the small-cap glyphs report lowercase in the text layer.

    XeTeX assigns small-cap glyphs to high CIDs and maps them to
    UPPERCASE in ToUnicode. Remapping targets of entries with
    CID >= 0x0300 from 0041-005A to 0061-007A reproduces the
    MS Word behaviour (normal-looking text layer over small caps).
    """
    import re

    import pikepdf

    pdf = pikepdf.open(src)
    n = 0
    for obj in pdf.objects:
        try:
            is_font = str(obj.get("/Type")) == "/Font"
        except Exception as e:  # noqa: BLE001 -- skip non-font objects
            print(f"  [lowercase_tounicode] skipping object: {e}")
            continue
        if not is_font:
            continue
        tu = obj.get("/ToUnicode")
        if tu is None:
            continue
        data = tu.read_bytes().decode("latin-1")
        changed = data

        def lower(m: re.Match[str]) -> str:
            cid = int(m.group(1), 16)
            tgt = int(m.group(2), 16)
            if cid >= 0x0300 and 0x41 <= tgt <= 0x5A:
                return f"<{m.group(1)}> <{tgt + 0x20:04X}>"
            return m.group(0)

        changed = re.sub(r"<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>", lower, changed)
        if changed != data:
            tu.write(changed.encode("latin-1"))
            n += 1
    pdf.save(dest)
    pdf.close()
    if n == 0:
        raise RuntimeError("no ToUnicode stream rewritten")


def merge_after(paper: Path, figpdf: Path, dest: Path) -> None:
    """Append the figure page inside a normal letter-size page so the
    merged page keeps document geometry (like an included figure)."""
    import pikepdf

    out = pikepdf.open(paper)
    extra = pikepdf.open(figpdf)
    out.pages.extend(extra.pages)
    last = out.pages[-1]
    last.MediaBox = pikepdf.Array([0, 0, 612, 792])
    out.save(dest)
    out.close()
    extra.close()


def main() -> int:
    for d in (VARIANTS, FIGS, OUT_PDFS, OUT_BUILD):
        d.mkdir(parents=True, exist_ok=True)

    fig3 = FIGS / "fig_type3.pdf"
    figun = FIGS / "fig_unembedded.pdf"
    if not fig3.exists():
        make_fig_type3(fig3)
    if not figun.exists():
        make_fig_unembedded(figun)

    ground_truth = {}

    for name, spec in VARIANTS_SPEC.items():
        pdf = compile_variant(name, spec["tex"])
        if pdf is None:
            return 1
        dest = OUT_PDFS / f"{name}.pdf"
        shutil.copy(pdf, dest)
        expected = {c: "PASS" for c in ALL_CHECKS}
        for c, status in spec["expected"].items():
            expected[c] = status
        ground_truth[name] = {"file": f"{name}.pdf", "expected": expected}
        print(f"[{name}] built -> {dest}")

    # Hard case: small caps with a LOWERCASE text layer (MS Word-like).
    # Surgery: remap the small-cap glyphs' ToUnicode targets (uppercase)
    # to lowercase so the text layer looks normal.
    lowercase_tounicode(OUT_PDFS / "bad_title_smallcaps.pdf",
                        OUT_PDFS / "bad_title_smallcaps_lct.pdf")
    expected = {c: "PASS" for c in ALL_CHECKS}
    expected["title"] = "FAIL"
    ground_truth["bad_title_smallcaps_lct"] = {
        "file": "bad_title_smallcaps_lct.pdf",
        "expected": expected,
        "requires": "model_tier",
        "note": (
            "Small caps with lowercase text layer (MS Word native export "
            "behaviour): glyph heights cannot distinguish small caps from "
            "x-height in Times-metric fonts. Detected only by the optional "
            "model tier (granite-docling)."
        ),
    }
    print("[bad_title_smallcaps_lct] built (ToUnicode surgery)")

    # Font mutants: real good paper + extra figure page appended.
    good = OUT_PDFS / "good.pdf"
    merge_after(good, fig3, OUT_PDFS / "bad_type3.pdf")
    merge_after(good, figun, OUT_PDFS / "bad_unembedded.pdf")
    for fname, failing in (
        ("bad_type3", "fonts_type3"),
        ("bad_unembedded", "fonts_embedded"),
    ):
        expected = {c: "PASS" for c in ALL_CHECKS}
        expected[failing] = "FAIL"
        ground_truth[fname] = {"file": f"{fname}.pdf", "expected": expected}
        print(f"[{fname}] built (merged font figure page)")

    gt_path = ROOT / "corpus" / "ground-truth.json"
    gt_path.write_text(json.dumps(ground_truth, indent=2) + "\n")
    print(f"ground truth -> {gt_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
