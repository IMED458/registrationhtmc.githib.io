import { RequestStatus } from './types';

const FINAL_DECISION_STATUS_MAP: Record<string, RequestStatus> = {
  'პაციენტი გაუშვით ბინაზე': 'დადასტურებულია',
  'პაციენტი შემოვიდეს რეგისტრატურაში': 'მიღებულია',
  'კვლევა ჩატარდეს': 'დადასტურებულია',
  'კვლევა არ ჩატარდეს': 'უარყოფილია',
};

export function resolveRequestStatusFromFinalDecision(
  currentStatus: RequestStatus,
  finalDecision?: string | null,
) {
  const normalizedFinalDecision = String(finalDecision || '').trim();

  return FINAL_DECISION_STATUS_MAP[normalizedFinalDecision] || currentStatus;
}
