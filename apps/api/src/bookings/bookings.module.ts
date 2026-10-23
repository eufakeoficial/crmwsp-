import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BookingResourcesController, BookingServicesController } from "./booking-config.controller.js";
import { BookingsController } from "./bookings.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [BookingResourcesController, BookingServicesController, BookingsController],
})
export class BookingsModule {}
