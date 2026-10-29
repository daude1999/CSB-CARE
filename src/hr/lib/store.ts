import "server-only";

/** The HR Hub's storage (see workspace-tx.ts). Kept as the import path the HR routes use; server-only. */
export { read, transaction, createWorkspace } from "./workspace-tx";
