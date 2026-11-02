# NPT Attendance

Session manager, registration forms and first-name attendance check-in.

## Status

Source prepared for a new GitHub repository. Repository creation and hosting migration are not complete. Microsoft Forms / live Excel integration is not implemented.

## Checks

Requires Node.js 22 or later. Run npm run build, npm test, and npm run validate. No dependency installation is needed for checks.

## Hosting

This app uses a server-side Cloudflare Worker and an R2 bucket. GitHub Pages alone cannot run the shared register backend. Publishing the current HTML to Pages without an API service would break registration and check-in. Do not store attendee records or access keys in GitHub.

A standalone Cloudflare configuration is included to remove the dependency on chatgpt.site while keeping source on GitHub. This requires a Cloudflare account with R2 enabled. Deploying it provisions a separate database bucket; existing hosted records are not automatically migrated.

After account setup: install development dependencies, sign into Wrangler, create the npt-attendance R2 bucket, and run npm run deploy. Configure manager access and migrate any existing records before directing students to the new URL. The existing Site access gate is not part of a standalone deployment.

To use GitHub Pages for the frontend specifically, the frontend API base URL, cross-origin permissions and backend hosting must be configured before enabling Pages. This repository intentionally does not publish a nonfunctional static copy.

## Editing

Edit src/app.js, src/page.html and src/server.js. npm run build generates worker/index.js and dist. Each session date has a separate register. CSV exports open in Excel; they are not live workbook connections.
