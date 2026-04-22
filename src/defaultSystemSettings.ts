import { SystemSettings } from './types';

export const LEGACY_DEFAULT_GOOGLE_SHEET_URL =
  'https://1drv.ms/x/c/bb8b8bedd175f306/IQCHT5OMdKEvQ7PTXLCUSuVXAU1lFxSNfDkyFh4iqezedtM?e=19k9nf';

export const DEFAULT_GOOGLE_SHEET_URL =
  'https://1drv.ms/x/c/bb8b8bedd175f306/IQCHT5OMdKEvQ7PTXLCUSuVXAU1lFxSNfDkyFh4iqezedtM?e=cOHEat';

export const DEFAULT_GOOGLE_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyij6Xs4vi97zRAYQ-80TKEoJWKWZsNiedUn6GsiKBxZFUU2HnRwovBNfkwRRFCVwH0/exec';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  googleSheetsId: DEFAULT_GOOGLE_SHEET_URL,
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

function isOneDriveUrl(value: string): boolean {
  return /1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(value);
}

function shouldUseNewDefaultSheetSource(googleSheetsId?: string) {
  const raw = String(googleSheetsId || '').trim();

  if (!raw) return true;

  // თუ ნებისმიერი OneDrive URL-ია — ჩავთვლოთ default-ად და ახალი URL-ით გავცვალოთ
  if (isOneDriveUrl(raw)) return true;

  const normalizedValue = extractSpreadsheetId(raw);
  const legacyId = extractSpreadsheetId(LEGACY_DEFAULT_GOOGLE_SHEET_URL);
  const currentId = extractSpreadsheetId(DEFAULT_GOOGLE_SHEET_URL);

  return normalizedValue === legacyId || normalizedValue === currentId;
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
    mergedSettings.googleSheetsId = DEFAULT_GOOGLE_SHEET_URL;

    if (!mergedSettings.sheetName || mergedSettings.sheetName.trim() === 'თებერვალი') {
      mergedSettings.sheetName = '';
    }
  }

  return mergedSettings;
}
