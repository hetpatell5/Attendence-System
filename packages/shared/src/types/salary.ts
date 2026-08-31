export type SalaryStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'HOLD';
export type SalaryComponentType = 'EARNING' | 'DEDUCTION';

export interface SalaryComponent {
  id: string;
  salaryRecordId: string;
  name: string;
  type: SalaryComponentType;
  amount: string;
  isAutoCalculated: boolean;
  createdAt: string;
}

export interface SalaryRecord {
  id: string;
  employeeId: string;
  month: string;
  basicSalary: string;
  totalAllowances: string;
  totalDeductions: string;
  overtimeAmount: string;
  bonusAmount: string;
  netSalary: string;
  workingDays: number;
  presentDays: string;
  absentDays: string;
  leaveDays: string;
  overtimeMinutes: number;
  status: SalaryStatus;
  paymentDate: string | null;
  paymentReference: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
  components?: SalaryComponent[];
}
