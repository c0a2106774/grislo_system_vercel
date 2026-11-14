"use client"

import { useEffect, useRef } from "react"
import type { Map as LeafletMap, Tooltip as LeafletTooltip } from "leaflet"
import {
  formatSimulationArrivalTime,
  type RouteEtaResult,
} from "@/lib/simulation-eta"

type GeoPoint = { lat: number; lng: number }

type EtaTooltipOptions = {
  map: LeafletMap | null
  userLocation: GeoPoint | null
  etaResult: RouteEtaResult
  selectedRouteId: string
  plannedRoutePointCount: number
  routeError: string
  status: string
  stale: boolean
  gpsPointCount: number
  sourceTimestamp: string | null
}

// テキストの挿入には必ずtextContentを使う（Firestore由来の文字列をHTMLにしない）。
function createTooltipContent(options: EtaTooltipOptions): HTMLDivElement {
  const panel = document.createElement("div")
  panel.style.cssText = [
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
    "color:#0f172a",
    "text-align:center",
    "line-height:1.4",
    "white-space:normal",
    "width:210px",
    "max-width:calc(100vw - 70px)",
    "box-sizing:border-box",
    "padding:3px 2px",
  ].join(";")

  const addLine = (value: string, size: string, color: string, weight = "500", margin = "0"): void => {
    const line = document.createElement("div")
    line.textContent = value
    line.style.cssText = [
      `font-size:${size}`,
      `color:${color}`,
      `font-weight:${weight}`,
      `margin:${margin}`,
      "overflow-wrap:anywhere",
      "white-space:normal",
    ].join(";")
    panel.appendChild(line)
  }

  addLine("現在地への到着予想", "0.83rem", "#334155", "700", "0 0 5px 0")

  const {
    selectedRouteId, plannedRoutePointCount, routeError,
    status, stale, gpsPointCount, etaResult, sourceTimestamp,
  } = options

  if (!selectedRouteId) {
    addLine("循環ルート未選択", "1.05rem", "#1d4ed8", "800")
    addLine("GPS再生画面でルートを選択してください", "0.76rem", "#475569", "500", "5px 0 0")
  } else if (plannedRoutePointCount < 2) {
    addLine("ルートを確認中", "1.05rem", "#1d4ed8", "800")
    addLine(routeError || "保存されたルートを読み込んでいます", "0.76rem", "#475569", "500", "5px 0 0")
  } else if (status === "stopped" || status === "completed" || gpsPointCount === 0) {
    addLine("GPS再生待ち", "1.1rem", "#1d4ed8", "800")
    addLine("グリスロが走り始めると自動表示します", "0.78rem", "#475569", "500", "5px 0 0")
  } else if (stale) {
    addLine("GPS更新待ち", "1.1rem", "#1d4ed8", "800")
    addLine("位置情報が更新されると再計算します", "0.78rem", "#475569", "500", "5px 0 0")
  } else if (etaResult.kind === "unavailable") {
    addLine("到着予想を計算中", "1.04rem", "#1d4ed8", "800")
    addLine(etaResult.message, "0.78rem", "#475569", "500", "5px 0 0")
  } else {
    addLine(
      etaResult.minutes === 0 ? "まもなく到着" : `あと約${etaResult.minutes}分`,
      "1.45rem", "#1d4ed8", "800", "1px 0 3px 0",
    )
    const arrival = formatSimulationArrivalTime(sourceTimestamp, etaResult.seconds)
    if (arrival) {
      addLine(`${arrival}頃に通過（再生上の時刻）`, "0.86rem", "#0f172a", "700", "0 0 3px 0")
    }
    if (status === "paused") {
      addLine("再生一時停止中", "0.73rem", "#64748b", "600", "3px 0 0")
    }
    if (etaResult.nextLap) {
      addLine("次の周回の予測です", "0.74rem", "#475569", "600", "3px 0 0")
    }
    if (etaResult.offsetMeters > 120) {
      addLine(
        `ルートまで約${etaResult.offsetMeters}m：最寄りの通過地点を予測`,
        "0.73rem", "#a16207", "600", "4px 0 0",
      )
    }
    if (etaResult.speedIsFallback) {
      addLine("速度不足のため時速10kmで概算", "0.72rem", "#64748b", "500", "4px 0 0")
    }
    addLine("※ GPSとルートからの概算です", "0.68rem", "#64748b", "400", "4px 0 0")
  }

  return panel
}

/**
 * 青い現在地ピンの上に、クリック不要・常時表示のLeaflet Tooltipを重ねる。
 * - 現在地ピンが作成されれば、GPS未再生でも「GPS再生待ち」を表示する。
 * - GPS受信やルート変更に伴って既存Tooltipの内容だけを更新する。
 * - ルート外の車両は計算待ち。ルート内に入れば自動的に予想を表示する。
 * - rem指定により既存の「普通／大きい」文字サイズ設定にも追従する。
 */
export function useSimulationEtaTooltip(options: EtaTooltipOptions): void {
  const tooltipRef = useRef<{ map: LeafletMap; tooltip: LeafletTooltip } | null>(null)

  const {
    map, userLocation, etaResult, selectedRouteId, plannedRoutePointCount,
    routeError, status, stale, gpsPointCount, sourceTimestamp,
  } = options
  const lat = userLocation?.lat ?? null
  const lng = userLocation?.lng ?? null

  useEffect(() => {
    if (!map || lat === null || lng === null) {
      tooltipRef.current?.tooltip.remove()
      tooltipRef.current = null
      return
    }

    let cancelled = false
    const content = createTooltipContent({
      map, userLocation: { lat, lng }, etaResult, selectedRouteId,
      plannedRoutePointCount, routeError, status, stale, gpsPointCount,
      sourceTimestamp,
    })

    void import("leaflet").then((module) => {
      if (cancelled) return
      const L = module.default
      const previous = tooltipRef.current
      if (previous && previous.map !== map) {
        previous.tooltip.remove()
        tooltipRef.current = null
      }
      const tooltip = tooltipRef.current?.tooltip ?? L.tooltip({
        permanent: true,
        direction: "top",
        interactive: false,
        opacity: 1,
        offset: L.point(0, -19),
        className: "grislo-simulation-eta-tooltip",
      })
      tooltip.setLatLng([lat, lng])
      tooltip.setContent(content)
      if (!map.hasLayer(tooltip)) tooltip.addTo(map)
      tooltipRef.current = { map, tooltip }
    }).catch((error: unknown) => {
      console.error("[simulation-eta] 到着予想吹き出しの描画に失敗:", error)
    })

    return () => { cancelled = true }
  }, [map, lat, lng, etaResult, selectedRouteId, plannedRoutePointCount, routeError,
      status, stale, gpsPointCount, sourceTimestamp])

  // 地図の差し替え・画面離脱時に古いTooltipが残らないよう除去する。
  useEffect(() => {
    return () => {
      tooltipRef.current?.tooltip.remove()
      tooltipRef.current = null
    }
  }, [map])
}
