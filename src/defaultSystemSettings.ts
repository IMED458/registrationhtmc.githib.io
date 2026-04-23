import { SystemSettings } from './types';

export const LEGACY_DEFAULT_GOOGLE_SHEET_URL =
  'https://1drv.ms/x/c/bb8b8bedd175f306/IQCHT5OMdKEvQ7PTXLCUSuVXAU1lFxSNfDkyFh4iqezedtM?e=19k9nf';

export const PREVIOUS_DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1zsuLPC1hDVJ1pzGMsk_LY1bILCF6Dbd7/edit?gid=226530235#gid=226530235';

export const DEFAULT_EXTERNAL_WORKBOOK_URL =
  'https://1drv.ms/x/c/bb8b8bedd175f306/IQCHT5OMdKEvQ7PTXLCUSuVXAU1lFxSNfDkyFh4iqezedtM?e=cOHEat';

export const DEFAULT_GOOGLE_APPS_SCRIPT_URL = '';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  googleSheetsId: DEFAULT_EXTERNAL_WORKBOOK_URL,
  googleAppsScriptUrl: DEFAULT_GOOGLE_APPS_SCRIPT_URL,
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

function extractSpreadsheetId(value: string) {
  const trimmedValue = String(value || '').trim();
  const match = trimmedValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  return match ? match[1] : trimmedValue;
}

function shouldUseNewDefaultSheetSource(googleSheetsId?: string) {
  const normalizedValue = String(googleSheetsId || '').trim();
  const previousGoogleId = extractSpreadsheetId(PREVIOUS_DEFAULT_GOOGLE_SHEET_URL);

  return (
    !normalizedValue ||
    normalizedValue === LEGACY_DEFAULT_GOOGLE_SHEET_URL ||
    normalizedValue === PREVIOUS_DEFAULT_GOOGLE_SHEET_URL ||
    extractSpreadsheetId(normalizedValue) === previousGoogleId
  );
}

export function normalizeSystemSettings(input?: Partial<SystemSettings> | null): SystemSettings {
  const mergedSettings: SystemSettings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...input,
    disabledEmails: input?.disabledEmails ?? DEFAULT_SYSTEM_SETTINGS.disabledEmails,
    columnMapping: {
      ...DEFAULT_SYSTEM_SETTINGS.columnMapping,
      ...(input?.columnMapping ?? {}),
    },
  };

  if (shouldUseNewDefaultSheetSource(mergedSettings.googleSheetsId)) {
    mergedSettings.googleSheetsId = DEFAULT_EXTERNAL_WORKBOOK_URL;

    if (!mergedSettings.sheetName || mergedSettings.sheetName.trim() === 'თებერვალი') {
      mergedSettings.sheetName = '';
    }
  }

  return mergedSettings;
}
