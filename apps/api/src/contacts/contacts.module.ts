import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { ContactBulkController } from "./contact-bulk.controller.js";
import { ContactBookController } from "./contact-book.controller.js";
import { ContactCreateController } from "./contact-create.controller.js";
import { SegmentsController } from "./segments.controller.js";

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [ContactBookController, ContactBulkController, ContactCreateController, SegmentsController],
})
export class ContactsModule {}
