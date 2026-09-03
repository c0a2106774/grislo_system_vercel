"use client"

import type { DaySchedule } from "@/lib/types"

interface RouteInfoProps {
  schedule: DaySchedule | null
  isOperating: boolean
}

export function RouteInfo({ schedule, isOperating }: RouteInfoProps) {
  if (!schedule || !isOperating) {
    return null
  }

  const displayText =
    schedule.routeType === "循環ルート"
      ? `循環ルート走行中 ${schedule.startTime}～${schedule.endTime}`
      : `フリー運行中 ${schedule.startTime}～${schedule.endTime}`

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
          padding: "16px 24px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "20px", fontWeight: "bold", color: "#111827" }}>{displayText}</div>
        </div>
      </div>
    </div>
  )
}
