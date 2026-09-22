// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, validate } from "../src/index.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const PDFS = join(ROOT, "corpus", "pdfs");
const GT = JSON.parse(readFileSync(join(ROOT, "corpus", "ground-truth.json"), "utf8")) as Record<
  string,
  {
    file: string;
    expected: Record<string, "PASS" | "FAIL">;
    requires?: string;
    note?: string;
  }
>;

// Corpus config: every classical check on, plus the not-yet-default style
// check so its mutants keep being exercised (0 FP / 0 FN requirement).
const config = { ...DEFAULT_CONFIG, styleCheck: true };

// First: smoke test on one good paper to catch extraction crashes
const good = await validate(
  new Uint8Array(readFileSync(join(PDFS, "good.pdf"))),
  "good.pdf",
  config,
);
console.log("== good.pdf ==");
console.log("pages:", good.pageCount, "valid:", good.valid);
for (const r of good.results) {
  console.log(
    " ",
    r.status === "PASS" ? "✔" : "✘",
    r.id.padEnd(16),
    r.evidence
      .map((e) => e.detail)
      .join(" | ")
      .slice(0, 100),
  );
}

console.log("\n== full corpus ==");
type Kind = "TP" | "TN" | "FP" | "FN";
const confusion: Record<string, Record<Kind, number>> = {};
const knownLimitations: string[] = [];
let mismatches = 0;

for (const [name, { file, expected, requires }] of Object.entries(GT)) {
  let report: Awaited<ReturnType<typeof validate>> | undefined;
  try {
    report = await validate(new Uint8Array(readFileSync(join(PDFS, file))), file, config);
  } catch (e) {
    console.error(`✘ ${name}: EXTRACTION ERROR: ${(e as Error).message}`);
    mismatches++;
    continue;
  }
  for (const r of report.results) {
    const exp = expected[r.id] ?? "PASS";
    if (exp === "FAIL" && r.status === "PASS" && requires) {
      // Known limitation reserved for the optional model tier.
      confusion[r.id] ??= { TP: 0, TN: 0, FP: 0, FN: 0 };
      knownLimitations.push(`${name}: ${r.id} (${requires})`);
      continue;
    }
    confusion[r.id] ??= { TP: 0, TN: 0, FP: 0, FN: 0 };
    const c = confusion[r.id]!;
    if (exp === "FAIL" && r.status === "FAIL") c.TP++;
    else if (exp === "PASS" && r.status === "PASS") c.TN++;
    else if (exp === "PASS" && r.status === "FAIL") {
      c.FP++;
      mismatches++;
      console.log(
        `  FP ${name}: ${r.id} -> ${r.evidence
          .map((e) => e.detail)
          .join(" | ")
          .slice(0, 140)}`,
      );
    } else if (exp === "FAIL" && r.status === "PASS") {
      c.FN++;
      mismatches++;
      console.log(`  FN ${name}: ${r.id} expected FAIL`);
    }
  }
}

console.log("\n== per-check confusion (TP FN FP TN) ==");
for (const [id, c] of Object.entries(confusion)) {
  console.log(`  ${id.padEnd(16)} TP=${c.TP} FN=${c.FN} FP=${c.FP} TN=${c.TN}`);
}
if (knownLimitations.length > 0) {
  console.log("\n== known limitations (need model tier) ==");
  for (const k of knownLimitations) console.log(`  * ${k}`);
}
console.log(mismatches === 0 ? "\nALL MATCH (classical checks)" : `\n${mismatches} mismatches`);
