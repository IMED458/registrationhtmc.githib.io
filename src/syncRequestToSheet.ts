import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { resolveServerApiUrl } from './serverApi';
import { SystemSettings } from './types';

const configuredAppsScriptUrl = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL?.trim() || '';

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

function resolveAppsScriptUrl(settings?: Partial<SystemSettings> | null) {
  const runtimeUrl = String(settings?.googleAppsScriptUrl || '').trim();
  return runtimeUrl || configuredAppsScriptUrl;
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
  const resolvedSettings = settings ?? await loadSystemSettings();
  const appsScriptUrl = resolveAppsScriptUrl(resolvedSettings);
  const sheetSyncUrl = appsScriptUrl || resolveServerApiUrl('/api/external/sync-request');

  if ((!normalizedHistoryNumber && !normalizedPersonalId) || !normalizedIcdCode || !sheetSyncUrl) {
    return false;
  }

  try {
    let syncResponse: Response;

    if (appsScriptUrl) {
      const formBody = new URLSearchParams({
        historyNumber: normalizedHistoryNumber,
        personalId: normalizedPersonalId,
        icdCode: normalizedIcdCode,
        requestedAction: requestedAction.trim(),
        department: department.trim(),
        consentStatus: consentStatus.trim(),
        settings: JSON.stringify(resolvedSettings || {}),
      });

      syncResponse = await fetch(sheetSyncUrl, {
        method: 'POST',
        body: formBody,
      });
    } else {
      syncResponse = await fetch(sheetSyncUrl, {
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
    }

    if (!syncResponse.ok) {
      const syncError = await syncResponse.json().catch(() => null);
      console.error('Sheet sync error:', syncError);
      return false;
    }

    const syncResult = await syncResponse.json().catch(() => null);

    if (syncResult?.status && syncResult.status !== 'ok') {
      console.error('Sheet sync returned non-ok status:', syncResult);
      return false;
    }

    return true;
  } catch (sheetSyncError) {
    console.error('Sheet sync request failed:', sheetSyncError);
    return false;
  }
}
