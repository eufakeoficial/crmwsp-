import { Module } from "@nestjs/common";
import { DEFAULT_SITE_ASSISTANT_RATE_LIMITS, PublicAssistantController, SITE_ASSISTANT_RATE_LIMITS } from "./public-assistant.controller.js";
import { SITE_ASSISTANT_CONFIG, SITE_ASSISTANT_LLM, SiteAssistantService, siteAssistantConfigFromEnv, siteAssistantLlmFromEnv } from "./site-assistant.service.js";

@Module({
  controllers: [PublicAssistantController],
  providers: [
    SiteAssistantService,
    { provide: SITE_ASSISTANT_CONFIG, useFactory: () => siteAssistantConfigFromEnv() },
    { provide: SITE_ASSISTANT_LLM, useFactory: () => siteAssistantLlmFromEnv() },
    { provide: SITE_ASSISTANT_RATE_LIMITS, useValue: DEFAULT_SITE_ASSISTANT_RATE_LIMITS },
  ],
})
export class PublicAssistantModule {}
