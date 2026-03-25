/* global importScripts, firebase, clients, self */

importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBQL2i2q7KXXxwhU06UOyuU7x1kqUFrutE',
  authDomain: 'registration-ee52c.firebaseapp.com',
  projectId: 'registration-ee52c',
  storageBucket: 'registration-ee52c.firebasestorage.app',
  messagingSenderId: '928812647061',
  appId: '1:928812647061:web:f66356597e6136dee9919c',
  measurementId: 'G-L8SNCB6EZV',
});

const messaging = firebase.messaging();
const APP_ICON_URL = './favicon-32x32.png?v=20260325b';
const DEFAULT_APP_URL = `${self.location.origin}/registrationhtmc.githib.io/docs/`;

function resolveNotificationUrl(payload) {
  const directUrl =
    payload?.data?.url ||
    payload?.fcmOptions?.link ||
    payload?.notification?.click_action;

  if (directUrl) {
    return directUrl;
  }

  const requestId = payload?.data?.requestId;

  if (requestId) {
    return `${self.location.origin}/registrationhtmc.githib.io/docs/#/request/${requestId}`;
  }

  return DEFAULT_APP_URL;
}

messaging.onBackgroundMessage((payload) => {
  const title =
    payload?.notification?.title ||
    payload?.data?.title ||
    'კლინიკის მართვის სისტემა';
  const body =
    payload?.notification?.body ||
    payload?.data?.body ||
    'პაციენტის ჩანაწერზე ახალი განახლებაა.';

  self.registration.showNotification(title, {
    body,
    icon: APP_ICON_URL,
    badge: APP_ICON_URL,
    tag: payload?.data?.tag || payload?.notification?.tag || `request-update-${Date.now()}`,
    data: {
      url: resolveNotificationUrl(payload),
    },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || DEFAULT_APP_URL;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return Promise.resolve();
    }),
  );
});
