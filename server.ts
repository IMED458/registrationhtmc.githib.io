import dotenv from "dotenv";
import net from "net";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { google } from "googleapis";
import { DEFAULT_SYSTEM_SETTINGS } from "./src/defaultSystemSettings";
import { SystemSettings } from "./src/types";

dotenv.config({ path: ".env.local" });
dotenv.config();

function getGoogleAuthClient() {
  const scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
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

function normalizeHeader(value: string | undefined) {
  return (value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function normalizeLookupValue(value: string | undefined) {
  return (value || "").trim();
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

async function fetchPublicSheetRows(settings: SystemSettings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const gid = extractSheetGid(settings);
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Public sheet fetch failed with status ${response.status}`);
  }

  const csvText = await response.text();
  return parseCsv(csvText);
}

async function fetchGoogleApiRows(settings: SystemSettings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const auth = getGoogleAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = `${settings.sheetName || DEFAULT_SYSTEM_SETTINGS.sheetName || "Sheet1"}!A:Z`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return response.data.values || [];
}

async function fetchSheetRows(settings: SystemSettings) {
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
      const rows = await fetchSheetRows(settings);
      const patient = mapPatientFromSheet(rows, settings, historyNumber, personalId);

      if (!patient) {
        return res.status(404).json({ error: "Patient not found" });
      }

      res.json(patient);
    } catch (error: any) {
      console.error("Google Sheets Error:", error);
      res.status(500).json({ error: "Failed to fetch from Google Sheets", details: error.message });
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
