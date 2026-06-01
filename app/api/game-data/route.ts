import { NextResponse, NextRequest } from "next/server"
import { getState, setState, addHistory, type MatchResult } from "@/lib/state"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })

  const { fight_no, meron_odds, wala_odds, winner } = body as {
    fight_no: string
    meron_odds: string
    wala_odds: string
    winner: "Meron" | "Wala" | null
  }

  const prev = getState()
  const now  = new Date().toISOString()

  // Winner overlay detected → match is closed
  if (winner) {
    // Only record history once per fight result (avoid duplicates)
    const alreadyRecorded =
      prev.winner === winner && prev.fight_no === (fight_no || prev.fight_no)

    if (!alreadyRecorded) {
      const result: MatchResult = {
        fight_no: fight_no || prev.fight_no,
        winner,
        timestamp: now,
      }
      addHistory(result)
      console.log(`[game-data] Result recorded: Fight #${result.fight_no} — ${winner} WIN`)
    }

    setState({
      status: "CLOSED",
      winner,
      ...(fight_no && { fight_no }),
      meron_odds: "",
      wala_odds: "",
      last_updated: now,
    })

    return NextResponse.json({ ok: true, status: "CLOSED", winner })
  }

  // No winner overlay — infer status from what's visible
  let status = prev.status

  if (meron_odds && wala_odds && fight_no) {
    // All three visible → betting is open
    status = "OPEN"
    // If this is a new fight after a previous result, clear the old winner
    if (fight_no !== prev.fight_no) {
      setState({ winner: null, fight_no, meron_odds, wala_odds, status, last_updated: now })
      return NextResponse.json({ ok: true, status, fight_no })
    }
  } else if (fight_no && (!meron_odds || !wala_odds)) {
    // Fight visible but odds gone → fight in progress
    status = "WAITING"
  }

  setState({
    ...(fight_no   && { fight_no }),
    ...(meron_odds && { meron_odds }),
    ...(wala_odds  && { wala_odds }),
    status,
    last_updated: now,
  })

  return NextResponse.json({ ok: true, fight_no, meron_odds, wala_odds, status })
}
