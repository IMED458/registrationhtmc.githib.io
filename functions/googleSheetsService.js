const { google } = require('googleapis');
const XLSX = require('xlsx');

const DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1sBG8LsgOrRhkvibB0cOpLihW8GEI1YhP/edit?usp=sharing&ouid=104679229217623816115&rtpof=true&sd=true';

const DEFAULT_SYSTEM_SETTINGS = {
  googleSheetsId: DEFAULT_GOOGLE_SHEET_URL,
  googleDriveFolderId: '',
  sheetName: 'თებერვალი',
  sheetGid: '',
  disabledEmails: [],
  columnMapping: {
    firstName: 'C',
    lastName: 'B',
    historyNumber: 'F',
    personalId: 'D',
    birthDate: '',
    phone: '',
    address: '',
  },
};

function getGoogleAuthClient() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const inlineCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!inlineCredentials) {
    return new google.auth.GoogleAuth({ scopes });
  }

  return new google.auth.GoogleAuth({
    credentials: JSON.parse(inlineCredentials),
    scopes,
  });
}

function mergeSystemSettings(input) {
  const mergedSettings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...(input || {}),
    columnMapping: {
      ...DEFAULT_SYSTEM_SETTINGS.columnMapping,
      ...((input && input.columnMapping) || {}),
    },
  };

  const spreadsheetId = extractSpreadsheetId(mergedSettings.googleSheetsId);
  const defaultSpreadsheetId = extractSpreadsheetId(DEFAULT_SYSTEM_SETTINGS.googleSheetsId);

  if (spreadsheetId === defaultSpreadsheetId) {
    return {
      ...mergedSettings,
      sheetName: DEFAULT_SYSTEM_SETTINGS.sheetName,
      sheetGid: DEFAULT_SYSTEM_SETTINGS.sheetGid,
      columnMapping: { ...DEFAULT_SYSTEM_SETTINGS.columnMapping },
    };
  }

  return mergedSettings;
}

function extractSpreadsheetId(value) {
  const trimmedValue = String(value || '').trim();
  const match = trimmedValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmedValue;
}

function extractSheetGid(settings) {
  if (settings.sheetGid && String(settings.sheetGid).trim()) {
    return String(settings.sheetGid).trim();
  }

  const match = String(settings.googleSheetsId || '').match(/[?&]gid=(\d+)/);
  return (match && match[1]) || '0';
}

function normalizeHeader(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function normalizeLookupValue(value) {
  return String(value || '').trim();
}

function normalizeSpreadsheetValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  }

  return String(value).trim().replace(/\.0+$/, '');
}

function isRefusalStatus(value) {
  return normalizeLookupValue(value).startsWith('უარი');
}

function getSheetDepartmentValue(requestedAction, department, consentStatus) {
  if (isRefusalStatus(consentStatus)) {
    return 'ბინა უარი';
  }

  if (normalizeLookupValue(department)) {
    return normalizeLookupValue(department);
  }

  if (normalizeLookupValue(requestedAction) === 'ბინა') {
    return 'ბინა';
  }

  return '';
}

function columnLetterToIndex(columnName) {
  const normalizedColumnName = String(columnName || '').trim().toUpperCase();

  if (!/^[A-Z]+$/.test(normalizedColumnName)) {
    return -1;
  }

  let index = 0;

  for (const character of normalizedColumnName) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }

  return index - 1;
}

function findColumnIndex(headers, columnName) {
  if (!String(columnName || '').trim()) {
    return -1;
  }

  const normalizedTarget = normalizeHeader(columnName);
  return headers.findIndex((header) => normalizeHeader(header) === normalizedTarget);
}

function resolveColumnIndex(rows, columnName) {
  const columnLetterIndex = columnLetterToIndex(columnName);

  if (columnLetterIndex >= 0) {
    return columnLetterIndex;
  }

  return findColumnIndex(rows[0] || [], columnName);
}

function findPatientRowNumber(rows, settings, historyNumber, personalId) {
  if (rows.length < 2) {
    return null;
  }

  const historyNumberIndex = resolveColumnIndex(rows, settings.columnMapping.historyNumber || 'F');
  const personalIdIndex = resolveColumnIndex(rows, settings.columnMapping.personalId || 'D');
  const normalizedHistoryNumber = normalizeLookupValue(historyNumber);
  const normalizedPersonalId = normalizeLookupValue(personalId);

  const matchingRowIndex = rows.slice(1).findIndex((row) => {
    const rowHistoryNumber = normalizeLookupValue(row[historyNumberIndex]);
    const rowPersonalId = normalizeLookupValue(row[personalIdIndex]);

    return (
      (normalizedHistoryNumber && rowHistoryNumber === normalizedHistoryNumber) ||
      (normalizedPersonalId && rowPersonalId === normalizedPersonalId)
    );
  });

  return matchingRowIndex >= 0 ? matchingRowIndex + 2 : null;
}

async function updateSheetRequestData(settings, historyNumber, personalId, icdCode, requestedAction, department, consentStatus) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const auth = getGoogleAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetName = settings.sheetName || DEFAULT_SYSTEM_SETTINGS.sheetName || 'Sheet1';
  const readResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const rows = readResponse.data.values || [];
  const rowNumber = findPatientRowNumber(rows, settings, historyNumber, personalId);

  if (!rowNumber) {
    throw new Error('Patient row not found for sheet update');
  }

  const diagnosisValue = normalizeLookupValue(icdCode);
  const departmentValue = getSheetDepartmentValue(requestedAction, department, consentStatus);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!H${rowNumber}:I${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[diagnosisValue, departmentValue]],
    },
  });

  return {
    rowNumber,
    diagnosisValue,
    departmentValue,
  };
}

function parseCsv(csvText) {
  const rows = [];
  let currentCell = '';
  let currentRow = [];
  let isQuoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"') {
      if (isQuoted && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        isQuoted = !isQuoted;
      }
      continue;
    }

    if (character === ',' && !isQuoted) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !isQuoted) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = '';
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => String(cell).trim() !== ''));
}

async function fetchPublicSheetRows(settings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const gid = extractSheetGid(settings);
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
  );

  if (!response.ok) {
    throw new Error(`Public sheet fetch failed with status ${response.status}`);
  }

  const csvText = await response.text();
  return parseCsv(csvText);
}

async function fetchWorkbookSheetRows(settings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`,
  );

  if (!response.ok) {
    throw new Error(`Workbook fetch failed with status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = String(settings.sheetName || '').trim() || DEFAULT_SYSTEM_SETTINGS.sheetName;

  if (!sheetName || !workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet not found: ${sheetName || 'unknown'}`);
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 'A',
    defval: '',
    raw: false,
  });
}

async function fetchGoogleApiRows(settings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const auth = getGoogleAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${settings.sheetName || DEFAULT_SYSTEM_SETTINGS.sheetName || 'Sheet1'}!A:Z`,
  });

  return response.data.values || [];
}

async function fetchSheetRows(settings) {
  try {
    return await fetchWorkbookSheetRows(settings);
  } catch (workbookError) {
    console.warn('Workbook fetch failed, falling back to public CSV/API.', workbookError);
  }

  try {
    return await fetchPublicSheetRows(settings);
  } catch (publicError) {
    console.warn('Public sheet fetch failed, falling back to Google Sheets API.', publicError);
    return fetchGoogleApiRows(settings);
  }
}

function mapPatientFromWorkbookRows(rows, settings, historyNumber, personalId) {
  if (!rows.length) {
    return null;
  }

  const normalizedHistoryNumber = normalizeLookupValue(historyNumber);
  const normalizedPersonalId = normalizeLookupValue(personalId);
  const firstNameColumn = settings.columnMapping.firstName || 'C';
  const lastNameColumn = settings.columnMapping.lastName || 'B';
  const historyNumberColumn = settings.columnMapping.historyNumber || 'F';
  const personalIdColumn = settings.columnMapping.personalId || 'D';

  const patientRow = rows.find((row) => {
    const rowHistoryNumber = normalizeSpreadsheetValue(row[historyNumberColumn]);
    const rowPersonalId = normalizeSpreadsheetValue(row[personalIdColumn]);

    return (
      (normalizedHistoryNumber && rowHistoryNumber === normalizedHistoryNumber) ||
      (normalizedPersonalId && rowPersonalId === normalizedPersonalId)
    );
  });

  if (!patientRow) {
    return null;
  }

  return {
    firstName: normalizeSpreadsheetValue(patientRow[firstNameColumn]),
    lastName: normalizeSpreadsheetValue(patientRow[lastNameColumn]),
    historyNumber: normalizeSpreadsheetValue(patientRow[historyNumberColumn]),
    personalId: normalizeSpreadsheetValue(patientRow[personalIdColumn]),
    birthDate: '',
    phone: '',
    address: '',
  };
}

function mapPatientFromSheet(rows, settings, historyNumber, personalId) {
  if (!rows.length) {
    throw new Error('No rows found in sheet');
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
    firstName: patientRow[firstNameIndex] || '',
    lastName: patientRow[lastNameIndex] || '',
    historyNumber: patientRow[historyNumberIndex] || '',
    personalId: patientRow[personalIdIndex] || '',
    birthDate: birthDateIndex >= 0 ? patientRow[birthDateIndex] || '' : '',
    phone: phoneIndex >= 0 ? patientRow[phoneIndex] || '' : '',
    address: addressIndex >= 0 ? patientRow[addressIndex] || '' : '',
  };
}

async function lookupPatient(settingsInput, historyNumber, personalId) {
  const settings = mergeSystemSettings(settingsInput);
  const rows = await fetchSheetRows(settings);

  return Array.isArray(rows[0])
    ? mapPatientFromSheet(rows, settings, historyNumber, personalId)
    : mapPatientFromWorkbookRows(rows, settings, historyNumber, personalId);
}

module.exports = {
  lookupPatient,
  mergeSystemSettings,
  updateSheetRequestData,
};
