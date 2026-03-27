import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { resolveServerApiUrl } from './serverApi';
import { SystemSettings } from './types';

type SyncRequestToSheetInput = {
  consentStatus: string;
  department: string;
  historyNumber: string;
  icdCode: string;
  personalId: string;
  requestedAction: string;
  settings?: Partial<SystemSettings> | null;
};

async function loadSystemSettings() {
  if (!db) {
    return null;
  }

  const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
  return settingsSnap.exists() ? (settingsSnap.data() as Partial<SystemSettings>) : null;
}

export async function syncRequestToSheet({
  consentStatus,
  department,
  historyNumber,
  icdCode,
  personalId,
  requestedAction,
  settings,
}: SyncRequestToSheetInput) {
  const normalizedHistoryNumber = historyNumber.trim();
  const normalizedPersonalId = personalId.trim();
  const normalizedIcdCode = icdCode.trim();
  const sheetSyncUrl = resolveServerApiUrl('/api/external/sync-request');

  if ((!normalizedHistoryNumber && !normalizedPersonalId) || !normalizedIcdCode || !sheetSyncUrl) {
    return false;
  }

  try {
    const resolvedSettings = settings ?? await loadSystemSettings();
    const syncResponse = await fetch(sheetSyncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        historyNumber: normalizedHistoryNumber,
        personalId: normalizedPersonalId,
        icdCode: normalizedIcdCode,
        requestedAction: requestedAction.trim(),
        department: department.trim(),
        consentStatus: consentStatus.trim(),
        settings: resolvedSettings,
      }),
    });

    if (!syncResponse.ok) {
      const syncError = await syncResponse.json().catch(() => null);
      console.error('Sheet sync error:', syncError);
      return false;
    }

    return true;
  } catch (sheetSyncError) {
    console.error('Sheet sync request failed:', sheetSyncError);
    return false;
  }
}
