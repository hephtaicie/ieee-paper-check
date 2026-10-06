// SPDX-License-Identifier: MIT
import type { Config, PaperReport } from "@ieee-check/core";
import { CHECK_LABELS, CHECK_ORDER } from "@ieee-check/core";
import { type App, type AppElements, esc, mountApp } from "./app.ts";
import type { MailTemplate } from "./mail-template.ts";
import { SITE_EMAIL_TEMPLATE, sharedSiteConfig } from "./site-config.ts";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el as T;
}

// ---------------------------------------------------------------------------
// Admin configuration: enable/disable checks + page limit, persisted in
// localStorage so the settings survive reloads on the admin machine.
// ---------------------------------------------------------------------------

const CONFIG_KEY = "ieee-check-admin-config-v1";
const CONFIG_BASE_KEY = "ieee-check-admin-config-base-v1";
const TITLE_WORDS_KEY = "ieee-check-admin-title-allowed-words-v1";
const REVIEW_STATUS_KEY = "ieee-check-admin-review-status-v1";

function loadAdminConfig(): Config {
  const base = sharedSiteConfig();
  const baseFingerprint = JSON.stringify(base);
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const savedBase = localStorage.getItem(CONFIG_BASE_KEY);
    if (raw === null || savedBase !== baseFingerprint) {
      localStorage.setItem(CONFIG_BASE_KEY, baseFingerprint);
      localStorage.setItem(CONFIG_KEY, JSON.stringify(base));
      const localTitleWords = JSON.parse(localStorage.getItem(TITLE_WORDS_KEY) ?? "[]") as string[];
      return {
        ...base,
        titleAllowedWords: [...new Set([...(base.titleAllowedWords ?? []), ...localTitleWords])],
      };
    }
    const saved = JSON.parse(raw) as Partial<Config>;
    const localTitleWords = JSON.parse(localStorage.getItem(TITLE_WORDS_KEY) ?? "[]") as string[];
    return {
      ...base,
      ...saved,
      titleAllowedWords: [...new Set([...(base.titleAllowedWords ?? []), ...localTitleWords])],
    };
  } catch {
    return base;
  }
}

function saveAdminConfig(config: Config): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  localStorage.setItem(CONFIG_BASE_KEY, JSON.stringify(sharedSiteConfig()));
}

type ReviewStatus = "green" | "orange" | "red";
const config: Config = loadAdminConfig();
const reviewStatus = new Map<string, ReviewStatus>(
  Object.entries(JSON.parse(localStorage.getItem(REVIEW_STATUS_KEY) ?? "{}")) as [
    string,
    ReviewStatus,
  ][],
);

function saveReviewStatus(): void {
  localStorage.setItem(REVIEW_STATUS_KEY, JSON.stringify(Object.fromEntries(reviewStatus)));
}

byId<HTMLButtonElement>("reset-review-statuses").addEventListener("click", () => {
  const confirmed = window.confirm(
    `Reset tracking statuses for all ${reviewStatus.size} saved paper(s) to red (action pending)?`,
  );
  if (!confirmed) return;
  reviewStatus.clear();
  saveReviewStatus();
  app.rerender();
});

function removePaper(file: string): void {
  reviewStatus.delete(file);
  saveReviewStatus();
  app.remove(file);
}

// ---------------------------------------------------------------------------
// Email template: subject + body with {{id}}, {{title}}, {{filename}} and
// {{errors}} placeholders, persisted in localStorage.
// ---------------------------------------------------------------------------

const TEMPLATE_KEY = "ieee-check-admin-mail-template-v1";
const TEMPLATE_BASE_KEY = "ieee-check-admin-mail-template-base-v1";

const DEFAULT_TEMPLATE: MailTemplate = SITE_EMAIL_TEMPLATE;
const TEMPLATE_FINGERPRINT = JSON.stringify(DEFAULT_TEMPLATE);

function loadTemplate(): MailTemplate {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY);
    const savedBase = localStorage.getItem(TEMPLATE_BASE_KEY);
    if (raw === null || savedBase !== TEMPLATE_FINGERPRINT) {
      localStorage.setItem(TEMPLATE_BASE_KEY, TEMPLATE_FINGERPRINT);
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(DEFAULT_TEMPLATE));
      return { ...DEFAULT_TEMPLATE };
    }
    const saved = JSON.parse(raw) as Partial<MailTemplate>;
    return {
      subject: saved.subject ?? DEFAULT_TEMPLATE.subject,
      body: saved.body ?? DEFAULT_TEMPLATE.body,
    };
  } catch {
    return { ...DEFAULT_TEMPLATE };
  }
}

function saveTemplate(t: MailTemplate): void {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t));
  localStorage.setItem(TEMPLATE_BASE_KEY, TEMPLATE_FINGERPRINT);
}

const template: MailTemplate = loadTemplate();

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function renderSettings(): void {
  const minLimit = byId<HTMLInputElement>("cfg-min-limit");
  const limit = byId<HTMLInputElement>("cfg-limit");
  minLimit.value = String(config.minPageLimit);
  limit.value = String(config.pageLimit);
  byId<HTMLInputElement>("cfg-artifact").checked = config.allowArtifactAppendix;
  byId<HTMLTextAreaElement>("cfg-copyright").value = config.requiredCopyright ?? "";
  const rows = byId<HTMLDivElement>("cfg-checks");
  rows.replaceChildren();
  for (const id of CHECK_ORDER) {
    const row = document.createElement("label");
    row.className = "cfg-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !config.disabledChecks.includes(id);
    cb.addEventListener("change", () => {
      const disabled = new Set(config.disabledChecks);
      if (cb.checked) disabled.delete(id);
      else disabled.add(id);
      config.disabledChecks = CHECK_ORDER.filter((c) => disabled.has(c));
      saveAdminConfig(config);
      void app.revalidate();
    });
    row.append(cb, document.createTextNode(` ${CHECK_LABELS[id]} (${id})`));
    rows.append(row);
  }
}

function updateLimit(field: "minPageLimit" | "pageLimit", value: string): void {
  const v = Number.parseInt(value, 10);
  if (!Number.isFinite(v) || v < 1) return;
  config[field] = v;
  saveAdminConfig(config);
  void app.revalidate();
}

byId<HTMLInputElement>("cfg-min-limit").addEventListener("change", (e) => {
  updateLimit("minPageLimit", (e.target as HTMLInputElement).value);
});
byId<HTMLInputElement>("cfg-limit").addEventListener("change", (e) => {
  updateLimit("pageLimit", (e.target as HTMLInputElement).value);
});

byId<HTMLInputElement>("cfg-artifact").addEventListener("change", (e) => {
  config.allowArtifactAppendix = (e.target as HTMLInputElement).checked;
  saveAdminConfig(config);
  void app.revalidate();
});
byId<HTMLTextAreaElement>("cfg-copyright").addEventListener("change", (e) => {
  const value = (e.target as HTMLTextAreaElement).value.trim();
  config.requiredCopyright = value || null;
  saveAdminConfig(config);
  void app.revalidate();
});

// ---------------------------------------------------------------------------
// Email template editor
// ---------------------------------------------------------------------------

function renderTemplateEditor(): void {
  const subject = byId<HTMLInputElement>("tpl-subject");
  const body = byId<HTMLTextAreaElement>("tpl-body");
  subject.value = template.subject;
  body.value = template.body;
  const reset = byId<HTMLButtonElement>("tpl-reset");
  reset.addEventListener("click", () => {
    template.subject = DEFAULT_TEMPLATE.subject;
    template.body = DEFAULT_TEMPLATE.body;
    subject.value = template.subject;
    body.value = template.body;
    saveTemplate(template);
    app.rerender();
  });
  for (const input of [subject, body] as const) {
    input.addEventListener("input", () => {
      template.subject = subject.value;
      template.body = body.value;
      saveTemplate(template);
      app.rerender();
    });
  }
}

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key: string) => vars[key] ?? m);
}

// ---------------------------------------------------------------------------
// Author list (CSV with "Submission" and "Contact Emails" columns)
// ---------------------------------------------------------------------------

/** Submission id -> author email list ("pap104s3" -> [a@x.org, b@y.org]). */
const authors = new Map<string, string[]>();

/** One CSV line -> cells, honouring double quotes (quoted cells may hold
 * commas, e.g. the comma-separated author list in "Contact Emails"). */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "," || ch === ";") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseCsv(text: string): void {
  authors.clear();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return;
  // Prefer the complete author list in "Contact Emails"; the export's
  // plain "Email" column is only the submitter/contact address.
  const head = csvCells(lines[0]!).map((c) => c.trim().toLowerCase());
  let idCol = head.findIndex((c) => c === "submission");
  let mailCol = head.findIndex((c) => c === "contact emails");
  if (mailCol === -1) mailCol = head.findIndex((c) => c === "emails");
  if (mailCol === -1) mailCol = head.findIndex((c) => c === "email");
  if (mailCol === -1) mailCol = head.findIndex((c) => c.includes("email"));
  if (idCol === -1 || mailCol === -1) {
    idCol = 0;
    mailCol = 1;
  }
  const start = idCol === 0 && mailCol === 1 && head[0]!.includes("submission") ? 1 : 0;
  for (const line of lines.slice(start)) {
    const cells = csvCells(line);
    const id = cells[idCol] ?? "";
    const emailCell = cells[mailCol] ?? "";
    if (id.length === 0 || !emailCell.includes("@")) continue;
    const emails = emailCell
      .split(/[,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));
    if (emails.length > 0) authors.set(id, emails);
  }
  byId<HTMLSpanElement>("csv-count").textContent = String(authors.size);
}

function matchSubmission(file: string): { id: string; emails: string[] } | undefined {
  // File names are built from the submission id: "pap104s3-file2.pdf".
  // The longest matching id wins.
  const base = file.replace(/\.pdf$/i, "").toLowerCase();
  let best: { id: string; emails: string[] } | undefined;
  let bestLen = 0;
  for (const [id, emails] of authors) {
    if (base.includes(id.toLowerCase()) && id.length > bestLen) {
      best = { id, emails };
      bestLen = id.length;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Mailto button inside each invalid report card
// ---------------------------------------------------------------------------

function failuresFor(r: PaperReport): string {
  return r.results
    .filter((c) => c.status === "FAIL")
    .map((c) => {
      const ev = c.evidence.map((e) => (e.page ? `[p.${e.page}] ` : "") + e.detail).join("; ");
      return `- ${CHECK_LABELS[c.id] ?? c.id}: ${ev}`;
    })
    .join("\n");
}

function titleWordsToLearn(detail: string): string[] {
  const patterns: Array<{ pattern: RegExp; group: number }> = [
    { pattern: /'([^']+)' is a small word and must be lowercase/g, group: 1 },
    { pattern: /'([^']+)' in '[^']+' must start with a capital letter/g, group: 1 },
    { pattern: /In '[^']+', '([^']+)' must be lowercase/g, group: 1 },
    { pattern: /'([^']+)' must start with a capital letter/g, group: 1 },
  ];
  const found: string[] = [];
  for (const { pattern, group } of patterns) {
    for (const match of detail.matchAll(pattern)) {
      const token = match[group];
      if (token) found.push(token);
    }
  }
  return [...new Set(found)];
}

function addTitleWordButtons(r: PaperReport, card: HTMLElement): void {
  const titleCheck = r.results.find((c) => c.id === "title" && c.status === "FAIL");
  if (!titleCheck) return;
  const words = [...new Set(titleCheck.evidence.flatMap((e) => titleWordsToLearn(e.detail)))];
  if (words.length === 0) return;
  const row = document.createElement("div");
  row.className = "title-dictionary-actions";
  const caption = document.createElement("span");
  caption.className = "muted";
  caption.textContent = "Unexpected casing? Add a word to this browser’s title dictionary:";
  row.append(caption);
  for (const word of words) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn ghost";
    button.textContent = `+ ${word}`;
    button.title = `Allow “${word}” in future paper titles in this browser`;
    button.addEventListener("click", () => {
      const entries = new Set(config.titleAllowedWords.map((w) => w.toLowerCase()));
      entries.add(word.toLowerCase());
      config.titleAllowedWords = [...entries];
      localStorage.setItem(TITLE_WORDS_KEY, JSON.stringify(config.titleAllowedWords));
      saveAdminConfig(config);
      void app.revalidate();
    });
    row.append(button);
  }
  card.append(row);
}

function mailtoHref(
  r: PaperReport,
  match: { id: string; emails: string[] },
  errors: string,
): string {
  const vars: Record<string, string> = {
    id: match.id,
    title: r.title || r.file,
    filename: r.file,
    errors,
    url: location.href.replace(/admin\.html.*$/, ""),
  };
  return (
    `mailto:${match.emails.join(",")}` +
    `?subject=${encodeURIComponent(fillTemplate(template.subject, vars))}` +
    `&body=${encodeURIComponent(fillTemplate(template.body, vars))}`
  );
}

function appendMailButton(footer: HTMLElement, href: string, label: string): void {
  const a = document.createElement("a");
  a.className = "btn";
  a.href = href;
  a.textContent = label;
  footer.append(a);
}

function addReviewStatusControl(r: PaperReport, card: HTMLElement): void {
  const wrap = document.createElement("label");
  wrap.className = "review-status-control";
  wrap.append(document.createTextNode("Tracking status"));
  const select = document.createElement("select");
  select.className = `review-status-select ${reviewStatus.get(r.file) ?? "red"}`;
  select.setAttribute("aria-label", `Tracking status for ${r.file}`);
  const options: Array<[ReviewStatus, string]> = [
    ["green", "Green — validated"],
    ["orange", "Orange — authors emailed"],
    ["red", "Red — action pending"],
  ];
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = (reviewStatus.get(r.file) ?? "red") === value;
    select.append(option);
  }
  select.addEventListener("change", () => {
    reviewStatus.set(r.file, select.value as ReviewStatus);
    select.className = `review-status-select ${select.value}`;
    saveReviewStatus();
    renderTracker();
  });
  wrap.append(select);
  card.append(wrap);
}

function augmentCard(r: PaperReport, card: HTMLElement): void {
  addReviewStatusControl(r, card);
  addTitleWordButtons(r, card);
  if (r.artifactAppendixPresent && config.allowArtifactAppendix) {
    const notice = document.createElement("div");
    notice.className = "info-notice";
    notice.textContent = "Informational: an Artifact Description/Evaluation section was detected.";
    card.append(notice);
  }
  const match = matchSubmission(r.file);
  if (r.valid && match === undefined) return;
  const footer = document.createElement("div");
  footer.className = "card-mailto";
  if (match === undefined) {
    footer.innerHTML = `<span class="muted">No matching submission id in the CSV — no email link.</span>`;
  } else {
    footer.innerHTML = `<span class="muted">→ ${esc(match.emails.join(", "))}</span>`;
    if (!r.valid) {
      appendMailButton(footer, mailtoHref(r, match, failuresFor(r)), "✉ Email about failed checks");
    }
    appendMailButton(footer, mailtoHref(r, match, ""), "✉ Compose manual email");
  }
  card.append(footer);
}

// ---------------------------------------------------------------------------
// Wire everything together
// ---------------------------------------------------------------------------

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

const trackerFilter = byId<HTMLSelectElement>("tracker-filter");
trackerFilter.addEventListener("change", () => renderTracker());

function renderTracker(): void {
  const list = byId<HTMLDivElement>("tracker-list");
  list.replaceChildren();
  const filter = trackerFilter.value;
  for (const report of app.reports) {
    const status = reviewStatus.get(report.file) ?? "red";
    if (filter !== "all" && status !== filter) continue;
    const row = document.createElement("div");
    row.className = `tracker-row ${status}`;
    const name = document.createElement("button");
    name.type = "button";
    name.className = "tracker-name";
    name.textContent = report.file;
    name.title = "Scroll to this paper";
    name.addEventListener("click", () => {
      const card = [...document.querySelectorAll<HTMLElement>("#results .card")].find(
        (candidate) => candidate.querySelector(".fname")?.textContent === report.file,
      );
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const badge = document.createElement("span");
    badge.className = "tracker-status";
    badge.textContent =
      status === "green" ? "Validated" : status === "orange" ? "Emailed" : "Pending";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tracker-remove";
    remove.setAttribute("aria-label", `Remove ${report.file} from the tracking list`);
    remove.title = "Remove this paper and reset its tracking status";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const confirmed = window.confirm(
        `Remove ${report.file} from the analyzed papers and reset its status?`,
      );
      if (confirmed) removePaper(report.file);
    });
    row.append(name, badge, remove);
    list.append(row);
  }
  byId<HTMLElement>("paper-tracker").hidden = app.reports.length === 0;
}

const app: App = mountApp(el, () => config, augmentCard, renderTracker);

byId<HTMLInputElement>("csv-file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f === undefined) return;
  parseCsv(await f.text());
  app.rerender();
});

renderSettings();
renderTemplateEditor();
