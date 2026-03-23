import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { writeAuditLogEntry } from '../auditLog';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { ClinicalRequest } from '../types';
import { ArrowLeft, CheckCircle2, Clock, FileText, Loader2, Printer, Save, User } from 'lucide-react';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';

export default function RequestDetailsPage() {
  const { id } = useParams();
  const { profile, isRegistrar, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState<ClinicalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  const [formData, setFormData] = useState({
    currentStatus: '',
    finalDecision: '',
    registrarComment: '',
    registrarName: '',
    formFillerName: ''
  });

  useEffect(() => {
    const fetchRequest = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        const docSnap = await getDoc(doc(db, 'requests', id));

        if (docSnap.exists()) {
          const data = docSnap.data() as ClinicalRequest;
          setRequest({ ...data, id: docSnap.id });
          setFormData({
            currentStatus: data.currentStatus,
            finalDecision: data.finalDecision || '',
            registrarComment: data.registrarComment || '',
            registrarName: data.registrarName || '',
            formFillerName: data.formFillerName || ''
          });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchRequest();
  }, [id]);

  useEffect(() => {
    if (!profile || (!isRegistrar && !isAdmin)) {
      return;
    }

    setFormData((current) => ({
      ...current,
      registrarName: current.registrarName || profile.fullName,
      formFillerName: current.formFillerName || profile.fullName,
    }));
  }, [isAdmin, isRegistrar, profile]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !profile || !request) return;
    
    setUpdating(true);
    try {
      const updateData = {
        currentStatus: formData.currentStatus,
        finalDecision: formData.finalDecision,
        registrarComment: formData.registrarComment,
        registrarName: formData.registrarName,
        formFillerName: formData.formFillerName,
        updatedAt: Timestamp.now()
      };

      await updateDoc(doc(db, 'requests', id), updateData);

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: id,
        actionType: 'UPDATE',
        oldValue: request.currentStatus,
        newValue: `${formData.currentStatus}${formData.finalDecision ? ` / ${formData.finalDecision}` : ''}`,
      });

      setRequest({ ...request, ...updateData });
      alert("სტატუსი განახლდა წარმატებით");
    } catch (err) {
      console.error("Update error:", err);
      alert(
        getFirebaseActionErrorMessage(err, {
          fallback: 'განახლება ვერ მოხერხდა.',
          permissionDenied:
            'სტატუსის განახლება ვერ მოხერხდა, რადგან ამ ანგარიშისთვის Firestore write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;
  if (!request) return <div className="text-center p-12 text-slate-500">მოთხოვნა ვერ მოიძებნა</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-6 h-6 text-slate-500" />
          </button>
          <h2 className="text-2xl font-bold text-slate-900">მოთხოვნის დეტალები</h2>
        </div>
        <button
          onClick={() => navigate(`/print/${id}`)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-100"
        >
          <Printer className="w-5 h-5" />
          ბეჭდვა
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Patient Info Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-700">პაციენტის ინფორმაცია</h3>
            </div>
            <div className="p-6 grid grid-cols-2 gap-y-4 gap-x-6">
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
              <div className="col-span-2">
                <div className="text-xs text-slate-400 uppercase font-bold">მისამართი</div>
                <div className="text-slate-700">{request.patientData.address || '-'}</div>
              </div>
            </div>
          </div>

          {/* Request Info Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-700">მოთხოვნის დეტალები</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-6">
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
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">დიაგნოზი (ICD-10)</div>
                  <div className="font-bold text-slate-900 mt-1">{request.icdCode || request.diagnosis || '-'}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase font-bold">პაციენტის თანხმობა / უარი</div>
                <div className={`font-black text-lg mt-1 ${request.consentStatus.startsWith('უარი') ? 'text-red-600' : 'text-emerald-600'}`}>
                  {request.consentStatus}
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

          {/* Registrar Info Display */}
          {(request.registrarName || request.formFillerName) && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-700">რეგისტრატურის ინფორმაცია</h3>
              </div>
              <div className="p-6 grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">რეგისტრატორი</div>
                  <div className="font-bold text-slate-900">{request.registrarName || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase font-bold">ფურცლის შემვსები</div>
                  <div className="font-bold text-slate-900">{request.formFillerName || '-'}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Status Update Card (Registrar/Admin only) */}
          {(isRegistrar || isAdmin) && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden sticky top-24">
              <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-700">სტატუსის მართვა</h3>
              </div>
              <form onSubmit={handleUpdate} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">მიმდინარე სტატუსი</label>
                  <select
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                    value={formData.currentStatus}
                    onChange={(e) => setFormData({ ...formData, currentStatus: e.target.value })}
                  >
                    {REQUEST_STATUSES.map(status => (
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
                    {FINAL_DECISIONS.map(decision => (
                      <option key={decision} value={decision}>{decision}</option>
                    ))}
                  </select>
                </div>

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
                  <label className="text-sm font-bold text-slate-700">რეგისტრატორის კომენტარი</label>
                  <textarea
                    rows={3}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                    value={formData.registrarComment}
                    onChange={(e) => setFormData({ ...formData, registrarComment: e.target.value })}
                  />
                </div>

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

          {/* Metadata Card */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-bold uppercase">ისტორია</span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">გამომგზავნი:</span>
                <span className="font-medium text-slate-700">{request.createdByUserName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">შექმნილია:</span>
                <span className="font-medium text-slate-700">
                  {request.createdAt?.toDate ? format(request.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka }) : '-'}
                </span>
              </div>
              {request.updatedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">განახლდა:</span>
                  <span className="font-medium text-slate-700">
                    {request.updatedAt?.toDate ? format(request.updatedAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka }) : '-'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
