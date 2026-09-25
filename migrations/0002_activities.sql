-- Rows predating this migration are deliberately left with a NULL activity_id:
-- their diagnostic events cannot truthfully establish continuous activity.
CREATE TABLE activities (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sbv_*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE capabilities ADD COLUMN activity_id TEXT REFERENCES activities(id);
ALTER TABLE capabilities ADD COLUMN target_kind TEXT;
ALTER TABLE capabilities ADD COLUMN target_id TEXT;

-- Remove the dependent table before rebuilding capabilities. The temporary
-- copy deliberately has no foreign keys, while the final table restores them.
CREATE TABLE events_legacy AS SELECT * FROM events;
DROP TABLE events;

-- SQLite cannot relax the original NOT NULL token_hash in place. A consumed
-- capability is a non-secret tombstone; only live recognition hashes remain.
CREATE TABLE capabilities_next (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sbc_*'),
  message_id TEXT REFERENCES messages(id),
  author_chain_id TEXT REFERENCES author_chains(id),
  predecessor_capability_id TEXT REFERENCES capabilities_next(id),
  token_hash TEXT UNIQUE CHECK (token_hash IS NULL OR length(token_hash) = 64),
  expected_operation TEXT NOT NULL CHECK (expected_operation IN ('choose','read','continue','return','navigate')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  consumed_at TEXT,
  consumption_id TEXT UNIQUE,
  activity_id TEXT REFERENCES activities(id),
  target_kind TEXT,
  target_id TEXT,
  CHECK ((expected_operation = 'return' AND message_id IS NULL AND author_chain_id IS NOT NULL AND expires_at IS NULL)
      OR (expected_operation = 'navigate' AND message_id IS NULL AND expires_at IS NOT NULL)
      OR (expected_operation NOT IN ('return','navigate') AND message_id IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK ((consumed_at IS NULL AND consumption_id IS NULL) OR (consumed_at IS NOT NULL AND consumption_id IS NOT NULL))
);
INSERT INTO capabilities_next SELECT id,message_id,author_chain_id,predecessor_capability_id,token_hash,expected_operation,created_at,expires_at,revoked_at,consumed_at,consumption_id,activity_id,target_kind,target_id FROM capabilities;
DROP TABLE capabilities;
ALTER TABLE capabilities_next RENAME TO capabilities;

CREATE UNIQUE INDEX capabilities_live_token_hash ON capabilities(token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE events (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sbe_*'),
  message_id TEXT REFERENCES messages(id),
  author_chain_id TEXT REFERENCES author_chains(id),
  capability_id TEXT REFERENCES capabilities(id),
  operation TEXT NOT NULL,
  choice TEXT,
  outcome TEXT NOT NULL,
  symbol_count INTEGER CHECK (symbol_count BETWEEN 0 AND 128),
  transition_index INTEGER NOT NULL CHECK (transition_index >= 0),
  created_at TEXT NOT NULL,
  activity_id TEXT REFERENCES activities(id),
  target_kind TEXT,
  target_id TEXT,
  UNIQUE (message_id, transition_index)
);
INSERT INTO events(id,message_id,author_chain_id,capability_id,operation,choice,outcome,symbol_count,transition_index,created_at)
SELECT id,message_id,author_chain_id,capability_id,operation,choice,outcome,symbol_count,transition_index,created_at FROM events_legacy;
DROP TABLE events_legacy;
-- transition_index, rather than wall-clock time, is the canonical activity
-- order. NULL legacy activity IDs remain outside this new invariant.
CREATE UNIQUE INDEX events_activity_order ON events(activity_id, transition_index)
WHERE activity_id IS NOT NULL;
