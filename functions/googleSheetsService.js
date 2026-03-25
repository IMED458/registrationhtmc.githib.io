const { google } = require('googleapis');
const XLSX = require('xlsx');

const LEGACY_DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1sBG8LsgOrRhkvibB0cOpLihW8GEI1YhP/edit?usp=sharing&ouid=104679229217623816115&rtpof=true&sd=true';

const DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1zsuLPC1hDVJ1pzGMsk_LY1bILCF6Dbd7/edit?gid=226530235#gid=226530235';

const DEFAULT_SYSTEM_SETTINGS = {
  googleSheetsId: DEFAULT_GOOGLE_SHEET_URL,
  googleDriveFolderId: '',
  sheetName: '',
  sheetGid: '',
  disabledEmails: [],
  columnMapping: {
    firstName: 'C',
    lastName: 'B',
    historyNumber: 'F',
    personalId: 'D',
    birthDate: '',
    insurance: 'E',
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

function shouldUseNewDefaultSheetSource(googleSheetsId) {
  const normalizedValue = extractSpreadsheetId(String(googleSheetsId || ''));
  const legacyId = extractSpreadsheetId(LEGACY_DEFAULT_GOOGLE_SHEET_URL);
  const currentId = extractSpreadsheetId(DEFAULT_GOOGLE_SHEET_URL);

  return !normalizedValue || normalizedValue === legacyId || normalizedValue === currentId;
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

  if (shouldUseNewDefaultSheetSource(mergedSettings.googleSheetsId)) {
    mergedSettings.googleSheetsId = DEFAULT_GOOGLE_SHEET_URL;

    if (!mergedSettings.sheetName || String(mergedSettings.sheetName).trim() === 'თებერვალი') {
      mergedSettings.sheetName = '';
    }
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

function escapeSheetNameForRange(sheetName) {
  return /^[A-Za-z0-9_]+$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;
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

function prioritizeSheetNames(sheetNames, preferredSheetName) {
  const normalizedPreferredSheetName = String(preferredSheetName || '').trim();

  if (!normalizedPreferredSheetName || !sheetNames.includes(normalizedPreferredSheetName)) {
    return sheetNames;
  }

  return [
    normalizedPreferredSheetName,
    ...sheetNames.filter((sheetName) => sheetName !== normalizedPreferredSheetName),
  ];
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

function findPatientInSheetEntries(sheetEntries, settings, historyNumber, personalId) {
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

async function updateSheetRequestData(settings, historyNumber, personalId, icdCode, requestedAction, department, consentStatus) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const auth = getGoogleAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetEntries = await fetchWorkbookSheetRows(settings);
  const patientMatch = findPatientInSheetEntries(sheetEntries, settings, historyNumber, personalId);

  if (!patientMatch) {
    throw new Error('Patient row not found for sheet update');
  }

  const diagnosisValue = normalizeLookupValue(icdCode);
  const departmentValue = getSheetDepartmentValue(requestedAction, department, consentStatus);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escapeSheetNameForRange(patientMatch.sheetName)}!H${patientMatch.rowNumber}:I${patientMatch.rowNumber}`,
    valueInputOption: 'RAW',
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
  return [
    {
      sheetName: String(settings.sheetName || '').trim() || DEFAULT_SYSTEM_SETTINGS.sheetName || 'Sheet1',
      rows: parseCsv(csvText),
    },
  ];
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
  const orderedSheetNames = prioritizeSheetNames(
    workbook.SheetNames,
    String(settings.sheetName || '').trim(),
  );

  return orderedSheetNames.map((sheetName) => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    }),
  }));
}

async function fetchGoogleApiRows(settings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const auth = getGoogleAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title)',
  });
  const sheetNames = prioritizeSheetNames(
    (spreadsheet.data.sheets || [])
      .map((sheet) => (sheet.properties && sheet.properties.title) || '')
      .filter(Boolean),
    String(settings.sheetName || '').trim(),
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

function mapPatientFromSheet(rows, settings, historyNumber, personalId) {
  if (!rows.length) {
    throw new Error('No rows found in sheet');
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const firstNameIndex = resolveColumnIndex(rows, settings.columnMapping.firstName || 'C');
  const lastNameIndex = resolveColumnIndex(rows, settings.columnMapping.lastName || 'B');
  const historyNumberIndex = resolveColumnIndex(rows, settings.columnMapping.historyNumber || 'F');
  const personalIdIndex = resolveColumnIndex(rows, settings.columnMapping.personalId || 'D');
  const birthDateIndex = resolveColumnIndex(rows, settings.columnMapping.birthDate);
  const insuranceIndex = resolveColumnIndex(rows, settings.columnMapping.insurance || 'E');
  const phoneIndex = resolveColumnIndex(rows, settings.columnMapping.phone);
  const addressIndex = resolveColumnIndex(rows, settings.columnMapping.address);

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
    insurance: insuranceIndex >= 0 ? patientRow[insuranceIndex] || '' : '',
    phone: phoneIndex >= 0 ? patientRow[phoneIndex] || '' : '',
    address: addressIndex >= 0 ? patientRow[addressIndex] || '' : '',
  };
}

async function lookupPatient(settingsInput, historyNumber, personalId) {
  const settings = mergeSystemSettings(settingsInput);
  const sheetEntries = await fetchSheetRows(settings);
  const patientMatch = findPatientInSheetEntries(sheetEntries, settings, historyNumber, personalId);

  return patientMatch ? patientMatch.patient : null;
}

module.exports = {
  lookupPatient,
  mergeSystemSettings,
  updateSheetRequestData,
};
