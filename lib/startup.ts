import { startDetector } from "./detector"

declare global {
  // eslint-disable-next-line no-var
  var __detectorStarted: boolean | undefined
}

if (!global.__detectorStarted) {
  global.__detectorStarted = true
  startDetector().catch((err) =>
    console.error("[startup] Detector failed to start:", err)
  )
}
