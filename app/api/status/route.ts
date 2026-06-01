import { NextResponse } from "next/server"
import { getState } from "@/lib/state"

// Ensure detector starts exactly once in the server process
import "@/lib/startup"

export async function GET() {
  const state = getState()
  return NextResponse.json({
    status: state.status,
    fight_no: state.fight_no,
    message: state.message,
    winner: state.winner,
    last_updated: state.last_updated,
    is_logged_in: state.is_logged_in,
    game_id: state.game_id,
    meron_odds: state.meron_odds,
    wala_odds: state.wala_odds,
    history: state.history.slice(0, 10),
  })
}
