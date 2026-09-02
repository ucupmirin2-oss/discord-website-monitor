/**
 * Endpoint HTTP Interactions Discord.
 * Set URL ini di Discord Developer Portal > General Information >
 * "Interactions Endpoint URL": https://<project>.vercel.app/api/interactions
 *
 * Alur:
 *  1. Verifikasi signature Ed25519 (wajib, kalau gagal balas 401).
 *  2. PING (type 1) -> PONG (type 1).
 *  3. APPLICATION_COMMAND (type 2) -> balas DEFERRED (type 5) dalam < 3 detik,
 *     pekerjaan berat (cek website + edit message) dilanjutkan lewat waitUntil().
 */
import { handleMonitorCommand } from "../src/commands/monitor.js"
import { editInteractionReply } from "../src/discord.js"
import { readRawBody, verifyDiscordRequest } from "../src/utils/verify.js"
import { requireEnv } from "../src/config.js"

// Wajib: kita butuh body mentah untuk verifikasi signature.
export const config = {
	api: { bodyParser: false },
}

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 }
const InteractionResponseType = {
	PONG: 1,
	DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
}
const EPHEMERAL_FLAG = 1 << 6 // 64: balasan hanya terlihat oleh pemanggil command

/** waitUntil() milik Vercel: melanjutkan async work setelah response dikirim. */
async function runInBackground(promiseFactory) {
	try {
		const { waitUntil } = await import("@vercel/functions")
		waitUntil(promiseFactory())
	} catch {
		// Lokal / runtime lain: tunggu saja sampai selesai.
		await promiseFactory()
	}
}

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.setHeader("Allow", "POST")
		return res.status(405).json({ error: "Method not allowed" })
	}

	let publicKey
	try {
		publicKey = requireEnv("DISCORD_PUBLIC_KEY")
		requireEnv("DISCORD_TOKEN")
		requireEnv("DISCORD_CLIENT_ID")
	} catch (error) {
		console.error("[interactions] konfigurasi salah:", error.message)
		return res.status(500).json({ error: "Server misconfigured" })
	}

	const rawBody = await readRawBody(req)
	const isValid = verifyDiscordRequest(
		rawBody,
		req.headers["x-signature-ed25519"],
		req.headers["x-signature-timestamp"],
		publicKey,
	)
	if (!isValid) {
		// Discord mewajibkan 401 untuk signature yang tidak valid.
		return res.status(401).send("invalid request signature")
	}

	let interaction
	try {
		interaction = JSON.parse(rawBody.toString("utf8"))
	} catch {
		return res.status(400).json({ error: "Invalid JSON" })
	}

	// 1) Health check dari Discord.
	if (interaction.type === InteractionType.PING) {
		return res.status(200).json({ type: InteractionResponseType.PONG })
	}

	// 2) Slash command.
	if (interaction.type === InteractionType.APPLICATION_COMMAND) {
		if (interaction.data?.name !== "monitor") {
			return res.status(200).json({
				type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
				data: { flags: EPHEMERAL_FLAG },
			})
		}

		await runInBackground(async () => {
			try {
				const payload = await handleMonitorCommand(interaction)
				await editInteractionReply(interaction.token, { flags: EPHEMERAL_FLAG, ...payload })
			} catch (error) {
				console.error("[interactions] gagal memproses command:", error)
				try {
					await editInteractionReply(interaction.token, {
						flags: EPHEMERAL_FLAG,
						content: `❌ Terjadi error: ${String(error?.message ?? error).slice(0, 300)}`,
					})
				} catch (nested) {
					console.error("[interactions] gagal mengirim pesan error:", nested)
				}
			}
		})

		// Balas cepat (< 3 detik) supaya Discord tidak menganggap command gagal.
		return res.status(200).json({
			type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
			data: { flags: EPHEMERAL_FLAG },
		})
	}

	return res.status(200).json({ type: InteractionResponseType.PONG })
}
