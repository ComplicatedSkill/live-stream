import { config } from "./config"

export type GameStatus = "OPEN" | "CLOSED" | "WAITING" | "UNKNOWN"

export type MatchResult = {
  fight_no: string
  winner: "Meron" | "Wala" | "Draw" | "Cancelled"
  timestamp: string
}

export type GameState = {
  status: GameStatus
  fight_no: string
  message: string
  winner: string | null
  last_updated: string
  history: MatchResult[]
  is_logged_in: boolean
  game_id: string
  meron_odds: string
  wala_odds: string
}

const initialState: GameState = {
  status: "UNKNOWN",
  fight_no: "",
  message: "",
  winner: null,
  last_updated: new Date().toISOString(),
  history: [],
  is_logged_in: false,
  game_id: config.GAME_ID,
  meron_odds: "",
  wala_odds: "",
}

// Global singleton state shared across the server process
declare global {
  // eslint-disable-next-line no-var
  var __gameState: GameState | undefined
}

if (!global.__gameState) {
  global.__gameState = { ...initialState }
}

export function getState(): GameState {
  return global.__gameState!
}

export function setState(partial: Partial<GameState>): void {
  global.__gameState = { ...global.__gameState!, ...partial }
}

export function addHistory(result: MatchResult): void {
  const state = getState()
  const history = [result, ...state.history].slice(0, 20)
  setState({ history })
}
