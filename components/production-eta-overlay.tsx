"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Map as LeafletMap, Tooltip as LeafletTooltip } from "leaflet"
import type { LocationData } from "@/lib/types"
import { estimateProductionEta, type ProductionEta } from "@/lib/production-eta"

type GeoPoint = { lat: number; lng: number }
const STORAGE_KEY = "grislo-production-eta-visible"

function etaContent(result: ProductionEta): HTMLDivElement {
  const panel = document.createElement("div")
  panel.style.cssText = [
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
    "color:#0f172a", "text-align:center", "line-height:1.4", "white-space:normal",
    "min-width:178px", "width:210px", "max-width:calc(100vw - 64px)",
    "box-sizing:border-box", "padding:4px 2px",
  ].join(";")
  const line = (content: string, size: string, color: string, weight: string, margin = "0") => {
    const item = document.createElement("div")
    item.textContent = content // GPS / Firestore由来の値をHTMLとして解釈しない
    item.style.cssText = [
      `font-size:${size}`, `color:${color}`, `font-weight:${weight}`,
      `margin:${margin}`, "overflow-wrap:anywhere", "white-space:normal",
    ].join(";")
    panel.appendChild(item)
  }
  line("現在地付近への到着予想", "0.83rem", "#334155", "700", "0 0 5px")
  if (result.kind === "unavailable") {
    line("到着予想を確認中", "1.05rem", "#1d4ed8", "800")
    line(result.message, "0.77rem", "#475569", "500", "5px 0 0")
  } else {
    line(result.minutes === 0 ? "まもなく到着" : `あと約${result.minutes}分`,
      "1.45rem", "#1d4ed8", "800", "1px 0 3px")
    const predicted = new Date(result.arrivalAtMs)
    const timeLabel = predicted.toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    })
    line(`${timeLabel}頃に通過`, "0.9rem", "#0f172a", "700", "0 0 3px")
    if (result.nextLap) line("次の周回の予測です", "0.75rem", "#475569", "600")
    if (result.directionAssumed) line("ルートの順方向を仮定しています", "0.7rem", "#64748b", "500")
    if (result.usedDefaultSpeed) line("速度不足のため時速10kmで概算", "0.73rem", "#92400e", "600")
    line("※ GPSに基づく概算・時刻は変動します", "0.68rem", "#64748b", "500", "4px 0 0")
  }
  return panel
}

/**
 * 本番 / のみで使用。
 * - 循環ルート運行中のみON/OFFを表示。
 * - 設定は各利用者のlocalStorageに保存（Firestoreへ書き込まない）。
 * - ONなら青い現在地ピン上に常時Tooltipを表示。
 */
export function ProductionEtaOverlay(props: {
  map: LeafletMap | null
  userLocation: GeoPoint | null
  plannedRoute: [number, number][]
  locations: LocationData[]
  eligible: boolean
}) {
  const { map, userLocation, plannedRoute, locations, eligible } = props
  const [enabled, setEnabled] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const tooltipRef = useRef<LeafletTooltip | null>(null)
  const contentRef = useRef<ProductionEta>({ kind: "unavailable", message: "GPSを確認中です。" })
  const locationRef = useRef<GeoPoint | null>(null)

  useEffect(() => {
    try { setEnabled(window.localStorage.getItem(STORAGE_KEY) === "true") } catch { /* 保存不可はOFF */ }
  }, [])

  const showing = eligible && enabled
  useEffect(() => {
    if (!showing) return
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [showing])

  const eta = useMemo<ProductionEta>(() => {
    if (!showing) return { kind: "unavailable", message: "到着予想はOFFです。" }
    return estimateProductionEta({ route: plannedRoute, locations, userLocation, nowMs })
  }, [showing, plannedRoute, locations, userLocation, nowMs])
  contentRef.current = eta
  locationRef.current = userLocation

  const lat = userLocation?.lat ?? null
  const lng = userLocation?.lng ?? null
  const showTooltip = showing && lat !== null && lng !== null

  // Tooltipそのものは現在地・表示条件が変わったときだけ作成/削除する。
  useEffect(() => {
    if (!map || !showTooltip) {
      tooltipRef.current?.remove()
      tooltipRef.current = null
      return
    }
    let cancelled = false
    let tooltip: LeafletTooltip | null = null
    void import("leaflet").then(({ default: L }) => {
      if (cancelled) return
      tooltip = L.tooltip({
        permanent: true,
        direction: "top",
        interactive: false,
        opacity: 1,
        offset: L.point(0, -19),
        className: "grislo-production-eta-tooltip",
      })
      const point = locationRef.current
      if (!point) return
      tooltip.setLatLng([point.lat, point.lng])
      tooltip.setContent(etaContent(contentRef.current))
      tooltip.addTo(map)
      tooltipRef.current = tooltip
    }).catch((error: unknown) => console.error("[production-eta] 吹き出しの初期化に失敗", error))
    return () => {
      cancelled = true
      tooltip?.remove()
      if (tooltipRef.current === tooltip) tooltipRef.current = null
    }
  }, [map, showTooltip])

  // 端末のGPSが移動しても吹き出しを作り直さず追従する。
  useEffect(() => {
    if (tooltipRef.current && lat !== null && lng !== null) {
      tooltipRef.current.setLatLng([lat, lng])
    }
  }, [lat, lng])

  // GPS更新ではTooltipを作り直さず、内容だけを更新する。
  useEffect(() => {
    if (tooltipRef.current) tooltipRef.current.setContent(etaContent(eta))
  }, [eta])

  const updateEnabled = () => {
    const next = !enabled
    setEnabled(next)
    setNowMs(Date.now())
    try { window.localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* 保存できなくても使用可 */ }
  }

  if (!eligible) return null
  return (
    <div
      role="group"
      aria-label="到着予想時刻の表示設定"
      style={{
        position: "fixed", top: 86, right: 82, zIndex: 12000,
        width: "min(228px, calc(100vw - 100px))",
        display: "flex", flexDirection: "column", gap: 5,
        padding: "9px 11px", borderRadius: 12,
        border: "1px solid #cbd5e1", background: "rgba(255,255,255,0.97)",
        boxShadow: "0 3px 14px rgba(0,0,0,0.18)", boxSizing: "border-box",
      }}
    >
      <span style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0f172a" }}>
        到着予想時刻
      </span>
      <button
        type="button"
        onClick={updateEnabled}
        aria-pressed={enabled}
        aria-label={enabled ? "到着予想時刻を非表示にする" : "到着予想時刻を表示する"}
        style={{
          minHeight: 44, borderRadius: 8, cursor: "pointer", fontWeight: 800,
          border: enabled ? "2px solid #1d4ed8" : "1px solid #94a3b8",
          backgroundColor: enabled ? "#dbeafe" : "#f8fafc",
          color: "#0f172a", fontSize: "0.9rem",
        }}
      >
        {enabled ? "ON（表示中）" : "OFF（非表示）"}
      </button>
      {enabled && !userLocation && (
        <span role="status" style={{ fontSize: "0.73rem", color: "#92400e", lineHeight: 1.3 }}>
          現在地を取得できません。端末の位置情報を許可してください。
        </span>
      )}
    </div>
  )
}
