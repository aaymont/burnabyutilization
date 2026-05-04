import { GeotabApi } from "./geotab-api.js?v=1.0.3";
import { buildUtilizationReport } from "./report-builder.js?v=1.0.3";
import { exportAnnualUtilizationWorkbook } from "./excel-exporter.js?v=1.0.3";

const APP_VERSION = "1.0.3";

// Tuning knobs for large fleets (500-5000 vehicles):
// - Increase concurrency for faster loads, decrease if rate-limited.
// - Increase inter-request delay to be friendlier to API limits.
// - Increase batch size to reduce UI update overhead.
const DEVICE_BATCH_SIZE = 50;
const DEVICE_CONCURRENCY = 6;
const DEVICE_INTER_REQUEST_DELAY_MS = 60;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

const state = {
  isLoading: false,
  rows: [],
  report: null,
  dataSnapshot: null,
  loadController: null
};

const geotabApi = new GeotabApi();

const els = {
  container: document.querySelector(".container"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  loadFleetBtn: document.getElementById("loadFleetBtn"),
  cancelLoadBtn: document.getElementById("cancelLoadBtn"),
  generateReportBtn: document.getElementById("generateReportBtn"),
  loadingState: document.getElementById("loadingState"),
  loadingMessage: document.getElementById("loadingMessage"),
  progressState: document.getElementById("progressState"),
  progressBarWrap: document.getElementById("progressBarWrap"),
  progressFill: document.getElementById("progressFill"),
  progressPercent: document.getElementById("progressPercent"),
  errorState: document.getElementById("errorState"),
  warningState: document.getElementById("warningState"),
  successState: document.getElementById("successState"),
  previewTableBody: document.getElementById("previewTableBody"),
  rowCount: document.getElementById("rowCount"),
  summaryPanel: document.getElementById("summaryPanel"),
  summaryTotalVehicles: document.getElementById("summaryTotalVehicles"),
  summaryAreas: document.getElementById("summaryAreas"),
  summaryMileage: document.getElementById("summaryMileage"),
  summaryDriving: document.getElementById("summaryDriving"),
  summaryWarnings: document.getElementById("summaryWarnings"),
  warningsPanel: document.getElementById("warningsPanel"),
  warningsCount: document.getElementById("warningsCount"),
  warningsList: document.getElementById("warningsList"),
  appVersionBadge: document.getElementById("appVersionBadge")
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldToUi() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setDefaultDateRange() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  els.startDate.value = start.toISOString().slice(0, 10);
  els.endDate.value = end.toISOString().slice(0, 10);
}

function clearMessages() {
  for (const key of ["errorState", "warningState", "successState", "progressState"]) {
    els[key].textContent = "";
    els[key].classList.add("hidden");
  }
}

function setMockBanner(visible) {
  const existing = document.getElementById("mockModeBanner");
  if (!visible) {
    existing?.remove();
    return;
  }

  if (existing) {
    return;
  }

  const banner = document.createElement("div");
  banner.id = "mockModeBanner";
  banner.className = "state state-warning";
  banner.textContent = "Mock Mode: Not connected to MyGeotab";
  banner.style.marginBottom = "8px";
  els.container?.prepend(banner);
}

function showMessage(type, message) {
  const target = els[`${type}State`];
  if (!target) {
    return;
  }
  target.textContent = message;
  target.classList.remove("hidden");
}

function setProgress(percent, message = "") {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  els.progressFill.style.width = `${safePercent}%`;
  els.progressPercent.textContent = `${safePercent}%`;
  els.progressBarWrap.classList.remove("hidden");
  if (message) {
    showMessage("progress", message);
  }
}

function resetProgress() {
  els.progressFill.style.width = "0%";
  els.progressPercent.textContent = "0%";
  els.progressBarWrap.classList.add("hidden");
}

function setLoading(isLoading, message = "Loading...") {
  state.isLoading = isLoading;
  els.loadFleetBtn.disabled = isLoading;
  els.cancelLoadBtn.disabled = !isLoading;
  els.generateReportBtn.disabled = isLoading || !state.report || state.rows.length === 0;
  els.startDate.disabled = isLoading;
  els.endDate.disabled = isLoading;
  els.loadingMessage.textContent = message;
  els.loadingState.classList.toggle("hidden", !isLoading);
  if (!isLoading) {
    resetProgress();
  }
}

function updatePreview(rows) {
  els.previewTableBody.innerHTML = "";
  els.rowCount.textContent = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "empty-row";
    td.textContent = "No report rows to preview.";
    tr.appendChild(td);
    els.previewTableBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    const values = [
      row.asset,
      row.vehicleLabel,
      row.mmyYear,
      row.mmyMake,
      row.mmyModel,
      row.area,
      row.manager,
      row.mileageKm,
      row.drivingDuration
    ];

    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = String(value ?? "");
      tr.appendChild(td);
    }
    els.previewTableBody.appendChild(tr);
  }
}

function updateSummary(summary) {
  if (!summary) {
    els.summaryPanel.classList.add("hidden");
    return;
  }

  els.summaryPanel.classList.remove("hidden");
  els.summaryTotalVehicles.textContent = String(summary.totalVehicles || summary.totalAssets || 0);
  els.summaryAreas.textContent = String(summary.areasDiscovered || 0);
  els.summaryMileage.textContent = `${Number(summary.totalMileageKm || 0).toFixed(2)} km`;
  els.summaryDriving.textContent = summary.totalDrivingDuration || "00:00:00";
  els.summaryWarnings.textContent = String(summary.totalWarnings || 0);
}

function updateWarnings(warnings) {
  const safeWarnings = Array.isArray(warnings) ? warnings : [];
  els.warningsCount.textContent = String(safeWarnings.length);
  els.warningsList.innerHTML = "";

  if (safeWarnings.length === 0) {
    els.warningsPanel.classList.add("hidden");
    return;
  }

  els.warningsPanel.classList.remove("hidden");
  for (const warning of safeWarnings) {
    const li = document.createElement("li");
    const asset = warning?.asset ? `${warning.asset}: ` : "";
    li.textContent = `${asset}${warning?.warning || String(warning)}`;
    els.warningsList.appendChild(li);
  }
}

function validateDateRange() {
  const fromDate = els.startDate.value;
  const toDate = els.endDate.value;

  if (!fromDate || !toDate) {
    throw new Error("Please select both report start and report end dates.");
  }
  if (new Date(fromDate) > new Date(toDate)) {
    throw new Error("Report start date must be on or before report end date.");
  }
  return { fromDate, toDate };
}

function toInclusiveDateRangeIso(fromDate, toDate) {
  // UI uses date-only inputs; convert to an explicit local-time day window
  // so the selected end date includes the full day.
  const fromIso = `${fromDate}T00:00:00.000`;
  const toIso = `${toDate}T23:59:59.999`;
  return { fromIso, toIso };
}

function sanitizeErrorMessage(error) {
  const raw = String(error?.message || error || "");
  return raw
    .replace(/(password|sessionid|sessiontoken|token)\s*[:=]\s*[^,\s]+/gi, "$1=[redacted]")
    .replace(/"password"\s*:\s*"[^"]*"/gi, "\"password\":\"[redacted]\"");
}

function isTransientError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("rate limit")
  );
}

async function withRetry(taskFn, description) {
  const controller = state.loadController;
  let attempt = 0;
  let lastError = null;

  while (attempt < RETRY_MAX_ATTEMPTS) {
    if (controller?.cancelled) {
      throw new Error("Load cancelled.");
    }

    attempt += 1;
    try {
      return await taskFn();
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < RETRY_MAX_ATTEMPTS && isTransientError(error);
      if (!shouldRetry) {
        break;
      }
      showMessage("progress", `${description} failed (attempt ${attempt}). Retrying...`);
      await delay(RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)));
    }
  }

  throw lastError || new Error(`${description} failed.`);
}

function chunkDevices(devices, chunkSize = DEVICE_BATCH_SIZE) {
  const chunks = [];
  for (let i = 0; i < devices.length; i += chunkSize) {
    chunks.push(devices.slice(i, i + chunkSize));
  }
  return chunks;
}

async function loadPerDeviceData(devices, fromDate, toDate) {
  const tripsByDevice = {};
  const odometerByDevice = {};
  const chunks = chunkDevices(devices, DEVICE_BATCH_SIZE);
  let processed = 0;
  const controller = state.loadController;

  const processWithConcurrency = async (items, worker, concurrency) => {
    const queue = [...items];
    const runnerCount = Math.max(1, Math.min(concurrency, queue.length));
    await Promise.all(
      Array.from({ length: runnerCount }).map(async () => {
        while (queue.length > 0) {
          if (controller?.cancelled) {
            return;
          }
          const next = queue.shift();
          if (!next) {
            return;
          }
          await worker(next);
        }
      })
    );
  };

  for (const batch of chunks) {
    if (controller?.cancelled) {
      throw new Error("Load cancelled.");
    }

    await processWithConcurrency(
      batch,
      async (device) => {
        const deviceId = device.id;
        const [trips, odometerRows] = await Promise.all([
          withRetry(
            () => geotabApi.getTripsForDevice(deviceId, fromDate, toDate),
            `Trip load for ${deviceId}`
          ),
          withRetry(
            () => geotabApi.getOdometerStatusData(deviceId, fromDate, toDate),
            `Odometer load for ${deviceId}`
          )
        ]);

        // Trim heavy raw payloads to reduce memory pressure.
        tripsByDevice[deviceId] = (Array.isArray(trips) ? trips : []).map((t) => ({
          id: t.id,
          deviceId: t.deviceId,
          start: t.start,
          end: t.end,
          distanceKm: t.distanceKm,
          drivingSeconds: t.drivingSeconds
        }));
        odometerByDevice[deviceId] = (Array.isArray(odometerRows) ? odometerRows : []).map((o) => ({
          id: o.id,
          dateTime: o.dateTime,
          deviceId: o.deviceId,
          value: o.value
        }));
        processed += 1;
        const percent = 35 + (processed / devices.length) * 55;
        setProgress(percent, `Processing ${processed} of ${devices.length} vehicles...`);
        if (DEVICE_INTER_REQUEST_DELAY_MS > 0) {
          await delay(DEVICE_INTER_REQUEST_DELAY_MS);
        }
      },
      DEVICE_CONCURRENCY
    );

    await yieldToUi();
  }

  return { tripsByDevice, odometerByDevice };
}

function cancelCurrentLoad(reason = "Load cancelled.") {
  if (!state.loadController || state.loadController.cancelled) {
    return;
  }
  state.loadController.cancelled = true;
  setProgress(0);
  showMessage("warning", reason);
}

async function loadFleetData() {
  cancelCurrentLoad("Previous load cancelled.");
  state.loadController = { cancelled: false };

  clearMessages();
  state.report = null;
  state.rows = [];
  state.dataSnapshot = null;
  updatePreview([]);
  updateSummary(null);
  updateWarnings([]);

  let dates;
  try {
    dates = validateDateRange();
  } catch (error) {
    showMessage("error", error.message);
    return;
  }

  try {
    setLoading(true, "Loading fleet data...");
    setProgress(5, "Initializing API...");
    await withRetry(() => geotabApi.initialize(window.geotabApi || null), "API initialization");
    setMockBanner(geotabApi.getModeInfo().isMockMode);

    setProgress(12, "Loading groups...");
    const groups = await withRetry(() => geotabApi.getGroups(), "Group load");

    setProgress(22, "Loading devices...");
    const devices = await withRetry(() => geotabApi.getDevices(), "Device load");

    if (!devices.length) {
      showMessage("warning", "No vehicles were found for this account.");
      return;
    }

    const { fromIso, toIso } = toInclusiveDateRangeIso(dates.fromDate, dates.toDate);
    setProgress(35, `Loading trip and odometer data for ${devices.length} vehicles...`);
    const { tripsByDevice, odometerByDevice } = await loadPerDeviceData(
      devices,
      fromIso,
      toIso
    );

    setProgress(93, "Building utilization report...");
    const report = buildUtilizationReport({
      devices,
      groups,
      tripsByDevice,
      odometerByDevice,
      fromDate: fromIso,
      toDate: toIso
    });

    state.report = report;
    state.rows = report.allRows || [];
    state.dataSnapshot = {
      dates,
      devices,
      groups,
      tripsByDevice,
      odometerByDevice
    };

    updatePreview(state.rows);
    updateSummary({
      ...report.summary,
      totalVehicles: devices.length
    });
    updateWarnings(report.warnings);
    setProgress(100, "Load complete.");

    if (state.rows.length === 0) {
      showMessage("warning", "No data found for the selected date range.");
    } else {
      showMessage("success", `Fleet data loaded. ${state.rows.length} rows are ready for export.`);
    }
  } catch (error) {
    state.report = null;
    state.rows = [];
    state.dataSnapshot = null;
    updatePreview([]);
    updateSummary(null);
    updateWarnings([]);
    const safeMessage = sanitizeErrorMessage(error);
    if (safeMessage === "Load cancelled.") {
      showMessage("warning", "Load cancelled.");
    } else {
      console.error("[AnnualUtilization] Load failed:", safeMessage);
      showMessage("error", safeMessage || "Unable to load fleet data.");
    }
  } finally {
    setLoading(false);
    state.loadController = null;
  }
}

function generateReport() {
  clearMessages();
  if (!state.report || !state.rows.length || !state.dataSnapshot?.dates) {
    showMessage("warning", "No report data available. Load fleet data first.");
    return;
  }

  try {
    const { fromDate, toDate } = state.dataSnapshot.dates;
    exportAnnualUtilizationWorkbook(state.report, fromDate, toDate);
    showMessage("success", "Excel report generated successfully.");
  } catch (error) {
    showMessage("error", error?.message || "Unable to generate Excel report.");
  }
}

function wireEvents() {
  els.loadFleetBtn.addEventListener("click", loadFleetData);
  els.generateReportBtn.addEventListener("click", generateReport);
  els.startDate.addEventListener("change", () => cancelCurrentLoad("Load cancelled due to date change."));
  els.endDate.addEventListener("change", () => cancelCurrentLoad("Load cancelled due to date change."));
  const cancelBtn = document.getElementById("cancelLoadBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => cancelCurrentLoad("Load cancelled by user."));
  }
}

function initializeApp() {
  setDefaultDateRange();
  wireEvents();
  els.appVersionBadge.textContent = `v${APP_VERSION}`;
  updatePreview([]);
  updateSummary(null);
  updateWarnings([]);
  // Show banner only when mock mode is actually active, not just when disconnected.
  setMockBanner(false);
}

initializeApp();
