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

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function getTimestampSignature(timestamp) {
  if (!timestamp) {
    return '';
  }

  if (typeof timestamp.toMillis === 'function') {
    return String(timestamp.toMillis());
  }

  if (typeof timestamp.seconds === 'number') {
    return String((timestamp.seconds * 1000) + Math.floor((timestamp.nanoseconds || 0) / 1000000));
  }

  return String(timestamp);
}

function normalizeRole(userData) {
  const directRole = normalizeText(userData?.role);

  if (directRole) {
    return directRole;
  }

  const email = normalizeEmail(userData?.email);

  if (email === 'imedashviligio27@gmail.com') {
    return 'admin';
  }

  if (email === 'emergencyhtmc14@gmail.com') {
    return 'registrar';
  }

  return '';
}

function getPatientFullName(requestData) {
  const firstName = normalizeText(requestData?.patientData?.firstName);
  const lastName = normalizeText(requestData?.patientData?.lastName);

  return `${lastName} ${firstName}`.trim() || 'უცნობი პაციენტი';
}

function getRequestSummary(requestData) {
  const consentStatus = normalizeText(requestData?.consentStatus);
  const requestedAction = normalizeText(requestData?.requestedAction);
  const department = normalizeText(requestData?.department);
  const studyTypes = Array.isArray(requestData?.studyTypes)
    ? requestData.studyTypes.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const studyType = normalizeText(requestData?.studyType);

  if (consentStatus.startsWith('უარი')) {
    return consentStatus;
  }

  if (requestedAction === 'სტაციონარი' && department) {
    return department;
  }

  if (requestedAction === 'კვლევა') {
    if (studyTypes.length) {
      return studyTypes.join(', ');
    }

    if (studyType) {
      return studyType;
    }
  }

  return requestedAction || 'მოთხოვნა';
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

function isPendingAdminConfirmationData(requestData) {
  return requestData?.adminConfirmationStatus === 'pending' &&
    Boolean(requestData?.pendingRegistrarUpdate || requestData?.pendingDoctorEdit);
}

function buildRequestMeta(requestData) {
  return {
    adminFeedActivity: [
      getTimestampSignature(requestData?.pendingRegistrarUpdate?.requestedAt),
      getTimestampSignature(requestData?.pendingDoctorEdit?.editedAt),
      normalizeText(requestData?.adminConfirmationStatus),
      String(Boolean(requestData?.requiresRegistrarAction)),
    ].join('|'),
    doctorEditActivity: [
      getTimestampSignature(requestData?.lastDoctorEditAt),
      normalizeText(requestData?.pendingDoctorEdit?.comment),
      normalizeText(requestData?.pendingDoctorEdit?.editedByUserId),
      String(Boolean(requestData?.requiresRegistrarAction)),
    ].join('|'),
    finalDecision: normalizeText(requestData?.finalDecision),
    hasPendingApproval: isPendingAdminConfirmationData(requestData),
    registrarActivity: [
      getTimestampSignature(requestData?.lastRegistrarEditAt),
      normalizeText(requestData?.registrarComment),
      normalizeText(requestData?.registrarName),
      normalizeText(requestData?.formFillerName),
    ].join('|'),
    requiresRegistrarAction: Boolean(requestData?.requiresRegistrarAction),
    status: normalizeText(requestData?.currentStatus),
  };
}

function buildTargetUrl(requestId) {
  return `${WEB_APP_BASE_URL}#/request/${requestId}`;
}

function buildNotificationMessage(title, body, tag, requestId) {
  return {
    title,
    body,
    tag,
    requestId,
    targetUrl: buildTargetUrl(requestId),
  };
}

function buildRegistrarNotificationMessage(requestData, requestId) {
  const patientFullName = getPatientFullName(requestData);
  const sender = normalizeText(requestData?.createdByUserName) || normalizeText(requestData?.createdByUserEmail) || 'თანამშრომელი';
  const summary = getRequestSummary(requestData);
  const registrarEditComment = normalizeText(requestData?.pendingDoctorEdit?.comment);

  if (requestData?.requiresRegistrarAction && registrarEditComment) {
    return buildNotificationMessage(
      'მოთხოვნა განახლდა',
      `${patientFullName} • ${registrarEditComment}`,
      `registrar-update-${requestId}-${getTimestampSignature(requestData?.updatedAt) || 'now'}`,
      requestId,
    );
  }

  return buildNotificationMessage(
    'ახალი მოთხოვნა',
    `${patientFullName} • ${summary} • გამომგზავნი: ${sender}`,
    `registrar-request-${requestId}-${getTimestampSignature(requestData?.createdAt) || 'now'}`,
    requestId,
  );
}

function buildAdminNotificationMessage(requestData, requestId) {
  const patientFullName = getPatientFullName(requestData);
  const requestedBy =
    normalizeText(requestData?.pendingRegistrarUpdate?.requestedByUserName) ||
    normalizeText(requestData?.pendingDoctorEdit?.editedByUserName) ||
    normalizeText(requestData?.createdByUserName) ||
    normalizeText(requestData?.createdByUserEmail) ||
    'თანამშრომელი';
  const requiresApproval = isPendingAdminConfirmationData(requestData);

  return buildNotificationMessage(
    requiresApproval ? 'ახალი დადასტურება' : 'ახალი ცვლილება',
    requiresApproval
      ? `${patientFullName} • ცვლილება ელოდება დადასტურებას • ${requestedBy}`
      : `${patientFullName} • ცვლილება დაფიქსირდა • ${requestedBy}`,
    `${requiresApproval ? 'admin-approval' : 'admin-update'}-${requestId}-${getTimestampSignature(requestData?.updatedAt) || 'now'}`,
    requestId,
  );
}

function getNotificationTokens(userData) {
  return Array.isArray(userData?.notificationTokens)
    ? userData.notificationTokens.filter((token) => typeof token === 'string' && token.trim())
    : [];
}

function hasDoctorVisibleUpdate(beforeData, afterData) {
  const beforeMeta = buildRequestMeta(beforeData);
  const afterMeta = buildRequestMeta(afterData);

  return (
    beforeMeta.status !== afterMeta.status ||
    beforeMeta.finalDecision !== afterMeta.finalDecision ||
    (Boolean(afterMeta.registrarActivity) && beforeMeta.registrarActivity !== afterMeta.registrarActivity)
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

async function getUsersByRoles(roles) {
  const requestedRoles = new Set(roles.map((role) => normalizeText(role)).filter(Boolean));

  if (!requestedRoles.size) {
    return [];
  }

  const snapshot = await firestore.collection('users').get();

  return snapshot.docs
    .map((userDoc) => ({
      id: userDoc.id,
      data: userDoc.data() || {},
    }))
    .filter((userRecord) => {
      if (userRecord.data?.isActive === false) {
        return false;
      }

      return requestedRoles.has(normalizeRole(userRecord.data));
    });
}

async function sendNotificationToUsers(userRecords, message) {
  const tokenOwners = new Map();
  const tokens = [];

  userRecords.forEach((userRecord) => {
    getNotificationTokens(userRecord.data).forEach((token) => {
      if (!tokenOwners.has(token)) {
        tokenOwners.set(token, userRecord.id);
        tokens.push(token);
      }
    });
  });

  if (!tokens.length) {
    return null;
  }

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title: message.title,
      body: message.body,
    },
    data: {
      body: message.body,
      requestId: message.requestId,
      tag: message.tag,
      title: message.title,
      url: message.targetUrl,
    },
    webpush: {
      notification: {
        title: message.title,
        body: message.body,
        icon: WEB_APP_ICON_URL,
        badge: WEB_APP_ICON_URL,
        tag: message.tag,
        data: {
          url: message.targetUrl,
        },
      },
      fcmOptions: {
        link: message.targetUrl,
      },
    },
  });

  const invalidTokensByUserId = new Map();

  response.responses.forEach((result, index) => {
    if (result.success) {
      return;
    }

    const errorCode = result.error?.code || '';

    if (
      errorCode === 'messaging/registration-token-not-registered' ||
      errorCode === 'messaging/invalid-registration-token'
    ) {
      const token = tokens[index];
      const userId = tokenOwners.get(token);

      if (!userId) {
        return;
      }

      const currentTokens = invalidTokensByUserId.get(userId) || [];
      currentTokens.push(token);
      invalidTokensByUserId.set(userId, currentTokens);
    }
  });

  await Promise.all(
    Array.from(invalidTokensByUserId.entries()).map(([userId, invalidTokens]) =>
      removeInvalidTokens(userId, invalidTokens),
    ),
  );

  return response;
}

exports.notifyRegistrarsOnNewRequest = functions
  .region('us-central1')
  .firestore.document('requests/{requestId}')
  .onCreate(async (snapshot, context) => {
    const requestData = snapshot.data();

    if (!requestData) {
      return null;
    }

    const registrars = await getUsersByRoles(['registrar']);

    return sendNotificationToUsers(
      registrars,
      buildRegistrarNotificationMessage(requestData, context.params.requestId),
    );
  });

exports.notifyAdminAndRegistrarFeeds = functions
  .region('us-central1')
  .firestore.document('requests/{requestId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data();
    const afterData = change.after.data();

    if (!beforeData || !afterData) {
      return null;
    }

    const beforeMeta = buildRequestMeta(beforeData);
    const afterMeta = buildRequestMeta(afterData);
    const tasks = [];

    if (afterMeta.requiresRegistrarAction && beforeMeta.doctorEditActivity !== afterMeta.doctorEditActivity) {
      tasks.push(
        getUsersByRoles(['registrar']).then((registrars) =>
          sendNotificationToUsers(
            registrars,
            buildRegistrarNotificationMessage(afterData, context.params.requestId),
          ),
        ),
      );
    }

    if (
      beforeMeta.adminFeedActivity !== afterMeta.adminFeedActivity &&
      (afterMeta.hasPendingApproval || Boolean(afterData.pendingDoctorEdit) || Boolean(afterData.pendingRegistrarUpdate))
    ) {
      tasks.push(
        getUsersByRoles(['admin']).then((admins) =>
          sendNotificationToUsers(
            admins,
            buildAdminNotificationMessage(afterData, context.params.requestId),
          ),
        ),
      );
    }

    if (!tasks.length) {
      return null;
    }

    await Promise.all(tasks);
    return null;
  });

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
    const notificationTokens = getNotificationTokens(userData);

    if (!notificationTokens.length) {
      return null;
    }

    return sendNotificationToUsers(
      [{ id: requestOwnerId, data: userData }],
      buildNotificationMessage(
        'პაციენტის სტატუსი განახლდა',
        `${getPatientFullName(afterData)} • ${buildStatusSummary(afterData)}`,
        `request-status-${context.params.requestId}`,
        context.params.requestId,
      ),
    );
  });
