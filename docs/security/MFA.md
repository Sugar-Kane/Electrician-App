# Two-step sign-in (compliance SEC-001-002)

**Who:** owners and admins of a business, and Volteira's own platform staff. Technicians may turn it on, but don't have to.

**When:** it can be set up now under Settings → Two-step sign-in (`/settings/security`). It is **required from December 10, 2026** (`MFA_REQUIRED_FROM` in `src/lib/mfa-policy.ts`).

**How it works:** Supabase Auth TOTP. The user scans a QR code with an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator). After that, every sign-in asks for the 6-digit code (`/mfa`).

**What is enforced:**
- Anyone who has set it up is asked for the code before any signed-in page loads (`MfaNotice` in `FieldPageShell`) and before the admin console (`requireMfa` in `src/app/admin/layout.tsx`).
- Before the deadline, owners and admins without it see a reminder on every page. From the deadline, they see a required notice, and billing and money actions refuse (`billingRefusal` → `mfaRefusal`).
- Database backstop: from the deadline, `private.is_platform_admin()` counts only sessions at `aal2`. Every `admin_*` function checks it (migration `20261126070000_platform_admin_mfa.sql`).

**Lost phone:** a Volteira platform admin opens Supabase Dashboard → Authentication → Users, finds the user, and deletes their MFA factor. The user then signs in with their password and sets it up again on the new phone. Confirm who they are first, for example by calling the business's number on file.

**Not yet covered:** the database does not require `aal2` for a business's own owner or admin writes; those are enforced in the app. Adding it to `private.is_org_admin` is a follow-up, once every owner has enrolled.
