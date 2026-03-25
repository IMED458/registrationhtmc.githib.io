import { RequestStatus } from './types';

export const LEGACY_INSURANCE_APPROVAL_STATUS = 'უარყოფილია, თანხმდება დაზღვევასთან';
export const INSURANCE_APPROVAL_STATUS: RequestStatus = 'თანხმდება დაზღვევასთან';

const FINAL_DECISION_STATUS_MAP: Record<string, RequestStatus> = {
  'პაციენტი გაუშვით ბინაზე': 'დადასტურებულია',
  'პაციენტი შემოვიდეს რეგისტრატურაში': 'მიღებულია',
  'პაციენტი დაწვეს კლინიკაში / სტაციონარში': 'დასრულებულია',
  'კვლევა ჩატარდეს': 'დადასტურებულია',
  'კვლევა არ ჩატარდეს': 'უარყოფილია',
};

export function normalizeRequestStatus(status?: string | null) {
  const normalizedStatus = String(status || '').trim();

  if (normalizedStatus === LEGACY_INSURANCE_APPROVAL_STATUS) {
    return INSURANCE_APPROVAL_STATUS;
  }

  return normalizedStatus;
}

export function resolveRequestStatusFromFinalDecision(
  currentStatus: RequestStatus,
  finalDecision?: string | null,
) {
  const normalizedFinalDecision = String(finalDecision || '').trim();

  return FINAL_DECISION_STATUS_MAP[normalizedFinalDecision] || currentStatus;
}
