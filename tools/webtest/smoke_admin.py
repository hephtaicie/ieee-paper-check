"""Browser smoke test for the admin page of the ieee-check web app.
# SPDX-License-Identifier: MIT

Serves the built app, configures the round (page limit, disabled check),
drops two corpus PDFs plus a papers.csv, and verifies the settings affect
the verdicts and the mailto links are generated.

Usage: uv run --with playwright python tools/webtest/smoke_admin.py
(run from the repo root)
"""

import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "corpus/pdfs/bad_too_long.pdf"
GOOD = ROOT / "corpus/pdfs/good.pdf"


def main() -> int:
    csv = Path(tempfile.mkdtemp()) / "papers.csv"
    # Real export shape: quoted "Emails" cell with a comma-separated list.
    csv.write_text(
        'Submission,Title,Contact Emails\n'
        '"pap104s3","Some title","a104@ex.org,b104@ex.org"\n'
        '"pap200x1","Other title","c200@ex.org"\n'
    )
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://localhost:4173/admin.html")
        page.wait_for_load_state("networkidle")
        shared = page.locator("#cfg-min-limit").input_value() == "4" and page.locator("#cfg-limit").input_value() == "12"
        print("admin defaults match shared config:", shared)
        ok = shared

        def drop(bad_file: Path) -> None:
            page.locator("#file-input").set_input_files([str(bad_file), str(GOOD)])
            page.wait_for_selector(".card", timeout=60000)
            page.wait_for_timeout(1200)

        def badges() -> list[str]:
            return [c.locator(".badge").inner_text() for c in page.locator(".card").all()]

        # Paper id in the file name so the CSV matches.
        bad = Path(tempfile.mkdtemp()) / "pap104s3-file2.pdf"
        bad.write_bytes(PDF.read_bytes())
        drop(bad)
        page.locator(".preview-button").first.click()
        page.wait_for_timeout(800)
        preview_available = page.locator(".preview-dialog").get_attribute("open") is not None
        print("admin visual preview opens:", preview_available)
        page.locator(".preview-head").get_by_role("button", name="Close").click()
        ok = ok and preview_available
        print("default badges:", badges())
        ok = ok and badges() == ["✗ INVALID", "✓ VALID"]

        # Limit 20 -> the 14-page paper becomes valid.
        page.fill("#cfg-limit", "20")
        page.locator("#cfg-limit").dispatch_event("change")
        page.wait_for_timeout(800)
        print("limit-20 badges:", badges())
        ok = ok and badges() == ["✓ VALID", "✓ VALID"]

        # Disable the page_limit check entirely: back at limit 12 the paper
        # stays valid and the row disappears from the report card.
        page.fill("#cfg-limit", "12")
        page.locator("#cfg-limit").dispatch_event("change")
        page.locator("#cfg-checks .cfg-row", has_text="Page limit").locator("input").uncheck()
        page.wait_for_timeout(800)
        labels = [l.inner_text() for l in page.locator(".card").first.locator(".check .label").all()]
        print("page_limit disabled:", badges(), "| has page_limit row:", any("Page limit" in l for l in labels))
        ok = ok and badges() == ["✓ VALID", "✓ VALID"] and not any("Page limit" in l for l in labels)

        # Minimum content page limit: set max=20, then the 6-page good paper
        # fails at min=7 and passes at min=4; references are excluded.
        page.locator("#cfg-checks .cfg-row", has_text="Page limit").locator("input").check()
        page.fill("#cfg-limit", "20")
        page.locator("#cfg-limit").dispatch_event("change")
        page.wait_for_timeout(700)
        page.fill("#cfg-min-limit", "7")
        page.locator("#cfg-min-limit").dispatch_event("change")
        page.wait_for_timeout(800)
        print("min-7 badges:", badges())
        ok = ok and badges() == ["✓ VALID", "✗ INVALID"]
        page.fill("#cfg-min-limit", "4")
        page.locator("#cfg-min-limit").dispatch_event("change")
        page.wait_for_timeout(800)
        ok = ok and badges() == ["✓ VALID", "✓ VALID"]
        page.fill("#cfg-limit", "12")
        page.locator("#cfg-limit").dispatch_event("change")
        page.wait_for_timeout(700)

        # Settings persist across reload (the reports do not: PDFs live in
        # memory only).
        page.reload()
        page.wait_for_load_state("networkidle")
        min_limit = page.locator("#cfg-min-limit").input_value()
        limit = page.locator("#cfg-limit").input_value()
        print("limits persist after reload:", min_limit, limit)
        ok = ok and min_limit == "4" and limit == "12"

        # Re-enable page_limit, drop the papers again, load the CSV and
        # expect a mailto button ON the invalid paper's card (not in a
        # separate panel), with the template variables filled in.
        page.locator("#cfg-checks .cfg-row", has_text="Page limit").locator("input").check()
        drop(bad)
        page.locator("#csv-file").set_input_files(str(csv))
        page.wait_for_timeout(800)
        links = page.locator(".card-mailto a")
        href = links.first.get_attribute("href") or ""
        print("mailto buttons:", links.count(), "| href head:", href[:70])
        ok = (
            ok
            and links.count() == 1
            and "pap104s3" in href
            and "a104@ex.org" in href
            and "b104@ex.org" in href
            and "mailto:" in href
        )

        # Template variables: {{title}} from the PDF, {{errors}} bullets.
        # Open the template panel, edit the subject, expect the link to
        # pick it up.
        page.locator("#template-panel summary").click()
        page.fill("#tpl-subject", "Fix {{id}} ({{title}})")
        page.wait_for_timeout(300)
        href = links.first.get_attribute("href") or ""
        from urllib.parse import unquote

        subj = href.split("subject=")[1].split("&")[0]
        print("subject:", unquote(subj)[:80])
        ok = ok and "pap104s3" in unquote(subj) and "Data-Aware" in unquote(subj)

        # good.pdf is valid: no mailto footer on its card.
        ok = ok and page.locator(".card.valid .card-mailto").count() == 0

        # Allow AD/AE: it no longer fails, but the card shows an informational
        # notice; disabling appendix checks keeps this test focused on AD/AE.
        page.locator("#cfg-checks .cfg-row", has_text="No AD/AE appendix").locator("input").uncheck()
        page.locator("#cfg-checks .cfg-row", has_text="No appendix in paper").locator("input").uncheck()
        page.locator("#cfg-checks .cfg-row", has_text="Page limit").locator("input").uncheck()
        page.locator("#cfg-artifact").check()
        page.wait_for_timeout(500)
        adae = Path(tempfile.mkdtemp()) / "adae.pdf"
        adae.write_bytes((ROOT / "corpus/pdfs/bad_artifact.pdf").read_bytes())
        page.locator("#clear-btn").click()
        drop(adae)
        notice = page.locator(".info-notice").inner_text()
        print("AD/AE notice:", notice)
        ok = ok and "Informational" in notice and page.locator(".card.invalid").count() == 0

        if errors:
            print("CONSOLE ERRORS:", errors[:5])
        browser.close()
        if errors or not ok:
            print("ADMIN SMOKE FAILED")
            return 1
        print("ADMIN SMOKE OK")
        return 0


if __name__ == "__main__":
    sys.exit(main())
