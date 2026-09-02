/**
 * Lapisan tipis di atas Discord REST API (dari discord.js).
 * Semua interaksi ke Discord lewat file ini agar error handling terpusat.
 */
import { REST, Routes } from "discord.js"
import { requireEnv } from "./config.js"
import { decodeState, STATE_URL_PREFIX } from "./state.js"

let cachedRest = null

/** REST client (dibuat sekali per invocation). */
export function getRest() {
	if (!cachedRest) {
		cachedRest = new REST({ version: "10" }).setToken(requireEnv("DISCORD_TOKEN"))
	}
	return cachedRest
}

/** Deteksi error Discord berdasarkan HTTP status. */
export function isDiscordStatus(error, status) {
	return error?.status === status || error?.httpStatus === status
}

/** True jika message/channel sudah dihapus atau bot kehilangan akses. */
export function isMissingResource(error) {
	return isDiscordStatus(error, 404) || isDiscordStatus(error, 403)
}

/** Daftar text channel di sebuah guild. */
export async function listTextChannels(guildId) {
	const channels = await getRest().get(Routes.guildChannels(guildId))
	// 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT
	return channels.filter((channel) => channel.type === 0 || channel.type === 5)
}

/**
 * Ambil pinned message sebuah channel.
 * Discord punya dua bentuk response (array lama & { items: [...] } baru),
 * jadi keduanya ditangani.
 */
export async function listPinnedMessages(channelId) {
	const response = await getRest().get(`/channels/${channelId}/pins`)
	if (Array.isArray(response)) return response
	if (Array.isArray(response?.items)) {
		return response.items.map((item) => item.message ?? item)
	}
	return []
}

/**
 * Cari monitor board di sebuah channel.
 * Board = message milik bot yang di-pin dan punya state ter-encode di embed.author.url.
 *
 * @returns {Promise<{ channelId: string, messageId: string, state: object } | null>}
 */
export async function findBoardInChannel(channelId) {
	const clientId = requireEnv("DISCORD_CLIENT_ID")
	let pins = []
	try {
		pins = await listPinnedMessages(channelId)
	} catch (error) {
		// Channel dihapus / bot tidak punya akses -> anggap tidak ada board.
		if (isMissingResource(error)) return null
		throw error
	}

	for (const message of pins) {
		if (message?.author?.id !== clientId) continue
		const authorUrl = message?.embeds?.[0]?.author?.url
		if (typeof authorUrl !== "string" || !authorUrl.startsWith(STATE_URL_PREFIX)) continue
		const state = decodeState(authorUrl)
		if (state) return { channelId, messageId: message.id, state }
	}
	return null
}

/**
 * Cari semua monitor board di seluruh guild (dipakai oleh cron).
 * Jika MONITOR_CHANNEL_IDS diisi, hanya channel tersebut yang dipindai.
 */
export async function findAllBoards({ guildIds, channelIds = [] }) {
	let targetChannelIds = channelIds

	if (targetChannelIds.length === 0) {
		const perGuild = await Promise.allSettled(
			guildIds.map(async (guildId) => {
				const channels = await listTextChannels(guildId)
				return channels.map((channel) => channel.id)
			}),
		)
		targetChannelIds = perGuild.flatMap((result) =>
			result.status === "fulfilled" ? result.value : [],
		)
	}

	const results = await Promise.allSettled(
		targetChannelIds.map((channelId) => findBoardInChannel(channelId)),
	)

	return results
		.filter((result) => result.status === "fulfilled" && result.value)
		.map((result) => result.value)
}

/** Kirim message baru ke channel. */
export async function createMessage(channelId, payload) {
	return getRest().post(Routes.channelMessages(channelId), { body: payload })
}

/** Edit message yang sudah ada (dipakai tiap 5 menit oleh cron). */
export async function editMessage(channelId, messageId, payload) {
	return getRest().patch(Routes.channelMessage(channelId, messageId), { body: payload })
}

/** Pin message agar mudah ditemukan kembali oleh cron (pengganti "database"). */
export async function pinMessage(channelId, messageId) {
	try {
		await getRest().put(Routes.channelPin(channelId, messageId))
		return true
	} catch (error) {
		console.error("[discord] gagal pin message:", error?.message ?? error)
		return false
	}
}

/** Update balasan awal sebuah interaction (setelah deferred response). */
export async function editInteractionReply(interactionToken, payload) {
	const applicationId = requireEnv("DISCORD_CLIENT_ID")
	return getRest().patch(
		Routes.webhookMessage(applicationId, interactionToken, "@original"),
		{ body: payload, auth: false },
	)
}
