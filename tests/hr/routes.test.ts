import test from "node:test";
import assert from "node:assert/strict";
import { employeeRoute } from "../../src/hr/lib/routes";

test("employee routes use stable IDs and preserve branch and return context", () => {
  const route = employeeRoute(
    "emp-34",
    "tower-hamlets",
    "/people?view=All people&page=2",
  );
  const url = new URL(route, "http://localhost");

  assert.equal(url.pathname, "/people/emp-34");
  assert.equal(url.searchParams.get("branch"), "tower-hamlets");
  assert.equal(
    url.searchParams.get("returnTo"),
    "/people?view=All people&page=2",
  );
});
