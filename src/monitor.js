/**
 * Logic monitoring website.
 * Murni HTTP check memakai fetch bawaan Node.js (tanpa dependency tambahan).
 *
 * Catatan penting:
 * - TIDAK ada setInterval()/while(true) di sini. Scheduler-nya adalah Vercel Cron.
 * - AbortSignal.timeout() dipakai hanya sebagai timeout per-request, bukan scheduler.
 */
import { config } from "./config.js"

/** Klasifikasi error jaringan menjadi pesan singkat yang enak dibaca. */
function describeError(error) {
	const name = error?.name ?? ""
	const code = error?.cause?.code ?? error?.code ?? ""

	if (name === "TimeoutError" || name === "AbortError" || code === "UND_ERR_HEADERS_TIMEOUT") {
		return "Timeout"
	}
	switch (code) {
		case "ENOTFOUND":
		case "EAI_AGAIN":
			return "DNS error"
		case "ECONNREFUSED":
			return "Connection refused"
		case "ECONNRESET":
			return "Connection reset"
		case "EHOSTUNREACH":
		case "ENETUNREACH":
			return "Network unreachable"
		case "CERT_HAS_EXPIRED":
			return "SSL expired"
		case "ERR_TLS_CERT_ALTNAME_INVALID":
			return "SSL invalid"
		default:
			return code ? `Network error (${code})` : "Network error"
	}
}

/**
 * Cek satu website.
 * ONLINE  : HTTP 200-399
 * OFFLINE : HTTP 400-599, DNS error, connection refused, timeout, network error
 *
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<{url:string, online:boolean, status:number|null, responseTime:number, error:string|null, checkedAt:number}>}
 */
export async function checkSite(url, timeoutMs = config.checkTimeoutMs) {
	const startedAt = Date.now() // 1-2. catat waktu mulai

	try {
		const response = await fetch(url, {
			method: "GET",
			redirect: "follow",
			// Timeout per-request supaya satu website lambat tidak menahan yang lain.
			signal: AbortSignal.timeout(timeoutMs),
			headers: {
				"user-agent": "DiscordWebsiteMonitor/1.0 (+https://vercel.com)",
				accept: "*/*",
			},
		})

		// Habiskan body supaya koneksi tidak menggantung (dan response time realistis).
		try {
			await response.arrayBuffer()
		} catch {
			/* body opsional, abaikan */
		}

		const responseTime = Date.now() - startedAt // 3. response time (ms)
		const status = response.status // 4. HTTP status code
		const online = status >= 200 && status <= 399 // 5. tentukan ONLINE/OFFLINE

		return {
			url,
			online,
			status,
			responseTime,
			error: online ? null : `HTTP ${status}`,
			checkedAt: Math.floor(Date.now() / 1000),
		}
	} catch (error) {
		return {
			url,
			online: false,
			status: null,
			responseTime: Date.now() - startedAt,
			error: describeError(error),
			checkedAt: Math.floor(Date.now() / 1000),
		}
	}
}

/**
 * Cek banyak website secara paralel.
 * Promise.allSettled() memastikan satu website error tidak membatalkan yang lain.
 *
 * @param {string[]} urls
 * @returns {Promise<Array<ReturnType<typeof checkSite> extends Promise<infer T> ? T : never>>}
 */
export async function checkSites(urls, timeoutMs = config.checkTimeoutMs) {
	const settled = await Promise.allSettled(urls.map((url) => checkSite(url, timeoutMs)))

	return settled.map((result, index) => {
		if (result.status === "fulfilled") return result.value
		// Safety net: checkSite sudah menangkap error sendiri, ini hanya jaga-jaga.
		return {
			url: urls[index],
			online: false,
			status: null,
			responseTime: 0,
			error: "Unexpected error",
			checkedAt: Math.floor(Date.now() / 1000),
		}
	})
}
