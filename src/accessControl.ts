import { UserRole } from './types';

type AllowedUserConfig = {
  canAccessAdminPanel: boolean;
  canAccessRequestsModule: boolean;
  canApproveAdminChanges: boolean;
  canCreateRequests: boolean;
  canEditAdminContent: boolean;
  canEditAllRequests: boolean;
  canFullRequestEdit: boolean;
  canReceiveRequestNotifications: boolean;
  label: string;
  displayName: string;
  loginAliases?: string[];
  role: UserRole;
};

export const ALLOWED_USERS: Record<string, AllowedUserConfig> = {
  'imedashviligio27@gmail.com': {
    role: 'admin',
    label: 'ადმინისტრატორი',
    displayName: 'გ.იმედაშვილი',
    canCreateRequests: true,
    canAccessRequestsModule: true,
    canAccessAdminPanel: true,
    canApproveAdminChanges: true,
    canEditAdminContent: true,
    canFullRequestEdit: true,
    canEditAllRequests: true,
    canReceiveRequestNotifications: false,
  },
  'nino.nikaberidze@gmail.com': {
    role: 'user',
    label: 'იუზერი',
    displayName: 'ნინო ნიქაბერიძე',
    canCreateRequests: true,
    canAccessRequestsModule: true,
    canAccessAdminPanel: false,
    canApproveAdminChanges: false,
    canEditAdminContent: false,
    canFullRequestEdit: true,
    canEditAllRequests: true,
    canReceiveRequestNotifications: true,
  },
  'eringorokva@gmail.com': {
    role: 'doctor',
    label: 'ექიმი/ექთანი',
    displayName: 'ემერჯენსი',
    canCreateRequests: true,
    canAccessRequestsModule: false,
    canAccessAdminPanel: false,
    canApproveAdminChanges: false,
    canEditAdminContent: false,
    canFullRequestEdit: false,
    canEditAllRequests: false,
    canReceiveRequestNotifications: true,
  },
  'emergencyhtmc14@gmail.com': {
    role: 'registrar',
    label: 'რეგისტრატურა',
    displayName: 'რეგისტრატურა',
    canCreateRequests: false,
    canAccessRequestsModule: false,
    canAccessAdminPanel: false,
    canApproveAdminChanges: false,
    canEditAdminContent: false,
    canFullRequestEdit: false,
    canEditAllRequests: false,
    canReceiveRequestNotifications: false,
  },
  'giorgit@registrationhtmc.local': {
    role: 'shift_manager',
    label: 'ცვლის უფროსი',
    displayName: 'giorgit',
    loginAliases: ['giorgit'],
    canCreateRequests: true,
    canAccessRequestsModule: true,
    canAccessAdminPanel: false,
    canApproveAdminChanges: false,
    canEditAdminContent: false,
    canFullRequestEdit: true,
    canEditAllRequests: true,
    canReceiveRequestNotifications: true,
  },
  'gulshanm@registrationhtmc.local': {
    role: 'shift_manager',
    label: 'ცვლის უფროსი',
    displayName: 'gulshanm',
    loginAliases: ['gulshanm'],
    canCreateRequests: true,
    canAccessRequestsModule: true,
    canAccessAdminPanel: false,
    canApproveAdminChanges: false,
    canEditAdminContent: false,
    canFullRequestEdit: true,
    canEditAllRequests: true,
    canReceiveRequestNotifications: true,
  },
  'ninoch@registrationhtmc.local': {
    role: 'shift_manager',
    label: 'ცვლის უფროსი',
    displayName: 'ninoch',
    loginAliases: ['ninoch'],
    canCreateRequests: true,
    canAccessRequestsModule: true,
    canAccessAdminPanel: false,
    canApproveAdminChanges: false,
    canEditAdminContent: false,
    canFullRequestEdit: true,
    canEditAllRequests: true,
    canReceiveRequestNotifications: true,
  },
};

export const REGISTRAR_EMAIL = 'emergencyhtmc14@gmail.com';

export const ACCESS_DENIED_MESSAGE =
  'წვდომა აქვს მხოლოდ წინასწარ ავტორიზებულ ანგარიშებს. გამოიყენეთ დაშვებული ელ-ფოსტა ან username.';

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

  if (config) {
    return {
      email: normalizedEmail,
      ...config,
    };
  }

  const matchedEntry = Object.entries(ALLOWED_USERS).find(([, candidate]) =>
    candidate.loginAliases?.some((alias) => normalizeEmail(alias) === normalizedEmail),
  );

  if (!matchedEntry) {
    return null;
  }

  const [matchedEmail, matchedConfig] = matchedEntry;

  return {
    email: matchedEmail,
    ...matchedConfig,
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
      return 'ნინო ნიქაბერიძე';
    case 'giorgit':
      return 'giorgit';
    case 'gulshanm':
      return 'gulshanm';
    case 'ninoch':
      return 'ninoch';
    case 'emergencyhtmc14':
      return 'რეგისტრატურა';
    default:
      return name?.trim() || '';
  }
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
    case 'user':
      return 'იუზერი';
    case 'shift_manager':
      return 'ცვლის უფროსი';
    default:
      return 'მომხმარებელი';
  }
}
