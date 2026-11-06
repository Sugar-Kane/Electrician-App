/**
 * Spreadsheet files of a business's own records, and who may download them.
 *
 * Kept free of imports so the rules can be tested on their own.
 */

/**
 * One cell, safe to open in Excel, Numbers or Google Sheets.
 *
 * A cell starting with = + - @ (or a tab or carriage return) is run as a
 * formula by spreadsheet apps, and some of these cells hold what customers
 * typed: a name, a job description. So such a cell gets a leading apostrophe,
 * which shows it as plain text. Numbers are written as numbers and are never
 * changed, so a refund of -25.00 stays a number.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: a header row, then one row per record, with Windows line ends Excel expects. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  // The byte-order mark makes Excel read accents and the ° in "50 ft" correctly.
  return `﻿${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Cents as dollars a spreadsheet adds up: 128050 → 1280.5. */
export function dollars(cents: unknown): number {
  const value = Number(cents ?? 0);
  return Number.isFinite(value) ? Math.round(value) / 100 : 0;
}

/** Who may download a business's records: they include customers' contact details and its money. */
const EXPORT_ROLES = new Set(["owner", "admin", "accountant"]);

export function canExportReports(role: string | null | undefined): boolean {
  return EXPORT_ROLES.has(role ?? "");
}

/** A plain date, or null. */
function plainDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text;
}

/**
 * The days a download covers, both ends included. Blank means from the 1st of
 * January of this year to today; a range given backwards is turned round.
 */
export function exportRange(from: string | null | undefined, to: string | null | undefined, today: string): { from: string; to: string } {
  const end = plainDate(to) ?? today;
  const start = plainDate(from) ?? `${end.slice(0, 4)}-01-01`;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}
