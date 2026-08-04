import "server-only";

export type ReceptionistIntegrationStage = "credentials_required" | "configuration_ready";

export type ReceptionistIntegration = {
  id: "telephony" | "voice-agent" | "assistant-model";
  name: string;
  programName: string;
  stage: ReceptionistIntegrationStage;
  statusLabel: string;
  description: string;
  applicationUrl: string;
  applicationLabel: string;
  capabilities: string[];
  missingConfiguration: string[];
  caveat: string;
};

function missingEnvironmentVariables(names: string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}

export function getReceptionistIntegrations(): ReceptionistIntegration[] {
  const telephonyRequired = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "PUBLIC_BASE_URL"];
  const voiceRequired = ["VOICE_AGENT_WEBHOOK_SECRET"];
  const modelRequired = ["ANTHROPIC_API_KEY", "SUPABASE_SECRET_KEY"];

  const telephonyMissing = missingEnvironmentVariables(telephonyRequired);
  const voiceMissing = missingEnvironmentVariables(voiceRequired);
  const modelMissing = missingEnvironmentVariables(modelRequired);

  return [
    {
      id: "telephony",
      name: "Twilio",
      programName: "Voice and Messaging",
      stage: telephonyMissing.length === 0 ? "configuration_ready" : "credentials_required",
      statusLabel: telephonyMissing.length === 0 ? "Credentials added" : "Account credentials needed",
      description:
        "Supplies the business phone number that customers call and text. Inbound texts post to /api/sms/inbound; calls hand off to the voice agent.",
      applicationUrl: "https://www.twilio.com/console",
      applicationLabel: "Open the Twilio Console",
      capabilities: ["Business phone number", "Inbound SMS", "Inbound voice", "Emergency paging"],
      missingConfiguration: telephonyMissing,
      caveat:
        "US A2P 10DLC registration is required before texting mainstream carriers, and it takes days. Emergency leads page the number in inbound_numbers.forward_to_number — without it they wait in the app.",
    },
    {
      id: "voice-agent",
      name: "Voice agent platform",
      programName: "Vapi or Retell",
      stage: voiceMissing.length === 0 ? "configuration_ready" : "credentials_required",
      statusLabel: voiceMissing.length === 0 ? "Webhook secret added" : "Webhook secret needed",
      description:
        "Runs the real-time speech loop — listening, interrupting, speaking. The agent reaches this app through /api/voice/agent for business facts and to file leads.",
      applicationUrl: "https://docs.vapi.ai/server-url",
      applicationLabel: "Configure the platform server URL",
      capabilities: ["Speech-to-speech", "Barge-in", "Live transfer", "Call transcript and summary"],
      missingConfiguration: voiceMissing,
      caveat:
        "Point the platform's server URL at /api/voice/agent and set the same secret there. Tools to register: business_info, check_service_area, capture_lead, request_callback_transfer. If you turn call recording on at the platform, also set RECEPTIONIST_RECORDS_CALLS=true so the agent discloses it — California requires consent from every party.",
    },
    {
      id: "assistant-model",
      name: "Claude",
      programName: "Anthropic API",
      stage: modelMissing.length === 0 ? "configuration_ready" : "credentials_required",
      statusLabel: modelMissing.length === 0 ? "API key added" : "API key needed",
      description:
        "Writes the text-message replies and decides when a conversation has enough detail to become a lead. The voice agent uses its own platform model for speech.",
      applicationUrl: "https://platform.claude.com/settings/keys",
      applicationLabel: "Create an Anthropic API key",
      capabilities: ["SMS replies", "Lead extraction", "Shared call and text thread"],
      missingConfiguration: modelMissing,
      caveat:
        "SUPABASE_SECRET_KEY is the service-role key the webhooks write with. It bypasses row-level security, so it must never be exposed to the browser.",
    },
  ];
}
