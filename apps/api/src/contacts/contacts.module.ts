import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ContactBookController } from "./contact-book.controller.js";

@Module({ imports: [AuthModule], controllers: [ContactBookController] })
export class ContactsModule {}
