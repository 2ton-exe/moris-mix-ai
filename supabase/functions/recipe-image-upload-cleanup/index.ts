export { handler } from "../_shared/recipe-images/uploadCleanup.ts";

import { handler } from "../_shared/recipe-images/uploadCleanup.ts";

if (import.meta.main) Deno.serve((req) => handler(req));
