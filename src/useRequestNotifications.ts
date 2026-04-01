import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { resolveUserDisplayName } from './accessControl';
import { isArchivedRequest } from './archiveUtils';
import { db } from './firebase';
import { enablePushNotifications, syncExistingPushNotifications } from './pushNotifications';
import { normalizeRequestStatus, resolveRequestStatusFromRequest } from './requestStatusUtils';
import { ClinicalRequest, UserProfile } from './types';

const APP_TITLE = 'კლინიკის მართვის სისტემა';
const NOTIFICATION_ICON_URL = `${import.meta.env.BASE_URL}favicon-32x32.png?v=20260325a`;

type NotificationPermissionState = NotificationPermission | 'unsupported';

type RequestMeta = {
  adminFeedActivity: string;
  doctorEditActivity: string;
  finalDecision: string;
  hasPendingApproval: boolean;
  registrarActivity: string;
  requiresRegistrarAction: boolean;
  status: string;
};

type RequestNotificationPayload = {
  body: string;
  requestId: string;
  tag: string;
  targetPath: string;
  title: string;
  variant: 'registrar' | 'admin' | 'doctor';
};

export type InAppNotification = RequestNotificationPayload & {
  id: string;
};

function supportsBrowserNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function isMobileNotificationsDevice() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  const isTouchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent) || isTouchMac;
}

function supportsDesktopBrowserNotifications() {
  return supportsBrowserNotifications() && !isMobileNotificationsDevice();
}

function isPageInBackground() {
  return typeof document !== 'undefined' && document.visibilityState !== 'visible';
}

function getNotificationPermission(): NotificationPermissionState {
  if (!supportsDesktopBrowserNotifications()) {
    return 'unsupported';
  }

  return window.Notification.permission;
}

function getPatientFullName(request: ClinicalRequest) {
  return `${request.patientData.lastName} ${request.patientData.firstName}`.trim() || 'უცნობი პაციენტი';
}

function getRequestTargetPath(requestId: string) {
  return `/request/${requestId}`;
}

function getNotificationTargetUrl(targetPath: string) {
  if (typeof window === 'undefined') {
    return targetPath;
  }

  if (window.location.hostname.endsWith('github.io')) {
    return `${window.location.origin}/registrationhtmc.githib.io/docs/#${targetPath}`;
  }

  return `${window.location.origin}${targetPath}`;
}

function navigateToNotificationTarget(targetPath: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const targetUrl = getNotificationTargetUrl(targetPath);
  window.focus();

  if (window.location.href !== targetUrl) {
    window.location.href = targetUrl;
  }
}

function playInAppAlertTone(variant: RequestNotificationPayload['variant']) {
  if (typeof window === 'undefined') {
    return;
  }

  const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return;
  }

  try {
    const audioContext = new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const frequencyByVariant: Record<RequestNotificationPayload['variant'], number> = {
      registrar: 740,
      admin: 620,
      doctor: 880,
    };

    oscillator.type = 'sine';
    oscillator.frequency.value = frequencyByVariant[variant];
    gainNode.gain.value = 0.0001;

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    const now = audioContext.currentTime;
    gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    oscillator.start(now);
    oscillator.stop(now + 0.24);

    oscillator.onended = () => {
      void audioContext.close().catch(() => {});
    };
  } catch (error) {
    console.warn('In-app alert tone skipped:', error);
  }
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
  const registrarEditComment = request.pendingDoctorEdit?.comment?.trim();

  if (request.requiresRegistrarAction && registrarEditComment) {
    return {
      title: 'მოთხოვნა განახლდა',
      body: `${patientFullName} • ${registrarEditComment}`,
      requestId: request.id,
      tag: `registrar-update-${request.id}-${request.updatedAt?.seconds ?? 'now'}`,
      targetPath: getRequestTargetPath(request.id),
      variant: 'registrar',
    };
  }

  return {
    title: 'ახალი მოთხოვნა',
    body: `${patientFullName} • ${summary} • გამომგზავნი: ${sender}`,
    requestId: request.id,
    tag: `registrar-request-${request.id}-${request.createdAt?.seconds ?? 'now'}`,
    targetPath: getRequestTargetPath(request.id),
    variant: 'registrar',
  };
}

function buildAdminNotification(request: ClinicalRequest): RequestNotificationPayload {
  const patientFullName = getPatientFullName(request);
  const requestedBy =
    request.pendingRegistrarUpdate?.requestedByUserName ||
    request.pendingDoctorEdit?.editedByUserName ||
    resolveUserDisplayName(request.createdByUserName, request.createdByUserEmail) ||
    'თანამშრომელი';
  const requiresApproval = isPendingAdminConfirmation(request);

  return {
    title: requiresApproval ? 'ახალი დადასტურება' : 'ახალი ცვლილება',
    body: requiresApproval
      ? `${patientFullName} • ცვლილება ელოდება დადასტურებას • ${requestedBy}`
      : `${patientFullName} • ცვლილება დაფიქსირდა • ${requestedBy}`,
    requestId: request.id,
    tag: `${requiresApproval ? 'admin-approval' : 'admin-update'}-${request.id}-${request.updatedAt?.seconds ?? 'now'}`,
    targetPath: getRequestTargetPath(request.id),
    variant: 'admin',
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
    title: 'მოთხოვნა განახლდა',
    body: `${patientFullName} • ${statusSummary}`,
    requestId: request.id,
    tag: `doctor-status-${request.id}-${request.updatedAt?.seconds ?? 'now'}`,
    targetPath: getRequestTargetPath(request.id),
    variant: 'doctor',
  };
}

function isPendingAdminConfirmation(request: ClinicalRequest) {
  return request.adminConfirmationStatus === 'pending' &&
    Boolean(request.pendingRegistrarUpdate || request.pendingDoctorEdit);
}

function getTimestampSignature(timestamp: any) {
  if (!timestamp) {
    return '';
  }

  if (typeof timestamp.toMillis === 'function') {
    return String(timestamp.toMillis());
  }

  if (typeof timestamp.seconds === 'number') {
    return String((timestamp.seconds * 1000) + Math.floor((timestamp.nanoseconds || 0) / 1000000));
  }

  return String(timestamp);
}

type UseRequestNotificationsOptions = {
  canReceiveRequestNotifications: boolean;
  isAdmin: boolean;
  isRegistrar: boolean;
  profile: UserProfile | null;
};

export function useRequestNotifications({
  canReceiveRequestNotifications,
  profile,
  isAdmin,
  isRegistrar,
}: UseRequestNotificationsOptions) {
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() => getNotificationPermission());
  const [backgroundNotificationCount, setBackgroundNotificationCount] = useState(0);
  const [inAppNotifications, setInAppNotifications] = useState<InAppNotification[]>([]);
  const activeBrowserNotificationsRef = useRef<Notification[]>([]);
  const previousRequestsRef = useRef<Map<string, RequestMeta>>(new Map());
  const hasHydratedSnapshotRef = useRef(false);

  const closeActiveBrowserNotifications = () => {
    activeBrowserNotificationsRef.current.forEach((notification) => {
      try {
        notification.close();
      } catch (error) {
        console.warn('Browser notification close skipped:', error);
      }
    });

    activeBrowserNotificationsRef.current = [];
  };

  const trackBrowserNotification = (notification: Notification) => {
    activeBrowserNotificationsRef.current = [...activeBrowserNotificationsRef.current, notification];
    notification.onclose = () => {
      activeBrowserNotificationsRef.current = activeBrowserNotificationsRef.current.filter((item) => item !== notification);
    };
  };

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
        setInAppNotifications([]);
        closeActiveBrowserNotifications();
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
    if (!profile || notificationPermission !== 'granted' || !supportsDesktopBrowserNotifications()) {
      return;
    }

    void syncExistingPushNotifications(profile);
  }, [notificationPermission, profile]);

  useEffect(() => {
    previousRequestsRef.current = new Map();
    hasHydratedSnapshotRef.current = false;

    if (!profile || !db || (!isRegistrar && !isAdmin && !canReceiveRequestNotifications)) {
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
            adminFeedActivity: [
              getTimestampSignature(request.pendingRegistrarUpdate?.requestedAt),
              getTimestampSignature(request.pendingDoctorEdit?.editedAt),
              String(request.adminConfirmationStatus || ''),
              String(Boolean(request.requiresRegistrarAction)),
            ].join('|'),
            doctorEditActivity: [
              getTimestampSignature(request.lastDoctorEditAt),
              String(request.pendingDoctorEdit?.comment || ''),
              String(request.pendingDoctorEdit?.editedByUserId || ''),
              String(Boolean(request.requiresRegistrarAction)),
            ].join('|'),
            finalDecision: (request.finalDecision || '').trim(),
            hasPendingApproval: isPendingAdminConfirmation(request),
            registrarActivity: [
              getTimestampSignature(request.lastRegistrarEditAt),
              (request.registrarComment || '').trim(),
              (request.registrarName || '').trim(),
              (request.formFillerName || '').trim(),
            ].join('|'),
            requiresRegistrarAction: Boolean(request.requiresRegistrarAction),
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

          if (
            isRegistrar &&
            previousRequest &&
            request.createdByUserId !== profile.uid &&
            meta.requiresRegistrarAction &&
            previousRequest.doctorEditActivity !== meta.doctorEditActivity
          ) {
            queuedNotifications.push(buildRegistrarNotification(request));
            return;
          }

          if (
            isAdmin &&
            previousRequest &&
            previousRequest.adminFeedActivity !== meta.adminFeedActivity &&
            (meta.hasPendingApproval || Boolean(request.pendingDoctorEdit) || Boolean(request.pendingRegistrarUpdate))
          ) {
            queuedNotifications.push(buildAdminNotification(request));
            return;
          }

          if (
            canReceiveRequestNotifications &&
            requestBelongsToCurrentUser(request, profile) &&
            previousRequest &&
            (
              previousRequest.status !== meta.status ||
              previousRequest.finalDecision !== meta.finalDecision ||
              (
                Boolean(meta.registrarActivity) &&
                previousRequest.registrarActivity !== meta.registrarActivity
              )
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

        if (!supportsDesktopBrowserNotifications()) {
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

            playInAppAlertTone(nextToastNotifications[0]?.variant || 'doctor');
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
            data: {
              requestId: payload.requestId,
              targetPath: payload.targetPath,
            },
            icon: NOTIFICATION_ICON_URL,
            badge: NOTIFICATION_ICON_URL,
            tag: payload.tag,
            requireInteraction: true,
          });

          notification.onclick = () => {
            navigateToNotificationTarget(payload.targetPath);
            notification.close();
          };
          trackBrowserNotification(notification);
        });
      },
      (error) => {
        console.error('Background notification sync failed:', error);
      },
    );

    return unsubscribe;
  }, [canReceiveRequestNotifications, isAdmin, isRegistrar, notificationPermission, profile]);

  const requestNotificationPermission = async () => {
    if (!supportsDesktopBrowserNotifications()) {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }

    let permission: NotificationPermissionState;

    if (profile) {
      try {
        const result = await enablePushNotifications(profile);
        permission = result.permission;
      } catch (error) {
        console.warn('Push notification enable failed, falling back to browser permission:', error);
        permission = await window.Notification.requestPermission();
      }
    } else {
      permission = await window.Notification.requestPermission();
    }

    setNotificationPermission(permission);

    if (permission === 'granted') {
      const notification = new window.Notification('შეტყობინებები ჩართულია', {
        body: 'ახლა ახალი მოთხოვნა და ცვლილებები შეტყობინებად გამოჩნდება, მათ შორის მაშინაც თუ სხვა თაბზე ხართ.',
        icon: NOTIFICATION_ICON_URL,
        badge: NOTIFICATION_ICON_URL,
        tag: 'notifications-enabled',
        requireInteraction: true,
      });
      trackBrowserNotification(notification);
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
    supportsNotifications: supportsDesktopBrowserNotifications(),
  };
}
