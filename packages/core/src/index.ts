// SPDX-License-Identifier: MIT
import {
  checkAnonymized,
  checkAppendix,
  checkArtifactAppendix,
  checkCopyright,
  checkFontsEmbedded,
  checkFontsType3,
  checkPageLimit,
  checkPageNumbers,
  checkStyle,
  checkTitle,
  checkUndefinedRefs,
} from "./checks.ts";
import { extractPaperData } from "./extract.ts";
import type { CheckResult, Config, PaperData, PaperReport } from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";

export * from "./report.ts";
export * from "./types.ts";

/** Run all checks on already-extracted paper data. */
export function runChecks(data: PaperData, config: Config = DEFAULT_CONFIG): CheckResult[] {
  return [
    checkCopyright(data),
    checkTitle(data, config),
    checkArtifactAppendix(data),
    checkAppendix(data, config),
    checkAnonymized(data),
    checkUndefinedRefs(data),
    checkPageLimit(data, config),
    checkPageNumbers(data),
    checkStyle(data),
    checkFontsEmbedded(data),
    checkFontsType3(data),
  ];
}

/** Extract + validate a paper PDF from raw bytes. */
export async function validate(
  bytes: Uint8Array,
  file: string,
  config: Config = DEFAULT_CONFIG,
): Promise<PaperReport> {
  const data = await extractPaperData(bytes);
  const results = runChecks(data, config);
  return {
    file,
    pageCount: data.pageCount,
    results,
    valid: results.every((r) => r.status === "PASS"),
  };
}
