import { FormEvent, useState } from 'react';
import { AlertTriangle, FileCog, Loader2, Search } from 'lucide-react';
import { missingFirebaseEnvKeys } from '../firebase';

export default function FirebaseSetupPage() {
  const [historyNumber, setHistoryNumber] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookupResult, setLookupResult] = useState<null | {
    firstName: string;
    lastName: string;
    historyNumber: string;
    personalId: string;
    birthDate?: string;
    phone?: string;
    address?: string;
  }>(null);

  const handleLookup = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setLookupError('');
    setLookupResult(null);

    try {
      const response = await fetch('/api/external/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          historyNumber,
          personalId,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || 'მონაცემის წამოღება ვერ მოხერხდა.');
      }

      setLookupResult(payload);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : 'მონაცემის წამოღება ვერ მოხერხდა.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 inline-flex rounded-2xl bg-amber-100 p-4 text-amber-700">
            <FileCog className="h-10 w-10" />
          </div>

          <h1 className="text-3xl font-bold text-slate-900">აპი ჩაიტვირთა, მაგრამ Firebase ჯერ არ არის გამართული</h1>
          <p className="mt-3 text-slate-600">
            ამიტომ ავტორიზაცია და მონაცემების ბაზა დროებით გამორთულია. როგორც კი დაგვჭირდება,
            უბრალოდ შევავსებთ `.env.local` ფაილს და საიტი ჩვეულებრივ იმუშავებს.
          </p>

          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                ახლა აკლია ეს ცვლადები:
                <div className="mt-2 flex flex-wrap gap-2">
                  {missingFirebaseEnvKeys.map((key) => (
                    <span
                      key={key}
                      className="rounded-full border border-amber-300 bg-white px-3 py-1 font-mono text-xs text-amber-700"
                    >
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-slate-900 p-4 text-sm text-slate-100">
            <div className="font-semibold">შემდეგი ნაბიჯი</div>
            <div className="mt-2 font-mono text-xs text-slate-300">
              /Users/giorgiimedashvili/Documents/New project/registrationhtmc/.env.local
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900">Google Sheet სატესტო ძებნა</h2>
          <p className="mt-2 text-slate-600">
            ქვემოთ უკვე მუშაობს იმ Sheet-დან წამოღება, რომელიც მომწერე. შეგიძლია გადაამოწმო `ისტ N` ან `პირადი N`-ით.
          </p>

          <form onSubmit={handleLookup} className="mt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="text"
                value={historyNumber}
                onChange={(event) => setHistoryNumber(event.target.value)}
                placeholder="ისტ N"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
              />
              <input
                type="text"
                value={personalId}
                onChange={(event) => setPersonalId(event.target.value)}
                placeholder="პირადი N"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading || (!historyNumber.trim() && !personalId.trim())}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              მოძებნე პაციენტი
            </button>
          </form>

          {lookupError && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {lookupError}
            </div>
          )}

          {lookupResult && (
            <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="text-lg font-bold text-slate-900">
                {lookupResult.firstName} {lookupResult.lastName}
              </div>
              <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                <div>ისტორია: {lookupResult.historyNumber || '-'}</div>
                <div>პირადი ნომერი: {lookupResult.personalId || '-'}</div>
                <div>დაბადების თარიღი: {lookupResult.birthDate || '-'}</div>
                <div>ტელეფონი: {lookupResult.phone || '-'}</div>
                <div className="md:col-span-2">მისამართი: {lookupResult.address || '-'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
