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
    csv.write_text("paperid,email\n42,author42@example.org\n")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://localhost:4173/admin.html")
        page.wait_for_load_state("networkidle")

        def drop(bad_file: Path) -> None:
            page.locator("#file-input").set_input_files([str(bad_file), str(GOOD)])
            page.wait_for_selector(".card", timeout=60000)
            page.wait_for_timeout(1200)

        def badges() -> list[str]:
            return [c.locator(".badge").inner_text() for c in page.locator(".card").all()]

        # Paper id 42 in the file name so the CSV matches.
        bad = Path(tempfile.mkdtemp()) / "paper_42.pdf"
        bad.write_bytes(PDF.read_bytes())
        drop(bad)
        print("default badges:", badges())
        ok = badges() == ["✗ INVALID", "✓ VALID"]

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

        # Settings persist across reload (the reports do not: PDFs live in
        # memory only). After reload the page_limit checkbox stays unchecked.
        page.reload()
        page.wait_for_load_state("networkidle")
        checked = page.locator("#cfg-checks .cfg-row", has_text="Page limit").locator("input").is_checked()
        limit = page.locator("#cfg-limit").input_value()
        print("persists after reload: unchecked =", not checked, "limit =", limit)
        ok = ok and not checked and limit == "12"

        # Re-enable page_limit, drop the papers again, load the CSV and
        # expect a mailto link for the invalid paper.
        page.locator("#cfg-checks .cfg-row", has_text="Page limit").locator("input").check()
        drop(bad)
        page.locator("#csv-file").set_input_files(str(csv))
        page.wait_for_timeout(800)
        rows = page.locator(".mailto-row").all()
        href = page.locator(".mailto-row a").first.get_attribute("href") or ""
        print("mailto rows:", len(rows), "| href head:", href[:60])
        ok = ok and "42" in href and "author42@example.org" in href and "mailto:" in href

        # good.pdf is valid: no mailto row for it.
        ok = ok and all("good" not in r.inner_text() for r in rows)

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
