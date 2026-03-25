import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { resolveUserDisplayName } from './accessControl';
import { isArchivedRequest } from './archiveUtils';
import { db } from './firebase';
import { ClinicalRequest, UserProfile } from './types';

const APP_TITLE = 'კლინიკის მართვის სისტემა';
const NOTIFICATION_ICON_URL = `${import.meta.env.BASE_URL}favicon-32x32.png?v=20260325a`;

type NotificationPermissionState = NotificationPermission | 'unsupported';

type RequestMeta = {
  hasPendingApproval: boolean;
};

type RequestNotificationPayload = {
  body: string;
  tag: string;
  title: string;
};

function supportsBrowserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function isPageInBackground() {
  return typeof document !== 'undefined' && document.visibilityState !== 'visible';
}

function getNotificationPermission(): NotificationPermissionState {
  if (!supportsBrowserNotifications()) {
    return 'unsupported';
  }

  return window.Notification.permission;
}

function getPatientFullName(request: ClinicalRequest) {
  return `${request.patientData.lastName} ${request.patientData.firstName}`.trim() || 'უცნობი პაციენტი';
}

function getRequestSummary(request: ClinicalRequest) {
  if (request.consentStatus?.startsWith('უარი')) {
    return request.consentStatus;
  }

  if (request.requestedAction === 'სტაციონარი' && request.department?.trim()) {
    return request.department.trim();
  }

  if (request.requestedAction === 'კვლევა') {
    if (request.studyTypes?.length) {
      return request.studyTypes.join(', ');
    }

    if (request.studyType?.trim()) {
      return request.studyType.trim();
    }
  }

  return request.requestedAction;
}

function buildRegistrarNotification(request: ClinicalRequest): RequestNotificationPayload {
  const patientFullName = getPatientFullName(request);
  const sender = resolveUserDisplayName(request.createdByUserName, request.createdByUserEmail) || 'თანამშრომელი';
  const summary = getRequestSummary(request);

  return {
    title: 'ახალი მოთხოვნა',
    body: `${patientFullName} • ${summary} • გამომგზავნი: ${sender}`,
    tag: `registrar-request-${request.id}-${request.createdAt?.seconds ?? 'now'}`,
  };
}

function buildAdminNotification(request: ClinicalRequest): RequestNotificationPayload {
  const patientFullName = getPatientFullName(request);
  const requestedBy =
    request.pendingRegistrarUpdate?.requestedByUserName ||
    request.pendingDoctorEdit?.editedByUserName ||
    resolveUserDisplayName(request.createdByUserName, request.createdByUserEmail) ||
    'თანამშრომელი';

  return {
    title: 'ახალი დადასტურება',
    body: `${patientFullName} • ცვლილება ელოდება დადასტურებას • ${requestedBy}`,
    tag: `admin-approval-${request.id}-${request.updatedAt?.seconds ?? 'now'}`,
  };
}

function isPendingAdminConfirmation(request: ClinicalRequest) {
  return request.adminConfirmationStatus === 'pending' &&
    Boolean(request.pendingRegistrarUpdate || request.pendingDoctorEdit);
}

type UseRequestNotificationsOptions = {
  isAdmin: boolean;
  isRegistrar: boolean;
  profile: UserProfile | null;
};

export function useRequestNotifications({
  profile,
  isAdmin,
  isRegistrar,
}: UseRequestNotificationsOptions) {
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() => getNotificationPermission());
  const [backgroundNotificationCount, setBackgroundNotificationCount] = useState(0);
  const previousRequestsRef = useRef<Map<string, RequestMeta>>(new Map());
  const hasHydratedSnapshotRef = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.title = backgroundNotificationCount > 0
      ? `(${backgroundNotificationCount}) ${APP_TITLE}`
      : APP_TITLE;

    return () => {
      document.title = APP_TITLE;
    };
  }, [backgroundNotificationCount]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const clearUnreadNotifications = () => {
      if (!isPageInBackground()) {
        setBackgroundNotificationCount(0);
      }
    };

    document.addEventListener('visibilitychange', clearUnreadNotifications);
    window.addEventListener('focus', clearUnreadNotifications);

    return () => {
      document.removeEventListener('visibilitychange', clearUnreadNotifications);
      window.removeEventListener('focus', clearUnreadNotifications);
    };
  }, []);

  useEffect(() => {
    previousRequestsRef.current = new Map();
    hasHydratedSnapshotRef.current = false;

    if (!profile || !db || (!isRegistrar && !isAdmin)) {
      return;
    }

    const unsubscribe = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
        const nextRequests = new Map<string, RequestMeta>();
        const queuedNotifications: RequestNotificationPayload[] = [];

        snapshot.docs.forEach((requestDoc) => {
          const request = { id: requestDoc.id, ...requestDoc.data() } as ClinicalRequest;

          if (isArchivedRequest(request)) {
            return;
          }

          const meta: RequestMeta = {
            hasPendingApproval: isPendingAdminConfirmation(request),
          };

          nextRequests.set(request.id, meta);

          if (!hasHydratedSnapshotRef.current) {
            return;
          }

          const previousRequest = previousRequestsRef.current.get(request.id);

          if (isRegistrar && !previousRequest && request.createdByUserId !== profile.uid) {
            queuedNotifications.push(buildRegistrarNotification(request));
            return;
          }

          if (isAdmin && meta.hasPendingApproval && !previousRequest?.hasPendingApproval) {
            queuedNotifications.push(buildAdminNotification(request));
          }
        });

        previousRequestsRef.current = nextRequests;

        if (!hasHydratedSnapshotRef.current) {
          hasHydratedSnapshotRef.current = true;
          return;
        }

        if (!queuedNotifications.length || !isPageInBackground()) {
          return;
        }

        queuedNotifications.forEach((payload) => {
          setBackgroundNotificationCount((current) => current + 1);

          if (notificationPermission !== 'granted' || !supportsBrowserNotifications()) {
            return;
          }

          const notification = new window.Notification(payload.title, {
            body: payload.body,
            icon: NOTIFICATION_ICON_URL,
            badge: NOTIFICATION_ICON_URL,
            tag: payload.tag,
          });

          notification.onclick = () => {
            window.focus();
            notification.close();
          };

          window.setTimeout(() => notification.close(), 10000);
        });
      },
      (error) => {
        console.error('Background notification sync failed:', error);
      },
    );

    return unsubscribe;
  }, [isAdmin, isRegistrar, notificationPermission, profile]);

  const requestNotificationPermission = async () => {
    if (!supportsBrowserNotifications()) {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }

    const permission = await window.Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === 'granted') {
      const notification = new window.Notification('შეტყობინებები ჩართულია', {
        body: 'ახლა ახალი მოთხოვნა ან დასადასტურებელი ცვლილება ბრაუზერში შეგახსენდება.',
        icon: NOTIFICATION_ICON_URL,
        badge: NOTIFICATION_ICON_URL,
        tag: 'notifications-enabled',
      });

      window.setTimeout(() => notification.close(), 5000);
    }

    return permission;
  };

  return {
    backgroundNotificationCount,
    notificationPermission,
    requestNotificationPermission,
    supportsNotifications: supportsBrowserNotifications(),
  };
}
