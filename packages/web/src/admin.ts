// SPDX-License-Identifier: MIT
import type { Config, PaperReport } from "@ieee-check/core";
import { CHECK_LABELS, CHECK_ORDER, DEFAULT_CONFIG } from "@ieee-check/core";
import { type App, type AppElements, esc, mountApp } from "./app.ts";

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

function loadAdminConfig(): Config {
  const base: Config = { ...DEFAULT_CONFIG, disabledChecks: [] };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw === null) return base;
    const saved = JSON.parse(raw) as Partial<Config>;
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

function saveAdminConfig(config: Config): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

const config: Config = loadAdminConfig();

// ---------------------------------------------------------------------------
// Email template: subject + body with {{id}}, {{title}}, {{filename}} and
// {{errors}} placeholders, persisted in localStorage.
// ---------------------------------------------------------------------------

const TEMPLATE_KEY = "ieee-check-admin-mail-template-v1";

interface MailTemplate {
  subject: string;
  body: string;
}

const DEFAULT_TEMPLATE: MailTemplate = {
  subject: "Camera-ready revision needed — submission {{id}}",
  body:
    "Dear authors,\n\n" +
    "Our automated camera-ready check found issues in your submission " +
    "(file {{filename}}, “{{title}}”). Please correct the following and " +
    "upload a revised PDF:\n\n" +
    "{{errors}}\n\n" +
    "You can verify your revision yourself before re-uploading with the " +
    "public checker (nothing is uploaded: the analysis runs in your " +
    "browser):\n{{url}}\n\n" +
    "Kind regards,\nThe publication chairs",
};

function loadTemplate(): MailTemplate {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY);
    if (raw !== null) {
      const saved = JSON.parse(raw) as Partial<MailTemplate>;
      return {
        subject: saved.subject ?? DEFAULT_TEMPLATE.subject,
        body: saved.body ?? DEFAULT_TEMPLATE.body,
      };
    }
  } catch {
    // fall through to the default template
  }
  return { ...DEFAULT_TEMPLATE };
}

function saveTemplate(t: MailTemplate): void {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(t));
}

const template: MailTemplate = loadTemplate();

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function renderSettings(): void {
  const limit = byId<HTMLInputElement>("cfg-limit");
  limit.value = String(config.pageLimit);
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

byId<HTMLInputElement>("cfg-limit").addEventListener("change", (e) => {
  const v = Number.parseInt((e.target as HTMLInputElement).value, 10);
  if (Number.isFinite(v) && v > 0) {
    config.pageLimit = v;
    saveAdminConfig(config);
    void app.revalidate();
  }
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
  // Column layout from the header: "Submission" and anything with
  // "email" in it (the export says "Contact Emails"); fall back to the
  // first two columns when the header is absent.
  const head = csvCells(lines[0]!).map((c) => c.toLowerCase());
  let idCol = head.findIndex((c) => c.includes("submission"));
  let mailCol = head.findIndex((c) => c.includes("email"));
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

function augmentCard(r: PaperReport, card: HTMLElement): void {
  if (r.valid) return;
  const footer = document.createElement("div");
  footer.className = "card-mailto";
  const match = matchSubmission(r.file);
  if (match === undefined) {
    footer.innerHTML = `<span class="muted">No matching submission id in the CSV — no email link.</span>`;
  } else {
    const vars: Record<string, string> = {
      id: match.id,
      title: r.title || r.file,
      filename: r.file,
      errors: failuresFor(r),
      url: location.href.replace(/admin\.html.*$/, ""),
    };
    const href =
      `mailto:${match.emails.join(",")}` +
      `?subject=${encodeURIComponent(fillTemplate(template.subject, vars))}` +
      `&body=${encodeURIComponent(fillTemplate(template.body, vars))}`;
    footer.innerHTML = `<span class="muted">→ ${esc(match.emails.join(", "))}</span>`;
    const a = document.createElement("a");
    a.className = "btn";
    a.href = href;
    a.textContent = "✉ Email authors";
    footer.append(a);
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

const app: App = mountApp(el, () => config, augmentCard);

byId<HTMLInputElement>("csv-file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f === undefined) return;
  parseCsv(await f.text());
  app.rerender();
});

renderSettings();
renderTemplateEditor();
