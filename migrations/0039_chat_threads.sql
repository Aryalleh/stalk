-- CRM: what customers write to the Bale bot is kept with what was sent to them (a chat history).
ALTER TABLE crm_messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'out'; -- 'out' sent from the CRM, 'in' from the customer
-- Anonymous messages: the sender's own message id, so an answer lands as a reply to it in their chat.
ALTER TABLE anon_messages ADD COLUMN from_msg_id TEXT NOT NULL DEFAULT '';
