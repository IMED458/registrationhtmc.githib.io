import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ACCESS_DENIED_MESSAGE, getAllowedUserConfig, normalizeEmail, resolveUserDisplayName } from './accessControl';
import { auth, db, isFirebaseConfigured } from './firebase';
import { SystemSettings, UserProfile } from './types';

interface AuthContextType {
  authError: string;
  clearAuthError: () => void;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  canEditAdminContent: boolean;
  canCreateRequests: boolean;
  canAccessRequestsModule: boolean;
  canAccessAdminPanel: boolean;
  canApproveAdminChanges: boolean;
  isDoctorOrNurse: boolean;
  isRegistrar: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getDisabledEmails(settings: Partial<SystemSettings> | null | undefined) {
  if (!Array.isArray(settings?.disabledEmails)) {
    return [];
  }

  return settings.disabledEmails
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authError, setAuthError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !db) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) {
        return;
      }

      setLoading(true);

      try {
        if (!firebaseUser) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        const allowedUser = getAllowedUserConfig(firebaseUser.email);

        if (!allowedUser) {
          setUser(null);
          setProfile(null);
          setAuthError(ACCESS_DENIED_MESSAGE);
          await signOut(auth);
          setLoading(false);
          return;
        }

        try {
          const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
          const settings = settingsSnap.exists()
            ? (settingsSnap.data() as Partial<SystemSettings>)
            : null;

          if (getDisabledEmails(settings).includes(allowedUser.email)) {
            setUser(null);
            setProfile(null);
            setAuthError('ამ ანგარიშის წვდომა ადმინისტრატორმა გათიშა.');
            await signOut(auth);
            setLoading(false);
            return;
          }
        } catch (settingsError) {
          console.warn('System settings read failed during auth check:', settingsError);
        }

        setAuthError('');

        let existingProfile: Partial<UserProfile> | null = null;
        const fallbackProfile: UserProfile = {
          uid: firebaseUser.uid,
          fullName: resolveUserDisplayName(firebaseUser.displayName || allowedUser.email, allowedUser.email) || 'Clinic User',
          email: allowedUser.email,
          role: allowedUser.role,
          createdAt: new Date().toISOString(),
        };

        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          existingProfile = docSnap.exists() ? (docSnap.data() as Partial<UserProfile>) : null;

          const mergedProfile: UserProfile = {
            ...fallbackProfile,
            fullName: resolveUserDisplayName(
              firebaseUser.displayName ||
                existingProfile?.fullName ||
                fallbackProfile.fullName,
              allowedUser.email,
            ) || fallbackProfile.fullName,
            createdAt: existingProfile?.createdAt || fallbackProfile.createdAt,
          };

          await setDoc(docRef, mergedProfile, { merge: true });

          if (!isMounted) {
            return;
          }

          setUser(firebaseUser);
          setProfile(mergedProfile);
          return;
        } catch (profileSyncError) {
          console.error('User profile sync failed, continuing with fallback profile:', profileSyncError);
        }

        if (!isMounted) {
          return;
        }

        setUser(firebaseUser);
        setProfile({
          ...fallbackProfile,
          fullName: resolveUserDisplayName(
            firebaseUser.displayName ||
              existingProfile?.fullName ||
              fallbackProfile.fullName,
            allowedUser.email,
          ) || fallbackProfile.fullName,
          createdAt: existingProfile?.createdAt || fallbackProfile.createdAt,
        });
      } catch (error) {
        console.error('Auth initialization failed:', error);

        if (!isMounted) {
          return;
        }

        setUser(null);
        setProfile(null);
        setAuthError('მომხმარებლის პროფილის ჩატვირთვა ვერ მოხერხდა. სცადეთ თავიდან.');

        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error('Sign out after auth failure failed:', signOutError);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const value = {
    authError,
    clearAuthError: () => setAuthError(''),
    user,
    profile,
    loading,
    isAdmin: profile?.role === 'admin',
    canEditAdminContent: profile?.role === 'admin',
    canCreateRequests:
      profile?.role === 'admin' ||
      profile?.role === 'doctor' ||
      profile?.role === 'nurse' ||
      profile?.role === 'user',
    canAccessRequestsModule: profile?.role === 'admin' || profile?.role === 'user',
    canAccessAdminPanel: profile?.role === 'admin',
    canApproveAdminChanges: profile?.role === 'admin',
    isDoctorOrNurse: profile?.role === 'doctor' || profile?.role === 'nurse',
    isRegistrar: profile?.role === 'registrar',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
