import { useEffect } from 'react';
import { collection, doc, getDocs, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { ClinicalRequest } from './types';
import { shouldArchiveRequest, shouldDeleteArchivedRequest } from './archiveUtils';

const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BATCH_OPERATIONS = 400;

type ArchiveMutation =
  | { type: 'archive'; requestId: string }
  | { type: 'delete'; requestId: string };

async function commitArchiveMutations(mutations: ArchiveMutation[]) {
  for (let index = 0; index < mutations.length; index += MAX_BATCH_OPERATIONS) {
    const batch = writeBatch(db);
    const chunk = mutations.slice(index, index + MAX_BATCH_OPERATIONS);
    const archiveTimestamp = Timestamp.now();

    chunk.forEach((mutation) => {
      const targetRef = doc(db, 'requests', mutation.requestId);

      if (mutation.type === 'archive') {
        batch.update(targetRef, {
          archivedAt: archiveTimestamp,
        });
        return;
      }

      batch.delete(targetRef);
    });

    await batch.commit();
  }
}

export function useArchiveMaintenance(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !db) {
      return;
    }

    let cancelled = false;
    let running = false;

    const runMaintenance = async () => {
      if (cancelled || running) {
        return;
      }

      running = true;

      try {
        const snapshot = await getDocs(collection(db, 'requests'));
        const now = Date.now();
        const mutations: ArchiveMutation[] = [];

        snapshot.docs.forEach((requestDoc) => {
          const request = { id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest;

          if (shouldDeleteArchivedRequest(request, now)) {
            mutations.push({ type: 'delete', requestId: requestDoc.id });
            return;
          }

          if (shouldArchiveRequest(request, now)) {
            mutations.push({ type: 'archive', requestId: requestDoc.id });
          }
        });

        if (mutations.length === 0 || cancelled) {
          return;
        }

        await commitArchiveMutations(mutations);
      } catch (error) {
        console.error('Archive maintenance failed:', error);
      } finally {
        running = false;
      }
    };

    void runMaintenance();

    const intervalId = window.setInterval(() => {
      void runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);
}
