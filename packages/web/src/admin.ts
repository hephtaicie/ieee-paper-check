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

const STORE_KEY = "ieee-check-admin-config-v1";

function loadAdminConfig(): Config {
  const base: Config = { ...DEFAULT_CONFIG, disabledChecks: [] };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === null) return base;
    const saved = JSON.parse(raw) as Partial<Config>;
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

function saveAdminConfig(config: Config): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(config));
}

const config: Config = loadAdminConfig();

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
// Author list (CSV export with "Submission" and "Emails" columns) and
// mailto reminders
// ---------------------------------------------------------------------------

/** Submission id -> author email list ("pap104s3" -> [a@x.org, b@y.org]). */
const authors = new Map<string, string[]>();

/** One CSV line -> cells, honouring double quotes (quoted cells may hold
 * commas, e.g. the comma-separated author list in "Emails"). */
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
  // Column layout from the header: "Submission" and "Emails" by name;
  // fall back to the first two columns when the header is absent.
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

function authorFor(file: string): string[] | undefined {
  // File names are built from the submission id: "pap104s3-file2.pdf".
  // The longest matching id wins.
  const base = file.replace(/\.pdf$/i, "").toLowerCase();
  let best: string[] | undefined;
  let bestLen = 0;
  for (const [id, emails] of authors) {
    if (base.includes(id.toLowerCase()) && id.length > bestLen) {
      best = emails;
      bestLen = id.length;
    }
  }
  return best;
}

function failuresFor(r: PaperReport): string {
  return r.results
    .filter((c) => c.status === "FAIL")
    .map((c) => {
      const ev = c.evidence.map((e) => (e.page ? `[p.${e.page}] ` : "") + e.detail).join("; ");
      return `- ${CHECK_LABELS[c.id] ?? c.id}: ${ev}`;
    })
    .join("\n");
}

function mailtoFor(r: PaperReport): { href: string; emails: string[]; id: string } | null {
  const emails = authorFor(r.file);
  if (emails === undefined || emails.length === 0 || r.valid) return null;
  // The file name is the submission id plus an upload suffix.
  const id = r.file.replace(/\.pdf$/i, "").replace(/[-_].*$/, "");
  const subject = `Camera-ready revision needed — submission ${id}`;
  const body =
    `Dear authors,\n\n` +
    `Our automated camera-ready check found issues in your submission ` +
    `(${r.file}). Please correct the following and upload a revised PDF:\n\n` +
    `${failuresFor(r)}\n\n` +
    `You can verify your revision yourself before re-uploading with the ` +
    `public checker (nothing is uploaded: the analysis runs in your browser):\n` +
    `${location.href.replace(/admin\.html.*$/, "")}\n\n` +
    `Kind regards,\nThe publication chairs`;
  return {
    href: `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    emails,
    id,
  };
}

function renderMailtoColumn(): void {
  const links = byId<HTMLDivElement>("mailto-links");
  links.replaceChildren();
  for (const r of app.reports) {
    if (r.valid) continue;
    const row = document.createElement("div");
    row.className = "mailto-row";
    const match = mailtoFor(r);
    if (match === null) {
      row.innerHTML = `<span class="fname">${esc(r.file)}</span> <span class="muted">no matching submission id in the CSV</span>`;
    } else {
      row.innerHTML = `<span class="fname">${esc(r.file)}</span> → <span class="muted">${esc(match.emails.join(", "))}</span>`;
      const a = document.createElement("a");
      a.className = "btn";
      a.href = match.href;
      a.textContent = "✉ Email authors";
      row.append(a);
    }
    links.append(row);
  }
}

byId<HTMLInputElement>("csv-file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f === undefined) return;
  parseCsv(await f.text());
  renderMailtoColumn();
});

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

const app: App = mountApp(el, () => config, renderMailtoColumn);

renderSettings();
