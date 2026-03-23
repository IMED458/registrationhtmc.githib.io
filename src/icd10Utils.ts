export function normalizeIcdCode(value: string | undefined) {
  return (value || '').trim().toUpperCase();
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
