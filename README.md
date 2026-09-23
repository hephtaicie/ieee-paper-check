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
| 7 | Main content within 12 pages, references excluded (they may start on p13 and spill as far as needed) |
| 8 | No page numbers in margins |
| 9 | Style conformance: template font sizes (no squeezed sub-body text), bibliography in the template's serif font, no coloured text (figures are exempt) — implemented but disabled by default (`disabledChecks` in the config) |
| 10 | All fonts embedded |
| 11 | No Type 3 fonts |

All checks are hard failures, as required by the chairs. Every failure comes
with evidence (page number, extracted text, font names) so a human can verify
at a glance.

## Usage

### Web app (authors + chairs)

Hosted on GitHub Pages: <https://fabiendanieau.github.io/ieee-paper-check/>

Or run it locally:

```sh
pnpm install
pnpm --filter @ieee-check/web build
pnpm --filter @ieee-check/web preview
```

or deploy to GitHub Pages (workflow in `.github/workflows/deploy.yml`).
Drop one or many PDFs onto the page; download the CSV report for batches.
The app is a PWA: once loaded it works fully offline, and the analysis
always stays inside the browser tab.

### CLI (chairs' batch)

```sh
node packages/cli/src/main.ts papers/ --csv report.csv --html report.html
```

Requires Node ≥ 22.18 (built-in TypeScript stripping). Exit code 0 when
every paper is valid.

`--config config.json` overrides any `DEFAULT_CONFIG` field per
conference/check round. The two fields you will most likely touch:

```json
{
  "pageLimit": 10,
  "disabledChecks": ["page_limit", "style"]
}
```

- `pageLimit` — maximum number of pages the main content may span
  (references are always excluded, whatever the limit).
- `disabledChecks` — check ids to skip entirely: they produce no report
  row and never affect the verdict. Available ids: `copyright`,
  `title`, `artifact_appendix`, `appendix`, `anonymized`,
  `undefined_refs`, `page_limit`, `page_numbers`, `style`,
  `fonts_embedded`, `fonts_type3`. Ship a config without the key (or
  with an empty list) to run everything, including the not-yet-enforced
  style check.

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
