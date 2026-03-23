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

export type RequestStatus = 'ახალი' | 'განხილვაშია' | 'დადასტურებულია' | 'დასრულებულია' | 'უარყოფილია';

export interface ClinicalRequest {
  id: string;
  patientData: Patient;
  createdByUserId: string;
  createdByUserName: string;
  requestedAction: string;
  studyType?: string;
  department?: string;
  consentStatus: string;
  diagnosis: string;
  icdCode?: string;
  doctorComment?: string;
  registrarComment?: string;
  registrarName?: string;
  formFillerName?: string;
  finalDecision?: string;
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
