import dotenv from "dotenv";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { google } from "googleapis";

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Google Sheets Lookup API
  app.post("/api/external/lookup", async (req, res) => {
    const { historyNumber, personalId, settings } = req.body;
    
    if (!settings || !settings.googleSheetsId) {
      return res.status(400).json({ error: "Google Sheets ID not configured" });
    }

    try {
      // Note: In a real app, we'd use a service account. 
      // For this demo, we'll assume the user provides an API Key or we use a mock for now 
      // if the key is not in env.
      // But the user asked for real integration.
      
      const auth = getGoogleAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: settings.googleSheetsId,
        range: `${settings.sheetName || 'Sheet1'}!A:Z`,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "No data found in sheet" });
      }

      const headers = rows[0];
      const mapping = settings.columnMapping || {};
      
      // Find the patient
      const patientRow = rows.find(row => {
        const hNum = row[headers.indexOf(mapping.historyNumber || 'History Number')];
        const pId = row[headers.indexOf(mapping.personalId || 'Personal ID')];
        return (historyNumber && hNum === historyNumber) || (personalId && pId === personalId);
      });

      if (!patientRow) {
        return res.status(404).json({ error: "Patient not found" });
      }

      // Map the row to patient object
      const patient = {
        firstName: patientRow[headers.indexOf(mapping.firstName || 'First Name')],
        lastName: patientRow[headers.indexOf(mapping.lastName || 'Last Name')],
        historyNumber: patientRow[headers.indexOf(mapping.historyNumber || 'History Number')],
        personalId: patientRow[headers.indexOf(mapping.personalId || 'Personal ID')],
        birthDate: patientRow[headers.indexOf(mapping.birthDate || 'Birth Date')],
        phone: patientRow[headers.indexOf(mapping.phone || 'Phone')],
        address: patientRow[headers.indexOf(mapping.address || 'Address')],
      };

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
