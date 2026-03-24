import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { getRoleLabel } from '../accessControl';
import { useAuth } from '../AuthContext';
import { auth, db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useArchiveMaintenance } from '../useArchiveMaintenance';
import { Archive, ChevronLeft, ChevronRight, ClipboardList, FilePlus, LayoutDashboard, LogOut, Settings, User } from 'lucide-react';
import { ClinicalRequest } from '../types';

const SIDEBAR_STORAGE_KEY = 'registrationhtmc.sidebar-collapsed';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, isDoctorOrNurse } = useAuth();
  const navigate = useNavigate();
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const appLogoUrl = `${import.meta.env.BASE_URL}clinic-transfer-logo.png?v=20260324e`;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  });

  useArchiveMaintenance(Boolean(profile));

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

          return hasPendingApproval ? total + 1 : total;
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
              <div className="flex max-w-[13rem] items-center gap-2 rounded-full bg-slate-100 px-3 py-1 sm:max-w-none">
                <User className="h-4 w-4 flex-shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700">{profile?.fullName}</div>
                  <div className="truncate text-[11px] font-bold text-slate-500 sm:hidden">
                    {getRoleLabel(profile?.role)}
                  </div>
                </div>
                <span className="hidden text-xs font-bold text-slate-500 sm:inline">
                  ({getRoleLabel(profile?.role)})
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
          className={`hidden border-r border-slate-200 bg-white p-3 transition-all duration-200 md:sticky md:top-16 md:block md:h-[calc(100vh-4rem)] md:shrink-0 ${
            isSidebarCollapsed ? 'md:w-20' : 'md:w-60'
          }`}
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
            
            {(isDoctorOrNurse || isAdmin) && (
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

            {isAdmin && (
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
                    <span className="ml-auto">{pendingApprovalBadge}</span>
                  </>
                )}
              </NavLink>
            )}

            {isAdmin && (
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

        <main className="flex-1 min-w-0 overflow-auto p-4 pb-24 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8">
          {children}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur md:hidden">
        <div className={`grid gap-2 ${isAdmin ? 'grid-cols-5' : 'grid-cols-3'}`}>
          <NavLink to="/" className={mobileNavItemClassName}>
            <LayoutDashboard className="h-5 w-5" />
            <span className="text-xs">მთავარი</span>
          </NavLink>

          {(isDoctorOrNurse || isAdmin) ? (
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

          {isAdmin ? (
            <NavLink to="/admin-requests" className={mobileNavItemClassName}>
              <div className="relative">
                <ClipboardList className="h-5 w-5" />
                {pendingApprovalBadge && (
                  <span className="absolute -right-2 -top-2">
                    {pendingApprovalBadge}
                  </span>
                )}
              </div>
              <span className="text-xs">მოთხოვნები</span>
            </NavLink>
          ) : null}

          {isAdmin ? (
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
