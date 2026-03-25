import { UserRole } from './types';

type AllowedUserConfig = {
  label: string;
  displayName: string;
  role: UserRole;
};

export const ALLOWED_USERS: Record<string, AllowedUserConfig> = {
  'imedashviligio27@gmail.com': {
    role: 'admin',
    label: 'ადმინისტრატორი',
    displayName: 'გ.იმედაშვილი',
  },
  'nino.nikaberidze@gmail.com': {
    role: 'admin_assistant',
    label: 'ადმინისტრატორი',
    displayName: 'ნინო ნიკაბერიძე',
  },
  'eringorokva@gmail.com': {
    role: 'doctor',
    label: 'ექიმი/ექთანი',
    displayName: 'ემერჯენსი',
  },
  'emergencyhtmc14@gmail.com': {
    role: 'registrar',
    label: 'რეგისტრატურა',
    displayName: 'რეგისტრატურა',
  },
};

export const REGISTRAR_EMAIL = 'emergencyhtmc14@gmail.com';

export const ACCESS_DENIED_MESSAGE =
  'წვდომა აქვს მხოლოდ წინასწარ ავტორიზებულ Google ანგარიშებს. გამოიყენეთ დაშვებული ელ-ფოსტა.';

export const ALLOWED_EMAILS = Object.keys(ALLOWED_USERS);

export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? '';
}

export function getAllowedUserConfig(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return null;
  }

  const config = ALLOWED_USERS[normalizedEmail];

  if (!config) {
    return null;
  }

  return {
    email: normalizedEmail,
    ...config,
  };
}

export function resolveUserDisplayName(name?: string | null, email?: string | null) {
  const allowedUser = getAllowedUserConfig(email);

  if (allowedUser?.displayName) {
    return allowedUser.displayName;
  }

  const normalizedName = normalizeEmail(name);

  if (!normalizedName) {
    return '';
  }

  const directAllowedUser = getAllowedUserConfig(normalizedName);

  if (directAllowedUser?.displayName) {
    return directAllowedUser.displayName;
  }

  const emailLocalPart = normalizedName.split('@')[0];

  switch (emailLocalPart) {
    case 'emergency':
    case 'eringorokva':
      return 'ემერჯენსი';
    case 'imedashviligio27':
      return 'გ.იმედაშვილი';
    case 'nino.nikaberidze':
      return 'ნინო ნიკაბერიძე';
    case 'emergencyhtmc14':
      return 'რეგისტრატურა';
    default:
      return name?.trim() || '';
  }
}

export function getRoleLabel(role?: UserRole | null) {
  switch (role) {
    case 'admin':
    case 'admin_assistant':
      return 'ადმინისტრატორი';
    case 'doctor':
      return 'ექიმი/ექთანი';
    case 'nurse':
      return 'ექთანი';
    case 'registrar':
      return 'რეგისტრატურა';
    default:
      return 'მომხმარებელი';
  }
}
