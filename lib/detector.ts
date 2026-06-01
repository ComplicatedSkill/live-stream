import axios from "axios"
import { config } from "./config"
import { getState, setState, addHistory, type MatchResult } from "./state"

let sessionCookie = ""
let pollingInterval: ReturnType<typeof setInterval> | null = null
let lastFightNo = ""
let lastStatus = ""
let pollCount = 0
let consecutiveNotFound = 0
let trackedGameId = ""

function buildApiUrl(gameId: string): string {
  return `https://wc181.live/play/game_status.php?cur_game_id=${gameId}`
}

function ts(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false })
}

function log(msg: string) {
  console.log(`[${ts()}] [DETECTOR] ${msg}`)
}

function warn(msg: string) {
  console.warn(`[${ts()}] [DETECTOR] ⚠️  ${msg}`)
}

function err(msg: string) {
  console.error(`[${ts()}] [DETECTOR] ❌ ${msg}`)
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

async function login(): Promise<boolean> {
  log(`🔐 Attempting login as "${config.USERNAME}" → ${config.LOGIN_URL}`)

  try {
    const params = new URLSearchParams()
    params.append("username", config.USERNAME)
    params.append("password", config.PASSWORD)

    const res = await axios.post(config.LOGIN_URL, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://wc181.live/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
      maxRedirects: 0,
      validateStatus: () => true,
    })

    log(`   HTTP ${res.status} — checking for PHPSESSID cookie...`)

    const cookies: string[] = []
    const rawCookies = res.headers["set-cookie"]
    if (rawCookies) {
      for (const c of rawCookies) {
        const match = c.match(/PHPSESSID=([^;]+)/)
        if (match) {
          cookies.push(`PHPSESSID=${match[1]}`)
          log(`   Got session cookie: PHPSESSID=${match[1].slice(0, 8)}...`)
        }
      }
    }

    if (cookies.length > 0) {
      sessionCookie = cookies.join("; ")
      setState({ is_logged_in: true })
      log(`✅ Login successful — session established`)
      return true
    }

    // JSON success response (no set-cookie header)
    if (res.data?.success) {
      setState({ is_logged_in: true })
      log(`✅ Login successful (JSON response)`)
      return true
    }

    warn(`Login failed — no session cookie in response`)
    warn(`   Response body preview: ${String(res.data).slice(0, 120)}`)
    setState({ is_logged_in: false })
    return false
  } catch (e: unknown) {
    err(`Login threw an exception: ${(e as Error).message}`)
    setState({ is_logged_in: false })
    return false
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isHtml(data: unknown): boolean {
  if (typeof data === "string") return data.trim().startsWith("<")
  return false
}

async function forwardToExternalApi(
  event: "match_start" | "match_end",
  payload: Record<string, string>
): Promise<void> {
  if (!config.SEND_TO_API) {
    log(`   (SEND_TO_API=false — skipping forward of "${event}")`)
    return
  }

  const url =
    event === "match_start" ? config.EXTERNAL_API_START : config.EXTERNAL_API_END

  log(`📡 Forwarding "${event}" to external API → ${url}`)
  log(`   Payload: ${JSON.stringify(payload)}`)

  try {
    const res = await axios.post(url, payload, { timeout: 5000 })
    log(`   External API responded HTTP ${res.status}`)
  } catch (e: unknown) {
    err(`Failed to forward "${event}": ${(e as Error).message}`)
  }
}

// ─── POLL ─────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  pollCount++
  const tick = `[poll #${pollCount}]`

  try {
    const gameId = getState().game_id

    // Reset tracking when game ID changes (admin update or auto-increment)
    if (trackedGameId !== gameId) {
      log(`Game ID changed: ${trackedGameId || "(init)"} → ${gameId} — resetting tracking`)
      trackedGameId = gameId
      lastFightNo = ""
      lastStatus = ""
      consecutiveNotFound = 0
    }

    const apiUrl = buildApiUrl(gameId)
    log(`${tick} Fetching game status → ${apiUrl}`)

    const res = await axios.get(apiUrl, {
      headers: {
        Cookie: sessionCookie,
        Referer: "https://wc181.live/play/main.php",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
      responseType: "text",
      timeout: 8000,
      validateStatus: () => true,
    })

    const body = res.data as string
    log(`${tick} HTTP ${res.status} — body length: ${body.length} chars`)

    // ── Session expired ──
    if (isHtml(body)) {
      warn(`${tick} Response is HTML — session expired!`)
      warn(`   Body preview: ${body.trim().slice(0, 80)}`)
      setState({ is_logged_in: false })

      log(`${tick} Re-logging in...`)
      const ok = await login()
      if (!ok) {
        err(`${tick} Re-login failed — will retry on next poll`)
        return
      }
      log(`${tick} Re-login succeeded — retrying poll immediately`)
      return poll()
    }

    // ── Parse JSON lines ──
    const lines = body.trim().split("\n").filter(Boolean)
    log(`${tick} Raw response lines (${lines.length}):`)
    lines.forEach((l, i) => log(`   [${i}] ${l}`))

    let parsed: { game_status: string; fight_no: string; message: string } | null = null
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        parsed = JSON.parse(lines[i])
        log(`${tick} Using line [${i}]: ${lines[i]}`)
        break
      } catch {
        warn(`${tick} Line [${i}] is not valid JSON — skipping`)
      }
    }

    if (!parsed) {
      consecutiveNotFound++
      warn(`${tick} No parseable JSON found in response (${consecutiveNotFound}/3)`)
      if (consecutiveNotFound >= 3) {
        const currentId = getState().game_id
        const nextId = String(parseInt(currentId, 10) + 1)
        warn(`${tick} Game ID ${currentId} appears not found — auto-advancing to ${nextId}`)
        setState({ game_id: nextId })
        consecutiveNotFound = 0
      }
      return
    }

    consecutiveNotFound = 0

    const { game_status, fight_no, message } = parsed
    const now = new Date().toISOString()

    log(`${tick} Parsed → game_status="${game_status}" fight_no="${fight_no}" message="${message}"`)

    // ── Map to display status ──
    let displayStatus: "OPEN" | "CLOSED" | "WAITING" = "WAITING"
    let winner: string | null = null

    if (game_status === "OPEN") {
      displayStatus = "OPEN"
    } else if (game_status === "CLOSED") {
      if (message === "CLOSED") {
        displayStatus = "WAITING"
        log(`${tick} Status: CLOSED (waiting for result)`)
      } else {
        displayStatus = "CLOSED"
        winner = message
        log(`${tick} Status: CLOSED — winner declared: "${winner}"`)
      }
    }

    setState({ status: displayStatus, fight_no, message, winner, last_updated: now })
    log(`${tick} State updated → status=${displayStatus} fight_no=${fight_no} winner=${winner ?? "none"}`)

    // ── Event: new fight started ──
    if (game_status === "OPEN" && fight_no !== lastFightNo) {
      console.log("")
      log(`🥊 ============================================`)
      log(`🥊  MATCH START  —  Fight #${fight_no}`)
      log(`🥊 ============================================`)
      console.log("")

      lastFightNo = fight_no
      lastStatus = game_status

      await forwardToExternalApi("match_start", {
        event: "match_start",
        fight_no,
        timestamp: now,
      })
    }

    // ── Event: fight ended with result ──
    if (
      game_status === "CLOSED" &&
      message !== "CLOSED" &&
      (lastStatus === "OPEN" || lastStatus === "CLOSED_WAITING") &&
      fight_no === lastFightNo
    ) {
      const side = message.toUpperCase()
      const bar = side === "MERON" ? "🔴" : "🔵"

      console.log("")
      log(`${bar} ============================================`)
      log(`${bar}  MATCH END  —  Fight #${fight_no}`)
      log(`${bar}  WINNER: ${side}`)
      log(`${bar} ============================================`)
      console.log("")

      const result: MatchResult = {
        fight_no,
        winner: message as MatchResult["winner"],
        timestamp: now,
      }
      addHistory(result)
      log(`${tick} History updated — total entries: ${getState().history.length}`)

      lastStatus = "CLOSED_RESULT"

      await forwardToExternalApi("match_end", {
        event: "match_end",
        fight_no,
        winner: message,
        timestamp: now,
      })
    } else if (game_status === "CLOSED" && message === "CLOSED") {
      if (lastStatus === "OPEN") {
        log(`${tick} Transitioning lastStatus: OPEN → CLOSED_WAITING`)
        lastStatus = "CLOSED_WAITING"
      }
    } else if (game_status === "OPEN") {
      lastStatus = "OPEN"
    }
  } catch (e: unknown) {
    err(`${tick} Poll threw an exception: ${(e as Error).message}`)
  }
}

// ─── START / STOP ─────────────────────────────────────────────────────────────

export async function startDetector(): Promise<void> {
  if (pollingInterval) {
    warn("startDetector() called but detector is already running — ignoring")
    return
  }

  console.log("")
  log("================================================")
  log("  Sabong Live Detector — Starting")
  log(`  Game ID : ${getState().game_id}`)
  log(`  Poll    : every ${config.POLL_EVERY}ms`)
  log(`  API URL : ${buildApiUrl(getState().game_id)}`)
  log(`  Send    : ${config.SEND_TO_API ? "ENABLED" : "disabled"}`)
  log("================================================")
  console.log("")

  const ok = await login()
  if (!ok) {
    err("Initial login failed — detector will retry login on each poll interval")
  }

  pollingInterval = setInterval(async () => {
    if (!getState().is_logged_in) {
      warn("Not logged in — attempting re-login before next poll")
      await login()
      return
    }
    await poll()
  }, config.POLL_EVERY)

  if (ok) {
    log("Running first poll immediately...")
    await poll()
  }

  log(`✅ Detector running — polling every ${config.POLL_EVERY}ms`)
}

export function stopDetector(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
    log("🛑 Detector stopped")
  }
}
