/**
 * Utility lokal untuk menguji logic monitoring tanpa Discord.
 *
 *   node scripts/local-check.js https://example.com https://google.com
 */
import "dotenv/config"
import { checkSites } from "../src/monitor.js"
import { normalizeUrl } from "../src/utils/url.js"

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
	console.error("Pakai: node scripts/local-check.js <url> [url...]")
	process.exit(1)
}

const urls = []
for (const input of inputs) {
	const normalized = normalizeUrl(input)
	if (!normalized.ok) {
		console.error(`❌ ${input}: ${normalized.reason}`)
		continue
	}
	urls.push(normalized.url)
}

const results = await checkSites(urls)
for (const result of results) {
	console.log(
		`${result.online ? "🟢 ONLINE " : "🔴 OFFLINE"} ${result.url} | HTTP ${result.status ?? "-"} | ${result.responseTime} ms | ${result.error ?? "ok"}`,
	)
}
