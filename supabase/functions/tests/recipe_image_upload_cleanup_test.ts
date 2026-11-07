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
      if (name === "claim_recipe_image_staging_reconciliation_page") {
        return Promise.resolve({
          data: [{ continuation_token: null }],
          error: null,
        });
      }
      if (name === "claim_recipe_image_staging_reconciliation_objects") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "finish_recipe_image_staging_reconciliation_page") {
        return Promise.resolve({ data: "complete", error: null });
      }
      if (name === "recipe_image_staging_reconciliation_health") {
        return Promise.resolve({
          data: { pending: 0, failed: 0 },
          error: null,
        });
      }
      return Promise.reject(new Error("Unexpected RPC"));
    },
    deleteObject: () => Promise.resolve(outcome),
    listObjects: () =>
      Promise.resolve({ keys: [], hasMore: false, nextToken: null }),
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
    assertEquals(
      calls.find((call) => call.name === "claim_expired_recipe_image_uploads"),
      { name: "claim_expired_recipe_image_uploads", args: { p_limit: 25 } },
    );
    assertEquals(
      calls.find((call) => call.name === "finish_recipe_image_upload_cleanup"),
      {
        name: "finish_recipe_image_upload_cleanup",
        args: { p_id: ID, p_success: true, p_failure: null },
      },
    );
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
  assertEquals(
    calls.find((call) => call.name === "finish_recipe_image_upload_cleanup"),
    {
      name: "finish_recipe_image_upload_cleanup",
      args: { p_id: ID, p_success: false, p_failure: "network" },
    },
  );
});

Deno.test("reconciliation advances durable pages and rediscovers a late PUT on the next full scan", async () => {
  let continuationToken: string | null = null;
  let scanCount = 0;
  let deleteCount = 0;
  const listedCursors: (string | null)[] = [];
  const deps: UploadCleanupDeps = {
    cleanupToken: TOKEN,
    rpc: (name, args) => {
      if (name === "claim_recipe_image_staging_reconciliation_page") {
        return Promise.resolve({
          data: [{ continuation_token: continuationToken }],
          error: null,
        });
      }
      if (name === "claim_recipe_image_staging_reconciliation_objects") {
        const keys = args.p_staging_keys as string[];
        return Promise.resolve({
          data: keys.includes(STAGING_KEY)
            ? [{ staging_key: STAGING_KEY }]
            : [],
          error: null,
        });
      }
      if (name === "finish_recipe_image_staging_reconciliation_object") {
        return Promise.resolve({ data: "complete", error: null });
      }
      if (name === "finish_recipe_image_staging_reconciliation_page") {
        continuationToken = args.p_next_token as string | null;
        if (!args.p_has_more) scanCount++;
        return Promise.resolve({ data: "complete", error: null });
      }
      if (name === "claim_expired_recipe_image_uploads") {
        return Promise.resolve({ data: [], error: null });
      }
      if (
        name === "recipe_image_upload_cleanup_health" ||
        name === "recipe_image_staging_reconciliation_health"
      ) {
        return Promise.resolve({
          data: { pending: 0, failed: 0 },
          error: null,
        });
      }
      return Promise.reject(new Error("Unexpected RPC"));
    },
    listObjects: (cursor) => {
      listedCursors.push(cursor);
      if (cursor === null) {
        return Promise.resolve({
          keys: [STAGING_KEY],
          hasMore: true,
          nextToken: "next-page-token",
        });
      }
      return Promise.resolve({ keys: [], hasMore: false, nextToken: null });
    },
    deleteObject: () => {
      deleteCount++;
      return Promise.resolve("deleted");
    },
  };

  await handler(request(), deps);
  await handler(request(), deps);
  await handler(request(), deps);

  assertEquals(listedCursors, [null, "next-page-token", null]);
  assertEquals(scanCount, 1);
  assertEquals(deleteCount, 2);
});

Deno.test("reconciliation records listing failures without exposing object keys", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const deps: UploadCleanupDeps = {
    cleanupToken: TOKEN,
    rpc: (name, args) => {
      calls.push({ name, args });
      if (name === "claim_recipe_image_staging_reconciliation_page") {
        return Promise.resolve({
          data: [{ continuation_token: null }],
          error: null,
        });
      }
      if (name === "finish_recipe_image_staging_reconciliation_page") {
        return Promise.resolve({ data: "retry", error: null });
      }
      if (name === "claim_expired_recipe_image_uploads") {
        return Promise.resolve({ data: [], error: null });
      }
      if (
        name === "recipe_image_upload_cleanup_health" ||
        name === "recipe_image_staging_reconciliation_health"
      ) {
        return Promise.resolve({
          data: { pending: 0, failed: 0 },
          error: null,
        });
      }
      return Promise.reject(new Error("Unexpected RPC"));
    },
    listObjects: () => Promise.resolve("r2_rejected"),
  };
  const result = await handler(request(), deps);
  assertEquals(result.status, 503);
  assertEquals(await result.json(), {
    processed: 0,
    cleaned: 0,
    pending: 0,
    failures: 1,
  });
  assertEquals(
    calls.find((call) =>
      call.name === "finish_recipe_image_staging_reconciliation_page"
    )?.args.p_failure,
    "r2_rejected",
  );
  assertEquals(JSON.stringify(calls).includes(STAGING_KEY), false);
});

Deno.test("reconciliation parses a bounded S3 listing and deletes only listed staging keys", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const methods: string[] = [];
  const deps: UploadCleanupDeps = {
    cleanupToken: TOKEN,
    r2Config: {
      endpoint:
        "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      bucketName: "moris-mix-ai-images-staging",
      accessKeyId: "syntheticaccesskey",
      secretAccessKey: "syntheticsecretaccesskey",
    },
    rpc: (name, args) => {
      calls.push({ name, args });
      if (name === "claim_recipe_image_staging_reconciliation_page") {
        return Promise.resolve({
          data: [{ continuation_token: null }],
          error: null,
        });
      }
      if (name === "claim_recipe_image_staging_reconciliation_objects") {
        return Promise.resolve({
          data: [{ staging_key: STAGING_KEY }],
          error: null,
        });
      }
      if (name === "finish_recipe_image_staging_reconciliation_object") {
        return Promise.resolve({ data: "complete", error: null });
      }
      if (name === "finish_recipe_image_staging_reconciliation_page") {
        return Promise.resolve({ data: "complete", error: null });
      }
      if (name === "claim_expired_recipe_image_uploads") {
        return Promise.resolve({ data: [], error: null });
      }
      if (
        name === "recipe_image_upload_cleanup_health" ||
        name === "recipe_image_staging_reconciliation_health"
      ) {
        return Promise.resolve({
          data: { pending: 0, failed: 0 },
          error: null,
        });
      }
      return Promise.reject(new Error("Unexpected RPC"));
    },
    fetch: (_input, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      return Promise.resolve(
        method === "GET"
          ? new Response(
            `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>recipe-images/final/${ID}/${ID}/${ID}</Key></Contents><Contents><Key>${STAGING_KEY}</Key></Contents></ListBucketResult>`,
            { status: 200 },
          )
          : new Response(null, { status: 204 }),
      );
    },
  };

  const result = await handler(request(), deps);
  assertEquals(result.status, 200);
  assertEquals(methods, ["GET", "DELETE"]);
  assertEquals(
    calls.find((call) =>
      call.name === "claim_recipe_image_staging_reconciliation_objects"
    )?.args.p_staging_keys,
    [STAGING_KEY],
  );
});
