import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { resolveUserDisplayName } from '../accessControl';
import { getFinalDecisionTextClass } from '../finalDecisionStyles';
import { getDiagnosisEntries } from '../icd10Utils';
import { getStudyTypes } from '../studyTypeUtils';
import { ClinicalRequest } from '../types';
import { format } from 'date-fns';
import { ka } from 'date-fns/locale';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';

function getResolvedFormFillerName(request: ClinicalRequest) {
  const formFillerName = resolveUserDisplayName(request.formFillerName, request.createdByUserEmail);

  if (formFillerName?.trim()) {
    return formFillerName;
  }

  return resolveUserDisplayName(request.createdByUserName, request.createdByUserEmail) || request.createdByUserName?.trim() || '';
}

export default function PrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<ClinicalRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'requests', id),
      (docSnap) => {
        if (docSnap.exists()) {
          setRequest({ ...docSnap.data(), id: docSnap.id } as ClinicalRequest);
        } else {
          setRequest(null);
        }
        setLoading(false);
      },
      (error) => {
        console.error('Print request sync error:', error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;
  if (!request) return <div className="text-center p-12 text-slate-500">მოთხოვნა ვერ მოიძებნა</div>;

  const resolvedFormFillerName = getResolvedFormFillerName(request);
  const diagnosisEntries = getDiagnosisEntries(request);
  const studyTypes = getStudyTypes(request);
  const createdAtLabel = request.createdAt?.toDate
    ? format(request.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka })
    : '-';
  const requesterName =
    resolveUserDisplayName(request.createdByUserName, request.createdByUserEmail) || request.createdByUserName || '-';

  return (
    <div className="print-page-shell min-h-screen bg-slate-100 p-4 sm:p-6 print:bg-white print:p-0">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 8mm;
        }

        @media print {
          html, body {
            background: #ffffff !important;
          }

          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .print-hide {
            display: none !important;
          }

          .print-page-shell {
            min-height: auto !important;
            padding: 0 !important;
            background: #ffffff !important;
          }

          .print-sheet {
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }

          .print-table {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <div className="print-sheet mx-auto max-w-[210mm] rounded-2xl bg-white p-4 shadow-xl sm:p-6 print:rounded-none print:p-0 print:shadow-none">
        <div className="print-hide mb-6 flex items-center justify-between">
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

        <div className="print-table border-2 border-slate-900">
          <div className="border-b-2 border-slate-900 px-4 py-3 text-center sm:px-5">
            <h1 className="text-lg font-black uppercase tracking-tight sm:text-xl">პაციენტის გადამისამართების ფორმა</h1>
          </div>

          <table className="w-full border-collapse text-[11px] leading-tight sm:text-xs">
            <tbody>
              <tr className="border-b border-slate-900">
                <td className="w-[18%] border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">თარიღი</td>
                <td className="w-[32%] border-r border-slate-900 px-2 py-2 font-bold text-slate-900">{createdAtLabel}</td>
                <td className="w-[18%] border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">გამომგზავნი</td>
                <td className="w-[32%] px-2 py-2 font-bold text-slate-900">{requesterName}</td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">პაციენტი</td>
                <td className="border-r border-slate-900 px-2 py-2 font-bold text-slate-900">
                  {request.patientData.firstName} {request.patientData.lastName}
                </td>
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">დაბ. თარიღი</td>
                <td className="px-2 py-2 font-medium text-slate-900">{request.patientData.birthDate || '-'}</td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">ისტორიის N</td>
                <td className="border-r border-slate-900 px-2 py-2 font-bold text-slate-900">{request.patientData.historyNumber || '-'}</td>
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">პირადი N</td>
                <td className="px-2 py-2 font-medium text-slate-900">{request.patientData.personalId || '-'}</td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">ტელეფონი</td>
                <td className="border-r border-slate-900 px-2 py-2 font-medium text-slate-900">{request.patientData.phone || '-'}</td>
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">მისამართი</td>
                <td className="px-2 py-2 font-medium text-slate-900">{request.patientData.address || '-'}</td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">მოთხოვნა</td>
                <td className="border-r border-slate-900 px-2 py-2 font-bold text-slate-900">
                  {request.requestedAction} {request.department ? `(${request.department})` : ''}
                </td>
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">თანხმობა</td>
                <td className={`px-2 py-2 font-bold ${request.consentStatus?.startsWith('უარი') ? 'text-red-600' : 'text-slate-900'}`}>
                  {request.consentStatus || '-'}
                </td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600 align-top">კვლევის ტიპები</td>
                <td colSpan={3} className="px-2 py-2 text-slate-900">
                  {studyTypes.length > 0 ? studyTypes.join(', ') : '-'}
                </td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600 align-top">დიაგნოზები</td>
                <td colSpan={3} className="px-2 py-2">
                  {diagnosisEntries.length > 0 ? (
                    <div className="space-y-1.5">
                      {diagnosisEntries.map((diagnosisEntry, index) => (
                        <div key={`${diagnosisEntry.code || diagnosisEntry.description || 'diagnosis'}-${index}`} className="text-slate-900">
                          <span className="font-bold">{diagnosisEntry.code || diagnosisEntry.combined}</span>
                          {diagnosisEntry.isPrimary ? <span className="font-black text-sky-700"> / წამყვანი</span> : null}
                          {diagnosisEntry.description ? <span className="font-medium"> - {diagnosisEntry.description}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="font-bold text-slate-900">-</div>
                  )}
                </td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">საბოლოო გადაწყვეტილება</td>
                <td colSpan={3} className={`px-2 py-2 text-center text-sm font-black ${getFinalDecisionTextClass(request.finalDecision)}`}>
                  {request.finalDecision || 'განხილვის პროცესშია'}
                </td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">რეგისტრატორი</td>
                <td className="border-r border-slate-900 px-2 py-2 font-medium text-slate-900">{request.registrarName || '-'}</td>
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600">ფურცლის შემვსები</td>
                <td className="px-2 py-2 font-medium text-slate-900">{resolvedFormFillerName || '-'}</td>
              </tr>

              <tr className="border-b border-slate-900">
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-2 font-black uppercase text-slate-600 align-top">რეგისტრატორის კომენტარი</td>
                <td colSpan={3} className="px-2 py-2 text-slate-900">
                  {request.registrarComment || '-'}
                </td>
              </tr>

              <tr>
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-3 font-black uppercase text-slate-600">პასუხისმგებელი პირი</td>
                <td className="border-r border-slate-900 px-2 py-3 font-bold text-slate-900">{requesterName}</td>
                <td className="border-r border-slate-900 bg-slate-50 px-2 py-3 font-black uppercase text-slate-600">ხელმოწერა</td>
                <td className="px-2 py-3">
                  <div className="h-8 border-b border-slate-900" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="print-hide mt-6 text-center text-[10px] text-slate-400 uppercase font-bold">
          ეს დოკუმენტი გენერირებულია კლინიკის შიდა მართვის სისტემის მიერ
        </div>
      </div>
    </div>
  );
}
