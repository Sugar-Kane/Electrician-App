import assert from "node:assert/strict";
import { test } from "node:test";

import { canExportReports, csvCell, dollars, exportRange, toCsv } from "./csv.ts";

test("cells a spreadsheet would run as formulas are shown as text", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\",\"click\")"), `"'=HYPERLINK(""http://x"",""click"")"`);
  assert.equal(csvCell("+1 805 555 0142"), "'+1 805 555 0142");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\t=1"), "'\t=1");
});

test("numbers stay numbers, negative ones included", () => {
  assert.equal(csvCell(-25), "-25");
  assert.equal(csvCell(1280.5), "1280.5");
  assert.equal(csvCell(Number.NaN), "");
});

test("commas, quotes and line breaks are quoted", () => {
  assert.equal(csvCell("Smith, Jane"), `"Smith, Jane"`);
  assert.equal(csvCell('12" box'), `"12"" box"`);
  assert.equal(csvCell("line one\nline two"), `"line one\nline two"`);
  assert.equal(csvCell(null), "");
});

test("a file has a header, Windows line ends and a byte-order mark", () => {
  assert.equal(toCsv(["A", "B"], [[1, "x"]]), "﻿A,B\r\n1,x\r\n");
});

test("cents become dollars", () => {
  assert.equal(dollars(128050), 1280.5);
  assert.equal(dollars(null), 0);
  assert.equal(dollars("abc"), 0);
});

test("only owners, admins and accountants can download records", () => {
  for (const role of ["owner", "admin", "accountant"]) assert.equal(canExportReports(role), true, role);
  for (const role of ["technician", "dispatcher", "", null, undefined, "Owner"]) assert.equal(canExportReports(role), false, String(role));
});

test("the date range defaults to this year and turns round a backwards one", () => {
  assert.deepEqual(exportRange(null, null, "2026-11-05"), { from: "2026-01-01", to: "2026-11-05" });
  assert.deepEqual(exportRange("2026-03-01", "2026-02-01", "2026-11-05"), { from: "2026-02-01", to: "2026-03-01" });
  assert.deepEqual(exportRange("2026-02-30", "nonsense", "2026-11-05"), { from: "2026-01-01", to: "2026-11-05" });
});
