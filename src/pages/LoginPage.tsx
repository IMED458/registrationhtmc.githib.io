import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { ALLOWED_EMAILS, getAllowedUserConfig } from '../accessControl';
import { useAuth } from '../AuthContext';
import { auth } from '../firebase';
import { AlertCircle, Chrome, ClipboardList, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const { authError, clearAuthError, loading: authLoading, profile, user } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (user && profile) {
      navigate('/');
    }
  }, [navigate, profile, user]);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  const handleGoogleLogin = async () => {
    clearAuthError();
    setLoading(true);
    setError('');

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError('Google-ით ავტორიზაცია ვერ მოხერხდა. სცადეთ თავიდან.');
      }

      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 space-y-8 border border-slate-100">
        <div className="text-center">
          <div className="inline-flex bg-emerald-600 p-4 rounded-2xl mb-4 shadow-lg shadow-emerald-200">
            <ClipboardList className="text-white w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">კლინიკის სისტემა</h1>
          <p className="text-slate-500 mt-2">
            სისტემაში შესვლა შესაძლებელია მხოლოდ Google ანგარიშით
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-slate-700">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <span className="font-semibold">რეგისტრაცია გამორთულია</span>
            </div>
            <p className="text-sm text-slate-500">
              სისტემაში შედიან მხოლოდ წინასწარ დაშვებული თანამშრომლები.
            </p>
            <div className="space-y-2">
              {ALLOWED_EMAILS.map((email) => {
                const allowedUser = getAllowedUserConfig(email);

                return (
                  <div
                    key={email}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-slate-700">{email}</span>
                    <span className="text-xs font-bold uppercase text-emerald-700">
                      {allowedUser?.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading || authLoading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-xl transition-all shadow-sm disabled:opacity-50"
          >
            <Chrome className="w-5 h-5 text-blue-500" />
            {loading || authLoading ? 'მიმდინარეობს...' : 'Google-ით შესვლა'}
          </button>
        </div>
        
        <div className="text-center text-xs text-slate-400">
          © 2026 კლინიკის შიდა მართვის სისტემა
        </div>
      </div>
    </div>
  );
}
