# Document storage and cloud sync

## Standard user folder structure

```text
Electrician App
├── Company
│   ├── Business Information
│   ├── Licenses & Insurance
│   ├── Templates
│   └── Price Book
├── Customers
│   └── Customer or Company
│       └── Properties
│           └── Service Address
│               └── Job #1045 – Panel Upgrade
│                   ├── 01 Intake
│                   ├── 02 Estimates
│                   ├── 03 Permits
│                   ├── 04 Photos
│                   │   ├── Before
│                   │   └── After
│                   ├── 05 Invoices & Payments
│                   ├── 06 Warranties
│                   └── 07 Completion
├── Operations
│   ├── Inventory
│   ├── Purchase Orders
│   └── Vendors
├── Team
│   └── Certifications
└── Reports
```

The database automatically creates organization folders. Customer, property, and job folders are created alongside their corresponding business records. Stable internal keys prevent duplicate folders when a customer or address is renamed.

## File naming

Files use this pattern:

```text
YYYY-MM-DD_job-NUMBER_document-type_short-description.ext
```

Example:

```text
2026-08-03_job-1045_photo-before_main-panel.jpg
```

## Storage model

- Supabase Storage bucket: `business-documents` (private)
- Object path prefix: `{organization_id}/...`
- Postgres models the folder hierarchy because Storage folders are key prefixes, not full hierarchical records.
- Row Level Security checks the first path segment against the signed-in user's organization membership.
- Document metadata can be connected to a customer, property, job, estimate, or invoice.
- Cloud object IDs and synchronization state are stored separately from core document records.

## Google Drive permissions

The app requests:

```text
openid
email
https://www.googleapis.com/auth/drive.file
```

`drive.file` allows the app to manage files it created or the user explicitly shared with it. It does not grant access to the user's entire Drive.

## Laptop activation checklist

1. Apply the pending Supabase migrations.
2. Create a Google Cloud project and enable Google Drive API.
3. Configure the OAuth consent screen.
4. Create a Web application OAuth client.
5. Add these authorized redirect URIs:

   ```text
   http://localhost:3000/api/integrations/google-drive/callback
   https://electrician-app-blue.vercel.app/api/integrations/google-drive/callback
   ```

6. Add the following server-only Vercel environment values:

   ```text
   SUPABASE_SECRET_KEY
   DOCUMENT_SYNC_ENCRYPTION_KEY
   GOOGLE_DRIVE_CLIENT_ID
   GOOGLE_DRIVE_CLIENT_SECRET
   ```

7. Generate the encryption key locally:

   ```bash
   openssl rand -base64 32
   ```

8. Redeploy, sign in as an organization owner or admin, open `/files`, and select **Connect Google Drive**.

Refresh tokens are encrypted with AES-256-GCM before being stored in the private database schema. They are never returned to a browser or mobile client.

## OneDrive

The database accepts `onedrive` as a provider and uses provider-neutral folder and cloud-link records. Google Drive is the first implemented OAuth and folder-creation provider. OneDrive can be added later through Microsoft Graph without changing user folders or document ownership.
