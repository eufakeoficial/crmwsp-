import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { DEFAULT_INVITE_RATE_LIMIT, INVITE_RATE_LIMIT, InvitationAcceptService } from "./invitation-accept.service.js";
import { MAILER, mailerFromEnv } from "./mailer.js";
import { InvitationsController, TeamController } from "./team.controller.js";
import { TeamService } from "./team.service.js";

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [TeamController, InvitationsController],
  providers: [
    TeamService,
    InvitationAcceptService,
    { provide: MAILER, useFactory: () => mailerFromEnv() },
    { provide: INVITE_RATE_LIMIT, useValue: DEFAULT_INVITE_RATE_LIMIT },
  ],
})
export class TeamModule {}
