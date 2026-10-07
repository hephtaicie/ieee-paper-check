# ieee-paper-check

Offline validation of IEEE camera-ready conference papers, built from the
feedback of conference program chairs. Eleven automated checks run entirely on
your machine — no PDF ever leaves it.

## Checks

| # | Check |
|---|-------|
| 1 | IEEE copyright block at the bottom-left of page 1 (`978-x-xxxx-xxxx-x/25/$31.00 © 2025 IEEE`) |
| 2 | Title capitalization: main words capitalized, small words lowercase, compounds capitalized (`Data-Aware`, `Parallel-in-Time`), no small caps, no ALL CAPS |
| 3 | No "Artifact Description / Artifact Evaluation" section anywhere in the PDF |
| 4 | No appendix inside the paper (appendices are submitted separately) |
| 5 | Paper is de-anonymized (no "Anonymous Author(s)", no "Paper ID") |
| 6 | No unresolved LaTeX references (`??` or `[?]`) |
| 7 | Main content is at least 4 and at most 12 pages by default, references excluded (both limits are configurable) |
| 8 | No page numbers in margins |
| 9 | Style conformance: template font sizes (no squeezed sub-body text), bibliography in the template's serif font, no coloured text (figures are exempt) — implemented but disabled by default (`disabledChecks` in the config) |
| 10 | All fonts embedded |
| 11 | No Type 3 fonts |

All checks are hard failures, as required by the chairs. Every failure comes
with evidence (page number, extracted text, font names) so a human can verify
at a glance.

## Capabilities and limitations

What the checks do well:

- Full local analysis (no upload), fast enough for whole batches.
- Both authoring tracks: LaTeX (IEEEtran) and the IEEE Word template
  converted to PDF.
- Every failure points at concrete evidence instead of a bare verdict.
- Configuration per conference/round: page limit and check list (CLI config
  file; admin page for the web).

What it cannot do (classical, geometry-only tier):

- The small-caps-with-lowercase-text-layer case described below (planned
  model tier).
- Semantics: it does not judge whether a reference is *relevant*, whether
  the title *makes sense*, or whether figures are readable — a human still
  reviews the evidence.
- Content inside figures is mostly out of scope: the coloured-text check
  only sees text drawn in the page content stream, so embedded figures
  (the common case) are exempt by construction; small font differences of
  figure-internal labels are not measured.
- Subtle single-word font tampering (e.g. one paragraph set smaller) can
  slip through the size check, which looks at dominant sizes; a page-level
  cheat (whole page shrunk) is caught.

## Usage

### Web app

Hosted on GitHub Pages: <https://hephtaicie.github.io/ieee-paper-check/>

Or run it locally:

```sh
pnpm install
pnpm --filter @ieee-check/web build
pnpm --filter @ieee-check/web preview
```

or deploy to GitHub Pages (workflow in `.github/workflows/deploy.yml`).
The app is a PWA: once loaded it works fully offline, and the analysis
always stays inside the browser tab.

**Authors' page** (`/`) — drop one or many PDFs onto the page; every check
runs locally and each failure shows its evidence (page, extracted text,
font name); clicking a failed row opens the PDF page with a highlight box
around the offending text. The page displays the deployed page-count policy,
and its “What is checked” disclosure is generated from the same shared config:
disabled checks are omitted and a configured required copyright is shown.
A CSV report can be downloaded for batches.

**Chairs' page** (`/admin.html`) — the same verification UI plus admin
tooling that regular users do not see:

- *Round configuration*: set minimum/maximum content pages (default 4/12;
  references excluded), enable/disable checks, allow AD/AE sections (still
  detected and shown as an informational notice on matching papers), and
  optionally require a specific page-1 copyright notice. Changes recheck
  loaded PDFs immediately and are saved in the browser between sessions.
- *Author list*: import the submission site's CSV export (columns
  `Submission` and `Contact Emails`) — PDF file names containing a
  submission id (e.g. `pap104s3-file2.pdf`) are matched to it.
- *Email template*: an editable subject/body with `{{id}}`, `{{title}}`
  (extracted from the PDF), `{{filename}}`, `{{errors}}` (bullet list of
  failed checks) and `{{url}}` placeholders; invalid papers get a prefilled
  revision-request `mailto:` button on their report card. Opening it
  launches your own mail client — nothing is sent by the page.

### Shared web configuration

Both web pages use `packages/web/site-config.json` as their deployed
configuration. Edit that file, commit and push to `main`; the Pages workflow
builds both pages with those settings. Both pages share one policy. Chairs'
localStorage overrides are browser-local and reset automatically when the
deployed shared configuration changes. The file can also define the default
admin email subject and body:

```json
{
  "minPageLimit": 4,
  "pageLimit": 12,
  "allowArtifactAppendix": false,
  "requiredCopyright": null,
  "disabledChecks": ["style"],
  "emailTemplate": {
    "subject": "Revision required for {{id}}",
    "body": "Dear authors,\\n\\nPlease address these issues:\\n\\n{{errors}}\\n\\nPaper: {{title}}\\nFile: {{filename}}\\n\\n{{url}}"
  }
}
```

Email placeholders: `{{id}}` (submission id), `{{title}}`, `{{filename}}`,
`{{errors}}` (failed checks as a bullet list), and `{{url}}` (public checker).
This config is public, so do not put secrets in it. Admin email-template edits
are browser-local; they reset to the deployed template when it changes.
Chairs' round-setting overrides are likewise local and reset when the shared
round configuration changes.

### CLI (chairs' batch)

```sh
node packages/cli/src/main.ts papers/ --csv report.csv --html report.html
```

Requires Node ≥ 22.18 (built-in TypeScript stripping). Exit code 0 when
every paper is valid.

`--config config.json` overrides any `DEFAULT_CONFIG` field per
conference/check round. Example:

```json
{
  "minPageLimit": 4,
  "pageLimit": 12,
  "allowArtifactAppendix": false,
  "requiredCopyright": "978-1-6654-1234-5/25/$31.00 © 2025 IEEE",
  "disabledChecks": ["style"]
}
```

- `minPageLimit` / `pageLimit` — minimum / maximum main-content pages
  (defaults: 4 / 12; references are excluded).
- `allowArtifactAppendix` — allow AD/AE content. It is still detected and
  reported informatively in the admin UI, but does not fail the paper.
- `requiredCopyright` — require this exact text somewhere in the page-1
  copyright zone; `null` accepts any IEEE-format notice.
- `disabledChecks` — check ids to skip entirely: they produce no report
  row and never affect the verdict. Available ids: `copyright`,
  `title`, `artifact_appendix`, `appendix`, `anonymized`,
  `undefined_refs`, `page_limit`, `page_numbers`, `style`,
  `fonts_embedded`, `fonts_type3`. Use an empty list to run all checks,
  including the not-yet-enforced style check.

## Repo layout

```
packages/core     10 checks + pdf.js-based extraction (shared engine)
packages/cli      Node CLI for batch processing
packages/web      Vite PWA for GitHub Pages
corpus/           21 test PDFs (LaTeX + Word tracks) + ground-truth.json
tools/generate    corpus generators (tectonic, soffice, pikepdf surgery)
tools/webtest     Playwright smoke test for the web app
```

## Test corpus

`corpus/pdfs` contains realistic good papers and mutants, each violating
exactly one criterion:

- **LaTeX track** — compiled with tectonic + IEEEtran: missing copyright,
  bad title casing, ALL CAPS, `\textsc` small caps (fontspec/TeX Gyre),
  undefined refs, page numbers, 14-page content, AD/AE appendix,
  anonymization, Type 3 fonts (matplotlib mathtext), non-embedded fonts
  (reportlab base-14), refs spilling onto p13 (must PASS).
- **Word track** — the official IEEE Word template mutated via OOXML surgery
  and converted with LibreOffice: copyright removed, bad casing, small caps
  (`w:smallCaps`), ALL CAPS, footer page numbers, anonymization.
- **Hard case** — `bad_title_smallcaps_lct.pdf`: small caps with a lowercase
  text layer (MS Word native export behaviour), produced by ToUnicode
  surgery.

Run the validation harness:

```sh
node packages/core/scripts/validate.ts
```

Result on the current corpus: **0 false positives, 0 false negatives**, one
documented limitation (below).

## Known limitation (and why a model tier is planned)

A title set in small caps whose text layer reports normal lowercase
(Word's native "Save as PDF") cannot be detected by geometry: in
Times-metric fonts the x-height is 0.675 of cap height while small caps
are 0.70 — a 3% difference that no pixel method can separate. Every
other small-cap variant (LaTeX `\textsc`, LibreOffice export, ALL CAPS,
Unicode small-cap codepoints, dedicated small-cap fonts) is detected.
The `bad_title_smallcaps_lct` corpus entry is reserved for the optional
`granite-docling-258M` WebGPU tier (transformers.js) that can visually
classify the title image; the rest of the system never needs a model.

## LFS

Binary artifacts (corpus PDFs, IEEE template zips/docx) are tracked
with [git LFS](https://git-lfs.com). After cloning:

```sh
git lfs install   # once per machine
git lfs pull      # if the clone predates LFS or LFS was missing
```

## Verification

- TS: `pnpm -r check` (tsc --noEmit, strict) · Biome lint
- Python generators: `ruff` + `ty` (`uv run --project tools/generate …`)
- Corpus: `node packages/core/scripts/validate.ts` (precision/recall vs
  ground truth)
- Web: `pnpm --filter @ieee-check/web build` + Playwright smoke test
  (`tools/webtest/smoke.py`)

## License

MIT (see LICENSE). The PDF engine is [pdf.js](https://mozilla.github.io/pdf.js/)
(Apache-2.0). All code in this repository is original and MIT-licensed; the
engine is a declared dependency, not vendored.

## Credits

Built from the feedback of conference publication chairs.

- [Fabien Danieau](https://www.linkedin.com/in/fabiendanieau/)
- [François Tessier](https://www.francoistessier.info/)
