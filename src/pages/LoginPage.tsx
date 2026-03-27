import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { ACCESS_DENIED_MESSAGE, getAllowedUserConfig, normalizeEmail } from '../accessControl';
import { useAuth } from '../AuthContext';
import { auth } from '../firebase';
import { AlertCircle, Chrome, ClipboardList, Mail } from 'lucide-react';

export default function LoginPage() {
  const { authError, clearAuthError, loading: authLoading, profile, user } = useAuth();
  const [error, setError] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
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
    if (!auth) {
      setError('Firebase ავტორიზაცია ჯერ არ არის მზად.');
      return;
    }

    clearAuthError();
    setLoading(true);
    setError('');

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const useRedirectFlow = window.location.hostname.endsWith('github.io');

      if (useRedirectFlow) {
        await signInWithRedirect(auth, provider);
        return;
      }

      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('');
      } else {
        setError('შესვლა ვერ მოხერხდა.');
      }

      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    if (!auth) {
      setError('Firebase ავტორიზაცია ჯერ არ არის მზად.');
      return;
    }

    const normalizedIdentifier = normalizeEmail(identifier);
    const allowedUser = getAllowedUserConfig(normalizedIdentifier);

    if (!allowedUser) {
      setError(ACCESS_DENIED_MESSAGE);
      return;
    }

    if (password.trim().length < 6) {
      setError('პაროლი უნდა იყოს მინიმუმ 6 სიმბოლო.');
      return;
    }

    clearAuthError();
    setLoading(true);
    setError('');

    try {
      await signInWithEmailAndPassword(auth, allowedUser.email, password);
    } catch (err: any) {
      if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
        setError('მომხმარებელი/ელ-ფოსტა ან პაროლი არასწორია.');
      } else if (err?.code === 'auth/user-not-found') {
        setError('ასეთი ანგარიში ვერ მოიძებნა.');
      } else if (err?.code === 'auth/operation-not-allowed') {
        setError('Firebase Console-ში ჩართე Email/Password sign-in provider.');
      } else {
        setError('შესვლა ვერ მოხერხდა.');
      }

      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-xl sm:p-8 sm:space-y-8">
        <div className="text-center">
          <div className="mb-4 inline-flex rounded-2xl bg-emerald-600 p-3 shadow-lg shadow-emerald-200 sm:p-4">
            <ClipboardList className="text-white w-10 h-10" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">კლინიკის სისტემა</h1>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            სისტემაში შესვლა შეუძლიათ მხოლოდ წინასწარ განსაზღვრულ თანამშრომლებს
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          <button
            onClick={handleGoogleLogin}
            disabled={loading || authLoading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-xl transition-all shadow-sm disabled:opacity-50"
          >
            <Chrome className="w-5 h-5 text-blue-500" />
            {loading || authLoading ? 'მიმდინარეობს...' : 'შესვლა'}
          </button>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">მომხმარებელი ან ელ-ფოსტა</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="staff@clinic.local ან username"
                  className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">პაროლი</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="მინიმუმ 6 სიმბოლო"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="button"
              onClick={handleEmailAuth}
              disabled={loading || authLoading}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading || authLoading ? 'მიმდინარეობს...' : 'შესვლა'}
            </button>
          </div>
        </div>
        
        <div className="text-center text-xs text-slate-400">
          © 2026 კლინიკის შიდა მართვის სისტემა
        </div>
      </div>
    </div>
  );
}
