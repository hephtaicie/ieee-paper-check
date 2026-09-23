// SPDX-License-Identifier: MIT
import type { CheckResult, PaperReport } from "@ieee-check/core";
import { CHECK_LABELS, CHECK_ORDER, renderCsv } from "@ieee-check/core";

export { renderCsv };

export function renderConsole(reports: PaperReport[], verbose: boolean): string {
  const out: string[] = [];
  for (const r of reports) {
    const icon = r.valid ? "PASS" : "FAIL";
    out.push(`${icon}  ${r.file} (${r.pageCount} pages)`);
    if (!r.valid || verbose) {
      for (const c of r.results) {
        const mark = c.status === "PASS" ? "  ok " : " FAIL";
        out.push(`${mark} ${CHECK_LABELS[c.id] ?? c.id}`);
        if (c.status === "FAIL" || verbose) {
          for (const e of c.evidence) {
            const pg = e.page ? ` [p.${e.page}]` : "";
            out.push(`       ${pg} ${e.detail}`);
          }
        }
      }
    }
    out.push("");
  }
  const failed = reports.filter((r) => !r.valid).length;
  out.push(`${reports.length - failed} valid, ${failed} invalid of ${reports.length} paper(s)`);
  return out.join("\n");
}

export function renderJson(reports: PaperReport[]): string {
  return JSON.stringify(reports, null, 2);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHtml(reports: PaperReport[], generated: string): string {
  const ids = CHECK_ORDER;
  const summary = `${reports.filter((r) => r.valid).length}/${reports.length} valid`;
  const rows = reports
    .map((r) => {
      const cells = ids
        .map((id) => {
          const c = r.results.find((x: CheckResult) => x.id === id);
          if (c === undefined) return '<td class="pass"></td>'; // disabled
          const cls = c.status === "PASS" ? "pass" : "fail";
          const tip =
            c.status === "FAIL"
              ? ` title="${esc(c.evidence.map((e) => e.detail).join(" | "))}"`
              : "";
          return `<td class="${cls}"${tip}>${c.status === "PASS" ? "✔" : "✘"}</td>`;
        })
        .join("");
      const evidence = r.valid
        ? ""
        : `<details><summary>details</summary><ul>${r.results
            .filter((c: CheckResult) => c.status === "FAIL")
            .map(
              (c: CheckResult) =>
                `<li><b>${esc(CHECK_LABELS[c.id] ?? c.id)}:</b> ${c.evidence
                  .map((e) => esc((e.page ? `[p.${e.page}] ` : "") + e.detail))
                  .join("<br>")}</li>`,
            )
            .join("")}</ul></details>`;
      return `<tr class="${r.valid ? "valid" : "invalid"}"><td>${esc(r.file)}</td>${cells}<td>${r.pageCount}</td><td>${evidence}</td></tr>`;
    })
    .join("\n");
  const head = ids.map((i) => `<th>${esc(CHECK_LABELS[i])}</th>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>IEEE paper check — ${esc(summary)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a2e; }
  h1 { font-size: 1.3rem; }
  table { border-collapse: collapse; font-size: 0.85rem; }
  th, td { border: 1px solid #d0d0dd; padding: 0.35rem 0.55rem; }
  th { background: #f4f4fa; position: sticky; top: 0; }
  td.pass { color: #0a7d34; text-align: center; }
  td.fail { color: #c0392b; text-align: center; cursor: help; }
  tr.invalid td:first-child { font-weight: 600; }
  details { font-size: 0.8rem; }
  .meta { color: #666; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>IEEE camera-ready check — ${esc(summary)}</h1>
<p class="meta">Generated ${esc(generated)} · everything ran locally; no file left this machine.</p>
<table>
<tr><th>file</th>${head}<th>pages</th><th>evidence</th></tr>
${rows}
</table>
</body>
</html>`;
}
