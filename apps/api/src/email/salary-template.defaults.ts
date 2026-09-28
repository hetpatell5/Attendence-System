/**
 * Exact 1:1 Legacy Templates.
 *
 * DEFAULT_SALARY_SLIP_TEMPLATE is a mechanical transcription of
 * AttenOld/employee/download_salary_slip.php's `$html` string (lines 290-331) — every
 * style attribute copied as-is, only the PHP variable interpolations swapped for
 * `{{mustache}}` placeholders (plus `{{#if company_logo}}` since the old file's logo path
 * was a fixed constant, not conditional). Do not add styling that isn't in that PHP
 * string, however reasonable it looks — that's exactly how this drifted from the original
 * before (an added `max-height` on the logo, added `color`/`border-bottom`/padding on
 * cells that had none, an added "All amounts in INR" line, header cells centered by the
 * browser default that got force-left-aligned, ...). If the old system's PDF and this
 * template ever need to be compared again, diff against the PHP file directly, not memory.
 */

export const DEFAULT_EMAIL_TEMPLATE = `<p>Hello {{employee_name}},</p>
<p>Please find attached your salary slip for the month of {{month_name}}.</p>
<p>Regards,<br>{{company_name}}</p>`;

export const DEFAULT_SALARY_SLIP_TEMPLATE = `<div style="max-width:650px;margin:16px auto;background:#fff;border-radius:15px;box-shadow:0 4px 24px #b8d4ef23;border:1.5px solid #e6eaf4;font-family:Segoe UI,Arial,sans-serif;padding:0;">
  <div style="text-align:center;padding-top:8px;">
    {{#if company_logo}}
      <img src="{{company_logo}}" width="340" style="border-radius:10px;border:2.5px solid #dbe7f6;background:#f7fafc;box-shadow:0 2px 12px #bfdcff44;">
    {{/if}}
    <div style="font-size:21px;font-weight:700;color:#1968a7;letter-spacing:1px;margin-top:6px;">{{company_name}}</div>
    <div style="font-size:12px;color:#757a8a;margin-top:1px;">{{company_address}}</div>
  </div>
  <div style="margin-top:18px;text-align:center;font-size:19px;color:#2e415a;font-weight:700;">Salary Slip</div>
  <table style="width:82%;margin:18px auto 6px auto;font-size:13.5px;">
    <tr><td style="padding:1px 6px;"><b>Pay Period:</b></td><td style="padding:1px 6px;">{{pay_period}}</td>
        <td style="padding:1px 6px;"><b>Pay Date:</b></td><td style="padding:1px 6px;">{{pay_date}}</td></tr>
    <tr><td style="padding:1px 6px;"><b>Employee Name:</b></td><td style="padding:1px 6px;">{{employee_name}}</td>
        <td style="padding:1px 6px;"><b>Employee ID:</b></td><td style="padding:1px 6px;">{{employee_id}}</td></tr>
    <tr><td style="padding:1px 6px;"><b>Shift:</b></td><td style="padding:1px 6px;">{{shift_name}} ({{shift_time}})</td>
        <td style="padding:1px 6px;"><b>Status:</b></td><td style="padding:1px 6px;"><span style="color:green;font-weight:700;">{{payment_status}}</span></td></tr>
  </table>
  <table style="width:88%;margin:12px auto 0;border-collapse:collapse;font-size:13.2px;">
    <tr style="background:#e9f4fb;"><th colspan="2" style="padding:7px 6px;color:#1563ac;font-weight:600;border-radius:7px 0 0 0;">Earnings</th>
        <th colspan="2" style="padding:7px 6px;color:#d67412;font-weight:600;">Attendance & Hours</th></tr>
    <tr style="background:#f7fafc;"><td style="padding:6px 4px;">Monthly Salary</td><td style="padding:6px 4px;font-weight:700;">₹ {{monthly_salary}}</td>
        <td style="padding:6px 4px;">Total Days in Month</td><td style="padding:6px 4px;">{{total_days}}</td></tr>
    <tr><td style="padding:6px 4px;">Salary Per Day</td><td style="padding:6px 4px;">₹ {{per_day_salary}}</td>
        <td style="padding:6px 4px;">Salary Per Hour</td><td style="padding:6px 4px;">₹ {{per_hour_salary}}</td></tr>
    <tr style="background:#f7fafc;"><td style="padding:6px 4px;">Basic Salary</td><td style="padding:6px 4px;">₹ {{basic_salary}}</td>
        <td style="padding:6px 4px;">Total Working Days</td><td style="padding:6px 4px;">{{working_days}}</td></tr>
    <tr><td style="padding:6px 4px;">Sunday & Holiday Pay</td><td style="padding:6px 4px;">₹ {{sunday_holiday_pay}}</td>
        <td style="padding:6px 4px;">Mon-Sat Present Days</td><td style="padding:6px 4px;">{{present_days}}</td></tr>
    <tr style="background:#f7fafc;"><td style="padding:6px 4px;">Overtime Payout</td><td style="padding:6px 4px;">₹ {{overtime_pay}}</td>
        <td style="padding:6px 4px;">Overtime Hours</td><td style="padding:6px 4px;">{{overtime_hours}}</td></tr>
    <tr><td style="padding:6px 4px;">Commission/Pending</td><td style="padding:6px 4px;">₹ {{commission}}</td>
        <td style="padding:6px 4px;">Total Hours Worked</td><td style="padding:6px 4px;">{{total_hours_worked}}</td></tr>
    <tr style="background:#f7fafc;"><td style="padding:6px 4px;">Advance Deducted</td><td style="padding:6px 4px;color:#c93030;">- ₹ {{advance_deducted}}</td>
        <td style="padding:6px 4px;">Expected Hours</td><td style="padding:6px 4px;">{{expected_hours}}</td></tr>
    <tr style="background:#d8f0e8;"><td style="padding:7px 4px;font-weight:700;color:#217f44;">Net Salary</td>
        <td style="padding:7px 4px;font-weight:700;color:#217f44;">₹ {{net_salary}} /-</td><td colspan="2"></td></tr>
  </table>
  <table style="width:88%;margin:10px auto 0;font-size:13px;">
    <tr><td style="width:44%;"><b>Payment Status:</b> <span style="color:green;">{{payment_status}}</span></td>
        <td style="width:56%;"><b>Paid On:</b> {{paid_on}}</td></tr>
    <tr><td colspan="2"><b>Remarks:</b> {{remarks}}</td></tr>
  </table>
</div>`;
