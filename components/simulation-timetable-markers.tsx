"use client"

import { useEffect } from "react"
import type { Map as LeafletMap } from "leaflet"

// GPS再生とは独立したシミュレーション専用時刻表データ。
export type TimetableStop = {
  id: string
  name: string
  time: string // HH:mm (JSTを想定)
  latitude: number
  longitude: number
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function parseTimetableStops(value: unknown): TimetableStop[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is TimetableStop => {
      if (!s || typeof s !== "object") return false
      const v = s as Partial<TimetableStop>
      return typeof v.id === "string" && v.id.length <= 100
        && typeof v.name === "string" && v.name.trim().length > 0 && v.name.length <= 80
        && typeof v.time === "string" && TIME_RE.test(v.time)
        && typeof v.latitude === "number" && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90
        && typeof v.longitude === "number" && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180
    })
    .sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name))
}

// MapWrapperと同じLeaflet地図上に時刻表ピンを重ねて描画する。
// ラベルはtextContentで生成し、地点名にHTMLを入力されても実行されない。
export function useSimulationTimetableMarkers(
  map: LeafletMap | null,
  stops: TimetableStop[],
): void {
  useEffect(() => {
    if (!map || stops.length === 0) return
    let cancelled = false
    let cleanup = () => {}

    void import("leaflet").then((module) => {
      if (cancelled) return
      const L = module.default
      const group = L.layerGroup().addTo(map)
      cleanup = () => group.remove()

      for (const stop of stops) {
        const marker = L.marker([stop.latitude, stop.longitude], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "",
            html: '<div style="width:22px;height:22px;background:#dc2626;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 5px #0005"></div>',
            iconSize: [28, 28],
            iconAnchor: [11, 27],
          }),
        })
        const label = document.createElement("div")
        label.style.cssText = "font:600 13px sans-serif;white-space:nowrap;color:#111827"
        const time = document.createElement("strong")
        time.textContent = `${stop.time} `
        const name = document.createElement("span")
        name.textContent = stop.name
        label.append(time, name)
        marker.bindTooltip(label, {
          permanent: true,
          direction: "top",
          offset: [1, -25],
          opacity: 0.96,
          interactive: false,
        })
        group.addLayer(marker)
      }
    }).catch((err) => console.error("[simulation-timetable] ピン描画エラー", err))

    return () => {
      cancelled = true
      cleanup()
    }
  }, [map, stops])
}
