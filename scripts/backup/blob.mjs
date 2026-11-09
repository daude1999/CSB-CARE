// Minimal Azure Blob client for the backup scripts, using a container-scoped SAS URL.
// Plain HTTPS (no SDK) so the self-hosted runner needs only Node 22: no npm install.
//
//   node scripts/backup/blob.mjs preflight-upload           (env AZURE_BACKUP_CONTAINER_SAS_URL)
//   node scripts/backup/blob.mjs upload <file> <blob-name>  (env AZURE_BACKUP_CONTAINER_SAS_URL)
//   node scripts/backup/blob.mjs latest                     (env AZURE_RESTORE_CONTAINER_SAS_URL)
//   node scripts/backup/blob.mjs download <blob-name> <file> (env AZURE_RESTORE_CONTAINER_SAS_URL)
//
// Logs never contain the SAS token, only blob names, sizes and Azure status codes.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import { BackupConfigError, isBackupBlobName, latestBackupName, parseContainerSas, sasDaysLeft } from "./lib.mjs";

const API_VERSION = "2023-11-03";
const MAX_SINGLE_PUT = 5000 * 1024 * 1024; // Azure Put Blob limit (5000 MiB)
const AGE_HEADER = "age-encryption.org/v1";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function request(method, url, { headers = {}, body, toFile } = {}) {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method, headers: { "x-ms-version": API_VERSION, ...headers } }, (res) => {
      if (toFile && res.statusCode === 200) {
        const hash = createHash("sha256");
        res.on("data", (chunk) => hash.update(chunk));
        pipeline(res, createWriteStream(toFile, { mode: 0o600 }))
          .then(() => resolve({ status: 200, headers: res.headers, sha256: hash.digest("hex") }))
          .catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", (e) => reject(new Error(`Azure request failed (${e.code ?? "network error"})`)));
    if (body) body.pipe(req);
    else req.end();
  });
}

function azureError(what, res) {
  const code = res.headers["x-ms-error-code"] ?? "no error code";
  return `${what} failed: HTTP ${res.status} (${code})`;
}

function withSas(base, sas, path = "", extra = "") {
  return new URL(`${base}${path}?${extra ? `${extra}&` : ""}${sas}`);
}

function blobPath(name) {
  return "/" + name.split("/").map(encodeURIComponent).join("/");
}

function config(envName, purpose) {
  try {
    const parsed = parseContainerSas(process.env[envName], purpose);
    const days = sasDaysLeft(parsed);
    if (days !== null && days < 0) fail(`The ${envName} SAS has expired. Issue a new one in Azure and update the GitHub secret`);
    if (days !== null && days < 30) console.log(`::warning::The ${envName} SAS expires in ${days} day(s). Renew it before then`);
    return parsed;
  } catch (e) {
    if (e instanceof BackupConfigError) fail(`${envName}: ${e.message}`);
    throw e;
  }
}

/** Anonymous requests must be refused: a container that answers without the SAS is public. */
async function assertNotPublic(cfg, blobName) {
  const list = await request("GET", new URL(`${cfg.containerUrl}?restype=container&comp=list&maxresults=1`));
  if (list.status === 200) fail("Refusing to continue: the Azure container allows anonymous public listing. Set its access level to Private");
  if (blobName) {
    const head = await request("HEAD", new URL(cfg.containerUrl + blobPath(blobName)));
    if (head.status === 200) {
      fail(`The uploaded blob ${blobName} can be read without a key. It is age-encrypted, but set the container to Private and disable anonymous access on the storage account now`);
    }
  }
}

async function preflightUpload() {
  const cfg = config("AZURE_BACKUP_CONTAINER_SAS_URL", "backup");
  await assertNotPublic(cfg);
  console.log(`Azure container "${cfg.container}" is reachable and not public.`);
}

async function upload(file, name) {
  if (!file || !name) fail("Usage: blob.mjs upload <encrypted-file> <blob-name>");
  if (!isBackupBlobName(name)) fail("Backup blob name must look like postgres/<UTC stamp>/csb-care.dump.age");
  const cfg = config("AZURE_BACKUP_CONTAINER_SAS_URL", "backup");
  const info = await stat(file);
  if (!info.isFile() || info.size < 64) fail("Encrypted backup is missing or too small");
  if (info.size > MAX_SINGLE_PUT) fail("Encrypted backup is larger than 5000 MiB; the uploader needs block uploads before it can handle this size");
  // Never upload anything that is not age ciphertext.
  const fh = await open(file, "r");
  const head = Buffer.alloc(AGE_HEADER.length);
  await fh.read(head, 0, head.length, 0);
  await fh.close();
  if (head.toString("utf8") !== AGE_HEADER) fail("Refusing to upload: the file is not age-encrypted");

  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  const sha256 = hash.digest("hex");

  const res = await request("PUT", withSas(cfg.containerUrl, cfg.sas, blobPath(name)), {
    headers: {
      "Content-Length": String(info.size),
      "Content-Type": "application/octet-stream",
      "x-ms-blob-type": "BlockBlob",
      "x-ms-blob-cache-control": "no-store",
      "x-ms-meta-encrypted": "age",
      "x-ms-meta-format": "postgres-custom",
      "x-ms-meta-sha256": sha256,
      "If-None-Match": "*", // never overwrite an existing backup
    },
    body: createReadStream(file),
  });
  if (res.status !== 201) fail(azureError("Upload", res));
  await assertNotPublic(cfg, name);
  console.log(`Encrypted PostgreSQL backup uploaded: ${name} (${info.size} bytes, sha256 ${sha256})`);
}

async function listNames(cfg) {
  const names = [];
  let marker = "";
  do {
    const extra = `restype=container&comp=list&prefix=postgres%2F${marker ? `&marker=${encodeURIComponent(marker)}` : ""}`;
    const res = await request("GET", withSas(cfg.containerUrl, cfg.sas, "", extra));
    if (res.status !== 200) fail(azureError("Listing backups", res));
    for (const m of res.text.matchAll(/<Name>([^<]+)<\/Name>/g)) names.push(m[1]);
    marker = res.text.match(/<NextMarker>([^<]*)<\/NextMarker>/)?.[1] ?? "";
  } while (marker);
  return names;
}

async function latest() {
  const cfg = config("AZURE_RESTORE_CONTAINER_SAS_URL", "restore");
  const name = latestBackupName(await listNames(cfg));
  if (!name) fail("No backups found under postgres/ in the Azure container");
  process.stdout.write(`${name}\n`);
}

async function download(name, file) {
  if (!name || !file) fail("Usage: blob.mjs download <blob-name> <file>");
  if (!isBackupBlobName(name)) fail("Not a CSB backup blob name");
  const cfg = config("AZURE_RESTORE_CONTAINER_SAS_URL", "restore");
  const res = await request("GET", withSas(cfg.containerUrl, cfg.sas, blobPath(name)), { toFile: file });
  if (res.status !== 200) fail(azureError("Download", res));
  const expected = res.headers["x-ms-meta-sha256"];
  if (expected && expected !== res.sha256) {
    await rm(file, { force: true });
    fail("Downloaded backup does not match the checksum recorded at upload. It may be damaged");
  }
  console.log(`Downloaded ${name}${expected ? " (checksum verified)" : " (no checksum recorded)"}`);
}

const [cmd, a, b] = process.argv.slice(2);
const commands = { "preflight-upload": () => preflightUpload(), upload: () => upload(a, b), latest: () => latest(), download: () => download(a, b) };
if (!commands[cmd]) fail(`Unknown command. Use one of: ${Object.keys(commands).join(", ")}`);
commands[cmd]().catch((e) => fail(e instanceof Error ? e.message : "Unexpected error"));
