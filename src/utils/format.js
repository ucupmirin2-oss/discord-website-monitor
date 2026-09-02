/**
 * Helper formatting untuk tampilan embed.
 */
import { config } from "../config.js"

const MONTHS_ID = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"Mei",
	"Jun",
	"Jul",
	"Agu",
	"Sep",
	"Okt",
	"Nov",
	"Des",
]

/** Label singkat timezone, mis. Asia/Jakarta -> WIB. */
function timezoneLabel(timeZone) {
	const map = {
		"Asia/Jakarta": "WIB",
		"Asia/Makassar": "WITA",
		"Asia/Jayapura": "WIT",
	}
	return map[timeZone] ?? timeZone
}

/** Format epoch detik -> "02 Sep 2026 21:05 WIB". */
export function formatDateTime(epochSeconds) {
	if (!epochSeconds) return "—"
	const timeZone = config.displayTimezone
	const date = new Date(epochSeconds * 1000)
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		day: "2-digit",
		month: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(date)
	const get = (type) => parts.find((p) => p.type === type)?.value ?? ""
	const month = MONTHS_ID[Number(get("month")) - 1] ?? get("month")
	return `${get("day")} ${month} ${get("year")} ${get("hour")}:${get("minute")} ${timezoneLabel(timeZone)}`
}

/** Discord relative timestamp, mis. "3 minutes ago". */
export function relativeTimestamp(epochSeconds) {
	return epochSeconds ? `<t:${epochSeconds}:R>` : "—"
}

/** Persentase dengan 2 desimal. */
export function percent(part, total) {
	if (!total) return "0.00%"
	return `${((part / total) * 100).toFixed(2)}%`
}

/** Response time -> "124 ms" atau alasan gagal. */
export function formatResponse(site) {
	if (site.online) return `${site.responseTime} ms`
	if (site.error) return site.error
	return site.responseTime ? `${site.responseTime} ms` : "—"
}

/** Hostname pendek untuk judul field. */
export function hostnameOf(url) {
	try {
		return new URL(url).hostname
	} catch {
		return url
	}
}

/** Potong teks agar aman terhadap limit Discord. */
export function truncate(text, max) {
	const value = String(text ?? "")
	return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
