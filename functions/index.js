const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const {
  lookupPatient,
  mergeSystemSettings,
  updateSheetRequestData,
} = require('./googleSheetsService');

if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();
const firestore = admin.firestore();

const WEB_APP_BASE_URL = 'https://imed458.github.io/registrationhtmc.githib.io/docs/';
const WEB_APP_ICON_URL = `${WEB_APP_BASE_URL}favicon-32x32.png?v=20260325b`;

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

function normalizeText(value) {
  return String(value || '').trim();
}

function getPatientFullName(requestData) {
  const firstName = normalizeText(requestData?.patientData?.firstName);
  const lastName = normalizeText(requestData?.patientData?.lastName);

  return `${lastName} ${firstName}`.trim() || 'უცნობი პაციენტი';
}

function buildStatusSummary(requestData) {
  const status = normalizeText(requestData?.currentStatus);
  const finalDecision = normalizeText(requestData?.finalDecision);

  if (status && finalDecision) {
    return `სტატუსი: ${status} • გადაწყვეტილება: ${finalDecision}`;
  }

  if (status) {
    return `სტატუსი: ${status}`;
  }

  if (finalDecision) {
    return `გადაწყვეტილება: ${finalDecision}`;
  }

  return 'პაციენტის მოთხოვნა განახლდა';
}

function hasDoctorVisibleUpdate(beforeData, afterData) {
  return (
    normalizeText(beforeData?.currentStatus) !== normalizeText(afterData?.currentStatus) ||
    normalizeText(beforeData?.finalDecision) !== normalizeText(afterData?.finalDecision)
  );
}

async function removeInvalidTokens(userId, tokensToRemove) {
  if (!userId || !tokensToRemove.length) {
    return;
  }

  await firestore.collection('users').doc(userId).set(
    {
      notificationTokens: admin.firestore.FieldValue.arrayRemove(...tokensToRemove),
    },
    { merge: true },
  );
}

exports.notifyRequestOwnerOnStatusChange = functions
  .region('us-central1')
  .firestore.document('requests/{requestId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data();
    const afterData = change.after.data();

    if (!beforeData || !afterData || !hasDoctorVisibleUpdate(beforeData, afterData)) {
      return null;
    }

    const requestOwnerId = normalizeText(afterData.createdByUserId);

    if (!requestOwnerId) {
      return null;
    }

    const userSnapshot = await firestore.collection('users').doc(requestOwnerId).get();

    if (!userSnapshot.exists) {
      return null;
    }

    const userData = userSnapshot.data() || {};
    const notificationTokens = Array.isArray(userData.notificationTokens)
      ? userData.notificationTokens.filter((token) => typeof token === 'string' && token.trim())
      : [];

    if (!notificationTokens.length) {
      return null;
    }

    const patientFullName = getPatientFullName(afterData);
    const body = `${patientFullName} • ${buildStatusSummary(afterData)}`;
    const targetUrl = `${WEB_APP_BASE_URL}#/request/${context.params.requestId}`;

    const response = await admin.messaging().sendEachForMulticast({
      tokens: notificationTokens,
      notification: {
        title: 'პაციენტის სტატუსი განახლდა',
        body,
      },
      data: {
        requestId: context.params.requestId,
        title: 'პაციენტის სტატუსი განახლდა',
        body,
        url: targetUrl,
        tag: `request-status-${context.params.requestId}`,
      },
      webpush: {
        notification: {
          title: 'პაციენტის სტატუსი განახლდა',
          body,
          icon: WEB_APP_ICON_URL,
          badge: WEB_APP_ICON_URL,
          tag: `request-status-${context.params.requestId}`,
          data: {
            url: targetUrl,
          },
        },
        fcmOptions: {
          link: targetUrl,
        },
      },
    });

    const invalidTokens = [];

    response.responses.forEach((result, index) => {
      if (!result.success) {
        const errorCode = result.error?.code || '';

        if (
          errorCode === 'messaging/registration-token-not-registered' ||
          errorCode === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(notificationTokens[index]);
        }
      }
    });

    if (invalidTokens.length) {
      await removeInvalidTokens(requestOwnerId, invalidTokens);
    }

    return null;
  });
