import { stat } from "node:fs/promises";
import { BlobServiceClient } from "@azure/storage-blob";

const file = process.argv[2];
const name = process.argv[3];
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER;

if (!file || !name || !connectionString || !containerName) {
  throw new Error("Usage: node scripts/upload-db-backup.mjs <encrypted-file> <blob-name>; set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER");
}
if (!name.startsWith("postgres/") || !name.endsWith(".dump.age")) {
  throw new Error("Backup blob name must be under postgres/ and end in .dump.age");
}
const info = await stat(file);
if (!info.isFile() || info.size < 32) throw new Error("Encrypted backup is missing or too small");

const service = BlobServiceClient.fromConnectionString(connectionString);
const container = service.getContainerClient(containerName);
const properties = await container.getProperties();
if (properties.blobPublicAccess) throw new Error("Refusing to upload backups: the Azure container allows anonymous public access");
const blob = container.getBlockBlobClient(name);
await blob.uploadFile(file, {
  blobHTTPHeaders: { blobContentType: "application/octet-stream", blobCacheControl: "no-store" },
  metadata: { encrypted: "age", format: "postgres-custom", createdutc: new Date().toISOString().replace(/[^0-9TZ]/g, "") },
  conditions: { ifNoneMatch: "*" },
});
console.log(`Encrypted PostgreSQL backup uploaded: ${name} (${info.size} bytes)`);
