import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, Timestamp, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { normalizeRequestStatus } from '../requestStatusUtils';
import { writeAuditLogEntry } from '../auditLog';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { isArchivedRequest } from '../archiveUtils';
import { ClinicalRequest } from '../types';
import { CheckCircle2, Loader2, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';

export default function AdminRequestsPage() {
  const { canAccessAdminPanel, canApproveAdminChanges, profile } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ClinicalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingRequestId, setConfirmingRequestId] = useState('');

  useEffect(() => {
    if (!canAccessAdminPanel) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      query(collection(db, 'requests'), orderBy('updatedAt', 'desc'), limit(100)),
      (snapshot) => {
        const nextRequests = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest))
          .filter((request) => (
            !isArchivedRequest(request) &&
            request.adminConfirmationStatus === 'pending' &&
            (request.pendingRegistrarUpdate || request.pendingDoctorEdit)
          ));

        setRequests(nextRequests);
        setLoading(false);
      },
      (error) => {
        console.error('Admin requests sync error:', error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [canAccessAdminPanel]);

  const handleConfirmRequest = async (request: ClinicalRequest) => {
    if (!profile || confirmingRequestId || !canApproveAdminChanges) {
      return;
    }

    const confirmed = window.confirm(
      `"${request.patientData.firstName} ${request.patientData.lastName}" ჩანაწერის რედაქტირება დადასტურდეს?`,
    );

    if (!confirmed) {
      return;
    }

    setConfirmingRequestId(request.id);

    try {
      await updateDoc(doc(db, 'requests', request.id), {
        adminConfirmationStatus: 'confirmed',
        adminConfirmedAt: Timestamp.now(),
        adminConfirmedByUserId: profile.uid,
        adminConfirmedByUserName: profile.fullName,
        pendingRegistrarUpdate: null,
        pendingDoctorEdit: null,
        requiresRegistrarAction: false,
        updatedAt: Timestamp.now(),
      });

      const isDoctorEdit = Boolean(request.pendingDoctorEdit && !request.pendingRegistrarUpdate);

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: request.id,
        actionType: 'UPDATE_CONFIRMED',
        newValue: `ადმინისტრატორმა დაადასტურა ${isDoctorEdit ? 'ექიმის' : 'რეგისტრატორის'} რედაქტირება: ${request.patientData.firstName} ${request.patientData.lastName}`,
        oldValue: request.pendingRegistrarUpdate?.registrarComment || request.pendingDoctorEdit?.comment || undefined,
      });
    } catch (error) {
      console.error('Admin confirm request error:', error);
      alert(
        getFirebaseActionErrorMessage(error, {
          fallback: 'რედაქტირების დადასტურება ვერ მოხერხდა.',
          permissionDenied:
            'დადასტურება ვერ მოხერხდა, რადგან ამ ანგარიშისთვის ადმინისტრატორის write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setConfirmingRequestId('');
    }
  };

  if (!canAccessAdminPanel) {
    return <div className="text-center p-12 text-red-500 font-bold">წვდომა აკრძალულია</div>;
  }

  return (
    <div className="w-full max-w-none space-y-8 pb-12">
      <div>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">მოთხოვნები</h2>
        <p className="text-slate-500">რეგისტრატორის და ექიმის ცვლილებები, რომლებიც ადმინისტრატორის დადასტურებას ელოდება</p>
        {!canApproveAdminChanges && (
          <p className="mt-2 text-sm font-bold text-amber-700">
            ამ ანგარიშს მოთხოვნების დადასტურების უფლება არ აქვს.
          </p>
        )}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-400 shadow-sm">
          იტვირთება...
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-slate-400 shadow-sm">
          დასადასტურებელი ცვლილებები ამჟამად არ არის
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {requests.map((request) => (
            <div key={request.id} className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
              {(() => {
                const isDoctorEdit = Boolean(request.pendingDoctorEdit && !request.pendingRegistrarUpdate);
                const pendingComment = request.pendingRegistrarUpdate?.registrarComment || request.pendingDoctorEdit?.comment || '-';
                const editorName =
                  request.pendingRegistrarUpdate?.requestedByUserName ||
                  request.pendingDoctorEdit?.editedByUserName ||
                  request.lastRegistrarEditByUserName ||
                  request.lastDoctorEditByUserName ||
                  '-';
                const editTime =
                  request.pendingRegistrarUpdate?.requestedAt ||
                  request.pendingDoctorEdit?.editedAt ||
                  null;

                return (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div>
                    <div className="text-lg font-black text-slate-900">
                      {request.patientData.firstName} {request.patientData.lastName}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {request.patientData.historyNumber} / {request.patientData.personalId}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-bold uppercase text-amber-700">ცვლილების ტიპი</div>
                      <div className="mt-1 font-bold text-slate-900">
                        {isDoctorEdit ? 'ექიმის/ექთნის რედაქტირება' : 'რეგისტრატორის რედაქტირება'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase text-amber-700">მიმდინარე სტატუსი</div>
                      <div className="mt-1 font-bold text-slate-900">
                        {normalizeRequestStatus(request.pendingRegistrarUpdate?.currentStatus || request.currentStatus)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase text-amber-700">რედაქტორი</div>
                      <div className="mt-1 text-slate-700">
                        {editorName}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase text-amber-700">დრო</div>
                      <div className="mt-1 text-slate-700">
                        {editTime?.toDate
                          ? format(editTime.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka })
                          : '-'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold uppercase text-amber-700">კომენტარი</div>
                    <div className="mt-1 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-slate-700">
                      {pendingComment}
                    </div>
                  </div>
                </div>

                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[280px]">
                  <button
                    type="button"
                    onClick={() => navigate(`/request/${request.id}`)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-bold text-slate-700 transition hover:bg-slate-100"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    დეტალები
                  </button>
                  {canApproveAdminChanges ? (
                    <button
                      type="button"
                      onClick={() => handleConfirmRequest(request)}
                      disabled={confirmingRequestId === request.id}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {confirmingRequestId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      დადასტურება
                    </button>
                  ) : (
                    <div className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
                      მხოლოდ ნახვა
                    </div>
                  )}
                </div>
              </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
