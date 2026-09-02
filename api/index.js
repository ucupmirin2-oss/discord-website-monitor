/**
 * Halaman status sederhana (public, TANPA secret apa pun).
 * Berguna untuk memastikan deployment berhasil.
 */
export default function handler(req, res) {
	res.status(200).json({
		name: "discord-website-monitor",
		status: "ok",
		endpoints: {
			interactions: "/api/interactions (POST, khusus Discord)",
			cron: "/api/cron (POST/GET, butuh Authorization: Bearer CRON_SECRET)",
		},
		note: "Tidak ada token atau secret yang diekspos di endpoint ini.",
	})
}
