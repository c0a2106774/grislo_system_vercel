import type React from "react"
import type { Metadata, Viewport } from "next"
import "./globals.css"
import "leaflet/dist/leaflet.css"

export const metadata: Metadata = {
  title: "リアルタイム位置情報マップ",
  description: "車両の位置情報をリアルタイムで表示",
}

// モバイル端末での自動ズーム（特にiOSの入力フォーカス時）を防ぐためのviewport設定
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="antialiased h-full">{children}</body>
    </html>
  )
}
