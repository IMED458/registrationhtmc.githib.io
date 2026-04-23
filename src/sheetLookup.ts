import { normalizeSystemSettings } from './defaultSystemSettings';
import { SystemSettings } from './types';

type WorkbookSheetRows = {
  rows: string[][];
  sheetName: string;
};

const workbookSheetsPromiseByKey = new Map<string, Promise<WorkbookSheetRows[]>>();

type LookupPatientOptions = {
  forceRefresh?: boolean;
};

function extractSpreadsheetId(value: string) {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  return match ? match[1] : trimmedValue;
}

function isGoogleSheetsSource(value: string) {
  return /docs\.google\.com\/spreadsheets\/d\//i.test(value);
}

function isOneDriveSource(value: string) {
  return /1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(value);
}

function buildOneDriveApiDownloadUrl(shareUrl: string) {
  const encodedShareUrl = btoa(shareUrl)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `https://api.onedrive.com/v1.0/shares/u!${encodedShareUrl}/root/content`;
}

function buildOneDriveDirectDownloadUrl(shareUrl: string) {
  const directDownloadUrl = new URL(shareUrl);

  if (!directDownloadUrl.searchParams.has('download')) {
    directDownloadUrl.searchParams.set('download', '1');
  }

  return directDownloadUrl.toString();
}

function buildWorkbookUrlCandidates(source: string) {
  const normalizedSource = source.trim();

  if (isGoogleSheetsSource(normalizedSource)) {
    const spreadsheetId = extractSpreadsheetId(normalizedSource);
    return [`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`];
  }

  if (isOneDriveSource(normalizedSource)) {
    return [
      buildOneDriveApiDownloadUrl(normalizedSource),
      buildOneDriveDirectDownloadUrl(normalizedSource),
      normalizedSource,
    ];
  }

  return [normalizedSource];
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
  const birthDateIndex = columnLetterToIndex(settings.columnMapping.birthDate || '');
  const phoneIndex = columnLetterToIndex(settings.columnMapping.phone || '');
  const addressIndex = columnLetterToIndex(settings.columnMapping.address || '');
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
    birthDate: birthDateIndex >= 0 ? normalizeCellValue(row[birthDateIndex]) : '',
    insurance: insuranceIndex >= 0 ? normalizeCellValue(row[insuranceIndex]) : '',
    phone: phoneIndex >= 0 ? normalizeCellValue(row[phoneIndex]) : '',
    address: addressIndex >= 0 ? normalizeCellValue(row[addressIndex]) : '',
  };
}

async function fetchWorkbookSheets(settings: SystemSettings, options?: LookupPatientOptions) {
  const workbookUrlCandidates = buildWorkbookUrlCandidates(settings.googleSheetsId);
  const preferredSheetName = settings.sheetName?.trim() || '';
  const cacheKey = `${workbookUrlCandidates.join('||')}::${preferredSheetName || '*'}`;

  if (options?.forceRefresh) {
    workbookSheetsPromiseByKey.delete(cacheKey);
  }

  let workbookSheetsPromise = workbookSheetsPromiseByKey.get(cacheKey);

  if (!workbookSheetsPromise) {
    workbookSheetsPromise = (async () => {
      let lastError: Error | null = null;

      for (const workbookUrl of workbookUrlCandidates) {
        try {
          const response = await fetch(workbookUrl, { cache: 'no-store' });

          if (!response.ok) {
            throw new Error(`Workbook fetch failed with status ${response.status}`);
          }

          const contentType = response.headers.get('content-type') || '';

          if (/text\/html|application\/json/i.test(contentType)) {
            throw new Error(
              `Workbook source returned ${contentType || 'an unsupported response type'} instead of an Excel file. გადაამოწმეთ OneDrive sharing link.`,
            );
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
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }

      throw lastError || new Error('Workbook source fetch failed.');
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
  options?: LookupPatientOptions,
) {
  const settings = normalizeSystemSettings(input);
  const workbookSheets = await fetchWorkbookSheets(settings, options);

  for (const sheet of workbookSheets) {
    const patient = mapPatientFromRows(sheet.rows, settings, historyNumber, personalId);

    if (patient) {
      return patient;
    }
  }

  return null;
}
