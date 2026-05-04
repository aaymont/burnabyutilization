# Idling & driving from the MyGeotab API (no Data Connector, no exceptions)

This app can compute **driving** and **idling** time using **only** the MyGeotab API when you do **not** use the OData Data Connector and when **ExceptionEvent** data is missing, empty, or not used for idling rules.

## Primary source: `Trip`

Use **`Get` with `typeName: "Trip"`** and a **`search`** with `fromDate` / `toDate` (always bound the window).

Durations often arrive as **TimeSpan strings** (e.g. `0.01:23:45`) or objects with `totalSeconds` / .NET `ticks` — the app’s `parseDuration` in `tripsPipeline.ts` normalizes these.

Per trip, Geotab exposes (among others):

| Field | Role |
|--------|------|
| `drivingDuration` | Driving time (semantics vary by source; may overlap wall-clock). |
| `idlingDuration` | Idle time while the trip is active — **often `0` or missing** when populated from raw Trip API. |
| `stopDuration` | Stopped time within the trip. |
| `engineHours` | Cumulative engine hours (often used to split **engine-on** time into drive vs idle). |
| `start` / `stop` | Trip boundaries for wall-clock duration and fallbacks. |
| `distance`, `averageSpeed` | Used for **distance-based idle estimates** when idle/engine signals are weak. |

**OData (Data Connector)** daily rows use separate KPI fields (`DriveDuration_Seconds`, `IdleDuration_Seconds`) that align cleanly with “drive” vs “idle”. The **Trip API** is less uniform: `drivingDuration` may behave like wall time from start to stop, and `idlingDuration` may be zero even when the vehicle idled.

## How this codebase derives idle without exceptions

1. **Parse** `drivingDuration` and `idlingDuration` from each `Trip` (numbers, objects with `totalSeconds`, or TimeSpan strings).

2. **Engine-hours split** (when `engineHours` advances between consecutive trips for the same device): treat **engine-on time** as driving + idle; if `idlingDuration` is missing/zero, set idle ≈ `engineDelta - driving` (capped), then reconcile driving so it fits the engine window. See `aggregateTrips` in `src/features/utilization/tripsPipeline.ts`.

3. **Optional StatusData fallback**: when many trips lack usable `engineHours`, the loader may call **`fetchEngineHoursByTrip`** (`statusDataPipeline.ts`) to fill per-trip engine deltas, then pass them into `aggregateTrips`.

4. **Heuristic**: if there is still no idle but there is distance and start/stop, estimate idle from **wall-clock minus distance-implied driving** (bounded). Same file.

5. **ExceptionEvent idling is optional**: `mergeIdlingFromExceptions` **only adds** idle seconds from rules classified as idling (e.g. `RuleIdlingId` or rules whose names contain `"idle"`). If there are **no** such events, totals stay **purely trip-derived** — no requirement for exceptions.

So: **API-only + no idling exceptions** is a supported path; quality depends on whether `Trip` carries non-zero `idlingDuration` / usable `engineHours` for that database.

## Comparing databases (`GEOTAB_ALT_DATABASE`)

Use **`GEOTAB_ALT_DATABASE`** in `.env.local` (same username/password as `GEOTAB_DATABASE`) to point at a second database for comparison. Run:

```bash
npm run test:geotab:idle
```

The probe authenticates once, then samples **Trip** in a short window for **primary** and **alt** databases and prints how often `idlingDuration` / `drivingDuration` parse to a positive value and whether `engineHours` is present. Raw Trip durations can be sparse or small while **`aggregateTrips` still builds meaningful idle/drive totals** using engine deltas and heuristics — so treat the probe as a **field-population comparison** between databases, not as the app’s final KPI totals.

## If Trip idle is always zero

Escalation options (heavier API / not all implemented in this app):

- **`StatusData`** with speed / ignition-related diagnostics — infer idle as engine on at low speed for sustained intervals.
- **`LogRecord`** — derive speed-over-time; idle ≈ speed below threshold with ignition on (high volume, not fleet-wide naive fetch).

For large fleets, **Data Connector** daily KPIs remain the scalable option for drive/idle splits when Basic Auth is available server-side.

## Related code

- `src/features/utilization/tripsPipeline.ts` — `aggregateTrips`, `fetchTrips`
- `src/features/utilization/statusDataPipeline.ts` — engine hours by trip
- `src/features/utilization/idleFromExceptions.ts` — optional merge from idling rules
- `src/features/dataService.ts` — wires Trip → optional exception merge
