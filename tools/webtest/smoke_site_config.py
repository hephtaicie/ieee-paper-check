"""Verify both web entry points consume the same deployed site config.
# SPDX-License-Identifier: MIT

Builds with a temporary non-default page range, serves the built site,
and confirms the public policy and admin controls both reflect it.

Usage: uv run --with playwright python tools/webtest/smoke_site_config.py
(run from the repo root; build the web package first)
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto("http://localhost:4173/")
        page.wait_for_load_state("networkidle")
        author_policy = page.locator("#site-policy").inner_text()

        page.goto("http://localhost:4173/admin.html")
        page.wait_for_load_state("networkidle")
        admin_min = page.locator("#cfg-min-limit").input_value()
        admin_max = page.locator("#cfg-limit").input_value()

        print("author policy:", author_policy)
        print("admin limits:", admin_min, admin_max)
        ok = "5" in author_policy and "9" in author_policy and admin_min == "5" and admin_max == "9"
        if errors:
            print("CONSOLE ERRORS:", errors[:5])
        browser.close()
        if errors or not ok:
            print("SITE CONFIG SMOKE FAILED")
            return 1
        print("SITE CONFIG SMOKE OK")
        return 0


if __name__ == "__main__":
    sys.exit(main())
