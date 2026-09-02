/**
 * Verifikasi signature Ed25519 dari Discord (HTTP Interactions).
 * Discord mengirim header:
 *   X-Signature-Ed25519 : signature hex
 *   X-Signature-Timestamp : timestamp
 * Body mentah (raw) WAJIB dipakai, bukan hasil JSON.parse -> JSON.stringify.
 *
 * Implementasi memakai node:crypto (tanpa dependency tambahan) dengan
 * membungkus raw public key 32-byte ke dalam struktur DER SPKI.
 */
import { createPublicKey, verify as cryptoVerify, timingSafeEqual } from "node:crypto"

// Prefix DER SPKI untuk Ed25519 (RFC 8410).
const ED25519_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function toKeyObject(publicKeyHex) {
	const raw = Buffer.from(publicKeyHex, "hex")
	if (raw.length !== 32) throw new Error("DISCORD_PUBLIC_KEY tidak valid (harus 32 byte hex).")
	return createPublicKey({
		key: Buffer.concat([ED25519_DER_PREFIX, raw]),
		format: "der",
		type: "spki",
	})
}

/**
 * @param {string|Buffer} rawBody Body mentah request.
 * @param {string} signature Header X-Signature-Ed25519.
 * @param {string} timestamp Header X-Signature-Timestamp.
 * @param {string} publicKeyHex DISCORD_PUBLIC_KEY.
 * @returns {boolean}
 */
export function verifyDiscordRequest(rawBody, signature, timestamp, publicKeyHex) {
	if (!signature || !timestamp || !publicKeyHex) return false
	try {
		const message = Buffer.concat([
			Buffer.from(String(timestamp), "utf8"),
			Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8"),
		])
		const sig = Buffer.from(signature, "hex")
		if (sig.length !== 64) return false
		return cryptoVerify(null, message, toKeyObject(publicKeyHex), sig)
	} catch {
		return false
	}
}

/** Perbandingan string aman terhadap timing attack (untuk CRON_SECRET). */
export function safeEqual(a, b) {
	const bufA = Buffer.from(String(a ?? ""))
	const bufB = Buffer.from(String(b ?? ""))
	if (bufA.length !== bufB.length || bufA.length === 0) return false
	return timingSafeEqual(bufA, bufB)
}

/** Baca raw body dari request Node (bodyParser dimatikan di endpoint interactions). */
export async function readRawBody(req) {
	if (req.body && Buffer.isBuffer(req.body)) return req.body
	if (typeof req.body === "string") return Buffer.from(req.body, "utf8")

	const chunks = []
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
	}
	if (chunks.length > 0) return Buffer.concat(chunks)

	// Fallback terakhir: body sudah diparse runtime (signature bisa gagal jika key order berubah).
	if (req.body && typeof req.body === "object") {
		return Buffer.from(JSON.stringify(req.body), "utf8")
	}
	return Buffer.alloc(0)
}
