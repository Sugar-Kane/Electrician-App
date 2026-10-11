# Volteira's sign-in emails

Supabase Auth sends these, not the app. Every electrical business that signs up for Volteira gets the same emails, so they name Volteira and never one business.

| Supabase template | File | Subject | Sent when |
| --- | --- | --- | --- |
| Confirm signup | `confirmation.html` | Confirm your email to finish signing up for Volteira | Somebody creates an account at volteira.com/signup |
| Change Email Address | `email_change.html` | Confirm your new Volteira sign-in email | Somebody changes their email under Account |
| Reset Password | `recovery.html` | Reset your Volteira password | A password reset is started (today, only from the Supabase dashboard) |

Team invitations are the app's own email (`src/lib/invitation-message.ts`, sent from Settings → Team), so they are not here.

## Putting them live

`supabase/config.toml` points a local Supabase at these files. Production keeps its templates in the dashboard, so after changing a file:

1. Open Supabase → project-volterra → **Authentication → Emails**.
2. Pick the template from the table, set its subject, and replace the body with the whole file.
3. Save.

The links (`{{ .ConfirmationURL }}`) only come back to volteira.com if **Authentication → URL Configuration** has:

- **Site URL:** `https://www.volteira.com`
- **Redirect URLs:** `https://www.volteira.com/**` and `https://volteira.com/**`

Otherwise Supabase sends people to its Site URL instead. While that was the old `electrician-app-blue.vercel.app`, a new account's confirmation link ended at a 404.
