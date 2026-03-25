import { useEffect, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { REGISTRAR_EMAIL } from '../accessControl';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { normalizeRequestStatus } from '../requestStatusUtils';
import { writeAuditLogEntry } from '../auditLog';
import { DEFAULT_SYSTEM_SETTINGS, normalizeSystemSettings } from '../defaultSystemSettings';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { SystemSettings, AuditLog, ClinicalRequest } from '../types';
import { CheckCircle2, Database, History, Loader2, Save, ShieldOff, Trash2, Undo2 } from 'lucide-react';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

function mergeSystemSettings(input?: Partial<SystemSettings> | null): SystemSettings {
  return normalizeSystemSettings(input);
}

export default function AdminSettingsPage() {
  const { canAccessAdminPanel, canApproveAdminChanges, canEditAdminContent, profile } = useAuth();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ClinicalRequest[]>([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [registrarSaving, setRegistrarSaving] = useState(false);
  const [confirmingRequestId, setConfirmingRequestId] = useState('');
  const isRegistrarDeleted = (settings.disabledEmails ?? []).includes(REGISTRAR_EMAIL);

  useEffect(() => {
    if (!canAccessAdminPanel) return;

    const fetchSettings = async () => {
      const docSnap = await getDoc(doc(db, 'settings', 'global'));
      if (docSnap.exists()) {
        setSettings(mergeSystemSettings(docSnap.data() as Partial<SystemSettings>));
      }
    };

    const q = query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribeLogs = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog)));
    });

    const unsubscribeRequests = onSnapshot(
      query(collection(db, 'requests'), orderBy('updatedAt', 'desc'), limit(50)),
      (snapshot) => {
        const nextRequests = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest))
          .filter((request) => request.adminConfirmationStatus === 'pending' && request.pendingRegistrarUpdate);

        setPendingApprovals(nextRequests);
      },
    );

    fetchSettings();
    return () => {
      unsubscribeLogs();
      unsubscribeRequests();
    };
  }, [canAccessAdminPanel]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canEditAdminContent) {
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'global'), settings);

      if (profile) {
        await writeAuditLogEntry({
          userId: profile.uid,
          userName: profile.fullName,
          requestId: 'settings/global',
          actionType: 'SETTINGS_UPDATE',
          newValue: 'ადმინისტრატორმა განაახლა სისტემის პარამეტრები',
        });
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      alert(
        getFirebaseActionErrorMessage(err, {
          fallback: 'შენახვა ვერ მოხერხდა.',
          permissionDenied:
            'პარამეტრების შენახვა ვერ მოხერხდა, რადგან ამ ანგარიშისთვის ადმინისტრატორის write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRegistrar = async () => {
    if (!profile || !canEditAdminContent) {
      return;
    }

    const shouldDelete = !isRegistrarDeleted;
    const confirmed = window.confirm(
      shouldDelete
        ? 'ნამდვილად გსურთ რეგისტრატორის წაშლა? ამის შემდეგ emergencyhtmc14@gmail.com ვეღარ შევა სისტემაში.'
        : 'ნამდვილად გსურთ რეგისტრატორის აღდგენა?',
    );

    if (!confirmed) {
      return;
    }

    const disabledEmails = shouldDelete
      ? Array.from(new Set([...(settings.disabledEmails ?? []), REGISTRAR_EMAIL]))
      : (settings.disabledEmails ?? []).filter((email) => email !== REGISTRAR_EMAIL);

    const nextSettings = mergeSystemSettings({
      ...settings,
      disabledEmails,
    });

    setRegistrarSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'global'), nextSettings);
      setSettings(nextSettings);

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: 'settings/global',
        actionType: shouldDelete ? 'REGISTRAR_DELETE' : 'REGISTRAR_RESTORE',
        newValue: shouldDelete
          ? 'ადმინისტრატორმა გათიშა რეგისტრატორის წვდომა'
          : 'ადმინისტრატორმა აღადგინა რეგისტრატორის წვდომა',
      });
    } catch (err) {
      console.error(err);
      alert(
        getFirebaseActionErrorMessage(err, {
          fallback: shouldDelete
            ? 'რეგისტრატორის წაშლა ვერ მოხერხდა.'
            : 'რეგისტრატორის აღდგენა ვერ მოხერხდა.',
          permissionDenied:
            'მომხმარებლის მართვა ვერ მოხერხდა, რადგან ამ ანგარიშისთვის ადმინისტრატორის write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setRegistrarSaving(false);
    }
  };

  const handleConfirmEditedRequest = async (request: ClinicalRequest) => {
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
        updatedAt: Timestamp.now(),
      });

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: request.id,
        actionType: 'UPDATE_CONFIRMED',
        newValue: `ადმინისტრატორმა დაადასტურა ჩანაწერის რედაქტირება: ${request.patientData.firstName} ${request.patientData.lastName}`,
        oldValue: request.pendingRegistrarUpdate?.registrarComment || undefined,
      });
    } catch (err) {
      console.error(err);
      alert(
        getFirebaseActionErrorMessage(err, {
          fallback: 'რედაქტირების დადასტურება ვერ მოხერხდა.',
          permissionDenied:
            'დადასტურება ვერ მოხერხდა, რადგან ამ ანგარიშისთვის ადმინისტრატორის write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setConfirmingRequestId('');
    }
  };

  if (!canAccessAdminPanel) return <div className="text-center p-12 text-red-500 font-bold">წვდომა აკრძალულია</div>;

  return (
    <div className="w-full max-w-none space-y-8 pb-12">
      <div>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">ადმინისტრირება</h2>
        <p className="text-slate-500">სისტემის პარამეტრები და აუდიტი</p>
        {!canApproveAdminChanges && (
          <p className="mt-2 text-sm font-bold text-amber-700">
            ამ ანგარიშს რედაქტირებების დადასტურების უფლება არ აქვს.
          </p>
        )}
        {!canEditAdminContent && (
          <p className="mt-2 text-sm font-bold text-slate-500">
            ამ ანგარიშს პარამეტრების შეცვლის უფლება არ აქვს და გვერდი მხოლოდ ნახვის რეჟიმშია.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Google Integration Settings */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-700">Google Drive / Sheets ინტეგრაცია</h3>
            </div>
            <form onSubmit={handleSaveSettings} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Google Sheets ბმული ან ID</label>
                <input
                  type="text"
                  disabled={!canEditAdminContent}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={settings.googleSheetsId}
                  onChange={(e) => setSettings({ ...settings, googleSheetsId: e.target.value })}
                />
                <p className="text-xs text-slate-400">
                  შეგიძლიათ მიუთითოთ სრული Google Sheets ბმული. ამჟამინდელი წყარო უკვე შევსებულია.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Sheet-ის სახელი</label>
                <input
                  type="text"
                  disabled={!canEditAdminContent}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={settings.sheetName}
                  onChange={(e) => setSettings({ ...settings, sheetName: e.target.value })}
                />
                <p className="text-xs text-slate-400">
                  პაციენტის ძებნა ახლა მთელ workbook-ში ხდება. ეს ველი მხოლოდ პრიორიტეტულ sheet-ს ნიშნავს.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Sheet GID</label>
                <input
                  type="text"
                  disabled={!canEditAdminContent}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={settings.sheetGid || ''}
                  onChange={(e) => setSettings({ ...settings, sheetGid: e.target.value })}
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-black uppercase text-slate-400 mb-4">სვეტების Mapping (Excel/Sheets)</h4>
                <div className="grid grid-cols-1 gap-4">
                  {Object.keys(settings.columnMapping).map((key) => (
                    <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-full flex-shrink-0 text-sm text-slate-600 sm:w-32">{key}</span>
                      <input
                        type="text"
                        disabled={!canEditAdminContent}
                        className="flex-1 px-4 py-1.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={(settings.columnMapping as any)[key]}
                        onChange={(e) => setSettings({
                          ...settings,
                          columnMapping: { ...settings.columnMapping, [key]: e.target.value }
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !canEditAdminContent}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : success ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
                {success ? 'შენახულია' : canEditAdminContent ? 'პარამეტრების შენახვა' : 'მხოლოდ ნახვა'}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
              <ShieldOff className="w-5 h-5 text-red-600" />
              <h3 className="font-bold text-slate-700">მომხმარებლების მართვა</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-slate-900">რეგისტრატორი</div>
                    <div className="text-sm text-slate-600">{REGISTRAR_EMAIL}</div>
                    <div className={`text-xs font-bold ${isRegistrarDeleted ? 'text-red-600' : 'text-emerald-600'}`}>
                      {isRegistrarDeleted ? 'წვდომა წაშლილია' : 'წვდომა აქტიურია'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleRegistrar}
                    disabled={registrarSaving || !canEditAdminContent}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 font-bold text-white transition disabled:opacity-50 sm:w-auto ${
                      isRegistrarDeleted
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {registrarSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isRegistrarDeleted ? (
                      <Undo2 className="w-4 h-4" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {canEditAdminContent
                      ? (isRegistrarDeleted ? 'რეგისტრატორის აღდგენა' : 'რეგისტრატორის წაშლა')
                      : 'მხოლოდ ნახვა'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                წაშლის შემდეგ რეგისტრატორის ანგარიში სისტემაში ვეღარ შევა, სანამ ადმინისტრატორი ხელახლა არ აღადგენს.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-amber-600" />
              <h3 className="font-bold text-slate-700">ნებართვების ველი</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                აქ ჩანს რეგისტრატორის მიერ შეცვლილი ჩანაწერები, რომლებიც ადმინისტრატორის დადასტურებას ელოდება.
              </p>

              {pendingApprovals.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  დასადასტურებელი რედაქტირება ამჟამად არ არის.
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.map((request) => (
                    <div key={request.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="text-sm font-black text-slate-900">
                            {request.patientData.firstName} {request.patientData.lastName}
                          </div>
                          <div className="text-xs text-slate-500">
                            {request.patientData.historyNumber} / {request.patientData.personalId}
                          </div>
                          <div className="text-sm font-bold text-amber-800">
                            {normalizeRequestStatus(request.currentStatus)}
                            {request.finalDecision ? ` / ${request.finalDecision}` : ''}
                          </div>
                          <div className="text-sm text-slate-700">
                            რედაქტორი: {request.lastRegistrarEditByUserName || request.pendingRegistrarUpdate?.requestedByUserName || 'რეგისტრატორი'}
                          </div>
                          <div className="text-sm text-slate-700">
                            კომენტარი: {request.registrarComment || request.pendingRegistrarUpdate?.registrarComment || '-'}
                          </div>
                          <div className="text-xs text-slate-500">
                            რედაქტირდა: {request.lastRegistrarEditAt?.toDate ? format(request.lastRegistrarEditAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka }) : '-'}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[280px]">
                          <button
                            type="button"
                            onClick={() => navigate(`/request/${request.id}`)}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            დეტალები
                          </button>
                          {canApproveAdminChanges ? (
                            <button
                              type="button"
                              onClick={() => handleConfirmEditedRequest(request)}
                              disabled={confirmingRequestId === request.id}
                              className="rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {confirmingRequestId === request.id ? 'ინახება...' : 'დადასტურება'}
                            </button>
                          ) : (
                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-center font-bold text-slate-500">
                              მხოლოდ ნახვა
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Audit Logs */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-h-[700px]">
          <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-slate-700">Audit Log (ბოლო 50 მოქმედება)</h3>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
                <div className="flex flex-col gap-1 font-bold text-slate-700 sm:flex-row sm:items-center sm:justify-between">
                  <span>{log.userName}</span>
                  <span className="text-slate-400">
                    {log.createdAt?.toDate ? format(log.createdAt.toDate(), 'dd.MM HH:mm', { locale: ka }) : '-'}
                  </span>
                </div>
                <div className="text-slate-600">
                  <span className="font-bold text-emerald-600">{log.actionType}:</span> {log.newValue}
                </div>
                {log.oldValue && (
                  <div className="text-slate-400 italic">ძველი: {log.oldValue}</div>
                )}
              </div>
            ))}
            {logs.length === 0 && <div className="text-center py-12 text-slate-400">ლოგები არ არის</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
