import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { getAllowedUserConfig, getRoleLabel } from '../accessControl';
import { useAuth } from '../AuthContext';
import { auth, db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useArchiveMaintenance } from '../useArchiveMaintenance';
import { InAppNotification, useRequestNotifications } from '../useRequestNotifications';
import { useSheetPatientBackfill } from '../useSheetPatientBackfill';
import { Archive, BellRing, ChevronLeft, ChevronRight, ClipboardList, FilePlus, LayoutDashboard, LogOut, Settings, ShieldCheck, Stethoscope, User, X } from 'lucide-react';
import { ClinicalRequest } from '../types';

const SIDEBAR_STORAGE_KEY = 'registrationhtmc.sidebar-collapsed';

function getInAppNotificationStyles(notification: InAppNotification) {
  switch (notification.variant) {
    case 'registrar':
      return {
        cardClassName: 'border-emerald-300 bg-emerald-50/95 shadow-emerald-200/70',
        badgeClassName: 'bg-emerald-100 text-emerald-700',
        titleClassName: 'text-emerald-950',
        bodyClassName: 'text-emerald-900/85',
        accentClassName: 'bg-emerald-500',
        Icon: ClipboardList,
      };
    case 'admin':
      return {
        cardClassName: 'border-amber-300 bg-amber-50/95 shadow-amber-200/70',
        badgeClassName: 'bg-amber-100 text-amber-700',
        titleClassName: 'text-amber-950',
        bodyClassName: 'text-amber-900/85',
        accentClassName: 'bg-amber-500',
        Icon: ShieldCheck,
      };
    default:
      return {
        cardClassName: 'border-sky-300 bg-sky-50/95 shadow-sky-200/70',
        badgeClassName: 'bg-sky-100 text-sky-700',
        titleClassName: 'text-sky-950',
        bodyClassName: 'text-sky-900/85',
        accentClassName: 'bg-sky-500',
        Icon: Stethoscope,
      };
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const {
    profile,
    isAdmin,
    canCreateRequests,
    canAccessRequestsModule,
    canAccessAdminPanel,
    canReceiveRequestNotifications,
    isRegistrar,
  } = useAuth();
  const navigate = useNavigate();
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const appLogoUrl = `${import.meta.env.BASE_URL}clinic-transfer-logo.png?v=20260329a`;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  });
  const profileRoleLabel = getAllowedUserConfig(profile?.email)?.label || getRoleLabel(profile?.role);

  useArchiveMaintenance(Boolean(profile));
  useSheetPatientBackfill(Boolean(profile));

  const {
    dismissInAppNotification,
    inAppNotifications,
    notificationPermission,
    requestNotificationPermission,
    supportsNotifications,
  } = useRequestNotifications({
    canReceiveRequestNotifications,
    profile,
    isAdmin,
    isRegistrar,
  });

  const shouldShowNotificationButton =
    supportsNotifications &&
    Boolean(profile) &&
    notificationPermission !== 'granted';

  useEffect(() => {
    if (!isAdmin || !db) {
      setPendingApprovalCount(0);
      return;
    }

    const unsubscribe = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
          const count = snapshot.docs.reduce((total, requestDoc) => {
            const request = requestDoc.data() as ClinicalRequest;
            const hasPendingApproval =
              request.adminConfirmationStatus === 'pending' &&
              Boolean(request.pendingRegistrarUpdate || request.pendingDoctorEdit);
            const hasInformationalUpdate =
              (Boolean(request.pendingDoctorEdit) || Boolean(request.pendingRegistrarUpdate)) &&
              !hasPendingApproval;

          return hasPendingApproval || hasInformationalUpdate ? total + 1 : total;
        }, 0);

        setPendingApprovalCount(count);
      },
      () => {
        setPendingApprovalCount(0);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  const pendingApprovalBadge = pendingApprovalCount > 0
    ? (
        <span className="inline-flex min-w-[1.35rem] items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
          {pendingApprovalCount > 99 ? '99+' : pendingApprovalCount}
        </span>
      )
    : null;

  const desktopSidebarWidthClass = isSidebarCollapsed ? 'md:w-20' : 'md:w-60';
  const desktopMainOffsetClass = isSidebarCollapsed ? 'md:ml-20' : 'md:ml-60';

  const navItemClassName = ({ isActive }: { isActive: boolean }) =>
    `flex items-center rounded-lg px-3 py-2 font-medium transition-colors ${
      isActive
        ? 'bg-emerald-50 text-emerald-700'
        : 'text-slate-700 hover:bg-slate-100'
    } ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`;

  const mobileNavItemClassName = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center transition-colors ${
      isActive
        ? 'bg-emerald-50 text-emerald-700'
        : 'text-slate-500 hover:bg-slate-100'
    }`;

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => {
      const nextValue = !current;

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextValue ? '1' : '0');
      }

      return nextValue;
    });
  };

  const handleLogout = async () => {
    if (!auth) {
      navigate('/login');
      return;
    }

    await auth.signOut();
    navigate('/login');
  };

  const handleNotificationOpen = (notification: InAppNotification) => {
    dismissInAppNotification(notification.id);
    navigate(notification.targetPath);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <img
                src={appLogoUrl}
                alt="კლინიკის ლოგო"
                className="h-12 w-12 object-contain"
              />
              <h1 className="hidden text-xl font-bold text-slate-900 sm:block">
                კლინიკის მართვის სისტემა
              </h1>
              <h1 className="text-lg font-bold text-slate-900 sm:hidden">
                კლინიკა
              </h1>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              {shouldShowNotificationButton && (
                <button
                  type="button"
                  onClick={requestNotificationPermission}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-black text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 sm:text-xs"
                  title="ბრაუზერის შეტყობინებების ჩართვა"
                >
                  <BellRing className="h-4 w-4" />
                  {notificationPermission === 'denied'
                    ? 'შეტყობინებები ბრაუზერში ჩართე'
                    : 'შეტყობინებების ჩართვა'}
                </button>
              )}
              <div className="flex max-w-[13rem] items-center gap-2 rounded-full bg-slate-100 px-3 py-1 sm:max-w-none">
                <User className="h-4 w-4 flex-shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700">{profile?.fullName}</div>
                  <div className="truncate text-[11px] font-bold text-slate-500 sm:hidden">
                    {profileRoleLabel}
                  </div>
                </div>
                <span className="hidden text-xs font-bold text-slate-500 sm:inline">
                  ({profileRoleLabel})
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="გასვლა"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 w-full min-h-0">
        <aside
          className={`relative z-20 hidden border-r border-slate-200 bg-white p-3 transition-all duration-200 md:fixed md:inset-y-16 md:left-0 md:block ${desktopSidebarWidthClass}`}
        >
          <div className={`mb-4 flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between gap-3'}`}>
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-wide text-slate-400">
                  ნავიგაცია
                </div>
                <div className="text-sm font-semibold text-slate-700">
                  მთავარი მენიუ
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={toggleSidebar}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
              title={isSidebarCollapsed ? 'პანელის გაშლა' : 'პანელის შეკეცვა'}
            >
              {isSidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>
          </div>

          <nav className="space-y-1">
            <NavLink
              to="/"
              className={navItemClassName}
              title="მთავარი პანელი"
            >
              <LayoutDashboard className="w-5 h-5 text-slate-400" />
              {!isSidebarCollapsed && 'მთავარი პანელი'}
            </NavLink>
            
            {canCreateRequests && (
              <NavLink
                to="/new-request"
                className={navItemClassName}
                title="ახალი მოთხოვნა"
              >
                <FilePlus className="w-5 h-5 text-slate-400" />
                {!isSidebarCollapsed && 'ახალი მოთხოვნა'}
              </NavLink>
            )}

            <NavLink
              to="/archive"
              className={navItemClassName}
              title="არქივი"
            >
              <Archive className="w-5 h-5 text-slate-400" />
              {!isSidebarCollapsed && 'არქივი'}
            </NavLink>

            {canAccessRequestsModule && (
              <NavLink
                to="/admin-requests"
                className={navItemClassName}
                title="მოთხოვნები"
              >
                <div className="relative">
                  <ClipboardList className="w-5 h-5 text-slate-400" />
                  {isSidebarCollapsed && pendingApprovalBadge && (
                    <span className="absolute -right-2 -top-2">
                      {pendingApprovalBadge}
                    </span>
                  )}
                </div>
                {!isSidebarCollapsed && (
                  <>
                    <span>მოთხოვნები</span>
                    <span className="ml-auto">{isAdmin ? pendingApprovalBadge : null}</span>
                  </>
                )}
              </NavLink>
            )}

            {canAccessAdminPanel && (
              <NavLink
                to="/settings"
                className={navItemClassName}
                title="პარამეტრები"
              >
                <Settings className="w-5 h-5 text-slate-400" />
                {!isSidebarCollapsed && 'პარამეტრები'}
              </NavLink>
            )}
          </nav>
        </aside>

        <main className={`relative z-0 flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 pb-24 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8 ${desktopMainOffsetClass}`}>
          {children}
        </main>
      </div>

      {inAppNotifications.length > 0 && (
        <div className="pointer-events-none fixed inset-x-3 top-20 z-[60] flex flex-col gap-3 sm:right-6 sm:left-auto sm:w-full sm:max-w-sm">
          {inAppNotifications.map((notification) => {
            const styles = getInAppNotificationStyles(notification);
            const Icon = styles.Icon;

            return (
            <div
              key={notification.id}
              role="button"
              tabIndex={0}
              onClick={() => handleNotificationOpen(notification)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleNotificationOpen(notification);
                }
              }}
              className={`pointer-events-auto relative overflow-hidden rounded-2xl border p-4 text-left shadow-2xl backdrop-blur transition hover:scale-[1.01] hover:shadow-2xl ${styles.cardClassName}`}
            >
              <span className={`absolute inset-y-0 left-0 w-1.5 ${styles.accentClassName}`} />
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 rounded-full p-2 ${styles.badgeClassName}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-black ${styles.titleClassName}`}>
                    {notification.title}
                  </div>
                  <div className={`mt-1 text-sm leading-5 ${styles.bodyClassName}`}>
                    {notification.body}
                  </div>
                  <div className="mt-2 text-[11px] font-black uppercase tracking-wide text-slate-500">
                    შეეხე და გახსენი პაციენტის ჩანაწერი
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissInAppNotification(notification.id);
                  }}
                  className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  title="დახურვა"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )})}
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur md:hidden">
        <div
          className={`grid gap-2 ${
            canAccessAdminPanel
              ? 'grid-cols-5'
              : canAccessRequestsModule
                ? 'grid-cols-4'
                : 'grid-cols-3'
          }`}
        >
          <NavLink to="/" className={mobileNavItemClassName}>
            <LayoutDashboard className="h-5 w-5" />
            <span className="text-xs">მთავარი</span>
          </NavLink>

          {canCreateRequests ? (
            <NavLink to="/new-request" className={mobileNavItemClassName}>
              <FilePlus className="h-5 w-5" />
              <span className="text-xs">მოთხოვნა</span>
            </NavLink>
          ) : (
            <div className="rounded-xl px-2 py-2 text-center text-xs font-medium text-slate-300">
              მოთხოვნა
            </div>
          )}

          <NavLink to="/archive" className={mobileNavItemClassName}>
            <Archive className="h-5 w-5" />
            <span className="text-xs">არქივი</span>
          </NavLink>

          {canAccessRequestsModule ? (
            <NavLink to="/admin-requests" className={mobileNavItemClassName}>
              <div className="relative">
                <ClipboardList className="h-5 w-5" />
                {isAdmin && pendingApprovalBadge && (
                  <span className="absolute -right-2 -top-2">
                    {pendingApprovalBadge}
                  </span>
                )}
              </div>
              <span className="text-xs">მოთხოვნები</span>
            </NavLink>
          ) : null}

          {canAccessAdminPanel ? (
            <NavLink to="/settings" className={mobileNavItemClassName}>
              <Settings className="h-5 w-5" />
              <span className="text-xs">ადმინი</span>
            </NavLink>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
