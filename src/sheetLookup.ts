import { normalizeSystemSettings } from './defaultSystemSettings';
import { SystemSettings } from './types';

type WorkbookSheetRows = {
  rows: string[][];
  sheetName: string;
};

const workbookSheetsPromiseByKey = new Map<string, Promise<WorkbookSheetRows[]>>();

function extractSpreadsheetId(value: string) {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  return match ? match[1] : trimmedValue;
}

function normalizeCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  }

  return String(value).trim().replace(/\.0+$/, '');
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

function mapPatientFromRows(
  rows: string[][],
  settings: SystemSettings,
  historyNumber: string,
  personalId: string,
) {
  if (!rows.length) {
    return null;
  }

  const firstNameIndex = columnLetterToIndex(settings.columnMapping.firstName || 'C');
  const lastNameIndex = columnLetterToIndex(settings.columnMapping.lastName || 'B');
  const historyNumberIndex = columnLetterToIndex(settings.columnMapping.historyNumber || 'F');
  const personalIdIndex = columnLetterToIndex(settings.columnMapping.personalId || 'D');
  const insuranceIndex = columnLetterToIndex(settings.columnMapping.insurance || 'E');
  const normalizedHistoryNumber = historyNumber.trim();
  const normalizedPersonalId = personalId.trim();

  const row = rows.find((currentRow) => {
    const rowHistoryNumber = normalizeCellValue(currentRow[historyNumberIndex]);
    const rowPersonalId = normalizeCellValue(currentRow[personalIdIndex]);

    return (
      (normalizedHistoryNumber && rowHistoryNumber === normalizedHistoryNumber) ||
      (normalizedPersonalId && rowPersonalId === normalizedPersonalId)
    );
  });

  if (!row) {
    return null;
  }

  return {
    firstName: normalizeCellValue(row[firstNameIndex]),
    lastName: normalizeCellValue(row[lastNameIndex]),
    historyNumber: normalizeCellValue(row[historyNumberIndex]),
    personalId: normalizeCellValue(row[personalIdIndex]),
    birthDate: '',
    insurance: insuranceIndex >= 0 ? normalizeCellValue(row[insuranceIndex]) : '',
    phone: '',
    address: '',
  };
}

async function fetchWorkbookSheets(settings: SystemSettings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const preferredSheetName = settings.sheetName?.trim() || '';
  const cacheKey = `${spreadsheetId}::${preferredSheetName || '*'}`;

  let workbookSheetsPromise = workbookSheetsPromiseByKey.get(cacheKey);

  if (!workbookSheetsPromise) {
    workbookSheetsPromise = (async () => {
      const workbookUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
      const response = await fetch(workbookUrl, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`Workbook fetch failed with status ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'array' });
      const orderedSheetNames = prioritizeSheetNames(workbook.SheetNames, preferredSheetName);

      return orderedSheetNames.map((sheetName) => ({
        sheetName,
        rows: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
          header: 1,
          defval: '',
          raw: false,
        }) as string[][],
      }));
    })().catch((error) => {
      workbookSheetsPromiseByKey.delete(cacheKey);
      throw error;
    });

    workbookSheetsPromiseByKey.set(cacheKey, workbookSheetsPromise);
  }

  return workbookSheetsPromise;
}

export async function lookupPatientFromSheet(
  input: Partial<SystemSettings> | null | undefined,
  historyNumber: string,
  personalId: string,
) {
  const settings = normalizeSystemSettings(input);
  const workbookSheets = await fetchWorkbookSheets(settings);

  for (const sheet of workbookSheets) {
    const patient = mapPatientFromRows(sheet.rows, settings, historyNumber, personalId);

    if (patient) {
      return patient;
    }
  }

  return null;
}
