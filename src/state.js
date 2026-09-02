/**
 * PERSISTENCE TANPA DATABASE
 * ==========================
 * Vercel Serverless bersifat stateless: variabel global, memori, dan filesystem
 * TIDAK bertahan antar invocation. Karena itu state disimpan di tempat yang
 * memang sudah persisten dan gratis: **message Discord itu sendiri**.
 *
 * Discord kita pakai sebagai "key-value store":
 *   - channel ID  -> lokasi message (didapat saat membaca pinned message)
 *   - message ID  -> ID message board yang di-pin bot
 *   - daftar URL + statistik uptime -> JSON yang di-gzip + base64url,
 *     lalu ditempel di `embed.author.url` sebagai query string (tidak terlihat
 *     mencolok oleh user, tapi ikut tersimpan permanen bersama message).
 *
 * Setiap cron run:
 *   1. baca message board (state lama)
 *   2. cek semua website
 *   3. hitung statistik baru
 *   4. tulis ulang message board (state baru)
 *
 * Keterbatasan didokumentasikan di README (bagian "Batasan Tanpa Database").
 */
import { gzipSync, gunzipSync } from "node:zlib"
import { config } from "./config.js"
import { isSameUrl, normalizeUrl } from "./utils/url.js"

/** Penanda agar bot bisa mengenali message board miliknya sendiri. */
export const STATE_URL_PREFIX = "https://uptime-monitor.invalid/state?v=1&d="

/** Batas aman panjang URL di dalam embed. */
const MAX_STATE_URL_LENGTH = 1800

/** State kosong. */
export function emptyState() {
	return { v: 1, sites: [], lastRun: 0, runs: 0 }
}

/**
 * Bentuk site (dipendekkan agar hemat byte saat diencode):
 *   u  url
 *   c  total checks
 *   o  total online
 *   d  total offline
 *   s  status terakhir (1 = online, 0 = offline)
 *   h  http status code terakhir
 *   t  response time terakhir (ms)
 *   l  last checked (epoch detik)
 *   e  error terakhir
 *   a  added at (epoch detik)
 */
export function newSite(url) {
	return {
		u: url,
		c: 0,
		o: 0,
		d: 0,
		s: null,
		h: null,
		t: null,
		l: 0,
		e: null,
		a: Math.floor(Date.now() / 1000),
	}
}

/** Encode state -> URL yang ditempel di embed.author.url. */
export function encodeState(state) {
	const json = JSON.stringify(state)
	const packed = gzipSync(Buffer.from(json, "utf8")).toString("base64url")
	const url = `${STATE_URL_PREFIX}${packed}`
	if (url.length > MAX_STATE_URL_LENGTH) {
		throw new Error(
			"State terlalu besar untuk disimpan di message Discord. Kurangi jumlah website yang dimonitor.",
		)
	}
	return url
}

/** Decode state dari embed.author.url. Mengembalikan null jika bukan board kita. */
export function decodeState(authorUrl) {
	if (typeof authorUrl !== "string" || !authorUrl.startsWith(STATE_URL_PREFIX)) return null
	try {
		const packed = authorUrl.slice(STATE_URL_PREFIX.length)
		const json = gunzipSync(Buffer.from(packed, "base64url")).toString("utf8")
		const parsed = JSON.parse(json)
		if (!parsed || !Array.isArray(parsed.sites)) return null
		return { v: 1, lastRun: 0, runs: 0, ...parsed }
	} catch {
		// State korup / format lama -> jangan crash, anggap tidak terbaca.
		return null
	}
}

/** Cari site di dalam state. */
export function findSite(state, url) {
	return state.sites.find((site) => isSameUrl(site.u, url)) ?? null
}

/**
 * Tambah website ke state.
 * @returns {{ ok: true, state: object, url: string } | { ok: false, reason: string }}
 */
export function addSite(state, rawUrl) {
	const normalized = normalizeUrl(rawUrl)
	if (!normalized.ok) return { ok: false, reason: normalized.reason }
	if (findSite(state, normalized.url)) {
		return { ok: false, reason: `\`${normalized.url}\` sudah ada di daftar monitoring.` }
	}
	if (state.sites.length >= config.maxSites) {
		return {
			ok: false,
			reason: `Maksimum ${config.maxSites} website per channel (batas ukuran state tanpa database).`,
		}
	}
	return {
		ok: true,
		url: normalized.url,
		state: { ...state, sites: [...state.sites, newSite(normalized.url)] },
	}
}

/**
 * Hapus website dari state.
 * @returns {{ ok: true, state: object, url: string } | { ok: false, reason: string }}
 */
export function removeSite(state, rawUrl) {
	const normalized = normalizeUrl(rawUrl)
	const target = normalized.ok ? normalized.url : rawUrl
	const existing = findSite(state, target)
	if (!existing) return { ok: false, reason: `\`${target}\` tidak ditemukan di daftar monitoring.` }
	return {
		ok: true,
		url: existing.u,
		state: { ...state, sites: state.sites.filter((site) => site.u !== existing.u) },
	}
}

/** Gabungkan hasil pengecekan ke state (menambah statistik uptime kumulatif). */
export function applyResults(state, results) {
	const byUrl = new Map(results.map((result) => [result.url, result]))

	const sites = state.sites.map((site) => {
		const result = byUrl.get(site.u)
		if (!result) return site
		return {
			...site,
			c: (site.c ?? 0) + 1,
			o: (site.o ?? 0) + (result.online ? 1 : 0),
			d: (site.d ?? 0) + (result.online ? 0 : 1),
			s: result.online ? 1 : 0,
			h: result.status,
			t: result.responseTime,
			l: result.checkedAt,
			e: result.online ? null : String(result.error ?? "").slice(0, 40),
		}
	})

	return {
		...state,
		sites,
		lastRun: Math.floor(Date.now() / 1000),
		runs: (state.runs ?? 0) + 1,
	}
}

/** Bentuk view-friendly dari site (dipakai embed & command). */
export function toView(site) {
	return {
		url: site.u,
		checks: site.c ?? 0,
		up: site.o ?? 0,
		down: site.d ?? 0,
		online: site.s === 1,
		unknown: site.s === null || site.s === undefined,
		status: site.h ?? null,
		responseTime: site.t ?? null,
		checkedAt: site.l ?? 0,
		error: site.e ?? null,
	}
}
