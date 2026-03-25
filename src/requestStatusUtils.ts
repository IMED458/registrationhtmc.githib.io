import { ClinicalRequest, RequestStatus } from './types';

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

export function resolveRequestStatus(
  currentStatus: RequestStatus,
  requestedAction?: string | null,
  finalDecision?: string | null,
) {
  const normalizedRequestedAction = String(requestedAction || '').trim();
  const normalizedFinalDecision = String(finalDecision || '').trim();

  if (normalizedRequestedAction === 'სტაციონარი') {
    return 'დასრულებულია' as RequestStatus;
  }

  return FINAL_DECISION_STATUS_MAP[normalizedFinalDecision] || currentStatus;
}

export function resolveRequestStatusFromFinalDecision(
  currentStatus: RequestStatus,
  finalDecision?: string | null,
) {
  return resolveRequestStatus(currentStatus, '', finalDecision);
}

export function resolveRequestStatusFromRequest(
  request: Pick<ClinicalRequest, 'currentStatus' | 'requestedAction' | 'finalDecision'>,
) {
  const normalizedCurrentStatus = normalizeRequestStatus(request.currentStatus || '') || 'ახალი';

  return resolveRequestStatus(
    normalizedCurrentStatus as RequestStatus,
    request.requestedAction,
    request.finalDecision,
  );
}
