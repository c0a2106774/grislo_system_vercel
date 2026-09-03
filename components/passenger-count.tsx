"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

const DEFAULT_API_URL =
  "https://script.google.com/macros/s/AKfycbwThG3VL9uOp66B0GWPZ7Atfx94kum0otelGilFWFx6_WnYct_48I2EjqkiS961XFbT/exec"
const MAX_SEATS = 5
/** タブ／ウィンドウを閉じたあと次回起動時に 0 から始め、API の古い「最終値」を一度だけ無視する */
const CLOSED_FLAG_KEY = "passenger_count_app_closed"

function ChairIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 70 70" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width={size} height={size}>
      <path d="M25 45 L40 45" stroke="#68707F" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M40 45 L47 15" stroke="#68707F" strokeWidth="6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function PersonIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 70 70" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width={size} height={size}>
      <circle cx="45" cy="8" r="8" fill="#68707F" />
      <path d="M42 23 L37 43" stroke="#68707F" strokeWidth="12" strokeLinecap="round" fill="none" />
      <path d="M37 45 L22 45" stroke="#68707F" strokeWidth="8" strokeLinecap="round" fill="none" />
      <path d="M22 45 L22 65" stroke="#68707F" strokeWidth="8" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function PassengerCount() {
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const skipFirstApiValueRef = useRef(false)
  const [overrideCount, setOverrideCount] = useState<number | null>(() => {
    const envValue = process.env.NEXT_PUBLIC_PASSENGER_COUNT_OVERRIDE
    if (!envValue) return null
    const parsed = Number(envValue)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null
  })
  const [isMobile, setIsMobile] = useState(false)
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_PASSENGER_COUNT_API ?? DEFAULT_API_URL, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const debugParam = params.get("debugCount")
    if (debugParam !== null) {
      const parsed = Number(debugParam)
      if (Number.isFinite(parsed)) {
        skipFirstApiValueRef.current = false
        setOverrideCount(Math.max(0, parsed))
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const markClosed = () => {
      try {
        localStorage.setItem(CLOSED_FLAG_KEY, "1")
      } catch {
        // ignore
      }
    }
    window.addEventListener("pagehide", markClosed)
    window.addEventListener("beforeunload", markClosed)
    return () => {
      window.removeEventListener("pagehide", markClosed)
      window.removeEventListener("beforeunload", markClosed)
    }
  }, [])

  useLayoutEffect(() => {
    if (typeof window === "undefined") return
    try {
      if (localStorage.getItem(CLOSED_FLAG_KEY) === "1") {
        localStorage.removeItem(CLOSED_FLAG_KEY)
        skipFirstApiValueRef.current = true
        setCount(0)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const matcher = window.matchMedia("(max-width: 640px)")
    const handler = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches)
    }
    handler(matcher)
    matcher.addEventListener("change", handler)
    return () => matcher.removeEventListener("change", handler as (event: MediaQueryListEvent) => void)
  }, [])

  useEffect(() => {
    if (overrideCount !== null) {
      skipFirstApiValueRef.current = false
      setCount(overrideCount)
      setError(null)
      return
    }

    let isMounted = true

    async function fetchCount() {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒でタイムアウト
        
        const res = await fetch(`${apiUrl}?mode=last&t=${Date.now()}`, {
          signal: controller.signal,
          mode: "cors",
          cache: "no-cache",
        })
        
        clearTimeout(timeoutId)
        
        if (!res.ok) {
          throw new Error(`API responded with ${res.status}`)
        }
        const data = await res.json()
        const raw = Number(data?.count) - 2
        const sanitized = Number.isFinite(raw) ? Math.max(0, raw) : 0
        if (isMounted) {
          if (!skipFirstApiValueRef.current) {
            setCount(sanitized)
          }
          setError(null)
        }
      } catch (err) {
        // エラーをログに記録するが、ユーザーには表示しない
        // 次回の取得（5秒後）で成功する可能性があるため
        if (err instanceof Error) {
          if (err.name === "AbortError") {
            console.warn("[v0] Passenger count fetch timeout")
          } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
            console.warn("[v0] Passenger count fetch failed (network error) - will retry")
          } else {
            console.error("[v0] Failed to fetch passenger count:", err.message)
          }
        } else {
          console.error("[v0] Failed to fetch passenger count:", err)
        }
        // エラーが発生しても既存のカウントを保持
        // 初回取得失敗時は count が null のままなので、"取得中..." が表示される
      } finally {
        if (isMounted && skipFirstApiValueRef.current) {
          skipFirstApiValueRef.current = false
        }
      }
    }

    fetchCount()
    const timer = setInterval(fetchCount, 60000) // 1分ごとにアクセス（スプレッドシートの更新頻度に合わせる）

    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [apiUrl, overrideCount])

  const iconSize = isMobile ? 28 : 48

  const seatSlots = useMemo(() => {
    const active = Math.min(Math.max(count ?? 0, 0), MAX_SEATS)
    return Array.from({ length: MAX_SEATS }).map((_, index) => {
      const filled = index < active
      return (
        <div
          key={index}
          style={{
            position: "relative",
            width: iconSize,
            height: iconSize,
          }}
        >
          <div style={{ opacity: 0.9 }}>
            <ChairIcon size={iconSize} />
          </div>
          {filled && (
            <div style={{ position: "absolute", top: -5, left: -4 }}>
              <PersonIcon size={iconSize} />
            </div>
          )}
        </div>
      )
    })
  }, [count, iconSize])

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.95)",
        borderRadius: "16px",
        boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
        padding: isMobile ? "8px 12px" : "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: isMobile ? "8px" : "12px",
        minWidth: isMobile ? "140px" : "220px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px" }}>
        <svg
          width={isMobile ? 18 : 24}
          height={isMobile ? 18 : 24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#364153"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <div>
          <div style={{ fontSize: isMobile ? "10px" : "12px", color: "#4B5563" }}>現在の混雑状況</div>
          <div style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: "bold", color: "#111827" }}>
            {error ? error : count === null ? "取得中..." : `${count}人`}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: isMobile ? "2px" : "4px" }}>{seatSlots}</div>
    </div>
  )
}
