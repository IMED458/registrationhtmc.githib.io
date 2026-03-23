import { DEFAULT_SYSTEM_SETTINGS } from './defaultSystemSettings';
import { SystemSettings } from './types';

type WorkbookRow = Record<string, unknown>;

const workbookRowsPromiseByKey = new Map<string, Promise<WorkbookRow[]>>();

function extractSpreadsheetId(value: string) {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  return match ? match[1] : trimmedValue;
}

function normalizeSettings(input?: Partial<SystemSettings> | null): SystemSettings {
  const mergedSettings: SystemSettings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...input,
    columnMapping: {
      ...DEFAULT_SYSTEM_SETTINGS.columnMapping,
      ...(input?.columnMapping || {}),
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

function normalizeCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  }

  return String(value).trim().replace(/\.0+$/, '');
}

async function fetchWorkbookRows(settings: SystemSettings) {
  const spreadsheetId = extractSpreadsheetId(settings.googleSheetsId);
  const sheetName = settings.sheetName?.trim() || DEFAULT_SYSTEM_SETTINGS.sheetName;
  const cacheKey = `${spreadsheetId}::${sheetName}`;

  let workbookRowsPromise = workbookRowsPromiseByKey.get(cacheKey);

  if (!workbookRowsPromise) {
    workbookRowsPromise = (async () => {
      const workbookUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
      const response = await fetch(workbookUrl, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`Workbook fetch failed with status ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'array' });

      if (!sheetName || !workbook.SheetNames.includes(sheetName)) {
        throw new Error(`Sheet not found: ${sheetName || 'unknown'}`);
      }

      return XLSX.utils.sheet_to_json<WorkbookRow>(workbook.Sheets[sheetName], {
        header: 'A',
        defval: '',
        raw: false,
      });
    })().catch((error) => {
      workbookRowsPromiseByKey.delete(cacheKey);
      throw error;
    });

    workbookRowsPromiseByKey.set(cacheKey, workbookRowsPromise);
  }

  return workbookRowsPromise;
}

export async function lookupPatientFromSheet(
  input: Partial<SystemSettings> | null | undefined,
  historyNumber: string,
  personalId: string,
) {
  const settings = normalizeSettings(input);
  const rows = await fetchWorkbookRows(settings);
  const firstNameColumn = settings.columnMapping.firstName || 'C';
  const lastNameColumn = settings.columnMapping.lastName || 'B';
  const historyNumberColumn = settings.columnMapping.historyNumber || 'F';
  const personalIdColumn = settings.columnMapping.personalId || 'D';
  const normalizedHistoryNumber = historyNumber.trim();
  const normalizedPersonalId = personalId.trim();

  const row = rows.find((currentRow) => {
    const rowHistoryNumber = normalizeCellValue(currentRow[historyNumberColumn]);
    const rowPersonalId = normalizeCellValue(currentRow[personalIdColumn]);

    return (
      (normalizedHistoryNumber && rowHistoryNumber === normalizedHistoryNumber) ||
      (normalizedPersonalId && rowPersonalId === normalizedPersonalId)
    );
  });

  if (!row) {
    return null;
  }

  return {
    firstName: normalizeCellValue(row[firstNameColumn]),
    lastName: normalizeCellValue(row[lastNameColumn]),
    historyNumber: normalizeCellValue(row[historyNumberColumn]),
    personalId: normalizeCellValue(row[personalIdColumn]),
    birthDate: '',
    phone: '',
    address: '',
  };
}
