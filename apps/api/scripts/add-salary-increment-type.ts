import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  await p.$executeRawUnsafe(
    "ALTER TABLE `app_notifications` MODIFY COLUMN `type` ENUM('LEAVE_SUBMITTED','LEAVE_REQUESTED','LEAVE_APPROVED','LEAVE_REJECTED','LEAVE_CANCELLED','SALARY_PAID','SALARY_GENERATED','SALARY_INCREMENT','ATTENDANCE_ADJUSTED','ATTENDANCE_EVENT','ANNOUNCEMENT_PUBLISHED') NOT NULL"
  );
  console.log('SALARY_INCREMENT added to app_notifications.type enum successfully');
}

main()
  .then(() => p.$disconnect())
  .catch((e) => { console.error('Error:', e.message); return p.$disconnect(); });
