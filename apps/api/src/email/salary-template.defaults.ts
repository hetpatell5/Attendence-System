/**
 * Exact 1:1 Legacy Templates from AttenOld/admin/month_dashboard.php
 */

export const DEFAULT_EMAIL_TEMPLATE = `<p>Hello {{employee_name}},</p>
<p>Please find attached your salary slip for the month of {{month_name}}.</p>
<p>Regards,<br>{{company_name}}</p>`;

export const DEFAULT_SALARY_SLIP_TEMPLATE = `<div style="max-width:650px;margin:16px auto;background:#fff;border-radius:15px;box-shadow:0 4px 24px rgba(184, 212, 239, 0.25);border:1.5px solid #e6eaf4;font-family:Segoe UI,Arial,sans-serif;padding:0;overflow:hidden;">
  <div style="text-align:center;padding:16px 20px 8px 20px;">
    {{#if company_logo}}
      <img src="{{company_logo}}" width="340" style="max-height:85px;object-fit:contain;border-radius:10px;border:2.5px solid #dbe7f6;background:#f7fafc;box-shadow:0 2px 12px rgba(191, 220, 255, 0.25);display:block;margin:0 auto 8px auto;">
    {{/if}}
    <div style="font-size:21px;font-weight:700;color:#1968a7;letter-spacing:1px;margin-top:6px;">{{company_name}}</div>
    <div style="font-size:12px;color:#757a8a;margin-top:1px;max-width:540px;margin-left:auto;margin-right:auto;line-height:1.4;">{{company_address}}</div>
  </div>
  <div style="margin-top:16px;text-align:center;font-size:19px;color:#2e415a;font-weight:700;">Salary Slip</div>
  
  <table style="width:84%;margin:16px auto 6px auto;font-size:13.5px;border-collapse:collapse;">
    <tr>
      <td style="padding:2px 6px;color:#4a5568;width:20%;"><b>Pay Period:</b></td>
      <td style="padding:2px 6px;color:#1a202c;width:30%;">{{pay_period}}</td>
      <td style="padding:2px 6px;color:#4a5568;width:20%;"><b>Pay Date:</b></td>
      <td style="padding:2px 6px;color:#1a202c;width:30%;">{{pay_date}}</td>
    </tr>
    <tr>
      <td style="padding:2px 6px;color:#4a5568;"><b>Employee Name:</b></td>
      <td style="padding:2px 6px;color:#1a202c;font-weight:600;">{{employee_name}}</td>
      <td style="padding:2px 6px;color:#4a5568;"><b>Employee ID:</b></td>
      <td style="padding:2px 6px;color:#1a202c;">{{employee_id}}</td>
    </tr>
    <tr>
      <td style="padding:2px 6px;color:#4a5568;"><b>Shift:</b></td>
      <td style="padding:2px 6px;color:#1a202c;">{{shift_name}} ({{shift_time}})</td>
      <td style="padding:2px 6px;color:#4a5568;"><b>Status:</b></td>
      <td style="padding:2px 6px;"><span style="color:#16a34a;font-weight:700;">{{payment_status}}</span></td>
    </tr>
  </table>

  <table style="width:88%;margin:12px auto 0 auto;border-collapse:collapse;font-size:13px;">
    <tr style="background:#e9f4fb;">
      <th colspan="2" style="padding:7px 6px;color:#1563ac;font-weight:600;text-align:left;border-radius:7px 0 0 0;">Earnings</th>
      <th colspan="2" style="padding:7px 6px;color:#d67412;font-weight:600;text-align:left;border-radius:0 7px 0 0;">Attendance & Hours</th>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Monthly Salary</td>
      <td style="padding:6px 6px;font-weight:700;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{monthly_salary}}</td>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Total Days in Month</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{total_days}}</td>
    </tr>
    <tr>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Salary Per Day</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{per_day_salary}}</td>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Salary Per Hour</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{per_hour_salary}}</td>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Basic Salary</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{basic_salary}}</td>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Total Working Days</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{working_days}}</td>
    </tr>
    <tr>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Sunday & Holiday Pay</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{sunday_holiday_pay}}</td>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Mon-Sat Present Days</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{present_days}}</td>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Overtime Payout</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{overtime_pay}}</td>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Overtime Hours</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{overtime_hours}}</td>
    </tr>
    <tr>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Commission / Extra</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{commission}}</td>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Total Hours Worked</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{total_hours_worked}}</td>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:6px 6px;color:#c93030;font-weight:600;border-bottom:1px solid #edf2f7;">Advance Deducted</td>
      <td style="padding:6px 6px;color:#c93030;font-weight:700;border-bottom:1px solid #edf2f7;">- ₹ {{advance_deducted}}</td>
      <td style="padding:6px 6px;color:#4a5568;border-bottom:1px solid #edf2f7;">Expected Hours</td>
      <td style="padding:6px 6px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{expected_hours}}</td>
    </tr>
    <tr style="background:#d8f0e8;">
      <td style="padding:8px 6px;font-weight:700;color:#217f44;font-size:14px;border-radius:0 0 0 7px;">Net Salary</td>
      <td style="padding:8px 6px;font-weight:700;color:#217f44;font-size:14px;">₹ {{net_salary}} /-</td>
      <td colspan="2" style="padding:8px 6px;text-align:right;color:#217f44;font-size:12px;font-weight:600;border-radius:0 0 7px 0;">All amounts in INR</td>
    </tr>
  </table>

  <table style="width:88%;margin:10px auto 14px auto;font-size:13px;border-collapse:collapse;">
    <tr>
      <td style="width:44%;padding:4px 6px;color:#4a5568;"><b>Payment Status:</b> <span style="color:#16a34a;font-weight:700;">{{payment_status}}</span></td>
      <td style="width:56%;padding:4px 6px;color:#4a5568;"><b>Paid On:</b> {{paid_on}}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:4px 6px;color:#4a5568;"><b>Remarks:</b> <span style="color:#2d3748;">{{remarks}}</span></td>
    </tr>
  </table>
</div>`;
