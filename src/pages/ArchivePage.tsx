import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';
import { Archive, CalendarDays, ChevronDown, ChevronRight, Clock3, Pencil, Search, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { writeAuditLogEntry } from '../auditLog';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { ClinicalRequest } from '../types';
import { normalizeRequestStatus } from '../requestStatusUtils';
import {
  ARCHIVE_RETENTION_MS,
  getArchiveGroupKey,
  getArchivedAtMillis,
  isArchivedRequest,
} from '../archiveUtils';
import { getDiagnosisSearchText } from '../icd10Utils';
import { getStudyTypeSummary } from '../studyTypeUtils';

function formatArchiveDateLabel(dateValue: Date) {
  return format(dateValue, 'dd MMMM yyyy', { locale: ka });
}

function formatDateTimeLabel(timestamp: number) {
  return format(new Date(timestamp), 'dd.MM.yyyy HH:mm', { locale: ka });
}

function sortArchivedRequests(requests: ClinicalRequest[]) {
  return [...requests].sort(
    (left, right) => getArchivedAtMillis(right) - getArchivedAtMillis(left),
  );
}

export default function ArchivePage() {
  const { profile, isAdmin, isDoctorOrNurse } = useAuth();
  const navigate = useNavigate();
  const [archivedRequests, setArchivedRequests] = useState<ClinicalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingRequestId, setDeletingRequestId] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
        const now = Date.now();
        const nextArchivedRequests = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest))
          .filter((request) => isArchivedRequest(request, now));

        setArchivedRequests(sortArchivedRequests(nextArchivedRequests));
        setLoading(false);
      },
      (error) => {
        console.error('Archive sync error:', error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const canEditRequest = (request: ClinicalRequest) => {
    if (isAdmin) {
      return true;
    }

    if (!isDoctorOrNurse || !profile) {
      return false;
    }

    return request.createdByUserId === profile.uid || request.createdByUserEmail === profile.email;
  };

  const handleEditRequest = (requestId: string) => {
    navigate(`/request/${requestId}`, { state: { startEditing: true } });
  };

  const handleDeleteRequest = async (request: ClinicalRequest) => {
    if (!isAdmin || !profile || deletingRequestId) {
      return;
    }

    const confirmed = window.confirm(
      `ნამდვილად გსურთ არქივიდან "${request.patientData.firstName} ${request.patientData.lastName}" ჩანაწერის წაშლა?`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingRequestId(request.id);

    try {
      await deleteDoc(doc(db, 'requests', request.id));

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: request.id,
        actionType: 'DELETE',
        oldValue: `არქივი / ${normalizeRequestStatus(request.currentStatus)}${request.finalDecision ? ` / ${request.finalDecision}` : ''}`,
        newValue: `არქივიდან წაიშალა მოთხოვნა: ${request.patientData.firstName} ${request.patientData.lastName}`,
      });
    } catch (error) {
      console.error('Archive delete error:', error);
      alert(
        getFirebaseActionErrorMessage(error, {
          fallback: 'არქივიდან ჩანაწერის წაშლა ვერ მოხერხდა.',
          permissionDenied:
            'არქივიდან წაშლა ვერ მოხერხდა, რადგან ამ ანგარიშისთვის delete წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setDeletingRequestId('');
    }
  };

  const filteredRequests = archivedRequests.filter((request) => {
    if (!normalizedSearch) {
      return true;
    }

    return (
      (request.patientData.firstName || '').toLowerCase().includes(normalizedSearch) ||
      (request.patientData.lastName || '').toLowerCase().includes(normalizedSearch) ||
      (request.patientData.historyNumber || '').toLowerCase().includes(normalizedSearch) ||
      (request.patientData.personalId || '').toLowerCase().includes(normalizedSearch) ||
      (request.patientData.insurance || '').toLowerCase().includes(normalizedSearch) ||
      normalizeRequestStatus(request.currentStatus).toLowerCase().includes(normalizedSearch) ||
      (request.finalDecision || '').toLowerCase().includes(normalizedSearch) ||
      getDiagnosisSearchText(request).toLowerCase().includes(normalizedSearch) ||
      getStudyTypeSummary(request).toLowerCase().includes(normalizedSearch)
    );
  });

  const groupedRequests = useMemo(
    () => filteredRequests.reduce<Record<string, ClinicalRequest[]>>((groups, request) => {
      const groupKey = getArchiveGroupKey(request) || 'unknown';

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }

      groups[groupKey].push(request);
      return groups;
    }, {}),
    [filteredRequests],
  );

  const sortedGroupKeys = useMemo(
    () => Object.keys(groupedRequests).sort((left, right) => right.localeCompare(left)),
    [groupedRequests],
  );

  useEffect(() => {
    if (!sortedGroupKeys.length) {
      return;
    }

    setExpandedGroups((current) => {
      const nextState: Record<string, boolean> = {};

      sortedGroupKeys.forEach((groupKey, index) => {
        nextState[groupKey] = current[groupKey] ?? index === 0;
      });

      return nextState;
    });
  }, [sortedGroupKeys]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  return (
    <div className="w-full space-y-6 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-500">
            <Archive className="h-3.5 w-3.5" />
            არქივი
          </div>
          <h2 className="mt-3 text-2xl font-bold text-slate-900">არქივირებული პაციენტები</h2>
          <p className="mt-1 text-slate-500">
            ჩანაწერი მთავარ პანელიდან 24 საათის შემდეგ გადადის არქივში და 30 დღის შემდეგ ავტომატურად იშლება.
          </p>
        </div>

        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="ძებნა: სახელი, გვარი, ისტორიის ნომერი, დიაგნოზი"
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-400 shadow-sm">
          არქივი იტვირთება...
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-400 shadow-sm">
          არქივში ჩანაწერები ჯერ არ არის
        </div>
      ) : (
        <div className="space-y-6">
          {sortedGroupKeys.map((groupKey) => {
            const groupDate = new Date(groupKey);
            const requests = sortArchivedRequests(groupedRequests[groupKey]);
            const isExpanded = expandedGroups[groupKey] ?? false;

            return (
              <section key={groupKey} className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupKey)}
                    className="flex w-full items-center justify-between gap-3 bg-slate-100/80 px-4 py-4 text-left transition hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-3 text-slate-700">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-slate-500" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-slate-500" />
                      )}
                      <CalendarDays className="h-4 w-4 text-slate-500" />
                      <span className="font-black">
                        {Number.isNaN(groupDate.getTime()) ? 'თარიღი უცნობია' : formatArchiveDateLabel(groupDate)}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-500">
                      {requests.length} ჩანაწერი
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="divide-y divide-slate-100">
                      {requests.map((request) => {
                        const archivedAtMillis = getArchivedAtMillis(request);
                        const deleteAtMillis = archivedAtMillis + ARCHIVE_RETENTION_MS;

                        return (
                          <article
                            key={request.id}
                            className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]"
                          >
                            <div className="min-w-0 space-y-2">
                              <div>
                                <div className="text-base font-black text-slate-900">
                                  {request.patientData.lastName} {request.patientData.firstName}
                                </div>
                                <div className="mt-1 text-xs font-bold text-slate-400">
                                  {request.patientData.historyNumber || '-'} / {request.patientData.personalId || '-'}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                                  {normalizeRequestStatus(request.currentStatus)}
                                </span>
                                {request.finalDecision && (
                                  <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                                    {request.finalDecision}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="min-w-0 space-y-3">
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">დაზღვევა</div>
                                <div className="mt-1 text-sm font-bold text-slate-700">
                                  {request.patientData.insurance || '-'}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">დიაგნოზი</div>
                                <div className="mt-1 text-sm leading-6 text-slate-700">
                                  {getDiagnosisSearchText(request) || '-'}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">არქივში გადასვლა</div>
                                <div className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                                  <Clock3 className="h-4 w-4 text-slate-400" />
                                  {archivedAtMillis ? formatDateTimeLabel(archivedAtMillis) : '-'}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">ავტომატური წაშლა</div>
                                <div className="mt-1 text-sm text-slate-700">
                                  {archivedAtMillis ? formatDateTimeLabel(deleteAtMillis) : '-'}
                                </div>
                              </div>
                            </div>

                            <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:min-w-[180px]">
                              <Link
                                to={`/request/${request.id}`}
                                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                              >
                                დეტალები
                              </Link>
                              {canEditRequest(request) && (
                                <button
                                  type="button"
                                  onClick={() => handleEditRequest(request.id)}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-700 transition hover:bg-sky-100"
                                >
                                  <Pencil className="h-4 w-4" />
                                  რედაქტირება
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRequest(request)}
                                  disabled={deletingRequestId === request.id}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {deletingRequestId === request.id ? 'იშლება...' : 'წაშლა'}
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
