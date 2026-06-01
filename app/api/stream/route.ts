import { NextRequest, NextResponse } from "next/server"

const STREAM_REFERER = "https://genesis02.site/"
const STREAM_ORIGIN = "https://genesis02.site"
const STREAM_BASE = "https://8s.genesis01.live"

// Allowed host to prevent open-proxy abuse
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === "8s.genesis01.live"
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const target = searchParams.get("url")

  if (!target) {
    return new NextResponse("Missing url param", { status: 400 })
  }

  const decodedUrl = decodeURIComponent(target)
  if (!isAllowedUrl(decodedUrl)) {
    return new NextResponse("Forbidden", { status: 403 })
  }

  try {
    const upstream = await fetch(decodedUrl, {
      headers: {
        Referer: STREAM_REFERER,
        Origin: STREAM_ORIGIN,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    })

    if (!upstream.ok) {
      return new NextResponse(`Upstream error ${upstream.status}`, {
        status: upstream.status,
      })
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream"
    const isM3u8 = decodedUrl.endsWith(".m3u8") || contentType.includes("mpegurl")

    if (isM3u8) {
      // Rewrite segment URLs so they also go through this proxy
      const text = await upstream.text()
      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith("#")) return line

          let absoluteUrl: string
          if (trimmed.startsWith("http")) {
            absoluteUrl = trimmed
          } else if (trimmed.startsWith("/")) {
            absoluteUrl = `${STREAM_BASE}${trimmed}`
          } else {
            const base = decodedUrl.substring(0, decodedUrl.lastIndexOf("/") + 1)
            absoluteUrl = `${base}${trimmed}`
          }

          return `/api/stream?url=${encodeURIComponent(absoluteUrl)}`
        })
        .join("\n")

      return new NextResponse(rewritten, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      })
    }

    // TS segment — stream binary
    const buffer = await upstream.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "max-age=10",
      },
    })
  } catch (err: unknown) {
    console.error("[stream proxy] Error:", (err as Error).message)
    return new NextResponse("Proxy error", { status: 502 })
  }
}
