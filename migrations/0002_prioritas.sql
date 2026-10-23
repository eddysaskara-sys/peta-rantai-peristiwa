-- Migrasi 23 Okt 2026 (BRIEF final): prioritas tinjauan dan data harga pasar.
-- Sudah dijalankan di D1 produksi "peta-rantai-db". Semua perubahan bersifat menambah.
ALTER TABLE links ADD COLUMN decided_at TEXT;
CREATE TABLE IF NOT EXISTS market_prices (kode TEXT NOT NULL, day TEXT NOT NULL, nilai REAL NOT NULL, sumber TEXT, fetched_at TEXT NOT NULL, PRIMARY KEY (kode, day));
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
