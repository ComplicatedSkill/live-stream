"use client"

import { useEffect, useState } from "react"

type GameStatus = "OPEN" | "CLOSED" | "WAITING" | "CANCELLED" | "UNKNOWN"

type MatchResult = {
  fight_no: string
  winner: string
  timestamp: string
}

type StatusData = {
  status: GameStatus
  fight_no: string
  winner: string | null
  meron_odds: string
  wala_odds: string
  last_updated: string
  history: MatchResult[]
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN:      "bg-green-600 text-white",
    CLOSED:    "bg-red-700 text-white",
    WAITING:   "bg-yellow-500 text-black",
    CANCELLED: "bg-gray-600 text-white",
    UNKNOWN:   "bg-gray-600 text-white",
  }
  const labels: Record<string, string> = {
    OPEN: "OPEN", CLOSED: "RESULT", WAITING: "WAITING", CANCELLED: "CANCELLED", UNKNOWN: "—",
  }
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${styles[status] ?? styles.UNKNOWN}`}>
      {labels[status] ?? status}
    </span>
  )
}

function ResultBanner({ winner }: { winner: string }) {
  if (winner.toLowerCase() === "cancel" || winner.toLowerCase() === "cancelled") {
    return (
      <div className="mt-3 rounded-lg py-4 text-center text-2xl font-black tracking-widest uppercase bg-gray-800 border-2 border-gray-500 text-gray-300">
        CANCELLED
      </div>
    )
  }
  const isMeron = winner.toLowerCase() === "meron"
  return (
    <div className={`winner-flash mt-3 rounded-lg py-4 text-center text-2xl font-black tracking-widest uppercase ${
      isMeron
        ? "bg-red-900 border-2 border-red-500 text-red-300"
        : "bg-blue-900 border-2 border-blue-500 text-blue-300"
    }`}>
      {winner} WIN
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch { return iso }
}

export default function StatusPanel() {
  const [data, setData] = useState<StatusData | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: StatusData = await res.json()
        if (!cancelled) {
          setData(json)
          setConnected(true)
        }
      } catch {
        if (!cancelled) setConnected(false)
      }
    }

    poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* Source indicator */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-gray-500"}`} />
        {connected ? "Live — reading from API" : "Connecting to API…"}
      </div>

      {/* Current match card */}
      <div className="rounded-xl p-5" style={{ background: "#111", border: "1px solid #222" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-gray-500 uppercase tracking-widest">Current Match</span>
          {data && <StatusBadge status={data.status} />}
        </div>

        <div className="text-center mb-2">
          <span className="text-5xl font-black text-yellow-400">
            {data?.fight_no ? `#${data.fight_no}` : "—"}
          </span>
          <p className="text-xs text-gray-500 mt-1">Fight Number</p>
        </div>

        {(data?.meron_odds || data?.wala_odds) && (
          <div className="flex justify-between mt-3 gap-2">
            <div className="flex-1 rounded-lg py-2 text-center bg-red-950 border border-red-800">
              <p className="text-xs text-red-400 font-semibold uppercase tracking-widest">Meron</p>
              <p className="text-xl font-black text-red-300">{data?.meron_odds || "—"}</p>
            </div>
            <div className="flex-1 rounded-lg py-2 text-center bg-blue-950 border border-blue-800">
              <p className="text-xs text-blue-400 font-semibold uppercase tracking-widest">Wala</p>
              <p className="text-xl font-black text-blue-300">{data?.wala_odds || "—"}</p>
            </div>
          </div>
        )}

        {data?.status === "OPEN" && (
          <div className="mt-3 rounded-lg py-3 text-center text-sm font-semibold bg-green-900 border border-green-700 text-green-300 tracking-widest">
            BETTING OPEN
          </div>
        )}
        {data?.status === "WAITING" && (
          <div className="mt-3 rounded-lg py-3 text-center text-sm font-semibold bg-yellow-900 border border-yellow-700 text-yellow-300 tracking-widest">
            MATCH IN PROGRESS
          </div>
        )}
        {(data?.status === "CLOSED" || data?.status === "CANCELLED") && data.winner && (
          <ResultBanner winner={data.winner} />
        )}
      </div>

      {/* Recent results */}
      <div className="rounded-xl p-4 flex-1 overflow-hidden flex flex-col" style={{ background: "#111", border: "1px solid #222" }}>
        <h3 className="text-xs text-gray-500 uppercase tracking-widest mb-3">Recent Results</h3>
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {!data?.history?.length && (
            <p className="text-xs text-gray-600 text-center pt-4">No results yet</p>
          )}
          {data?.history?.map((r, i) => {
            const isMeron = r.winner.toLowerCase() === "meron"
            return (
              <div key={`${r.fight_no}-${i}`}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                style={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }}
              >
                <span className="text-gray-400 font-mono text-xs">#{r.fight_no}</span>
                <span className={`font-bold text-xs px-2 py-0.5 rounded ${isMeron ? "bg-red-900 text-red-300" : "bg-blue-900 text-blue-300"}`}>
                  {r.winner.toUpperCase()}
                </span>
                <span className="text-gray-600 text-xs">{formatTime(r.timestamp)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-xl p-3 flex justify-around text-xs" style={{ background: "#111", border: "1px solid #222" }}>
        <span className="text-red-400 font-bold">RED = MERON</span>
        <span className="text-gray-500">|</span>
        <span className="text-blue-400 font-bold">BLUE = WALA</span>
      </div>
    </div>
  )
}
