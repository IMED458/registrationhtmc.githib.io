const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const {
  lookupPatient,
  mergeSystemSettings,
  updateSheetRequestData,
} = require('./googleSheetsService');

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (request, response) => {
  response.json({ status: 'ok' });
});

app.post('/external/lookup', async (request, response) => {
  const { historyNumber, personalId, settings: incomingSettings } = request.body || {};
  const settings = mergeSystemSettings(incomingSettings);

  if (!historyNumber && !personalId) {
    return response.status(400).json({ error: 'History number or personal ID is required' });
  }

  try {
    const patient = await lookupPatient(settings, historyNumber, personalId);

    if (!patient) {
      return response.status(404).json({ error: 'Patient not found' });
    }

    return response.json(patient);
  } catch (error) {
    console.error('Google Sheets lookup error:', error);
    return response.status(500).json({
      error: 'Failed to fetch from Google Sheets',
      details: error instanceof Error ? error.message : 'unknown-error',
    });
  }
});

app.post('/external/sync-request', async (request, response) => {
  const {
    historyNumber,
    personalId,
    icdCode,
    requestedAction,
    department,
    consentStatus,
    settings: incomingSettings,
  } = request.body || {};
  const settings = mergeSystemSettings(incomingSettings);

  if ((!historyNumber && !personalId) || !icdCode) {
    return response.status(400).json({
      error: 'History number or personal ID and ICD code are required',
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

    return response.json({
      status: 'ok',
      ...result,
    });
  } catch (error) {
    console.error('Google Sheets sync error:', error);
    return response.status(500).json({
      error: 'Failed to sync request to Google Sheets',
      details: error instanceof Error ? error.message : 'unknown-error',
    });
  }
});

exports.externalApi = functions
  .region('us-central1')
  .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
  })
  .https.onRequest(app);
