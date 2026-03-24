import { ClinicalRequest, RequestStatus } from './types';

export const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;
export const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const ARCHIVE_READY_STATUSES: RequestStatus[] = [
  'მიღებულია',
  'დადასტურებულია',
  'დასრულებულია',
  'უარყოფილია',
];

export function getTimestampMillis(value: any) {
  if (!value) {
    return 0;
  }

  if (typeof value?.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsedValue = new Date(value).getTime();

    return Number.isNaN(parsedValue) ? 0 : parsedValue;
  }

  return 0;
}

export function isArchiveEligibleStatus(status: RequestStatus) {
  return ARCHIVE_READY_STATUSES.includes(status);
}

export function getRequestLastActivityMillis(request: ClinicalRequest) {
  return getTimestampMillis(request.updatedAt) || getTimestampMillis(request.createdAt);
}

export function getArchivedAtMillis(request: ClinicalRequest, now = Date.now()) {
  const explicitArchivedAt = getTimestampMillis(request.archivedAt);

  if (explicitArchivedAt) {
    return explicitArchivedAt;
  }

  if (!shouldArchiveRequest(request, now)) {
    return 0;
  }

  return getRequestLastActivityMillis(request) + ARCHIVE_AFTER_MS;
}

export function shouldArchiveRequest(request: ClinicalRequest, now = Date.now()) {
  if (getTimestampMillis(request.archivedAt)) {
    return false;
  }

  if (!isArchiveEligibleStatus(request.currentStatus)) {
    return false;
  }

  const lastActivityMillis = getRequestLastActivityMillis(request);

  return Boolean(lastActivityMillis) && now - lastActivityMillis >= ARCHIVE_AFTER_MS;
}

export function isArchivedRequest(request: ClinicalRequest, now = Date.now()) {
  return Boolean(getArchivedAtMillis(request, now));
}

export function shouldDeleteArchivedRequest(request: ClinicalRequest, now = Date.now()) {
  const archivedAtMillis = getArchivedAtMillis(request, now);

  return Boolean(archivedAtMillis) && now - archivedAtMillis >= ARCHIVE_RETENTION_MS;
}

export function getArchiveGroupKey(request: ClinicalRequest, now = Date.now()) {
  const archivedAtMillis = getArchivedAtMillis(request, now);

  if (!archivedAtMillis) {
    return '';
  }

  return new Date(archivedAtMillis).toISOString().slice(0, 10);
}
