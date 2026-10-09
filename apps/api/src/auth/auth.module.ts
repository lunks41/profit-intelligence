import { Global, Module } from '@nestjs/common';
import { InstallationService } from './installation.service.js';
import { SessionGuard } from './session.guard.js';

@Global()
@Module({
  providers: [InstallationService, SessionGuard],
  exports: [InstallationService, SessionGuard],
})
export class AuthModule {}
