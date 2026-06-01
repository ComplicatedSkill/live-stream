import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Sabong Live",
  description: "Sabong live stream and match results",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
