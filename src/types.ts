export type UserRole = 'doctor' | 'nurse' | 'registrar' | 'admin';

export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface Patient {
  firstName: string;
  lastName: string;
  historyNumber: string;
  personalId: string;
  birthDate?: string;
  phone?: string;
  address?: string;
}

export type RequestStatus =
  | 'ახალი'
  | 'განხილვაშია'
  | 'მიღებულია'
  | 'დადასტურებულია'
  | 'დასრულებულია'
  | 'უარყოფილია'
  | 'უარყოფილია, თანხმდება დაზღვევასთან';
export type AdminConfirmationStatus = 'pending' | 'confirmed';

export interface DiagnosisEntry {
  icdCode: string;
  diagnosis: string;
  isPrimary?: boolean;
}

export interface PendingRegistrarUpdate {
  currentStatus: RequestStatus;
  finalDecision?: string;
  registrarComment?: string;
  registrarName?: string;
  formFillerName?: string;
  requestedAt: any;
  requestedByUserEmail?: string;
  requestedByUserId: string;
  requestedByUserName: string;
}

export interface PendingDoctorEdit {
  comment: string;
  editedAt: any;
  editedByUserEmail?: string;
  editedByUserId: string;
  editedByUserName: string;
}

export interface ClinicalRequest {
  id: string;
  patientData: Patient;
  createdByUserId: string;
  createdByUserName: string;
  createdByUserEmail?: string;
  requestedAction: string;
  studyType?: string;
  studyTypes?: string[];
  department?: string;
  consentStatus: string;
  diagnosis: string;
  icdCode?: string;
  diagnoses?: DiagnosisEntry[];
  doctorComment?: string;
  registrarComment?: string;
  registrarName?: string;
  formFillerName?: string;
  finalDecision?: string;
  pendingRegistrarUpdate?: PendingRegistrarUpdate | null;
  lastRegistrarEditAt?: any;
  lastRegistrarEditByUserId?: string;
  lastRegistrarEditByUserName?: string;
  lastRegistrarEditByUserEmail?: string;
  adminConfirmationStatus?: AdminConfirmationStatus | null;
  adminConfirmedAt?: any;
  adminConfirmedByUserId?: string;
  adminConfirmedByUserName?: string;
  requiresRegistrarAction?: boolean;
  pendingDoctorEdit?: PendingDoctorEdit | null;
  lastDoctorEditAt?: any;
  lastDoctorEditByUserId?: string;
  lastDoctorEditByUserName?: string;
  lastDoctorEditByUserEmail?: string;
  lastDoctorEditComment?: string;
  archivedAt?: any;
  currentStatus: RequestStatus;
  createdAt: any;
  updatedAt: any;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  requestId: string;
  actionType: string;
  oldValue?: string;
  newValue?: string;
  createdAt: any;
}

export interface SystemSettings {
  googleSheetsId: string;
  googleDriveFolderId?: string;
  sheetName?: string;
  sheetGid?: string;
  disabledEmails?: string[];
  columnMapping: {
    firstName: string;
    lastName: string;
    historyNumber: string;
    personalId: string;
    birthDate: string;
    phone: string;
    address: string;
  };
}
