import type { Department, Designation } from './organization.js';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'TERMINATED';

export interface Employee {
  id: string;
  employeeCode: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  joiningDate: string;
  departmentId: string | null;
  department?: Department | null;
  designationId: string | null;
  designation?: Designation | null;
  baseSalary: string;
  status: EmployeeStatus;
  profilePhotoUrl: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  alternatePhone: string | null;
  targetSalary: string | null;
  monthlyIncrement: string | null;
  incrementInterval: number;
  incrementEffectiveFrom: string | null;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}
