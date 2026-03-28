import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { writeAuditLogEntry } from '../auditLog';
import { resolveUserDisplayName } from '../accessControl';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { findIcdEntryByCode, IcdEntry, preloadIcdEntries, searchIcdEntries } from '../icd10Lookup';
import { getRepresentativeDiagnosisEntry, normalizeIcdCode } from '../icd10Utils';
import { buildRequestChangeSummary, getRequestActionLabel } from '../requestChangeUtils';
import { resolveRequestStatus } from '../requestStatusUtils';
import { lookupPatientFromSheet } from '../sheetLookup';
import { getStudyTypes, sanitizeStudyTypes } from '../studyTypeUtils';
import { syncRequestToSheet } from '../syncRequestToSheet';
import { ClinicalRequest, DiagnosisEntry } from '../types';
import { REQUEST_ACTIONS, CONSENT_STATUSES, DEPARTMENTS, STUDY_TYPE_OPTIONS } from '../constants';
import { ArrowLeft, FileText, Loader2, Plus, Save, Search, Trash2, User } from 'lucide-react';

type DiagnosisFormRow = DiagnosisEntry & {
  id: string;
};

type ActiveIcdField = {
  rowId: string;
  field: 'code' | 'diagnosis';
} | null;

function createDiagnosisRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createDiagnosisRow(overrides: Partial<DiagnosisFormRow> = {}): DiagnosisFormRow {
  return {
    id: createDiagnosisRowId(),
    icdCode: '',
    diagnosis: '',
    isPrimary: false,
    ...overrides,
  };
}

function sanitizeDiagnoses(rows: DiagnosisFormRow[]): DiagnosisEntry[] {
  const sanitizedRows = rows
    .map((row) => ({
      icdCode: row.icdCode.trim(),
      diagnosis: row.diagnosis.trim(),
      isPrimary: Boolean(row.isPrimary),
    }))
    .filter((row) => row.icdCode || row.diagnosis);

  if (sanitizedRows.length === 1) {
    return [
      {
        ...sanitizedRows[0],
        isPrimary: true,
      },
    ];
  }

  return sanitizedRows;
}

function composePatientName(firstName?: string | null, lastName?: string | null) {
  return [String(lastName || '').trim(), String(firstName || '').trim()].filter(Boolean).join(' ').trim();
}

function splitPatientName(patientName: string) {
  const normalizedName = String(patientName || '').replace(/\s+/g, ' ').trim();

  if (!normalizedName) {
    return {
      firstName: '',
      lastName: '',
    };
  }

  const nameParts = normalizedName.split(' ');

  if (nameParts.length === 1) {
    return {
      firstName: '',
      lastName: nameParts[0],
    };
  }

  return {
    firstName: nameParts.slice(1).join(' '),
    lastName: nameParts[0],
  };
}

function buildFormDataFromRequest(request: ClinicalRequest) {
  const diagnoses = (request.diagnoses?.length
    ? request.diagnoses
    : [{
        icdCode: request.icdCode || '',
        diagnosis: request.diagnosis || '',
        isPrimary: true,
      }]
  )
    .filter((entry) => entry.icdCode || entry.diagnosis)
    .map((entry) => createDiagnosisRow({
      icdCode: entry.icdCode || '',
      diagnosis: entry.diagnosis || '',
      isPrimary: Boolean(entry.isPrimary),
    }));

  return {
    patientName: composePatientName(request.patientData.firstName, request.patientData.lastName),
    historyNumber: request.patientData.historyNumber || '',
    personalId: request.patientData.personalId || '',
    birthDate: request.patientData.birthDate || '',
    insurance: request.patientData.insurance || '',
    phone: request.patientData.phone || '',
    address: request.patientData.address || '',
    diagnoses: diagnoses.length ? diagnoses : [createDiagnosisRow({ isPrimary: true })],
    requestedAction: request.requestedAction || REQUEST_ACTIONS[0],
    department: request.department || '',
    studyTypes: getStudyTypes(request),
    consentStatus: request.consentStatus || '',
    doctorComment: request.doctorComment || '',
    senderName: request.formFillerName || request.createdByUserName || '',
  };
}

export default function NewRequestPage() {
  const { id: editRequestId } = useParams();
  const { profile, canCreateRequests, canFullRequestEdit, canEditAllRequests } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [requestLoading, setRequestLoading] = useState(Boolean(editRequestId));
  const [error, setError] = useState('');
  const [lookupMessage, setLookupMessage] = useState('');
  const [patientLookupSource, setPatientLookupSource] = useState<'manual' | 'sheet'>('manual');
  const [existingRequest, setExistingRequest] = useState<ClinicalRequest | null>(null);
  const icdLookupRequestRef = useRef(0);
  const isEditMode = Boolean(editRequestId);
  const requiresStructuredFields = patientLookupSource === 'sheet';
  const automaticSenderName = resolveUserDisplayName(profile?.fullName, profile?.email) || 'ემერჯენსი';
  
  const [deptSearch, setDeptSearch] = useState('');
  const [showDeptList, setShowDeptList] = useState(false);
  const [icdSuggestions, setIcdSuggestions] = useState<IcdEntry[]>([]);
  const [activeIcdField, setActiveIcdField] = useState<ActiveIcdField>(null);
  const [icdLoading, setIcdLoading] = useState(false);
  const [icdMessage, setIcdMessage] = useState('');
  const [studyTypeInput, setStudyTypeInput] = useState('');
  const [selectedStudyOption, setSelectedStudyOption] = useState('');
  
  const [formData, setFormData] = useState({
    patientName: '',
    historyNumber: '',
    personalId: '',
    birthDate: '',
    insurance: '',
    phone: '',
    address: '',
    diagnoses: [createDiagnosisRow({ isPrimary: true })],
    requestedAction: REQUEST_ACTIONS[0],
    department: '',
    studyTypes: [] as string[],
    consentStatus: '',
    doctorComment: '',
    senderName: '',
  });

  const requiresDiagnosisDescription =
    requiresStructuredFields && formData.requestedAction !== 'კვლევა';
  const resolvedSenderName = formData.senderName.trim() || automaticSenderName;
  const hasMultipleDiagnoses = formData.diagnoses.length > 1;
  const hasExplicitPrimaryDiagnosis = formData.diagnoses.some((row) => row.isPrimary);
  const navigateToDashboard = () => navigate('/', { replace: true });
  const canEditCurrentRequest = !isEditMode || (
    canFullRequestEdit &&
    (
      canEditAllRequests ||
      (
        existingRequest &&
        profile &&
        (existingRequest.createdByUserId === profile.uid || existingRequest.createdByUserEmail === profile.email)
      )
    )
  );

  const filteredDepts = DEPARTMENTS.filter(d => 
    d.toLowerCase().includes(deptSearch.toLowerCase())
  );

  const addStudyType = (value: string) => {
    const normalizedValue = sanitizeStudyTypes([value])[0];

    if (!normalizedValue) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      studyTypes: sanitizeStudyTypes([...prev.studyTypes, normalizedValue]),
    }));
  };

  const removeStudyType = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      studyTypes: prev.studyTypes.filter((studyType) => studyType !== value),
    }));
  };

  useEffect(() => {
    void preloadIcdEntries();
  }, []);

  useEffect(() => {
    if (!editRequestId) {
      setRequestLoading(false);
      return;
    }

    const loadRequest = async () => {
      setRequestLoading(true);
      setError('');

      try {
        const requestSnap = await getDoc(doc(db, 'requests', editRequestId));

        if (!requestSnap.exists()) {
          setError('ჩანაწერი ვერ მოიძებნა.');
          setExistingRequest(null);
          return;
        }

        const nextRequest = { id: requestSnap.id, ...requestSnap.data() } as ClinicalRequest;
        setExistingRequest(nextRequest);
        setFormData(buildFormDataFromRequest(nextRequest));
        setDeptSearch(nextRequest.department || '');
        setPatientLookupSource((nextRequest.patientData.firstName || nextRequest.patientData.lastName) ? 'sheet' : 'manual');
      } catch (loadError) {
        console.error('Request edit load error:', loadError);
        setError('ჩანაწერის ჩატვირთვა ვერ მოხერხდა.');
      } finally {
        setRequestLoading(false);
      }
    };

    void loadRequest();
  }, [editRequestId]);

  const runIcdSearch = async (rowId: string, query: string, field: 'code' | 'diagnosis') => {
    const requestId = icdLookupRequestRef.current + 1;
    icdLookupRequestRef.current = requestId;

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setIcdSuggestions([]);
      setActiveIcdField(null);
      setIcdMessage('');

      if (field === 'code') {
        setFormData((prev) => ({
          ...prev,
          diagnoses: prev.diagnoses.map((row) =>
            row.id === rowId
              ? {
                  ...row,
                  diagnosis: '',
                }
              : row,
          ),
        }));
      }

      return;
    }

    setIcdLoading(true);

    try {
      const [exactCodeEntry, suggestions] = await Promise.all([
        field === 'code' ? findIcdEntryByCode(trimmedQuery) : Promise.resolve(null),
        searchIcdEntries(trimmedQuery),
      ]);

      if (icdLookupRequestRef.current !== requestId) {
        return;
      }

      if (field === 'code') {
        const normalizedCode = normalizeIcdCode(trimmedQuery);

        setFormData((prev) =>
          prev.diagnoses.some((row) => row.id === rowId && row.icdCode === normalizedCode)
            ? {
                ...prev,
                diagnoses: prev.diagnoses.map((row) =>
                  row.id === rowId
                    ? {
                        ...row,
                        diagnosis: exactCodeEntry?.name || '',
                      }
                    : row,
                ),
              }
            : prev,
        );

        setIcdMessage(
          exactCodeEntry
            ? 'დიაგნოზი ავტომატურად შეივსო ICD-10 ჩამონათვალიდან.'
            : '',
        );
      } else {
        setIcdMessage('');
      }

      setIcdSuggestions(suggestions);
      setActiveIcdField(suggestions.length ? { rowId, field } : null);
    } catch (lookupError) {
      console.error('ICD lookup error:', lookupError);

      if (icdLookupRequestRef.current === requestId) {
        setIcdSuggestions([]);
        setActiveIcdField(null);
        setIcdMessage('ICD-10 ჩამონათვალის ჩატვირთვა ვერ მოხერხდა.');
      }
    } finally {
      if (icdLookupRequestRef.current === requestId) {
        setIcdLoading(false);
      }
    }
  };

  const handleIcdCodeChange = (rowId: string, nextValue: string) => {
    const normalizedCode = normalizeIcdCode(nextValue);

    setFormData((prev) => ({
      ...prev,
      diagnoses: prev.diagnoses.map((row) =>
        row.id === rowId
          ? {
              ...row,
              icdCode: normalizedCode,
              diagnosis: normalizedCode === row.icdCode ? row.diagnosis : '',
            }
          : row,
      ),
    }));

    void runIcdSearch(rowId, normalizedCode, 'code');
  };

  const handleDiagnosisChange = (rowId: string, nextValue: string) => {
    setFormData((prev) => ({
      ...prev,
      diagnoses: prev.diagnoses.map((row) =>
        row.id === rowId
          ? {
              ...row,
              diagnosis: nextValue,
            }
          : row,
      ),
    }));

    void runIcdSearch(rowId, nextValue, 'diagnosis');
  };

  const handleIcdSuggestionPick = (rowId: string, entry: IcdEntry) => {
    icdLookupRequestRef.current += 1;
    setFormData((prev) => ({
      ...prev,
      diagnoses: prev.diagnoses.map((row) =>
        row.id === rowId
          ? {
              ...row,
              icdCode: entry.code,
              diagnosis: entry.name,
            }
          : row,
      ),
    }));
    setIcdSuggestions([]);
    setActiveIcdField(null);
    setIcdMessage('დიაგნოზი ავტომატურად შეივსო ICD-10 ჩამონათვალიდან.');
  };

  const scheduleIcdDropdownClose = () => {
    window.setTimeout(() => {
      setActiveIcdField(null);
    }, 140);
  };

  const addDiagnosisRow = () => {
    setFormData((prev) => ({
      ...prev,
      diagnoses: [
        ...(prev.diagnoses.length === 1
          ? prev.diagnoses.map((row) => ({
              ...row,
              isPrimary: false,
            }))
          : prev.diagnoses),
        createDiagnosisRow(),
      ],
    }));
  };

  const removeDiagnosisRow = (rowId: string) => {
    setFormData((prev) => {
      const nextDiagnoses = prev.diagnoses.filter((row) => row.id !== rowId);

      if (nextDiagnoses.length === 0) {
        return {
          ...prev,
          diagnoses: [createDiagnosisRow({ isPrimary: true })],
        };
      }

      if (nextDiagnoses.length === 1) {
        return {
          ...prev,
          diagnoses: nextDiagnoses.map((row) => ({
            ...row,
            isPrimary: true,
          })),
        };
      }

      return {
        ...prev,
        diagnoses: nextDiagnoses,
      };
    });
  };

  const togglePrimaryDiagnosis = (rowId: string) => {
    setFormData((prev) => {
      if (prev.diagnoses.length === 1) {
        return prev;
      }

      return {
        ...prev,
        diagnoses: prev.diagnoses.map((row) =>
          row.id === rowId
            ? {
                ...row,
                isPrimary: !row.isPrimary,
              }
            : row,
        ),
      };
    });
  };

  const handleLookup = async () => {
    if (!formData.historyNumber.trim()) {
      setLookupMessage('მიუთითეთ ისტორიის ნომერი.');
      return;
    }
    
    setSearching(true);
    setLookupMessage('');
    try {
      let settings = null;

      if (db) {
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        settings = settingsSnap.exists() ? settingsSnap.data() : null;
      }

      const directPatient = await lookupPatientFromSheet(
        settings,
        formData.historyNumber,
        formData.personalId,
        { forceRefresh: true },
      );

      if (directPatient) {
        setFormData((prev) => ({
          ...prev,
          patientName: composePatientName(directPatient.firstName, directPatient.lastName),
          historyNumber: directPatient.historyNumber,
          personalId: directPatient.personalId,
          birthDate: directPatient.birthDate,
          insurance: directPatient.insurance,
          phone: directPatient.phone,
          address: directPatient.address,
        }));
        setPatientLookupSource('sheet');
        setLookupMessage('პაციენტის ინფორმაცია წარმატებით ჩაიტვირთა.');
        return;
      }

      const lookupApiUrl = resolveServerApiUrl('/api/external/lookup');

      if (!lookupApiUrl) {
        setPatientLookupSource('manual');
        setLookupMessage('პაციენტი ვერ მოიძებნა. შეგიძლიათ ფორმა ხელით შეავსოთ, მაგრამ ისტორიის ნომერი სავალდებულოა.');
        return;
      }

      const response = await fetch(lookupApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          historyNumber: formData.historyNumber,
          personalId: formData.personalId,
          settings
        })
      });

      if (response.ok) {
        const patient = await response.json();
        setFormData((prev) => ({
          ...prev,
          patientName: composePatientName(patient.firstName, patient.lastName),
          historyNumber: patient.historyNumber,
          personalId: patient.personalId,
          birthDate: patient.birthDate,
          insurance: patient.insurance,
          phone: patient.phone,
          address: patient.address,
        }));
        setPatientLookupSource('sheet');
        setLookupMessage('პაციენტის ინფორმაცია წარმატებით ჩაიტვირთა.');
      } else {
        setPatientLookupSource('manual');
        setLookupMessage('პაციენტი ვერ მოიძებნა. შეგიძლიათ ფორმა ხელით შეავსოთ, მაგრამ ისტორიის ნომერი სავალდებულოა.');
      }
    } catch (err) {
      console.error("Lookup error:", err);
      setPatientLookupSource('manual');
      setLookupMessage('პაციენტის მოძებნა ვერ მოხერხდა. შეგიძლიათ ფორმა ხელით შეავსოთ, მაგრამ ისტორიის ნომერი სავალდებულოა.');
    } finally {
      setSearching(false);
    }
  };

  const handleLookupKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();

    if (!searching) {
      void handleLookup();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (!isEditMode && !canCreateRequests) {
      setError('ამ ანგარიშს ახალი მოთხოვნის შექმნის უფლება არ აქვს.');
      return;
    }

    if (isEditMode && !canEditCurrentRequest) {
      setError('ამ ანგარიშს ამ ჩანაწერის სრული რედაქტირების უფლება არ აქვს.');
      return;
    }

    if (!formData.historyNumber.trim()) {
      setError('ისტორიის ნომერი სავალდებულოა.');
      return;
    }

    if (requiresStructuredFields && formData.requestedAction === 'სტაციონარი' && !formData.department.trim()) {
      setError('სტაციონარის მოთხოვნისთვის განყოფილება სავალდებულოა.');
      return;
    }

    const diagnoses = sanitizeDiagnoses(formData.diagnoses);
    const studyTypes = sanitizeStudyTypes(formData.studyTypes);
    const normalizedPatientName = formData.patientName.trim();
    const splitPatientData = splitPatientName(normalizedPatientName);
    const hasPendingStudySelection = formData.requestedAction === 'კვლევა' && (
      selectedStudyOption.trim().length > 0 ||
      studyTypeInput.trim().length > 0
    );

    if (requiresStructuredFields && hasPendingStudySelection) {
      setError('დაამატეთ კვლევა.');
      return;
    }

    if (requiresStructuredFields && formData.requestedAction === 'კვლევა' && studyTypes.length === 0) {
      setError('კვლევის მოთხოვნისთვის მიუთითეთ მინიმუმ ერთი კვლევის ტიპი.');
      return;
    }

    if (requiresDiagnosisDescription) {
      if (diagnoses.length === 0) {
        setError('მიუთითეთ მინიმუმ ერთი დიაგნოზი.');
        return;
      }

      if (diagnoses.some((row) => !row.icdCode)) {
        setError('თითოეულ დიაგნოზზე მიუთითეთ ICD-10 კოდი.');
        return;
      }

      if (diagnoses.some((row) => !row.diagnosis)) {
        setError('ICD-10 კოდის მიხედვით შეავსეთ დიაგნოზის განმარტება.');
        return;
      }
    }
    
    setLoading(true);
    setError('');
    try {
      let settings = null;

      if (db) {
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        settings = settingsSnap.exists() ? settingsSnap.data() : null;
      }

      const representativeDiagnosis = getRepresentativeDiagnosisEntry({ diagnoses });
      const resolvedCurrentStatus = resolveRequestStatus(
        (existingRequest?.currentStatus || 'ახალი') as ClinicalRequest['currentStatus'],
        formData.requestedAction,
        formData.department,
        existingRequest?.finalDecision || '',
      );

      const nextPatientData = {
        firstName: splitPatientData.firstName,
        lastName: splitPatientData.lastName,
        historyNumber: formData.historyNumber,
        personalId: formData.personalId,
        birthDate: formData.birthDate,
        insurance: formData.insurance,
        phone: formData.phone,
        address: formData.address,
      };

      if (isEditMode && existingRequest && editRequestId) {
        const editSummary = buildRequestChangeSummary(existingRequest, {
          patientData: nextPatientData,
          requestedAction: formData.requestedAction,
          department: formData.requestedAction === 'სტაციონარი' ? formData.department : '',
          studyType: studyTypes.join(', '),
          studyTypes,
          consentStatus: formData.consentStatus,
          diagnosis: representativeDiagnosis?.diagnosis || '',
          icdCode: representativeDiagnosis?.code || representativeDiagnosis?.icdCode || '',
          diagnoses,
          doctorComment: formData.doctorComment,
          currentStatus: resolvedCurrentStatus,
          finalDecision: existingRequest.finalDecision || '',
        });

        await updateDoc(doc(db, 'requests', editRequestId), {
          patientData: nextPatientData,
          requestedAction: formData.requestedAction,
          department: formData.requestedAction === 'სტაციონარი' ? formData.department : '',
          studyType: studyTypes.join(', '),
          studyTypes,
          consentStatus: formData.consentStatus,
          diagnosis: representativeDiagnosis?.diagnosis || '',
          icdCode: representativeDiagnosis?.code || representativeDiagnosis?.icdCode || '',
          diagnoses,
          doctorComment: formData.doctorComment,
          formFillerName: resolvedSenderName,
          currentStatus: resolvedCurrentStatus,
          requiresRegistrarAction: true,
          pendingDoctorEdit: {
            comment: editSummary,
            editedAt: Timestamp.now(),
            editedByUserEmail: profile.email,
            editedByUserId: profile.uid,
            editedByUserName: profile.fullName,
          },
          lastDoctorEditAt: Timestamp.now(),
          lastDoctorEditByUserId: profile.uid,
          lastDoctorEditByUserName: profile.fullName,
          lastDoctorEditByUserEmail: profile.email,
          lastDoctorEditComment: editSummary,
          adminConfirmationStatus: null,
          adminConfirmedAt: null,
          adminConfirmedByUserId: '',
          adminConfirmedByUserName: '',
          updatedAt: Timestamp.now(),
        });

        await writeAuditLogEntry({
          userId: profile.uid,
          userName: profile.fullName,
          requestId: editRequestId,
          actionType: 'FULL_EDIT',
          oldValue: `${existingRequest.patientData.firstName} ${existingRequest.patientData.lastName} / ${getRequestActionLabel(existingRequest.requestedAction, existingRequest.department)}`,
          newValue: `${normalizedPatientName} / ${getRequestActionLabel(formData.requestedAction, formData.department)} / ${editSummary}`,
        });
      } else {
        const requestData: Omit<ClinicalRequest, 'id'> = {
          patientData: nextPatientData,
          createdByUserId: profile.uid,
          createdByUserName: resolvedSenderName,
          createdByUserEmail: profile.email,
          formFillerName: resolvedSenderName,
          requestedAction: formData.requestedAction,
          department: formData.requestedAction === 'სტაციონარი' ? formData.department : '',
          studyType: studyTypes.join(', '),
          studyTypes,
          consentStatus: formData.consentStatus,
          diagnosis: representativeDiagnosis?.diagnosis || '',
          icdCode: representativeDiagnosis?.code || representativeDiagnosis?.icdCode || '',
          diagnoses,
          doctorComment: formData.doctorComment,
          currentStatus: resolveRequestStatus('ახალი', formData.requestedAction, formData.department, ''),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, 'requests'), requestData);

        await writeAuditLogEntry({
          userId: profile.uid,
          userName: profile.fullName,
          requestId: docRef.id,
          actionType: 'CREATE',
          newValue: 'ახალი მოთხოვნა შეიქმნა',
        });
      }

      await syncRequestToSheet({
        historyNumber: formData.historyNumber,
        personalId: formData.personalId,
        icdCode: representativeDiagnosis?.code || representativeDiagnosis?.icdCode || '',
        requestedAction: formData.requestedAction,
        department: formData.requestedAction === 'სტაციონარი' ? formData.department : '',
        consentStatus: formData.consentStatus,
        settings,
      });

      navigateToDashboard();
    } catch (err) {
      console.error("Submit error:", err);
      setError(
        getFirebaseActionErrorMessage(err, {
          fallback: isEditMode ? 'ჩანაწერის განახლება ვერ მოხერხდა.' : 'მოთხოვნის გაგზავნა ვერ მოხერხდა.',
          permissionDenied:
            isEditMode
              ? 'ამ ანგარიშით ჩანაწერის რედაქტირება ვერ მოხერხდა, რადგან Firestore-ში write წვდომა არ არის ნებადართული.'
              : 'ამ ანგარიშით მოთხოვნის გაგზავნა ვერ მოხერხდა, რადგან Firestore-ში write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  if (requestLoading) {
    return (
      <div className="w-full max-w-none space-y-6 pb-12">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-400 shadow-sm">
          ჩანაწერი იტვირთება...
        </div>
      </div>
    );
  }

  if (isEditMode && !existingRequest) {
    return (
      <div className="w-full max-w-none space-y-6 pb-12">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-slate-500" />
          </button>
          <h2 className="text-2xl font-bold text-slate-900">მოთხოვნის რედაქტირება</h2>
        </div>

        <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-6 space-y-3">
          <h3 className="text-lg font-bold text-slate-900">ჩანაწერი ვერ მოიძებნა</h3>
          <p className="text-slate-600">
            {error || 'არჩეული მოთხოვნის ჩატვირთვა ვერ მოხერხდა.'}
          </p>
          <button
            type="button"
            onClick={navigateToDashboard}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl font-bold"
          >
            მთავარ გვერდზე დაბრუნება
          </button>
        </div>
      </div>
    );
  }

  if ((!isEditMode && profile && !canCreateRequests) || (isEditMode && profile && !canEditCurrentRequest && existingRequest)) {
    return (
      <div className="w-full max-w-none space-y-6 pb-12">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-slate-500" />
          </button>
          <h2 className="text-2xl font-bold text-slate-900">
            {isEditMode ? 'მოთხოვნის რედაქტირება' : 'ახალი მოთხოვნის შექმნა'}
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-6 space-y-3">
          <h3 className="text-lg font-bold text-slate-900">წვდომა შეზღუდულია</h3>
          <p className="text-slate-600">
            {isEditMode
              ? 'ამ ანგარიშს ამ ჩანაწერის სრული რედაქტირების უფლება არ აქვს.'
              : 'ამ ანგარიშს ახალი მოთხოვნის შექმნის უფლება არ აქვს.'}
          </p>
          <button
            type="button"
            onClick={navigateToDashboard}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl font-bold"
          >
            მთავარ გვერდზე დაბრუნება
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-6 pb-12">
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-slate-500" />
        </button>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
          {isEditMode ? 'მოთხოვნის რედაქტირება' : 'ახალი მოთხოვნის შექმნა'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {(error || lookupMessage) && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${
            error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}>
            {error || lookupMessage}
          </div>
        )}

        {/* Patient Info Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
            <User className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-slate-700">პაციენტის მონაცემები</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">ისტორიის ნომერი</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    required
                    className="flex-1 px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={formData.historyNumber}
                    onChange={(e) => setFormData({ ...formData, historyNumber: e.target.value })}
                    onKeyDown={handleLookupKeyDown}
                  />
                  <button
                    type="button"
                    onClick={handleLookup}
                    disabled={searching}
                    className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-slate-700 transition-colors hover:bg-slate-200 sm:px-4"
                  >
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    ძებნა
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">პირადი ნომერი</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.personalId}
                  onChange={(e) => setFormData({ ...formData, personalId: e.target.value })}
                  onKeyDown={handleLookupKeyDown}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-bold text-slate-700">სახელი და გვარი</label>
                <input
                  type="text"
                  required={requiresStructuredFields}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.patientName}
                  onChange={(e) => setFormData({ ...formData, patientName: e.target.value })}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
              <label className="text-sm font-black text-amber-900">დაზღვევა</label>
              <input
                type="text"
                className="mt-3 w-full rounded-xl border border-amber-300 bg-white px-4 py-2 text-amber-950 outline-none transition focus:ring-2 focus:ring-amber-400"
                value={formData.insurance}
                onChange={(e) => setFormData({ ...formData, insurance: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Clinical Info Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-slate-700">კლინიკური ინფორმაცია</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <label className="text-sm font-bold text-slate-700">დიაგნოზები (ICD-10)</label>
                  <p className="mt-1 text-xs text-slate-500">
                    შეგიძლიათ რამდენიმე დიაგნოზი დაამატოთ. თუ რამდენიმე დიაგნოზზე არცერთი არ მოინიშნა, ყველა წამყვანად ჩაითვლება.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addDiagnosisRow}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white transition hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" />
                  დიაგნოზის დამატება
                </button>
              </div>

              {formData.diagnoses.map((diagnosisRow, index) => {
                const isSingleDiagnosis = formData.diagnoses.length === 1;

                return (
                  <div key={diagnosisRow.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm font-bold text-slate-700">
                        დიაგნოზი #{index + 1}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className={`inline-flex items-center gap-2 text-sm font-bold ${isSingleDiagnosis ? 'text-sky-700' : 'text-slate-600'}`}>
                          <input
                            type="checkbox"
                            checked={isSingleDiagnosis ? true : Boolean(diagnosisRow.isPrimary)}
                            disabled={isSingleDiagnosis}
                            onChange={() => togglePrimaryDiagnosis(diagnosisRow.id)}
                            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          />
                          {isSingleDiagnosis ? 'წამყვანი (ავტომატურად)' : 'წამყვანი'}
                        </label>
                        {formData.diagnoses.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeDiagnosisRow(diagnosisRow.id)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-red-600 transition hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                            წაშლა
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <div className="space-y-2 relative">
                        <label className="text-sm font-bold text-slate-700">ICD-10 კოდი</label>
                        <input
                          type="text"
                          placeholder="მაგ: R10.4"
                          className="w-full rounded-xl border border-slate-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                          value={diagnosisRow.icdCode}
                          onChange={(e) => handleIcdCodeChange(diagnosisRow.id, e.target.value)}
                          onFocus={() => {
                            if (diagnosisRow.icdCode.trim()) {
                              void runIcdSearch(diagnosisRow.id, diagnosisRow.icdCode, 'code');
                            }
                          }}
                          onBlur={scheduleIcdDropdownClose}
                        />
                        {activeIcdField?.rowId === diagnosisRow.id && activeIcdField.field === 'code' && icdSuggestions.length > 0 && (
                          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                            {icdSuggestions.map((entry) => (
                              <button
                                key={`${diagnosisRow.id}-${entry.code}`}
                                type="button"
                                className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => handleIcdSuggestionPick(diagnosisRow.id, entry)}
                              >
                                <span className="min-w-[5rem] text-xs font-black text-emerald-700">{entry.code}</span>
                                <span className="text-sm text-slate-700">{entry.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 relative">
                        <label className="text-sm font-bold text-slate-700">
                          დიაგნოზის განმარტება
                          {formData.requestedAction === 'კვლევა' && (
                            <span className="ml-2 text-xs font-medium text-slate-400">(კვლევის შემთხვევაში არჩევითი)</span>
                          )}
                        </label>
                        <input
                          type="text"
                          placeholder="აირჩიეთ ICD-10 კოდი ან მოძებნეთ დიაგნოზით"
                          className="w-full rounded-xl border border-slate-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                          value={diagnosisRow.diagnosis}
                          onChange={(e) => handleDiagnosisChange(diagnosisRow.id, e.target.value)}
                          onFocus={() => {
                            if (diagnosisRow.diagnosis.trim()) {
                              void runIcdSearch(diagnosisRow.id, diagnosisRow.diagnosis, 'diagnosis');
                            }
                          }}
                          onBlur={scheduleIcdDropdownClose}
                        />
                        {activeIcdField?.rowId === diagnosisRow.id && activeIcdField.field === 'diagnosis' && icdSuggestions.length > 0 && (
                          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                            {icdSuggestions.map((entry) => (
                              <button
                                key={`${diagnosisRow.id}-${entry.code}-diagnosis`}
                                type="button"
                                className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => handleIcdSuggestionPick(diagnosisRow.id, entry)}
                              >
                                <span className="min-w-[5rem] text-xs font-black text-emerald-700">{entry.code}</span>
                                <span className="text-sm text-slate-700">{entry.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {hasMultipleDiagnoses && !hasExplicitPrimaryDiagnosis && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                  ამ ეტაპზე არცერთი დიაგნოზი არ არის ცალკე მონიშნული, ამიტომ ყველა წამყვან დიაგნოზად ჩაითვლება.
                </div>
              )}
            </div>

            {(icdLoading || icdMessage) && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${
                icdMessage.includes('ვერ მოხერხდა')
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}>
                {icdLoading ? 'ICD-10 ჩამონათვალი იტვირთება...' : icdMessage}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">მოთხოვნილი მოქმედება</label>
                <div className="flex flex-wrap gap-2">
                  {REQUEST_ACTIONS.map(action => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => setFormData({ ...formData, requestedAction: action })}
                      className={`px-4 py-2 rounded-xl font-bold transition-all ${
                        formData.requestedAction === action 
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>

              {formData.requestedAction === 'სტაციონარი' && (
                <div className="space-y-2 relative">
                  <label className="text-sm font-bold text-slate-700">განყოფილება</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="მოძებნეთ განყოფილება..."
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={deptSearch || formData.department}
                      onFocus={() => setShowDeptList(true)}
                      onChange={(e) => {
                        setDeptSearch(e.target.value);
                        setShowDeptList(true);
                      }}
                    />
                    {showDeptList && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-auto">
                        {filteredDepts.map(dept => (
                          <button
                            key={dept}
                            type="button"
                            className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm"
                            onClick={() => {
                              setFormData({ ...formData, department: dept });
                              setDeptSearch(dept);
                              setShowDeptList(false);
                            }}
                          >
                            {dept}
                          </button>
                        ))}
                        {filteredDepts.length === 0 && (
                          <div className="px-4 py-2 text-sm text-slate-400">განყოფილება ვერ მოიძებნა</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {formData.requestedAction === 'კვლევა' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">კვლევის ტიპები</label>
                    <p className="text-xs text-slate-500">
                      შეგიძლიათ აირჩიოთ კატეგორიიდან, ხელით ჩაწეროთ და რამდენიმე კვლევა ერთად დაამატოთ.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <select
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                      value={selectedStudyOption}
                      onChange={(e) => setSelectedStudyOption(e.target.value)}
                    >
                      <option value="">აირჩიეთ კვლევის კატეგორიიდან...</option>
                      {STUDY_TYPE_OPTIONS.map((studyTypeOption) => (
                        <option key={studyTypeOption} value={studyTypeOption}>
                          {studyTypeOption}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        addStudyType(selectedStudyOption);
                        setSelectedStudyOption('');
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 font-bold text-slate-700 transition hover:bg-slate-200"
                    >
                      <Plus className="h-4 w-4" />
                      დამატება
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      type="text"
                      placeholder="ხელით ჩაწერეთ კვლევა..."
                      className="w-full rounded-xl border border-slate-200 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                      value={studyTypeInput}
                      onChange={(e) => setStudyTypeInput(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addStudyType(studyTypeInput);
                          setStudyTypeInput('');
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        addStudyType(studyTypeInput);
                        setStudyTypeInput('');
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white transition hover:bg-emerald-700"
                    >
                      <Plus className="h-4 w-4" />
                      ხელით დამატება
                    </button>
                  </div>

                  {formData.studyTypes.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {formData.studyTypes.map((studyType) => (
                        <span
                          key={studyType}
                          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700"
                        >
                          {studyType}
                          <button
                            type="button"
                            onClick={() => removeStudyType(studyType)}
                            className="text-emerald-700 transition hover:text-emerald-900"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400">
                      კვლევა ჯერ დამატებული არ არის.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-sm font-bold text-slate-700">
                  პაციენტის თანხმობა / უარი
                  <span className="ml-2 text-xs font-medium text-slate-400">(არასავალდებულო)</span>
                </label>
                {formData.consentStatus && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, consentStatus: '' })}
                    className="text-sm font-bold text-slate-500 hover:text-slate-700"
                  >
                    მონიშვნის გასუფთავება
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">
                მიუთითეთ მხოლოდ საჭიროების შემთხვევაში, ძირითადად უარის შემთხვევებში.
              </p>
              <div className="flex flex-wrap gap-3">
                {CONSENT_STATUSES.map(status => (
                  <label 
                    key={status} 
                    className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl border transition-all ${
                      formData.consentStatus === status
                      ? (status.startsWith('უარი') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700')
                      : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="consent"
                      className="hidden"
                      checked={formData.consentStatus === status}
                      onChange={() => setFormData({ ...formData, consentStatus: status })}
                    />
                    <span className={`text-sm font-bold ${formData.consentStatus === status ? '' : 'text-slate-600'}`}>
                      {status}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">ექიმის/ექთნის კომენტარი</label>
              <textarea
                rows={3}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                value={formData.doctorComment}
                onChange={(e) => setFormData({ ...formData, doctorComment: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                გამომგზავნის სახელი
                <span className="ml-2 text-xs font-medium text-slate-400">(არასავალდებულო)</span>
              </label>
              <input
                type="text"
                placeholder={`ავტომატურად: ${automaticSenderName}`}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                value={formData.senderName}
                onChange={(e) => setFormData({ ...formData, senderName: e.target.value })}
              />
              <p className="text-xs text-slate-400">
                თუ ხელით არ ჩაწერთ, დარჩება მიმდინარე ავტომატური გამომგზავნი.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-full rounded-xl px-6 py-3 font-bold text-slate-600 transition-colors hover:bg-slate-100 sm:w-auto"
          >
            გაუქმება
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-8 py-3 font-bold text-white transition-all shadow-lg shadow-emerald-100 hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {isEditMode ? 'ცვლილებების შენახვა' : 'მოთხოვნის გაგზავნა'}
          </button>
        </div>
      </form>
    </div>
  );
}
