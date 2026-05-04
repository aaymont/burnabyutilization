# Annual Utilization Report Add-In

Static MyGeotab page add-in for generating an Annual Utilization Report and exporting to Excel (`.xlsx`).

## Tech Stack

- Plain HTML, CSS, and JavaScript (ES modules)
- No backend
- No database
- No server-side persistence

## File Structure

- `index.html` - UI layout
- `styles.css` - styling for add-in UI
- `app.js` - page controller, state, events, rendering
- `geotab-api.js` - MyGeotab API layer with mock-mode support
- `report-builder.js` - transforms raw data into report rows
- `excel-exporter.js` - SheetJS-based Excel export
- `group-mapper.js` - derives Area and Manager from Group hierarchy
- `manifest.json` - MyGeotab add-in manifest

## Hosted URL (Configure Before Deploy)

Use this placeholder and replace it with your actual GitHub Pages URL:

- `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/index.html`

`manifest.json` currently uses this placeholder in the `items[0].url` value.

## Report Columns

1. Asset
2. Vehicle Label
3. MMY Year
4. MMY Make
5. MMY Model
6. Area
7. Manager
8. Mileage (km)
9. Driving Duration

## Local Testing

Open `index.html` in a browser or host the directory with a static server.

### Quick static server (optional)

```bash
npx serve .
```

## GitHub Pages Deployment

1. Create a new GitHub repository.
2. Upload all project files to the repository (root or `docs` folder).
3. In GitHub, open **Settings > Pages**.
4. Enable Pages from:
   - `main` branch, `/ (root)` **or**
   - `main` branch, `/docs` (if you host files there).
5. Confirm the public URL is live, for example:
   - `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/index.html`
6. Update `manifest.json` if needed so `items[0].url` points to that exact public `index.html` URL.

## MyGeotab Add-In Setup

1. Host this project on GitHub Pages.
2. In MyGeotab, go to **Administration > System > Add-Ins**.
3. Add a new add-in and use the hosted `manifest.json` URL.
4. Save and open the add-in from the left navigation menu.

## Troubleshooting

- **Blank add-in page**
  - Open browser dev tools and check console errors.
  - Verify `manifest.json` URL and `items[0].url` are publicly reachable (no 404).
  - Confirm GitHub Pages published the latest commit.

- **API authentication/session issue**
  - Confirm you are opening from inside MyGeotab (not a plain browser tab) for live API mode.
  - If testing locally/outside MyGeotab, the app intentionally uses mock mode.
  - Re-login to MyGeotab if session has expired.

- **CORS or blocked script issue**
  - Confirm external script sources are allowed (SheetJS CDN).
  - If blocked by policy, self-host `xlsx.full.min.js` in your repo and reference it locally.
  - Verify HTTPS is used for all hosted assets.

- **Excel export blocked by browser**
  - Start export from a direct button click (already implemented).
  - Check popup/download blocking settings and allow downloads for your domain.
  - Retry in another browser if enterprise policies block file downloads.

- **No groups found**
  - Ensure the user has permission to view required groups.
  - Validate group hierarchy contains expected roots: `Vehicle Labels`, `MMY Year`, `MMY Make`, `MMY Model`, `Area`, `Manager`.
  - Review warnings section in the app for mapping diagnostics.

- **No odometer data found**
  - Some vehicles/devices do not provide odometer diagnostics.
  - The report falls back to trip distance when possible.
  - If both odometer and trip distance are unavailable, mileage is left blank with a warning.

## Test Checklist

- [ ] Add-in loads from MyGeotab menu as **Annual Utilization Report**
- [ ] Date validation blocks invalid ranges
- [ ] `Load Fleet Data` retrieves and previews rows
- [ ] Summary shows totals (vehicles, areas, mileage, duration, warnings)
- [ ] Warnings collapsible section is visible when warnings exist
- [ ] `Generate Excel Report` downloads an `.xlsx` file
- [ ] Workbook contains:
  - [ ] `All Vehicles` sheet
  - [ ] One sheet per discovered area
  - [ ] Optional `Warnings` sheet when warnings exist
- [ ] Sheet names are sanitized and unique
- [ ] Vehicles with no trips still appear
- [ ] Vehicles with missing groups still appear

## Known Limitations

- No backend persistence (all processing is client-side)
- Large fleets may take time to process
- Odometer availability depends on device/data quality
- Group mapping depends on the expected group hierarchy
