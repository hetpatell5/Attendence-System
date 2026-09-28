-- TEXT caps at 64KB; a base64-encoded logo/favicon image routinely exceeds that.
-- Widen to LONGTEXT so a save can't silently fail or get truncated.
ALTER TABLE `company_settings` MODIFY COLUMN `companyLogo` LONGTEXT NULL;
ALTER TABLE `company_settings` MODIFY COLUMN `companyFavicon` LONGTEXT NULL;
