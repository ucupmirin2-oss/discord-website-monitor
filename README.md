# 🌐 Discord Website Runtime / Uptime Monitor

Discord bot untuk memonitor **banyak website sekaligus**, berjalan penuh di **Vercel Serverless + Vercel Cron**, **tanpa database** dan **tanpa proses Node.js yang hidup 24/7**.

User cukup menjalankan `/monitor add` **sekali**. Bot membuat satu message embed "monitor board", lalu **message yang sama** diperbarui otomatis setiap **5 menit** oleh Vercel Cron.

---

## 📌 Analisis: Persistence Tanpa Database di Vercel

Ini bagian terpenting, dibaca dulu sebelum deploy.

### Masalah

Vercel Function bersifat **stateless & ephemeral**:

| Cara simpan | Bertahan antar invocation? | Keterangan |
|---|---|---|
| Variabel global / `Map` di memori | ❌ | Hilang saat function cold start, tiap region punya instance sendiri |
| `fs.writeFile` ke `/tmp` | ❌ | `/tmp` hanya milik satu instance dan dihapus sewaktu-waktu |
| Filesystem project | ❌ | Read-only saat runtime |
| Environment variable | ⚠️ Hanya baca | Persisten, tapi statis; tidak bisa diubah bot saat runtime |

Artinya: daftar website, channel ID, message ID, dan statistik uptime **tidak bisa** disimpan di memori atau file kalau ingin bertahan antar request.

### Solusi yang dipakai: **Discord sebagai penyimpanan (Discord-as-Storage)**

Satu-satunya tempat yang sudah persisten, gratis, dan pasti tersedia adalah **Discord itu sendiri**. Bot menulis state ke message yang dia buat:

1. `/monitor add` membuat satu **monitor board** = message embed, lalu **di-pin** di channel.
2. Seluruh state (`daftar URL`, `jumlah check`, `jumlah online`, `jumlah offline`, `status terakhir`, `HTTP code`, `response time`, `last checked`) di-`JSON.stringify` → **gzip** → **base64url**, lalu ditempel di `embed.author.url` message tersebut.
3. **Channel ID & Message ID tidak perlu disimpan** di mana pun: cron menemukannya kembali dengan membaca **pinned message** tiap channel dan mengenali message miliknya sendiri (author = bot + `author.url` berawalan penanda khusus).
4. Tiap cron run: baca state dari message → cek semua website → hitung statistik baru → **edit message yang sama** dengan state baru.

Jadi message Discord berperan sekaligus sebagai **UI** dan **database mini**.

### Keterbatasan (jujur, tidak disembunyikan)

| Keterbatasan | Dampak | Mitigasi di project ini |
|---|---|---|
| Ukuran state terbatas (URL embed ~2000 karakter) | Maks ± **15 website per channel** | `MAX_SITES` (default 15) + gzip agar hemat; buat board di channel lain untuk website tambahan |
| Kalau **user menghapus message board**, statistik ikut hilang | Riwayat uptime kembali 0 | Board otomatis di-pin; `/monitor add` akan membuat ulang board bila hilang; cron mencatat warning |
| Statistik = **jumlah check**, bukan durasi presisi | "Uptime 99.31%" artinya 99,31% dari total pengecekan, bukan detik | Ditampilkan apa adanya di embed (`Uptime`, `Downtime`, `Checks`) |
| Resolusi minimum 5 menit | Downtime < 5 menit bisa terlewat | Batas Vercel Cron (dan memang requirement) |
| Cron memindai pinned message tiap channel | Sedikit request ke Discord tiap 5 menit | Set `MONITOR_CHANNEL_IDS` agar hanya channel tertentu yang dipindai |
| Vercel Hobby plan | Cron di Hobby dieksekusi ± sekali per hari untuk sebagian jadwal | Gunakan plan Pro untuk `*/5 * * * *`, atau panggil `/api/cron` dari cron eksternal (lihat bawah) |
| Race condition | Kalau cron dan `/monitor add` jalan bersamaan, satu update bisa menimpa yang lain | Sangat jarang; state selalu dibaca ulang tepat sebelum ditulis |

**Kesimpulan:** persistence penuh ala database memang tidak mungkin di serverless murni, tetapi pendekatan Discord-as-Storage memenuhi semua tujuan (multi-website, satu message auto-update, statistik uptime kumulatif) **tanpa database, tanpa Redis, tanpa filesystem**.

---

## 📁 Struktur Project

```
discord-website-monitor/
│
├── api/
│   ├── cron.js               # Endpoint Vercel Cron (tiap 5 menit)
│   ├── interactions.js       # Endpoint HTTP Interactions Discord (slash command)
│   └── index.js              # Halaman status publik (tanpa secret)
│
├── src/
│   ├── config.js             # Baca & validasi environment variable
│   ├── discord.js            # Wrapper Discord REST API (cari board, kirim, edit, pin)
│   ├── monitor.js            # Logic pengecekan website (fetch + timeout + klasifikasi)
│   ├── state.js              # Encode/decode state ke message (persistence tanpa DB)
│   ├── embed.js              # Pembuatan Discord Embed
│   ├── commands/
│   │   └── monitor.js        # Schema + handler slash command /monitor
│   └── utils/
│       ├── format.js         # Format tanggal WIB, persen, response time
│       ├── url.js            # Validasi & normalisasi URL
│       └── verify.js         # Verifikasi signature Discord & CRON_SECRET
│
├── scripts/
│   ├── register-commands.js  # Register slash command
│   └── local-check.js        # Uji logic monitoring dari terminal
│
├── package.json
├── vercel.json
├── .env.example
├── .gitignore
└── README.md
```

---

## 🔑 Environment Variables

| Variable | Wajib | Fungsi |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Token bot. Dipakai memanggil Discord REST API (kirim/edit/pin message). **Jangan pernah di-hardcode.** |
| `DISCORD_CLIENT_ID` | ✅ | Application ID. Dipakai untuk register slash command & mengenali message milik bot sendiri. |
| `DISCORD_PUBLIC_KEY` | ✅ | Public key untuk verifikasi signature Ed25519 setiap HTTP Interaction. Tanpa ini Discord menolak endpoint. |
| `DISCORD_GUILD_ID` | ✅ | Server tempat command didaftarkan (instan) & channel-nya dipindai cron. Boleh multi-guild, dipisah koma. |
| `CRON_SECRET` | ✅ | Melindungi `/api/cron`. Vercel Cron otomatis mengirim `Authorization: Bearer <CRON_SECRET>`. |
| `MONITOR_CHANNEL_IDS` | ➖ | Batasi pemindaian cron ke channel tertentu (hemat rate limit). |
| `CHECK_TIMEOUT_MS` | ➖ | Timeout per website, default `10000` (10 detik). |
| `DISPLAY_TIMEZONE` | ➖ | Timezone tampilan, default `Asia/Jakarta` (WIB). |
| `MAX_SITES` | ➖ | Maksimum website per board, default `15`. |

Semua variable hanya dibaca di server. Tidak ada frontend yang menerima token/secret.

---

## 🚀 Panduan Lengkap

### 1. Membuat Discord Application
1. Buka <https://discord.com/developers/applications>.
2. Klik **New Application** → beri nama, misalnya `Website Monitor` → **Create**.

### 2. Membuat Discord Bot
1. Di sidebar aplikasi, buka tab **Bot**.
2. Klik **Add Bot** / **Reset Token** bila tombol Add Bot tidak muncul (aplikasi baru sudah punya bot).

### 3. Mendapatkan Bot Token
1. Tab **Bot** → **Reset Token** → **Copy**.
2. Tempel ke `DISCORD_TOKEN`. Token hanya tampil sekali; kalau hilang, reset lagi.

### 4. Mendapatkan Client ID & Public Key
1. Tab **General Information**.
2. **Application ID** → `DISCORD_CLIENT_ID`.
3. **Public Key** → `DISCORD_PUBLIC_KEY`.

### 5. Mendapatkan Guild ID
1. Discord → **User Settings → Advanced → Developer Mode: ON**.
2. Klik kanan nama server → **Copy Server ID** → `DISCORD_GUILD_ID`.

### 6. Mengundang Bot ke Server
Gunakan URL berikut (ganti `CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=76800&scope=bot%20applications.commands
```

Permission `76800` = View Channel + Send Messages + Manage Messages (untuk pin) + Embed Links + Read Message History.

### 7. Install Dependency

```bash
git clone <repo-anda> discord-website-monitor
cd discord-website-monitor
npm install
cp .env.example .env   # lalu isi nilainya
```

### 8. Menjalankan Project Secara Lokal

```bash
# uji logic monitoring saja (tanpa Discord)
node scripts/local-check.js https://example.com https://google.com

# jalankan serverless function lokal
npm i -g vercel
vercel dev
```

Discord perlu URL publik untuk interactions. Saat lokal, buka tunnel:

```bash
npx localtunnel --port 3000     # atau: ngrok http 3000
```

Lalu isi **Interactions Endpoint URL** dengan `https://<tunnel>/api/interactions`.

Uji cron secara manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
```

### 9. Register Slash Commands

```bash
npm run register           # ke guild (langsung aktif)
npm run register:global    # global (propagasi hingga ~1 jam)
npm run unregister         # hapus semua command guild
```

### 10. Membuat Project Vercel
1. Push project ke GitHub.
2. Buka <https://vercel.com/new> → **Import** repository tersebut.
3. Framework Preset: **Other**. Build command & output dikosongkan saja.
4. **Deploy**.

### 11. Memasukkan Environment Variables
**Vercel → Project → Settings → Environment Variables**, tambahkan untuk environment *Production* (dan *Preview* bila perlu):

```
DISCORD_TOKEN
DISCORD_CLIENT_ID
DISCORD_PUBLIC_KEY
DISCORD_GUILD_ID
CRON_SECRET
```

Buat `CRON_SECRET` acak:

```bash
openssl rand -hex 32
```

Setelah menambah/mengubah env var, lakukan **Redeploy**.

### 12. Deploy ke Vercel

```bash
vercel --prod
```

Atau cukup `git push` (auto deploy). Cek `https://<project>.vercel.app/api` untuk memastikan hidup.

Terakhir, set **Interactions Endpoint URL** di Developer Portal:

```
https://<project>.vercel.app/api/interactions
```

Discord akan mengirim PING; kalau signature valid, tombol **Save** berhasil.

### 13. Mengaktifkan Vercel Cron
Cron sudah dideklarasikan di `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron", "schedule": "*/5 * * * *" }
  ],
  "functions": {
    "api/cron.js": { "maxDuration": 60, "memory": 1024 },
    "api/interactions.js": { "maxDuration": 30, "memory": 1024 }
  }
}
```

- `crons[].path` → endpoint yang dipanggil Vercel.
- `crons[].schedule` → ekspresi cron UTC; `*/5 * * * *` = tiap 5 menit.
- `functions.maxDuration` → batas eksekusi (cek banyak website butuh waktu lebih).
- Cron **aktif otomatis setelah deploy ke Production**. Lihat statusnya di **Project → Cron Jobs**, jalankan manual dengan tombol **Run**.
- Vercel otomatis mengirim header `Authorization: Bearer $CRON_SECRET`, jadi endpoint tetap aman.

> **Hobby plan:** interval 5 menit tidak dijamin. Alternatif gratis: panggil `/api/cron` tiap 5 menit dari cron eksternal (cron-job.org, GitHub Actions, UptimeRobot) dengan header `Authorization: Bearer <CRON_SECRET>`.

### 14. `/monitor add`

```
/monitor add url:https://example.com
```

- Menambahkan website ke board channel tersebut.
- Kalau board belum ada, bot membuat **satu** message embed dan mem-pin-nya.
- Kalau board sudah ada, bot **mengedit** board itu (tidak membuat message baru).
- Balasan konfirmasi bersifat *ephemeral* (hanya terlihat oleh Anda).

Contoh menambah banyak website:

```
/monitor add url:https://example.com
/monitor add url:https://google.com
/monitor add url:https://github.com
```

### 15. `/monitor list`
Menampilkan seluruh website yang dimonitor di channel tersebut:

```
Website 1:
https://example.com
Status: 🟢 ONLINE

Website 2:
https://google.com
Status: 🟢 ONLINE

Website 3:
https://website-down.com
Status: 🔴 OFFLINE
```

### 16. `/monitor status`
Sama seperti `list`, ditambah HTTP code, response time, uptime %, jumlah check, dan waktu pengecekan terakhir.

### 17. `/monitor remove`

```
/monitor remove url:https://example.com
```

Menghapus website dari board dan langsung memperbarui embed.

---

## 🖼️ Tampilan Monitor Board

```
🌐 Website Monitor
Website dimonitor: 3 • 🟢 Online: 2 • 🔴 Offline: 1

🟢 1. example.com
Status: ONLINE
HTTP: 200
Response: 124 ms
Uptime: 99.31% • Downtime: 0.69%
Checks: 288 (↑286 / ↓2)
Last Check: 02 Sep 2026 21:05 WIB • 3 minutes ago
URL: https://example.com

🔴 3. example-down.com
Status: OFFLINE
HTTP: —
Response: Timeout
Uptime: 41.20% • Downtime: 58.80%
Checks: 125 (↑51 / ↓74)
Last Check: 02 Sep 2026 21:05 WIB • 3 minutes ago
URL: https://example-down.com

3 website • 288 cron run • update tiap 5 menit
```

---

## 🔍 Cara Kerja Monitoring

1. `fetch()` bawaan Node.js dengan `AbortSignal.timeout(10000)` (10 detik).
2. Waktu mulai dicatat, response time dihitung dalam milidetik.
3. HTTP status code dicatat.
4. **ONLINE** = HTTP 200–399. **OFFLINE** = HTTP 400–599, DNS error, connection refused, timeout, network error, SSL error.
5. Semua website dicek bersamaan dengan `Promise.allSettled()`, sehingga satu website error/timeout **tidak** menghambat yang lain.
6. Statistik kumulatif diakumulasi ke state, lalu message board diedit.

> Tidak ada `setInterval()`, `while(true)`, atau proses 24/7. `AbortSignal.timeout()` hanya dipakai sebagai batas waktu per request, bukan scheduler.

---

## 🛡️ Error Handling

| Kasus | Penanganan |
|---|---|
| Invalid URL | Divalidasi `normalizeUrl()`, balasan error ephemeral |
| URL private/localhost | Ditolak (proteksi SSRF dasar) |
| Timeout / DNS error / connection refused / network error | Ditandai OFFLINE dengan label alasan, tidak melempar exception |
| HTTP 4xx/5xx | Ditandai OFFLINE beserta kode statusnya |
| Discord API error | Ditangkap per operasi; error 404/403 diperlakukan sebagai resource hilang |
| Message board dihapus | Cron mencatat warning; `/monitor add` membuat & mem-pin board baru |
| Channel dihapus / bot kehilangan akses | Channel dilewati, board lain tetap diproses |
| Missing environment variable | Pesan error jelas, endpoint balas 500 tanpa membocorkan nilai |
| Cron gagal | Response JSON `{ ok: false, error }` + log; board lain tetap diproses karena `Promise.allSettled()` |
| Signature interaction tidak valid | Balas HTTP 401 |

---

## ❓ Troubleshooting

| Gejala | Solusi |
|---|---|
| Discord menolak Interactions Endpoint URL | Pastikan `DISCORD_PUBLIC_KEY` benar dan sudah redeploy |
| Slash command tidak muncul | Jalankan `npm run register`; pastikan bot diundang dengan scope `applications.commands` |
| "The application did not respond" | Cek log function di Vercel; biasanya env var kurang |
| Board tidak ter-update | Pastikan board masih **ter-pin**, bot punya izin Manage Messages, dan cron berjalan (Project → Cron Jobs) |
| `/api/cron` balas 401 | `CRON_SECRET` di Vercel berbeda dengan yang Anda kirim di header |
| Cron jarang jalan | Anda memakai Hobby plan; gunakan Pro atau cron eksternal |

---

## 📄 Lisensi

MIT — bebas dipakai dan dimodifikasi.
