import type { PrismaClient } from '@prisma/client';
import type { LegacySourceClient } from './source-client';
import type { IdMap } from './id-map';

export interface MigrationContext {
  source: LegacySourceClient;
  prisma: PrismaClient;
  idMap: IdMap;
  commit: boolean;
  orphanStrategy: 'tombstone' | 'skip';
  actorUserId: string;
}

export interface PhaseResult {
  phase: string;
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export function emptyResult(phase: string): PhaseResult {
  return { phase, created: 0, updated: 0, skipped: 0, warnings: [] };
}
