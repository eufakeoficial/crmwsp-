import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EventsModule } from "../events/events.module.js";
import { InboxModule } from "../inbox/inbox.module.js";
import { OpportunitiesController, PipelinesController } from "./opportunities.controller.js";
import { DEFAULT_PUBLIC_QUOTE_RATE_LIMIT, PUBLIC_QUOTE_RATE_LIMIT, PublicQuotesController } from "./public-quotes.controller.js";
import { QuotesController } from "./quotes.controller.js";
import { TasksController } from "./tasks.controller.js";

@Module({
  imports: [AuthModule, EventsModule, InboxModule],
  controllers: [PipelinesController, OpportunitiesController, TasksController, QuotesController, PublicQuotesController],
  providers: [{ provide: PUBLIC_QUOTE_RATE_LIMIT, useValue: DEFAULT_PUBLIC_QUOTE_RATE_LIMIT }],
})
export class SalesModule {}
