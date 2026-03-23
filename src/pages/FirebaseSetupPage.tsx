import { AlertTriangle, FileCog } from 'lucide-react';
import { missingFirebaseEnvKeys } from '../firebase';

export default function FirebaseSetupPage() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
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
    </div>
  );
}
