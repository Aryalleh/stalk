// What happens when a DM arrives, and the automation rules a shop sets up in the panel.
import type { Shop } from "../db";
import { addIncoming, addOutgoing, conversationFor, createTask, customerForIg, logActivity, setStage, isStage, type Stage } from "./db";
import { fetchProfile, sendDm, type IgEvent } from "./instagram";

export interface Rule {
  id: number;
  kind: "welcome" | "keyword" | "offer_followup";
  keyword: string;
  reply: string;
  set_stage: string;
  tag_id: number | null;
  hours: number;
  active: number;
}

export const RULE_LABEL: Record<Rule["kind"], string> = {
  welcome: "خوش‌آمد به اولین پیام",
  keyword: "پاسخ به کلمه کلیدی",
  offer_followup: "پیگیری پیشنهاد بی‌جواب",
};

const activeRules = async (db: D1Database, shopId: number) =>
  (await db.prepare("SELECT * FROM automation_rules WHERE shop_id = ? AND active = 1 ORDER BY id").bind(shopId).all<Rule>()).results;

/** Keyword rules match case-insensitively anywhere in the message; several keywords can be separated by commas. */
export function matchesKeyword(rule: Pick<Rule, "keyword">, text: string) {
  const body = text.toLowerCase();
  return rule.keyword
    .split(/[,،]/)
    .map((k) => k.trim().toLowerCase())
    .some((k) => k && body.includes(k));
}

/** Send an automatic reply and record it in the conversation. */
async function autoReply(db: D1Database, shop: Shop, conversationId: number, igUserId: string, text: string) {
  try {
    const mid = await sendDm(shop.ig_access_token, shop.ig_account_id, igUserId, text);
    await addOutgoing(db, shop.id, conversationId, { body: text, sentBy: null, igId: mid });
  } catch (e) {
    await addOutgoing(db, shop.id, conversationId, { body: text, sentBy: null, status: "failed", error: String((e as Error).message).slice(0, 300) });
  }
}

/** One webhook event for a shop: file the message under its customer, then run the automation. */
export async function handleIgEvent(db: D1Database, shop: Shop, ev: IgEvent) {
  const { id: customerId, created } = await customerForIg(db, shop.id, ev.customerId);
  if (created) {
    const profile = await fetchProfile(shop.ig_access_token, ev.customerId);
    if (profile.username || profile.name) {
      await db.prepare("UPDATE customers SET username = ?, name = ? WHERE id = ?").bind(profile.username ?? "", profile.name ?? "", customerId).run();
    }
    await logActivity(db, shop.id, null, "create", "customer", customerId, "instagram");
  }
  const conv = await conversationFor(db, shop.id, customerId);
  if (ev.direction === "out") {
    // Sent by the shop from the Instagram app (or the echo of our own reply, ignored as a repeat).
    await addOutgoing(db, shop.id, conv.id, { body: ev.body, sentBy: null, igId: ev.mid, at: ev.at });
    return;
  }
  const messageId = await addIncoming(db, shop.id, conv.id, { igId: ev.mid, type: ev.type, body: ev.body, at: ev.at });
  if (!messageId || !shop.ig_access_token) return; // a repeat delivery, or no way to answer
  const rules = await activeRules(db, shop.id);
  if (created) {
    const welcome = rules.find((r) => r.kind === "welcome" && r.reply);
    if (welcome) await autoReply(db, shop, conv.id, ev.customerId, welcome.reply);
  }
  for (const r of rules.filter((r) => r.kind === "keyword" && r.keyword && matchesKeyword(r, ev.body))) {
    if (r.reply) await autoReply(db, shop, conv.id, ev.customerId, r.reply);
    if (r.set_stage && isStage(r.set_stage)) await onStageChange(db, shop.id, customerId, r.set_stage, null);
    if (r.tag_id) await db.prepare("INSERT OR IGNORE INTO customer_tags (customer_id, tag_id) VALUES (?, ?)").bind(customerId, r.tag_id).run();
  }
}

/** Change a stage and run what depends on it (an unanswered offer gets a follow-up task). */
export async function onStageChange(db: D1Database, shopId: number, customerId: number, stage: Stage, userId: number | null) {
  if (!(await setStage(db, shopId, customerId, stage, userId))) return;
  if (stage === "offer_sent") {
    const rule = (await activeRules(db, shopId)).find((r) => r.kind === "offer_followup");
    if (rule) {
      const due = new Date(Date.now() + Math.max(1, rule.hours) * 3600_000).toISOString();
      await createTask(db, shopId, { customerId, type: "follow_up", title: rule.reply || "پیگیری پیشنهاد ارسال‌شده", dueAt: due, createdBy: null });
    }
  }
}

/** The Instagram account id → shop (only approved shops with a connected account). */
export const shopForAccount = (db: D1Database, accountId: string) =>
  db.prepare("SELECT * FROM shops WHERE ig_account_id = ? AND ig_access_token <> '' LIMIT 1").bind(accountId).first<Shop>();

