import { UserRole } from './types';

type AllowedUserConfig = {
  label: string;
  role: UserRole;
};

export const ALLOWED_USERS: Record<string, AllowedUserConfig> = {
  'imedashviligio27@gmail.com': {
    role: 'admin',
    label: 'ადმინისტრატორი',
  },
  'eringorokva@gmail.com': {
    role: 'doctor',
    label: 'ექიმი/ექთანი',
  },
  'emergencyhtmc14@gmail.com': {
    role: 'registrar',
    label: 'რეგისტრატურა',
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

export function getRoleLabel(role?: UserRole | null) {
  switch (role) {
    case 'admin':
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
