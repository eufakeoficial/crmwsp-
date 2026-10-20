import { Global, Module } from "@nestjs/common";
import { StorageHolder, storageHolderFromEnv } from "./object-storage.js";

@Global()
@Module({
  providers: [{ provide: StorageHolder, useFactory: storageHolderFromEnv }],
  exports: [StorageHolder],
})
export class StorageModule {}
