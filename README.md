# კლინიკის გადამისამართების სისტემა

`React + Vite + Firebase` აპლიკაცია კლინიკური მოთხოვნების სამართავად.

## ფუნქციები

- `Google Sign-In only` ავტორიზაცია
- მკაცრი დაშვება მხოლოდ 3 წინასწარ განსაზღვრულ მომხმარებელზე
- მოთხოვნის შექმნა, დათვალიერება, სტატუსის განახლება და ბეჭდვა
- Audit log და ადმინისტრატორის პარამეტრები
- Google Sheets-დან პაციენტის ძებნის სერვერული endpoint

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

თუ პაციენტის ძებნა უნდა კითხულობდეს დაცულ Google Sheet-ს, დაამატეთ `GOOGLE_SERVICE_ACCOUNT_JSON` გარემოს ცვლადი.
