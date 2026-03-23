import { Link, useNavigate } from 'react-router-dom';
import { getRoleLabel } from '../accessControl';
import { useAuth } from '../AuthContext';
import { auth } from '../firebase';
import { ClipboardList, FilePlus, LayoutDashboard, LogOut, Settings, User } from 'lucide-react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin, isDoctorOrNurse } = useAuth();
  const navigate = useNavigate();

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
              <h1 className="text-xl font-bold text-slate-900 hidden sm:block">
                კლინიკის მართვის სისტემა
              </h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full">
                <User className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-700">{profile?.fullName}</span>
                <span className="text-xs text-slate-500 font-bold">({getRoleLabel(profile?.role)})</span>
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
            <Link
              to="/"
              className="flex items-center gap-3 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg font-medium transition-colors"
            >
              <LayoutDashboard className="w-5 h-5 text-slate-400" />
              მთავარი პანელი
            </Link>
            
            {(isDoctorOrNurse || isAdmin) && (
              <Link
                to="/new-request"
                className="flex items-center gap-3 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                <FilePlus className="w-5 h-5 text-slate-400" />
                ახალი მოთხოვნა
              </Link>
            )}

            {isAdmin && (
              <Link
                to="/settings"
                className="flex items-center gap-3 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                <Settings className="w-5 h-5 text-slate-400" />
                პარამეტრები
              </Link>
            )}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 overflow-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
