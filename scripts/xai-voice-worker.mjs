#!/usr/bin/env node
/**
 * The process that holds a phone call open.
 *
 * xAI answers the SIP call and bridges the audio, but the session has to be
 * configured over a WebSocket that stays connected for the length of the call.
 * A serverless function cannot do that, so this small server does — and only
 * that.
 *
 * It is deliberately a pipe. It decides nothing: the raw webhook body goes to
 * the app, which verifies the signature, works out which business was called,
 * mints the booking URL, and hands back the exact `session.update` to send. The
 * tenant rules stay in one place, where they are tested, and this file has no
 * opinions worth reviewing.
 *
 * Run it anywhere that stays up — a small always-on host, or your own machine
 * behind a tunnel while testing:
 *
 *   APP_URL=https://www.example.com XAI_API_KEY=xai-... node scripts/xai-voice-worker.mjs
 *
 * Then register that public URL as the webhook when you create the SIP phone
 * number. No secrets beyond the API key live here; the webhook signing secret
 * stays with the app that checks it.
 */

import http from "node:http";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const XAI_API_KEY = process.env.XAI_API_KEY ?? "";
const PORT = Number(process.env.PORT ?? 8080);

if (!APP_URL || !XAI_API_KEY) {
  console.error("APP_URL and XAI_API_KEY are both required.");
  process.exit(1);
}

if (typeof WebSocket === "undefined") {
  console.error("This needs Node 22 or newer, which has WebSocket built in.");
  process.exit(1);
}

const log = (callId, message, extra) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), callId, message, ...extra }));

/**
 * Configure the session, then let the model speak first.
 *
 * The socket is held until xAI closes it. Nothing is sent after the opening
 * two events — tool calls go straight from xAI to the app's MCP endpoint and
 * never pass through here.
 */
function joinCall({ callId, realtimeUrl, sessionUpdate }) {
  const socket = new WebSocket(realtimeUrl, {
    headers: { Authorization: `Bearer ${XAI_API_KEY}` },
  });

  socket.addEventListener("open", () => {
    log(callId, "joined");
    socket.send(JSON.stringify(sessionUpdate));
    socket.send(JSON.stringify({ type: "response.create" }));
  });

  socket.addEventListener("message", (event) => {
    let parsed;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }
    // Audio deltas arrive constantly and are not ours to look at. Errors and
    // tool activity are the only things worth a line in the log.
    if (parsed.type === "error") log(callId, "error", { error: parsed.error ?? parsed });
    else if (!String(parsed.type ?? "").includes("delta")) log(callId, parsed.type);
  });

  socket.addEventListener("error", () => log(callId, "socket error"));
  socket.addEventListener("close", (event) =>
    log(callId, "closed", { code: event.code, reason: event.reason }),
  );
}

const server = http.createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" }).end("Method Not Allowed");
    return;
  }

  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", async () => {
    // Forwarded byte for byte: a re-serialised body will not match the
    // signature the app is about to check.
    const body = Buffer.concat(chunks).toString("utf-8");

    try {
      const forwarded = await fetch(`${APP_URL}/api/xai/voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "webhook-id": request.headers["webhook-id"] ?? "",
          "webhook-timestamp": request.headers["webhook-timestamp"] ?? "",
          "webhook-signature": request.headers["webhook-signature"] ?? "",
        },
        body,
      });

      const text = await forwarded.text();
      if (!forwarded.ok) {
        log(null, "app refused the webhook", { status: forwarded.status, body: text.slice(0, 200) });
        response.writeHead(forwarded.status).end(text);
        return;
      }

      const payload = JSON.parse(text);

      // Answer xAI before opening the socket. A webhook left waiting on a
      // connection is a webhook that times out.
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");

      if (payload.callId) joinCall(payload);
    } catch (error) {
      log(null, "could not reach the app", { error: String(error) });
      response.writeHead(502).end("Bad Gateway");
    }
  });
});

server.listen(PORT, () => console.log(`Waiting for calls on :${PORT}, app at ${APP_URL}`));
