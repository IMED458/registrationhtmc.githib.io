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

export function getDiagnosisDisplayParts(
  value: Pick<{ icdCode?: string; diagnosis?: string }, 'icdCode' | 'diagnosis'>,
) {
  const code = extractClinicalIcdCode(value.icdCode) || extractClinicalIcdCode(value.diagnosis);
  const description = (value.diagnosis || '').trim();

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
