import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Object storage port used by the media job and the AI media loader. Keys are tenant-prefixed. */
export interface MediaStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string | null }>;
}

interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

/** Same S3_* variables as the API StorageModule. Returns null when not configured. */
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

export class S3MediaStore implements MediaStore {
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

  async get(key: string): Promise<{ data: Uint8Array; contentType: string | null }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error("empty object body");
    return { data: await res.Body.transformToByteArray(), contentType: res.ContentType ?? null };
  }
}

export function mediaStoreFromEnv(): MediaStore | null {
  const cfg = s3ConfigFromEnv();
  return cfg ? new S3MediaStore(cfg) : null;
}
