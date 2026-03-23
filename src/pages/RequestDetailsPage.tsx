import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { writeAuditLogEntry } from '../auditLog';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { getDiagnosisEntries } from '../icd10Utils';
import { ClinicalRequest, PendingDoctorEdit, PendingRegistrarUpdate } from '../types';
import { FINAL_DECISIONS, REQUEST_STATUSES } from '../constants';
import { ArrowLeft, CheckCircle2, Clock, FileText, Loader2, Printer, Save, User } from 'lucide-react';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';

type ConfirmAction = 'save' | 'approve' | null;

function getUpdateSummary(status: string, finalDecision?: string) {
  return `${status}${finalDecision ? ` / ${finalDecision}` : ''}`;
}

function getPendingUpdateSignature(update?: PendingRegistrarUpdate | null) {
  if (!update) {
    return '';
  }

  const requestedAt = update.requestedAt?.toMillis
    ? update.requestedAt.toMillis()
    : update.requestedAt?.seconds || '';

  return [
    update.currentStatus,
    update.finalDecision || '',
    update.registrarComment || '',
    update.registrarName || '',
    update.formFillerName || '',
    update.requestedByUserId,
    update.requestedByUserEmail || '',
    requestedAt,
  ].join('|');
}

function getPendingDoctorEditSignature(update?: PendingDoctorEdit | null) {
  if (!update) {
    return '';
  }

  const editedAt = update.editedAt?.toMillis
    ? update.editedAt.toMillis()
    : update.editedAt?.seconds || '';

  return [
    update.comment || '',
    update.editedByUserId,
    update.editedByUserEmail || '',
    editedAt,
  ].join('|');
}

function hasRegistrarSyncChange(current: ClinicalRequest, next: ClinicalRequest) {
  return (
    current.currentStatus !== next.currentStatus ||
    (current.finalDecision || '') !== (next.finalDecision || '') ||
    (current.registrarComment || '') !== (next.registrarComment || '') ||
    (current.registrarName || '') !== (next.registrarName || '') ||
    (current.formFillerName || '') !== (next.formFillerName || '') ||
    (current.adminConfirmationStatus || '') !== (next.adminConfirmationStatus || '') ||
    Boolean(current.requiresRegistrarAction) !== Boolean(next.requiresRegistrarAction) ||
    (current.lastDoctorEditComment || '') !== (next.lastDoctorEditComment || '') ||
    getPendingDoctorEditSignature(current.pendingDoctorEdit) !==
      getPendingDoctorEditSignature(next.pendingDoctorEdit) ||
    getPendingUpdateSignature(current.pendingRegistrarUpdate) !==
      getPendingUpdateSignature(next.pendingRegistrarUpdate)
  );
}

function getDateTimeLabel(value: any) {
  return value?.toDate
    ? format(value.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka })
    : '-';
}

function getDefaultFormFillerName(request?: ClinicalRequest | null, fallbackName?: string | null) {
  const senderName = request?.createdByUserName?.trim();

  if (senderName) {
    return senderName;
  }

  return fallbackName?.trim() || '';
}

export default function RequestDetailsPage() {
  const { id } = useParams();
  const { profile, isRegistrar, isAdmin, isDoctorOrNurse } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState<ClinicalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [successDialogContent, setSuccessDialogContent] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [syncNoticeMessage, setSyncNoticeMessage] = useState('');
  const [formError, setFormError] = useState('');
  const autoStatusSyncRef = useRef(false);

  const [formData, setFormData] = useState({
    currentStatus: '',
    finalDecision: '',
    registrarComment: '',
    registrarName: '',
    formFillerName: '',
    doctorEditComment: '',
  });

  const isRegistrarOnly = isRegistrar && !isAdmin;
  const isRequestOwner =
    !!request &&
    !!profile &&
    (request.createdByUserId === profile.uid || request.createdByUserEmail === profile.email);
  const canDoctorEdit = isDoctorOrNurse && isRequestOwner && !isAdmin && !isRegistrar;
  const canManageRequest = isRegistrar || isAdmin || canDoctorEdit;
  const pendingUpdate = request?.adminConfirmationStatus === 'pending'
    ? request?.pendingRegistrarUpdate || null
    : null;
  const pendingDoctorEdit = request?.requiresRegistrarAction ? request?.pendingDoctorEdit || null : null;

  useEffect(() => {
    if (!id || !profile || !request || !isRegistrarOnly) {
      return;
    }

    if (request.currentStatus !== 'ახალი') {
      autoStatusSyncRef.current = false;
      return;
    }

    if (autoStatusSyncRef.current) {
      return;
    }

    autoStatusSyncRef.current = true;

    const markAsInReview = async () => {
      try {
        await updateDoc(doc(db, 'requests', id), {
          currentStatus: 'განხილვაშია',
          updatedAt: Timestamp.now(),
        });

        await writeAuditLogEntry({
          userId: profile.uid,
          userName: profile.fullName,
          requestId: id,
          actionType: 'AUTO_IN_REVIEW',
          oldValue: 'ახალი',
          newValue: 'განხილვაშია',
        });
      } catch (error) {
        console.error('Auto in-review sync failed:', error);
        autoStatusSyncRef.current = false;
      }
    };

    void markAsInReview();
  }, [id, isRegistrarOnly, profile, request]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'requests', id),
      (docSnap) => {
        if (!docSnap.exists()) {
          setRequest(null);
          setLoading(false);
          return;
        }

        const data = docSnap.data() as ClinicalRequest;
        const nextRequest = { ...data, id: docSnap.id };

        setRequest((current) => {
          if (current && hasRegistrarSyncChange(current, nextRequest) && !updating && !confirmAction) {
            if (current.adminConfirmationStatus !== nextRequest.adminConfirmationStatus) {
              if (nextRequest.adminConfirmationStatus === 'confirmed') {
                setSyncNoticeMessage('ადმინმა რეგისტრატორის რედაქტირება დაადასტურა.');
              } else if (nextRequest.adminConfirmationStatus === 'pending') {
                setSyncNoticeMessage('რეგისტრატორის ცვლილება ჩაიწერა და ადმინთან შეტყობინება გაიგზავნა.');
              }
            } else {
              setSyncNoticeMessage('ჩანაწერი realtime რეჟიმში განახლდა.');
            }
          }

          return nextRequest;
        });

        if (!updating && !confirmAction) {
          setFormData((current) => ({
            ...current,
            currentStatus: data.currentStatus,
            finalDecision: data.finalDecision || '',
            registrarComment: data.registrarComment || '',
            registrarName: data.registrarName || profile?.fullName || '',
            formFillerName: data.formFillerName || getDefaultFormFillerName(data, profile?.fullName) || '',
            doctorEditComment: data.lastDoctorEditComment || '',
          }));
        }

        setLoading(false);
      },
      (error) => {
        console.error('Request sync error:', error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [confirmAction, id, profile?.fullName, updating]);

  useEffect(() => {
    if (!profile || (!isRegistrar && !isAdmin)) {
      return;
    }

    setFormData((current) => ({
      ...current,
      registrarName: current.registrarName || profile.fullName,
      formFillerName: current.formFillerName || getDefaultFormFillerName(request, profile.fullName),
    }));
  }, [isAdmin, isRegistrar, profile, request]);

  const statusOptions = Array.from(
    new Set([
      ...REQUEST_STATUSES.filter((status) => status !== 'უარყოფილია'),
      ...(formData.currentStatus ? [formData.currentStatus] : []),
    ]),
  );

  const finalDecisionOptions = Array.from(
    new Set([
      ...FINAL_DECISIONS.filter((decision) => decision !== 'გაუქმებულია'),
      ...(formData.finalDecision ? [formData.finalDecision] : []),
    ]),
  );

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !profile || !request) {
      return;
    }

    if (isRegistrarOnly && !formData.registrarComment.trim()) {
      setFormError('რეგისტრატორის ცვლილების შესანახად კომენტარი სავალდებულოა.');
      return;
    }

    if (canDoctorEdit && !formData.doctorEditComment.trim()) {
      setFormError('ექიმის/ექთნის ცვლილების შესანახად კომენტარი სავალდებულოა.');
      return;
    }

    setFormError('');
    setConfirmAction('save');
  };

  const handleApprovePendingUpdate = () => {
    if (!pendingUpdate) {
      return;
    }

    setConfirmAction('approve');
  };

  const submitUpdate = async () => {
    if (!id || !profile || !request || !confirmAction) {
      return;
    }

    setUpdating(true);

    try {
      const requestRef = doc(db, 'requests', id);

      if (confirmAction === 'approve' && pendingUpdate) {
        await updateDoc(requestRef, {
          adminConfirmationStatus: 'confirmed',
          adminConfirmedAt: Timestamp.now(),
          adminConfirmedByUserId: profile.uid,
          adminConfirmedByUserName: profile.fullName,
          pendingRegistrarUpdate: null,
          updatedAt: Timestamp.now(),
        });

        await writeAuditLogEntry({
          userId: profile.uid,
          userName: profile.fullName,
          requestId: id,
          actionType: 'UPDATE_CONFIRMED',
          oldValue: getUpdateSummary(request.currentStatus, request.finalDecision),
          newValue: 'ადმინისტრატორმა დაადასტურა რეგისტრატორის რედაქტირება',
        });

        setConfirmAction(null);
        setSuccessDialogContent({
          title: 'რედაქტირება დადასტურდა',
          message: 'რეგისტრატორის ცვლილება უკვე დადასტურებულია ადმინისტრატორის მიერ.',
        });
        return;
      }

      const baseUpdate = {
        currentStatus: formData.currentStatus,
        finalDecision: formData.finalDecision,
        registrarComment: formData.registrarComment.trim(),
        registrarName: formData.registrarName,
        formFillerName: formData.formFillerName.trim() || getDefaultFormFillerName(request, profile.fullName),
        updatedAt: Timestamp.now(),
      };

      if (isRegistrarOnly) {
        const pendingNotification: PendingRegistrarUpdate = {
          currentStatus: formData.currentStatus as ClinicalRequest['currentStatus'],
          finalDecision: formData.finalDecision,
          registrarComment: formData.registrarComment.trim(),
          registrarName: formData.registrarName,
          formFillerName: formData.formFillerName,
          requestedAt: Timestamp.now(),
          requestedByUserEmail: profile.email,
          requestedByUserId: profile.uid,
          requestedByUserName: profile.fullName,
        };

        await updateDoc(requestRef, {
          ...baseUpdate,
          pendingRegistrarUpdate: pendingNotification,
          lastRegistrarEditAt: Timestamp.now(),
          lastRegistrarEditByUserId: profile.uid,
          lastRegistrarEditByUserName: profile.fullName,
          lastRegistrarEditByUserEmail: profile.email,
          adminConfirmationStatus: 'pending',
          adminConfirmedAt: null,
          adminConfirmedByUserId: '',
          adminConfirmedByUserName: '',
          requiresRegistrarAction: false,
          pendingDoctorEdit: null,
        });

        await writeAuditLogEntry({
          userId: profile.uid,
          userName: profile.fullName,
          requestId: id,
          actionType: 'REGISTRAR_EDIT',
          oldValue: getUpdateSummary(request.currentStatus, request.finalDecision),
          newValue: `${getUpdateSummary(formData.currentStatus, formData.finalDecision)} / კომენტარი: ${formData.registrarComment.trim()}`,
        });

        setConfirmAction(null);
        setSuccessDialogContent({
          title: 'ცვლილება შენახულია',
          message: 'ჩანაწერი დარედაქტირდა და ადმინისტრატორთან შეტყობინება ავტომატურად გაიგზავნა.',
        });
        return;
      }

      if (canDoctorEdit) {
        const doctorNotification: PendingDoctorEdit = {
          comment: formData.doctorEditComment.trim(),
          editedAt: Timestamp.now(),
          editedByUserEmail: profile.email,
          editedByUserId: profile.uid,
          editedByUserName: profile.fullName,
        };

        await updateDoc(requestRef, {
          ...baseUpdate,
          requiresRegistrarAction: true,
          pendingDoctorEdit: doctorNotification,
          lastDoctorEditAt: Timestamp.now(),
          lastDoctorEditByUserId: profile.uid,
          lastDoctorEditByUserName: profile.fullName,
          lastDoctorEditByUserEmail: profile.email,
          lastDoctorEditComment: formData.doctorEditComment.trim(),
        });

        await writeAuditLogEntry({
          userId: profile.uid,
          userName: profile.fullName,
          requestId: id,
          actionType: 'DOCTOR_EDIT',
          oldValue: getUpdateSummary(request.currentStatus, request.finalDecision),
          newValue: `${getUpdateSummary(formData.currentStatus, formData.finalDecision)} / კომენტარი: ${formData.doctorEditComment.trim()}`,
        });

        setConfirmAction(null);
        setSuccessDialogContent({
          title: 'ცვლილება შენახულია',
          message: 'ჩანაწერი განახლდა და რეგისტრატორთან გამოჩნდება როგორც ხელახლა დასამუშავებელი მოთხოვნა.',
        });
        return;
      }

      const adminUpdateData: Record<string, any> = {
        ...baseUpdate,
      };

      if (request.adminConfirmationStatus === 'pending' || request.pendingRegistrarUpdate) {
        adminUpdateData.pendingRegistrarUpdate = null;
        adminUpdateData.adminConfirmationStatus = 'confirmed';
        adminUpdateData.adminConfirmedAt = Timestamp.now();
        adminUpdateData.adminConfirmedByUserId = profile.uid;
        adminUpdateData.adminConfirmedByUserName = profile.fullName;
      }

      await updateDoc(requestRef, adminUpdateData);

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: id,
        actionType: 'UPDATE',
        oldValue: getUpdateSummary(request.currentStatus, request.finalDecision),
        newValue: getUpdateSummary(formData.currentStatus, formData.finalDecision),
      });

      setConfirmAction(null);
      setSuccessDialogContent({
        title: 'სტატუსი განახლდა წარმატებით',
        message: 'ცვლილება შენახულია და მთავარ პანელზეც გამოჩნდება.',
      });
    } catch (err) {
      console.error('Update error:', err);

      const fallbackMessage =
        confirmAction === 'approve'
          ? 'რედაქტირების დადასტურება ვერ მოხერხდა.'
          : 'განახლება ვერ მოხერხდა.';

      alert(
        getFirebaseActionErrorMessage(err, {
          fallback: fallbackMessage,
          permissionDenied:
            'მოთხოვნილი მოქმედება ვერ შესრულდა, რადგან ამ ანგარიშისთვის Firestore write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setUpdating(false);
    }
  };

  const confirmDialogContent = confirmAction
    ? {
        title: confirmAction === 'approve' ? 'რედაქტირების დადასტურება' : 'სტატუსის დადასტურება',
        message:
          confirmAction === 'approve'
            ? 'ნამდვილად გსურთ რეგისტრატორის მიერ შეტანილი ცვლილების დადასტურება?'
            : isRegistrarOnly
              ? 'ცვლილება დაუყოვნებლივ შეინახება და ადმინთან შეტყობინებაც გაიგზავნება. გაგრძელება გსურთ?'
              : canDoctorEdit
                ? 'ცვლილება დაუყოვნებლივ შეინახება და რეგისტრატორთან გამოჩნდება როგორც ხელახლა დასამუშავებელი მოთხოვნა. გაგრძელება გსურთ?'
                : 'ნამდვილად გსურთ სტატუსის განახლება?',
        confirmLabel: confirmAction === 'approve' ? 'დადასტურება' : 'OK',
      }
    : null;

  if (loading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;
  }

  if (!request) {
    return <div className="text-center p-12 text-slate-500">მოთხოვნა ვერ მოიძებნა</div>;
  }

  return (
    <div className="w-full max-w-none space-y-6 pb-12">
      {syncNoticeMessage && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {syncNoticeMessage}
          <button
            type="button"
            onClick={() => setSyncNoticeMessage('')}
            className="ml-3 font-bold text-blue-800"
          >
            დახურვა
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-6 h-6 text-slate-500" />
          </button>
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">მოთხოვნის დეტალები</h2>
        </div>
        <button
          onClick={() => navigate(`/print/${id}`)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white transition-all shadow-lg shadow-blue-100 hover:bg-blue-700 sm:w-auto sm:py-2"
        >
          <Printer className="w-5 h-5" />
          ბეჭდვა
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-700">პაციენტის ინფორმაცია</h3>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:p-6 md:grid-cols-2">
              <div>
                <div className="text-xs text-slate-400 uppercase font-bold">სახელი, გვარი</div>
                <div className="font-bold text-slate-900">{request.patientData.firstName} {request.patientData.lastName}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase font-bold">ისტორიის ნომერი</div>
                <div className="font-bold text-slate-900">{request.patientData.historyNumber}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase font-bold">პირადი ნომერი</div>
                <div className="text-slate-700">{request.patientData.personalId}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase font-bold">დაბადების თარიღი</div>
                <div className="text-slate-700">{request.patientData.birthDate || '-'}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-slate-400 uppercase font-bold">მისამართი</div>
                <div className="text-slate-700">{request.patientData.address || '-'}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-700">მოთხოვნის დეტალები</h3>
            </div>
            <div className="space-y-4 p-4 sm:p-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">მოთხოვნილი მოქმედება</div>
                  <div className="font-bold text-slate-900">
                    {request.requestedAction} {request.department ? `(${request.department})` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">კვლევის ტიპი</div>
                  <div className="font-bold text-emerald-600">{request.studyType || '-'}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">დიაგნოზები (ICD-10)</div>
                  <div className="mt-1 space-y-3">
                    {getDiagnosisEntries(request).length > 0 ? getDiagnosisEntries(request).map((diagnosisEntry, index) => (
                      <div key={`${diagnosisEntry.code || diagnosisEntry.description || 'diagnosis'}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-bold text-slate-900">
                            {diagnosisEntry.code || diagnosisEntry.combined}
                          </div>
                          {diagnosisEntry.isPrimary && (
                            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700">
                              წამყვანი
                            </span>
                          )}
                        </div>
                        {diagnosisEntry.description && (
                          <div className="mt-1 text-sm leading-6 text-slate-600">{diagnosisEntry.description}</div>
                        )}
                      </div>
                    )) : (
                      <div className="text-sm text-slate-500">-</div>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase font-bold">პაციენტის თანხმობა / უარი</div>
                <div className={`font-black text-lg mt-1 ${request.consentStatus?.startsWith('უარი') ? 'text-red-600' : 'text-emerald-600'}`}>
                  {request.consentStatus || '-'}
                </div>
              </div>
              {request.doctorComment && (
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">ექიმის კომენტარი</div>
                  <div className="text-slate-600 italic mt-1">"{request.doctorComment}"</div>
                </div>
              )}
            </div>
          </div>

          {(request.registrarName || request.formFillerName || request.lastRegistrarEditAt) && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-700">რეგისტრატურის ინფორმაცია</h3>
              </div>
              <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 md:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">რეგისტრატორი</div>
                  <div className="font-bold text-slate-900">{request.registrarName || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">ფურცლის შემვსები</div>
                  <div className="font-bold text-slate-900">{request.formFillerName || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">ჩანაწერი რედაქტირდა</div>
                  <div className="font-bold text-slate-900">
                    {request.lastRegistrarEditAt ? getDateTimeLabel(request.lastRegistrarEditAt) : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">ადმინის დადასტურება</div>
                  <div className={`font-bold ${request.adminConfirmationStatus === 'pending' ? 'text-amber-700' : request.adminConfirmationStatus === 'confirmed' ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {request.adminConfirmationStatus === 'pending'
                      ? 'ელოდება დადასტურებას'
                      : request.adminConfirmationStatus === 'confirmed'
                        ? 'დადასტურებულია'
                        : '-'}
                  </div>
                </div>
                {request.lastDoctorEditAt && (
                  <>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">ექიმის ბოლო ცვლილება</div>
                      <div className="font-bold text-slate-900">
                        {request.lastDoctorEditByUserName || '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 uppercase font-bold">რეგისტრატორის განმეორებითი მოქმედება</div>
                      <div className={`font-bold ${request.requiresRegistrarAction ? 'text-sky-600' : 'text-slate-500'}`}>
                        {request.requiresRegistrarAction ? 'ელოდება ხელახლა მოქმედებას' : 'დამუშავებულია'}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {pendingDoctorEdit && (
            <div className="overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
              <div className="border-b border-sky-200 px-6 py-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-sky-600" />
                <h3 className="font-bold text-sky-900">ხელახლა დასამუშავებელი ცვლილება</h3>
              </div>
              <div className="space-y-4 p-4 sm:p-6">
                <p className="text-sm leading-6 text-sky-900">
                  {isRegistrar || isAdmin
                    ? 'ექიმმა/ექთანმა ჩანაწერი შეცვალა და ახლა ხელახლა მოქმედებას ელოდება.'
                    : 'თქვენი ცვლილება რეგისტრატორთან გამოჩნდება როგორც ხელახლა დასამუშავებელი მოთხოვნა.'}
                </p>
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase text-sky-700">რედაქტორი</div>
                    <div className="mt-1 font-bold text-slate-900">{pendingDoctorEdit.editedByUserName}</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase text-sky-700">რედაქტირების დრო</div>
                    <div className="mt-1 text-slate-700">{getDateTimeLabel(pendingDoctorEdit.editedAt)}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase text-sky-700">ექიმის კომენტარი</div>
                  <div className="mt-1 rounded-xl bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700">
                    {pendingDoctorEdit.comment}
                  </div>
                </div>
              </div>
            </div>
          )}

          {pendingUpdate && (
            <div className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
              <div className="border-b border-amber-200 px-6 py-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-amber-900">ადმინისტრატორის შეტყობინება</h3>
              </div>
              <div className="space-y-4 p-4 sm:p-6">
                <p className="text-sm leading-6 text-amber-900">
                  {isAdmin
                    ? 'რეგისტრატორმა უკვე შეცვალა ჩანაწერი. აქედან ან ადმინისტრირების გვერდიდან შეგიძლიათ დადასტურება.'
                    : 'თქვენი ცვლილება უკვე ჩაიწერა. ადმინისტრატორს დადასტურების შეტყობინება გაეგზავნა.'}
                </p>

                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase text-amber-700">ახალი სტატუსი</div>
                    <div className="mt-1 font-bold text-slate-900">{pendingUpdate.currentStatus}</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase text-amber-700">საბოლოო გადაწყვეტილება</div>
                    <div className="mt-1 font-bold text-slate-900">{pendingUpdate.finalDecision || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase text-amber-700">რედაქტორი</div>
                    <div className="mt-1 text-slate-700">{pendingUpdate.requestedByUserName}</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase text-amber-700">რედაქტირების დრო</div>
                    <div className="mt-1 text-slate-700">{getDateTimeLabel(pendingUpdate.requestedAt)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase text-amber-700">სავალდებულო კომენტარი</div>
                  <div className="mt-1 rounded-xl bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700">
                    {pendingUpdate.registrarComment || '-'}
                  </div>
                </div>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleApprovePendingUpdate}
                    disabled={updating}
                    className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    დადასტურება
                  </button>
                )}
              </div>
            </div>
          )}

          {canManageRequest && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-24">
              <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-700">სტატუსის მართვა</h3>
              </div>
              <form onSubmit={handleUpdate} className="space-y-4 p-4 sm:p-6">
                {isRegistrarOnly && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                    ცვლილება მაშინვე შეინახება, ექიმთანაც დაუყოვნებლივ დასინქრონდება, ხოლო კომენტარი სავალდებულოა. პარალელურად ადმინთან გაიგზავნება დადასტურების შეტყობინება.
                  </div>
                )}

                {canDoctorEdit && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                    ექიმის/ექთნის ცვლილება მაშინვე შეინახება, მაგრამ რეგისტრატორთან გამოჩნდება როგორც ხელახლა დასამუშავებელი მოთხოვნა. კომენტარი სავალდებულოა.
                  </div>
                )}

                {formError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">მიმდინარე სტატუსი</label>
                  <select
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                    value={formData.currentStatus}
                    onChange={(e) => setFormData({ ...formData, currentStatus: e.target.value })}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">საბოლოო გადაწყვეტილება</label>
                  <select
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                    value={formData.finalDecision}
                    onChange={(e) => setFormData({ ...formData, finalDecision: e.target.value })}
                  >
                    <option value="">აირჩიეთ...</option>
                    {finalDecisionOptions.map((decision) => (
                      <option key={decision} value={decision}>{decision}</option>
                    ))}
                  </select>
                </div>

                {!canDoctorEdit && (
                  <>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">რეგისტრატორის სახელი, გვარი</label>
                        <input
                          type="text"
                          className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                          value={formData.registrarName}
                          onChange={(e) => setFormData({ ...formData, registrarName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">ფურცლის შემვსები პირი</label>
                        <input
                          type="text"
                          className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                          value={formData.formFillerName}
                          onChange={(e) => setFormData({ ...formData, formFillerName: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">
                        რეგისტრატორის კომენტარი
                        {isRegistrarOnly && <span className="ml-2 text-xs text-red-500">(სავალდებულო)</span>}
                      </label>
                      <textarea
                        rows={3}
                        className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                        value={formData.registrarComment}
                        onChange={(e) => setFormData({ ...formData, registrarComment: e.target.value })}
                      />
                    </div>
                  </>
                )}

                {canDoctorEdit && (
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">
                      ცვლილების კომენტარი
                      <span className="ml-2 text-xs text-red-500">(სავალდებულო)</span>
                    </label>
                    <textarea
                      rows={3}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                      value={formData.doctorEditComment}
                      onChange={(e) => setFormData({ ...formData, doctorEditComment: e.target.value })}
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={updating}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {updating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  შენახვა
                </button>
              </form>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4 sm:p-6">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-bold uppercase">ისტორია</span>
            </div>
            <div className="space-y-3">
              <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-slate-500">გამომგზავნი:</span>
                <span className="font-medium text-slate-700">{request.createdByUserName}</span>
              </div>
              <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-slate-500">შექმნილია:</span>
                <span className="font-medium text-slate-700">{getDateTimeLabel(request.createdAt)}</span>
              </div>
              {request.updatedAt && (
                <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-slate-500">განახლდა:</span>
                  <span className="font-medium text-slate-700">{getDateTimeLabel(request.updatedAt)}</span>
                </div>
              )}
              {request.lastRegistrarEditAt && (
                <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-slate-500">ბოლოს რედაქტირდა:</span>
                  <span className="font-medium text-slate-700">
                    {request.lastRegistrarEditByUserName || 'რეგისტრატორი'} / {getDateTimeLabel(request.lastRegistrarEditAt)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDialogContent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-slate-900">{confirmDialogContent.title}</h3>
              <p className="text-sm text-slate-600">{confirmDialogContent.message}</p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitUpdate}
                disabled={updating}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50"
              >
                {updating ? 'ინახება...' : confirmDialogContent.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {successDialogContent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-slate-900">{successDialogContent.title}</h3>
              <p className="text-sm text-slate-600">{successDialogContent.message}</p>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setSuccessDialogContent(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setSuccessDialogContent(null)}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
