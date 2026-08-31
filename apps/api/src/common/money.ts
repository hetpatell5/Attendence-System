import { Prisma } from '@prisma/client';

/** Prisma Decimal (or number/string) -> a fixed 2-decimal string for API responses. */
export function toMoney(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

/** API-provided decimal string/number -> Prisma Decimal for persistence. */
export function fromMoney(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
