import { describe, expect, it } from "vitest";
import { checkInitData, signInitData, verifyInitData } from "../lib/initdata";

const TOKEN = "123456:TEST-token";
const now = 1_800_000_000;

async function make(fields: Record<string, string>, token = TOKEN) {
  const hash = await signInitData(fields, token);
  return new URLSearchParams({ ...fields, hash }).toString();
}

describe("mini app initData", () => {
  const base = { auth_date: String(now - 60), query_id: "AAH", user: JSON.stringify({ id: 42, first_name: "سارا" }) };

  it("accepts data signed with the bot token", async () => {
    const data = await verifyInitData(await make({ ...base, start_param: "p_7" }), TOKEN, 86400, now);
    expect(data?.user.id).toBe(42);
    expect(data?.startParam).toBe("p_7");
  });

  it("accepts Telegram's newer data with a signature field (covered by the hash) and Bale-style data without it", async () => {
    const withSig = { ...base, signature: "abcDEF_123-x" };
    const telegram = new URLSearchParams({ ...withSig, hash: await signInitData(withSig, TOKEN) }).toString();
    expect((await verifyInitData(telegram, TOKEN, 86400, now))?.user.id).toBe(42);
    const older = new URLSearchParams({ ...withSig, hash: await signInitData(withSig, TOKEN, true) }).toString();
    expect((await verifyInitData(older, TOKEN, 86400, now))?.user.id).toBe(42);
  });

  it("says why data was refused", async () => {
    expect((await checkInitData("", TOKEN, 86400, now)).problem).toBe("empty");
    expect((await checkInitData(await make(base), "", 86400, now)).problem).toBe("no_token");
    expect((await checkInitData(await make(base, "999:other"), TOKEN, 86400, now)).problem).toBe("bad_hash");
    expect((await checkInitData(await make({ ...base, auth_date: String(now - 90000) }), TOKEN, 86400, now)).problem).toBe("expired");
  });

  it("rejects another bot's signature, tampering and stale data", async () => {
    expect(await verifyInitData(await make(base, "999:other"), TOKEN, 86400, now)).toBeNull();
    const tampered = (await make(base)).replace("42", "43");
    expect(await verifyInitData(tampered, TOKEN, 86400, now)).toBeNull();
    expect(await verifyInitData(await make({ ...base, auth_date: String(now - 90000) }), TOKEN, 86400, now)).toBeNull();
    expect(await verifyInitData("user=x", TOKEN, 86400, now)).toBeNull();
  });
});
