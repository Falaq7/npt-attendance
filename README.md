# NPT Attendance

Session dates, registration forms and first-name registration and attendance check-in.

## Hosting

- Website: https://falaq7.github.io/npt-attendance/ (GitHub Pages)
- API: https://npt-attendance-api.mahmoodfalaq.workers.dev
- Storage: private Cloudflare D1 database, bound as DB.

The repository contains application code only. Names, passwords, sign-in tokens and attendance records must never be committed. The register API requires a valid manager sign-in token. All authenticated managers see the same anatomy register. The shared password is stored in the Cloudflare MANAGER_PASSWORD secret, never in this repository. Public session endpoints return session details, not participant lists. Students use per-session registration and check-in links.

## Features

Named dates, session filters, separate registers, registration and classroom QR codes, first-name check-in, preserved first check-in timestamps, CSV import/export, dark/light themes and a bone icon.

## Development

Requires Node.js 24 or later. Build with npm run build. Run npm test and node scripts/test-d1.mjs. The latter tests the database adapter against SQLite. npm run build:pages creates the static website in public; set NPT_API_BASE to the API origin when building for GitHub Pages.

Edit src/app.js and src/page.html for the frontend, src/theme.css for the design reference, and src/server.js for the API. The compiled Worker is worker/index.js. The source HTML includes the current CSS, so update its style block when changing theme.css.

## Deployment

Website changes deploy through the Publish website workflow on main. Backend changes require a signed-in Cloudflare deployment: npm run build, then npx wrangler deploy. wrangler.jsonc binds the existing D1 database. migrations/0001_records.sql defines the records table. Apply new schema migrations before deploying code that depends on them.

GitHub Pages allows public access to the frontend; it contains no attendance data. Backend responses are not cached. CORS is limited to the GitHub Pages origin and the API's own origin.

## Manager access

Sign in on the website using the shared manager password. Sessions expire after 12 hours and are invalidated on sign-out. Failed sign-in attempts are limited. Registration and check-in QR links remain public and ask only for first name. First login imports any previous register owned by that browser using its existing legacy access proof, then removes the old key from the browser.

Managers can edit first names, correct attendance, delete or restore entries, and delete or restore sessions. Deleted sessions close both registration and check-in. Restored sessions stay closed until reopened.

## Limitations

Microsoft Forms and live Excel workbook sync are not connected. CSV exports can be opened in Excel. Records on the original chatgpt.site deployment remain separate and are not automatically copied to this database. Student check-in uses first names only, as requested.
