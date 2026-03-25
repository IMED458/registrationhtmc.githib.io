import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { resolveUserDisplayName } from './accessControl';
import { isArchivedRequest } from './archiveUtils';
import { db } from './firebase';
import { enablePushNotifications, supportsServiceWorkerNotifications, syncExistingPushNotifications } from './pushNotifications';
import { normalizeRequestStatus, resolveRequestStatusFromRequest } from './requestStatusUtils';
import { ClinicalRequest, UserProfile } from './types';

const APP_TITLE = 'კლინიკის მართვის სისტემა';
const NOTIFICATION_ICON_URL = `${import.meta.env.BASE_URL}favicon-32x32.png?v=20260325a`;

type NotificationPermissionState = NotificationPermission | 'unsupported';

type RequestMeta = {
  finalDecision: string;
  hasPendingApproval: boolean;
  status: string;
};

type RequestNotificationPayload = {
  body: string;
  tag: string;
  title: string;
};

export type InAppNotification = RequestNotificationPayload & {
  id: string;
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

function requestBelongsToCurrentUser(request: ClinicalRequest, profile: UserProfile) {
  return request.createdByUserId === profile.uid || request.createdByUserEmail === profile.email;
}

function buildDoctorStatusNotification(request: ClinicalRequest): RequestNotificationPayload {
  const patientFullName = getPatientFullName(request);
  const resolvedStatus = normalizeRequestStatus(resolveRequestStatusFromRequest(request));
  const finalDecision = (request.finalDecision || '').trim();
  const statusSummary = finalDecision
    ? `სტატუსი: ${resolvedStatus} • გადაწყვეტილება: ${finalDecision}`
    : `სტატუსი: ${resolvedStatus}`;

  return {
    title: 'პაციენტის სტატუსი განახლდა',
    body: `${patientFullName} • ${statusSummary}`,
    tag: `doctor-status-${request.id}-${request.updatedAt?.seconds ?? 'now'}`,
  };
}

function isPendingAdminConfirmation(request: ClinicalRequest) {
  return request.adminConfirmationStatus === 'pending' &&
    Boolean(request.pendingRegistrarUpdate || request.pendingDoctorEdit);
}

type UseRequestNotificationsOptions = {
  isAdmin: boolean;
  isDoctorOrNurse: boolean;
  isRegistrar: boolean;
  profile: UserProfile | null;
};

export function useRequestNotifications({
  profile,
  isAdmin,
  isDoctorOrNurse,
  isRegistrar,
}: UseRequestNotificationsOptions) {
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() => getNotificationPermission());
  const [backgroundNotificationCount, setBackgroundNotificationCount] = useState(0);
  const [inAppNotifications, setInAppNotifications] = useState<InAppNotification[]>([]);
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

    if (!profile || !db || (!isRegistrar && !isAdmin && !isDoctorOrNurse)) {
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
            finalDecision: (request.finalDecision || '').trim(),
            hasPendingApproval: isPendingAdminConfirmation(request),
            status: normalizeRequestStatus(resolveRequestStatusFromRequest(request)),
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
            return;
          }

          if (
            isDoctorOrNurse &&
            requestBelongsToCurrentUser(request, profile) &&
            previousRequest &&
            (
              previousRequest.status !== meta.status ||
              previousRequest.finalDecision !== meta.finalDecision
            )
          ) {
            queuedNotifications.push(buildDoctorStatusNotification(request));
          }
        });

        previousRequestsRef.current = nextRequests;

        if (!hasHydratedSnapshotRef.current) {
          hasHydratedSnapshotRef.current = true;
          return;
        }

        if (!queuedNotifications.length || !isPageInBackground()) {
          if (queuedNotifications.length && !isPageInBackground()) {
            const nextToastNotifications = queuedNotifications.map((payload, index) => ({
              ...payload,
              id: `${payload.tag}-${Date.now()}-${index}`,
            }));

            setInAppNotifications((current) => [
              ...nextToastNotifications,
              ...current,
            ].slice(0, 4));

            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              navigator.vibrate?.([120, 60, 120]);
            }
          }

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
  }, [isAdmin, isDoctorOrNurse, isRegistrar, notificationPermission, profile]);

  useEffect(() => {
    if (!inAppNotifications.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setInAppNotifications((current) => current.slice(0, -1));
    }, 7000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [inAppNotifications]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    void syncExistingPushNotifications(profile);
  }, [profile]);

  const requestNotificationPermission = async () => {
    if (!supportsBrowserNotifications()) {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }

    const result = await enablePushNotifications(profile);
    const permission = result.permission;
    setNotificationPermission(permission);

    if (permission === 'granted') {
      const notification = new window.Notification('შეტყობინებები ჩართულია', {
        body: supportsServiceWorkerNotifications()
          ? 'ახლა ახალი მოთხოვნა, სტატუსის ცვლილება ან დასადასტურებელი ჩანაწერი ბრაუზერში და ჰოუმ სქრინ აპშიც შეგახსენდება.'
          : 'ახლა ახალი მოთხოვნა, სტატუსის ცვლილება ან დასადასტურებელი ჩანაწერი ბრაუზერში შეგახსენდება.',
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
    dismissInAppNotification: (id: string) => {
      setInAppNotifications((current) => current.filter((notification) => notification.id !== id));
    },
    inAppNotifications,
    notificationPermission,
    requestNotificationPermission,
    supportsNotifications: supportsBrowserNotifications(),
  };
}
