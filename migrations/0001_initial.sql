CREATE TABLE messages (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sbm_*'),
  value TEXT NOT NULL DEFAULT '',
  symbol_count INTEGER NOT NULL DEFAULT 0 CHECK (symbol_count BETWEEN 0 AND 128),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (symbol_count = length(value)),
  CHECK (completed_at IS NULL OR symbol_count <= 128)
);

CREATE TABLE author_chains (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sba_*'),
  created_at TEXT NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sbt_*'),
  created_at TEXT NOT NULL
);

CREATE TABLE capabilities (
  id TEXT PRIMARY KEY CHECK (id GLOB 'sbc_*'),
  message_id TEXT REFERENCES messages(id),
  author_chain_id TEXT REFERENCES author_chains(id),
  predecessor_capability_id TEXT REFERENCES capabilities(id),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expected_operation TEXT NOT NULL CHECK (expected_operation IN ('choose','read','continue','return')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  consumed_at TEXT,
  consumption_id TEXT UNIQUE,
  CHECK ((expected_operation = 'return' AND message_id IS NULL AND author_chain_id IS NOT NULL AND expires_at IS NULL)
      OR (expected_operation != 'return' AND message_id IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK ((consumed_at IS NULL AND consumption_id IS NULL) OR (consumed_at IS NOT NULL AND consumption_id IS NOT NULL))
);

CREATE TABLE author_members (
  author_chain_id TEXT NOT NULL REFERENCES author_chains(id),
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
  author_index INTEGER NOT NULL CHECK (author_index >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (author_chain_id, author_index)
);

CREATE TABLE thread_members (
  thread_id TEXT NOT NULL REFERENCES threads(id),
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
  thread_index INTEGER NOT NULL CHECK (thread_index >= 1),
  parent_message_id TEXT REFERENCES messages(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, thread_index),
  FOREIGN KEY (thread_id, parent_message_id) REFERENCES thread_members(thread_id, message_id),
  CHECK ((thread_index = 1 AND parent_message_id IS NULL) OR (thread_index > 1 AND parent_message_id IS NOT NULL))
);

CREATE UNIQUE INDEX thread_member_pair ON thread_members(thread_id, message_id);

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
  UNIQUE (message_id, transition_index)
);

CREATE TRIGGER messages_completed_immutable
BEFORE UPDATE ON messages WHEN OLD.completed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'completed messages are immutable'); END;

CREATE TRIGGER thread_parent_same_thread_insert
BEFORE INSERT ON thread_members WHEN NEW.parent_message_id IS NOT NULL
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM thread_members p WHERE p.thread_id = NEW.thread_id AND p.message_id = NEW.parent_message_id
  ) THEN RAISE(ABORT, 'parent must belong to thread') END);
END;
