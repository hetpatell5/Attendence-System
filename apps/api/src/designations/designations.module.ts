import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DesignationsService } from './designations.service';
import { DesignationsController } from './designations.controller';

@Module({
  imports: [AuditModule],
  controllers: [DesignationsController],
  providers: [DesignationsService],
  exports: [DesignationsService],
})
export class DesignationsModule {}
