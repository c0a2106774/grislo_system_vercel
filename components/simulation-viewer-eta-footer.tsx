"use client"

import { useEffect, useRef, useState } from "react"
import {
  formatSimulationArrivalTime,
  type RouteEtaResult,
} from "@/lib/simulation-eta"

const STORAGE_KEY = "grislo-simulation-footer-eta-enabled"

interface SimulationViewerEtaFooterProps {
  selectedRouteId: string
  routeName: string
  routeError: string
  plannedRoutePointCount: number
  timetableStopsCount: number
  userLocationSet: boolean
  etaResult: RouteEtaResult
  status: string
  stale: boolean
  gpsPointCount: number
  sourceTimestamp: string | null
  onHeightChange: (height: number) => void
}

type EtaDisplay = {
  primary: string
  arrival?: string
  notes: string[]
  estimated: boolean
}

function buildEtaDisplay(props: SimulationViewerEtaFooterProps): EtaDisplay {
  const { userLocationSet, status, stale, gpsPointCount, etaResult, sourceTimestamp } = props

  if (!userLocationSet) {
    return { primary: "現在地を設定してください", notes: ["「操作」から地図上に現在地を指定できます"], estimated: false }
  }
  if (status === "stopped" || status === "completed" || gpsPointCount === 0) {
    return { primary: "GPS再生待ち", notes: ["グリスロが走り始めると自動で更新します"], estimated: false }
  }
  if (stale) {
    return { primary: "GPS更新待ち", notes: ["GPSの更新後に予測を再計算します"], estimated: false }
  }
  if (etaResult.kind === "unavailable") {
    return { primary: "到着予想を計算中", notes: [etaResult.message], estimated: false }
  }

  const arrival = formatSimulationArrivalTime(sourceTimestamp, etaResult.seconds)
  const notes: string[] = []
  if (status === "paused") notes.push("再生一時停止中")
  if (etaResult.nextLap) notes.push("次の周回の予測")
  if (etaResult.offsetMeters > 120) {
    notes.push(`ルートまで約${etaResult.offsetMeters}m：最寄りの通過地点までの予測`)
  }
  if (etaResult.speedIsFallback) notes.push("速度不足のため時速10kmで概算")
  notes.push("GPSと保存ルートから計算した概算です")
  return {
    primary: etaResult.minutes === 0 ? "まもなく到着" : `あと約${etaResult.minutes}分`,
    arrival: arrival ? `${arrival}頃に通過（再生上の時刻）` : undefined,
    notes,
    estimated: true,
  }
}

/**
 * シミュレーター一般画面だけで使用するフッター。
 * 本番用の混雑表示やETA設定、Firestoreの保存形式には触れない。
 */
export function SimulationViewerEtaFooter(props: SimulationViewerEtaFooterProps) {
  const [enabled, setEnabled] = useState(true) // 既存のシミュレーターでは常時表示だったため、初期値はON
  const footerRef = useRef<HTMLElement | null>(null)
  const routeReady = Boolean(props.selectedRouteId) && props.plannedRoutePointCount >= 2
  const display = routeReady ? buildEtaDisplay(props) : null

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved === "true" || saved === "false") setEnabled(saved === "true")
    } catch { /* プライベートブラウズでは保存されない場合がある */ }
  }, [])

  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const report = () => props.onHeightChange(Math.ceil(el.getBoundingClientRect().height))
    report()
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(report) : null
    observer?.observe(el)
    window.addEventListener("resize", report)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", report)
    }
  }, [props.onHeightChange])

  const toggleEta = () => {
    const next = !enabled
    setEnabled(next)
    try { window.localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* 保存不可でも切替可能 */ }
  }

  return (
    <footer ref={footerRef} className="grislo-sim-view-footer" aria-label="循環ルートと到着予想時刻">
      <div className="grislo-sim-view-route-summary">
        <div className="grislo-sim-view-route-heading">循環ルート（シミュレーション）</div>
        <div className="grislo-sim-view-route-name">
          {props.selectedRouteId
            ? (props.routeName || (props.routeError ? "ルートを確認してください" : "ルート読み込み中…"))
            : "ルート未選択"}
        </div>
        {props.timetableStopsCount > 0 && (
          <div className="grislo-sim-view-route-meta">時刻表ピン：{props.timetableStopsCount}件</div>
        )}
      </div>

      {routeReady ? (
        <div className="grislo-sim-view-eta-section">
          <div className="grislo-sim-view-eta-heading">
            <strong>到着予想時刻</strong>
            <button
              type="button"
              className="grislo-sim-view-eta-toggle"
              aria-label={enabled ? "到着予想時刻をOFFにする" : "到着予想時刻をONにする"}
              aria-pressed={enabled}
              onClick={toggleEta}
            >
              {enabled ? "ON（表示中）" : "OFF（非表示）"}
            </button>
          </div>
          {enabled && display && (
            <div className="grislo-sim-view-eta-body" role="status" aria-live="off">
              <strong className={display.estimated ? "grislo-sim-view-eta-value" : "grislo-sim-view-eta-pending"}>
                {display.primary}
              </strong>
              {display.arrival && <span className="grislo-sim-view-eta-arrival">{display.arrival}</span>}
              {display.notes.map((note, index) => (
                <span className="grislo-sim-view-eta-note" key={`${index}:${note}`}>{note}</span>
              ))}
            </div>
          )}
        </div>
      ) : props.routeError ? (
        <p className="grislo-sim-view-route-error" role="alert">{props.routeError}</p>
      ) : null}
    </footer>
  )
}
