import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsIP, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  companyLogo?: string;

  @IsOptional()
  @IsString()
  companyFavicon?: string;

  @IsOptional()
  @IsString()
  companyAddress?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn([0, 1, 2, 3, 4, 5, 6], { each: true })
  weeklyOffDays?: number[];

  @IsOptional()
  @IsString()
  defaultShiftId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  /** Array of allowed public IPs for punch-in/out (office WiFi). Empty array = restriction disabled. */
  @IsOptional()
  @IsArray()
  @IsIP(undefined, { each: true })
  allowedIps?: string[];

  // SMTP Configuration
  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  smtpPort?: number;

  @IsOptional()
  @IsString()
  smtpUsername?: string;

  @IsOptional()
  @IsString()
  smtpPassword?: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsOptional()
  @IsString()
  fromEmail?: string;

  @IsOptional()
  @IsString()
  adminEmail?: string;

  /**
   * Destination for the hidden admin password-reset OTP (Ctrl+F on the login page).
   * `@ValidateIf` (rather than plain `@IsOptional`) lets an empty string through
   * unvalidated so the field can still be cleared, while any non-empty value must be
   * a real email — otherwise a typo like "name@gmailcom" saves silently and the OTP
   * send later fails with a bare "No recipients defined" nodemailer error.
   */
  @IsOptional()
  @ValidateIf((o) => !!o.recoveryEmail)
  @IsEmail()
  recoveryEmail?: string;

  // Custom Templates (HTML + CSS)
  @IsOptional()
  @IsString()
  mailFormat?: string;

  @IsOptional()
  @IsString()
  salarySlipFormat?: string;
}
