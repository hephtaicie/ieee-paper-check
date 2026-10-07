// SPDX-License-Identifier: MIT

import type { CheckId } from "@ieee-check/core";
import { CHECK_LABELS, CHECK_ORDER } from "@ieee-check/core";
import { type AppElements, mountApp } from "./app.ts";
import { sharedSiteConfig } from "./site-config.ts";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el as T;
}

const el: AppElements = {
  dropzone: byId<HTMLButtonElement>("dropzone"),
  fileInput: byId<HTMLInputElement>("file-input"),
  results: byId<HTMLDivElement>("results"),
  actions: byId<HTMLDivElement>("actions"),
  summary: byId<HTMLSpanElement>("summary"),
  csvBtn: byId<HTMLButtonElement>("csv-btn"),
  clearBtn: byId<HTMLButtonElement>("clear-btn"),
  viewer: byId<HTMLDialogElement>("viewer"),
  vTitle: byId<HTMLSpanElement>("v-title"),
  vPage: byId<HTMLSpanElement>("v-page"),
  vPrev: byId<HTMLButtonElement>("v-prev"),
  vNext: byId<HTMLButtonElement>("v-next"),
  vClose: byId<HTMLButtonElement>("v-close"),
  vCanvas: byId<HTMLCanvasElement>("v-canvas"),
  vHl: byId<HTMLDivElement>("v-hl"),
};

const siteConfig = sharedSiteConfig();
const policy = byId<HTMLParagraphElement>("site-policy");
policy.textContent = `This round allows ${siteConfig.minPageLimit}–${siteConfig.pageLimit} main-content pages; references are excluded.`;

const CHECK_DESCRIPTIONS: Record<CheckId, string> = {
  copyright: siteConfig.requiredCopyright
    ? `Required copyright notice in the page-1 footer: ${siteConfig.requiredCopyright}`
    : "IEEE copyright notice in the configured page-1 footer area",
  title: "Title capitalization (small caps and ALL CAPS are not allowed)",
  artifact_appendix: "Artifact Description/Evaluation sections are not allowed by this check",
  appendix: siteConfig.disabledChecks.includes("appendix")
    ? "Appendix check is disabled"
    : "Appendices are not allowed in the paper body",
  anonymized: "Paper is de-anonymized",
  undefined_refs: "No unresolved references (?? or [?])",
  page_limit: `Main content is ${siteConfig.minPageLimit}–${siteConfig.pageLimit} pages; references excluded`,
  page_numbers: "No page numbers in headers or footers",
  style: "Style conformance: template font sizes, bibliography font, and no coloured text",
  fonts_embedded: "All fonts are embedded",
  fonts_type3: "No Type 3 fonts",
};
const enabledChecks = byId<HTMLUListElement>("enabled-checks");
const checksPolicy = byId<HTMLParagraphElement>("checks-policy");
const activeChecks = CHECK_ORDER.filter((id) => !siteConfig.disabledChecks.includes(id));
checksPolicy.textContent = `${activeChecks.length} checks are enabled for this round:`;
for (const id of activeChecks) {
  const item = document.createElement("li");
  item.textContent = CHECK_DESCRIPTIONS[id];
  enabledChecks.append(item);
}
const artifactPolicy = byId<HTMLParagraphElement>("artifact-policy");
if (siteConfig.allowArtifactAppendix && siteConfig.disabledChecks.includes("artifact_appendix")) {
  artifactPolicy.textContent =
    "Artifact Description/Evaluation content is allowed; if found, it will be noted as information only.";
} else if (siteConfig.allowArtifactAppendix) {
  artifactPolicy.textContent =
    "AD/AE presence is allowed by policy; the enabled AD/AE check may still report it.";
} else if (siteConfig.disabledChecks.includes("artifact_appendix")) {
  artifactPolicy.textContent =
    "The AD/AE check is disabled; this content will neither fail the paper nor be flagged informatively.";
} else {
  artifactPolicy.textContent = "AD/AE content is not allowed; its check is enabled.";
}
mountApp(el, () => siteConfig);
