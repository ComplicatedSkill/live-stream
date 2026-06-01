/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow server-side fetch to the upstream stream host
  async headers() {
    return [
      {
        source: "/api/stream",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ]
  },
}

export default nextConfig
