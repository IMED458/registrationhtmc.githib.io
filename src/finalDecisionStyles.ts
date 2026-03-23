const RED_FINAL_DECISIONS = new Set([
  'პაციენტი შემოვიდეს რეგისტრატურაში',
  'კვლევა არ ჩატარდეს',
  'არ არის თანახმა',
]);

export function getFinalDecisionTextClass(finalDecision?: string | null) {
  return RED_FINAL_DECISIONS.has(finalDecision ?? '')
    ? 'text-red-600'
    : 'text-slate-700';
}
