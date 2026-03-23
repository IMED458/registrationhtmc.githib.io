import { SystemSettings } from './types';

export const DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1sBG8LsgOrRhkvibB0cOpLihW8GEI1YhP/edit?usp=sharing&ouid=104679229217623816115&rtpof=true&sd=true';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  googleSheetsId: DEFAULT_GOOGLE_SHEET_URL,
  googleDriveFolderId: '',
  sheetName: 'Z zewnątrz',
  sheetGid: '0',
  columnMapping: {
    firstName: 'სახელი',
    lastName: 'გვარი',
    historyNumber: 'ისტ N',
    personalId: 'პირადი N',
    birthDate: '',
    phone: '',
    address: '',
  },
};
