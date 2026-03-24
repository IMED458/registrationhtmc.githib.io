import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';
import { Archive, CalendarDays, Clock3, Search } from 'lucide-react';
import { db } from '../firebase';
import { ClinicalRequest } from '../types';
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
  const [archivedRequests, setArchivedRequests] = useState<ClinicalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

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

  const filteredRequests = archivedRequests.filter((request) => {
    if (!normalizedSearch) {
      return true;
    }

    return (
      request.patientData.firstName.toLowerCase().includes(normalizedSearch) ||
      request.patientData.lastName.toLowerCase().includes(normalizedSearch) ||
      request.patientData.historyNumber.toLowerCase().includes(normalizedSearch) ||
      request.patientData.personalId.toLowerCase().includes(normalizedSearch) ||
      request.currentStatus.toLowerCase().includes(normalizedSearch) ||
      (request.finalDecision || '').toLowerCase().includes(normalizedSearch) ||
      getDiagnosisSearchText(request).toLowerCase().includes(normalizedSearch) ||
      getStudyTypeSummary(request).toLowerCase().includes(normalizedSearch)
    );
  });

  const groupedRequests = filteredRequests.reduce<Record<string, ClinicalRequest[]>>((groups, request) => {
    const groupKey = getArchiveGroupKey(request) || 'unknown';

    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }

    groups[groupKey].push(request);
    return groups;
  }, {});

  const sortedGroupKeys = Object.keys(groupedRequests).sort((left, right) => right.localeCompare(left));

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
            placeholder="ძებნა არქივში"
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

            return (
              <section key={groupKey} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-100/80 px-4 py-3">
                  <div className="flex items-center gap-2 text-slate-700">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    <span className="font-black">
                      {Number.isNaN(groupDate.getTime()) ? 'თარიღი უცნობია' : formatArchiveDateLabel(groupDate)}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-500">
                    {requests.length} ჩანაწერი
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {requests.map((request) => {
                    const archivedAtMillis = getArchivedAtMillis(request);
                    const deleteAtMillis = archivedAtMillis + ARCHIVE_RETENTION_MS;

                    return (
                      <article
                        key={request.id}
                        className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-2">
                            <div>
                              <div className="text-lg font-black text-slate-900">
                                {request.patientData.firstName} {request.patientData.lastName}
                              </div>
                              <div className="mt-1 text-xs font-bold text-slate-400">
                                {request.patientData.historyNumber || '-'} / {request.patientData.personalId || '-'}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                                {request.currentStatus}
                              </span>
                              {request.finalDecision && (
                                <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                                  {request.finalDecision}
                                </span>
                              )}
                            </div>
                          </div>

                          <Link
                            to={`/request/${request.id}`}
                            className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            დეტალები
                          </Link>
                        </div>

                        <div className="mt-5 grid grid-cols-1 gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">მოთხოვნა</div>
                            <div className="mt-1 text-sm font-bold text-slate-700">{request.requestedAction || '-'}</div>
                            {getStudyTypeSummary(request) && (
                              <div className="mt-1 text-xs font-bold text-emerald-600">{getStudyTypeSummary(request)}</div>
                            )}
                          </div>

                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">დიაგნოზი</div>
                            <div className="mt-1 text-sm text-slate-700">{getDiagnosisSearchText(request) || '-'}</div>
                          </div>

                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">არქივში გადასვლის დრო</div>
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
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
