/**
 * Pembuatan Discord Embed memakai EmbedBuilder dari discord.js.
 * State (JSON tergzip) disisipkan pada `author.url` agar message ini
 * sekaligus menjadi tempat penyimpanan data (lihat src/state.js).
 */
import { EmbedBuilder } from "discord.js"
import { encodeState, toView } from "./state.js"
import {
	formatDateTime,
	formatResponse,
	hostnameOf,
	percent,
	relativeTimestamp,
	truncate,
} from "./utils/format.js"

const COLOR_ONLINE = 0x22c55e // hijau: semua online
const COLOR_DEGRADED = 0xf59e0b // kuning: sebagian offline
const COLOR_OFFLINE = 0xef4444 // merah: semua offline
const COLOR_IDLE = 0x64748b // abu: belum ada data

/** Warna embed berdasarkan kondisi keseluruhan. */
function resolveColor(views) {
	if (views.length === 0) return COLOR_IDLE
	const known = views.filter((view) => !view.unknown)
	if (known.length === 0) return COLOR_IDLE
	const offline = known.filter((view) => !view.online).length
	if (offline === 0) return COLOR_ONLINE
	if (offline === known.length) return COLOR_OFFLINE
	return COLOR_DEGRADED
}

/** Satu field embed per website. */
function buildField(view, index) {
	const icon = view.unknown ? "⚪" : view.online ? "🟢" : "🔴"
	const label = view.unknown ? "MENUNGGU CEK" : view.online ? "ONLINE" : "OFFLINE"

	const lines = [
		`Status: **${label}**`,
		`HTTP: \`${view.status ?? "—"}\``,
		`Response: \`${view.checks ? formatResponse({ online: view.online, responseTime: view.responseTime, error: view.error }) : "—"}\``,
		`Uptime: \`${percent(view.up, view.checks)}\` • Downtime: \`${percent(view.down, view.checks)}\``,
		`Checks: \`${view.checks}\` (↑${view.up} / ↓${view.down})`,
		`Last Check: ${view.checkedAt ? `${formatDateTime(view.checkedAt)} • ${relativeTimestamp(view.checkedAt)}` : "—"}`,
		`URL: ${view.url}`,
	]

	return {
		name: truncate(`${icon} ${index + 1}. ${hostnameOf(view.url)}`, 256),
		value: truncate(lines.join("\n"), 1024),
		inline: false,
	}
}

/**
 * Bangun payload message board (embed utama yang di-edit tiap 5 menit).
 * @param {object} state
 * @returns {{ embeds: object[] }}
 */
export function buildBoardMessage(state) {
	const views = state.sites.map(toView)
	const onlineCount = views.filter((view) => !view.unknown && view.online).length
	const offlineCount = views.filter((view) => !view.unknown && !view.online).length

	const embed = new EmbedBuilder()
		.setTitle("🌐 Website Monitor")
		.setColor(resolveColor(views))
		// author.url = tempat state disimpan (persistence tanpa database).
		.setAuthor({ name: "Auto-update setiap 5 menit", url: encodeState(state) })
		.setDescription(
			views.length === 0
				? "Belum ada website yang dimonitor.\nTambahkan dengan `/monitor add url:https://example.com`"
				: `Website dimonitor: **${views.length}** • 🟢 Online: **${onlineCount}** • 🔴 Offline: **${offlineCount}**`,
		)
		.addFields(views.slice(0, 20).map(buildField))
		.setFooter({
			text: `${views.length} website • ${state.runs ?? 0} cron run • update tiap 5 menit`,
		})
		.setTimestamp(state.lastRun ? state.lastRun * 1000 : Date.now())

	return { embeds: [embed.toJSON()] }
}

/** Embed ringkas untuk /monitor list dan /monitor status (ephemeral). */
export function buildListEmbed(state, { detailed = false } = {}) {
	const views = state.sites.map(toView)

	if (views.length === 0) {
		return new EmbedBuilder()
			.setTitle("🌐 Website Monitor")
			.setColor(COLOR_IDLE)
			.setDescription("Belum ada website yang dimonitor di channel ini.")
			.toJSON()
	}

	const body = views
		.map((view, index) => {
			const icon = view.unknown ? "⚪" : view.online ? "🟢" : "🔴"
			const label = view.unknown ? "BELUM DICEK" : view.online ? "ONLINE" : "OFFLINE"
			const base = `**Website ${index + 1}:**\n\`${view.url}\`\nStatus: ${icon} ${label}`
			if (!detailed) return base
			return [
				base,
				`HTTP: \`${view.status ?? "—"}\` • Response: \`${
					view.checks
						? formatResponse({
								online: view.online,
								responseTime: view.responseTime,
								error: view.error,
							})
						: "—"
				}\``,
				`Uptime: \`${percent(view.up, view.checks)}\` • Checks: \`${view.checks}\``,
				`Last Check: ${view.checkedAt ? formatDateTime(view.checkedAt) : "—"}`,
			].join("\n")
		})
		.join("\n\n")

	return new EmbedBuilder()
		.setTitle(detailed ? "📊 Status Monitoring" : "📋 Daftar Website Dimonitor")
		.setColor(resolveColor(views))
		.setDescription(truncate(body, 4000))
		.setFooter({ text: `${views.length} website dimonitor di channel ini` })
		.setTimestamp(state.lastRun ? state.lastRun * 1000 : Date.now())
		.toJSON()
}
