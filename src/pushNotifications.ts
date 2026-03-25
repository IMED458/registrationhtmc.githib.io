import { arrayUnion, doc, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app, db, firebaseVapidPublicKey, isFirebaseConfigured } from './firebase';
import { UserProfile } from './types';

const PUSH_SERVICE_WORKER_PATH = `${import.meta.env.BASE_URL}firebase-messaging-sw.js`;
const PUSH_SERVICE_WORKER_SCOPE = import.meta.env.BASE_URL || '/';

export function supportsServiceWorkerNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

async function registerPushServiceWorker() {
  if (!supportsServiceWorkerNotifications()) {
    throw new Error('Service worker notifications are not supported in this browser.');
  }

  return navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH, {
    scope: PUSH_SERVICE_WORKER_SCOPE,
  });
}

export async function enablePushNotifications(profile: UserProfile | null) {
  if (!profile || !db || !app || !isFirebaseConfigured || !firebaseVapidPublicKey) {
    return {
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      token: '',
      supported: false,
    };
  }

  if (!supportsServiceWorkerNotifications()) {
    return {
      permission: 'unsupported' as const,
      token: '',
      supported: false,
    };
  }

  const messagingSupported = await isSupported();

  if (!messagingSupported) {
    return {
      permission: Notification.permission,
      token: '',
      supported: false,
    };
  }

  const permission = await Notification.requestPermission();

  if (permission !== 'granted') {
    return {
      permission,
      token: '',
      supported: true,
    };
  }

  const serviceWorkerRegistration = await registerPushServiceWorker();
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: firebaseVapidPublicKey,
    serviceWorkerRegistration,
  });

  if (token) {
    await setDoc(
      doc(db, 'users', profile.uid),
      {
        notificationTokens: arrayUnion(token),
      },
      { merge: true },
    );
  }

  return {
    permission,
    token,
    supported: true,
  };
}

export async function syncExistingPushNotifications(profile: UserProfile | null) {
  if (!profile || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }

  try {
    await enablePushNotifications(profile);
  } catch (error) {
    console.warn('Push notification sync skipped:', error);
  }
}
