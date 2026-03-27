# კლინიკის გადამისამართების სისტემა

`React + Vite + Firebase` აპლიკაცია კლინიკური მოთხოვნების სამართავად.

## ფუნქციები

- `Google` ან `ელ-ფოსტა/პაროლით` ავტორიზაცია
- მკაცრი დაშვება მხოლოდ 3 წინასწარ განსაზღვრულ მომხმარებელზე
- მოთხოვნის შექმნა, დათვალიერება, სტატუსის განახლება და ბეჭდვა
- Audit log და ადმინისტრატორის პარამეტრები
- Google Sheets-დან პაციენტის ძებნის და H/I სვეტების ჩაწერის backend endpoint

## დაშვებული მომხმარებლები

- `imedashviligio27@gmail.com` - ადმინისტრატორი
- `eringorokva@gmail.com` - ექიმი/ექთანი
- `emergencyhtmc14@gmail.com` - რეგისტრატურა

## გაშვება

1. დააინსტალირეთ დამოკიდებულებები: `npm install`
2. შეავსეთ `.env.local` ფაილი `.env.example`-ის მიხედვით
3. Firebase Console-ში ჩართეთ `Authentication > Google`
4. გაუშვით პროექტი: `npm run dev`

## Firebase deploy ფაილები

- Firestore rules: `firestore.rules`
- Firestore indexes: `firestore.indexes.json`
- Firebase config: `firebase.json`

## Google Sheets backend

- Firebase Functions კოდი დევს `functions/` საქაღალდეში
- ლოკალურად API მუშაობს `npm run dev`-ით (`server.ts`)
- live GitHub Pages-დან backend-ზე გასასვლელად build environment-ში უნდა შეივსოს `VITE_SERVER_API_BASE_URL`
- Firebase Functions deploy: `npm run deploy:functions`

თუ პაციენტის ძებნა უნდა კითხულობდეს დაცულ Google Sheet-ს, backend გარემოში დაამატეთ `GOOGLE_SERVICE_ACCOUNT_JSON` ან გაუზიარეთ Sheet შესაბამის Google service account-ს.

## უფასო Google Apps Script sync

- მზა Apps Script ფაილი დევს `scripts/google-apps-script-sync.gs`
- Google Sheet-თან უფასო ჩაწერისთვის შექმენით `Apps Script` ამ ფაილის კოდით
- Deploy -> `New deployment` -> `Web app`
- `Execute as`: `Me`
- `Who has access`: `Anyone`
- მიღებული `.../exec` ბმული ჩასვით ადმინის გვერდზე ველში `Google Apps Script Web App URL`

ამის შემდეგ live საიტიდან მოთხოვნის შექმნისას და რედაქტირებისას:
- ICD კოდი ჩაიწერება `H` სვეტში
- `ბინა` ან განყოფილება, მაგალითად `კარდიოლოგია`, ჩაიწერება `I` სვეტში
