/**
 * Endpoint yang dipanggil Vercel Cron setiap 5 menit (lihat vercel.json).
 *
 * Tugas:
 *  1. Temukan semua monitor board (pinned message milik bot) = "daftar website".
 *  2. Cek semua website secara paralel (Promise.allSettled).
 *  3. Hitung statistik terbaru (uptime, downtime, jumlah check).
 *  4. Edit message Discord yang sudah ada (bukan bikin message baru).
 *  5. Balas JSON ringkasan.
 *
 * Keamanan: hanya bisa dipanggil dengan header `Authorization: Bearer <CRON_SECRET>`,
 * yang otomatis dikirim Vercel Cron ketika CRON_SECRET diset di project.
 */
import { config as appConfig, requireEnv } from "../src/config.js"
import { buildBoardMessage } from "../src/embed.js"
import { editMessage, findAllBoards, isMissingResource } from "../src/discord.js"
import { checkSites } from "../src/monitor.js"
import { applyResults } from "../src/state.js"
import { safeEqual } from "../src/utils/verify.js"

/** Validasi request cron. */
function isAuthorized(req) {
	const secret = requireEnv("CRON_SECRET")
	const header = req.headers.authorization ?? ""
	if (header.startsWith("Bearer ") && safeEqual(header.slice(7), secret)) return true
	// Alternatif untuk trigger manual (mis. curl / uptime pinger eksternal).
	if (safeEqual(req.headers["x-cron-secret"], secret)) return true
	return false
}

/** Proses satu monitor board. */
async function processBoard(board) {
	const urls = board.state.sites.map((site) => site.u)
	if (urls.length === 0) {
		return { channelId: board.channelId, messageId: board.messageId, sites: 0, skipped: true }
	}

	const results = await checkSites(urls, appConfig.checkTimeoutMs)
	const nextState = applyResults(board.state, results)

	try {
		await editMessage(board.channelId, board.messageId, buildBoardMessage(nextState))
	} catch (error) {
		// Message sudah dihapus / channel hilang / bot kehilangan izin.
		if (isMissingResource(error)) {
			console.warn(
				`[cron] board ${board.messageId} di channel ${board.channelId} tidak bisa diupdate (dihapus / tanpa akses).`,
			)
			return {
				channelId: board.channelId,
				messageId: board.messageId,
				sites: urls.length,
				updated: false,
				error: "message/channel tidak tersedia",
			}
		}
		throw error
	}

	return {
		channelId: board.channelId,
		messageId: board.messageId,
		sites: urls.length,
		updated: true,
		online: results.filter((result) => result.online).length,
		offline: results.filter((result) => !result.online).length,
		results: results.map((result) => ({
			url: result.url,
			online: result.online,
			status: result.status,
			responseTime: result.responseTime,
			error: result.error,
		})),
	}
}

export default async function handler(req, res) {
	const startedAt = Date.now()

	try {
		if (!isAuthorized(req)) {
			return res.status(401).json({ ok: false, error: "Unauthorized" })
		}
	} catch (error) {
		// Missing environment variable (CRON_SECRET / lainnya).
		console.error("[cron] konfigurasi salah:", error.message)
		return res.status(500).json({ ok: false, error: error.message })
	}

	try {
		const boards = await findAllBoards({
			guildIds: appConfig.guildIds,
			channelIds: appConfig.monitorChannelIds,
		})

		const settled = await Promise.allSettled(boards.map(processBoard))
		const boardsResult = settled.map((item, index) =>
			item.status === "fulfilled"
				? item.value
				: {
						channelId: boards[index]?.channelId,
						messageId: boards[index]?.messageId,
						updated: false,
						error: String(item.reason?.message ?? item.reason).slice(0, 200),
					},
		)

		return res.status(200).json({
			ok: true,
			ranAt: new Date().toISOString(),
			durationMs: Date.now() - startedAt,
			boards: boardsResult.length,
			sitesChecked: boardsResult.reduce((total, board) => total + (board.sites ?? 0), 0),
			details: boardsResult,
		})
	} catch (error) {
		console.error("[cron] gagal:", error)
		return res.status(500).json({
			ok: false,
			error: String(error?.message ?? error).slice(0, 300),
			durationMs: Date.now() - startedAt,
		})
	}
}
