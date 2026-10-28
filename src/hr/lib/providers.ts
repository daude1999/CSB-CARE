/** External adapters deliberately cannot deliver or read external data in the pilot. */
export interface EmailProvider {
  send(message: {
    to: string;
    subject: string;
    authenticatedUrl: string;
    idempotencyKey: string;
  }): Promise<{ accepted: boolean; providerId?: string }>;
}
export class DisabledEmailProvider implements EmailProvider {
  async send() {
    return { accepted: false };
  }
}
export interface SourceItem {
  driveId: string;
  itemId: string;
  path: string;
  version?: string;
  checksum?: string;
  employeeSuggestion?: string;
  branchSuggestion?: string;
  categorySuggestion?: string;
  requiresApproval: true;
}
export interface OneDriveReader {
  listApprovedSource(
    sourceId: string,
    cursor?: string,
  ): Promise<{ items: SourceItem[]; nextCursor?: string }>;
  readApprovedItem(item: SourceItem): Promise<Uint8Array>;
}
export class UnconfiguredOneDriveReader implements OneDriveReader {
  async listApprovedSource(): Promise<never> {
    throw new Error(
      "OneDrive is not connected. Tenant-scoped grants and CSB approval are required.",
    );
  }
  async readApprovedItem(): Promise<never> {
    throw new Error("Live migration is not enabled.");
  }
}
