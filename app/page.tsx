import VideoPlayer from "./components/VideoPlayer"
import StatusPanel from "./components/StatusPanel"

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a" }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid #1a1a1a" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl font-black tracking-widest text-yellow-400 uppercase">
            Sabong Live
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="live-dot" />
          <span className="uppercase tracking-widest text-xs text-red-400 font-semibold">
            Live
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 lg:p-6">
        {/* Video player — left (wider) */}
        <div className="w-full lg:w-[62%]">
          <VideoPlayer />
        </div>

        {/* Status panel — right */}
        <div className="w-full lg:w-[38%] lg:max-h-[calc(100vh-130px)]">
          <StatusPanel />
        </div>
      </main>

      <footer className="text-center text-xs text-gray-700 py-3">
        Sabong Live Monitor
      </footer>
    </div>
  )
}
