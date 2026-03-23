import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { writeAuditLogEntry } from '../auditLog';
import { getFirebaseActionErrorMessage } from '../firebaseActionErrors';
import { findIcdEntryByCode, IcdEntry, preloadIcdEntries, searchIcdEntries } from '../icd10Lookup';
import { normalizeIcdCode } from '../icd10Utils';
import { lookupPatientFromSheet } from '../sheetLookup';
import { resolveServerApiUrl } from '../serverApi';
import { ClinicalRequest } from '../types';
import { REQUEST_ACTIONS, CONSENT_STATUSES, DEPARTMENTS } from '../constants';
import { ArrowLeft, FileText, Loader2, Save, Search, User } from 'lucide-react';

export default function NewRequestPage() {
  const { profile, isAdmin, isDoctorOrNurse } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [lookupMessage, setLookupMessage] = useState('');
  const [patientLookupSource, setPatientLookupSource] = useState<'manual' | 'sheet'>('manual');
  const canCreateRequests = isAdmin || isDoctorOrNurse;
  const icdLookupRequestRef = useRef(0);
  const requiresStructuredFields = patientLookupSource === 'sheet';
  const requiresDiagnosisDescription =
    requiresStructuredFields && formData.requestedAction !== 'კვლევა';
  const automaticSenderName = profile?.fullName?.trim() || profile?.email?.split('@')[0] || 'ემერჯენსი';
  const resolvedSenderName = formData.senderName.trim() || automaticSenderName;
  
  const [deptSearch, setDeptSearch] = useState('');
  const [showDeptList, setShowDeptList] = useState(false);
  const [icdSuggestions, setIcdSuggestions] = useState<IcdEntry[]>([]);
  const [activeIcdField, setActiveIcdField] = useState<'code' | 'diagnosis' | null>(null);
  const [icdLoading, setIcdLoading] = useState(false);
  const [icdMessage, setIcdMessage] = useState('');
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    historyNumber: '',
    personalId: '',
    birthDate: '',
    phone: '',
    address: '',
    icdCode: '',
    diagnosis: '',
    requestedAction: REQUEST_ACTIONS[0],
    department: '',
    studyType: '',
    consentStatus: '',
    doctorComment: '',
    senderName: '',
  });

  const filteredDepts = DEPARTMENTS.filter(d => 
    d.toLowerCase().includes(deptSearch.toLowerCase())
  );

  useEffect(() => {
    void preloadIcdEntries();
  }, []);

  const runIcdSearch = async (query: string, field: 'code' | 'diagnosis') => {
    const requestId = icdLookupRequestRef.current + 1;
    icdLookupRequestRef.current = requestId;

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setIcdSuggestions([]);
      setActiveIcdField(null);
      setIcdMessage('');

      if (field === 'code') {
        setFormData((prev) => ({
          ...prev,
          diagnosis: '',
        }));
      }

      return;
    }

    setIcdLoading(true);

    try {
      const [exactCodeEntry, suggestions] = await Promise.all([
        field === 'code' ? findIcdEntryByCode(trimmedQuery) : Promise.resolve(null),
        searchIcdEntries(trimmedQuery),
      ]);

      if (icdLookupRequestRef.current !== requestId) {
        return;
      }

      if (field === 'code') {
        const normalizedCode = normalizeIcdCode(trimmedQuery);

        setFormData((prev) =>
          prev.icdCode === normalizedCode
            ? {
                ...prev,
                diagnosis: exactCodeEntry?.name || '',
              }
            : prev,
        );

        setIcdMessage(
          exactCodeEntry
            ? 'დიაგნოზი ავტომატურად შეივსო ICD-10 ჩამონათვალიდან.'
            : '',
        );
      } else {
        setIcdMessage('');
      }

      setIcdSuggestions(suggestions);
      setActiveIcdField(suggestions.length ? field : null);
    } catch (lookupError) {
      console.error('ICD lookup error:', lookupError);

      if (icdLookupRequestRef.current === requestId) {
        setIcdSuggestions([]);
        setActiveIcdField(null);
        setIcdMessage('ICD-10 ჩამონათვალის ჩატვირთვა ვერ მოხერხდა.');
      }
    } finally {
      if (icdLookupRequestRef.current === requestId) {
        setIcdLoading(false);
      }
    }
  };

  const handleIcdCodeChange = (nextValue: string) => {
    const normalizedCode = normalizeIcdCode(nextValue);

    setFormData((prev) => ({
      ...prev,
      icdCode: normalizedCode,
      diagnosis: normalizedCode === prev.icdCode ? prev.diagnosis : '',
    }));

    void runIcdSearch(normalizedCode, 'code');
  };

  const handleDiagnosisChange = (nextValue: string) => {
    setFormData((prev) => ({
      ...prev,
      diagnosis: nextValue,
    }));

    void runIcdSearch(nextValue, 'diagnosis');
  };

  const handleIcdSuggestionPick = (entry: IcdEntry) => {
    icdLookupRequestRef.current += 1;
    setFormData((prev) => ({
      ...prev,
      icdCode: entry.code,
      diagnosis: entry.name,
    }));
    setIcdSuggestions([]);
    setActiveIcdField(null);
    setIcdMessage('დიაგნოზი ავტომატურად შეივსო ICD-10 ჩამონათვალიდან.');
  };

  const scheduleIcdDropdownClose = () => {
    window.setTimeout(() => {
      setActiveIcdField(null);
    }, 140);
  };

  const handleLookup = async () => {
    if (!formData.historyNumber && !formData.personalId) return;
    
    setSearching(true);
    setLookupMessage('');
    try {
      let settings = null;

      if (db) {
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        settings = settingsSnap.exists() ? settingsSnap.data() : null;
      }

      const directPatient = await lookupPatientFromSheet(
        settings,
        formData.historyNumber,
        formData.personalId,
      );

      if (directPatient) {
        setFormData((prev) => ({
          ...prev,
          ...directPatient,
        }));
        setPatientLookupSource('sheet');
        setLookupMessage('პაციენტის ინფორმაცია წარმატებით ჩაიტვირთა.');
        return;
      }

      const lookupApiUrl = resolveServerApiUrl('/api/external/lookup');

      if (!lookupApiUrl) {
        setPatientLookupSource('manual');
        setLookupMessage('პაციენტი ვერ მოიძებნა. შეგიძლიათ ფორმა ხელით შეავსოთ, ველები სავალდებულო არ არის.');
        return;
      }

      const response = await fetch(lookupApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          historyNumber: formData.historyNumber,
          personalId: formData.personalId,
          settings
        })
      });

      if (response.ok) {
        const patient = await response.json();
        setFormData((prev) => ({
          ...prev,
          ...patient
        }));
        setPatientLookupSource('sheet');
        setLookupMessage('პაციენტის ინფორმაცია წარმატებით ჩაიტვირთა.');
      } else {
        setPatientLookupSource('manual');
        setLookupMessage('პაციენტი ვერ მოიძებნა. შეგიძლიათ ფორმა ხელით შეავსოთ, ველები სავალდებულო არ არის.');
      }
    } catch (err) {
      console.error("Lookup error:", err);
      setPatientLookupSource('manual');
      setLookupMessage('პაციენტის მოძებნა ვერ მოხერხდა. შეგიძლიათ ფორმა ხელით შეავსოთ, ველები სავალდებულო არ არის.');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (!canCreateRequests) {
      setError('ახალი მოთხოვნის შექმნა შეუძლიათ მხოლოდ ექიმს/ექთანს ან ადმინისტრატორს.');
      return;
    }

    if (requiresStructuredFields && formData.requestedAction === 'სტაციონარი' && !formData.department.trim()) {
      setError('სტაციონარის მოთხოვნისთვის განყოფილება სავალდებულოა.');
      return;
    }

    if (requiresStructuredFields && formData.requestedAction === 'კვლევა' && !formData.studyType.trim()) {
      setError('კვლევის მოთხოვნისთვის მიუთითეთ კვლევის ტიპი.');
      return;
    }

    if (requiresDiagnosisDescription && !formData.diagnosis.trim()) {
      setError('ICD-10 კოდის მიხედვით შეავსეთ დიაგნოზის განმარტება.');
      return;
    }
    
    setLoading(true);
    setError('');
    try {
      let settings = null;

      if (db) {
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        settings = settingsSnap.exists() ? settingsSnap.data() : null;
      }

      const requestData: Omit<ClinicalRequest, 'id'> = {
        patientData: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          historyNumber: formData.historyNumber,
          personalId: formData.personalId,
          birthDate: formData.birthDate,
          phone: formData.phone,
          address: formData.address,
        },
        createdByUserId: profile.uid,
        createdByUserName: resolvedSenderName,
        createdByUserEmail: profile.email,
        formFillerName: resolvedSenderName,
        requestedAction: formData.requestedAction,
        department: formData.requestedAction === 'სტაციონარი' ? formData.department : '',
        studyType: formData.studyType,
        consentStatus: formData.consentStatus,
        diagnosis: formData.diagnosis.trim(),
        icdCode: formData.icdCode,
        doctorComment: formData.doctorComment,
        currentStatus: 'ახალი',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      const docRef = await addDoc(collection(db, 'requests'), requestData);

      await writeAuditLogEntry({
        userId: profile.uid,
        userName: profile.fullName,
        requestId: docRef.id,
        actionType: 'CREATE',
        newValue: 'ახალი მოთხოვნა შეიქმნა',
      });

      const sheetSyncUrl = resolveServerApiUrl('/api/external/sync-request');

      if (sheetSyncUrl) {
        try {
          const syncResponse = await fetch(sheetSyncUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              historyNumber: formData.historyNumber,
              personalId: formData.personalId,
              icdCode: formData.icdCode,
              requestedAction: formData.requestedAction,
              department: formData.department,
              consentStatus: formData.consentStatus,
              settings,
            }),
          });

          if (!syncResponse.ok) {
            const syncError = await syncResponse.json().catch(() => null);
            console.error('Sheet sync error:', syncError);
          }
        } catch (sheetSyncError) {
          console.error('Sheet sync request failed:', sheetSyncError);
        }
      }

      navigate('/');
    } catch (err) {
      console.error("Submit error:", err);
      setError(
        getFirebaseActionErrorMessage(err, {
          fallback: 'მოთხოვნის გაგზავნა ვერ მოხერხდა.',
          permissionDenied:
            'ამ ანგარიშით მოთხოვნის გაგზავნა ვერ მოხერხდა, რადგან Firestore-ში write წვდომა არ არის ნებადართული.',
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  if (profile && !canCreateRequests) {
    return (
      <div className="w-full max-w-none space-y-6 pb-12">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-slate-500" />
          </button>
          <h2 className="text-2xl font-bold text-slate-900">ახალი მოთხოვნის შექმნა</h2>
        </div>

        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-6 space-y-3">
          <h3 className="text-lg font-bold text-slate-900">წვდომა შეზღუდულია</h3>
          <p className="text-slate-600">
            ახალი მოთხოვნის შექმნა შეუძლიათ მხოლოდ ექიმს/ექთანს ან ადმინისტრატორს.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl font-bold"
          >
            მთავარ გვერდზე დაბრუნება
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-6 pb-12">
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-slate-500" />
        </button>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">ახალი მოთხოვნის შექმნა</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {(error || lookupMessage) && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${
            error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}>
            {error || lookupMessage}
          </div>
        )}

        {/* Patient Info Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
            <User className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-slate-700">პაციენტის მონაცემები</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">ისტორიის ნომერი</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    required={requiresStructuredFields}
                    className="flex-1 px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={formData.historyNumber}
                    onChange={(e) => setFormData({ ...formData, historyNumber: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={handleLookup}
                    disabled={searching}
                    className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-slate-700 transition-colors hover:bg-slate-200 sm:px-4"
                  >
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    ძებნა
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">პირადი ნომერი</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.personalId}
                  onChange={(e) => setFormData({ ...formData, personalId: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">სახელი</label>
                <input
                  type="text"
                  required={requiresStructuredFields}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">გვარი</label>
                <input
                  type="text"
                  required={requiresStructuredFields}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">დაბადების თარიღი</label>
                <input
                  type="date"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.birthDate}
                  onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">ტელეფონი</label>
                <input
                  type="tel"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">მისამართი</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Clinical Info Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-slate-700">კლინიკური ინფორმაცია</h3>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 relative">
                <label className="text-sm font-bold text-slate-700">ICD-10 კოდი</label>
                <input
                  type="text"
                  required={requiresStructuredFields}
                  placeholder="მაგ: R10.4"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.icdCode}
                  onChange={(e) => handleIcdCodeChange(e.target.value)}
                  onFocus={() => {
                    if (formData.icdCode.trim()) {
                      void runIcdSearch(formData.icdCode, 'code');
                    }
                  }}
                  onBlur={scheduleIcdDropdownClose}
                />
                {activeIcdField === 'code' && icdSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {icdSuggestions.map((entry) => (
                      <button
                        key={entry.code}
                        type="button"
                        className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleIcdSuggestionPick(entry)}
                      >
                        <span className="min-w-[5rem] text-xs font-black text-emerald-700">{entry.code}</span>
                        <span className="text-sm text-slate-700">{entry.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 relative">
                <label className="text-sm font-bold text-slate-700">
                  დიაგნოზის განმარტება
                  {formData.requestedAction === 'კვლევა' && (
                    <span className="ml-2 text-xs font-medium text-slate-400">(კვლევის შემთხვევაში არჩევითი)</span>
                  )}
                </label>
                <input
                  type="text"
                  required={requiresDiagnosisDescription}
                  placeholder="აირჩიეთ ICD-10 კოდი ან მოძებნეთ დიაგნოზით"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.diagnosis}
                  onChange={(e) => handleDiagnosisChange(e.target.value)}
                  onFocus={() => {
                    if (formData.diagnosis.trim()) {
                      void runIcdSearch(formData.diagnosis, 'diagnosis');
                    }
                  }}
                  onBlur={scheduleIcdDropdownClose}
                />
                {activeIcdField === 'diagnosis' && icdSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {icdSuggestions.map((entry) => (
                      <button
                        key={`${entry.code}-diagnosis`}
                        type="button"
                        className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleIcdSuggestionPick(entry)}
                      >
                        <span className="min-w-[5rem] text-xs font-black text-emerald-700">{entry.code}</span>
                        <span className="text-sm text-slate-700">{entry.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {(icdLoading || icdMessage) && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${
                icdMessage.includes('ვერ მოხერხდა')
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}>
                {icdLoading ? 'ICD-10 ჩამონათვალი იტვირთება...' : icdMessage}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">მოთხოვნილი მოქმედება</label>
                <div className="flex flex-wrap gap-2">
                  {REQUEST_ACTIONS.map(action => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => setFormData({ ...formData, requestedAction: action })}
                      className={`px-4 py-2 rounded-xl font-bold transition-all ${
                        formData.requestedAction === action 
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>

              {formData.requestedAction === 'სტაციონარი' && (
                <div className="space-y-2 relative">
                  <label className="text-sm font-bold text-slate-700">განყოფილება</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="მოძებნეთ განყოფილება..."
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={deptSearch || formData.department}
                      onFocus={() => setShowDeptList(true)}
                      onChange={(e) => {
                        setDeptSearch(e.target.value);
                        setShowDeptList(true);
                      }}
                    />
                    {showDeptList && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-auto">
                        {filteredDepts.map(dept => (
                          <button
                            key={dept}
                            type="button"
                            className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm"
                            onClick={() => {
                              setFormData({ ...formData, department: dept });
                              setDeptSearch(dept);
                              setShowDeptList(false);
                            }}
                          >
                            {dept}
                          </button>
                        ))}
                        {filteredDepts.length === 0 && (
                          <div className="px-4 py-2 text-sm text-slate-400">განყოფილება ვერ მოიძებნა</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {formData.requestedAction === 'კვლევა' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">კვლევის ტიპი</label>
                  <input
                    type="text"
                    placeholder="მაგ: მუცლის ღრუს CT"
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={formData.studyType}
                    onChange={(e) => setFormData({ ...formData, studyType: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-sm font-bold text-slate-700">
                  პაციენტის თანხმობა / უარი
                  <span className="ml-2 text-xs font-medium text-slate-400">(არასავალდებულო)</span>
                </label>
                {formData.consentStatus && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, consentStatus: '' })}
                    className="text-sm font-bold text-slate-500 hover:text-slate-700"
                  >
                    მონიშვნის გასუფთავება
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">
                მიუთითეთ მხოლოდ საჭიროების შემთხვევაში, ძირითადად უარის შემთხვევებში.
              </p>
              <div className="flex flex-wrap gap-3">
                {CONSENT_STATUSES.map(status => (
                  <label 
                    key={status} 
                    className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl border transition-all ${
                      formData.consentStatus === status
                      ? (status.startsWith('უარი') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700')
                      : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="consent"
                      className="hidden"
                      checked={formData.consentStatus === status}
                      onChange={() => setFormData({ ...formData, consentStatus: status })}
                    />
                    <span className={`text-sm font-bold ${formData.consentStatus === status ? '' : 'text-slate-600'}`}>
                      {status}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">ექიმის/ექთნის კომენტარი</label>
              <textarea
                rows={3}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                value={formData.doctorComment}
                onChange={(e) => setFormData({ ...formData, doctorComment: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                გამომგზავნის სახელი
                <span className="ml-2 text-xs font-medium text-slate-400">(არასავალდებულო)</span>
              </label>
              <input
                type="text"
                placeholder={`ავტომატურად: ${automaticSenderName}`}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                value={formData.senderName}
                onChange={(e) => setFormData({ ...formData, senderName: e.target.value })}
              />
              <p className="text-xs text-slate-400">
                თუ ხელით არ ჩაწერთ, დარჩება მიმდინარე ავტომატური გამომგზავნი.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-full rounded-xl px-6 py-3 font-bold text-slate-600 transition-colors hover:bg-slate-100 sm:w-auto"
          >
            გაუქმება
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-8 py-3 font-bold text-white transition-all shadow-lg shadow-emerald-100 hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            მოთხოვნის გაგზავნა
          </button>
        </div>
      </form>
    </div>
  );
}
