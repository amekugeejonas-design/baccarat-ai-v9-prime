-- Baccarat AI V9 - Schema initial
CREATE TABLE IF NOT EXISTS hands (
  msg_id INTEGER PRIMARY KEY,
  n INTEGER NOT NULL,
  p_score INTEGER NOT NULL,
  b_score INTEGER NOT NULL,
  p_cards TEXT NOT NULL,   -- ex: "4♣,K♠,7♣"
  b_cards TEXT NOT NULL,
  result TEXT NOT NULL,    -- P / B / T
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hands_n ON hands(n);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  for_msg_id INTEGER,          -- main visee (NULL tant qu'elle n'est pas arrivee)
  after_msg_id INTEGER NOT NULL, -- derniere main connue au moment de la prediction
  p_suit TEXT NOT NULL, p_conf REAL NOT NULL,
  b_suit TEXT NOT NULL, b_conf REAL NOT NULL,
  p_rattrapage INTEGER DEFAULT 0,
  b_rattrapage INTEGER DEFAULT 0,
  p_hit INTEGER,               -- NULL = en attente, 1/0 une fois resolue
  b_hit INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pred_after ON predictions(after_msg_id);
