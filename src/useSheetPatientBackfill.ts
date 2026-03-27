import { useEffect } from 'react';
import { collection, doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { isArchivedRequest } from './archiveUtils';
import { db } from './firebase';
import { lookupPatientFromSheet } from './sheetLookup';
import { ClinicalRequest } from './types';

const BACKFILL_INTERVAL_MS = 2 * 60 * 1000;
const SNAPSHOT_SYNC_DELAY_MS = 1500;

function getTrimmedValue(value?: string | null) {
  return String(value || '').trim();
}

function canAttemptBackfill(request: ClinicalRequest) {
  return !isArchivedRequest(request) && Boolean(getTrimmedValue(request.patientData.historyNumber));
}

export function useSheetPatientBackfill(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !db || typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    let running = false;
    let scheduledRunId: number | null = null;
    let latestRequests: ClinicalRequest[] = [];

    const clearScheduledRun = () => {
      if (scheduledRunId !== null) {
        window.clearTimeout(scheduledRunId);
        scheduledRunId = null;
      }
    };

    const scheduleBackfill = (delayMs: number) => {
      clearScheduledRun();
      scheduledRunId = window.setTimeout(() => {
        void runBackfill();
      }, delayMs);
    };

    const runBackfill = async () => {
      if (cancelled || running || latestRequests.length === 0) {
        return;
      }

      running = true;

      try {
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        const settings = settingsSnap.exists() ? settingsSnap.data() : null;
        const candidates = latestRequests.filter(canAttemptBackfill);
        let shouldForceRefreshWorkbook = true;

        for (const request of candidates) {
          if (cancelled) {
            return;
          }

          const historyNumber = getTrimmedValue(request.patientData.historyNumber);

          if (!historyNumber) {
            continue;
          }

          const patientFromSheet = await lookupPatientFromSheet(
            settings,
            historyNumber,
            '',
            { forceRefresh: shouldForceRefreshWorkbook },
          );

          shouldForceRefreshWorkbook = false;

          if (!patientFromSheet) {
            continue;
          }

          const nextPersonalId = getTrimmedValue(patientFromSheet.personalId);
          const nextInsurance = getTrimmedValue(patientFromSheet.insurance);
          const currentPersonalId = getTrimmedValue(request.patientData.personalId);
          const currentInsurance = getTrimmedValue(request.patientData.insurance);
          const updates: Record<string, string> = {};

          if (nextPersonalId && nextPersonalId !== currentPersonalId) {
            updates['patientData.personalId'] = nextPersonalId;
          }

          if (nextInsurance && nextInsurance !== currentInsurance) {
            updates['patientData.insurance'] = nextInsurance;
          }

          if (Object.keys(updates).length === 0) {
            continue;
          }

          await updateDoc(doc(db, 'requests', request.id), updates);
        }
      } catch (error) {
        console.error('Sheet patient backfill failed:', error);
      } finally {
        running = false;

        if (!cancelled) {
          scheduleBackfill(BACKFILL_INTERVAL_MS);
        }
      }
    };

    const unsubscribe = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
        latestRequests = snapshot.docs.map(
          (requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest),
        );

        scheduleBackfill(SNAPSHOT_SYNC_DELAY_MS);
      },
      (error) => {
        console.error('Sheet patient backfill snapshot failed:', error);
      },
    );

    scheduleBackfill(SNAPSHOT_SYNC_DELAY_MS);

    return () => {
      cancelled = true;
      clearScheduledRun();
      unsubscribe();
    };
  }, [enabled]);
}
