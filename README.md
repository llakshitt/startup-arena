# Startup Arena: Jaipur and Noida

Open roles at companies in Jaipur and Noida, pinned on a map. Each role links to the company's own job board.

No dependencies and no build step. The site is plain HTML, CSS and JavaScript. The map library (Leaflet) loads from a CDN in the browser.

## How the roles stay live

`scripts/fetch-jobs.mjs` calls the public job-board API of each company in `data/boards.json` (Lever, Greenhouse, Ashby, Workable, SmartRecruiters). It keeps only roles whose location mentions Jaipur or Noida and writes `data/jobs.json`. A role that a company closes disappears from its API, so it disappears from the map the next day. Nothing is typed in by hand.

The GitHub Action in `.github/workflows/refresh.yml` runs this every day at 07:00 IST, commits the new data, and Vercel redeploys.

## Set up

1. Push this folder to a new GitHub repo.
2. Import the repo in Vercel. Framework preset: Other. No build command, no output directory.
3. In GitHub, open Actions, pick "Refresh jobs" and click Run workflow once. The map fills with live roles.

To run it on your own machine: `node scripts/fetch-jobs.mjs`, then serve the folder (for example `npx serve .`).

## Adding companies

Edit `data/boards.json`. Each entry is `{ "name", "ats", "slug" }`, where the slug is the part of the company's careers URL after the provider's domain:

- `jobs.lever.co/<slug>`
- `boards.greenhouse.io/<slug>`
- `jobs.ashbyhq.com/<slug>`
- `apply.workable.com/<slug>`
- `jobs.smartrecruiters.com/<slug>`

After a run, open `data/report.json`. It lists every board as ok, notfound (wrong slug or the company uses another system) or error. Fix or remove the notfound ones.

To pin a company at its exact office, add it under `offices` in `data/places.json`:

    "offices": { "paytm": { "noida": { "lat": 28.6, "lng": 77.3, "area": "Sector 62" } } }

Without that, the pin is placed in the area named in the job location, or near the city centre, and the page says the location is approximate.

## Known limits

- The slugs in `data/boards.json` are a starting list and have not been checked against live APIs. Use `data/report.json` after the first run.
- Many Jaipur companies hire only through LinkedIn, Naukri or their own careers page. These have no public job-board API, so they appear as hollow "no live job feed" pins. To cover them you would need another source, such as a company-specific scraper.
- Roles that do not state a city (for example "Remote, India") are not shown.

## Tests

    node scripts/test.mjs
    node scripts/test-ui.mjs
