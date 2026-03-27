import { useEffect, useState } from 'react';
import { Timestamp, collection, deleteDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { resolveUserDisplayName } from '../accessControl';
import { writeAuditLogEntry } from '../auditLog';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { getFinalDecisionTextClass } from '../finalDecisionStyles';
import { getDiagnosisEntries, getDiagnosisSearchText, normalizeIcdCode } from '../icd10Utils';
import { normalizeRequestStatus, resolveRequestStatusFromRequest } from '../requestStatusUtils';
import { getStudyTypeSummary } from '../studyTypeUtils';
import { isArchivedRequest } from '../archiveUtils';
import { ClinicalRequest, RequestStatus } from '../types';
import { REQUEST_STATUSES } from '../constants';
import { CheckCircle2, Clock, Filter, Loader2, MoreHorizontal, Plus, Printer, Search, Trash2, XCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function getRequestTimestampValue(request: ClinicalRequest) {
  if (request.createdAt?.toMillis) {
    return request.createdAt.toMillis();
  }

  if (request.createdAt?.seconds) {
    return request.createdAt.seconds * 1000;
  }

  return 0;
}

function getBaseRequestActionLabel(request: ClinicalRequest) {
  if (request.requestedAction === 'სტაციონარი' && request.department?.trim()) {
    return request.department.trim();
  }

  return request.requestedAction;
}

function getRequestActionBadges(request: ClinicalRequest) {
  const baseLabel = getBaseRequestActionLabel(request);
  const consentLabel = request.consentStatus?.trim() || '';

  if (request.requestedAction === 'ბინა') {
    const badges = [
      {
        label: baseLabel,
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      },
    ];

    if (consentLabel.startsWith('უარი')) {
      badges.push({
        label: consentLabel,
        className: 'border-red-200 bg-red-50 text-red-600',
      });
    }

    return badges;
  }

  if (consentLabel.startsWith('უარი')) {
    return [
      {
        label: consentLabel,
        className: 'border-red-200 bg-red-50 text-red-600',
      },
    ];
  }

  switch (request.requestedAction) {
    case 'ბინა':
      return [
        {
          label: baseLabel,
          className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        },
      ];
    case 'სტაციონარი':
      return [
        {
          label: baseLabel,
          className: 'border-violet-200 bg-violet-50 text-violet-700',
        },
      ];
    case 'კვლევა':
      return [
        {
          label: baseLabel,
          className: 'border-sky-200 bg-sky-50 text-sky-700',
        },
      ];
    default:
      return [
        {
          label: baseLabel,
          className: 'border-slate-200 bg-slate-50 text-slate-700',
        },
      ];
  }
}

function getCreatedAtLabel(request: ClinicalRequest) {
  return request.createdAt?.toDate
    ? format(request.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka })
    : '-';
}

function getRequestSenderLabel(request: ClinicalRequest) {
  return resolveUserDisplayName(request.createdByUserName, request.createdByUserEmail) || '-';
}

function hasDoctorEditPendingApproval(request: ClinicalRequest) {
  return Boolean(request.pendingDoctorEdit && request.adminConfirmationStatus === 'pending');
}

function needsRegistrarRework(request: ClinicalRequest) {
  return Boolean(request.requiresRegistrarAction && request.pendingDoctorEdit);
}

const REGISTRAR_COMPLETION_FINAL_DECISIONS = new Set([
  'პაციენტი გაუშვით ბინაზე',
  'პაციენტი დაწვეს კლინიკაში / სტაციონარში',
]);

function canRegistrarCompleteRequest(request: ClinicalRequest) {
  return REGISTRAR_COMPLETION_FINAL_DECISIONS.has((request.finalDecision || '').trim());
}

function getPatientNameTextClass(request: ClinicalRequest) {
  return needsRegistrarRework(request) || hasDoctorEditPendingApproval(request)
    ? 'text-sky-600'
    : 'text-slate-900';
}

function sortRequestsByCreatedAt(requests: ClinicalRequest[]) {
  return [...requests].sort(
    (left, right) => {
      const priorityDiff =
        Number(needsRegistrarRework(right)) - Number(needsRegistrarRework(left));

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return getRequestTimestampValue(right) - getRequestTimestampValue(left);
    },
  );
}

function DiagnosisList({ request }: { request: ClinicalRequest }) {
  const diagnoses = getDiagnosisEntries(request);

  if (!diagnoses.length) {
    return <span className="text-sm text-slate-400">-</span>;
  }

  return (
    <div className="space-y-2">
      {diagnoses.map((diagnosisEntry, index) => (
        <div key={`${diagnosisEntry.code || diagnosisEntry.description || 'diagnosis'}-${index}`} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm font-black text-slate-900">
              {diagnosisEntry.code || diagnosisEntry.combined}
            </span>
            {diagnosisEntry.isPrimary && (
              <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700">
                წამყვანი
              </span>
            )}
          </div>
          {diagnosisEntry.description && (
            <div className="text-sm leading-5 text-slate-600">
              {diagnosisEntry.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { profile, isAdmin, canCreateRequests, isRegistrar } = useAuth();
  const [requests, setRequests] = useState<ClinicalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestsError, setRequestsError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ყველა');
  const [deletingRequestId, setDeletingRequestId] = useState('');
  const [completingRequestId, setCompletingRequestId] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const navigate = useNavigate();
  const getDisplayStatus = (request: ClinicalRequest) => resolveRequestStatusFromRequest(request);

  useEffect(() => {
    if (!profile) {
      return;
    }

    setLoading(true);
    setRequestsError('');

    const unsubscribe = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
        const docs = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest))
          .filter((request) => !isArchivedRequest(request));
        setRequests(sortRequestsByCreatedAt(docs));
        setRequestsError('');
        setLoading(false);
      },
      (error) => {
        console.error('Firestore Error:', error);
        setRequestsError(
          getFirebaseActionErrorMessage(error, {
            fallback: 'შემოსული მოთხოვნების ჩატვირთვა ვერ მოხერხდა.',
            permissionDenied:
              'რეგისტრატურის პანელში მოთხოვნების წაკითხვა ვერ მოხერხდა. გადაამოწმეთ Firestore Rules.',
          }),
        );
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [profile]);

  const filteredRequests = requests.filter(req => {
    const diagnosisSearchText = getDiagnosisSearchText(req).toLowerCase();
    const studyTypeSearchText = getStudyTypeSummary(req).toLowerCase();
    const normalizedIcdSearch = normalizeIcdCode(searchTerm);
    const normalizedRequestCode = normalizeIcdCode(diagnosisSearchText);
    const matchesSearch = 
      req.patientData.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.patientData.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.patientData.historyNumber.includes(searchTerm) ||
      req.patientData.personalId.includes(searchTerm) ||
      diagnosisSearchText.includes(searchTerm.toLowerCase()) ||
      studyTypeSearchText.includes(searchTerm.toLowerCase()) ||
      (normalizedIcdSearch ? normalizedRequestCode.includes(normalizedIcdSearch) : false) ||
      getRequestActionBadges(req)
        .map((badge) => badge.label.toLowerCase())
        .join(' ')
        .includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'ყველა' || getDisplayStatus(req) === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: RequestStatus) => {
    switch (normalizeRequestStatus(status)) {
      case 'ახალი': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'განხილვაშია': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'მიღებულია': return 'bg-cyan-100 text-cyan-700 border-cyan-200';
      case 'დადასტურებულია': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'დასრულებულია': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'უარყოფილია': return 'bg-red-100 text-red-700 border-red-200';
      case 'თანხმდება დაზღვევასთან': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusIcon = (status: RequestStatus) => {
    switch (normalizeRequestStatus(status)) {
      case 'ახალი': return <Clock className="w-4 h-4" />;
      case 'განხილვაშია': return <MoreHorizontal className="w-4 h-4" />;
      case 'მიღებულია': return <CheckCircle2 className="w-4 h-4" />;
      case 'დადასტურებულია': return <CheckCircle2 className="w-4 h-4" />;
      case 'დასრულებულია': return <CheckCircle2 className="w-4 h-4" />;
      case 'უარყოფილია': return <XCircle className="w-4 h-4" />;
      case 'თანხმდება დაზღვევასთან': return <XCircle className="w-4 h-4" />;
      default: return null;
    }
  };

  const handleDeleteRequest = async (request: ClinicalRequest) => {
    if (!isAdmin || !profile || !db || deletingRequestId) {
      return;
    }

    const confirmed = window.confirm(
      `ნამდვილად გსურთ "${request.patientData.firstName} ${request.patientData.lastName}" ჩანაწერის წაშლა მთავარი პანელიდან?`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingRequestId(request.id);
    setFeedbackMessage('');

    try {
      await deleteDoc(doc(db, 'requests', request.id));

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: request.id,
        actionType: 'DELETE',
        oldValue: `${request.currentStatus}${request.finalDecision ? ` / ${request.finalDecision}` : ''}`,
        newValue: `წაიშალა მოთხოვნა: ${request.patientData.firstName} ${request.patientData.lastName}`,
      });

      setFeedbackMessage('ჩანაწერი წარმატებით წაიშალა.');
    } catch (error) {
      console.error('Delete request error:', error);
      alert(
        getFirebaseActionErrorMessage(error, {
          fallback: 'ჩანაწერის წაშლა ვერ მოხერხდა.',
          permissionDenied:
            'წაშლა ვერ მოხერხდა, რადგან ამ ანგარიშისთვის delete წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setDeletingRequestId('');
    }
  };

  const handleMarkRequestCompleted = async (request: ClinicalRequest) => {
    if (!isRegistrar || !profile || !db || completingRequestId || getDisplayStatus(request) === 'დასრულებულია') {
      return;
    }

    if (!canRegistrarCompleteRequest(request)) {
      return;
    }

    setCompletingRequestId(request.id);
    setFeedbackMessage('');

    try {
      await updateDoc(doc(db, 'requests', request.id), {
        currentStatus: 'დასრულებულია',
        updatedAt: Timestamp.now(),
      });

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: request.id,
        actionType: 'MARK_COMPLETED',
        oldValue: `${request.currentStatus}${request.finalDecision ? ` / ${request.finalDecision}` : ''}`,
        newValue: `დასრულებულია${request.finalDecision ? ` / ${request.finalDecision}` : ''}`,
      });

      setFeedbackMessage('ჩანაწერი წარმატებით გადავიდა დასრულებულში.');
    } catch (error) {
      console.error('Complete request error:', error);
      alert(
        getFirebaseActionErrorMessage(error, {
          fallback: 'ჩანაწერის დასრულება ვერ მოხერხდა.',
          permissionDenied:
            'დასრულებულში გადატანა ვერ მოხერხდა, რადგან ამ ანგარიშისთვის write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setCompletingRequestId('');
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">შემოსული მოთხოვნები</h2>
          <p className="text-slate-500">პაციენტების გადამისამართების მართვა</p>
        </div>
        
        {canCreateRequests && (
          <Link
            to="/new-request"
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-lg shadow-emerald-100"
          >
            <Plus className="w-5 h-5" />
            ახალი მოთხოვნა
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="ძებნა (სახელი, გვარი, ისტორია...)"
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <select
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none appearance-none bg-white transition-all"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ყველა">ყველა სტატუსი</option>
            {REQUEST_STATUSES.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
      </div>

      {feedbackMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {feedbackMessage}
        </div>
      )}

      {requestsError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {requestsError}
        </div>
      )}

      <div className="space-y-4 md:hidden">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-400 shadow-sm">
            იტვირთება მონაცემები...
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-400 shadow-sm">
            ჩანაწერები არ მოიძებნა
          </div>
        ) : (
          filteredRequests.map((req) => {
            const displayStatus = getDisplayStatus(req);

            return (
            <div
              key={req.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`text-base font-bold ${getPatientNameTextClass(req)}`}>
                    {req.patientData.firstName} {req.patientData.lastName}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {req.patientData.historyNumber} / {req.patientData.personalId}
                  </div>
                  {needsRegistrarRework(req) && (
                    <div className="mt-1 text-xs font-bold text-sky-600">
                      ჩანაწერი შეიცვალა და ელოდება ახლიდან მოქმედებას
                    </div>
                  )}
                </div>
                <span className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
                  getStatusColor(displayStatus)
                )}>
                  {getStatusIcon(displayStatus)}
                  {displayStatus}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">დიაგნოზი</div>
                  <div className="mt-1">
                    <DiagnosisList request={req} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">მოთხოვნა</div>
                  <div className="mt-2">
                    {getRequestActionBadges(req).map((badge) => (
                      <span
                        key={`${req.id}-${badge.label}`}
                        className={cn(
                          'inline-flex rounded-xl border px-3 py-1.5 text-sm font-black',
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                  {getStudyTypeSummary(req) && (
                    <div className="mt-1 text-xs font-bold text-emerald-600">{getStudyTypeSummary(req)}</div>
                  )}
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">გამომგზავნი</div>
                  <div className="mt-1 text-sm text-slate-700">{getRequestSenderLabel(req)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">თარიღი</div>
                  <div className="mt-1 text-sm text-slate-700">{getCreatedAtLabel(req)}</div>
                </div>
                {req.finalDecision && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">საბოლოო გადაწყვეტილება</div>
                    <div className={`mt-1 text-sm font-bold leading-5 ${getFinalDecisionTextClass(req.finalDecision)}`}>
                      {req.finalDecision}
                    </div>
                  </div>
                )}
                {needsRegistrarRework(req) && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-sky-600">ახალი ცვლილება</div>
                    <div className="mt-1 text-sm font-bold text-sky-600">
                      ჩანაწერი შეიცვალა და რეგისტრატორის მოქმედებას ელოდება
                    </div>
                  </div>
                )}
              </div>

              <div className={`mt-4 grid gap-3 ${isAdmin ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <button
                  onClick={() => navigate(`/request/${req.id}`)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  დეტალები
                </button>
                <button
                  onClick={() => navigate(`/print/${req.id}`)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
                >
                  <Printer className="h-4 w-4" />
                  ბეჭდვა
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteRequest(req)}
                    disabled={deletingRequestId === req.id}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    {deletingRequestId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    წაშლა
                  </button>
                )}
              </div>
              {isRegistrar && canRegistrarCompleteRequest(req) && (
                <label
                  className="mt-3 inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700"
                  title={displayStatus === 'დასრულებულია' ? 'დასრულებულია' : 'დასრულებულად მონიშვნა'}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    checked={displayStatus === 'დასრულებულია'}
                    disabled={displayStatus === 'დასრულებულია' || completingRequestId === req.id}
                    onChange={() => handleMarkRequestCompleted(req)}
                    aria-label={displayStatus === 'დასრულებულია' ? 'დასრულებულია' : 'დასრულებულად მონიშვნა'}
                  />
                  {completingRequestId === req.id && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />}
                </label>
              )}
            </div>
          )})
        )}
      </div>

      {/* Table */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">პაციენტი</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">დიაგნოზი (ICD-10)</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ისტორია / პირადი №</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">მოთხოვნა</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">გამომგზავნი</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">სტატუსი / საბოლოო გადაწყვეტილება</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">თარიღი</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">მოქმედება</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                    იტვირთება მონაცემები...
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                    ჩანაწერები არ მოიძებნა
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => {
                  const displayStatus = getDisplayStatus(req);

                  return (
                  <tr key={req.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className={`font-bold ${getPatientNameTextClass(req)}`}>{req.patientData.firstName} {req.patientData.lastName}</div>
                      {needsRegistrarRework(req) && (
                        <div className="mt-1 text-xs font-bold text-sky-600">
                          ჩანაწერი შეიცვალა და ელოდება ახლიდან მოქმედებას
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-w-xs">
                        <DiagnosisList request={req} />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-700">{req.patientData.historyNumber}</div>
                      <div className="text-xs text-slate-400">{req.patientData.personalId}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {getRequestActionBadges(req).map((badge) => (
                          <span
                            key={`${req.id}-${badge.label}`}
                            className={cn(
                              'inline-flex rounded-xl border px-3 py-1.5 text-sm font-black',
                              badge.className,
                            )}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                      {getStudyTypeSummary(req) && <div className="text-xs text-emerald-600 font-bold">{getStudyTypeSummary(req)}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600">{getRequestSenderLabel(req)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border",
                          getStatusColor(displayStatus)
                        )}>
                          {getStatusIcon(displayStatus)}
                          {displayStatus}
                        </span>
                        {req.finalDecision && (
                          <div className={`max-w-xs text-sm font-medium leading-5 whitespace-normal ${getFinalDecisionTextClass(req.finalDecision)}`}>
                            {req.finalDecision}
                          </div>
                        )}
                        {needsRegistrarRework(req) && (
                          <div className="max-w-xs text-sm font-bold leading-5 whitespace-normal text-sky-600">
                            ცვლილება რეგისტრატორის ხელახლა მოქმედებას ელოდება
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600">
                        {getCreatedAtLabel(req)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end gap-3">
                        {isRegistrar && canRegistrarCompleteRequest(req) && (
                          <label
                            className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
                            title={displayStatus === 'დასრულებულია' ? 'დასრულებულია' : 'დასრულებულად მონიშვნა'}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              checked={displayStatus === 'დასრულებულია'}
                              disabled={displayStatus === 'დასრულებულია' || completingRequestId === req.id}
                              onChange={() => handleMarkRequestCompleted(req)}
                              aria-label={displayStatus === 'დასრულებულია' ? 'დასრულებულია' : 'დასრულებულად მონიშვნა'}
                            />
                            {completingRequestId === req.id && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />}
                          </label>
                        )}
                        <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => navigate(`/request/${req.id}`)}
                          className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                          title="დეტალები"
                        >
                          <MoreHorizontal className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => navigate(`/print/${req.id}`)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title="ბეჭდვა"
                        >
                          <Printer className="w-5 h-5" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteRequest(req)}
                            disabled={deletingRequestId === req.id}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50"
                            title="წაშლა"
                          >
                            {deletingRequestId === req.id ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                              <Trash2 className="w-5 h-5" />
                            )}
                          </button>
                        )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
