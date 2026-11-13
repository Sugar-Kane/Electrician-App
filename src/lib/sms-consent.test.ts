import assert from "node:assert/strict";
import test from "node:test";

import { CONSENT_SOURCES, PHONE_BOOKING_CONSENT_SOURCE } from "./sms-consent.ts";

// messaging_consent_source_check, as deployed. A source outside it is refused
// by the database, and the caller who agreed to texts then has no consent on
// file and gets no text.
const ACCEPTED_BY_THE_DATABASE = ["booking_form", "verbal", "written", "inbound_text", "import", "admin"];

test("a phone booking's text consent is saved under a source the database accepts", () => {
  assert.ok(ACCEPTED_BY_THE_DATABASE.includes(PHONE_BOOKING_CONSENT_SOURCE));
  assert.deepEqual([...CONSENT_SOURCES].sort(), [...ACCEPTED_BY_THE_DATABASE].sort());
});
