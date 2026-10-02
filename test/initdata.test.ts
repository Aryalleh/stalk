import { describe, expect, it } from "vitest";
import { signInitData, verifyInitData } from "../lib/initdata";

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

  it("rejects another bot's signature, tampering and stale data", async () => {
    expect(await verifyInitData(await make(base, "999:other"), TOKEN, 86400, now)).toBeNull();
    const tampered = (await make(base)).replace("42", "43");
    expect(await verifyInitData(tampered, TOKEN, 86400, now)).toBeNull();
    expect(await verifyInitData(await make({ ...base, auth_date: String(now - 90000) }), TOKEN, 86400, now)).toBeNull();
    expect(await verifyInitData("user=x", TOKEN, 86400, now)).toBeNull();
  });
});
