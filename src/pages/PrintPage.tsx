import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ClinicalRequest } from '../types';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';

export default function PrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<ClinicalRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRequest = async () => {
      if (!id) return;
      const docSnap = await getDoc(doc(db, 'requests', id));
      if (docSnap.exists()) {
        setRequest({ ...docSnap.data(), id: docSnap.id } as ClinicalRequest);
      }
      setLoading(false);
    };
    fetchRequest();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;
  if (!request) return <div className="text-center p-12 text-slate-500">მოთხოვნა ვერ მოიძებნა</div>;

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
      <div className="max-w-3xl mx-auto bg-white shadow-xl rounded-2xl p-8 sm:p-12 print:shadow-none print:rounded-none">
        {/* Header - Hidden on print */}
        <div className="flex justify-between items-center mb-8 print:hidden">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 transition-colors">
            <ArrowLeft className="w-5 h-5" />
            უკან დაბრუნება
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
          >
            <Printer className="w-5 h-5" />
            დაბეჭდვა
          </button>
        </div>

        {/* Print Content */}
        <div className="space-y-8 border-2 border-slate-900 p-8">
          <div className="text-center border-b-2 border-slate-900 pb-6">
            <h1 className="text-2xl font-black uppercase tracking-tight">პაციენტის გადამისამართების ფორმა</h1>
            <p className="text-sm font-bold mt-2">თარიღი: {request.createdAt?.toDate ? format(request.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka }) : '-'}</p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">პაციენტის სახელი, გვარი</div>
                <div className="text-lg font-bold border-b border-slate-300 pb-1">
                  {request.patientData.firstName} {request.patientData.lastName}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">ისტორიის ნომერი</div>
                <div className="text-lg font-bold border-b border-slate-300 pb-1">
                  {request.patientData.historyNumber}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">პირადი ნომერი</div>
                <div className="text-lg font-bold border-b border-slate-300 pb-1">
                  {request.patientData.personalId}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">დიაგნოზი (ICD-10)</div>
                <div className="text-lg font-bold border-b border-slate-300 pb-1">
                  {request.icdCode || request.diagnosis || '-'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">მოთხოვნილი კვლევა / მოქმედება</div>
                <div className="text-lg font-bold border-b border-slate-300 pb-1">
                  {request.requestedAction} {request.department ? `(${request.department})` : ''} {request.studyType ? `(${request.studyType})` : ''}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">თანხმობის სტატუსი</div>
                <div className={`text-lg font-bold border-b border-slate-300 pb-1 ${request.consentStatus?.startsWith('უარი') ? 'text-red-600' : ''}`}>
                  {request.consentStatus || '-'}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <div className="text-[10px] font-black uppercase text-slate-500 mb-2">საბოლოო გადაწყვეტილება</div>
            <div className="text-xl font-black bg-slate-100 p-4 rounded border-2 border-slate-900 text-center">
              {request.finalDecision || 'განხილვის პროცესშია'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            {request.registrarName && (
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">რეგისტრატორი</div>
                <div className="text-sm font-bold border-b border-slate-300 pb-1">
                  {request.registrarName}
                </div>
              </div>
            )}
            {request.formFillerName && (
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">ფურცლის შემვსები</div>
                <div className="text-sm font-bold border-b border-slate-300 pb-1">
                  {request.formFillerName}
                </div>
              </div>
            )}
          </div>

          {request.registrarComment && (
            <div>
              <div className="text-[10px] font-black uppercase text-slate-500">რეგისტრატორის კომენტარი</div>
              <div className="text-sm italic border-b border-slate-300 pb-1">
                {request.registrarComment}
              </div>
            </div>
          )}

          <div className="pt-12 grid grid-cols-2 gap-12">
            <div className="space-y-8">
              <div className="border-t border-slate-900 pt-2">
                <div className="text-[10px] font-black uppercase text-slate-500">პასუხისმგებელი პირი</div>
                <div className="text-sm font-bold">{request.createdByUserName}</div>
              </div>
            </div>
            <div className="space-y-8">
              <div className="border-t border-slate-900 pt-2">
                <div className="text-[10px] font-black uppercase text-slate-500">ხელმოწერა</div>
                <div className="h-12"></div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-slate-400 uppercase font-bold">
          ეს დოკუმენტი გენერირებულია კლინიკის შიდა მართვის სისტემის მიერ
        </div>
      </div>
    </div>
  );
}
