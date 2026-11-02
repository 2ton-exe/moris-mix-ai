import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  handler,
  type UploadCleanupDeps,
} from "../_shared/recipe-images/uploadCleanup.ts";

const TOKEN = "synthetic-cleanup-token-0123456789abcdef";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAGING_KEY =
  "recipe-images/staging/99999999-9999-4999-8999-999999999999/33333333-3333-4333-8333-333333333333/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(token = TOKEN): Request {
  return new Request(
    "https://edge.invalid/functions/v1/recipe-image-upload-cleanup",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

function mock(outcome: "deleted" | "missing" | "network") {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const deps: UploadCleanupDeps = {
    cleanupToken: TOKEN,
    rpc: (name, args) => {
      calls.push({ name, args });
      if (name === "claim_expired_recipe_image_uploads") {
        return Promise.resolve({
          data: [{ id: ID, staging_key: STAGING_KEY }],
          error: null,
        });
      }
      if (name === "finish_recipe_image_upload_cleanup") {
        return Promise.resolve({
          data: args.p_success ? "complete" : "retry",
          error: null,
        });
      }
      if (name === "recipe_image_upload_cleanup_health") {
        return Promise.resolve({
          data: { pending: outcome === "network" ? 1 : 0, failed: 0 },
          error: null,
        });
      }
      return Promise.reject(new Error("Unexpected RPC"));
    },
    deleteObject: () => Promise.resolve(outcome),
  };
  return { deps, calls };
}

Deno.test("cleanup requires its dedicated bearer token and POST", async () => {
  const { deps } = mock("deleted");
  assertEquals((await handler(request("wrong-token"), deps)).status, 401);
  assertEquals(
    (await handler(new Request("https://edge.invalid"), deps)).status,
    405,
  );
});

for (const outcome of ["deleted", "missing"] as const) {
  Deno.test(`cleanup treats ${outcome} staging object as successful`, async () => {
    const { deps, calls } = mock(outcome);
    const response = await handler(request(), deps);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body, { processed: 1, cleaned: 1, pending: 0 });
    assertEquals(calls[0].name, "claim_expired_recipe_image_uploads");
    assertEquals(calls[0].args, { p_limit: 25 });
    assertEquals(calls[1], {
      name: "finish_recipe_image_upload_cleanup",
      args: { p_id: ID, p_success: true, p_failure: null },
    });
    assertEquals(JSON.stringify(body).includes(STAGING_KEY), false);
  });
}

Deno.test("R2 deletion failures persist a retry category and fail the scheduled run safely", async () => {
  const { deps, calls } = mock("network");
  const response = await handler(request(), deps);
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    processed: 1,
    cleaned: 0,
    pending: 1,
    failures: 1,
  });
  assertEquals(calls[1], {
    name: "finish_recipe_image_upload_cleanup",
    args: { p_id: ID, p_success: false, p_failure: "network" },
  });
});
