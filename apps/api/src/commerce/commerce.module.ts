import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MultipartModule } from "../common/multipart.module.js";
import { MediaController } from "./media.controller.js";
import { OrdersController } from "./orders.controller.js";
import { ProductsController } from "./products.controller.js";

@Module({
  imports: [AuthModule, MultipartModule],
  controllers: [ProductsController, MediaController, OrdersController],
})
export class CommerceModule {}
