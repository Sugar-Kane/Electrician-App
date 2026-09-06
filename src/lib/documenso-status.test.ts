import assert from "node:assert/strict";
import test from "node:test";

import {
  documensoEventContractStatus,
  isStaleDocumensoEvent,
  sameDocumensoEvent,
} from "./documenso-status.ts";

test("Documenso lifecycle events map without prematurely calling one signature complete", () => {
  assert.equal(documensoEventContractStatus("DOCUMENT_SENT"), "sent");
  assert.equal(documensoEventContractStatus("DOCUMENT_OPENED"), "sent");
  assert.equal(documensoEventContractStatus("DOCUMENT_SIGNED"), "sent");
  assert.equal(documensoEventContractStatus("DOCUMENT_RECIPIENT_COMPLETED"), "sent");
  assert.equal(documensoEventContractStatus("DOCUMENT_COMPLETED"), "signed");
  assert.equal(documensoEventContractStatus("DOCUMENT_REJECTED"), "void");
  assert.equal(documensoEventContractStatus("DOCUMENT_CANCELLED"), "void");
  assert.equal(documensoEventContractStatus("TEMPLATE_CREATED"), null);
});

test("Documenso retries compare timestamps by instant, not string formatting", () => {
  assert.equal(
    sameDocumensoEvent(
      "DOCUMENT_REJECTED",
      "2026-09-06T08:00:00+00:00",
      "DOCUMENT_REJECTED",
      "2026-09-06T08:00:00.000Z",
    ),
    true,
  );
  assert.equal(
    sameDocumensoEvent(
      "DOCUMENT_SENT",
      "2026-09-06T08:00:00Z",
      "DOCUMENT_OPENED",
      "2026-09-06T08:00:00Z",
    ),
    false,
  );
});

test("Documenso deliveries older than the stored audit event are stale", () => {
  assert.equal(
    isStaleDocumensoEvent("2026-09-06T08:00:01Z", "2026-09-06T08:00:00Z"),
    true,
  );
  assert.equal(
    isStaleDocumensoEvent("2026-09-06T08:00:00Z", "2026-09-06T08:00:00Z"),
    false,
  );
  assert.equal(isStaleDocumensoEvent(null, "2026-09-06T08:00:00Z"), false);
});
