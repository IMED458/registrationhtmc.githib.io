import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

type AuditLogPayload = {
  userId: string;
  userName: string;
  requestId: string;
  actionType: string;
  newValue: string;
  oldValue?: string;
};

export async function writeAuditLogEntry(payload: AuditLogPayload) {
  if (!db) {
    return;
  }

  try {
    await addDoc(collection(db, 'audit_logs'), {
      ...payload,
      createdAt: Timestamp.now(),
    });
  } catch (error) {
    console.warn('Audit log write failed:', error);
  }
}
