import dotenv from "dotenv";
import net from "net";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { google } from "googleapis";
import * as XLSX from "xlsx";
import { DEFAULT_SYSTEM_SETTINGS } from "./src/defaultSystemSettings";
import { SystemSettings } from "./src/types";

dotenv.config({ path: ".env.local" });
dotenv.config();

type WorkbookSheetRows = {
  rows: string[][];
  sheetName: string;
};

function getGoogleAuthClient() {
  const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
  const inlineCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!inlineCredentials) {
    return new google.auth.GoogleAuth({ scopes });
  }

  return new google.auth.GoogleAuth({
    credentials: JSON.parse(inlineCredentials),
    scopes,
  });
}

function mergeSystemSettings(input: Partial<SystemSettings> | null | undefined): SystemSettings {
  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...input,
    columnMapping: {
      ...DEFAULT_SYSTEM_SETTINGS.columnMapping,
      ...(input?.columnMapping || {}),
    },
  };
}

function extractSpreadsheetId(value: string) {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  return match ? match[1] : trimmedValue;
}

function extractSheetGid(settings: SystemSettings) {
  if (settings.sheetGid?.trim()) {
    return settings.sheetGid.trim();
  }

  const match = settings.googleSheetsId.match(/[?&]gid=(\d+)/);
  return match?.[1] || "0";
}

function escapeSheetNameForRange(sheetName: string) {
  return /^[A-Za-z0-9_]+$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;
}

function normalizeHeader(value: string | undefined) {
  return (value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function normalizeLookupValue(value: string | undefined) {
  return (value || "").trim();
}

function isRefusalStatus(value: string | undefined) {
  return normalizeLookupValue(value).startsWith("უარი");
}

function getSheetDepartmentValue(requestedAction: string, department: string, consentStatus: string) {
  if (isRefusalStatus(consentStatus)) {
    return "ბინა უარი";
  }

  if (normalizeLookupValue(department)) {
    return normalizeLookupValue(department);
  }

  if (normalizeLookupValue(requestedAction) === "ბინა") {
    return "ბინა";
  }

  return "";
}

function prioritizeSheetNames(sheetNames: string[], preferredSheetName?: string) {
  const normalizedPreferredSheetName = preferredSheetName?.trim();

  if (!normalizedPreferredSheetName || !sheetNames.includes(normalizedPreferredSheetName)) {
    return sheetNames;
  }

  return [
    normalizedPreferredSheetName,
    ...sheetNames.filter((sheetName) => sheetName !== normalizedPreferredSheetName),
  ];
}

function columnLetterToIndex(columnName: string) {
  const normalizedColumnName = columnName.trim().toUpperCase();

  if (!/^[A-Z]+$/.test(normalizedColumnName)) {
    return -1;
  }

  let index = 0;
  for (const character of normalizedColumnName) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }

  return index - 1;
}

function resolveColumnIndex(rows: string[][], columnName: string) {
  const columnLetterIndex = columnLetterToIndex(columnName);

  if (columnLetterIndex >= 0) {
    return columnLetterIndex;
  }

  const headers = rows[0] || [];
  return findColumnIndex(headers, columnName);
}

function findPatientRowNumber(
  rows: string[][],
  settings: SystemSettings,
  historyNumber: string,
  personalId: string,
) {
  if (rows.length < 2) {
    return null;
  }

  const historyNumberIndex = resolveColumnIndex(rows, settings.columnMapping.historyNumber || "F");
  const personalIdIndex = resolveColumnIndex(rows, settings.columnMapping.personalId || "D");
  const normalizedHistoryNumber = normalizeLookupValue(historyNumber);
  const normalizedPersonalId = normalizeLookupValue(personalId);
  const dataRows = rows.slice(1);
  const matchingRowIndex = dataRows.findIndex((row) => {
    const rowHistoryNumber = normalizeLookupValue(row[historyNumberIndex]);
    const rowPersonalId = normalizeLookupValue(row[personalIdIndex]);

    return (
      (normalizedHistoryNumber && rowHistoryNumber === normalizedHistoryNumber) ||
      (normalizedPersonalId && rowPersonalId === normalizedPersonalId)
    );
  });

  return matchingRowIndex >= 0 ? matchingRowIndex + 2 : null;
}

function findPatientInSheetEntries(
  sheetEntries: WorkbookSheetRows[],
  settings: SystemSettings,
  historyNumber: string,
  personalId: string,
) {
  for (const sheetEntry of sheetEntries) {
    const patient = mapPatientFromSheet(sheetEntry.rows, settings, historyNumber, personalId);
    const rowNumber = findPatientRowNumber(sheetEntry.rows, settings, historyNumber, personalId);

    if (patient && rowNumber) {
      return {
        patient,
        rowNumber,
        sheetName: sheetEntry.sheetName,
      };
    }
  }

  return null;
}

async function updateSheetRequestData(
  settings: SystemSettings,
  historyNumber: string,
  personalId: string,
  icdCode: string,
  requestedAction: string,
  department: string,
  consentStatus: string,
) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const auth = getGoogleAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const sheetEntries = await fetchWorkbookSheetRows(settings);
  const patientMatch = findPatientInSheetEntries(sheetEntries, settings, historyNumber, personalId);

  if (!patientMatch) {
    throw new Error("Patient row not found for sheet update");
  }

  const diagnosisValue = normalizeLookupValue(icdCode);
  const departmentValue = getSheetDepartmentValue(requestedAction, department, consentStatus);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escapeSheetNameForRange(patientMatch.sheetName)}!H${patientMatch.rowNumber}:I${patientMatch.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[diagnosisValue, departmentValue]],
    },
  });

  return {
    rowNumber: patientMatch.rowNumber,
    sheetName: patientMatch.sheetName,
    diagnosisValue,
    departmentValue,
  };
}

function findColumnIndex(headers: string[], columnName: string) {
  if (!columnName.trim()) {
    return -1;
  }

  const normalizedTarget = normalizeHeader(columnName);
  return headers.findIndex((header) => normalizeHeader(header) === normalizedTarget);
}

function parseCsv(csvText: string) {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let isQuoted = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (isQuoted && nextChar === '"') {
        currentCell += '"';
        i += 1;
      } else {
        isQuoted = !isQuoted;
      }
      continue;
    }

    if (char === "," && !isQuoted) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !isQuoted) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

async function fetchPublicSheetRows(settings: SystemSettings): Promise<WorkbookSheetRows[]> {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const gid = extractSheetGid(settings);
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Public sheet fetch failed with status ${response.status}`);
  }

  const csvText = await response.text();
  return [
    {
      sheetName: settings.sheetName?.trim() || DEFAULT_SYSTEM_SETTINGS.sheetName || "Sheet1",
      rows: parseCsv(csvText),
    },
  ];
}

async function fetchWorkbookSheetRows(settings: SystemSettings): Promise<WorkbookSheetRows[]> {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Workbook fetch failed with status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const orderedSheetNames = prioritizeSheetNames(
    workbook.SheetNames,
    settings.sheetName?.trim(),
  );

  return orderedSheetNames.map((sheetName) => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][],
  }));
}

async function fetchGoogleApiRows(settings: SystemSettings): Promise<WorkbookSheetRows[]> {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const auth = getGoogleAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title)",
  });
  const sheetNames = prioritizeSheetNames(
    (spreadsheet.data.sheets || [])
      .map((sheet) => sheet.properties?.title || "")
      .filter(Boolean),
    settings.sheetName?.trim(),
  );

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: sheetNames.map((sheetName) => `${escapeSheetNameForRange(sheetName)}!A:Z`),
  });

  return (response.data.valueRanges || []).map((valueRange, index) => ({
    sheetName: sheetNames[index],
    rows: valueRange.values || [],
  }));
}

async function fetchSheetRows(settings: SystemSettings): Promise<WorkbookSheetRows[]> {
  try {
    return await fetchWorkbookSheetRows(settings);
  } catch (workbookError) {
    console.warn("Workbook fetch failed, falling back to public CSV/API.", workbookError);
  }

  try {
    return await fetchPublicSheetRows(settings);
  } catch (publicError) {
    console.warn("Public sheet fetch failed, falling back to Google Sheets API.", publicError);
    return await fetchGoogleApiRows(settings);
  }
}

function mapPatientFromSheet(rows: string[][], settings: SystemSettings, historyNumber: string, personalId: string) {
  if (!rows.length) {
    throw new Error("No rows found in sheet");
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const firstNameIndex = findColumnIndex(headers, settings.columnMapping.firstName);
  const lastNameIndex = findColumnIndex(headers, settings.columnMapping.lastName);
  const historyNumberIndex = findColumnIndex(headers, settings.columnMapping.historyNumber);
  const personalIdIndex = findColumnIndex(headers, settings.columnMapping.personalId);
  const birthDateIndex = findColumnIndex(headers, settings.columnMapping.birthDate);
  const phoneIndex = findColumnIndex(headers, settings.columnMapping.phone);
  const addressIndex = findColumnIndex(headers, settings.columnMapping.address);

  const normalizedHistoryNumber = normalizeLookupValue(historyNumber);
  const normalizedPersonalId = normalizeLookupValue(personalId);

  const patientRow = dataRows.find((row) => {
    const rowHistoryNumber = normalizeLookupValue(row[historyNumberIndex]);
    const rowPersonalId = normalizeLookupValue(row[personalIdIndex]);

    return (
      (normalizedHistoryNumber && rowHistoryNumber === normalizedHistoryNumber) ||
      (normalizedPersonalId && rowPersonalId === normalizedPersonalId)
    );
  });

  if (!patientRow) {
    return null;
  }

  return {
    firstName: patientRow[firstNameIndex] || "",
    lastName: patientRow[lastNameIndex] || "",
    historyNumber: patientRow[historyNumberIndex] || "",
    personalId: patientRow[personalIdIndex] || "",
    birthDate: birthDateIndex >= 0 ? patientRow[birthDateIndex] || "" : "",
    phone: phoneIndex >= 0 ? patientRow[phoneIndex] || "" : "",
    address: addressIndex >= 0 ? patientRow[addressIndex] || "" : "",
  };
}

async function isPortFree(port: number) {
  return await new Promise<boolean>((resolve) => {
    const tester = net.createServer();

    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port, "0.0.0.0");
  });
}

async function resolvePort() {
  const preferredPort = Number(process.env.PORT || 3000);

  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }

  throw new Error(`No free port found between ${preferredPort} and ${preferredPort + 19}`);
}

async function startServer() {
  const app = express();
  const PORT = await resolvePort();

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Google Sheets Lookup API
  app.post("/api/external/lookup", async (req, res) => {
    const { historyNumber, personalId, settings: incomingSettings } = req.body;
    const settings = mergeSystemSettings(incomingSettings);
    
    if (!historyNumber && !personalId) {
      return res.status(400).json({ error: "History number or personal ID is required" });
    }

    try {
      const sheetEntries = await fetchSheetRows(settings);
      const patientMatch = findPatientInSheetEntries(
        sheetEntries,
        settings,
        historyNumber,
        personalId,
      );

      if (!patientMatch) {
        return res.status(404).json({ error: "Patient not found" });
      }

      res.json(patientMatch.patient);
    } catch (error: any) {
      console.error("Google Sheets Error:", error);
      res.status(500).json({ error: "Failed to fetch from Google Sheets", details: error.message });
    }
  });

  app.post("/api/external/sync-request", async (req, res) => {
    const {
      historyNumber,
      personalId,
      icdCode,
      requestedAction,
      department,
      consentStatus,
      settings: incomingSettings,
    } = req.body;
    const settings = mergeSystemSettings(incomingSettings);

    if ((!historyNumber && !personalId) || !icdCode) {
      return res.status(400).json({
        error: "History number or personal ID and ICD code are required",
      });
    }

    try {
      const result = await updateSheetRequestData(
        settings,
        historyNumber,
        personalId,
        icdCode,
        requestedAction,
        department,
        consentStatus,
      );

      res.json({
        status: "ok",
        ...result,
      });
    } catch (error: any) {
      console.error("Google Sheets Sync Error:", error);
      res.status(500).json({
        error: "Failed to sync request to Google Sheets",
        details: error.message,
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
