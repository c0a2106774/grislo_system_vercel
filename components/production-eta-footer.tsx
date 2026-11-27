"use client"

import { useEffect, useMemo, useState } from "react"
import type { LocationData } from "@/lib/types"
import { estimateProductionEta, type ProductionEta } from "@/lib/production-eta"

const STORAGE_KEY = "grislo-production-eta-visible" // 旧バージョンと設定を共用

type GeoPoint = { lat: number; lng: number }

interface ProductionEtaFooterProps {
  userLocation: GeoPoint | null
  plannedRoute: [number, number][]
  locations: LocationData[]
  eligible: boolean
}

/**
 * 本番一般画面専用。循環運行中にだけ表示するフッターのETA部分。
 * 地図の吹き出しは使用しない。GPSとFirestoreには書き込まない。
 */
export function ProductionEtaFooter({
  userLocation, plannedRoute, locations, eligible,
}: ProductionEtaFooterProps) {
  const [enabled, setEnabled] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === "true")
    } catch {
      // localStorageが使えない環境では初期値OFF
    }
  }, [])

  const showing = eligible && enabled

  useEffect(() => {
    if (!showing) return
    setNowMs(Date.now())
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(intervalId)
  }, [showing])

  const eta = useMemo<ProductionEta>(() => {
    if (!showing) return { kind: "unavailable", message: "到着予想はOFFです。" }
    return estimateProductionEta({
      route: plannedRoute, locations, userLocation, nowMs,
    })
  }, [showing, plannedRoute, locations, userLocation, nowMs])

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    setNowMs(Date.now())
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // 端末に保存できなくても切替自体は有効
    }
  }

  if (!eligible) return null

  const timeLabel = eta.kind === "ok"
    ? new Date(eta.arrivalAtMs).toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : null

  return (
    <section className="grislo-prod-eta-section" aria-label="到着予想時刻">
      <div className="grislo-prod-eta-heading">
        <strong>到着予想時刻</strong>
        <button
          type="button"
          className="grislo-prod-eta-toggle"
          aria-pressed={enabled}
          aria-label={enabled ? "到着予想時刻を非表示にする" : "到着予想時刻を表示する"}
          onClick={toggle}
        >
          {enabled ? "ON（表示中）" : "OFF（非表示）"}
        </button>
      </div>

      {enabled && (
        <div className="grislo-prod-eta-body" role="status" aria-live="off">
          {eta.kind === "ok" ? (
            <>
              <strong className="grislo-prod-eta-value">
                {eta.minutes === 0 ? "まもなく到着" : `あと約${eta.minutes}分`}
              </strong>
              <span className="grislo-prod-eta-arrival">{timeLabel}頃に通過</span>
              {eta.nextLap && (
                <span className="grislo-prod-eta-note">次の周回の予測です</span>
              )}
              {eta.directionAssumed && (
                <span className="grislo-prod-eta-note">進行方向を確認中です</span>
              )}
              {eta.usedDefaultSpeed && (
                <span className="grislo-prod-eta-note">速度情報が不足しているため仮の速度で計算しています</span>
              )}
            </>
          ) : (
            <>
              <strong className="grislo-prod-eta-pending">到着予想を確認中</strong>
              <span className="grislo-prod-eta-note">{eta.message}</span>
            </>
          )}
        </div>
      )}
    </section>
  )
}
