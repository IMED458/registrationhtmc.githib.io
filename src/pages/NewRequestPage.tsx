import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { ClinicalRequest } from '../types';
import { REQUEST_ACTIONS, CONSENT_STATUSES, DEPARTMENTS } from '../constants';
import { ArrowLeft, FileText, Loader2, Save, Search, User } from 'lucide-react';

export default function NewRequestPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [lookupMessage, setLookupMessage] = useState('');
  
  const [deptSearch, setDeptSearch] = useState('');
  const [showDeptList, setShowDeptList] = useState(false);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    historyNumber: '',
    personalId: '',
    birthDate: '',
    phone: '',
    address: '',
    icdCode: '',
    requestedAction: REQUEST_ACTIONS[0],
    department: '',
    studyType: '',
    consentStatus: CONSENT_STATUSES[0],
    doctorComment: ''
  });

  const filteredDepts = DEPARTMENTS.filter(d => 
    d.toLowerCase().includes(deptSearch.toLowerCase())
  );

  const handleLookup = async () => {
    if (!formData.historyNumber && !formData.personalId) return;
    
    setSearching(true);
    setLookupMessage('');
    try {
      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      const settings = settingsSnap.exists() ? settingsSnap.data() : null;

      const response = await fetch('/api/external/lookup', {
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
        setFormData(prev => ({
          ...prev,
          ...patient
        }));
        setLookupMessage('პაციენტის ინფორმაცია წარმატებით ჩაიტვირთა.');
      } else {
        setLookupMessage('პაციენტი ვერ მოიძებნა ან გარე წყარო ჯერ არ არის გამართული.');
      }
    } catch (err) {
      console.error("Lookup error:", err);
      setLookupMessage('პაციენტის მოძებნა ვერ მოხერხდა. შეგიძლიათ ველები ხელით შეავსოთ.');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    if (formData.requestedAction === 'სტაციონარი' && !formData.department.trim()) {
      setError('სტაციონარის მოთხოვნისთვის განყოფილება სავალდებულოა.');
      return;
    }

    if (formData.requestedAction === 'კვლევა' && !formData.studyType.trim()) {
      setError('კვლევის მოთხოვნისთვის მიუთითეთ კვლევის ტიპი.');
      return;
    }
    
    setLoading(true);
    setError('');
    try {
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
        createdByUserName: profile.fullName,
        requestedAction: formData.requestedAction,
        department: formData.requestedAction === 'სტაციონარი' ? formData.department : '',
        studyType: formData.studyType,
        consentStatus: formData.consentStatus,
        diagnosis: formData.icdCode, // Use ICD code as diagnosis
        icdCode: formData.icdCode,
        doctorComment: formData.doctorComment,
        currentStatus: 'ახალი',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      const docRef = await addDoc(collection(db, 'requests'), requestData);
      
      await addDoc(collection(db, 'audit_logs'), {
        userId: profile.uid,
        userName: profile.fullName,
        requestId: docRef.id,
        actionType: 'CREATE',
        newValue: 'ახალი მოთხოვნა შეიქმნა',
        createdAt: Timestamp.now()
      });

      navigate('/');
    } catch (err) {
      console.error("Submit error:", err);
      setError("მოთხოვნის გაგზავნა ვერ მოხერხდა.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-slate-500" />
        </button>
        <h2 className="text-2xl font-bold text-slate-900">ახალი მოთხოვნის შექმნა</h2>
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    className="flex-1 px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={formData.historyNumber}
                    onChange={(e) => setFormData({ ...formData, historyNumber: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={handleLookup}
                    disabled={searching}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors flex items-center gap-2"
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
                  required
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">გვარი</label>
                <input
                  type="text"
                  required
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
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">ICD-10 კოდი (დიაგნოზი)</label>
                <input
                  type="text"
                  required
                  placeholder="მაგ: I10"
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                  value={formData.icdCode}
                  onChange={(e) => setFormData({ ...formData, icdCode: e.target.value })}
                />
              </div>
            </div>

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
              <label className="text-sm font-bold text-slate-700">პაციენტის თანხმობა / უარი</label>
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
          </div>
        </div>

        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-colors"
          >
            გაუქმება
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-100 flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            მოთხოვნის გაგზავნა
          </button>
        </div>
      </form>
    </div>
  );
}
