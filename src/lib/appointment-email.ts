/**
 * "Job scheduled": the email a customer gets when the business books them in.
 *
 * Built around the two things somebody does with an appointment email: put it
 * in their calendar, and find their way there (or, for a house call, check the
 * address is theirs). So it carries a calendar invite (.ics) that Gmail, Apple
 * Mail and Outlook offer to add in one tap, and the same two actions as plain
 * buttons for every mail app that does not.
 *
 * Import-free, so the wording can be read in a test without a provider.
 */

import { escapeHtml } from "./job-change-messages.ts";

export type AppointmentFacts = {
  /** The job's id. Fixes the invite's UID, so a moved visit replaces the first invite rather than adding a second. */
  jobId: string;
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** The arrival window, ISO instants. */
  start: string;
  end: string;
  /** The business's zone: the customer is told the time as the business says it. */
  timeZone: string;
  /** One line: "4098 Eckworth Dr, Bellbrook, OH 45305". "" when there is none. */
  address: string;
};

export type AppointmentEmail = {
  subject: string;
  text: string;
  html: string;
  /** The calendar invite, as text. The sender base64s it into an attachment. */
  ics: string;
};

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "";
}

/** "Tue, Nov 24" */
function dayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "CST" — said beside the time so a customer in another zone reads it right. */
function zoneLabel(iso: string, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date(iso))
    .find((entry) => entry.type === "timeZoneName");
  return part?.value ?? "";
}

/** "Tue, Nov 24, 11:00 AM-1:00 PM (CST)" */
export function appointmentWhen(start: string, end: string, timeZone: string): string {
  const zone = zoneLabel(start, timeZone);
  return `${dayLabel(start, timeZone)}, ${clock(start, timeZone)}-${clock(end, timeZone)}${zone ? ` (${zone})` : ""}`;
}

/** 20261124T170000Z, the form both Google's link and iCalendar take. */
function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarUrl(facts: AppointmentFacts): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Appointment with ${facts.businessName}`,
    dates: `${utcStamp(facts.start)}/${utcStamp(facts.end)}`,
    details: calendarDetails(facts),
    ...(facts.address ? { location: facts.address } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Google Maps directions to the address. Opens the Maps app on a phone that has it, the website otherwise. */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: address }).toString()}`;
}

function calendarDetails(facts: AppointmentFacts): string {
  return [
    `Arrival window with ${facts.businessName}.`,
    facts.businessPhone ? `To change it, call ${facts.businessPhone}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** RFC 5545 text: backslash, semicolon and comma escaped, newlines as \n. */
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines over 75 octets are folded, or strict calendar apps refuse the file. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = new TextEncoder().encode(char).length;
    // The first line holds 75; continuation lines start with a space, so 74.
    if (size + width > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function appointmentIcs(facts: AppointmentFacts, nowIso: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Volteira//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:job-${facts.jobId}@volteira.app`,
    // Higher each time it is sent, so a re-sent invite for a moved visit
    // updates the event already in the calendar.
    `SEQUENCE:${Math.floor(Date.parse(nowIso) / 1000)}`,
    `DTSTAMP:${utcStamp(nowIso)}`,
    `DTSTART:${utcStamp(facts.start)}`,
    `DTEND:${utcStamp(facts.end)}`,
    `SUMMARY:${icsText(`Appointment with ${facts.businessName}`)}`,
    ...(facts.address ? [`LOCATION:${icsText(facts.address)}`] : []),
    `DESCRIPTION:${icsText(calendarDetails(facts))}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

const NAVY = "#06131d";
const YELLOW = "#ffc21c";
const MUTED = "#64748b";
const RULE = "#e2e8f0";

/** Solid yellow, like every button in these emails: the shared dark-mode style keeps their text navy. */
function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" class="btn" style="display:block;background:${YELLOW};color:${NAVY};border:1px solid ${YELLOW};font-weight:700;padding:13px 10px;border-radius:12px;text-decoration:none;font-size:15px;text-align:center">${escapeHtml(label)}</a>`;
}

export function appointmentEmail(facts: AppointmentFacts, nowIso: string): AppointmentEmail {
  const name = firstName(facts.contactName);
  const greeting = name ? `Hi ${name},` : "Hello,";
  const when = appointmentWhen(facts.start, facts.end, facts.timeZone);
  const calendar = googleCalendarUrl(facts);
  const directions = facts.address ? directionsUrl(facts.address) : "";
  const change = facts.businessPhone
    ? `Need a different time? Call ${facts.businessPhone}.`
    : "Need a different time? Reply to this email.";

  const subject = `${facts.businessName} - Job scheduled`;

  const text = [
    greeting,
    "",
    `Your appointment with ${facts.businessName} is scheduled.`,
    "",
    `When: ${when}`,
    "We'll arrive during this window.",
    ...(facts.address ? [`Where: ${facts.address}`] : []),
    "",
    `Add to your calendar: ${calendar}`,
    ...(directions ? [`Directions: ${directions}`] : []),
    "",
    change,
    "",
    facts.businessName,
  ].join("\n");

  const row = (label: string, value: string, note = "") =>
    `<tr><td style="padding:10px 0;border-top:1px solid ${RULE};width:84px;font-size:13px;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em">${label}</td>` +
    `<td style="padding:10px 0;border-top:1px solid ${RULE};font-size:16px;font-weight:600">${escapeHtml(value)}` +
    (note ? `<div style="font-size:13px;font-weight:400;color:${MUTED}">${escapeHtml(note)}</div>` : "") +
    `</td></tr>`;

  const html = [
    `<p style="margin:0 0 4px;font-size:14px;color:${MUTED}">${escapeHtml(dayLabel(facts.start, facts.timeZone))}, ${escapeHtml(clock(facts.start, facts.timeZone))}</p>`,
    `<h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;font-weight:800">Appointment with ${escapeHtml(facts.businessName)}</h1>`,
    `<p>${escapeHtml(greeting)} your appointment is scheduled.</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">`,
    row("When", when, "We'll arrive during this window."),
    facts.address ? row("Where", facts.address) : "",
    `</table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr>`,
    directions
      ? `<td width="50%" style="padding:0 6px 0 0">${button(calendar, "Add to Calendar")}</td><td width="50%" style="padding:0 0 0 6px">${button(directions, "Directions")}</td>`
      : `<td>${button(calendar, "Add to Calendar")}</td>`,
    `</tr></table>`,
    `<p>${escapeHtml(change)}</p>`,
  ]
    .filter(Boolean)
    .join("");

  return { subject, text, html, ics: appointmentIcs(facts, nowIso) };
}
