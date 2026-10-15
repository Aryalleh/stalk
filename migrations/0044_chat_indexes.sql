-- Every bot message looks its chat up (the account behind it, the CRM's Telegram / Bale id).
CREATE INDEX users_bale_chat ON users(bale_chat_id);
CREATE INDEX users_telegram_chat ON users(telegram_chat_id);
