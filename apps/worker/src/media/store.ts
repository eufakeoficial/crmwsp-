import { createHash, createHmac } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Object storage port used by the media job and the AI media loader. Keys are tenant-prefixed. */
export interface MediaStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string | null }>;
  /** Short-lived public GET URL (outbound media handed to the BSP). Optional for test doubles. */
  signedGetUrl?(key: string, expiresInSeconds: number): Promise<string>;
}

export interface S3Config {
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

  signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(presignS3GetUrl(this.cfg, key, expiresInSeconds));
  }
}

const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (k: Buffer | string, d: string): Buffer => createHmac("sha256", k).update(d, "utf8").digest();

/**
 * AWS SigV4 query-string presigned GET (same result as @aws-sdk/s3-request-presigner, which the
 * worker does not depend on). Used to hand a short-lived URL to the BSP for outbound voice notes.
 */
export function presignS3GetUrl(cfg: S3Config, key: string, expiresInSeconds: number, now: Date = new Date()): string {
  const encodedKey = key.split("/").map(rfc3986).join("/");
  let origin: string;
  let path: string;
  if (cfg.endpoint) {
    const u = new URL(cfg.endpoint);
    origin = `${u.protocol}//${u.host}`;
    const base = u.pathname.replace(/\/+$/, "");
    path = cfg.forcePathStyle ? `${base}/${rfc3986(cfg.bucket)}/${encodedKey}` : `${base}/${encodedKey}`;
    if (!cfg.forcePathStyle) origin = `${u.protocol}//${cfg.bucket}.${u.host}`;
  } else if (cfg.forcePathStyle) {
    origin = `https://s3.${cfg.region}.amazonaws.com`;
    path = `/${rfc3986(cfg.bucket)}/${encodedKey}`;
  } else {
    origin = `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
    path = `/${encodedKey}`;
  }
  const host = new URL(origin).host;
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKey}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.max(1, Math.min(604_800, Math.floor(expiresInSeconds))))],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = ["GET", path, query, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical, "utf8").digest("hex")].join("\n");
  const kDate = hmac(`AWS4${cfg.secretKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, cfg.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  return `${origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

export function mediaStoreFromEnv(): MediaStore | null {
  const cfg = s3ConfigFromEnv();
  return cfg ? new S3MediaStore(cfg) : null;
}
