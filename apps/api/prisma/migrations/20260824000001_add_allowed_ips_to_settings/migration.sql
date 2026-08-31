-- Add allowedIps to company_settings for WiFi-only punch restriction.
-- Comma-separated list of allowed public IPs. Empty string = disabled (allow all).
ALTER TABLE `company_settings` ADD COLUMN `allowedIps` VARCHAR(191) NOT NULL DEFAULT '';
