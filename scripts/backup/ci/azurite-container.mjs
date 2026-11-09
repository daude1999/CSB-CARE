// CI only: creates a private container in the local Azurite emulator and prints two container SAS URLs
// (line 1: create+write for backups, line 2: read+list for restores). Uses Azurite's published dev key.
import { BlobServiceClient, ContainerSASPermissions, StorageSharedKeyCredential, generateBlobSASQueryParameters } from "@azure/storage-blob";

const account = "devstoreaccount1";
const devKey = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const credential = new StorageSharedKeyCredential(account, devKey);
const base = `http://127.0.0.1:10000/${account}`;
const containerName = "csb-ci-backups";
await new BlobServiceClient(base, credential).getContainerClient(containerName).createIfNotExists();
const sas = (permissions) =>
  `${base}/${containerName}?` +
  generateBlobSASQueryParameters(
    { containerName, permissions: ContainerSASPermissions.parse(permissions), expiresOn: new Date(Date.now() + 90 * 86_400_000) },
    credential,
  ).toString();
console.log(sas("cw"));
console.log(sas("rl"));
