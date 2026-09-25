import type { D1Migration } from "cloudflare:test";
import type { Env } from "../src/index";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
