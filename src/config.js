/**
 * Konfigurasi terpusat + validasi environment variable.
 * Semua secret HANYA dibaca di sisi server (serverless function),
 * tidak pernah dikirim ke client / frontend.
 */

/** Ambil env var wajib. Melempar error yang jelas kalau belum diset. */
export function requireEnv(name) {
	const value = process.env[name]
	if (!value || value.trim() === "") {
		throw new Error(
			`Missing environment variable: ${name}. Set di file .env (lokal) atau Vercel > Settings > Environment Variables.`,
		)
	}
	return value.trim()
}

/** Ambil env var opsional dengan nilai default. */
export function optionalEnv(name, fallback = undefined) {
	const value = process.env[name]
	return value && value.trim() !== "" ? value.trim() : fallback
}

/** Ambil env var numerik opsional. */
export function numberEnv(name, fallback) {
	const raw = optionalEnv(name)
	const parsed = Number(raw)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
	/** Timeout HTTP per website (ms). Dipakai oleh AbortSignal.timeout(). */
	get checkTimeoutMs() {
		return numberEnv("CHECK_TIMEOUT_MS", 10_000)
	},
	/** Timezone untuk menampilkan "Last Check". */
	get displayTimezone() {
		return optionalEnv("DISPLAY_TIMEZONE", "Asia/Jakarta")
	},
	/** Maksimum website per monitor board (dibatasi ukuran state terenkode). */
	get maxSites() {
		return Math.min(numberEnv("MAX_SITES", 15), 20)
	},
	/** Batasi scanning channel saat cron (opsional, hemat rate limit). */
	get monitorChannelIds() {
		const raw = optionalEnv("MONITOR_CHANNEL_IDS", "")
		return raw
			? raw
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean)
			: []
	},
	/** Guild yang dipindai oleh cron. Bisa lebih dari satu, dipisah koma. */
	get guildIds() {
		return requireEnv("DISCORD_GUILD_ID")
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean)
	},
}
