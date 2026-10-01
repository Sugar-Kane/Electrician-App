# Paid booking calendar connection

Settings → Integrations → Google Calendar stores the intended account and offers
Google authorization. Only paid, scheduled/confirmed bookings create events;
unpaid holds do not. Connecting or choosing “Sync upcoming paid bookings” backfills
upcoming paid visits. Repeated payment callbacks use a stable event ID. Calendar
errors are saved and cause payment webhook fulfillment to retry without charging
again or duplicating notifications.

## Deployment setup

- Enable Google Calendar API in the Google Cloud project.
- Configure a web OAuth client with this exact redirect URI:
  `https://www.volteira.com/api/integrations/google-calendar/callback`
- Set `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` in Vercel.
  The existing Google Drive client may be reused only if its Google Cloud
  configuration includes that redirect URI; code falls back to the Drive vars.
- Set `DOCUMENT_SYNC_ENCRYPTION_KEY` to a persistent 32-byte base64 key if it is
  not already configured. Do not rotate an existing key without migrating the
  encrypted credentials it protects.
- Confirm `NEXT_PUBLIC_APP_URL=https://www.volteira.com`.
- For an OAuth app in testing mode, include the intended Google account among
  the allowed test users. The account owner grants calendar access personally.

Scopes: `openid`, `email`, and `calendar.events.owned`. The callback requires the
same signed-in Volteira owner/admin, a matching signed state and HttpOnly cookie,
and a verified Google email matching the account saved in settings. Refresh
credentials are encrypted and stored in a service-role-only table.

The connection currently creates paid booking events. Subsequent manual job
rescheduling or cancellation is not a two-way calendar integration.

## Photos

Signed Twilio MMS image references are stored with messages. Photo-only messages
enter intake too. Owners and staff view photos through a tenant-scoped authenticated
route; the AI receives an attachment notice, not image contents. Supported formats:
JPEG, PNG, GIF, WebP. Customers can skip the photo invitation.
