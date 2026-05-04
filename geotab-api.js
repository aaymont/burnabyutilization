import { MOCK_DEVICES, MOCK_GROUPS, MOCK_ODOMETER_BY_DEVICE, MOCK_TRIPS_BY_DEVICE } from "./mock-data.js";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_BATCH_DELAY_MS = 100;
const KNOWN_ODOMETER_DIAGNOSTIC_ID = "DiagnosticOdometerId";
const ENTITY_PAGE_SIZE = 500;
const FEED_MAX_PAGES = 500;
const GET_FEED_METHOD = "GetFeed";

function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoString(value) {
  return parseDate(value).toISOString();
}

function normalizeTripDistanceKm(trip) {
  // Normalize mixed payloads from different API wrappers:
  // - distanceKm is already kilometers
  // - distanceMeters or distance are meters in native Trip entities
  // - fallback heuristic for unexpected shapes keeps output non-negative
  const directKm = Number(trip?.distanceKm);
  if (Number.isFinite(directKm) && directKm >= 0) {
    return directKm;
  }

  const meters = Number(trip?.distanceMeters);
  if (Number.isFinite(meters) && meters >= 0) {
    return meters / 1000;
  }

  const distanceRaw = Number(trip?.distance);
  if (!Number.isFinite(distanceRaw) || distanceRaw < 0) {
    return 0;
  }

  // MyGeotab Trip.distance is typically meters, but some wrappers may pre-convert.
  // If value is very small, treat as km; otherwise treat as meters.
  if (distanceRaw > 0 && distanceRaw < 2000) {
    return distanceRaw;
  }
  return distanceRaw / 1000;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getGlobalObject() {
  if (typeof window !== "undefined") {
    return window;
  }
  return globalThis;
}

function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export class GeotabApi {
  constructor() {
    this.api = null;
    this.isReady = false;
    this.odometerDiagnosticId = null;
    this.isDevelopment = this.#detectDevelopmentMode();
    this.isMockMode = false;
    this.runtimeInfo = this.#detectRuntimeInfo();
  }

  #detectDevelopmentMode() {
    const root = getGlobalObject();
    const host = root?.location?.hostname || "";
    const query = root?.location?.search || "";
    const hasDebugQuery = /(?:\?|&)debug=(1|true)(?:&|$)/i.test(query);
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    return Boolean(root?.__GEOTAB_DEV__ || hasDebugQuery || isLocalHost);
  }

  #log(...args) {
    if (this.isDevelopment) {
      console.log("[GeotabApi]", ...args);
    }
  }

  #warn(...args) {
    if (this.isDevelopment) {
      console.warn("[GeotabApi]", ...args);
    }
  }

  #extractApiCandidate(candidate) {
    if (!candidate) {
      return null;
    }

    if (typeof candidate.call === "function") {
      return candidate;
    }

    if (candidate.api && typeof candidate.api.call === "function") {
      return candidate.api;
    }

    return null;
  }

  #resolveApiFromEnvironment() {
    const root = getGlobalObject();
    const candidates = [
      root?.__MYGEOTAB_API__,
      root?.geotabApi,
      root?.api,
      root?.geotab?.api,
      root?.parent?.geotab?.api,
      root?.mgApi,
      root?.mg?.api,
      root?.MyGeotabApi,
      root?.GeotabApi
    ];

    for (const candidate of candidates) {
      const resolved = this.#extractApiCandidate(candidate);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  /** Wait for initialize(api) from geotab.addin bridge (hosted page add-ins). */
  async #waitForHostApi(timeoutMs = 25000) {
    const root = getGlobalObject();
    const tryResolve = () => this.#extractApiCandidate(root?.__MYGEOTAB_API__) || this.#resolveApiFromEnvironment();

    const immediate = tryResolve();
    if (immediate) {
      return immediate;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (api, err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(pollId);
        if (typeof root.addEventListener === "function" && typeof root.removeEventListener === "function") {
          root.removeEventListener("mygeotab:api-ready", onReady);
        }
        clearTimeout(timer);
        if (err) {
          reject(err);
          return;
        }
        const resolved = this.#extractApiCandidate(api) || tryResolve();
        if (resolved) {
          resolve(resolved);
          return;
        }
        reject(new Error("MyGeotab API reference was not usable after host handshake."));
      };

      const onReady = (event) => {
        const api = event?.detail?.api;
        if (api && typeof api.call === "function") {
          finish(api);
        }
      };

      if (typeof root?.addEventListener === "function") {
        root.addEventListener("mygeotab:api-ready", onReady);
      }

      const pollId = setInterval(() => {
        const candidate = tryResolve();
        if (candidate) {
          finish(candidate);
        }
      }, 120);

      const timer = setTimeout(() => {
        finish(null, new Error(`Timed out after ${timeoutMs / 1000}s waiting for MyGeotab session API.`));
      }, timeoutMs);
    });
  }

  #detectRuntimeInfo() {
    const root = getGlobalObject();
    const query = root?.location?.search || "";
    const mockRequestedByQuery = /(?:\?|&)mock=(1|true)(?:&|$)/i.test(query);
    const mockRequestedByGlobal = Boolean(root?.__GEOTAB_MOCK__ || root?.__GEOTAB_DEV_MOCK__);
    const mockRequested = mockRequestedByQuery || mockRequestedByGlobal;
    const apiCandidate = this.#resolveApiFromEnvironment();
    const hasApiCandidate = Boolean(apiCandidate);
    return {
      hasApiCandidate,
      mockRequested,
      canEnableMockInConnectedMode: this.isDevelopment,
      canEnableMockWhenDisconnected: this.isDevelopment
    };
  }

  getModeInfo() {
    return {
      isReady: this.isReady,
      isMockMode: this.isMockMode,
      hasApiCandidate: this.runtimeInfo.hasApiCandidate
    };
  }

  async initialize(geotabApiRef = null) {
    const explicitApi = this.#extractApiCandidate(geotabApiRef);
    let resolvedApi = explicitApi || this.#resolveApiFromEnvironment();

    /* Hosted ActivityLink pages receive api only via geotab.addin.initialize — wait if not yet bound. */
    if (!resolvedApi || typeof resolvedApi.call !== "function") {
      try {
        resolvedApi = await this.#waitForHostApi();
      } catch (_waitError) {
        resolvedApi = explicitApi || this.#resolveApiFromEnvironment();
      }
    }

    this.api = resolvedApi;
    this.runtimeInfo = this.#detectRuntimeInfo();

    const hasApi = Boolean(this.api && typeof this.api.call === "function");
    const allowForcedMock = this.runtimeInfo.mockRequested && this.runtimeInfo.canEnableMockInConnectedMode;
    const allowDisconnectedMock =
      !hasApi && this.runtimeInfo.mockRequested && this.runtimeInfo.canEnableMockWhenDisconnected;

    if (hasApi && !allowForcedMock) {
      this.isMockMode = false;
      this.isReady = true;
      this.#log("Initialized Geotab API client in connected mode.");
      return;
    }

    if (hasApi && this.runtimeInfo.mockRequested && !this.runtimeInfo.canEnableMockInConnectedMode) {
      this.isMockMode = false;
      this.isReady = true;
      this.#warn("Mock mode request ignored in connected production context.");
      return;
    }

    if (allowForcedMock || allowDisconnectedMock) {
      this.isMockMode = true;
      this.isReady = true;
      this.#log("Initialized Geotab API client in mock mode.");
      return;
    }

    throw new Error(
      'Geotab API is unavailable. Ensure geotab-addin-bridge.js loads before the app and reopen the add-in from MyGeotab. For local-only mock data use ?mock=1 with ?debug=true.'
    );
  }

  async apiCall(method, params = {}) {
    if (this.isMockMode) {
      throw new Error(`apiCall is unavailable in mock mode (${method}).`);
    }

    if (!this.isReady || !this.api) {
      throw new Error("Geotab API not initialized.");
    }

    this.#log("apiCall", method, params);
    try {
      const response = await new Promise((resolve, reject) => {
        this.api.call(method, params, resolve, reject);
      });
      return response;
    } catch (error) {
      const details = error?.message || error?.name || String(error);
      this.#warn(`apiCall failed for method '${method}': ${details}`);
      throw new Error(`Geotab API call failed (${method}): ${details}`);
    }
  }

  #sanitizeError(error) {
    const raw = String(error?.message || error || "");
    return raw
      .replace(/(password|sessionid|sessiontoken|token)\s*[:=]\s*[^,\s]+/gi, "$1=[redacted]")
      .replace(/"password"\s*:\s*"[^"]*"/gi, "\"password\":\"[redacted]\"");
  }

  async runInBatches(items, worker, options = {}) {
    const batchSize = Math.max(1, options.batchSize || DEFAULT_BATCH_SIZE);
    const delayMs = Math.max(0, options.delayMs ?? DEFAULT_BATCH_DELAY_MS);
    const chunks = chunkArray(items, batchSize);
    const output = [];

    this.#log(`Running ${items.length} items in ${chunks.length} batch(es).`);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      this.#log(`Processing batch ${i + 1}/${chunks.length} (${chunk.length} items).`);
      const results = await Promise.all(chunk.map((item) => worker(item)));
      output.push(...results);

      if (delayMs > 0 && i < chunks.length - 1) {
        await sleep(delayMs);
      }
    }

    return output;
  }

  async #getAllEntitiesWithFeed(typeName, options = {}) {
    const pageSize = Math.max(50, options.pageSize || ENTITY_PAGE_SIZE);
    let fromVersion = options.fromVersion || null;
    const output = [];

    for (let page = 0; page < FEED_MAX_PAGES; page += 1) {
      const response = await this.apiCall(GET_FEED_METHOD, {
        typeName,
        fromVersion,
        resultsLimit: pageSize
      });

      const data = Array.isArray(response?.data) ? response.data : [];
      output.push(...data);

      if (!response?.toVersion || data.length === 0) {
        break;
      }
      fromVersion = response.toVersion;
      if (data.length < pageSize) {
        break;
      }
    }

    return output;
  }

  async #safeGetAllEntities(typeName, options = {}) {
    try {
      return await this.#getAllEntitiesWithFeed(typeName, options);
    } catch (error) {
      const sanitized = this.#sanitizeError(error);
      this.#warn(`GetFeed failed for ${typeName}, using Get fallback.`, sanitized);
      return await this.apiCall("Get", {
        typeName,
        resultsLimit: options.fallbackResultsLimit || 50000
      });
    }
  }

  async getCurrentUser() {
    if (this.isMockMode) {
      return {
        userName: "Mock User",
        userId: "mock-user",
        database: "mock-database",
        server: "mock.local"
      };
    }

    const session = await this.apiCall("GetSession", {});
    return {
      userName: session?.userName || "",
      userId: session?.user?.id || session?.userId || "",
      database: session?.database || "",
      server: session?.server || ""
    };
  }

  async getDevices() {
    if (this.isMockMode) {
      return deepClone(MOCK_DEVICES);
    }

    const devices = await this.#safeGetAllEntities("Device", {
      pageSize: ENTITY_PAGE_SIZE,
      fallbackResultsLimit: 50000
    });

    return (devices || []).map((device) => ({
      id: device.id,
      name: device.name || "",
      asset: device.serialNumber || device.name || "",
      vehicleLabel: device.name || "",
      mmyYear: device?.vehicleIdentificationNumber?.year || device?.comment || "",
      mmyMake: device?.vehicleIdentificationNumber?.make || "",
      mmyModel: device?.vehicleIdentificationNumber?.model || "",
      groupIds: (device.groups || []).map((group) => group.id).filter(Boolean),
      raw: device
    }));
  }

  async getGroups() {
    if (this.isMockMode) {
      return deepClone(MOCK_GROUPS);
    }

    const groups = await this.#safeGetAllEntities("Group", {
      pageSize: ENTITY_PAGE_SIZE,
      fallbackResultsLimit: 50000
    });

    return (groups || []).map((group) => ({
      id: group.id,
      name: group.name || "",
      parentId: group?.parent?.id || null,
      levelName: group?.color || "",
      raw: group
    }));
  }

  async getTripsForDevice(deviceId, fromDate, toDate) {
    if (this.isMockMode) {
      const from = parseDate(fromDate);
      const to = parseDate(toDate);
      return deepClone(MOCK_TRIPS_BY_DEVICE[deviceId] || []).filter((trip) => {
        const start = parseDate(trip.start);
        return start >= from && start <= to;
      });
    }

    if (!deviceId) {
      throw new Error("deviceId is required.");
    }

    const from = toIsoString(fromDate);
    const to = toIsoString(toDate);
    if (new Date(from) > new Date(to)) {
      throw new Error("fromDate must be before toDate.");
    }

    const trips = await this.apiCall("Get", {
      typeName: "Trip",
      search: {
        deviceSearch: { id: deviceId },
        fromDate: from,
        toDate: to
      },
      resultsLimit: 50000
    });

    return (trips || []).map((trip) => ({
      id: trip.id,
      deviceId: trip?.device?.id || deviceId,
      start: trip.start,
      end: trip.stop,
      // Keep both normalized kilometers and raw distance so report-builder can cross-check.
      distanceKm: normalizeTripDistanceKm(trip),
      distanceRaw: trip?.distance,
      drivingSeconds: Math.max(
        0,
        Math.round((new Date(trip.stop).getTime() - new Date(trip.start).getTime()) / 1000)
      ),
      raw: trip
    }));
  }

  async #resolveOdometerDiagnosticId() {
    if (this.odometerDiagnosticId) {
      return this.odometerDiagnosticId;
    }

    const diagnostics = await this.apiCall("Get", {
      typeName: "Diagnostic",
      search: { name: "Odometer" },
      resultsLimit: 10
    });

    const preferred =
      (diagnostics || []).find((diag) =>
        String(diag?.name || "").toLowerCase().includes("odometer")
      ) || null;

    this.odometerDiagnosticId = preferred?.id || KNOWN_ODOMETER_DIAGNOSTIC_ID;
    return this.odometerDiagnosticId;
  }

  async getOdometerStatusData(deviceId, fromDate, toDate) {
    if (this.isMockMode) {
      const from = parseDate(fromDate);
      const to = parseDate(toDate);
      return deepClone(MOCK_ODOMETER_BY_DEVICE[deviceId] || []).filter((row) => {
        const date = parseDate(row.dateTime);
        return date >= from && date <= to;
      });
    }

    if (!deviceId) {
      throw new Error("deviceId is required.");
    }

    const diagnosticId = await this.#resolveOdometerDiagnosticId();
    const from = toIsoString(fromDate);
    const to = toIsoString(toDate);

    const data = await this.apiCall("Get", {
      typeName: "StatusData",
      search: {
        deviceSearch: { id: deviceId },
        diagnosticSearch: { id: diagnosticId },
        fromDate: from,
        toDate: to
      },
      resultsLimit: 50000
    });

    return (data || []).map((status) => ({
      id: status.id,
      dateTime: status.dateTime,
      deviceId: status?.device?.id || deviceId,
      diagnosticId: status?.diagnostic?.id || diagnosticId,
      value: status.data,
      raw: status
    }));
  }

  async getTrips({ fromDate, toDate, deviceIds = [] }) {
    if (this.isMockMode) {
      const activeDeviceIds = deviceIds.length > 0 ? deviceIds : (await this.getDevices()).map((d) => d.id);
      const trips = await this.runInBatches(
        activeDeviceIds,
        (deviceId) => this.getTripsForDevice(deviceId, fromDate, toDate),
        { batchSize: 20, delayMs: 30 }
      );
      return trips.flat();
    }

    const activeDeviceIds = deviceIds.length > 0 ? deviceIds : (await this.getDevices()).map((d) => d.id);
    const tripBatches = await this.runInBatches(
      activeDeviceIds,
      (deviceId) => this.getTripsForDevice(deviceId, fromDate, toDate),
      { batchSize: 20, delayMs: 120 }
    );

    return tripBatches.flat();
  }
}
