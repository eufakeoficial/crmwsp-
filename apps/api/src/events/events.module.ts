import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EventsController } from "./events.controller.js";
import { RealtimeHub } from "./realtime.hub.js";

@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [RealtimeHub],
  exports: [RealtimeHub],
})
export class EventsModule {}
