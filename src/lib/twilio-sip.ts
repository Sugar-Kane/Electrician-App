/**
 * The TwiML bridge between a Twilio number and an xAI Direct SIP number.
 *
 * Kept import-free so the exact XML handed to Twilio can be tested without a
 * Next.js runtime. Twilio remains on both legs of the call, which is what makes
 * a dual-channel recording possible while xAI still owns the conversation.
 */

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function xaiSipUriForPhone(phone: string): string | null {
  const normalized = phone.trim();
  if (!E164_PATTERN.test(normalized)) return null;
  return `sip:${normalized}@sip.voice.x.ai;transport=tls`;
}

export function xaiSipBridgeTwiml(input: {
  phone: string;
  recordingCallbackUrl: string;
}): string | null {
  const sipUri = xaiSipUriForPhone(input.phone);
  if (!sipUri) return null;

  let callbackUrl: string;
  try {
    callbackUrl = new URL(input.recordingCallbackUrl).toString();
  } catch {
    return null;
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    '  <Dial answerOnBridge="true" record="record-from-answer-dual"',
    `        recordingStatusCallback="${escapeXml(callbackUrl)}"`,
    '        recordingStatusCallbackMethod="POST"',
    '        recordingStatusCallbackEvent="completed absent">',
    `    <Sip>${escapeXml(sipUri)}</Sip>`,
    "  </Dial>",
    "</Response>",
  ].join("\n");
}
