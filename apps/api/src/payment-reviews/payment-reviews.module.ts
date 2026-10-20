import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EventsModule } from "../events/events.module.js";
import { InboxModule } from "../inbox/inbox.module.js";
import { PaymentReviewsController } from "./payment-reviews.controller.js";

@Module({
  imports: [AuthModule, EventsModule, InboxModule],
  controllers: [PaymentReviewsController],
})
export class PaymentReviewsModule {}
