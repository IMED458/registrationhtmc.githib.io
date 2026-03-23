type FirebaseActionErrorMessages = {
  fallback?: string;
  permissionDenied?: string;
  unauthenticated?: string;
  unavailable?: string;
  failedPrecondition?: string;
};

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return '';
  }

  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : '';
}

export function getFirebaseActionErrorMessage(
  error: unknown,
  messages: FirebaseActionErrorMessages = {},
) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'ინტერნეტკავშირი არ არის. გადაამოწმეთ კავშირი და სცადეთ თავიდან.';
  }

  switch (getErrorCode(error)) {
    case 'permission-denied':
      return (
        messages.permissionDenied ||
        'ამ მოქმედებისთვის საჭირო წვდომა არ გაქვთ. თუ პრობლემა გაგრძელდა, გადაამოწმეთ Firebase Rules.'
      );
    case 'unauthenticated':
    case 'auth/user-token-expired':
      return messages.unauthenticated || 'სესია დასრულდა. გთხოვთ თავიდან შეხვიდეთ სისტემაში.';
    case 'unavailable':
    case 'deadline-exceeded':
      return messages.unavailable || 'სერვერთან კავშირი დროებით მიუწვდომელია. სცადეთ თავიდან.';
    case 'failed-precondition':
      return (
        messages.failedPrecondition ||
        'სისტემა ჯერ ბოლომდე არ არის კონფიგურირებული. გადაამოწმეთ Firebase-ის პარამეტრები.'
      );
    default:
      return messages.fallback || 'ოპერაცია ვერ შესრულდა.';
  }
}
