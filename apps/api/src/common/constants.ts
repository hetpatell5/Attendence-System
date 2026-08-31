/**
 * Fixed id of the single CompanySettings row. Single-tenant for now — if
 * multi-tenancy is introduced later, this becomes the id backfilled onto
 * every existing row's new `companyId` column.
 */
export const SINGLETON_COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';
