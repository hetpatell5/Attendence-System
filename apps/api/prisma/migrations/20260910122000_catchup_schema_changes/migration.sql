-- DropForeignKey
ALTER TABLE `app_attendance` DROP FOREIGN KEY `attendance_employeeId_fkey`;

-- DropForeignKey
ALTER TABLE `app_attendance_adjustments` DROP FOREIGN KEY `attendance_adjustments_attendanceId_fkey`;

-- DropForeignKey
ALTER TABLE `app_employee_shifts` DROP FOREIGN KEY `employee_shifts_employeeId_fkey`;

-- DropForeignKey
ALTER TABLE `app_employee_shifts` DROP FOREIGN KEY `employee_shifts_shiftId_fkey`;

-- DropForeignKey
ALTER TABLE `app_employees` DROP FOREIGN KEY `employees_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `app_employees` DROP FOREIGN KEY `employees_designationId_fkey`;

-- DropForeignKey
ALTER TABLE `app_employees` DROP FOREIGN KEY `employees_userId_fkey`;

-- DropForeignKey
ALTER TABLE `app_holidays` DROP FOREIGN KEY `holidays_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `app_leave_requests` DROP FOREIGN KEY `leave_requests_employeeId_fkey`;

-- DropForeignKey
ALTER TABLE `app_leave_requests` DROP FOREIGN KEY `leave_requests_leaveTypeId_fkey`;

-- DropForeignKey
ALTER TABLE `app_notifications` DROP FOREIGN KEY `notifications_employeeId_fkey`;

-- DropIndex
DROP INDEX `idx_emp` ON `face_descriptors`;

-- AlterTable
ALTER TABLE `admin_notifications` MODIFY `punch_type` enum('in','out') NOT NULL,
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `admin_users` MODIFY `username` VARCHAR(191) NOT NULL,
    MODIFY `password` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `announcements` MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `app_attendance` ADD COLUMN `punchPairs` JSON NULL;

-- AlterTable
ALTER TABLE `app_attendance_adjustments` MODIFY `oldValue` JSON NOT NULL,
    MODIFY `newValue` JSON NOT NULL;

-- AlterTable
ALTER TABLE `app_employees` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `alternatePhone` VARCHAR(191) NULL,
    ADD COLUMN `incrementEffectiveFrom` DATE NULL,
    ADD COLUMN `incrementInterval` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `monthlyIncrement` DECIMAL(10, 2) NULL,
    ADD COLUMN `targetSalary` DECIMAL(10, 2) NULL;

-- AlterTable
ALTER TABLE `app_notifications` MODIFY `type` ENUM('LEAVE_SUBMITTED', 'LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED', 'SALARY_PAID', 'SALARY_GENERATED', 'ATTENDANCE_ADJUSTED', 'ATTENDANCE_EVENT', 'ANNOUNCEMENT_PUBLISHED') NOT NULL;

-- AlterTable
ALTER TABLE `attendance` MODIFY `day_of_week` VARCHAR(191) NULL,
    MODIFY `note` VARCHAR(191) NULL,
    MODIFY `location_lat` VARCHAR(191) NULL,
    MODIFY `location_long` VARCHAR(191) NULL,
    MODIFY `status` VARCHAR(191) NULL,
    MODIFY `attendance_status` VARCHAR(191) NULL DEFAULT 'present';

-- AlterTable
ALTER TABLE `attendance_log` MODIFY `day` VARCHAR(191) NOT NULL,
    MODIFY `punch_type` enum('in','out') NOT NULL,
    MODIFY `created_at` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `audit_logs` MODIFY `metadata` JSON NULL,
    MODIFY `oldValue` JSON NULL,
    MODIFY `newValue` JSON NULL;

-- AlterTable
ALTER TABLE `company_settings` ADD COLUMN `adminEmail` VARCHAR(191) NULL,
    ADD COLUMN `companyAddress` TEXT NULL,
    ADD COLUMN `companyFavicon` TEXT NULL,
    ADD COLUMN `companyLogo` TEXT NULL,
    ADD COLUMN `fromEmail` VARCHAR(191) NULL,
    ADD COLUMN `fromName` VARCHAR(191) NULL,
    ADD COLUMN `mailFormat` TEXT NULL,
    ADD COLUMN `salarySlipFormat` TEXT NULL,
    ADD COLUMN `smtpHost` VARCHAR(191) NULL,
    ADD COLUMN `smtpPassword` VARCHAR(191) NULL,
    ADD COLUMN `smtpPort` INTEGER NULL DEFAULT 587,
    ADD COLUMN `smtpUsername` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `documents` MODIFY `title` VARCHAR(191) NULL,
    MODIFY `file_path` VARCHAR(191) NULL,
    MODIFY `type` VARCHAR(191) NULL,
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `employees` MODIFY `full_name` VARCHAR(191) NOT NULL,
    MODIFY `mobile_number` VARCHAR(191) NULL,
    MODIFY `alternate_number` VARCHAR(191) NULL,
    MODIFY `username` VARCHAR(191) NULL,
    MODIFY `email` VARCHAR(191) NULL,
    MODIFY `profile_image` VARCHAR(191) NULL,
    MODIFY `monthly_salary` DECIMAL(65, 30) NOT NULL DEFAULT 0.00,
    MODIFY `target_salary` DECIMAL(65, 30) NULL,
    MODIFY `monthly_increment` DECIMAL(65, 30) NULL,
    MODIFY `password` VARCHAR(191) NULL,
    MODIFY `status` enum('active','inactive') NOT NULL DEFAULT 'active',
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `face_descriptors` MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `updated_at` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `holidays` MODIFY `reason` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `leave_requests` MODIFY `status` enum('Pending','Approved','Rejected') NULL DEFAULT 'Pending',
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `last_edited_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `message` VARCHAR(191) NOT NULL,
    MODIFY `type` VARCHAR(191) NOT NULL,
    MODIFY `status` VARCHAR(191) NULL DEFAULT 'unread',
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salary_details` MODIFY `month_year` VARCHAR(191) NOT NULL,
    MODIFY `total_hours` DECIMAL(65, 30) NULL DEFAULT 0.00,
    MODIFY `expected_hours` DECIMAL(65, 30) NULL DEFAULT 0.00,
    MODIFY `hour_rate` DECIMAL(65, 30) NULL DEFAULT 0.00,
    MODIFY `commission` DECIMAL(65, 30) NULL DEFAULT 0.00,
    MODIFY `advance_amount` DECIMAL(65, 30) NULL DEFAULT 0.00,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    MODIFY `final_salary` DECIMAL(65, 30) NULL DEFAULT 0.00,
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `updated_at` DATETIME(3) NULL,
    MODIFY `paid_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `salary_history` MODIFY `amount` DECIMAL(65, 30) NOT NULL,
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salary_increment_log` MODIFY `old_salary` DECIMAL(65, 30) NOT NULL,
    MODIFY `new_salary` DECIMAL(65, 30) NOT NULL,
    MODIFY `increment_amount` DECIMAL(65, 30) NOT NULL,
    MODIFY `target_salary` DECIMAL(65, 30) NOT NULL,
    MODIFY `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `settings` MODIFY `company_name` VARCHAR(191) NULL DEFAULT 'Admin Panel',
    MODIFY `company_logo` VARCHAR(191) NULL,
    MODIFY `company_favicon` VARCHAR(191) NULL,
    MODIFY `updated_at` DATETIME(3) NOT NULL,
    MODIFY `recovery_email` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `shifts` MODIFY `shift_name` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `smtp_settings` MODIFY `smtp_host` VARCHAR(191) NOT NULL,
    MODIFY `smtp_username` VARCHAR(191) NOT NULL,
    MODIFY `smtp_password` VARCHAR(191) NOT NULL,
    MODIFY `from_name` VARCHAR(191) NOT NULL,
    MODIFY `from_email` VARCHAR(191) NOT NULL,
    MODIFY `admin_email` VARCHAR(191) NOT NULL,
    MODIFY `updated_at` DATETIME(3) NOT NULL;

-- AlterTable
ALTER TABLE `users` MODIFY `email` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `app_attendance_requests` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `attendanceDate` DATE NOT NULL,
    `punchInAt` DATETIME(3) NULL,
    `punchOutAt` DATETIME(3) NULL,
    `punchPairs` JSON NULL,
    `originalPunchIn` DATETIME(3) NULL,
    `originalPunchOut` DATETIME(3) NULL,
    `originalPairs` JSON NULL,
    `reason` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewRemarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `app_attendance_requests_employeeId_status_idx`(`employeeId`, `status`),
    INDEX `app_attendance_requests_status_idx`(`status`),
    INDEX `app_attendance_requests_attendanceDate_idx`(`attendanceDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_salary_history` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `app_salary_history_employeeId_effectiveFrom_idx`(`employeeId`, `effectiveFrom`),
    UNIQUE INDEX `app_salary_history_employeeId_effectiveFrom_key`(`employeeId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `app_employees` ADD CONSTRAINT `app_employees_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_employees` ADD CONSTRAINT `app_employees_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_employees` ADD CONSTRAINT `app_employees_designationId_fkey` FOREIGN KEY (`designationId`) REFERENCES `designations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_employee_shifts` ADD CONSTRAINT `app_employee_shifts_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `app_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_employee_shifts` ADD CONSTRAINT `app_employee_shifts_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `app_shifts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_attendance` ADD CONSTRAINT `app_attendance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `app_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_attendance_adjustments` ADD CONSTRAINT `app_attendance_adjustments_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `app_attendance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_attendance_requests` ADD CONSTRAINT `app_attendance_requests_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `app_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_leave_requests` ADD CONSTRAINT `app_leave_requests_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `app_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_leave_requests` ADD CONSTRAINT `app_leave_requests_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_holidays` ADD CONSTRAINT `app_holidays_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_salary_history` ADD CONSTRAINT `app_salary_history_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `app_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `app_notifications` ADD CONSTRAINT `app_notifications_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `app_employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `app_announcements` RENAME INDEX `announcements_isActive_publishedAt_idx` TO `app_announcements_isActive_publishedAt_idx`;

-- RenameIndex
ALTER TABLE `app_announcements` RENAME INDEX `announcements_legacySourceId_key` TO `app_announcements_legacySourceId_key`;

-- RenameIndex
ALTER TABLE `app_attendance` RENAME INDEX `attendance_attendanceDate_idx` TO `app_attendance_attendanceDate_idx`;

-- RenameIndex
ALTER TABLE `app_attendance` RENAME INDEX `attendance_employeeId_attendanceDate_idx` TO `app_attendance_employeeId_attendanceDate_idx`;

-- RenameIndex
ALTER TABLE `app_attendance` RENAME INDEX `attendance_employeeId_attendanceDate_key` TO `app_attendance_employeeId_attendanceDate_key`;

-- RenameIndex
ALTER TABLE `app_attendance` RENAME INDEX `attendance_status_idx` TO `app_attendance_status_idx`;

-- RenameIndex
ALTER TABLE `app_attendance_adjustments` RENAME INDEX `attendance_adjustments_attendanceId_idx` TO `app_attendance_adjustments_attendanceId_idx`;

-- RenameIndex
ALTER TABLE `app_employee_shifts` RENAME INDEX `employee_shifts_employeeId_effectiveFrom_idx` TO `app_employee_shifts_employeeId_effectiveFrom_idx`;

-- RenameIndex
ALTER TABLE `app_employee_shifts` RENAME INDEX `employee_shifts_employeeId_effectiveFrom_key` TO `app_employee_shifts_employeeId_effectiveFrom_key`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_departmentId_idx` TO `app_employees_departmentId_idx`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_designationId_idx` TO `app_employees_designationId_idx`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_email_key` TO `app_employees_email_key`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_employeeCode_key` TO `app_employees_employeeCode_key`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_lastName_firstName_idx` TO `app_employees_lastName_firstName_idx`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_legacySourceId_key` TO `app_employees_legacySourceId_key`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_status_idx` TO `app_employees_status_idx`;

-- RenameIndex
ALTER TABLE `app_employees` RENAME INDEX `employees_userId_key` TO `app_employees_userId_key`;

-- RenameIndex
ALTER TABLE `app_holidays` RENAME INDEX `holidays_date_departmentId_key` TO `app_holidays_date_departmentId_key`;

-- RenameIndex
ALTER TABLE `app_holidays` RENAME INDEX `holidays_date_idx` TO `app_holidays_date_idx`;

-- RenameIndex
ALTER TABLE `app_leave_requests` RENAME INDEX `leave_requests_employeeId_status_idx` TO `app_leave_requests_employeeId_status_idx`;

-- RenameIndex
ALTER TABLE `app_leave_requests` RENAME INDEX `leave_requests_legacySourceId_key` TO `app_leave_requests_legacySourceId_key`;

-- RenameIndex
ALTER TABLE `app_leave_requests` RENAME INDEX `leave_requests_startDate_endDate_idx` TO `app_leave_requests_startDate_endDate_idx`;

-- RenameIndex
ALTER TABLE `app_leave_requests` RENAME INDEX `leave_requests_status_idx` TO `app_leave_requests_status_idx`;

-- RenameIndex
ALTER TABLE `app_notifications` RENAME INDEX `notifications_employeeId_createdAt_idx` TO `app_notifications_employeeId_createdAt_idx`;

-- RenameIndex
ALTER TABLE `app_notifications` RENAME INDEX `notifications_employeeId_readAt_idx` TO `app_notifications_employeeId_readAt_idx`;

-- RenameIndex
ALTER TABLE `app_shifts` RENAME INDEX `shifts_legacySourceId_key` TO `app_shifts_legacySourceId_key`;

-- RenameIndex
ALTER TABLE `app_shifts` RENAME INDEX `shifts_name_key` TO `app_shifts_name_key`;

-- RenameIndex
ALTER TABLE `employees` RENAME INDEX `unique_email` TO `employees_email_key`;

-- RenameIndex
ALTER TABLE `face_descriptors` RENAME INDEX `unique_emp` TO `face_descriptors_employee_id_key`;

-- RenameIndex
ALTER TABLE `holidays` RENAME INDEX `unique_holiday_date` TO `holidays_date_key`;

-- RenameIndex
ALTER TABLE `shifts` RENAME INDEX `unique_shift_name` TO `shifts_shift_name_key`;

