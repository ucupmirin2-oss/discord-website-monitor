/**
 * Definisi & handler slash command `/monitor`.
 * Konfigurasi command (schema) sengaja dipisah dari logic monitoring (src/monitor.js).
 */
import { SlashCommandBuilder } from "discord.js"
import { buildBoardMessage, buildListEmbed } from "../embed.js"
import {
	createMessage,
	editMessage,
	findBoardInChannel,
	isMissingResource,
	pinMessage,
} from "../discord.js"
import { checkSites } from "../monitor.js"
import { addSite, applyResults, emptyState, removeSite } from "../state.js"

/** Schema slash command (dipakai scripts/register-commands.js). */
export const monitorCommand = new SlashCommandBuilder()
	.setName("monitor")
	.setDescription("Monitor uptime website secara otomatis setiap 5 menit")
	.addSubcommand((sub) =>
		sub
			.setName("add")
			.setDescription("Tambahkan website ke monitoring")
			.addStringOption((option) =>
				option
					.setName("url")
					.setDescription("URL website, contoh: https://example.com")
					.setRequired(true)
					.setMaxLength(200),
			),
	)
	.addSubcommand((sub) =>
		sub
			.setName("remove")
			.setDescription("Hapus website dari monitoring")
			.addStringOption((option) =>
				option
					.setName("url")
					.setDescription("URL website yang ingin dihapus")
					.setRequired(true)
					.setMaxLength(200),
			),
	)
	.addSubcommand((sub) => sub.setName("list").setDescription("Tampilkan semua website yang dimonitor"))
	.addSubcommand((sub) =>
		sub.setName("status").setDescription("Tampilkan status detail semua website yang dimonitor"),
	)

/** Semua command yang dimiliki bot ini. */
export const commands = [monitorCommand]

/** Ambil nilai option dari payload interaction (HTTP interaction = JSON mentah). */
function getOption(interaction, name) {
	const subcommand = interaction.data?.options?.[0]
	const option = subcommand?.options?.find((opt) => opt.name === name)
	return option?.value
}

/** Ambil nama subcommand. */
export function getSubcommand(interaction) {
	return interaction.data?.options?.[0]?.name ?? ""
}

/** Simpan state ke board: edit message lama, atau buat + pin message baru. */
async function saveBoard(channelId, board, state) {
	const payload = buildBoardMessage(state)

	if (board) {
		try {
			await editMessage(channelId, board.messageId, payload)
			return { messageId: board.messageId, created: false }
		} catch (error) {
			// Message board sudah dihapus user -> buat ulang, jangan crash.
			if (!isMissingResource(error)) throw error
		}
	}

	const message = await createMessage(channelId, payload)
	await pinMessage(channelId, message.id)
	return { messageId: message.id, created: true }
}

/**
 * Jalankan command. Dipanggil SETELAH bot mengirim deferred response,
 * hasilnya dikirim balik lewat editInteractionReply().
 *
 * @returns {Promise<{ content?: string, embeds?: object[] }>} payload balasan (ephemeral)
 */
export async function handleMonitorCommand(interaction) {
	const channelId = interaction.channel_id
	const subcommand = getSubcommand(interaction)

	if (!channelId) {
		return { content: "❌ Command ini hanya bisa dipakai di dalam channel server." }
	}

	// State selalu dibaca ulang dari message board (satu-satunya sumber kebenaran).
	const board = await findBoardInChannel(channelId)
	const state = board?.state ?? emptyState()

	switch (subcommand) {
		case "add": {
			const result = addSite(state, getOption(interaction, "url"))
			if (!result.ok) return { content: `❌ ${result.reason}` }

			// Cek langsung supaya embed tidak kosong sampai cron berikutnya.
			const results = await checkSites(result.state.sites.map((site) => site.u))
			const nextState = applyResults(result.state, results)
			const saved = await saveBoard(channelId, board, nextState)

			const current = results.find((item) => item.url === result.url)
			const statusLine = current
				? `${current.online ? "🟢 ONLINE" : "🔴 OFFLINE"} • HTTP \`${current.status ?? "—"}\` • \`${
						current.online ? `${current.responseTime} ms` : current.error
					}\``
				: ""

			return {
				content: [
					`✅ \`${result.url}\` ditambahkan ke monitoring.`,
					statusLine,
					saved.created
						? "📌 Monitor board dibuat & di-pin di channel ini. Message tersebut akan diperbarui otomatis setiap 5 menit."
						: "🔁 Monitor board yang sudah ada diperbarui (tidak membuat message baru).",
				]
					.filter(Boolean)
					.join("\n"),
			}
		}

		case "remove": {
			if (!board) return { content: "❌ Belum ada monitor board di channel ini." }
			const result = removeSite(state, getOption(interaction, "url"))
			if (!result.ok) return { content: `❌ ${result.reason}` }

			await saveBoard(channelId, board, result.state)
			return {
				content: `🗑️ \`${result.url}\` dihapus dari monitoring. Sisa **${result.state.sites.length}** website.`,
			}
		}

		case "list":
			return { embeds: [buildListEmbed(state, { detailed: false })] }

		case "status":
			return { embeds: [buildListEmbed(state, { detailed: true })] }

		default:
			return { content: "❌ Subcommand tidak dikenal." }
	}
}
