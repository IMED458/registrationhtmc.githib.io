import type { ClinicalRequest } from './types';

function normalizeStudyType(value: string | undefined | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function sanitizeStudyTypes(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeStudyType(value))
        .filter(Boolean),
    ),
  );
}

export function getStudyTypes(
  value: Pick<{ studyType?: string; studyTypes?: string[] }, 'studyType' | 'studyTypes'>,
) {
  if (Array.isArray(value.studyTypes) && value.studyTypes.length > 0) {
    return sanitizeStudyTypes(value.studyTypes);
  }

  const singleStudyType = normalizeStudyType(value.studyType);
  return singleStudyType ? [singleStudyType] : [];
}

export function getStudyTypeSummary(
  value: Pick<{ studyType?: string; studyTypes?: string[] }, 'studyType' | 'studyTypes'>,
) {
  const studyTypes = getStudyTypes(value);
  return studyTypes.join(', ');
}

export function requestHasStudyTypes(request: ClinicalRequest) {
  return getStudyTypes(request).length > 0;
}
