/**
 * Validasi & normalisasi URL yang dimasukkan user.
 * Mencegah invalid URL, protokol berbahaya, dan target internal (SSRF dasar).
 */

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"127.0.0.1",
	"0.0.0.0",
	"::1",
	"metadata.google.internal",
])

const PRIVATE_IP_PATTERN =
	/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/

/**
 * @param {string} input URL mentah dari user.
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
export function normalizeUrl(input) {
	if (typeof input !== "string" || input.trim() === "") {
		return { ok: false, reason: "URL kosong." }
	}

	let raw = input.trim()
	// Tambahkan skema default supaya "example.com" tetap valid.
	if (!/^https?:\/\//i.test(raw)) raw = "http" + "s://" + raw

	let parsed
	try {
		parsed = new URL(raw)
	} catch {
		return { ok: false, reason: "Format URL tidak valid." }
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { ok: false, reason: "Hanya protokol http/https yang didukung." }
	}
	if (!parsed.hostname.includes(".") && !parsed.hostname.includes(":")) {
		return { ok: false, reason: "Hostname tidak valid." }
	}
	if (
		BLOCKED_HOSTNAMES.has(parsed.hostname.toLowerCase()) ||
		PRIVATE_IP_PATTERN.test(parsed.hostname)
	) {
		return { ok: false, reason: "Alamat internal/private tidak boleh dimonitor." }
	}
	if (parsed.href.length > 200) {
		return { ok: false, reason: "URL terlalu panjang (maks 200 karakter)." }
	}

	// Buang hash, rapikan trailing slash pada root.
	parsed.hash = ""
	const normalized =
		parsed.pathname === "/" && !parsed.search
			? `${parsed.protocol}//${parsed.host}`
			: parsed.href

	return { ok: true, url: normalized }
}

/** Bandingkan dua URL secara longgar (abaikan trailing slash & case host). */
export function isSameUrl(a, b) {
	const na = normalizeUrl(a)
	const nb = normalizeUrl(b)
	if (!na.ok || !nb.ok) return false
	return na.url.replace(/\/$/, "").toLowerCase() === nb.url.replace(/\/$/, "").toLowerCase()
}
