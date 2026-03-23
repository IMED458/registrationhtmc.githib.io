import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ACCESS_DENIED_MESSAGE, getAllowedUserConfig } from './accessControl';
import { auth, db } from './firebase';
import { UserProfile } from './types';

interface AuthContextType {
  authError: string;
  clearAuthError: () => void;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isDoctorOrNurse: boolean;
  isRegistrar: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authError, setAuthError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

        setAuthError('');

        const docRef = doc(db, 'users', firebaseUser.uid);
        const docSnap = await getDoc(docRef);
        const existingProfile = docSnap.exists() ? (docSnap.data() as Partial<UserProfile>) : null;
        const mergedProfile: UserProfile = {
          uid: firebaseUser.uid,
          fullName:
            firebaseUser.displayName ||
            existingProfile?.fullName ||
            allowedUser.email.split('@')[0] ||
            'Clinic User',
          email: allowedUser.email,
          role: allowedUser.role,
          createdAt: existingProfile?.createdAt || new Date().toISOString(),
        };

        await setDoc(docRef, mergedProfile, { merge: true });

        if (!isMounted) {
          return;
        }

        setUser(firebaseUser);
        setProfile(mergedProfile);
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
