import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { db } from "@/lib/db";

/**
 * Private object storage. Keys are opaque; objects are never served directly,
 * only streamed through authorised route handlers after a tenant check.
 */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStorage implements StorageProvider {
  constructor(private readonly root: string) {}
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
}

class AzureBlobStorage implements StorageProvider {
  private containerPromise;
  constructor(connectionString: string, container: string) {
    this.containerPromise = import("@azure/storage-blob").then(async ({ BlobServiceClient }) => {
      const c = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);
      await c.createIfNotExists(); // private access by default
      return c;
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    const c = await this.containerPromise;
    await c.getBlockBlobClient(key).uploadData(body, { blobHTTPHeaders: { blobContentType: contentType } });
  }
  async get(key: string) {
    const c = await this.containerPromise;
    return c.getBlockBlobClient(key).downloadToBuffer();
  }
}

/**
 * Files kept in the platform's own PostgreSQL database (table StoredObject). Private by construction: there is no URL
 * to a row, and bytes are only returned to server code that has already checked the caller's permission. Used on
 * serverless hosts with no lasting disk, so uploads survive between requests without any extra service or key.
 */
export class DatabaseStorage implements StorageProvider {
  async put(key: string, body: Buffer, contentType: string) {
    const bytes = new Uint8Array(body);
    await db.storedObject.upsert({ where: { key }, create: { key, contentType, sizeBytes: body.length, bytes }, update: { contentType, sizeBytes: body.length, bytes } });
  }
  async get(key: string) {
    const row = await db.storedObject.findUnique({ where: { key }, select: { bytes: true } });
    if (!row) throw new Error("Stored object not found");
    return Buffer.from(row.bytes);
  }
}

/**
 * Supabase Storage through its REST API, in a private bucket (created private on first use). Needs the project URL and
 * the service-role key, which stay on the server. No public or signed links are ever made.
 */
class SupabaseStorage implements StorageProvider {
  private ready: Promise<void> | null = null;
  constructor(private readonly url: string, private readonly key: string, private readonly bucket: string) {}
  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }
  private objectUrl(key: string) {
    return `${this.url}/storage/v1/object/${encodeURIComponent(this.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  private ensureBucket() {
    this.ready ??= fetch(`${this.url}/storage/v1/bucket`, { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }) }).then(async (r) => {
      // 409 (or 400 "already exists" on older versions) means the bucket is there already.
      if (!r.ok && r.status !== 409 && !(await r.text()).toLowerCase().includes("already exists")) {
        this.ready = null;
        throw new Error(`Supabase Storage bucket check failed (HTTP ${r.status})`);
      }
    });
    return this.ready;
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.ensureBucket();
    const r = await fetch(this.objectUrl(key), { method: "POST", headers: this.headers({ "Content-Type": contentType, "x-upsert": "true" }), body: new Uint8Array(body) });
    if (!r.ok) throw new Error(`Supabase Storage upload failed (HTTP ${r.status})`);
  }
  async get(key: string) {
    const r = await fetch(this.objectUrl(key), { headers: this.headers() });
    if (!r.ok) throw new Error(`Supabase Storage download failed (HTTP ${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
}

let instance: StorageProvider | null = null;

/**
 * Which private store holds files:
 *   - STORAGE_PROVIDER=azure    Azure Blob Storage (AZURE_STORAGE_CONNECTION_STRING).
 *   - STORAGE_PROVIDER=supabase Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, bucket SUPABASE_STORAGE_BUCKET).
 *   - STORAGE_PROVIDER=database the platform database.
 *   - otherwise a local folder, except on Vercel, whose disk is temporary (/tmp is wiped between requests), so files
 *     go to the database there instead and are never lost.
 */
export function storage(): StorageProvider {
  if (instance) return instance;
  const provider = process.env.STORAGE_PROVIDER;
  if (provider === "azure") {
    const cs = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!cs) throw new Error("STORAGE_PROVIDER=azure requires AZURE_STORAGE_CONNECTION_STRING");
    instance = new AzureBlobStorage(cs, process.env.AZURE_STORAGE_CONTAINER ?? "csb-private");
  } else if (provider === "supabase") {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("STORAGE_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    instance = new SupabaseStorage(url.replace(/\/+$/, ""), key, process.env.SUPABASE_STORAGE_BUCKET ?? "csb-private");
  } else if (provider === "database" || process.env.VERCEL) {
    instance = new DatabaseStorage();
  } else {
    instance = new LocalStorage(process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), ".data", "storage"));
  }
  return instance;
}

export function setStorageForTests(p: StorageProvider) {
  instance = p;
}
