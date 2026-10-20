import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageNotConfiguredError } from "@crmwsp/contracts";

/** Minimal object storage port. Keys are chosen by the app (always prefixed by tenant). */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Short-lived GET URL. Never a permanent public link. */
  signedGetUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

/** Reads the S3_* variables of .env.example. Returns null when the bucket or credentials are missing. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucket = env["S3_BUCKET"];
  const accessKey = env["S3_ACCESS_KEY"];
  const secretKey = env["S3_SECRET_KEY"];
  if (!bucket || !accessKey || !secretKey) return null;
  const endpoint = env["S3_ENDPOINT"];
  return {
    ...(endpoint ? { endpoint } : {}),
    region: env["S3_REGION"] || "us-east-1",
    bucket,
    accessKey,
    secretKey,
    forcePathStyle: (env["S3_FORCE_PATH_STYLE"] ?? "false").toLowerCase() === "true",
  };
}

/** S3-compatible implementation (RustFS in dev, R2/S3 in prod). */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

/**
 * Holder provided to controllers. `storage` is null when S3_* is not configured; tests swap it.
 * Use `require()` where a file operation is mandatory (503 otherwise).
 */
export class StorageHolder {
  storage: ObjectStorage | null;

  constructor(storage: ObjectStorage | null = null) {
    this.storage = storage;
  }

  require(): ObjectStorage {
    if (!this.storage) throw new StorageNotConfiguredError("Object storage (S3_*) is not configured");
    return this.storage;
  }
}

export function storageHolderFromEnv(): StorageHolder {
  const cfg = s3ConfigFromEnv();
  return new StorageHolder(cfg ? new S3ObjectStorage(cfg) : null);
}
