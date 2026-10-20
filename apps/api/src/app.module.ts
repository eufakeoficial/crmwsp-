import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AiModule } from "./ai/ai.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CommerceModule } from "./commerce/commerce.module.js";
import { ChannelsModule } from "./channels/channels.module.js";
import { AppErrorFilter } from "./common/error.filter.js";
import { DbModule } from "./db/db.module.js";
import { EventsModule } from "./events/events.module.js";
import { HealthController } from "./health.controller.js";
import { InboxModule } from "./inbox/inbox.module.js";
import { KnowledgeModule } from "./knowledge/knowledge.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { IntegrationsModule } from "./integrations/integrations.module.js";
import { AdsModule } from "./ads/ads.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { FollowUpsModule } from "./followups/followups.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { PaymentReviewsModule } from "./payment-reviews/payment-reviews.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { DevelopersModule } from "./developers/developers.module.js";
import { BroadcastsModule } from "./broadcasts/broadcasts.module.js";
import { ContactsModule } from "./contacts/contacts.module.js";
import { TeamModule } from "./team/team.module.js";

@Module({
  imports: [DbModule, StorageModule, AuthModule, TenantModule, WebhooksModule, ChannelsModule, InboxModule, EventsModule, AiModule, KnowledgeModule, SalesModule, CommerceModule, PaymentsModule, MetricsModule, AnalyticsModule, FollowUpsModule, NotificationsModule, PaymentReviewsModule, IntegrationsModule, BillingModule, AdsModule, DevelopersModule, BroadcastsModule, ContactsModule, TeamModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AppErrorFilter }],
})
export class AppModule {}
