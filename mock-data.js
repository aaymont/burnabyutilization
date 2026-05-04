function toIso(value) {
  return new Date(value).toISOString();
}

export const MOCK_GROUPS = [
  { id: "company", name: "Company Group", parentId: null },

  { id: "vehicle-labels", name: "Vehicle Labels", parentId: "company" },
  { id: "label-101", name: "Truck 101", parentId: "vehicle-labels" },
  { id: "label-202", name: "Van 202", parentId: "vehicle-labels" },
  { id: "label-303", name: "Service 303", parentId: "vehicle-labels" },
  { id: "label-404", name: "Pickup 404", parentId: "vehicle-labels" },
  { id: "label-505", name: "Yard 505", parentId: "vehicle-labels" },

  { id: "mmy-year", name: "MMY Year", parentId: "company" },
  { id: "year-2021", name: "2021", parentId: "mmy-year" },
  { id: "year-2022", name: "2022", parentId: "mmy-year" },
  { id: "year-2019", name: "2019", parentId: "mmy-year" },
  { id: "year-2018", name: "2018", parentId: "mmy-year" },

  { id: "mmy-make", name: "MMY Make", parentId: "company" },
  { id: "make-ford", name: "Ford", parentId: "mmy-make" },
  { id: "make-mercedes", name: "Mercedes", parentId: "mmy-make" },
  { id: "make-toyota", name: "Toyota", parentId: "mmy-make" },
  { id: "make-gmc", name: "GMC", parentId: "mmy-make" },

  { id: "mmy-model", name: "MMY Model", parentId: "company" },
  { id: "model-f150", name: "F-150", parentId: "mmy-model" },
  { id: "model-sprinter", name: "Sprinter", parentId: "mmy-model" },
  { id: "model-rav4", name: "RAV4", parentId: "mmy-model" },
  { id: "model-sierra", name: "Sierra", parentId: "mmy-model" },

  { id: "area", name: "Area", parentId: "company" },
  { id: "area-bucket-1", name: "Groups 1 to 40", parentId: "area" },
  { id: "area-bucket-2", name: "Groups 41 to 70", parentId: "area" },
  { id: "area-a", name: "North/West:Ops*Fleet?", parentId: "area-bucket-1" },
  {
    id: "area-b",
    name: "Very Long Area Name For Excel Sheet Truncation Test 12345",
    parentId: "area-bucket-2"
  },

  { id: "manager", name: "Manager", parentId: "company" },
  { id: "manager-amy", name: "Amy Patel", parentId: "manager" },
  { id: "manager-jose", name: "Jose Singh", parentId: "manager" },
  { id: "manager-lena", name: "Lena Brooks", parentId: "manager" }
];

export const MOCK_DEVICES = [
  {
    id: "d-101",
    asset: "TRK-101",
    name: "Truck 101",
    vehicleLabel: "Truck 101",
    groupIds: ["label-101", "year-2021", "make-ford", "model-f150", "area-a", "manager-amy"]
  },
  {
    id: "d-202",
    asset: "VAN-202",
    name: "Van 202",
    vehicleLabel: "Van 202",
    groupIds: ["label-202", "year-2022", "make-mercedes", "model-sprinter", "area-b", "manager-jose"]
  },
  {
    id: "d-303",
    asset: "SRV-303",
    name: "Service 303",
    vehicleLabel: "Service 303",
    groupIds: ["label-303", "manager-lena"]
  },
  {
    id: "d-404",
    asset: "PU-404",
    name: "Pickup 404",
    vehicleLabel: "Pickup 404",
    groupIds: ["label-404", "year-2019", "make-toyota", "model-rav4", "area-a", "manager-amy", "manager-jose"]
  },
  {
    id: "d-505",
    asset: "YARD-505",
    name: "Yard 505",
    vehicleLabel: "Yard 505",
    groupIds: ["label-505", "year-2018", "make-gmc", "model-sierra", "area-b", "manager-lena"]
  }
];

export const MOCK_TRIPS_BY_DEVICE = {
  "d-101": [
    {
      id: "trip-101-a",
      deviceId: "d-101",
      start: toIso("2025-01-10T08:00:00Z"),
      end: toIso("2025-01-10T09:30:00Z"),
      distanceKm: 40.2,
      drivingSeconds: 5400
    },
    {
      id: "trip-101-b",
      deviceId: "d-101",
      start: toIso("2025-02-14T11:15:00Z"),
      end: toIso("2025-02-14T12:00:00Z"),
      distanceKm: 22.8,
      drivingSeconds: 2700
    }
  ],
  "d-202": [
    {
      id: "trip-202-a",
      deviceId: "d-202",
      start: toIso("2025-03-08T07:00:00Z"),
      end: toIso("2025-03-08T07:55:00Z"),
      distanceKm: 28.4,
      drivingSeconds: 3300
    },
    {
      id: "trip-202-b",
      deviceId: "d-202",
      start: toIso("2025-03-08T13:10:00Z"),
      end: toIso("2025-03-08T14:25:00Z"),
      distanceKm: 36.6,
      drivingSeconds: 4500
    }
  ],
  "d-303": [
    {
      id: "trip-303-a",
      deviceId: "d-303",
      start: toIso("2025-04-02T09:20:00Z"),
      end: toIso("2025-04-02T10:10:00Z"),
      distanceKm: 19.5,
      drivingSeconds: 3000
    }
  ],
  "d-404": [
    {
      id: "trip-404-a",
      deviceId: "d-404",
      start: toIso("2025-05-20T15:00:00Z"),
      end: toIso("2025-05-20T16:00:00Z"),
      distanceKm: 31.2,
      drivingSeconds: 3600
    }
  ],
  "d-505": []
};

export const MOCK_ODOMETER_BY_DEVICE = {
  "d-101": [
    { id: "odo-101-a", deviceId: "d-101", dateTime: toIso("2025-01-01T00:30:00Z"), value: 1200000 },
    { id: "odo-101-b", deviceId: "d-101", dateTime: toIso("2025-06-30T23:00:00Z"), value: 1227800 }
  ],
  "d-202": [],
  "d-303": [],
  "d-404": [],
  "d-505": []
};
