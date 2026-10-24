# Startup Arena: Jaipur and Noida

Open roles at companies in Jaipur and Noida, pinned on a map. Each role links to the company's own job board.

Screens: Find jobs (search, filters, job cards), Companies, Map, Saved and About. `index.html` + `jobs.js` run the first, second, fourth and fifth; `map.html` + `app.js` run the map. Shared logic is in `filter.js`, shared styles in `style.css`.

No dependencies and no build step. The site is plain HTML, CSS and JavaScript. The map library (Leaflet) loads from a CDN in the browser.

## How the roles stay live

`scripts/fetch-jobs.mjs` calls the public job-board API of each company in `data/boards.json` (Lever, Greenhouse, Ashby, Workable, SmartRecruiters). It keeps only roles whose location mentions Jaipur or Noida and writes `data/jobs.json`. A role that a company closes disappears from its API, so it disappears from the map the next day. Nothing is typed in by hand.

The GitHub Action in `.github/workflows/refresh.yml` runs this every 5 hours (00:00, 05:00, 10:00, 15:00 and 20:00 UTC), commits the new data, and GitHub Pages republishes the site.

**7-day rule.** Only roles posted in the last 7 days are kept. A role's age counts from the posted date, or from the day it was first seen when the company publishes no date. Older roles are removed from `data/jobs.json` on the next refresh, and the pages hide them as well in case the data file is stale. If a company's job board has a temporary error, its last known roles are kept until they reach 7 days. `MAX_AGE_DAYS` is set in `scripts/lib.mjs` and `filter.js`.

## Hosting

The site is served by GitHub Pages from the `main` branch, root folder (Settings, Pages). Any static host works too, because there is no build step. Map tiles come from OpenStreetMap, which asks for light use only; for heavy traffic switch to a tile provider with a key.

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
