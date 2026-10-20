import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ContactBulkController } from "./contact-bulk.controller.js";
import { ContactBookController } from "./contact-book.controller.js";
import { SegmentsController } from "./segments.controller.js";

@Module({ imports: [AuthModule], controllers: [ContactBookController, ContactBulkController, SegmentsController] })
export class ContactsModule {}
