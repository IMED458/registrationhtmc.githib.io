import { extractClinicalIcdCode, normalizeIcdCode } from './icd10Utils';

export type IcdEntry = {
  code: string;
  name: string;
};

type IndexedIcdEntry = IcdEntry & {
  searchCode: string;
  searchName: string;
};

type IcdDataset = {
  byCode: Map<string, string>;
  entries: IndexedIcdEntry[];
};

const CUSTOM_ICD_ENTRIES: Record<string, string> = {
  'ER-0': 'პაციენტი უარს აცხადებს გამოკვლევებზე',
};

let datasetPromise: Promise<IcdDataset> | null = null;

async function loadIcdDataset() {
  if (!datasetPromise) {
    datasetPromise = import('./data/icd10Data.js').then(({ ICD10_KA }) => {
      const byCode = new Map<string, string>();
      const entries: IndexedIcdEntry[] = [];

      Object.entries(ICD10_KA as Record<string, string>).forEach(([rawCode, rawName]) => {
        const code = extractClinicalIcdCode(rawCode);
        const name = String(rawName || '').trim();

        if (!code || !name || byCode.has(code)) {
          return;
        }

        byCode.set(code, name);
        entries.push({
          code,
          name,
          searchCode: code,
          searchName: name.toLowerCase(),
        });
      });

      Object.entries(CUSTOM_ICD_ENTRIES).forEach(([rawCode, rawName]) => {
        const code = extractClinicalIcdCode(rawCode);
        const name = String(rawName || '').trim();

        if (!code || !name || byCode.has(code)) {
          return;
        }

        byCode.set(code, name);
        entries.unshift({
          code,
          name,
          searchCode: code,
          searchName: name.toLowerCase(),
        });
      });

      return { byCode, entries };
    });
  }

  return datasetPromise;
}

function pushResult(results: IcdEntry[], seenCodes: Set<string>, entry: IndexedIcdEntry, limit: number) {
  if (results.length >= limit || seenCodes.has(entry.code)) {
    return;
  }

  seenCodes.add(entry.code);
  results.push({
    code: entry.code,
    name: entry.name,
  });
}

export async function preloadIcdEntries() {
  await loadIcdDataset();
}

export async function findIcdEntryByCode(code: string) {
  const normalizedCode = normalizeIcdCode(code);

  if (!normalizedCode) {
    return null;
  }

  const { byCode } = await loadIcdDataset();
  const name = byCode.get(normalizedCode);

  return name
    ? {
        code: normalizedCode,
        name,
      }
    : null;
}

export async function searchIcdEntries(query: string, limit = 12) {
  const trimmedQuery = query.trim();
  const normalizedCodeQuery = normalizeIcdCode(trimmedQuery);
  const normalizedNameQuery = trimmedQuery.toLowerCase();

  if (!normalizedCodeQuery && !normalizedNameQuery) {
    return [];
  }

  const { entries } = await loadIcdDataset();
  const results: IcdEntry[] = [];
  const seenCodes = new Set<string>();

  entries.forEach((entry) => {
    if (entry.searchCode === normalizedCodeQuery) {
      pushResult(results, seenCodes, entry, limit);
    }
  });

  entries.forEach((entry) => {
    if (entry.searchCode.startsWith(normalizedCodeQuery)) {
      pushResult(results, seenCodes, entry, limit);
    }
  });

  entries.forEach((entry) => {
    if (entry.searchName.startsWith(normalizedNameQuery)) {
      pushResult(results, seenCodes, entry, limit);
    }
  });

  entries.forEach((entry) => {
    if (
      entry.searchCode.includes(normalizedCodeQuery) ||
      entry.searchName.includes(normalizedNameQuery)
    ) {
      pushResult(results, seenCodes, entry, limit);
    }
  });

  return results;
}
