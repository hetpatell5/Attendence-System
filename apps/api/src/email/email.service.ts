import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_EMAIL_TEMPLATE, DEFAULT_SALARY_SLIP_TEMPLATE } from './salary-template.defaults';
import { generateSalarySlipPdf } from './salary-pdf.generator';

export interface SmtpConfigInput {
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword?: string;
  fromName?: string;
  fromEmail?: string;
}

export interface SalaryTemplateVariables {
  company_name: string;
  company_logo?: string;
  company_address?: string;
  employee_name: string;
  employee_id: string;
  employee_email?: string;
  month_name: string;
  pay_period: string;
  pay_date: string;
  shift_name: string;
  shift_time: string;
  payment_status: string;
  monthly_salary: string;
  total_days: string;
  per_day_salary: string;
  per_hour_salary: string;
  basic_salary: string;
  working_days: string;
  sunday_holiday_pay: string;
  present_days: string;
  overtime_pay: string;
  overtime_hours: string;
  commission: string;
  total_hours_worked: string;
  advance_deducted: string;
  expected_hours: string;
  net_salary: string;
  paid_on: string;
  remarks: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to create a nodemailer Transporter using either passed config or stored CompanySettings.
   */
  async createTransporter(configOverride?: Partial<SmtpConfigInput>): Promise<{
    transporter: Transporter;
    from: string;
    fromName: string;
  }> {
    const settings = await this.prisma.companySettings.findFirst();

    const host = configOverride?.smtpHost || settings?.smtpHost;
    const port = Number(configOverride?.smtpPort || settings?.smtpPort || 587);
    const user = configOverride?.smtpUsername || settings?.smtpUsername;
    const pass = configOverride?.smtpPassword || settings?.smtpPassword;
    const fromName = configOverride?.fromName || settings?.fromName || settings?.companyName || 'BMAP EDUSERVICES';
    const fromEmail = configOverride?.fromEmail || settings?.fromEmail || user;

    if (!host || !user || !pass) {
      throw new BadRequestException('SMTP is not configured. Please fill in Host, Username, and Password in Settings > SMTP Settings.');
    }

    const isSecure = port === 465;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure, // true for 465, false for 587 / other ports
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    });

    const formattedFrom = `"${fromName}" <${fromEmail}>`;
    return { transporter, from: formattedFrom, fromName };
  }

  /**
   * Sends a live test email to verify SMTP connection & credentials.
   */
  async sendTestEmail(
    to: string,
    configOverride?: Partial<SmtpConfigInput>,
  ): Promise<{ success: boolean; message: string; messageId?: string }> {
    if (!to || !to.includes('@')) {
      throw new BadRequestException('Please provide a valid recipient email address.');
    }

    const { transporter, from, fromName } = await this.createTransporter(configOverride);

    // Verify connection first
    try {
      await transporter.verify();
    } catch (err: any) {
      this.logger.error(`SMTP verification failed: ${err.message}`, err.stack);
      throw new BadRequestException(`SMTP Connection Failed: ${err.message}`);
    }

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <h2 style="color: #059669; margin-top: 0;">🎉 SMTP Connection Successful!</h2>
        <p style="color: #334155; font-size: 14px; line-height: 1.6;">
          This is a live test email from your <strong>${fromName}</strong> Attendance & Payroll system.
        </p>
        <div style="background: #f8fafc; border-left: 4px solid #059669; padding: 12px 16px; margin: 16px 0; font-size: 13px; color: #475569;">
          <strong>Status:</strong> Ready to send automated salary slips and notifications.<br/>
          <strong>Sender:</strong> ${from}<br/>
          <strong>Timestamp:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
          If you received this message, your SMTP configuration is 100% operational.
        </p>
      </div>
    `;

    try {
      const info = await transporter.sendMail({
        from,
        to,
        subject: `SMTP Test Email - ${fromName}`,
        html: htmlBody,
      });

      this.logger.log(`Test email sent successfully to ${to} (Message ID: ${info.messageId})`);
      return {
        success: true,
        message: `Test email successfully sent to ${to}`,
        messageId: info.messageId,
      };
    } catch (err: any) {
      this.logger.error(`Failed to send test email: ${err.message}`, err.stack);
      throw new BadRequestException(`Failed to send test email: ${err.message}`);
    }
  }

  /**
   * Replaces variables in a template string with actual data.
   */
  substituteTemplate(template: string, vars: SalaryTemplateVariables): string {
    let output = template;

    // Handle conditional logo helper {{#if company_logo}}...{{/if}}
    if (!vars.company_logo) {
      output = output.replace(/\{\{#if company_logo\}\}[\s\S]*?\{\{\/if\}\}/gi, '');
    } else {
      output = output.replace(/\{\{#if company_logo\}\}/gi, '').replace(/\{\{\/if\}\}/gi, '');
    }

    // Replace all keys {{key}}
    for (const [key, value] of Object.entries(vars)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      output = output.replace(regex, String(value ?? ''));
    }

    return output;
  }

  /**
   * Renders the complete Salary Slip HTML using either the custom template from settings or the default legacy format.
   */
  async renderSalarySlipHtml(vars: SalaryTemplateVariables): Promise<string> {
    const settings = await this.prisma.companySettings.findFirst();
    const template = settings?.salarySlipFormat?.trim() || DEFAULT_SALARY_SLIP_TEMPLATE;
    return this.substituteTemplate(template, vars);
  }

  /**
   * Renders the complete Salary Email message body using either the custom template from settings or the default format.
   */
  async renderSalaryEmailBody(vars: SalaryTemplateVariables): Promise<string> {
    const settings = await this.prisma.companySettings.findFirst();
    const template = settings?.mailFormat?.trim() || DEFAULT_EMAIL_TEMPLATE;
    return this.substituteTemplate(template, vars);
  }

  /**
   * Generates a 1:1 legacy replica PDF buffer for the salary slip.
   */
  async generateSalarySlipPdf(vars: SalaryTemplateVariables): Promise<Buffer> {
    return generateSalarySlipPdf(vars);
  }

  /**
   * Sends a Salary Slip email directly to an employee with the clean email message body and attached PDF file.
   */
  async sendSalarySlipEmail(
    vars: SalaryTemplateVariables,
    recipientEmailOverride?: string,
  ): Promise<{ success: boolean; message: string }> {
    const recipient = recipientEmailOverride || vars.employee_email;
    if (!recipient || !recipient.includes('@')) {
      throw new BadRequestException(`Employee ${vars.employee_name} has no valid email address.`);
    }

    const { transporter, from, fromName } = await this.createTransporter();
    const emailBody = await this.renderSalaryEmailBody(vars);

    // Generate exact 1:1 PDF attachment
    const pdfBuffer = await this.generateSalarySlipPdf(vars);
    const safeEmpName = vars.employee_name.replace(/[^A-Za-z0-9_\-]/g, '_');
    const safeMonth = vars.month_name.replace(/[^A-Za-z0-9_\-]/g, '_');
    const pdfFileName = `salary_slip_${safeMonth}.pdf`;

    const subject = `Salary Slip for ${vars.month_name} - ${vars.employee_name}`;

    try {
      await transporter.sendMail({
        from,
        to: recipient,
        subject,
        html: emailBody,
        attachments: [
          {
            filename: pdfFileName,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      this.logger.log(`Salary slip email with PDF attachment sent to ${recipient} for ${vars.month_name}`);
      return {
        success: true,
        message: `Salary slip for ${vars.month_name} successfully emailed to ${recipient} with PDF attachment!`,
      };
    } catch (err: any) {
      this.logger.error(`Failed to send salary slip email to ${recipient}: ${err.message}`, err.stack);
      throw new BadRequestException(`Could not send salary slip email: ${err.message}`);
    }
  }
}
