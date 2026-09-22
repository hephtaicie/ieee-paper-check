#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Word-track corpus generator.

Mutates the IEEE Word conference template (.docx) via OOXML surgery,
converts each variant to PDF with headless LibreOffice, and merges the
expected results into corpus/ground-truth.json.

Usage: uv run tools/generate/make_corpus_word.py
"""

from __future__ import annotations

import json
import re
import subprocess
import zipfile
from pathlib import Path
from typing import NotRequired, TypedDict

ROOT = Path(__file__).resolve().parents[2]
UNPACKED = ROOT / "corpus" / "src" / "word" / "base" / "unpacked"
VDIR = ROOT / "corpus" / "src" / "word" / "variants"
OUT_PDFS = ROOT / "corpus" / "pdfs"

TITLE = (
    "A Data-Aware Approach for Parallel-in-Time AllReduce Simulation "
    "of Smart-Grid Workloads with PwrSim: A GNN Feasibility Study"
)
TITLE_BAD_CASE = (
    "A data-aware approach for Parallel-in-time Simulation of "
    "smart-grid Workloads with pwrSim: a feasibility Study"
)
TEMPLATE_COPYRIGHT = "XXX-X-XXXX-XXXX-X/XX/$XX.00 ©20XX IEEE"
REAL_COPYRIGHT = "978-1-6654-1234-5/25/$31.00 ©2025 IEEE"
AUTHORS = ["Alice Dupont", "Robert Martin"]

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

TITLE_PARA_RE = re.compile(
    r'<w:p\b[^>]*>(?:(?!</w:p>).)*?<w:pStyle w:val="papertitle"/>(?:(?!</w:p>).)*?</w:p>',
    re.DOTALL,
)

PAGE_NUMBER_PARA = (
    "<w:p><w:pPr><w:pStyle w:val=\"Footer\"/><w:jc w:val=\"center\"/></w:pPr>"
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    "<w:r><w:t>2</w:t></w:r>"
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
)


def title_para(text: str, smallcaps: bool = False, allcaps: bool = False) -> str:
    rpr = ""
    if smallcaps:
        rpr = "<w:rPr><w:smallCaps/></w:rPr>"
    if allcaps:
        rpr = "<w:rPr><w:caps/></w:rPr>"
    return (
        '<w:p><w:pPr><w:pStyle w:val="papertitle"/></w:pPr>'
        f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    )


def replace_authors(xml: str, names: list[str]) -> str:
    pool = (names[i % len(names)] for i in range(100))
    return re.sub(r"Given Name Surname", lambda m: next(pool), xml)


# Template guidance the IEEE instructions say to delete before submission:
# the red notice after the references and the embedded how-to paragraphs.
# Keeping them would trip the style check (coloured text) and would model
# an incomplete camera-ready paper.
GUIDANCE_MARKERS = [
    "IEEE conference templates contain guidance text",
    "Do not add any kind of pagination anywhere in the paper",
    "Do not number text heads",
    "Equipment and supplies",
    "equipment and supplies",  # lowercase variant inside the how-to list
    "E. Some Common Mistakes",
    "D. Some Common Mistakes",
    "C. Some Common Mistakes",
]


def para_text(para: str) -> str:
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", para))


def strip_guidance(xml: str) -> str:
    out = []
    pos = 0
    for m in re.finditer(r"<w:p[ >].*?</w:p>", xml, re.DOTALL):
        text = para_text(m.group(0))
        if any(k in text for k in GUIDANCE_MARKERS):
            out.append(xml[pos : m.start()])
            pos = m.end()
    out.append(xml[pos:])
    return "".join(out)


def replace_title(xml: str, new_title_para: str) -> str:
    m = TITLE_PARA_RE.search(xml)
    if not m:
        raise RuntimeError("papertitle paragraph not found")
    return xml[: m.start()] + new_title_para + xml[m.end() :]


def add_page_numbers(doc: str, rels: str, content_types: str) -> tuple[str, str, str]:
    footer1 = (UNPACKED / "word" / "footer1.xml").read_text()
    start = footer1.index("<w:ftr ")
    ns = footer1[start : footer1.index(">", start) + 1]
    footer2 = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + ns
        + PAGE_NUMBER_PARA
        + "</w:ftr>"
    )
    (VDIR / "_footer2.xml").write_text(footer2)
    rels = rels.replace(
        "</Relationships>",
        '<Relationship Id="rId13" Type="http://purl.oclc.org/ooxml/officeDocument/'
        'relationships/footer" Target="footer2.xml"/></Relationships>',
    )
    content_types = content_types.replace(
        "</Types>",
        '<Override PartName="/word/footer2.xml" ContentType="application/vnd.'
        'openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
    )
    first = doc.index("<w:sectPr")
    first_end = doc.index(">", first) + 1
    doc = (
        doc[:first_end]
        + '<w:footerReference w:type="default" r:id="rId13"/>'
        + doc[first_end:]
    )
    return doc, rels, content_types


def build_docx(
    name: str,
    *,
    title: str = TITLE,
    smallcaps: bool = False,
    allcaps: bool = False,
    copyright_text: str | None = REAL_COPYRIGHT,
    author_names: list[str] | None = None,
    page_numbers: bool = False,
) -> Path:
    outdir = VDIR / name
    outdir.mkdir(parents=True, exist_ok=True)
    doc = (UNPACKED / "word" / "document.xml").read_text()
    rels = (UNPACKED / "word" / "_rels" / "document.xml.rels").read_text()
    content_types = (UNPACKED / "[Content_Types].xml").read_text()

    doc = replace_title(doc, title_para(title, smallcaps, allcaps))
    doc = replace_authors(doc, author_names or AUTHORS)
    doc = strip_guidance(doc)
    if page_numbers:
        doc, rels, content_types = add_page_numbers(doc, rels, content_types)

    footer = (UNPACKED / "word" / "footer1.xml").read_text()
    if copyright_text is None:
        footer = footer.replace(TEMPLATE_COPYRIGHT, " ")
    else:
        footer = footer.replace(TEMPLATE_COPYRIGHT, copyright_text)

    docx_path = outdir / f"{name}.docx"
    with zipfile.ZipFile(docx_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in UNPACKED.rglob("*"):
            if f.is_dir():
                continue
            rel = f.relative_to(UNPACKED).as_posix()
            if rel == "word/document.xml":
                z.writestr(rel, doc)
            elif rel == "word/footer1.xml":
                z.writestr(rel, footer)
            elif rel == "word/_rels/document.xml.rels":
                z.writestr(rel, rels)
            elif rel == "[Content_Types].xml":
                z.writestr(rel, content_types)
            else:
                z.write(f, rel)
        if page_numbers:
            z.writestr("word/footer2.xml", (VDIR / "_footer2.xml").read_text())
    return docx_path


def convert(docx_path: Path) -> Path:
    subprocess.run(
        [
            "soffice",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(OUT_PDFS),
            str(docx_path),
        ],
        check=True,
        timeout=120,
        capture_output=True,
    )
    return OUT_PDFS / f"{docx_path.stem}.pdf"


class VariantSpec(TypedDict):
    title: NotRequired[str]
    smallcaps: NotRequired[bool]
    allcaps: NotRequired[bool]
    copyright_text: NotRequired[str | None]
    author_names: NotRequired[list[str]]
    page_numbers: NotRequired[bool]
    expected: NotRequired[str]


VARIANTS: dict[str, VariantSpec] = {
    "good_word": {},
    "bad_word_copyright": {"copyright_text": None, "expected": "copyright"},
    "bad_word_title_case": {"title": TITLE_BAD_CASE, "expected": "title"},
    "bad_word_allcaps": {"title": TITLE, "allcaps": True, "expected": "title"},
    "bad_word_smallcaps": {"title": TITLE, "smallcaps": True, "expected": "title"},
    "bad_word_pagenumbers": {"page_numbers": True, "expected": "page_numbers"},
    "bad_word_anonymized": {
        "author_names": ["Anonymous Author(s)"],
        "expected": "anonymized",
    },
}


def ensure_unpacked() -> None:
    """Unpack the IEEE Word template once for OOXML surgery."""
    docx = ROOT / "templates" / "conference-template-letter.docx"
    marker = UNPACKED / "word" / "document.xml"
    if marker.exists():
        return
    UNPACKED.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(docx) as z:
        z.extractall(UNPACKED)


def main() -> int:
    ensure_unpacked()
    VDIR.mkdir(parents=True, exist_ok=True)
    OUT_PDFS.mkdir(parents=True, exist_ok=True)

    # Anonymized variant: replace placeholder names with Anonymous markers.
    gt_path = ROOT / "corpus" / "ground-truth.json"
    ground_truth = json.loads(gt_path.read_text()) if gt_path.exists() else {}

    for name, spec in VARIANTS.items():
        if name == "bad_word_anonymized":
            # Patch: keep template names but make them anonymous.
            global AUTHORS
            saved = AUTHORS
            AUTHORS = ["Anonymous Author(s)"]
            docx = build_docx(
            name,
            title=spec.get("title", TITLE),
            smallcaps=spec.get("smallcaps", False),
            allcaps=spec.get("allcaps", False),
            copyright_text=spec.get("copyright_text", REAL_COPYRIGHT),
            author_names=spec.get("author_names"),
            page_numbers=spec.get("page_numbers", False),
        )
            AUTHORS = saved
        else:
            docx = build_docx(
            name,
            title=spec.get("title", TITLE),
            smallcaps=spec.get("smallcaps", False),
            allcaps=spec.get("allcaps", False),
            copyright_text=spec.get("copyright_text", REAL_COPYRIGHT),
            author_names=spec.get("author_names"),
            page_numbers=spec.get("page_numbers", False),
        )
        convert(docx)
        expected = {c: "PASS" for c in ALL_CHECKS}
        if "expected" in spec:
            expected[spec["expected"]] = "FAIL"
        ground_truth[name] = {"file": f"{name}.pdf", "expected": expected}
        print(f"[{name}] built -> {OUT_PDFS / (name + '.pdf')}")

    gt_path.write_text(json.dumps(ground_truth, indent=2) + "\n")
    print(f"ground truth updated -> {gt_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
