import mysql from 'mysql2/promise';

export interface LegacyEmployeeRow {
  id: number;
  full_name: string;
  mobile_number: string | null;
  alternate_number: string | null;
  username: string | null;
  shift_id: number | null;
  email: string | null;
  address: string | null;
  monthly_salary: string;
  target_salary: string | null;
  monthly_increment: string | null;
  increment_interval: number | null;
  increment_effective_from: string | null;
  last_increment_date: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  dob: string | null;
  joining_date: string | null;
}

export interface LegacyShiftRow {
  id: number;
  shift_name: string;
  start_time: string | null;
  end_time: string | null;
}

export interface LegacyAttendanceRow {
  id: number;
  employee_id: number;
  date: string;
  entry_time: string | null;
  exit_time: string | null;
  total_hours: string | null;
  note: string | null;
}

export interface LegacyLeaveRequestRow {
  id: number;
  employee_id: number;
  from_date: string;
  from_time: string | null;
  to_date: string;
  to_time: string | null;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  created_at: string;
  last_edited_at: string | null;
}

export interface LegacyHolidayRow {
  id: number;
  date: string;
  reason: string | null;
}

export interface LegacySalaryDetailRow {
  id: number;
  employee_id: number;
  month_year: string;
  total_hours: string;
  expected_hours: string;
  hour_rate: string;
  commission: string;
  advance_amount: string;
  remarks: string | null;
  status: string;
  final_salary: string;
  paid_at: string | null;
}

export interface LegacySalaryHistoryRow {
  id: number;
  employee_id: number;
  amount: string;
  effective_from: string;
  created_at: string;
}

export interface LegacySalaryIncrementLogRow {
  id: number;
  employee_id: number;
  old_salary: string;
  new_salary: string;
  increment_amount: string;
  target_salary: string;
  applied_date: string;
  created_at: string;
}

export interface LegacyAnnouncementRow {
  id: number;
  message: string;
  status: number;
  created_at: string;
}

export class LegacySourceClient {
  private constructor(private readonly pool: mysql.Pool) {}

  static create(url: string): LegacySourceClient {
    const pool = mysql.createPool({
      uri: url,
      charset: 'utf8mb4',
      dateStrings: true,
    });
    return new LegacySourceClient(pool);
  }

  async ping(): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.query('SELECT 1');
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async employees(): Promise<LegacyEmployeeRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM employees ORDER BY id');
    return rows as LegacyEmployeeRow[];
  }

  async shifts(): Promise<LegacyShiftRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM shifts ORDER BY id');
    return rows as LegacyShiftRow[];
  }

  async attendance(): Promise<LegacyAttendanceRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM attendance ORDER BY employee_id, date');
    return rows as LegacyAttendanceRow[];
  }

  async leaveRequests(): Promise<LegacyLeaveRequestRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM leave_requests ORDER BY id');
    return rows as LegacyLeaveRequestRow[];
  }

  async holidays(): Promise<LegacyHolidayRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM holidays ORDER BY date');
    return rows as LegacyHolidayRow[];
  }

  async salaryDetails(): Promise<LegacySalaryDetailRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM salary_details ORDER BY id');
    return rows as LegacySalaryDetailRow[];
  }

  async salaryHistory(): Promise<LegacySalaryHistoryRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM salary_history ORDER BY id');
    return rows as LegacySalaryHistoryRow[];
  }

  async salaryIncrementLog(): Promise<LegacySalaryIncrementLogRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM salary_increment_log ORDER BY id');
    return rows as LegacySalaryIncrementLogRow[];
  }

  async announcements(): Promise<LegacyAnnouncementRow[]> {
    const [rows] = await this.pool.query('SELECT * FROM announcements ORDER BY id');
    return rows as LegacyAnnouncementRow[];
  }

  /** Every distinct employee_id referenced across history tables, for orphan detection. */
  async allReferencedEmployeeIds(): Promise<number[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(`
      SELECT employee_id FROM attendance
      UNION SELECT employee_id FROM leave_requests
      UNION SELECT employee_id FROM salary_details
      UNION SELECT employee_id FROM salary_history
      UNION SELECT employee_id FROM salary_increment_log
    `);
    return rows.map((r) => r.employee_id as number);
  }

  async earliestAttendanceDate(employeeId: number): Promise<string | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT MIN(date) as minDate FROM attendance WHERE employee_id = ?',
      [employeeId],
    );
    return (rows[0]?.minDate as string | undefined) ?? null;
  }

  async latestAttendanceDate(employeeId: number): Promise<string | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT MAX(date) as maxDate FROM attendance WHERE employee_id = ?',
      [employeeId],
    );
    return (rows[0]?.maxDate as string | undefined) ?? null;
  }
}
