import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { paidCalendarEvent } from "./booking-calendar-event.ts";
const source = ts.transpileModule(readFileSync(new URL("./google-booking-calendar.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const row = { id: "request", organization_id: "org", status: "scheduled", deposit_paid_at: "2026-09-30", created_job_id: "6f31578f-9413-4ac4-bfb1-b56a7467686f", arrival_window_start: "2026-09-30T15:00:00Z", arrival_window_end: "2026-09-30T17:00:00Z" };
function harness(options: { connected?: boolean; status?: number; existingBooking?: string; paid?: boolean } = {}) {
  const calls: { url: string; method?: string }[] = [];
  const writes: { table: string; value: Record<string, unknown> }[] = [];
  const db = { from(table: string) {
    const data = table === "booking_requests" ? { ...row, deposit_paid_at: options.paid === false ? null : row.deposit_paid_at } : options.connected === false ? null : { account_email: "nick@example.com", encrypted_refresh_token: "encrypted" };
    const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data, error: null }),
      upsert(value: Record<string, unknown>) { writes.push({ table, value }); return q; }, update(value: Record<string, unknown>) { writes.push({ table, value }); return q; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ error: null }).then(resolve); } };
    return q;
  } };
  const exports: { syncPaidBookingCalendar?: (token: string) => Promise<string> } = {};
  runInNewContext(source, { exports, URL, URLSearchParams, AbortSignal, process: { env: { GOOGLE_CALENDAR_CLIENT_ID: "client", GOOGLE_CALENDAR_CLIENT_SECRET: "secret", NEXT_PUBLIC_APP_URL: "https://example.com", DOCUMENT_SYNC_ENCRYPTION_KEY: "test" } },
    require(name: string) {
      if (name === "server-only") return {};
      if (name.endsWith("document-secrets")) return { decryptDocumentSecret: () => "refresh" };
      if (name.endsWith("supabase/admin")) return { getSupabaseAdmin: () => db };
      if (name.endsWith("booking-calendar-event")) return { paidCalendarEvent };
      throw new Error(name);
    },
    fetch: async (url: string, init: { method?: string }) => {
      calls.push({ url, method: init.method });
      if (url.includes("oauth2")) return Response.json({ access_token: "access" });
      if (init.method === "POST") return new Response("{}", { status: options.status ?? 200 });
      return Response.json({ extendedProperties: { private: { volteira_booking_id: options.existingBooking ?? "request" } } });
    },
  });
  return { calls, writes, sync: exports.syncPaidBookingCalendar! };
}
test("unpaid holds and disconnected calendars make no Google calls", async () => {
  for (const options of [{ paid: false }, { connected: false }]) { const h = harness(options); await h.sync("token"); assert.equal(h.calls.length, 0); }
});
test("a paid booking creates an event and saves its sync receipt", async () => {
  const h = harness(); assert.equal(await h.sync("token"), "synced");
  assert.equal(h.calls.filter(c => c.url.includes("/events?") && c.method === "POST").length, 1);
  assert.ok(h.writes.some(w => w.table === "booking_calendar_events" && w.value.synced_at));
});
test("duplicate event conflict is verified instead of creating another event", async () => {
  const h = harness({ status: 409 }); assert.equal(await h.sync("token"), "synced");
  assert.ok(h.calls.some(c => c.url.endsWith(paidCalendarEvent(row)!.id) && !c.method));
});
test("Google failures are recorded and surfaced for webhook retry", async () => {
  const h = harness({ status: 503 }); await assert.rejects(h.sync("token"), /503/);
  assert.ok(h.writes.some(w => w.table === "booking_calendar_events" && w.value.last_error));
});
test("a conflicting event from another booking is not accepted", async () => {
  const h = harness({ status: 409, existingBooking: "other" }); await assert.rejects(h.sync("token"), /review/);
});
