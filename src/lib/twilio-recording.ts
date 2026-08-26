/** Pure validation for Twilio recording webhooks and playback paths. */

export const TWILIO_CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;
export const TWILIO_RECORDING_SID_PATTERN = /^RE[0-9a-f]{32}$/i;

const RECORDING_STATUSES = new Set(["in-progress", "completed", "absent", "failed"]);

export type TwilioRecordingEvent = {
  accountSid: string;
  callSid: string;
  recordingSid: string;
  status: "in-progress" | "completed" | "absent" | "failed";
  durationSeconds: number | null;
  channels: 1 | 2 | null;
  startedAt: string | null;
};

function nonNegativeInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function readTwilioRecordingEvent(
  params: Record<string, string>,
): TwilioRecordingEvent | null {
  const accountSid = params.AccountSid ?? "";
  const callSid = params.CallSid ?? "";
  const recordingSid = params.RecordingSid ?? "";
  const status = (params.RecordingStatus ?? "").toLowerCase();
  if (
    !/^AC[0-9a-f]{32}$/i.test(accountSid) ||
    !TWILIO_CALL_SID_PATTERN.test(callSid) ||
    !TWILIO_RECORDING_SID_PATTERN.test(recordingSid) ||
    !RECORDING_STATUSES.has(status)
  ) {
    return null;
  }

  const rawChannels = nonNegativeInteger(params.RecordingChannels);
  const channels = rawChannels === 1 || rawChannels === 2 ? rawChannels : null;

  return {
    accountSid,
    callSid,
    recordingSid,
    status: status as TwilioRecordingEvent["status"],
    durationSeconds: nonNegativeInteger(params.RecordingDuration),
    channels,
    startedAt: isoDate(params.RecordingStartTime),
  };
}
