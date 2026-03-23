import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from 'firebase/auth';
import { ACCESS_DENIED_MESSAGE, ALLOWED_EMAILS, getAllowedUserConfig, normalizeEmail } from '../accessControl';
import { useAuth } from '../AuthContext';
import { auth } from '../firebase';
import { AlertCircle, Chrome, ClipboardList, Mail, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const { authError, clearAuthError, loading: authLoading, profile, user } = useAuth();
  const [error, setError] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
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
      if (err?.code === 'auth/unauthorized-domain') {
        setError('Google ავტორიზაციისთვის Firebase Console-ში დაამატე Authorized domain: imed458.github.io');
      } else if (err?.code === 'auth/popup-blocked') {
        setError('ბრაუზერმა popup დაბლოკა. სცადე თავიდან ან გამოიყენე ელ-ფოსტით შესვლა.');
      } else if (err?.code !== 'auth/popup-closed-by-user') {
        setError('Google-ით ავტორიზაცია ვერ მოხერხდა. სცადე თავიდან ან გამოიყენე ელ-ფოსტით შესვლა.');
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

    const normalizedEmail = normalizeEmail(email);
    const allowedUser = getAllowedUserConfig(normalizedEmail);

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
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

        if (fullName.trim()) {
          await updateProfile(credential.user, { displayName: fullName.trim() });
        }
      } else {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
      }
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setError('ეს ელ-ფოსტა უკვე დარეგისტრირებულია. გამოიყენე შესვლა.');
      } else if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
        setError('ელ-ფოსტა ან პაროლი არასწორია.');
      } else if (err?.code === 'auth/user-not-found') {
        setError('ასეთი ანგარიში ვერ მოიძებნა.');
      } else if (err?.code === 'auth/operation-not-allowed') {
        setError('Firebase Console-ში ჩართე Email/Password sign-in provider.');
      } else if (err?.code === 'auth/weak-password') {
        setError('პაროლი სუსტია. სცადე უფრო ძლიერი პაროლი.');
      } else {
        setError(mode === 'register' ? 'რეგისტრაცია ვერ მოხერხდა.' : 'შესვლა ვერ მოხერხდა.');
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
            სისტემაში შესვლა შესაძლებელია Google-ითაც და ელ-ფოსტითაც
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
              <span className="font-semibold">დაშვებული ანგარიშები</span>
            </div>
            <p className="text-sm text-slate-500">
              სისტემაში შედიან მხოლოდ წინასწარ დაშვებული თანამშრომლები. ხელით რეგისტრაციაც იმუშავებს მხოლოდ ამ მეილებზე.
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

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                ან ელ-ფოსტით
              </span>
            </div>
          </div>

          <div className="flex rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              შესვლა
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              რეგისტრაცია
            </button>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            {mode === 'register' && (
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">სახელი და გვარი</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="მაგ: გიორგი იმედაშვილი"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">ელ-ფოსტა</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="imedashviligio27@gmail.com"
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
              {loading || authLoading
                ? 'მიმდინარეობს...'
                : mode === 'register'
                  ? 'რეგისტრაცია ელ-ფოსტით'
                  : 'შესვლა ელ-ფოსტით'}
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
