# Dependency assessment

All 21 declared packages reviewed; no confirmed removable dependency. No package or lockfile changes.

| Package | Declared version | Category | Evidence | Disposition |
|---|---|---|---|---|
| `@anthropic-ai/sdk` | `^0.116.0` | dependencies | src/lib/claude.ts:3 | Retained |
| `@react-pdf/renderer` | `^4.6.0` | dependencies | src/lib/pdf/invoice-document.tsx:1; PDF generation | Retained |
| `@supabase/ssr` | `0.12.4` | dependencies | src/lib/supabase/server.ts:3; browser and proxy clients | Retained |
| `@supabase/supabase-js` | `2.112.0` | dependencies | src/lib/supabase/admin.ts:3; typed clients | Retained |
| `@vercel/blob` | `2.8.0` | dependencies | src/app/api/admin/site-videos/upload/route.ts:1 | Retained |
| `lucide-react` | `1.28.0` | dependencies | UI icon imports throughout src/app and src/components | Retained |
| `next` | `16.4.6` | dependencies | package.json build/dev/start; App Router and next.config.ts | Retained |
| `pdfjs-dist` | `^4.10.38` | dependencies | src/components/pdf-viewer.tsx:82-85 dynamic import and worker URL | Retained |
| `react` | `19.2.4` | dependencies | JSX runtime, hooks and React server cache | Retained |
| `react-dom` | `19.2.4` | dependencies | src/components/assistant-chat.tsx:4; form hooks | Retained |
| `stripe` | `22.4.0` | dependencies | src/lib/stripe.ts; webhook and checkout integration | Retained |
| `@playwright/test` | `^1.62.1` | devDependencies | playwright.config.ts:1; e2e/navigation.spec.ts:1 | Retained |
| `@tailwindcss/postcss` | `^4` | devDependencies | postcss.config.mjs:3 | Retained |
| `@types/google.maps` | `^3.65.5` | devDependencies | src/components/job-map.ts:218-219,472 (ambient namespace; false positive) | Retained |
| `@types/node` | `^20` | devDependencies | Node APIs/globals in scripts, tests and server modules; automatic type discovery | Retained |
| `@types/react` | `^19` | devDependencies | JSX and React namespace types; automatic type discovery | Retained |
| `@types/react-dom` | `^19` | devDependencies | react-dom hook declarations; automatic type discovery | Retained |
| `eslint` | `^9` | devDependencies | package.json lint and eslint.config.mjs:1 | Retained |
| `eslint-config-next` | `16.4.6` | devDependencies | eslint.config.mjs:2-3 | Retained |
| `tailwindcss` | `^4` | devDependencies | src/app/globals.css:1; PostCSS pipeline | Retained |
| `typescript` | `^5` | devDependencies | tsconfig.json; next build and explicit tsc validation | Retained |

## Other scanner results

- `server-only`: 92 Knip unlisted-import occurrences. Next.js supplies special handling for this marker, and both production builds succeed. Retain all guards; this is not evidence of an unused package or a reason to weaken server/client isolation. Explicit dependency declaration can be reviewed separately if modules move outside Next.js.
- No confirmed runtime/dev dependency misclassification. Overrides for `postcss`, `sharp`, `zod`, and `undici` are retained; removing them requires a dependency/security review.
- `@react-pdf/renderer` generates PDFs; `pdfjs-dist` previews them. Their overlapping topic does not make them interchangeable.
- Anthropic and xAI coexist through distinct integration implementations. No consolidation or provider removal performed.

## Vulnerabilities, separately from dead code

`npm audit --json` reports **7 moderate package findings, 0 high, 0 critical** in the installed development toolchain: `minimatch`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`, `@typescript-eslint/type-utils`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, and `typescript-eslint`. These are seven affected dependency entries propagating one reported minimatch advisory, not seven independently established vulnerabilities. Advisory: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). No automatic fix/upgrade was run. Exposure and compatible remediation need their own review. An outdated-version survey was not performed; installed versions are not labeled obsolete solely because newer releases might exist.
