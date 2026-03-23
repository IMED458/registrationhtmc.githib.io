import { NavLink, useNavigate } from 'react-router-dom';
import { getRoleLabel } from '../accessControl';
import { useAuth } from '../AuthContext';
import { auth } from '../firebase';
import { ClipboardList, FilePlus, LayoutDashboard, LogOut, Settings, User } from 'lucide-react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, isDoctorOrNurse } = useAuth();
  const navigate = useNavigate();

  const navItemClassName = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 font-medium transition-colors ${
      isActive
        ? 'bg-emerald-50 text-emerald-700'
        : 'text-slate-700 hover:bg-slate-100'
    }`;

  const mobileNavItemClassName = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center transition-colors ${
      isActive
        ? 'bg-emerald-50 text-emerald-700'
        : 'text-slate-500 hover:bg-slate-100'
    }`;

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
              <div className="bg-emerald-600 p-2 rounded-lg">
                <ClipboardList className="text-white w-6 h-6" />
              </div>
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
        <aside className="hidden md:block md:w-72 md:shrink-0 md:border-r md:border-slate-200 md:bg-white md:p-4 md:space-y-2 md:sticky md:top-16 md:h-[calc(100vh-4rem)]">
          <nav className="space-y-1">
            <NavLink
              to="/"
              className={navItemClassName}
            >
              <LayoutDashboard className="w-5 h-5 text-slate-400" />
              მთავარი პანელი
            </NavLink>
            
            {(isDoctorOrNurse || isAdmin) && (
              <NavLink
                to="/new-request"
                className={navItemClassName}
              >
                <FilePlus className="w-5 h-5 text-slate-400" />
                ახალი მოთხოვნა
              </NavLink>
            )}

            {isAdmin && (
              <NavLink
                to="/settings"
                className={navItemClassName}
              >
                <Settings className="w-5 h-5 text-slate-400" />
                პარამეტრები
              </NavLink>
            )}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 overflow-auto p-4 pb-24 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8">
          {children}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-3 gap-2">
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

          {isAdmin ? (
            <NavLink to="/settings" className={mobileNavItemClassName}>
              <Settings className="h-5 w-5" />
              <span className="text-xs">ადმინი</span>
            </NavLink>
          ) : (
            <div className="rounded-xl px-2 py-2 text-center text-xs font-medium text-slate-300">
              პარამეტრები
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
