-- Migrasi 27 Okt 2026 (fitur percobaan Pandangan Video, branch fitur/pandangan-video).
-- TIDAK WAJIB dijalankan manual: src/video.js membuat tabel ini sendiri saat fitur pertama kali dipakai.
-- Semua perubahan bersifat menambah; tabel lama tidak disentuh.
-- videos: video dari channel YouTube pantauan. status: baru | selesai | tidak_relevan | dilewati | gagal.
-- video_klaim: pandangan yang diringkas Gemini. jenis: dukung | bantah | perkiraan | kaitan_baru | pandangan.
--   link_id = kaitan yang didukung/dibantah; event_id = peristiwa dasar; forecast_id = perkiraan yang dicatat pemilik.
-- video_state: catatan kecil (waktu cek feed, channel ID hasil pencarian, jumlah ringkasan per hari).
CREATE TABLE IF NOT EXISTS videos (video_id TEXT PRIMARY KEY, channel_id TEXT, channel_nama TEXT, judul TEXT NOT NULL, url TEXT NOT NULL, terbit TEXT, deskripsi TEXT, status TEXT NOT NULL DEFAULT 'baru', alasan TEXT, ringkasan TEXT, model TEXT, token INTEGER, percobaan INTEGER NOT NULL DEFAULT 0, coba_lagi TEXT, diminta TEXT, diproses_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS video_klaim (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, jenis TEXT NOT NULL, teks TEXT NOT NULL, detik INTEGER, link_id INTEGER, event_id INTEGER, dari_id INTEGER, ke_id INTEGER, hari INTEGER, forecast_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS video_state (kunci TEXT PRIMARY KEY, nilai TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status, terbit);
CREATE INDEX IF NOT EXISTS idx_video_klaim_video ON video_klaim(video_id);
CREATE INDEX IF NOT EXISTS idx_video_klaim_link ON video_klaim(link_id);
CREATE INDEX IF NOT EXISTS idx_video_klaim_fc ON video_klaim(forecast_id);

-- Bila fitur ini dibatalkan, data video bisa dihapus dengan (jalankan hanya bila yakin):
--   DROP TABLE IF EXISTS video_klaim; DROP TABLE IF EXISTS videos; DROP TABLE IF EXISTS video_state;
-- Perkiraan yang sudah dicatat dari video tetap ada di tabel forecasts (asal = 'video').
