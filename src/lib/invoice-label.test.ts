import test from "node:test";
import assert from "node:assert/strict";

import { invoiceLabel, invoiceRef } from "./invoice-label.ts";

test("an invoice shows the number after its job, and an older one keeps its own", () => {
  assert.equal(invoiceLabel({ number_label: "24", invoice_number: 12 }), "24");
  assert.equal(invoiceLabel({ number_label: "24-2", invoice_number: 13 }), "24-2");
  assert.equal(invoiceLabel({ invoice_number: 11 }), "11");
  assert.equal(invoiceLabel({ number_label: "  ", invoice_number: 11 }), "11");
  assert.equal(invoiceLabel(null), "");
});

test("an invoice is found however its number is written", () => {
  assert.equal(invoiceRef("INV-24"), "24");
  assert.equal(invoiceRef("inv 24-2"), "24-2");
  assert.equal(invoiceRef("#24"), "24");
  assert.equal(invoiceRef(24), "24");
  assert.equal(invoiceRef(""), "");
});
