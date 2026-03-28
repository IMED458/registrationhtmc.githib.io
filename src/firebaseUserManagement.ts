import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { buildSyntheticEmailFromUsername, normalizeUsername, resolveUserDisplayName } from './accessControl';
import { db, firebaseClientConfig, isFirebaseConfigured } from './firebase';
import { UserProfile, UserRole } from './types';

type CreateManagedUserInput = {
  firstName: string;
  lastName: string;
  password: string;
  role: UserRole;
  username: string;
};

function buildFullName(firstName: string, lastName: string) {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').trim();
}

export async function createManagedUser(input: CreateManagedUserInput) {
  if (!isFirebaseConfigured || !firebaseClientConfig || !db) {
    throw new Error('Firebase ჯერ არ არის მზად.');
  }

  const normalizedUsername = normalizeUsername(input.username);
  const email = buildSyntheticEmailFromUsername(normalizedUsername);
  const fullName = buildFullName(input.firstName, input.lastName);

  if (!normalizedUsername || !email) {
    throw new Error('იუზერის სახელი სავალდებულოა.');
  }

  if (!fullName) {
    throw new Error('სახელი და გვარი სავალდებულოა.');
  }

  const secondaryApp = initializeApp(
    firebaseClientConfig,
    `managed-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, input.password);

    if (credential.user) {
      await updateProfile(credential.user, {
        displayName: resolveUserDisplayName(fullName, email) || fullName,
      });
    }

    const nextProfile: UserProfile = {
      uid: credential.user.uid,
      fullName,
      email,
      role: input.role,
      createdAt: new Date().toISOString(),
      username: normalizedUsername,
      isActive: true,
      isManaged: true,
      canApproveAdminChanges: input.role === 'admin',
      notificationTokens: [],
    };

    await setDoc(doc(db, 'users', credential.user.uid), nextProfile, { merge: true });

    return nextProfile;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}
