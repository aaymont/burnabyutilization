import { GroupMapper } from "./group-mapper.js";

const EXCEL_INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;
const UNASSIGNED_AREA_LABEL = "Unassigned Area";

function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toPeriodBounds(fromDate, toDate) {
  // Date-only input from the UI should include the full selected end day.
  // We convert to explicit local time boundaries to avoid accidental truncation.
  const start = isDateOnly(fromDate) ? parseDate(`${fromDate}T00:00:00.000`) : parseDate(fromDate);
  const end = isDateOnly(toDate) ? parseDate(`${toDate}T23:59:59.999`) : parseDate(toDate);
  return { start, end };
}

function getCollectionValue(collection, key) {
  if (!collection || !key) {
    return [];
  }
  if (collection instanceof Map) {
    return collection.get(key) || [];
  }
  if (typeof collection === "object") {
    return collection[key] || [];
  }
  return [];
}

function cleanSheetName(value) {
  return String(value || "")
    .replace(EXCEL_INVALID_SHEET_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeSheetName(name, existingNames = new Set()) {
  let base = cleanSheetName(name) || "Sheet";
  base = base.slice(0, 31);
  if (!existingNames.has(base)) {
    existingNames.add(base);
    return base;
  }

  let counter = 2;
  while (counter < 1000) {
    const suffix = ` (${counter})`;
    const stem = base.slice(0, Math.max(0, 31 - suffix.length));
    const candidate = `${stem}${suffix}`;
    if (!existingNames.has(candidate)) {
      existingNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }

  const fallback = `Sheet-${Date.now()}`.slice(0, 31);
  existingNames.add(fallback);
  return fallback;
}

export function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainderSeconds = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    remainderSeconds
  ).padStart(2, "0")}`;
}

export function calculateDrivingSeconds(trips = []) {
  return trips.reduce((total, trip) => {
    const explicit = Number(trip?.drivingSeconds);
    if (Number.isFinite(explicit) && explicit >= 0) {
      return total + explicit;
    }

    const start = parseDate(trip?.start);
    const end = parseDate(trip?.end);
    if (!start || !end) {
      return total;
    }
    return total + Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  }, 0);
}

function findClosestOdometerAtOrAfter(rows, targetDate) {
  let best = null;
  for (const row of rows) {
    const rowDate = parseDate(row?.dateTime);
    const value = Number(row?.value);
    if (!rowDate || !Number.isFinite(value) || rowDate < targetDate) {
      continue;
    }
    if (!best || rowDate < best.date) {
      best = { date: rowDate, value };
    }
  }
  return best;
}

function findClosestOdometerAtOrBefore(rows, targetDate) {
  let best = null;
  for (const row of rows) {
    const rowDate = parseDate(row?.dateTime);
    const value = Number(row?.value);
    if (!rowDate || !Number.isFinite(value) || rowDate > targetDate) {
      continue;
    }
    if (!best || rowDate > best.date) {
      best = { date: rowDate, value };
    }
  }
  return best;
}

export function calculateMileageKm(odometerRows = [], trips = [], options = {}) {
  const warnings = [];
  const { start: from, end: to } = toPeriodBounds(options.fromDate, options.toDate);

  if (from && to) {
    const startReading = findClosestOdometerAtOrAfter(odometerRows, from);
    const endReading = findClosestOdometerAtOrBefore(odometerRows, to);

    if (startReading && endReading) {
      const meters = endReading.value - startReading.value;
      if (Number.isFinite(meters) && meters >= 0) {
        return {
          mileageKm: Number((meters / 1000).toFixed(2)),
          source: "odometer",
          warnings
        };
      }
      warnings.push("Odometer readings are invalid for this reporting period.");
    } else {
      warnings.push("Odometer boundary readings not found. Falling back to trip distance.");
    }
  } else {
    warnings.push("Report date range is invalid. Falling back to trip distance.");
  }

  const tripMileageKm = trips.reduce((sum, trip) => {
    const km = Number(trip?.distanceKm);
    if (Number.isFinite(km)) {
      if (km < 0) {
        warnings.push("Trip distance contained a negative value and was ignored.");
        return sum;
      }
      return sum + km;
    }
    const meters = Number(trip?.distance ?? trip?.distanceRaw);
    if (Number.isFinite(meters) && meters >= 0) {
      return sum + meters / 1000;
    }
    return sum;
  }, 0);

  if (tripMileageKm > 0) {
    return {
      mileageKm: Number(tripMileageKm.toFixed(2)),
      source: "trip",
      warnings
    };
  }

  warnings.push("Mileage unavailable (no valid odometer delta and no trip distance).");
  return {
    mileageKm: "",
    source: "none",
    warnings
  };
}

function filterTripsInPeriod(trips = [], fromDate, toDate) {
  const { start: from, end: to } = toPeriodBounds(fromDate, toDate);
  if (!from || !to) {
    return [...trips];
  }

  return trips.filter((trip) => {
    const start = parseDate(trip?.start);
    if (!start) {
      return false;
    }
    return start >= from && start <= to;
  });
}

function sortRowsByAreaThenAsset(a, b) {
  const areaCompare = String(a.area || "").localeCompare(String(b.area || ""));
  if (areaCompare !== 0) {
    return areaCompare;
  }
  return String(a.asset || "").localeCompare(String(b.asset || ""));
}

export function buildUtilizationReport({
  devices = [],
  groups = [],
  tripsByDevice = {},
  odometerByDevice = {},
  fromDate,
  toDate
}) {
  const mapper = new GroupMapper(groups);
  const allRows = [];
  const warnings = [];

  for (const device of devices) {
    const trips = filterTripsInPeriod(getCollectionValue(tripsByDevice, device.id), fromDate, toDate);
    const odometerRows = getCollectionValue(odometerByDevice, device.id);
    const mapped = mapper.mapDeviceGroups(device);
    const mileage = calculateMileageKm(odometerRows, trips, { fromDate, toDate });
    const drivingSeconds = calculateDrivingSeconds(trips);
    const area = mapped.area || UNASSIGNED_AREA_LABEL;

    const rowWarnings = [...mapped.warnings, ...mileage.warnings];

    // Final guardrail: never emit negative mileage in report output.
    let safeMileageKm = mileage.mileageKm;
    if (Number.isFinite(Number(safeMileageKm)) && Number(safeMileageKm) < 0) {
      safeMileageKm = "";
      rowWarnings.push("Mileage calculated as negative and was blanked.");
    }

    for (const warning of rowWarnings) {
      warnings.push({
        asset: device?.asset || device?.name || device?.id || "Unknown Asset",
        deviceId: device?.id || "",
        warning
      });
    }

    allRows.push({
      asset: device?.asset || device?.name || "",
      vehicleLabel: mapped.vehicleLabel || device?.vehicleLabel || device?.name || "",
      mmyYear: mapped.mmyYear || device?.mmyYear || "",
      mmyMake: mapped.mmyMake || device?.mmyMake || "",
      mmyModel: mapped.mmyModel || device?.mmyModel || "",
      area,
      manager: mapped.manager || "",
      mileageKm: safeMileageKm,
      drivingDuration: formatDuration(drivingSeconds),
      drivingSecondsRaw: drivingSeconds,
      mileageSource: mileage.source,
      warnings: rowWarnings
    });
  }

  allRows.sort(sortRowsByAreaThenAsset);

  const discoveredAreas = [...new Set(allRows.map((row) => row.area || UNASSIGNED_AREA_LABEL))].sort((a, b) =>
    a.localeCompare(b)
  );

  const rowsByArea = {};
  const usedSheetNames = new Set();
  for (const area of discoveredAreas) {
    const sheetName = sanitizeSheetName(area || UNASSIGNED_AREA_LABEL, usedSheetNames);
    rowsByArea[sheetName] = allRows
      .filter((row) => (row.area || UNASSIGNED_AREA_LABEL) === (area || UNASSIGNED_AREA_LABEL))
      .sort(sortRowsByAreaThenAsset);
  }

  const totalDrivingSeconds = allRows.reduce((sum, row) => sum + (row.drivingSecondsRaw || 0), 0);
  const summary = {
    fromDate: fromDate || "",
    toDate: toDate || "",
    totalAssets: devices.length,
    totalRows: allRows.length,
    totalWarnings: warnings.length,
    areasDiscovered: discoveredAreas.length,
    unassignedAreaRows: allRows.filter((row) => row.area === UNASSIGNED_AREA_LABEL).length,
    totalMileageKm: Number(
      allRows
        .reduce((sum, row) => sum + (Number.isFinite(Number(row.mileageKm)) ? Number(row.mileageKm) : 0), 0)
        .toFixed(2)
    ),
    totalDrivingSeconds,
    totalDrivingDuration: formatDuration(totalDrivingSeconds)
  };

  return {
    allRows,
    rowsByArea,
    warnings,
    summary
  };
}

// Backward-compatible adapter for existing UI flow.
export function buildAnnualUtilizationRows({ devices = [], trips = [], groups = [] }) {
  const tripsByDevice = {};
  for (const trip of trips) {
    if (!trip?.deviceId) {
      continue;
    }
    if (!tripsByDevice[trip.deviceId]) {
      tripsByDevice[trip.deviceId] = [];
    }
    tripsByDevice[trip.deviceId].push(trip);
  }

  const report = buildUtilizationReport({
    devices,
    groups,
    tripsByDevice,
    odometerByDevice: {},
    fromDate: "",
    toDate: ""
  });

  return report.allRows;
}
