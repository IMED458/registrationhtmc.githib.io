import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { getFinalDecisionTextClass } from '../finalDecisionStyles';
import { ClinicalRequest, RequestStatus } from '../types';
import { REQUEST_STATUSES } from '../constants';
import { CheckCircle2, Clock, Filter, MoreHorizontal, Plus, Printer, Search, XCircle } from 'lucide-react';
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

function getRequestActionLabel(request: ClinicalRequest) {
  if (request.consentStatus?.startsWith('უარი')) {
    return request.consentStatus;
  }

  return request.requestedAction;
}

function getRequestActionTextClass(request: ClinicalRequest) {
  return request.consentStatus?.startsWith('უარი')
    ? 'text-red-600'
    : 'text-slate-700';
}

export default function Dashboard() {
  const { profile, isDoctorOrNurse, isRegistrar, isAdmin } = useAuth();
  const [requests, setRequests] = useState<ClinicalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ყველა');
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile) {
      return;
    }

    setLoading(true);

    if (isDoctorOrNurse && !isAdmin) {
      const requestsByUid = new Map<string, ClinicalRequest>();
      const requestsByEmail = new Map<string, ClinicalRequest>();
      let uidLoaded = false;
      let emailLoaded = !profile.email;

      const syncRequests = () => {
        const merged = new Map<string, ClinicalRequest>([
          ...requestsByUid.entries(),
          ...requestsByEmail.entries(),
        ]);

        const sorted = Array.from(merged.values()).sort(
          (left, right) => getRequestTimestampValue(right) - getRequestTimestampValue(left),
        );

        setRequests(sorted);

        if (uidLoaded && emailLoaded) {
          setLoading(false);
        }
      };

      const unsubscribeByUid = onSnapshot(
        query(collection(db, 'requests'), where('createdByUserId', '==', profile.uid)),
        (snapshot) => {
          requestsByUid.clear();
          snapshot.docs.forEach((requestDoc) => {
            requestsByUid.set(requestDoc.id, { id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest);
          });
          uidLoaded = true;
          syncRequests();
        },
        (error) => {
          console.error('Firestore Error:', error);
          uidLoaded = true;
          syncRequests();
        },
      );

      const unsubscribers = [unsubscribeByUid];

      if (profile.email) {
        const unsubscribeByEmail = onSnapshot(
          query(collection(db, 'requests'), where('createdByUserEmail', '==', profile.email)),
          (snapshot) => {
            requestsByEmail.clear();
            snapshot.docs.forEach((requestDoc) => {
              requestsByEmail.set(requestDoc.id, { id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest);
            });
            emailLoaded = true;
            syncRequests();
          },
          (error) => {
            console.error('Firestore Error:', error);
            emailLoaded = true;
            syncRequests();
          },
        );

        unsubscribers.push(unsubscribeByEmail);
      }

      return () => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      };
    }

    const unsubscribe = onSnapshot(
      query(collection(db, 'requests'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        const docs = snapshot.docs.map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest));
        setRequests(docs);
        setLoading(false);
      },
      (error) => {
        console.error('Firestore Error:', error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [profile, isDoctorOrNurse, isAdmin]);

  const filteredRequests = requests.filter(req => {
    const matchesSearch = 
      req.patientData.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.patientData.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.patientData.historyNumber.includes(searchTerm) ||
      req.patientData.personalId.includes(searchTerm) ||
      (req.icdCode || req.diagnosis || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      getRequestActionLabel(req).toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'ყველა' || req.currentStatus === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: RequestStatus) => {
    switch (status) {
      case 'ახალი': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'განხილვაშია': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'დადასტურებულია': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'დასრულებულია': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'უარყოფილია': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusIcon = (status: RequestStatus) => {
    switch (status) {
      case 'ახალი': return <Clock className="w-4 h-4" />;
      case 'განხილვაშია': return <MoreHorizontal className="w-4 h-4" />;
      case 'დადასტურებულია': return <CheckCircle2 className="w-4 h-4" />;
      case 'დასრულებულია': return <CheckCircle2 className="w-4 h-4" />;
      case 'უარყოფილია': return <XCircle className="w-4 h-4" />;
      default: return null;
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            {isRegistrar || isAdmin ? 'შემოსული მოთხოვნები' : 'ჩემი მოთხოვნები'}
          </h2>
          <p className="text-slate-500">პაციენტების გადამისამართების მართვა</p>
        </div>
        
        {(isDoctorOrNurse || isAdmin) && (
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

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
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
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900">{req.patientData.firstName} {req.patientData.lastName}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-lg font-black text-slate-900 bg-slate-50 px-3 py-1 rounded-lg border border-slate-200 inline-block">
                        {req.icdCode || req.diagnosis || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-700">{req.patientData.historyNumber}</div>
                      <div className="text-xs text-slate-400">{req.patientData.personalId}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`text-sm font-medium ${getRequestActionTextClass(req)}`}>
                        {getRequestActionLabel(req)}
                      </div>
                      {req.studyType && <div className="text-xs text-emerald-600 font-bold">{req.studyType}</div>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600">{req.createdByUserName}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border",
                          getStatusColor(req.currentStatus)
                        )}>
                          {getStatusIcon(req.currentStatus)}
                          {req.currentStatus}
                        </span>
                        {req.finalDecision && (
                          <div className={`max-w-xs text-sm font-medium leading-5 whitespace-normal ${getFinalDecisionTextClass(req.finalDecision)}`}>
                            {req.finalDecision}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600">
                        {req.createdAt?.toDate ? format(req.createdAt.toDate(), 'dd.MM.yyyy HH:mm', { locale: ka }) : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
