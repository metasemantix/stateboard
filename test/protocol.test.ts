import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { hashCapability } from "../src/index";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const origin = "https://stateboard.test";
const get = (path: string | URL) => SELF.fetch(new URL(path, origin), { redirect: "manual" });
const location = (r: Response) => new URL(r.headers.get("location")!, origin);
const scalar = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<Record<string,number>>())!;
const count = async (table: string) => (await scalar(`SELECT count(*) n FROM ${table}`)).n;
const capRow = async (raw: string) => env.DB.prepare("SELECT * FROM capabilities WHERE token_hash=?").bind(await hashCapability(raw)).first<Record<string,unknown>>();

async function start() {
  const stable = await get("/keyboard/enter");
  const created = await get(location(stable));
  return { stable, created, view: location(created), cap: location(created).searchParams.get("cap")! };
}
async function choose(raw: string, choice: string) {
  const res = await get(`/keyboard/choose?cap=${encodeURIComponent(raw)}&choice=${encodeURIComponent(choice)}`);
  return { res, view: location(res), cap: location(res).searchParams.get("cap")! };
}
async function finish(value = "a") {
  let s = await start(), raw = s.cap;
  for (const character of value) raw = (await choose(raw, character === " " ? "space" : character)).cap;
  const done = await choose(raw, "done");
  const readCap = done.cap;
  const readRow = await capRow(readCap);
  const read = await get(`/keyboard/read?cap=${encodeURIComponent(readCap)}&id=${readRow!.message_id}`);
  return { message: readRow!.message_id as string, readCap, continueCap: location(read).searchParams.get("cap")!, read };
}
async function preserve(value = "a") {
  const f = await finish(value);
  const result = await get(`/keyboard/preserve?cap=${encodeURIComponent(f.continueCap)}`);
  return { ...f, result, returnCap: location(result).searchParams.get("cap")! };
}

describe("fresh entrances and keyboard composition", () => {
  it("redirects stable new entrances uniquely and mints no state before fresh", async () => {
    const before = [await count("messages"), await count("capabilities")];
    const [a,b] = await Promise.all([get("/keyboard/enter"),get("/keyboard/enter")]);
    expect([a.status,b.status]).toEqual([303,303]);
    expect(a.headers.get("location")).not.toBe(b.headers.get("location"));
    expect([await count("messages"),await count("capabilities")]).toEqual(before);
    expect(location(a).searchParams.get("fresh")).toMatch(/^sbf_/);
  });

  it("fresh start creates one empty unaffiliated message and one root capability", async () => {
    const before = [await count("messages"),await count("capabilities")];
    const s = await start();
    expect(s.created.status).toBe(303);
    expect([await count("messages"),await count("capabilities")]).toEqual([before[0]+1,before[1]+1]);
    const c = await capRow(s.cap); expect(c).toMatchObject({ expected_operation:"choose", predecessor_capability_id:null });
    expect(await env.DB.prepare("SELECT value,symbol_count,completed_at FROM messages WHERE id=?").bind(c!.message_id).first()).toEqual({value:"",symbol_count:0,completed_at:null});
    expect((await scalar("SELECT count(*) n FROM author_members WHERE message_id=?",c!.message_id)).n).toBe(0);
    expect((await scalar("SELECT count(*) n FROM thread_members WHERE message_id=?",c!.message_id)).n).toBe(0);
  });

  it("has a refresh-safe deterministic 28-link native keyboard sharing one capability", async () => {
    const s=await start(), before=[await count("messages"),await count("capabilities"),await count("events")];
    const first=await get(s.view), second=await get(s.view), html=await first.text();
    expect(second.status).toBe(200); expect(await second.text()).toBe(html);
    expect([await count("messages"),await count("capabilities"),await count("events")]).toEqual(before);
    const links=[...html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)];
    expect(links.map(x=>x[2])).toEqual([..."abcdefghijklmnopqrstuvwxyz","space","done"]);
    expect(new Set(links.map(x=>new URL(x[1]).searchParams.get("cap")))).toEqual(new Set([s.cap]));
    expect(links.every(x=>x[1].startsWith(origin))).toBe(true);
    expect(html).not.toMatch(/<(form|button|script)\b/i);
  });

  it("appends exactly once, retains partial state, and rejects sibling replay", async () => {
    const s=await start(), initial=await capRow(s.cap), before=await count("capabilities");
    const a=await choose(s.cap,"a"); expect(a.res.status).toBe(303);
    expect(await env.DB.prepare("SELECT value,symbol_count FROM messages WHERE id=?").bind(initial!.message_id).first()).toEqual({value:"a",symbol_count:1});
    expect(await count("capabilities")).toBe(before+1);
    expect((await get(`/keyboard/choose?cap=${s.cap}&choice=b`)).status).toBe(404);
    expect(await count("capabilities")).toBe(before+1);
  });

  it("accepts only the exposed alphabet without mutation or special events", async () => {
    for (const invalid of ["A","1",".","/","?","dash","", "é"]) {
      const s=await start(), c=await capRow(s.cap), events=await count("events"), caps=await count("capabilities");
      expect((await get(`/keyboard/choose?cap=${encodeURIComponent(s.cap)}&choice=${encodeURIComponent(invalid)}`)).status).toBe(404);
      expect(await env.DB.prepare("SELECT value,symbol_count FROM messages WHERE id=?").bind(c!.message_id).first()).toEqual({value:"",symbol_count:0});
      expect(await count("capabilities")).toBe(caps); expect(await count("events")).toBe(events);
    }
  });

  it("keeps done usable at the 128-symbol boundary", async () => {
    let {cap:raw}=await start();
    for(let i=0;i<128;i++) raw=(await choose(raw,"a")).cap;
    const current=await capRow(raw), capCount=await count("capabilities");
    expect((await get(`/keyboard/choose?cap=${raw}&choice=space`)).status).toBe(404);
    expect((await capRow(raw))!.consumed_at).toBeNull(); expect(await count("capabilities")).toBe(capCount);
    const done=await choose(raw,"done"); expect(done.res.status).toBe(303);
    expect(await env.DB.prepare("SELECT symbol_count,completed_at FROM messages WHERE id=?").bind(current!.message_id).first()).toMatchObject({symbol_count:128});
  });

  it("completes, verifies read binding, and renders exactly two continuation actions", async () => {
    const s=await start(), added=await choose(s.cap,"a"), done=await choose(added.cap,"done"), readCap=done.cap;
    const row=await capRow(readCap), before=await count("capabilities");
    expect(row).toMatchObject({expected_operation:"read"});
    expect((await get(`/keyboard/read?cap=${readCap}&id=sbm_wrong`)).status).toBe(404); expect(await count("capabilities")).toBe(before);
    const read=await get(`/keyboard/read?cap=${readCap}&id=${row!.message_id}`); expect(read.status).toBe(303);
    expect((await get(`/keyboard/read?cap=${readCap}&id=${row!.message_id}`)).status).toBe(404);
    const html=await (await get(location(read))).text();
    expect(html).toContain('<p id="value">a</p>'); expect((html.match(/<a /g)||[])).toHaveLength(2);
    expect(html).toContain("next message"); expect(html).toContain("preserve author continuity");
  });
});

describe("replies, threads, and public visibility", () => {
  it("stable anonymous reply is unique and state-free until fresh", async () => {
    const root=await finish("root"), before=[await count("messages"),await count("threads"),await count("capabilities")];
    const [a,b]=await Promise.all([get(`/keyboard/reply?to=${root.message}`),get(`/keyboard/reply?to=${root.message}`)]);
    expect(a.status).toBe(303); expect(a.headers.get("location")).not.toBe(b.headers.get("location"));
    expect([await count("messages"),await count("threads"),await count("capabilities")]).toEqual(before);
    const fresh=await get(location(a)); expect(fresh.status).toBe(303);
    const replyCap=location(fresh).searchParams.get("cap")!, reply=await capRow(replyCap);
    const member=await env.DB.prepare("SELECT thread_id,thread_index,parent_message_id FROM thread_members WHERE message_id=?").bind(reply!.message_id).first();
    expect(member).toMatchObject({thread_index:2,parent_message_id:root.message});
    expect((await scalar("SELECT count(*) n FROM author_members WHERE message_id=?",reply!.message_id)).n).toBe(0);
  });

  it("rejects unknown/incomplete targets and overlong fresh without state", async () => {
    const s=await start(), c=await capRow(s.cap), before=await count("messages");
    expect((await get(`/keyboard/reply?to=${c!.message_id}`)).status).toBe(404);
    expect((await get(`/keyboard/reply?to=sbm_unknown`)).status).toBe(404);
    expect((await get(`/keyboard/enter?fresh=${"x".repeat(129)}`)).status).toBe(404);
    expect(await count("messages")).toBe(before);
  });

  it("concurrent first and subsequent replies have one thread and unique stable indexes", async () => {
    const root=await finish("threadroot");
    const entrances=await Promise.all(Array.from({length:6},()=>get(`/keyboard/reply?to=${root.message}`)));
    const made=await Promise.all(entrances.map(r=>get(location(r))));
    expect(made.every(r=>r.status===303)).toBe(true);
    const membership=await env.DB.prepare("SELECT thread_id,thread_index FROM thread_members WHERE thread_id=(SELECT thread_id FROM thread_members WHERE message_id=?) ORDER BY thread_index").bind(root.message).all<{thread_id:string,thread_index:number}>();
    expect(new Set(membership.results.map(x=>x.thread_id)).size).toBe(1);
    expect(membership.results.map(x=>x.thread_index)).toEqual([1,2,3,4,5,6,7]);
    const next=await Promise.all(Array.from({length:4},()=>get(`/keyboard/reply?to=${root.message}`)));
    const appended=await Promise.all(next.map(r=>get(location(r)))); expect(appended.every(r=>r.status===303)).toBe(true);
    const indexes=(await env.DB.prepare("SELECT thread_index FROM thread_members WHERE thread_id=? ORDER BY thread_index").bind(membership.results[0].thread_id).all<{thread_index:number}>()).results.map(x=>x.thread_index);
    expect(indexes).toEqual([1,2,3,4,5,6,7,8,9,10,11]);
  });

  it("hides incomplete author/thread members and escapes inert completed content", async () => {
    const root=await finish("visible"), entrance=await get(`/keyboard/reply?to=${root.message}`), made=await get(location(entrance)), reply=await capRow(location(made).searchParams.get("cap")!);
    const tm=await env.DB.prepare("SELECT thread_id FROM thread_members WHERE message_id=?").bind(reply!.message_id).first<{thread_id:string}>();
    expect(await (await get(`/thread?id=${tm!.thread_id}`)).text()).not.toContain(reply!.message_id as string);
    const id="sbm_escapedfixture", stamp=new Date().toISOString();
    await env.DB.prepare("INSERT INTO messages VALUES(?,?,?, ?,?)").bind(id,"<b>https example</b>",20,stamp,stamp).run();
    const html=await (await get(`/message?id=${id}`)).text(); expect(html).toContain("&lt;b&gt;https example&lt;/b&gt;"); expect(html).not.toContain("<b>"); expect(html).not.toMatch(/href="https example/);
  });
});

describe("author continuation and return", () => {
  it("immediate continuation creates ordered continuity, hides its partial member, and cannot fork", async () => {
    const f=await finish("first"), before=[await count("author_chains"),await count("messages")];
    const a=await get(`/keyboard/continue?cap=${f.continueCap}`), b=await get(`/keyboard/preserve?cap=${f.continueCap}`);
    expect([a.status,b.status]).toEqual([303,404]);
    expect(await count("author_chains")).toBe(before[0]+1); expect(await count("messages")).toBe(before[1]+1);
    const members=await env.DB.prepare("SELECT message_id,author_index FROM author_members WHERE author_chain_id=(SELECT author_chain_id FROM author_members WHERE message_id=?) ORDER BY author_index").bind(f.message).all();
    expect(members.results).toHaveLength(2);
    expect(members.results[0]).toMatchObject({message_id:f.message,author_index:1});
    const author=(await env.DB.prepare("SELECT author_chain_id FROM author_members WHERE message_id=?").bind(f.message).first<{author_chain_id:string}>())!;
    const html=await (await get(`/author?id=${author.author_chain_id}`)).text(); expect(html).toContain(f.message); expect(html).not.toContain((members.results[1] as {message_id:string}).message_id);
  });

  it("concurrent continuation siblings leave no losing-request artifacts", async () => {
    const f=await finish("atomic"), before={chains:await count("author_chains"),messages:await count("messages"),events:await count("events")};
    const results=await Promise.all([get(`/keyboard/continue?cap=${f.continueCap}`),get(`/keyboard/preserve?cap=${f.continueCap}`)]);
    expect(results.map(x=>x.status).sort()).toEqual([303,404]);
    expect(await count("author_chains")).toBe(before.chains+1);
    expect(await count("messages")).toBe(before.messages+(results[0].status===303?1:0));
    expect((await scalar("SELECT count(*) n FROM capabilities WHERE predecessor_capability_id=(SELECT id FROM capabilities WHERE token_hash=?)",await hashCapability(f.continueCap))).n).toBe(1);
    expect(await count("events")).toBe(before.events+1);
    expect((await scalar("SELECT count(*) n FROM author_chains a WHERE NOT EXISTS(SELECT 1 FROM author_members m WHERE m.author_chain_id=a.id)")).n).toBe(0);
  });

  it("preserves a durable hash-only return capability and browsing is non-consuming", async () => {
    const p=await preserve("keeper"), row=await capRow(p.returnCap); expect(p.result.status).toBe(303);
    expect(row).toMatchObject({expected_operation:"return",message_id:null,expires_at:null,consumed_at:null});
    const replyEntrance=await get(`/keyboard/reply?to=${p.message}`); await get(location(replyEntrance));
    const thread=(await env.DB.prepare("SELECT thread_id FROM thread_members WHERE message_id=?").bind(p.message).first<{thread_id:string}>())!;
    const before=[await count("messages"),await count("author_members")];
    for(const path of [location(p.result),`/return/messages?cap=${p.returnCap}`,`/return/message?cap=${p.returnCap}&id=${p.message}`,`/return/thread?cap=${p.returnCap}&id=${thread.thread_id}`,`/return/author?cap=${p.returnCap}&id=${row!.author_chain_id}`]) {
      const res=await get(path); expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("no-store");
      const html=await res.text(); expect(html).toContain(p.returnCap);
      for(const match of html.matchAll(/href="([^"]+)"/g)) if(new URL(match[1]).pathname.startsWith("/return")) expect(new URL(match[1]).searchParams.get("cap")).toBe(p.returnCap);
    }
    expect([await count("messages"),await count("author_members")]).toEqual(before); expect((await capRow(p.returnCap))!.consumed_at).toBeNull();
  });

  it("return-new uses a state-free fresh hop then consumes once", async () => {
    const p=await preserve("newauthor"), row=await capRow(p.returnCap), before=[await count("messages"),await count("author_members")];
    const stable=await get(`/return/new?cap=${p.returnCap}`); expect(stable.status).toBe(303); expect([await count("messages"),await count("author_members")]).toEqual(before);
    const made=await get(location(stable)); expect(made.status).toBe(303); expect([await count("messages"),await count("author_members")]).toEqual([before[0]+1,before[1]+1]);
    expect((await capRow(p.returnCap))!.consumed_at).not.toBeNull();
    const successor=await capRow(location(made).searchParams.get("cap")!); expect(successor).toMatchObject({author_chain_id:row!.author_chain_id,predecessor_capability_id:row!.id});
    expect((await get(location(stable))).status).toBe(404);
  });

  it("return-reply atomically adds independent author and thread memberships", async () => {
    const target=await finish("target"), p=await preserve("returner"), returnRow=await capRow(p.returnCap);
    const before=[await count("messages"),await count("thread_members")];
    const stable=await get(`/return/reply?cap=${p.returnCap}&to=${target.message}`); expect(stable.status).toBe(303); expect([await count("messages"),await count("thread_members")]).toEqual(before);
    const made=await get(location(stable)); expect(made.status).toBe(303);
    const successor=await capRow(location(made).searchParams.get("cap")!), mid=successor!.message_id;
    expect(await env.DB.prepare("SELECT author_chain_id FROM author_members WHERE message_id=?").bind(mid).first()).toEqual({author_chain_id:returnRow!.author_chain_id});
    expect(await env.DB.prepare("SELECT parent_message_id,thread_index FROM thread_members WHERE message_id=?").bind(mid).first()).toMatchObject({parent_message_id:target.message,thread_index:2});
  });

  it("returning-author replies join an existing thread without inheriting the target author", async () => {
    const target=await finish("existing thread"), anonEntrance=await get(`/keyboard/reply?to=${target.message}`), anonMade=await get(location(anonEntrance));
    const anonymous=await capRow(location(anonMade).searchParams.get("cap")!), originalThread=(await env.DB.prepare("SELECT thread_id FROM thread_members WHERE message_id=?").bind(target.message).first<{thread_id:string}>())!;
    expect((await scalar("SELECT count(*) n FROM author_members WHERE message_id=?",anonymous!.message_id)).n).toBe(0);
    const p=await preserve("thread author"), stable=await get(`/return/reply?cap=${p.returnCap}&to=${target.message}`), made=await get(location(stable)), successor=await capRow(location(made).searchParams.get("cap")!);
    expect(await env.DB.prepare("SELECT thread_id,parent_message_id FROM thread_members WHERE message_id=?").bind(successor!.message_id).first()).toEqual({thread_id:originalThread.thread_id,parent_message_id:target.message});
    expect((await scalar("SELECT count(*) n FROM author_members WHERE message_id=?",successor!.message_id)).n).toBe(1);
  });

  it("racing sibling return actions create exactly one complete transition", async () => {
    const target=await finish("race target"), p=await preserve("racer"), before={m:await count("messages"),a:await count("author_members"),t:await count("thread_members")};
    const n=await get(`/return/new?cap=${p.returnCap}`), r=await get(`/return/reply?cap=${p.returnCap}&to=${target.message}`);
    const results=await Promise.all([get(location(n)),get(location(r))]); expect(results.map(x=>x.status).sort()).toEqual([303,404]);
    expect(await count("messages")).toBe(before.m+1); expect(await count("author_members")).toBe(before.a+1);
    expect(await count("thread_members")).toBe(before.t+(results[1].status===303?2:0));
    expect((await scalar("SELECT count(*) n FROM capabilities WHERE predecessor_capability_id=(SELECT id FROM capabilities WHERE token_hash=?)",await hashCapability(p.returnCap))).n).toBe(1);
  });
});

describe("capability rejection, telemetry, discovery, and schema", () => {
  it("rejects malformed, expired, revoked, replayed, wrong-operation and wrong-message without successors", async () => {
    expect((await get("/keyboard/view?cap=bad")).status).toBe(404);
    for(const column of ["expires_at","revoked_at"] as const){const s=await start(), row=await capRow(s.cap); await env.DB.prepare(`UPDATE capabilities SET ${column}=? WHERE id=?`).bind(new Date(Date.now()-1000).toISOString(),row!.id).run(); const before=await count("capabilities"); expect((await get(`/keyboard/choose?cap=${s.cap}&choice=a`)).status).toBe(404); expect(await count("capabilities")).toBe(before);}
    const f=await finish("reject"); expect((await get(`/keyboard/choose?cap=${f.continueCap}&choice=a`)).status).toBe(404);
    expect((await get(`/keyboard/read?cap=${f.continueCap}&id=${f.message}`)).status).toBe(404);
  });

  it("records reconstructable accepted choices without message snapshots", async () => {
    const f=await finish("ab c");
    const events=await env.DB.prepare("SELECT operation,choice,outcome,symbol_count,capability_id,transition_index FROM events WHERE message_id=? ORDER BY transition_index").bind(f.message).all<Record<string,unknown>>();
    const composition=events.results.filter(x=>x.operation==="choose"||x.operation==="complete");
    expect(composition.map(x=>x.choice)).toEqual(["a","b","space","c","done"]);
    expect(composition.map(x=>x.symbol_count)).toEqual([1,2,3,4,4]);
    expect(composition.every(x=>x.outcome==="success"&&x.capability_id)).toBe(true);
    expect(events.results.map(x=>x.transition_index)).toEqual(events.results.map((_,i)=>i));
    expect(Object.keys(composition[0])).not.toContain("value");
  });

  it("keeps raw capabilities and return/fresh links out of persistence and discovery", async () => {
    const p=await preserve("secret"), dump=JSON.stringify((await env.DB.prepare("SELECT * FROM capabilities").all()).results); expect(dump).not.toContain("sbk_"); expect(dump).not.toContain(p.returnCap);
    for(const path of ["/","/llms.txt","/robots.txt","/sitemap.xml"]){const text=await (await get(path)).text();expect(text).not.toMatch(/cap=|fresh=|sbk_|\/return\?/);}
    const robots=await (await get("/robots.txt")).text(); for(const path of ["/keyboard/view","/keyboard/choose","/keyboard/read","/keyboard/continue","/keyboard/preserve","/keyboard/reply","/return"]) expect(robots).toContain(`Disallow: ${path}`);
  });

  it("enforces core migration invariants and has clean foreign keys", async () => {
    const stamp=new Date().toISOString(), id="sbm_schemafixture";
    await expect(env.DB.prepare("INSERT INTO messages VALUES(?,'',129,NULL,?)").bind(id,stamp).run()).rejects.toThrow();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO messages VALUES('sbm_schema_root','',0,NULL,?)").bind(stamp),
      env.DB.prepare("INSERT INTO messages VALUES('sbm_schema_child','',0,NULL,?)").bind(stamp),
      env.DB.prepare("INSERT INTO threads VALUES('sbt_schema_one',?)").bind(stamp),
      env.DB.prepare("INSERT INTO threads VALUES('sbt_schema_two',?)").bind(stamp),
      env.DB.prepare("INSERT INTO thread_members VALUES('sbt_schema_one','sbm_schema_root',1,NULL,?)").bind(stamp),
    ]);
    await expect(env.DB.prepare("INSERT INTO thread_members VALUES('sbt_schema_two','sbm_schema_child',2,'sbm_schema_root',?)").bind(stamp).run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO thread_members VALUES('sbt_schema_one','sbm_schema_root',2,'sbm_schema_root',?)").bind(stamp).run()).rejects.toThrow();
    await env.DB.batch([env.DB.prepare("INSERT INTO author_chains VALUES('sba_schema_one',?)").bind(stamp),env.DB.prepare("INSERT INTO author_chains VALUES('sba_schema_two',?)").bind(stamp),env.DB.prepare("INSERT INTO author_members VALUES('sba_schema_one','sbm_schema_child',1,?)").bind(stamp)]);
    await expect(env.DB.prepare("INSERT INTO author_members VALUES('sba_schema_two','sbm_schema_child',1,?)").bind(stamp).run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO author_members VALUES('sba_schema_one','sbm_missing',2,?)").bind(stamp).run()).rejects.toThrow();
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    const tables=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{name:string}>()).results.map(x=>x.name);
    expect(tables).toEqual(expect.arrayContaining(["messages","capabilities","author_chains","author_members","threads","thread_members","events"]));
    expect(tables).not.toEqual(expect.arrayContaining(["notifications","inbox"]));
    const eventColumns=(await env.DB.prepare("PRAGMA table_info(events)").all<{name:string}>()).results.map(x=>x.name);
    expect(eventColumns).toContain("transition_index"); expect(eventColumns).not.toContain("value");
  });
});
