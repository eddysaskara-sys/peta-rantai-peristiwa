-- Skema database D1 "peta-rantai-db" (sudah dibuat di akun Cloudflare).
CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, trigger TEXT, status TEXT NOT NULL DEFAULT 'berjalan', n_articles INTEGER DEFAULT 0, n_events INTEGER DEFAULT 0, n_links INTEGER DEFAULT 0, note TEXT);
CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, source TEXT, origin TEXT, published_at TEXT, fetched_at TEXT NOT NULL, run_id INTEGER, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, tanggal TEXT NOT NULL, judul TEXT NOT NULL, ringkasan TEXT, tingkat TEXT, sektor TEXT, indikator TEXT, dua_sisi TEXT, dampak TEXT, status TEXT NOT NULL DEFAULT 'aktif', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS event_articles (event_id INTEGER NOT NULL, article_id INTEGER NOT NULL, PRIMARY KEY (event_id, article_id));
CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY AUTOINCREMENT, dari_id INTEGER NOT NULL, ke_id INTEGER NOT NULL, jenis TEXT NOT NULL, alasan TEXT, keyakinan REAL, status TEXT NOT NULL DEFAULT 'usulan', dibuat_oleh TEXT NOT NULL DEFAULT 'ai', run_id INTEGER, created_at TEXT NOT NULL, decided_at TEXT, UNIQUE (dari_id, ke_id));
CREATE TABLE IF NOT EXISTS forecasts (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, teks TEXT NOT NULL, tanggal_cek TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'menunggu', catatan TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0);
-- Harga harian untuk prioritas sektor (BRIEF final). Hanya dipakai di belakang layar.
CREATE TABLE IF NOT EXISTS market_prices (kode TEXT NOT NULL, day TEXT NOT NULL, nilai REAL NOT NULL, sumber TEXT, fetched_at TEXT NOT NULL, PRIMARY KEY (kode, day));
CREATE INDEX IF NOT EXISTS idx_events_tanggal ON events(tanggal);
CREATE INDEX IF NOT EXISTS idx_links_status ON links(status);
CREATE INDEX IF NOT EXISTS idx_articles_run ON articles(run_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
