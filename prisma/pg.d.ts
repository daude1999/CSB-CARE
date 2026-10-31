// The small part of node-postgres (`pg`, already a dependency) that prisma/demo-reset.ts uses. pg ships no types and
// @types/pg is not installed; this avoids a new dependency for one build script.
declare module "pg" {
  export class Client {
    constructor(config: { connectionString?: string });
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(text: string): Promise<{ rows: R[] }>;
    end(): Promise<void>;
  }
}
