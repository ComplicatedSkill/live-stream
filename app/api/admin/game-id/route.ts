import { NextResponse, NextRequest } from "next/server"
import { getState, setState } from "@/lib/state"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const gameId: string = body?.game_id ?? ""

  if (!gameId || !/^\d+$/.test(gameId)) {
    return NextResponse.json({ error: "game_id must be a numeric string" }, { status: 400 })
  }

  setState({ game_id: gameId })
  return NextResponse.json({ game_id: getState().game_id })
}
