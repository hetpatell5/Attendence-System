import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const SINGLETON_COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

const prisma = new PrismaClient();

async function seedAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in the environment to seed the initial SUPER_ADMIN user.',
    );
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: 'System Administrator',
      role: 'SUPER_ADMIN',
    },
  });

  console.log(`Seeded SUPER_ADMIN user: ${user.email}`);
}

async function seedCompanySettings(): Promise<void> {
  await prisma.companySettings.upsert({
    where: { id: SINGLETON_COMPANY_SETTINGS_ID },
    update: {},
    create: { id: SINGLETON_COMPANY_SETTINGS_ID },
  });
  console.log('Seeded CompanySettings singleton');
}

async function seedOrganization(): Promise<void> {
  const departments = ['IT', 'HR', 'Sales', 'Accounts', 'Operations'];
  for (const name of departments) {
    await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
  }

  const designations = ['Developer', 'Manager', 'Accountant', 'Executive'];
  for (const title of designations) {
    await prisma.designation.upsert({ where: { title }, update: {}, create: { title } });
  }

  await prisma.shift.upsert({
    where: { name: 'General Shift' },
    update: {},
    create: {
      name: 'General Shift',
      startTime: '09:00',
      endTime: '18:00',
      gracePeriodMinutes: 15,
      breakDurationMinutes: 60,
      workingHours: 8,
      halfDayThresholdHours: 4,
    },
  });

  console.log('Seeded departments, designations, and default shift');
}

async function seedLeaveTypes(): Promise<void> {
  const leaveTypes = [
    { name: 'Annual Leave', code: 'ANNUAL', defaultAnnualDays: 18 },
    { name: 'Sick Leave', code: 'SICK', defaultAnnualDays: 10 },
    { name: 'Unpaid Leave', code: 'UNPAID', defaultAnnualDays: 0, isPaid: false, countsAsPresent: false },
    {
      name: 'Imported Leave (BMA)',
      code: 'LEGACY',
      defaultAnnualDays: 0,
      isPaid: true,
      requiresApproval: false,
      countsAsPresent: true,
      allowHalfDay: false,
      isActive: false,
    },
  ];
  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({ where: { code: lt.code }, update: {}, create: lt });
  }
  console.log('Seeded leave types');
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedCompanySettings();
  await seedOrganization();
  await seedLeaveTypes();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
