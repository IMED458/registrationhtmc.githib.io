import { getDiagnosisEntries } from './icd10Utils';
import { normalizeRequestStatus } from './requestStatusUtils';
import { getStudyTypeSummary } from './studyTypeUtils';
import { ClinicalRequest, DiagnosisEntry, Patient, RequestStatus } from './types';

export type RequestChangeSnapshot = {
  patientData: Patient;
  requestedAction: string;
  department?: string;
  studyType?: string;
  studyTypes?: string[];
  consentStatus?: string;
  diagnosis?: string;
  icdCode?: string;
  diagnoses?: DiagnosisEntry[];
  doctorComment?: string;
  registrarComment?: string;
  currentStatus?: RequestStatus | string;
  finalDecision?: string;
};

function normalizeValue(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getPrintableValue(value?: string | null) {
  return normalizeValue(value) || '-';
}

export function getRequestActionLabel(requestedAction?: string | null, department?: string | null) {
  const normalizedAction = normalizeValue(requestedAction);
  const normalizedDepartment = normalizeValue(department);

  if (normalizedAction === 'სტაციონარი') {
    return normalizedDepartment || 'სტაციონარი';
  }

  return normalizedAction || '-';
}

function getDiagnosisSummary(request: Pick<RequestChangeSnapshot, 'diagnosis' | 'diagnoses' | 'icdCode'>) {
  const normalizedEntries = getDiagnosisEntries(request as ClinicalRequest)
    .map((entry) => `${normalizeValue(entry.code || entry.icdCode)} ${normalizeValue(entry.description || entry.diagnosis)}`.trim())
    .filter(Boolean);

  return normalizedEntries.join(', ');
}

function pushValueChange(changes: string[], label: string, previousValue?: string | null, nextValue?: string | null) {
  const normalizedPreviousValue = normalizeValue(previousValue);
  const normalizedNextValue = normalizeValue(nextValue);

  if (normalizedPreviousValue === normalizedNextValue) {
    return;
  }

  changes.push(`${label}: ${getPrintableValue(normalizedPreviousValue)} -> ${getPrintableValue(normalizedNextValue)}`);
}

export function buildRequestChangeSummary(previousRequest: RequestChangeSnapshot, nextRequest: RequestChangeSnapshot) {
  const changes: string[] = [];

  pushValueChange(changes, 'სახელი', previousRequest.patientData.firstName, nextRequest.patientData.firstName);
  pushValueChange(changes, 'გვარი', previousRequest.patientData.lastName, nextRequest.patientData.lastName);
  pushValueChange(changes, 'ისტორიის ნომერი', previousRequest.patientData.historyNumber, nextRequest.patientData.historyNumber);
  pushValueChange(changes, 'პირადი ნომერი', previousRequest.patientData.personalId, nextRequest.patientData.personalId);
  pushValueChange(changes, 'დაზღვევა', previousRequest.patientData.insurance, nextRequest.patientData.insurance);
  pushValueChange(changes, 'დაბადების თარიღი', previousRequest.patientData.birthDate, nextRequest.patientData.birthDate);
  pushValueChange(changes, 'ტელეფონი', previousRequest.patientData.phone, nextRequest.patientData.phone);
  pushValueChange(changes, 'მისამართი', previousRequest.patientData.address, nextRequest.patientData.address);

  const previousAction = getRequestActionLabel(previousRequest.requestedAction, previousRequest.department);
  const nextAction = getRequestActionLabel(nextRequest.requestedAction, nextRequest.department);
  pushValueChange(changes, 'მოქმედება', previousAction, nextAction);

  pushValueChange(
    changes,
    'კვლევის ტიპი',
    getStudyTypeSummary(previousRequest),
    getStudyTypeSummary(nextRequest),
  );

  pushValueChange(
    changes,
    'დიაგნოზი',
    getDiagnosisSummary(previousRequest),
    getDiagnosisSummary(nextRequest),
  );

  pushValueChange(changes, 'თანხმობა / უარი', previousRequest.consentStatus, nextRequest.consentStatus);
  pushValueChange(changes, 'ექიმის კომენტარი', previousRequest.doctorComment, nextRequest.doctorComment);
  pushValueChange(changes, 'რეგისტრატორის კომენტარი', previousRequest.registrarComment, nextRequest.registrarComment);
  pushValueChange(
    changes,
    'სტატუსი',
    normalizeRequestStatus(previousRequest.currentStatus || ''),
    normalizeRequestStatus(nextRequest.currentStatus || ''),
  );
  pushValueChange(changes, 'საბოლოო გადაწყვეტილება', previousRequest.finalDecision, nextRequest.finalDecision);

  return changes.join(' • ') || 'ჩანაწერი განახლდა';
}
