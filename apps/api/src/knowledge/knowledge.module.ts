import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { MultipartModule } from "../common/multipart.module.js";
import { KnowledgeController } from "./knowledge.controller.js";

@Module({
  imports: [AuthModule, AiModule, MultipartModule],
  controllers: [KnowledgeController],
})
export class KnowledgeModule {}
