/**
 * Register slash command ke Discord.
 *
 * Pemakaian:
 *   node scripts/register-commands.js            # register ke guild (instan)
 *   node scripts/register-commands.js --global   # register global (bisa 1 jam)
 *   node scripts/register-commands.js --clear    # hapus semua command di guild
 *
 * Script ini terpisah dari logic monitoring: hanya mengurus konfigurasi command.
 */
import "dotenv/config"
import { REST, Routes } from "discord.js"
import { commands } from "../src/commands/monitor.js"
import { requireEnv } from "../src/config.js"

async function main() {
	const args = process.argv.slice(2)
	const isGlobal = args.includes("--global")
	const isClear = args.includes("--clear")

	const token = requireEnv("DISCORD_TOKEN")
	const clientId = requireEnv("DISCORD_CLIENT_ID")
	const rest = new REST({ version: "10" }).setToken(token)

	const body = isClear ? [] : commands.map((command) => command.toJSON())

	if (isGlobal) {
		await rest.put(Routes.applicationCommands(clientId), { body })
		console.log(
			isClear
				? "✅ Semua global command dihapus."
				: `✅ ${body.length} global command didaftarkan (propagasi hingga ~1 jam).`,
		)
		return
	}

	const guildId = requireEnv("DISCORD_GUILD_ID").split(",")[0].trim()
	await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body })
	console.log(
		isClear
			? `✅ Semua command di guild ${guildId} dihapus.`
			: `✅ ${body.length} command didaftarkan ke guild ${guildId} (langsung aktif).`,
	)
}

main().catch((error) => {
	console.error("❌ Gagal register command:", error?.message ?? error)
	process.exit(1)
})
