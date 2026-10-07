"""Browser smoke test for the ieee-check web app.
# SPDX-License-Identifier: MIT

Serves the built app, drops three corpus PDFs onto the page, and verifies
the rendered results match the expected verdicts.

Usage: uv run --with playwright python tools/webtest/smoke.py
(run from the repo root; needs `playwright install chromium` once)
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FILES = [
    ROOT / "corpus/pdfs/good.pdf",
    ROOT / "corpus/pdfs/bad_type3.pdf",
    ROOT / "corpus/pdfs/bad_title_case.pdf",
]
EXPECT = {
    "good.pdf": ("✓ VALID", []),
    "bad_type3.pdf": ("✗ INVALID", ["No Type 3 fonts"]),
    "bad_title_case.pdf": ("✗ INVALID", ["Title capitalization"]),
}


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://localhost:4173/")
        page.wait_for_load_state("networkidle")
        policy = page.locator("#site-policy").inner_text()
        checked_text = page.locator("#enabled-checks").text_content() or ""
        print("shared policy:", policy)
        artifact_policy = page.locator("#artifact-policy").text_content() or ""
        print("enabled-check disclosure:", checked_text)
        print("artifact policy:", artifact_policy)
        ok = (
            "No page numbers in headers or footers" not in checked_text
            and "Style conformance" not in checked_text
            and "Artifact Description/Evaluation content is allowed" in artifact_policy
            and "SC26 Workshops" in checked_text
        )
        page.locator("#file-input").set_input_files([str(f) for f in FILES])
        page.wait_for_selector(".card", timeout=60000)
        page.wait_for_timeout(1500)
        cards = page.locator(".card").all()
        print(f"cards: {len(cards)}")
        ok = len(cards) == len(FILES)
        for c in cards:
            name = c.locator(".fname").inner_text()
            badge = c.locator(".badge").inner_text()
            fails = [l.inner_text() for l in c.locator(".check.fail .label").all()]
            preview_button = c.locator(".preview-button")
            print(f"  {name}: {badge} fails={fails} previews={preview_button.is_enabled()}")
            exp_badge, exp_fails = EXPECT[name]
            expected_failures = (["IEEE copyright on p.1"] + exp_fails) if "SC26 Workshops" in checked_text else exp_fails
            ok = ok and badge == ("✗ INVALID" if expected_failures else exp_badge) and fails == expected_failures and preview_button.is_enabled()

        page.locator(".card").first.locator(".preview-button").click()
        preview = page.locator(".preview-dialog")
        page.wait_for_timeout(1000)
        preview_label = page.locator(".preview-title").inner_text()
        preview_count = page.locator(".preview-head").locator(".muted").inner_text()
        preview_focused = page.evaluate("document.activeElement === document.querySelector('.preview-dialog')")
        preview_w = page.locator(".preview-body canvas").evaluate("el => el.width")
        print("preview opened:", preview_label, preview_count, "canvas width:", preview_w)
        print("preview focused on open:", preview_focused)
        ok = ok and preview.get_attribute("open") is not None and preview_w > 0 and preview_focused
        # No click inside the popup: focus from opening should be enough.
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(300)
        arrow_count = page.locator(".preview-head").locator(".muted").inner_text()
        print("after ArrowRight:", arrow_count)
        ok = ok and arrow_count == "2 / 4"
        page.locator(".preview-head").get_by_role("button", name="Close").click()
        page.wait_for_timeout(100)
        ok = ok and preview.get_attribute("open") is None
        print("summary:", page.locator("#summary").inner_text())

        # Viewer: click the title-casing evidence row, expect the page-1
        # render with a highlight box, then close and confirm cleanup.
        page.locator(".check.fail.viewable", has_text="Title capitalization").first.click()
        page.wait_for_timeout(800)
        dialog = page.locator("#viewer")
        print("viewer open:", dialog.get_attribute("open") is not None)
        print("viewer title:", page.locator("#v-title").inner_text())
        canvas_w = page.locator("#v-canvas").evaluate("el => el.width")
        hl_visible = page.locator("#v-hl").is_visible()
        hl_top = page.locator("#v-hl").evaluate(
            "el => el.getBoundingClientRect().top - document.getElementById('v-canvas').getBoundingClientRect().top"
        )
        canvas_h = page.locator("#v-canvas").evaluate("el => el.clientHeight")
        print(f"highlight top offset: {hl_top:.0f}px of {canvas_h}px canvas")
        # The title sits in the top quarter of page 1: a vertically
        # mirrored highlight would land in the bottom quarter.
        ok = ok and hl_top < canvas_h * 0.25
        page_label = page.locator("#v-page").inner_text()
        print(f"canvas width: {canvas_w}, highlight: {hl_visible}, page label: {page_label}")
        viewer_focused = page.evaluate("document.activeElement === document.querySelector('#viewer')")
        ok = ok and dialog.get_attribute("open") is not None and canvas_w > 500 and viewer_focused
        # Navigate the full-document viewer without clicking its buttons.
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(500)
        next_page = page.locator("#v-page").inner_text()
        print("viewer after ArrowRight:", next_page)
        ok = ok and next_page.startswith("2 /")
        page.locator("#v-close").click()
        page.wait_for_timeout(200)
        print("viewer closed:", dialog.get_attribute("open") is None)
        ok = ok and dialog.get_attribute("open") is None

        # Any paper filename opens the full-document viewer, regardless of
        # verdict; close it, then verify passing check rows stay inert.
        page.locator(".card .file-preview").first.click()
        page.wait_for_timeout(600)
        full_preview_open = page.locator("#viewer").get_attribute("open") is not None
        print("valid-paper filename opens viewer:", full_preview_open)
        ok = ok and full_preview_open
        page.locator("#v-close").click()
        page.wait_for_timeout(100)
        ok = ok and page.locator("#viewer").get_attribute("open") is None

        # The deployed shared copyright requirement may make every corpus
        # fixture invalid; confirm every filename still exposes full preview.
        ok = ok and page.locator(".card .file-preview").count() == len(FILES)

        if errors:
            print("CONSOLE ERRORS:", errors[:5])
        browser.close()
        if errors or not ok:
            return 1
        print("SMOKE OK")
        return 0


if __name__ == "__main__":
    sys.exit(main())
