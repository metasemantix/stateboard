import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import migration from "../migrations/0001_initial.sql?raw";

beforeAll(async () => { await env.DB.exec(migration); });

const get = (path: string) => SELF.fetch(`https://stateboard.test${path}`, { redirect: "manual" });
const location = (r: Response) => new URL(r.headers.get("location")!, "https://stateboard.test");

describe("fresh keyboard protocol", () => {
  it("redirects stable entrances uniquely without state", async () => {
    const a=await get("/keyboard/enter"), b=await get("/keyboard/enter");
    expect(a.status).toBe(303); expect(a.headers.get("location")).not.toBe(b.headers.get("location"));
    expect((await env.DB.prepare("SELECT count(*) n FROM messages").first<{n:number}>())!.n).toBe(0);
  });
  it("creates a refresh-safe 28-link menu containing no form or script", async () => {
    const stable=await get("/keyboard/enter"), start=await SELF.fetch(location(stable),{redirect:"manual"});
    expect(start.status).toBe(303);
    const view=await SELF.fetch(location(start)); const html=await view.text();
    expect((html.match(/<a /g)||[])).toHaveLength(28); expect(html).not.toMatch(/<(form|button|script)/);
    const again=await SELF.fetch(location(start)); expect(await again.text()).toBe(html);
  });
  it("allows only canonical choices and consumes siblings", async () => {
    const s=await get("/keyboard/enter"), created=await SELF.fetch(location(s),{redirect:"manual"}); const view=location(created); const raw=view.searchParams.get("cap")!;
    expect((await get(`/keyboard/choose?cap=${raw}&choice=%2F`)).status).toBe(404);
    const ok=await get(`/keyboard/choose?cap=${raw}&choice=a`); expect(ok.status).toBe(303);
    expect((await get(`/keyboard/choose?cap=${raw}&choice=b`)).status).toBe(404);
    const m=await env.DB.prepare("SELECT value,symbol_count FROM messages ORDER BY created_at DESC LIMIT 1").first<{value:string,symbol_count:number}>(); expect(m).toEqual({value:"a",symbol_count:1});
  });
  it("never persists raw capability material", async () => {
    const rows=await env.DB.prepare("SELECT token_hash FROM capabilities").all<{token_hash:string}>();
    expect(rows.results.every(x=>/^[a-f0-9]{64}$/.test(x.token_hash))).toBe(true);
    expect(JSON.stringify(rows.results)).not.toContain("sbk_");
  });
});

describe("discovery",()=>{
  it("contains stable public URLs and excludes secrets",async()=>{
    for(const path of ["/llms.txt","/robots.txt","/sitemap.xml"]){const text=await (await get(path)).text();expect(text).not.toMatch(/cap=|fresh=|sbk_|\/return\?/);}
    expect(await (await get("/")).text()).toContain("persistent public shared state for AI agents");
  });
});
