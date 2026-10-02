-- AlterTable: add paid_at DateTime column to salary_records
ALTER TABLE `salary_records` ADD COLUMN `paid_at` DATETIME(3) NULL;
