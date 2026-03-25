import { SystemSettings } from './types';

export const LEGACY_DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1sBG8LsgOrRhkvibB0cOpLihW8GEI1YhP/edit?usp=sharing&ouid=104679229217623816115&rtpof=true&sd=true';

export const DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1zsuLPC1hDVJ1pzGMsk_LY1bILCF6Dbd7/edit?gid=226530235#gid=226530235';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
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
  const normalizedValue = extractSpreadsheetId(String(googleSheetsId || ''));
  const legacyId = extractSpreadsheetId(LEGACY_DEFAULT_GOOGLE_SHEET_URL);
  const currentId = extractSpreadsheetId(DEFAULT_GOOGLE_SHEET_URL);

  return !normalizedValue || normalizedValue === legacyId || normalizedValue === currentId;
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
