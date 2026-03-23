import type { DiagnosisEntry } from './types';

const GEORGIAN_TO_LATIN_ICD_MAP: Record<string, string> = {
  ა: 'A',
  ბ: 'B',
  გ: 'G',
  დ: 'D',
  ე: 'E',
  ვ: 'V',
  ზ: 'Z',
  თ: 'T',
  ი: 'I',
  კ: 'K',
  ლ: 'L',
  მ: 'M',
  ნ: 'N',
  ო: 'O',
  პ: 'P',
  ჟ: 'J',
  რ: 'R',
  ს: 'S',
  ტ: 'T',
  უ: 'U',
  ფ: 'F',
  ქ: 'K',
  ღ: 'G',
  ყ: 'Q',
  შ: 'S',
  ჩ: 'C',
  ც: 'C',
  ძ: 'D',
  წ: 'T',
  ჭ: 'C',
  ხ: 'X',
  ჯ: 'J',
  ჰ: 'H',
};

function transliterateGeorgianIcdInput(value: string) {
  return value.replace(/[აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ]/g, (character) => {
    return GEORGIAN_TO_LATIN_ICD_MAP[character] || character;
  });
}

export function normalizeIcdCode(value: string | undefined) {
  return transliterateGeorgianIcdInput((value || '').trim().toLowerCase()).toUpperCase();
}

export function extractClinicalIcdCode(value: string | undefined) {
  const normalizedValue = normalizeIcdCode(value);
  const match = normalizedValue.match(/[A-Z][0-9]{2}(?:\.[A-Z0-9]+)?/);
  return match?.[0] || '';
}

type DiagnosisValue = Pick<
  { icdCode?: string; diagnosis?: string; diagnoses?: DiagnosisEntry[] },
  'icdCode' | 'diagnosis' | 'diagnoses'
>;

export interface DiagnosisDisplayEntry {
  icdCode: string;
  diagnosis: string;
  code: string;
  description: string;
  combined: string;
  isPrimary: boolean;
  isExplicitlyPrimary: boolean;
}

function createDiagnosisDisplayParts(icdCode?: string, diagnosis?: string) {
  const code = extractClinicalIcdCode(icdCode) || extractClinicalIcdCode(diagnosis);
  const description = (diagnosis || '').trim();

  if (!description) {
    return {
      code,
      description: '',
      combined: code || '-',
    };
  }

  if (normalizeIcdCode(description) === code) {
    return {
      code,
      description: '',
      combined: code || description || '-',
    };
  }

  return {
    code,
    description,
      combined: code ? `${code} — ${description}` : description,
  };
}

export function getDiagnosisEntries(value: DiagnosisValue): DiagnosisDisplayEntry[] {
  const sourceEntries = Array.isArray(value.diagnoses) && value.diagnoses.length > 0
    ? value.diagnoses
    : [
        {
          icdCode: value.icdCode || '',
          diagnosis: value.diagnosis || '',
          isPrimary: true,
        },
      ];

  const normalizedEntries = sourceEntries
    .map((entry) => ({
      icdCode: (entry.icdCode || '').trim(),
      diagnosis: (entry.diagnosis || '').trim(),
      isPrimary: Boolean(entry.isPrimary),
    }))
    .filter((entry) => entry.icdCode || entry.diagnosis);

  const explicitPrimaryCount = normalizedEntries.filter((entry) => entry.isPrimary).length;
  const treatAllAsPrimary = normalizedEntries.length > 1 && explicitPrimaryCount === 0;

  return normalizedEntries.map((entry) => {
    const displayParts = createDiagnosisDisplayParts(entry.icdCode, entry.diagnosis);

    return {
      icdCode: entry.icdCode,
      diagnosis: entry.diagnosis,
      ...displayParts,
      isExplicitlyPrimary: entry.isPrimary,
      isPrimary: normalizedEntries.length === 1 || entry.isPrimary || treatAllAsPrimary,
    };
  });
}

export function getRepresentativeDiagnosisEntry(value: DiagnosisValue) {
  const entries = getDiagnosisEntries(value);
  return entries.find((entry) => entry.isPrimary) || entries[0] || null;
}

export function getDiagnosisSearchText(value: DiagnosisValue) {
  return getDiagnosisEntries(value)
    .flatMap((entry) => [entry.icdCode, entry.code, entry.diagnosis, entry.description, entry.combined])
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function getDiagnosisDisplayParts(value: DiagnosisValue) {
  const representative = getRepresentativeDiagnosisEntry(value);
  const totalCount = getDiagnosisEntries(value).length;

  if (!representative) {
    return {
      code: '',
      description: '',
      combined: '-',
      totalCount: 0,
      additionalCount: 0,
    };
  }

  return {
    code: representative.code,
    description: representative.description,
    combined: representative.combined,
    totalCount,
    additionalCount: Math.max(totalCount - 1, 0),
  };
}
