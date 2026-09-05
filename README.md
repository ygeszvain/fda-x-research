# FDA/X Research: Daily Diffusion Observatory

[Open the public dashboard](https://ygeszvain.github.io/fda-x-research/)

An independent dissertation dashboard of daily engagement and observable diffusion
across FDA, FDADrugs, FDAFood, FDADevices, FDATobacco, and FDARecalls on X.

## Views

- **Overview:** cumulative counters by account, matched day-to-day changes, new
  event discovery, accumulated diffusion, themes, and cohort observation counts.
- **Diffusion explorer:** every original post's API-verified parent tree, daily
  playback, expandable repost groups, and individual node metrics.
- **Post trajectories:** views, likes, reposts, replies, quotes, and bookmarks,
  plus a post-by-day net-change heatmap.
- **Data & methods:** returned versus attempted coverage and research definitions.

Accounts, themes, and Chicago dates can be filtered. Plots can be downloaded as
PNG; the selected canonical observations can be exported as CSV.

## Data and interpretation

`data/dashboard.json` is a curated export from the latest completed cumulative
lifecycle snapshot. One observation represents one root/event/mechanism/Chicago
day. Repeated retrievals do not count as newly discovered diffusion. Observations
are cumulative API counters; chart changes are calculated between the same
entities on adjacent days with returned, non-null values. Missing observations
are never zero-filled or forward-filled. Negative corrections are retained.

The graph includes explicit, API-verified parent edges only. Counter totals may
exceed event IDs recoverable through the API. Direct reposts, quote posts, and
reposts of quotes are separate mechanisms. Downstream nodes use stable anonymous
labels. Downstream text/handles, raw API payloads, local paths, credentials,
database dumps, and collection secrets are not exported. FDA originals retain
their public IDs and locally coded summaries.

The cohort preserves its baseline and admits new originals only for accounts
below two. Root tracking can pause after two consecutive zero-change daily
intervals, with mandatory day-30, day-60, and day-90 observations. Predictions must
use earlier-created roots for training and later-created roots for testing.
All snapshots of a root stay together; preprocessing is fitted on training only.

Themes reflect current coding applied to historical observations; the date
filter does not reconstruct the codebook as it existed on a past date. Daily
snapshots can receive corrections when collection or derived data is repaired.
The available timelines support descriptive analysis; short follow-up and small
samples limit causal and predictive conclusions.

## Publication

The site is served directly from the root of `main` on GitHub Pages. It needs
no server, API key, database connection, external font, or external chart CDN.
All data processing occurs locally; the browser reads the public JSON export.

After collection, local theme synthesis, and the final lifecycle materialization,
the existing FDA/X daily task runs `scheduler/publish_public_dashboard.sh` from
the private collection workspace. That script stages only `data/dashboard.json`
in this public checkout and skips a commit when the export is unchanged. A
publication failure is reported separately from a successful data collection.

For a manual export using the collector's Python environment:

```sh
python scripts/export_public_data.py --env-file /path/to/local-credentials.env
```

The exporter requires `psycopg` and `python-dotenv`, uses a read-only repeatable
read transaction, checks attempt coverage and unique daily grain, and selects an
explicit public field allowlist. Never commit the local credentials file.

## Local preview and dependencies

```sh
python -m http.server 8767
```

Open `http://localhost:8767`. To rebuild vendored assets, run `npm ci` then
`npm run vendor`. Apache ECharts and Lucide are pinned; their license files are
included beside the vendored assets. No build step is required for Pages.

This is an independent research project, not an official FDA or X publication.
