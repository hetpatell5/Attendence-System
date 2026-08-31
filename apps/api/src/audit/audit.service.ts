import { Injectable } from '@nestjs/common';
import type { AuditEventType, Prisma } from '@prisma/client';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LogAuditEventInput {
  eventType: AuditEventType;
  userId?: string;
  email?: string;
  ipAddress?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface LogChangeInput {
  eventType: AuditEventType;
  actorUserId: string;
  entityType: string;
  entityId: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  reason?: string;
  ipAddress?: string;
}

type PrismaClientLike = PrismaService | PrismaNamespace.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: LogAuditEventInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        eventType: input.eventType,
        userId: input.userId,
        email: input.email,
        ipAddress: input.ipAddress,
        metadata: input.metadata,
      },
    });
  }

  /**
   * Domain-change audit entry (employee/attendance/leave/salary/etc. edits).
   * Accepts an optional transaction client so callers can enlist this write
   * in the same transaction as the change it's recording.
   */
  async logChange(input: LogChangeInput, tx?: PrismaClientLike): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        eventType: input.eventType,
        userId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValue: input.oldValue,
        newValue: input.newValue,
        reason: input.reason,
        ipAddress: input.ipAddress,
      },
    });
  }
}
