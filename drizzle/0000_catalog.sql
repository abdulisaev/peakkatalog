CREATE TABLE stock (
  location TEXT PRIMARY KEY NOT NULL,
  updated INTEGER NOT NULL,
  rows TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  store TEXT NOT NULL,
  store_name TEXT NOT NULL,
  created TEXT NOT NULL,
  items TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done', 'rejected')),
  document TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  processed_by TEXT,
  processed_at TEXT
);
--> statement-breakpoint
CREATE INDEX orders_store_created ON orders (store, created DESC);
--> statement-breakpoint
CREATE INDEX orders_status_created ON orders (status, created DESC);
