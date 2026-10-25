import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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

let instance: StorageProvider | null = null;

export function storage(): StorageProvider {
  if (instance) return instance;
  if (process.env.STORAGE_PROVIDER === "azure") {
    const cs = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!cs) throw new Error("STORAGE_PROVIDER=azure requires AZURE_STORAGE_CONNECTION_STRING");
    instance = new AzureBlobStorage(cs, process.env.AZURE_STORAGE_CONTAINER ?? "evantix-private");
  } else {
    // Serverless hosts (Vercel) only allow writes under /tmp, which does not survive between requests.
    const fallback = process.env.VERCEL ? join("/tmp", "evantix-storage") : join(process.cwd(), ".data", "storage");
    instance = new LocalStorage(process.env.STORAGE_LOCAL_DIR ?? fallback);
  }
  return instance;
}

export function setStorageForTests(p: StorageProvider) {
  instance = p;
}
