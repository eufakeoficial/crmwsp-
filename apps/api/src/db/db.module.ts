import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, type DbHandle } from "@crmwsp/db";
import { DB_HANDLE } from "../common/http.js";

/** Single pool for the process, always with the app role (DATABASE_URL). */
@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      useFactory: (): DbHandle => {
        const url = process.env["DATABASE_URL"];
        if (!url) throw new Error("DATABASE_URL is not set");
        return createDb(url);
      },
    },
  ],
  exports: [DB_HANDLE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
