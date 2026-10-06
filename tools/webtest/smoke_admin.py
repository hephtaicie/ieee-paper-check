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
from urllib.parse import unquote

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "corpus/pdfs/bad_too_long.pdf"
GOOD = ROOT / "corpus/pdfs/good.pdf"


def main() -> int:
    csv = Path(tempfile.mkdtemp()) / "papers.csv"
    # Real export shape: submitter Email precedes the full author list in
    # quoted Contact Emails; only Contact Emails should become recipients.
    csv.write_text(
        'Submission,Title,Email,Contacts,Contact Emails\n'
        '"pap104s3","Some title","submitter@ex.org","Submitter","a104@ex.org,b104@ex.org"\n'
        '"pap200x1","Other title","other.submitter@ex.org","Contact","c200@ex.org"\n'
    )
    matched_good = Path(tempfile.mkdtemp()) / "pap200x1-good.pdf"
    matched_good.write_bytes(GOOD.read_bytes())
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
        status_select = page.locator(".card").first.locator(".review-status-select")
        print("default review status:", status_select.input_value())
        ok = ok and status_select.input_value() == "red"
        status_select.select_option("orange")
        status_select = page.locator(".card").first.locator(".review-status-select")
        print("updated review status:", status_select.input_value())
        ok = ok and status_select.input_value() == "orange"
        page.locator("#authors-panel summary").click()
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.locator("#reset-review-statuses").click()
        status_select = page.locator(".card").first.locator(".review-status-select")
        ok = ok and status_select.input_value() == "orange"
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#reset-review-statuses").click()
        status_select = page.locator(".card").first.locator(".review-status-select")
        print("confirmed reset status:", status_select.input_value())
        ok = ok and status_select.input_value() == "red"
        status_select.select_option("orange")
        status_select = page.locator(".card").first.locator(".review-status-select")
        ok = ok and status_select.input_value() == "orange"
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
        page.wait_for_timeout(2200)
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
        page.wait_for_timeout(2200)
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
        page.locator("#file-input").set_input_files(str(bad))
        page.wait_for_selector(".card", timeout=60000)
        page.wait_for_timeout(1000)
        persisted_status = page.locator(".card").first.locator(".review-status-select").input_value()
        print("review status persisted:", persisted_status)
        ok = ok and persisted_status == "orange"
        page.locator("#clear-btn").click()

        # Re-enable page_limit, drop the papers again, load the CSV and
        # expect a mailto button ON the invalid paper's card (not in a
        # separate panel), with the template variables filled in.
        page.locator("#cfg-checks .cfg-row", has_text="Page limit").locator("input").check()
        # The minimum-page test left the valid fixture below the max only;
        # restore the expected range and wait for the revalidation to finish.
        page.fill("#cfg-min-limit", "4")
        page.locator("#cfg-min-limit").dispatch_event("change")
        page.fill("#cfg-limit", "12")
        page.locator("#cfg-limit").dispatch_event("change")
        page.wait_for_timeout(1000)
        page.locator("#file-input").set_input_files([str(bad), str(matched_good)])
        page.wait_for_selector(".card", timeout=60000)
        page.wait_for_timeout(1200)
        badges_after_clear = badges()
        print("manual-email fixture badges:", badges_after_clear)
        ok = ok and badges_after_clear == ["✗ INVALID", "✓ VALID"]
        page.locator("#csv-file").set_input_files(str(csv))
        page.wait_for_timeout(800)
        invalid_links = page.locator(".card.invalid .card-mailto a")
        manual_invalid = invalid_links.filter(has_text="Compose manual email")
        failed_checks_email = invalid_links.filter(has_text="Email about failed checks")
        manual_href = manual_invalid.get_attribute("href") or ""
        failed_href = failed_checks_email.get_attribute("href") or ""
        valid_links = page.locator(".card.valid .card-mailto a")
        manual_valid = valid_links.filter(has_text="Compose manual email")
        valid_href = manual_valid.get_attribute("href") or ""
        print("manual/failed-check links:", manual_invalid.count(), failed_checks_email.count())
        valid_body = unquote(valid_href.split("body=")[1]) if "body=" in valid_href else ""
        failed_body = unquote(failed_href.split("body=")[1]) if "body=" in failed_href else ""
        print("valid manual link:", manual_valid.count(), valid_href[:80])
        print("manual email errors are blank:", "\n- " not in valid_body and "{{errors}}" not in valid_body)
        print("failed body contains errors:", "\n- " in failed_body)
        ok = (
            ok
            and manual_invalid.count() == 1
            and failed_checks_email.count() == 1
            and "pap104s3" in manual_href
            and "a104@ex.org" in manual_href
            and "b104@ex.org" in manual_href
            and "mailto:" in manual_href
            and "\n- " in unquote(failed_href.split("body=")[1])
            and manual_valid.count() == 1
            and "pap200x1" in valid_href
            and "c200@ex.org" in valid_href
            and "mailto:" in valid_href
            and "\n- " not in valid_body
            and "{{errors}}" not in valid_body
        )

        # Template variables: {{title}} from the PDF, {{errors}} bullets.
        # Open the template panel, edit the subject, expect the link to
        # pick it up.
        page.locator("#template-panel summary").click()
        page.fill("#tpl-subject", "Fix {{id}} ({{title}})")
        page.wait_for_timeout(300)
        href = failed_checks_email.get_attribute("href") or ""
        subj = href.split("subject=")[1].split("&")[0]
        print("subject:", unquote(subj)[:80])
        ok = ok and "pap104s3" in unquote(subj) and "Data-Aware" in unquote(subj)


        # A flag caused by lowercase title words offers browser-local
        # dictionary actions; accepting the reported words rechecks the title.
        page.locator("#clear-btn").click()
        title_bad = ROOT / "corpus/pdfs/bad_title_case.pdf"
        drop(title_bad)
        title_card = page.locator(".card").first
        dictionary_buttons = title_card.locator(".title-dictionary-actions button")
        dictionary_words = [b.inner_text().lstrip("+ ") for b in dictionary_buttons.all()]
        print("title dictionary suggestions:", dictionary_words)
        ok = ok and len(dictionary_words) > 0
        while title_card.locator(".title-dictionary-actions button").count():
            title_card.locator(".title-dictionary-actions button").first.click()
            page.wait_for_timeout(500)
        ok = ok and title_card.locator(".check.fail", has_text="Title capitalization").count() == 0

        # Tracker panel: reload a known pair, filter by status, cancel a
        # remove, then confirm and verify paper/status/card removal.
        page.locator("#clear-btn").click()
        page.locator("#file-input").set_input_files([str(bad), str(matched_good)])
        page.wait_for_selector(".card", timeout=60000)
        page.wait_for_timeout(1200)
        page.locator(".card").filter(has_text=bad.name).locator(".review-status-select").select_option("orange")
        bad_tracker_row = page.locator(".tracker-row").filter(has_text=bad.name)
        good_tracker_row = page.locator(".tracker-row").filter(has_text=matched_good.name)
        print("tracker paper rows:", page.locator(".tracker-row").count())
        ok = ok and page.locator(".tracker-row").count() == 2
        page.locator("#tracker-filter").select_option("orange")
        ok = ok and page.locator(".tracker-row").count() == 1
        ok = ok and page.locator(".tracker-row").first.locator(".tracker-status").inner_text() == "Emailed"
        page.locator("#tracker-filter").select_option("all")
        page.once("dialog", lambda dialog: dialog.dismiss())
        bad_tracker_row.locator(".tracker-remove").click()
        ok = ok and bad_tracker_row.count() == 1
        page.once("dialog", lambda dialog: dialog.accept())
        bad_tracker_row.locator(".tracker-remove").click()
        ok = ok and bad_tracker_row.count() == 0
        ok = ok and page.locator(".card").filter(has_text=bad.name).count() == 0
        page.locator("#clear-btn").click()
        drop(bad)
        new_row = page.locator(".tracker-row").filter(has_text=bad.name)
        ok = ok and new_row.locator(".tracker-status").inner_text() == "Pending"
        page.locator("#clear-btn").click()

        # Allow AD/AE: it no longer fails, but the card shows an informational
        # notice; disabling appendix checks keeps this test focused on AD/AE.
        page.reload()
        page.wait_for_load_state("networkidle")
        persisted_words = page.evaluate("JSON.parse(localStorage.getItem('ieee-check-admin-title-allowed-words-v1') || '[]')")
        print("dictionary persisted:", len(persisted_words) > 0)
        ok = ok and len(persisted_words) > 0
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
