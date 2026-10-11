-- Product cards sent in a shop's chat (photo + caption): a reply to one sets that product's price.
CREATE TABLE chat_cards (
  channel TEXT NOT NULL,     -- instagram | bale | telegram
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel, chat_id, message_id)
);
CREATE INDEX chat_cards_at ON chat_cards(created_at);
