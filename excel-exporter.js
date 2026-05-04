const TABLE_COLUMNS = [
  "Asset",
  "Vehicle Label",
  "MMY Year",
  "MMY Make",
  "MMY Model",
  "Area",
  "Manager",
  "Mileage (km)",
  "Driving Duration"
];

const EXCEL_INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;

function assertSheetJsAvailable() {
  if (!window.XLSX || typeof window.XLSX.utils?.aoa_to_sheet !== "function") {
    throw new Error(
      "SheetJS is not available. Add the CDN script for xlsx.full.min.js in index.html before app.js."
    );
  }
}

function cleanSheetName(name) {
  return String(name || "")
    .replace(EXCEL_INVALID_SHEET_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSheetName(name, usedNames = new Set()) {
  let base = cleanSheetName(name) || "Sheet";
  base = base.slice(0, 31);

  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }

  let index = 2;
  while (index < 1000) {
    const suffix = ` (${index})`;
    const candidate = `${base.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    index += 1;
  }

  const fallback = `Sheet-${Date.now()}`.slice(0, 31);
  usedNames.add(fallback);
  return fallback;
}

function toTableRow(row) {
  return [
    row.asset ?? "",
    row.vehicleLabel ?? "",
    row.mmyYear ?? "",
    row.mmyMake ?? "",
    row.mmyModel ?? "",
    row.area ?? "",
    row.manager ?? "",
    row.mileageKm ?? "",
    row.drivingDuration ?? ""
  ];
}

function autoSizeColumns(worksheet, aoa) {
  const colCount = TABLE_COLUMNS.length;
  const widths = Array.from({ length: colCount }, () => 10);

  for (const row of aoa) {
    for (let c = 0; c < colCount; c += 1) {
      const value = row?.[c] ?? "";
      const width = String(value).length + 2;
      if (width > widths[c]) {
        widths[c] = Math.min(60, width);
      }
    }
  }

  worksheet["!cols"] = widths.map((wch) => ({ wch }));
}

function applyWorksheetFormatting(worksheet, aoa) {
  const XLSX = window.XLSX;
  const titleCellAddress = "A1";
  const dateCellAddress = "A2";
  const headerRowIndex = 4;

  // Freeze top metadata + header row when supported.
  worksheet["!freeze"] = { xSplit: 0, ySplit: headerRowIndex, topLeftCell: "A5", activePane: "bottomLeft" };

  // Bold styles are honored by some SheetJS-compatible writers/viewers.
  if (worksheet[titleCellAddress]) {
    worksheet[titleCellAddress].s = { font: { bold: true, sz: 14 } };
  }
  if (worksheet[dateCellAddress]) {
    worksheet[dateCellAddress].s = { font: { bold: true } };
  }

  for (let c = 0; c < TABLE_COLUMNS.length; c += 1) {
    const address = XLSX.utils.encode_cell({ r: headerRowIndex - 1, c });
    if (worksheet[address]) {
      worksheet[address].s = { font: { bold: true } };
    }
  }

  autoSizeColumns(worksheet, aoa);
}

function buildAreaSheetAoa(areaName, rows, fromDate, toDate) {
  return [
    [`Annual Utilization Report - ${areaName}`],
    [`Reporting Period: ${fromDate} to ${toDate}`],
    [],
    [...TABLE_COLUMNS],
    ...rows.map((row) => toTableRow(row))
  ];
}

function createFileName(fromDate, toDate) {
  const safeFrom = String(fromDate).replace(/[^0-9-]/g, "");
  const safeTo = String(toDate).replace(/[^0-9-]/g, "");
  return `Annual_Utilization_Report_${safeFrom}_to_${safeTo}.xlsx`;
}

function buildWarningsSheet(workbook, warnings, usedNames, fromDate, toDate) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return;
  }

  const XLSX = window.XLSX;
  const sheetName = sanitizeSheetName("Warnings", usedNames);
  const aoa = [
    ["Annual Utilization Report - Warnings"],
    [`Reporting Period: ${fromDate} to ${toDate}`],
    [],
    ["Asset", "Device ID", "Warning"],
    ...warnings.map((w) => [w?.asset ?? "", w?.deviceId ?? "", w?.warning ?? String(w ?? "")])
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  applyWorksheetFormatting(worksheet, aoa);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

export function exportAnnualUtilizationWorkbook(report, fromDate, toDate) {
  assertSheetJsAvailable();
  const XLSX = window.XLSX;

  const allRows = Array.isArray(report?.allRows) ? report.allRows : [];
  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];

  const rowsByArea = report?.rowsByArea && typeof report.rowsByArea === "object" ? report.rowsByArea : {};
  const hasAreaBuckets = Object.keys(rowsByArea).length > 0;

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  const allVehiclesAoa = buildAreaSheetAoa("All Vehicles", allRows, fromDate, toDate);
  const allVehiclesSheet = XLSX.utils.aoa_to_sheet(allVehiclesAoa);
  applyWorksheetFormatting(allVehiclesSheet, allVehiclesAoa);
  XLSX.utils.book_append_sheet(workbook, allVehiclesSheet, sanitizeSheetName("All Vehicles", usedSheetNames));

  if (hasAreaBuckets) {
    for (const [areaName, areaRows] of Object.entries(rowsByArea)) {
      const safeAreaTitle = String(areaName || "").trim() || "Unassigned Area";
      const aoa = buildAreaSheetAoa(safeAreaTitle, Array.isArray(areaRows) ? areaRows : [], fromDate, toDate);
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      applyWorksheetFormatting(worksheet, aoa);
      XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(safeAreaTitle, usedSheetNames));
    }
  } else {
    const byArea = new Map();
    for (const row of allRows) {
      const area = String(row?.area || "").trim() || "Unassigned Area";
      if (!byArea.has(area)) {
        byArea.set(area, []);
      }
      byArea.get(area).push(row);
    }

    for (const [areaName, areaRows] of byArea.entries()) {
      const aoa = buildAreaSheetAoa(areaName, areaRows, fromDate, toDate);
      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      applyWorksheetFormatting(worksheet, aoa);
      XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(areaName, usedSheetNames));
    }
  }

  buildWarningsSheet(workbook, warnings, usedSheetNames, fromDate, toDate);
  XLSX.writeFile(workbook, createFileName(fromDate, toDate), { compression: true });
}

// Backward-compatible wrapper used by earlier app flow.
export function exportRowsToExcelCompatibleCsv(rows, { fromDate, toDate }) {
  const allRows = Array.isArray(rows) ? rows : [];
  const rowsByArea = {};
  for (const row of allRows) {
    const area = String(row?.area || "").trim() || "Unassigned Area";
    if (!rowsByArea[area]) {
      rowsByArea[area] = [];
    }
    rowsByArea[area].push(row);
  }

  const report = {
    allRows,
    rowsByArea,
    warnings: []
  };

  exportAnnualUtilizationWorkbook(report, fromDate, toDate);
}
