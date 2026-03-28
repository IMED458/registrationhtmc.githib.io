import { UserProfile, UserRole } from './types';

type PermissionFlags = {
  canAccessAdminPanel: boolean;
  canAccessRequestsModule: boolean;
  canApproveAdminChanges: boolean;
  canCreateRequests: boolean;
  canEditAdminContent: boolean;
  canEditAllRequests: boolean;
  canFullRequestEdit: boolean;
  canReceiveRequestNotifications: boolean;
};

type StaticUserConfig = PermissionFlags & {
  displayName: string;
  label: string;
  loginAliases?: string[];
  role: UserRole;
  username?: string;
};

export type AllowedUserConfig = PermissionFlags & {
  email: string;
  displayName: string;
  isActive?: boolean;
  isManaged?: boolean;
  label: string;
  loginAliases?: string[];
  role: UserRole;
  username?: string;
};

export const LOCAL_AUTH_DOMAIN = 'registrationhtmc.local';
export const REGISTRAR_EMAIL = 'emergencyhtmc14@gmail.com';

export const ACCESS_DENIED_MESSAGE =
  'წვდომა აქვს მხოლოდ ავტორიზებულ მომხმარებლებს. გამოიყენეთ სწორი ელ-ფოსტა ან username.';

function getRolePermissions(role: UserRole): PermissionFlags & { label: string } {
  switch (role) {
    case 'admin':
      return {
        label: 'ადმინისტრატორი',
        canCreateRequests: true,
        canAccessRequestsModule: true,
        canAccessAdminPanel: true,
        canApproveAdminChanges: true,
        canEditAdminContent: true,
        canFullRequestEdit: true,
        canEditAllRequests: true,
        canReceiveRequestNotifications: true,
      };
    case 'manager':
    case 'user':
      return {
        label: 'მენეჯერი',
        canCreateRequests: true,
        canAccessRequestsModule: true,
        canAccessAdminPanel: false,
        canApproveAdminChanges: false,
        canEditAdminContent: false,
        canFullRequestEdit: true,
        canEditAllRequests: true,
        canReceiveRequestNotifications: true,
      };
    case 'shift_manager':
      return {
        label: 'ცვლის უფროსი',
        canCreateRequests: true,
        canAccessRequestsModule: true,
        canAccessAdminPanel: false,
        canApproveAdminChanges: false,
        canEditAdminContent: false,
        canFullRequestEdit: true,
        canEditAllRequests: true,
        canReceiveRequestNotifications: true,
      };
    case 'doctor':
      return {
        label: 'ექიმი',
        canCreateRequests: true,
        canAccessRequestsModule: false,
        canAccessAdminPanel: false,
        canApproveAdminChanges: false,
        canEditAdminContent: false,
        canFullRequestEdit: false,
        canEditAllRequests: false,
        canReceiveRequestNotifications: true,
      };
    case 'nurse':
      return {
        label: 'ექთანი',
        canCreateRequests: true,
        canAccessRequestsModule: false,
        canAccessAdminPanel: false,
        canApproveAdminChanges: false,
        canEditAdminContent: false,
        canFullRequestEdit: false,
        canEditAllRequests: false,
        canReceiveRequestNotifications: true,
      };
    case 'registrar':
      return {
        label: 'რეგისტრატურა',
        canCreateRequests: false,
        canAccessRequestsModule: false,
        canAccessAdminPanel: false,
        canApproveAdminChanges: false,
        canEditAdminContent: false,
        canFullRequestEdit: false,
        canEditAllRequests: false,
        canReceiveRequestNotifications: false,
      };
    default:
      return {
        label: 'მომხმარებელი',
        canCreateRequests: false,
        canAccessRequestsModule: false,
        canAccessAdminPanel: false,
        canApproveAdminChanges: false,
        canEditAdminContent: false,
        canFullRequestEdit: false,
        canEditAllRequests: false,
        canReceiveRequestNotifications: false,
      };
  }
}

function buildUserConfig(
  email: string,
  role: UserRole,
  displayName: string,
  options: Partial<StaticUserConfig & Pick<AllowedUserConfig, 'isActive' | 'isManaged'>> = {},
): AllowedUserConfig {
  const basePermissions = getRolePermissions(role);

  return {
    email: normalizeEmail(email),
    role,
    displayName,
    label: options.label || basePermissions.label,
    loginAliases: options.loginAliases,
    username: options.username,
    isActive: options.isActive,
    isManaged: options.isManaged,
    canCreateRequests: options.canCreateRequests ?? basePermissions.canCreateRequests,
    canAccessRequestsModule: options.canAccessRequestsModule ?? basePermissions.canAccessRequestsModule,
    canAccessAdminPanel: options.canAccessAdminPanel ?? basePermissions.canAccessAdminPanel,
    canApproveAdminChanges: options.canApproveAdminChanges ?? basePermissions.canApproveAdminChanges,
    canEditAdminContent: options.canEditAdminContent ?? basePermissions.canEditAdminContent,
    canFullRequestEdit: options.canFullRequestEdit ?? basePermissions.canFullRequestEdit,
    canEditAllRequests: options.canEditAllRequests ?? basePermissions.canEditAllRequests,
    canReceiveRequestNotifications:
      options.canReceiveRequestNotifications ?? basePermissions.canReceiveRequestNotifications,
  };
}

const STATIC_ALLOWED_USERS: Record<string, StaticUserConfig> = {
  'imedashviligio27@gmail.com': {
    ...getRolePermissions('admin'),
    role: 'admin',
    displayName: 'გ.იმედაშვილი',
    canReceiveRequestNotifications: false,
  },
  'nino.nikaberidze@gmail.com': {
    ...getRolePermissions('manager'),
    role: 'manager',
    displayName: 'ნინო ნიქაბერიძე',
  },
  'eringorokva@gmail.com': {
    ...getRolePermissions('doctor'),
    role: 'doctor',
    displayName: 'ემერჯენსი',
    label: 'ექიმი/ექთანი',
  },
  [REGISTRAR_EMAIL]: {
    ...getRolePermissions('registrar'),
    role: 'registrar',
    displayName: 'რეგისტრატურა',
  },
  'giorgit@registrationhtmc.local': {
    ...getRolePermissions('shift_manager'),
    role: 'shift_manager',
    displayName: 'გიორგი ტერტერაშვილი',
    username: 'giorgit',
    loginAliases: ['giorgit'],
  },
  'gulshanm@registrationhtmc.local': {
    ...getRolePermissions('shift_manager'),
    role: 'shift_manager',
    displayName: 'გულშან მამედოვა',
    username: 'gulshanm',
    loginAliases: ['gulshanm'],
  },
  'ninoch@registrationhtmc.local': {
    ...getRolePermissions('shift_manager'),
    role: 'shift_manager',
    displayName: 'ნინო ჭიღლაძე',
    username: 'ninoch',
    loginAliases: ['ninoch'],
  },
};

export const ALLOWED_EMAILS = Object.keys(STATIC_ALLOWED_USERS);

export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? '';
}

export function normalizeUsername(username?: string | null) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function buildSyntheticEmailFromUsername(username?: string | null) {
  const normalizedUsername = normalizeUsername(username);
  return normalizedUsername ? `${normalizedUsername}@${LOCAL_AUTH_DOMAIN}` : '';
}

function getStaticAllowedUser(identifier?: string | null) {
  const normalizedIdentifier = normalizeEmail(identifier);

  if (!normalizedIdentifier) {
    return null;
  }

  const directConfig = STATIC_ALLOWED_USERS[normalizedIdentifier];

  if (directConfig) {
    return buildUserConfig(normalizedIdentifier, directConfig.role, directConfig.displayName, directConfig);
  }

  const matchedEntry = Object.entries(STATIC_ALLOWED_USERS).find(([, candidate]) =>
    candidate.loginAliases?.some((alias) => normalizeEmail(alias) === normalizedIdentifier),
  );

  if (!matchedEntry) {
    return null;
  }

  const [matchedEmail, matchedConfig] = matchedEntry;
  return buildUserConfig(matchedEmail, matchedConfig.role, matchedConfig.displayName, matchedConfig);
}

export function getAllowedUserConfig(identifier?: string | null, profile?: Partial<UserProfile> | null) {
  if (profile?.email && profile?.role) {
    const staticConfig = getStaticAllowedUser(profile.email);
    return buildUserConfig(
      profile.email,
      profile.role,
      resolveUserDisplayName(profile.fullName || staticConfig?.displayName || profile.email, profile.email) ||
        profile.fullName ||
        staticConfig?.displayName ||
        profile.email,
      {
        ...staticConfig,
        username: profile.username || staticConfig?.username,
        loginAliases: profile.username ? [profile.username] : staticConfig?.loginAliases,
        isActive: profile.isActive ?? true,
        isManaged: profile.isManaged ?? !staticConfig,
        canApproveAdminChanges:
          profile.canApproveAdminChanges ?? staticConfig?.canApproveAdminChanges,
      },
    );
  }

  return getStaticAllowedUser(identifier);
}

export function resolveLoginEmail(identifier?: string | null) {
  const staticConfig = getStaticAllowedUser(identifier);

  if (staticConfig) {
    return staticConfig.email;
  }

  const normalizedIdentifier = normalizeEmail(identifier);

  if (!normalizedIdentifier) {
    return '';
  }

  return normalizedIdentifier.includes('@')
    ? normalizedIdentifier
    : buildSyntheticEmailFromUsername(normalizedIdentifier);
}

export function resolveUserDisplayName(name?: string | null, email?: string | null) {
  const staticConfig = getStaticAllowedUser(email);

  if (staticConfig?.displayName) {
    return staticConfig.displayName;
  }

  const normalizedName = normalizeEmail(name);

  if (!normalizedName) {
    return '';
  }

  const directAllowedUser = getStaticAllowedUser(normalizedName);

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
      return 'გიორგი ტერტერაშვილი';
    case 'gulshanm':
      return 'გულშან მამედოვა';
    case 'ninoch':
      return 'ნინო ჭიღლაძე';
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
      return 'ექიმი';
    case 'nurse':
      return 'ექთანი';
    case 'registrar':
      return 'რეგისტრატურა';
    case 'manager':
    case 'user':
      return 'მენეჯერი';
    case 'shift_manager':
      return 'ცვლის უფროსი';
    default:
      return 'მომხმარებელი';
  }
}

export function getAvailableRoleOptions() {
  return [
    { value: 'admin' as UserRole, label: 'ადმინი' },
    { value: 'manager' as UserRole, label: 'მენეჯერი' },
    { value: 'shift_manager' as UserRole, label: 'ცვლის უფროსი' },
    { value: 'registrar' as UserRole, label: 'რეგისტრატორი' },
    { value: 'doctor' as UserRole, label: 'ექიმი' },
    { value: 'nurse' as UserRole, label: 'ექთანი' },
  ];
}
