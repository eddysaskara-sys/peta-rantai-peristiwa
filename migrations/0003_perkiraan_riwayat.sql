-- Migrasi 23 Okt 2026 (masukan pengguna): pengecekan perkiraan semi-otomatis, contoh perkiraan
-- dari isi riwayat, dan indeks pendukung. Semua perubahan bersifat menambah.
-- asal: 'manual' (dicatat pemilik) atau 'riwayat' (contoh otomatis dari isi riwayat).
-- saran_*: saran AI (terjadi/tidak/belum/gagal) beserta alasan, keyakinan, dan bukti (JSON).
-- cek_diminta: waktu pemilik meminta saran AI (antrean). diputuskan_*: keputusan akhir pemilik.
ALTER TABLE forecasts ADD COLUMN asal TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE forecasts ADD COLUMN saran_status TEXT;
ALTER TABLE forecasts ADD COLUMN saran_alasan TEXT;
ALTER TABLE forecasts ADD COLUMN saran_keyakinan REAL;
ALTER TABLE forecasts ADD COLUMN saran_bukti TEXT;
ALTER TABLE forecasts ADD COLUMN saran_at TEXT;
ALTER TABLE forecasts ADD COLUMN cek_diminta TEXT;
ALTER TABLE forecasts ADD COLUMN diputuskan_at TEXT;
ALTER TABLE forecasts ADD COLUMN diputuskan_dengan TEXT;
CREATE INDEX IF NOT EXISTS idx_forecasts_status ON forecasts(status, tanggal_cek);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_runs_trigger ON runs(trigger, status);
