"use client"

import { useEffect, useRef, useState, useCallback } from "react"

const STREAM_URL = "https://8s.genesis01.live/hls100/stream1.m3u8"
const PROXY_URL = `/api/stream?url=${encodeURIComponent(STREAM_URL)}`

export default function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef   = useRef<import("hls.js").default | null>(null)

  const [paused,  setPaused]  = useState(false)
  const [muted,   setMuted]   = useState(true)
  const [volume,  setVolume]  = useState(1)
  const [isLive,  setIsLive]  = useState(true)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const retry = useCallback(() => {
    setError(null)
    setLoading(true)
    setPaused(false)
    setRetryKey((k) => k + 1)
  }, [])

  // ── HLS init / teardown ────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let destroyed = false

    async function init() {
      const { default: Hls } = await import("hls.js")

      if (destroyed || !video) return

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          // Live-stream tuning
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          maxBufferLength: 30,
          backBufferLength: 0,
          // Retry manifest/segment loads before giving up
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 1000,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 6,
        })
        hlsRef.current = hls

        hls.loadSource(PROXY_URL)
        hls.attachMedia(video as HTMLMediaElement)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (destroyed) return
          setLoading(false)
          setError(null)
          video!.play().catch(() => {})
        })

        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Network blip — try to resume
            console.warn("[hls] Network error, starting load recovery…")
            hls.startLoad()
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            // Codec / decode error — swap buffers
            console.warn("[hls] Media error, recovering…")
            hls.recoverMediaError()
          } else {
            // Unrecoverable
            console.error("[hls] Fatal unrecoverable error:", data)
            setError("Stream unavailable. The broadcast may have ended.")
            setLoading(false)
          }
        })

        // Show loading spinner while buffering
        video.addEventListener("waiting", () => setLoading(true))
        video.addEventListener("playing", () => { setLoading(false); setError(null) })
        video.addEventListener("canplay", () => setLoading(false))
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS
        video.src = PROXY_URL
        video.addEventListener("canplay", () => {
          setLoading(false)
          video!.play().catch(() => {})
        }, { once: true })
        video.addEventListener("error", () => {
          setError("Stream unavailable. The broadcast may have ended.")
          setLoading(false)
        }, { once: true })
      } else {
        setError("Your browser does not support HLS video playback.")
        setLoading(false)
      }
    }

    init().catch((e) => {
      console.error("[hls] Init failed:", e)
      setError("Failed to load the stream player.")
      setLoading(false)
    })

    return () => {
      destroyed = true
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey])

  // ── Live-edge tracking ─────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTimeUpdate = () => {
      if (!video.duration || !isFinite(video.duration)) { setIsLive(true); return }
      setIsLive(video.duration - video.currentTime < 5)
    }
    video.addEventListener("timeupdate", onTimeUpdate)
    return () => video.removeEventListener("timeupdate", onTimeUpdate)
  }, [])

  // ── Controls ───────────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { video.play().catch(() => {}); setPaused(false) }
    else              { video.pause();                 setPaused(true)  }
  }, [])

  const goLive = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (isFinite(video.duration)) video.currentTime = video.duration
    video.play().catch(() => {})
    setPaused(false)
    setIsLive(true)
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const next = !video.muted
    video.muted = next
    setMuted(next)
  }, [])

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const val = parseFloat(e.target.value)
    video.volume = val
    video.muted  = val === 0
    setVolume(val)
    setMuted(val === 0)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full rounded-lg overflow-hidden bg-black" style={{ paddingBottom: "56.25%" }}>

      {/* Video element */}
      <video
        ref={videoRef}
        muted
        playsInline
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: "contain" }}
      />

      {/* Loading spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-3">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <span className="text-xs text-gray-400 tracking-widest uppercase">Connecting…</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-4 px-6">
          <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-gray-300 text-center">{error}</p>
          <button
            onClick={retry}
            className="px-4 py-2 bg-white text-black text-sm font-semibold rounded hover:bg-gray-200 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Custom controls */}
      {!error && (
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent">

          {/* Play / Pause */}
          <button onClick={togglePause} className="text-white hover:text-gray-300 transition-colors" aria-label={paused ? "Play" : "Pause"}>
            {paused ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            )}
          </button>

          {/* Go to Live */}
          <button
            onClick={goLive}
            disabled={isLive && !paused}
            className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded transition-colors ${
              isLive && !paused
                ? "text-red-400 border border-red-400 cursor-default opacity-80"
                : "text-white border border-white hover:text-gray-300 hover:border-gray-300"
            }`}
            aria-label="Go to live"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isLive && !paused ? "bg-red-500 animate-pulse" : "bg-white"}`} />
            LIVE
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Mute toggle */}
          <button onClick={toggleMute} className="text-white hover:text-gray-300 transition-colors" aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            )}
          </button>

          {/* Volume slider */}
          <input
            type="range" min={0} max={1} step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolume}
            className="w-20 accent-white cursor-pointer"
            aria-label="Volume"
          />
        </div>
      )}
    </div>
  )
}
