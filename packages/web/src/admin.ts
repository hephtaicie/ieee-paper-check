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
// Author list (papers.csv: paperid,email[,name]) and mailto reminders
// ---------------------------------------------------------------------------

const authors = new Map<string, string>();

function parseCsv(text: string): void {
  authors.clear();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,;]/).map((c) => c.trim());
    if (cells.length < 2) continue;
    // Skip a header row ("paper", "email", ...).
    if (!/^#?\d+$/.test(cells[0]!) || !cells[1]!.includes("@")) continue;
    authors.set(cells[0]!, cells[1]!);
  }
  byId<HTMLSpanElement>("csv-count").textContent = String(authors.size);
}

function authorFor(file: string): string | undefined {
  // File names usually carry the paper id: "42.pdf", "paper_0042_v2.pdf".
  const m = /(\d{1,4})/.exec(file.replace(/\.pdf$/i, ""));
  return m ? authors.get(String(Number.parseInt(m[1]!, 10))) : undefined;
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

function mailtoFor(r: PaperReport): string | null {
  const to = authorFor(r.file);
  if (to === undefined || r.valid) return null;
  const subject = `Camera-ready revision needed — paper ${r.file.replace(/\.pdf$/i, "")}`;
  const body =
    `Dear author,\n\n` +
    `Our automated camera-ready check found issues in your submission ` +
    `(${r.file}). Please correct the following and upload a revised PDF:\n\n` +
    `${failuresFor(r)}\n\n` +
    `You can verify your revision yourself before re-uploading with the ` +
    `public checker (nothing is uploaded: the analysis runs in your browser):\n` +
    `${location.href.replace(/admin\.html.*$/, "")}\n\n` +
    `Kind regards,\nThe publication chairs`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderMailtoColumn(): void {
  const links = byId<HTMLDivElement>("mailto-links");
  links.replaceChildren();
  for (const r of app.reports) {
    if (r.valid) continue;
    const row = document.createElement("div");
    row.className = "mailto-row";
    const href = mailtoFor(r);
    if (href === null) {
      row.innerHTML = `<span class="fname">${esc(r.file)}</span> <span class="muted">no matching email in the CSV (id not found)</span>`;
    } else {
      row.innerHTML = `<span class="fname">${esc(r.file)}</span> → <span class="muted">${esc(authorFor(r.file) ?? "")}</span>`;
      const a = document.createElement("a");
      a.className = "btn";
      a.href = href;
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
