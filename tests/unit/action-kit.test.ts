import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { safeBack, withParam } from "@/app/action-kit";

describe("action redirects", () => {
  it("puts the message before a #fragment so the page can show it", () => {
    expect(withParam("/rota/visits/v1#corrections", "error", "Say why")).toBe("/rota/visits/v1?error=Say+why#corrections");
    expect(withParam("/a?ok=old&x=1#f", "ok", "Done")).toBe("/a?x=1&ok=Done#f");
    expect(withParam("/a", "ok", "Done")).toBe("/a?ok=Done");
  });
  it("only goes back to a path on this site", () => {
    expect(safeBack("//evil.example")).toBe("/");
    expect(safeBack("https://evil.example")).toBe("/");
    expect(safeBack("/rota")).toBe("/rota");
  });
});
