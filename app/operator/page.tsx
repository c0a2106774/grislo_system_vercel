"use client"

import { useState, useEffect, useMemo } from "react"
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Route, Save, MapPin } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { saveMonthSchedule, getMonthSchedule, getDateCollections } from "@/lib/firebase"
import type { DaySchedule, MonthSchedule } from "@/lib/types"

const DRAFT_STORAGE_KEY = "operatorScheduleDraft"

export default function OperatorHome() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const draftFromStorage = useMemo(() => {
    if (typeof window === "undefined") return null
    const stored = sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!stored) return null
    sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    try {
      return JSON.parse(stored) as {
        selectedMonth?: string
        selectedDate?: string | null
        schedules?: MonthSchedule
      }
    } catch {
      return null
    }
  }, [])
  const [selectedMonth, setSelectedMonth] = useState(
    draftFromStorage?.selectedMonth ? new Date(draftFromStorage.selectedMonth) : new Date(),
  )
  const [schedules, setSchedules] = useState<MonthSchedule>(draftFromStorage?.schedules ?? {})
  const [selectedDate, setSelectedDate] = useState<string | null>(draftFromStorage?.selectedDate ?? null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([])
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [hasDraft, setHasDraft] = useState(Boolean(draftFromStorage))

  useEffect(() => {
    loadSchedule()
    loadAvailableRoutes()
  }, [selectedMonth])

  useEffect(() => {
    const selectedRouteId = searchParams.get("selectedRoute")
    const dateParam = searchParams.get("date")
    const scheduleIndexParam = searchParams.get("scheduleIndex")
    if (!scheduleLoaded) return

    if (selectedRouteId && dateParam) {
      const scheduleIndex = scheduleIndexParam ? parseInt(scheduleIndexParam, 10) : 0
      updateSchedule(dateParam, scheduleIndex, { routeId: selectedRouteId })

      setSelectedDate(dateParam)
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href)
        url.searchParams.delete("selectedRoute")
        url.searchParams.delete("date")
        url.searchParams.delete("scheduleIndex")
        window.history.replaceState({}, "", url.pathname)
      }

      setMessage(`ルート ${selectedRouteId} を選択しました。保存ボタンを押してください。`)
      setTimeout(() => setMessage(""), 5000)
    }
  }, [searchParams, scheduleLoaded])

  async function loadSchedule(force = false) {
    setScheduleLoaded(false)
    if (hasDraft && !force) {
      setScheduleLoaded(true)
      setHasDraft(false)
      return
    }
    const yearMonth = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}`
    const schedule = await getMonthSchedule(yearMonth)
    if (schedule) {
      setSchedules(schedule)
    } else {
      setSchedules({})
    }
    setScheduleLoaded(true)
  }

  async function loadAvailableRoutes() {
    const routes = await getDateCollections()
    setAvailableRoutes(routes)
  }

  async function handleSaveSchedule() {
    setSaving(true)
    setMessage("")

    const yearMonth = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}`
    const success = await saveMonthSchedule(yearMonth, schedules)

    if (success) {
      setMessage("スケジュールを保存しました")
      setHasDraft(false)
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY)
      }
      await loadSchedule(true)
    } else {
      setMessage("保存に失敗しました")
    }

    setSaving(false)
    setTimeout(() => setMessage(""), 3000)
  }

  function getDaysInMonth(date: Date) {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const days = []

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      days.push({ day, dateStr })
    }

    return { days, firstDayOfWeek: firstDay.getDay() }
  }

  const { days, firstDayOfWeek } = getDaysInMonth(selectedMonth)

  function handlePreviousMonth() {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1))
    setSelectedDate(null)
  }

  function handleNextMonth() {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1))
    setSelectedDate(null)
  }

  function handleDayClick(dateStr: string) {
    setSelectedDate(dateStr)
  }

  // 日付文字列からスケジュール配列を取得するヘルパー関数
  function getDaySchedules(dateStr: string): DaySchedule[] {
    const daySchedule = schedules[dateStr]
    if (!daySchedule) return []
    return Array.isArray(daySchedule) ? daySchedule : [daySchedule]
  }

  // 日付文字列にスケジュール配列を設定するヘルパー関数
  function setDaySchedules(dateStr: string, daySchedules: DaySchedule[]) {
    setSchedules((prev: MonthSchedule) => {
      const updated = { ...prev }
      if (daySchedules.length > 0) {
        updated[dateStr] = daySchedules
      } else {
        delete updated[dateStr]
      }
      return updated
    })
  }

  // 特定のインデックスのスケジュールを更新
  function updateSchedule(dateStr: string, scheduleIndex: number, updates: Partial<DaySchedule>) {
    const daySchedules = getDaySchedules(dateStr)
    if (scheduleIndex < 0 || scheduleIndex >= daySchedules.length) return

    const updated = [...daySchedules]
    updated[scheduleIndex] = { ...updated[scheduleIndex], ...updates }
    setDaySchedules(dateStr, updated)
  }

  // 新しいスケジュールを追加
  function addNewSchedule(dateStr: string) {
    const newSchedule: DaySchedule = {
      isOperating: true,
      startTime: "10:00",
      endTime: "11:30",
      routeType: "循環ルート",
      routeId: "循環ルート1",
      startLocation: "ヤンマー前",
    }
    const daySchedules = getDaySchedules(dateStr)
    setDaySchedules(dateStr, [...daySchedules, newSchedule])
  }

  // スケジュールを削除
  function removeSchedule(dateStr: string, scheduleIndex: number) {
    const daySchedules = getDaySchedules(dateStr)
    if (scheduleIndex < 0 || scheduleIndex >= daySchedules.length) return

    const updated = daySchedules.filter((_, i) => i !== scheduleIndex)
    setDaySchedules(dateStr, updated)
  }

  function persistScheduleDraft() {
    if (typeof window === "undefined") return
    const payload = {
      selectedMonth: selectedMonth.toISOString(),
      selectedDate,
      schedules,
    }
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload))
  }

  function handleSelectRouteFromMap(scheduleIndex: number = 0) {
    if (!selectedDate) return
    persistScheduleDraft()
    router.push(`/operator/route?selectMode=true&date=${selectedDate}&scheduleIndex=${scheduleIndex}`)
  }

  const monthName = selectedMonth.toLocaleDateString("ja-JP", { year: "numeric", month: "long" })
  const selectedDaySchedules = selectedDate ? getDaySchedules(selectedDate) : []

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#f3f4f6",
        overflowY: "auto",
        overflowX: "hidden",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div
          style={{
            backgroundColor: "white",
            borderRadius: 16,
            padding: 24,
            marginBottom: 16,
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
          }}
        >
          <div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  }}
>
  {/* スケジュール設定タイトル */}
  <div>
    <h1
      style={{
        fontSize: 24,
        fontWeight: 700,
        color: "#1f2937",
        marginBottom: 8,
      }}
    >
      スケジュール設定
    </h1>

    <p
      style={{
        color: "#6b7280",
        fontSize: 14,
        margin: 0,
      }}
    >
      カレンダーから日付を選択して、
      運行スケジュールを設定してください
    </p>
  </div>

  {/* 運行中管理画面へ移動 */}
  <button
    type="button"
    onClick={() => {
      router.push("/operator/live")
    }}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,

      padding: "12px 16px",

      borderRadius: 10,

      border: "1px solid #f59e0b",

      backgroundColor: "#fffbeb",

      color: "#92400e",

      fontSize: 14,
      fontWeight: 700,

      cursor: "pointer",

      whiteSpace: "nowrap",

      boxShadow:
        "0 1px 3px rgba(0, 0, 0, 0.08)",
    }}
  >
    <AlertTriangle
      size={19}
      strokeWidth={2.3}
    />

    運行中の遅延・停止情報
  </button>
</div>
        </div>

        {message && (
          <div
            style={{
              backgroundColor: "rgba(16, 185, 129, 0.1)",
              border: "1px solid #10b981",
              color: "#065f46",
              padding: "12px 16px",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {message}
          </div>
        )}

        <div
          style={{
            backgroundColor: "white",
            borderRadius: 16,
            padding: "16px",
            marginBottom: 16,
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            overflowX: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <button
              onClick={handlePreviousMonth}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                backgroundColor: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronLeft size={20} />
            </button>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1f2937" }}>{monthName}</h2>
            <button
              onClick={handleNextMonth}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                backgroundColor: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 4,
              marginBottom: 4,
              width: "100%",
              maxWidth: "calc(100% - 16px)",
              marginLeft: "auto",
              marginRight: "auto",
              boxSizing: "border-box",
            }}
          >
            {["日", "月", "火", "水", "木", "金", "土"].map((day, index) => (
              <div
                key={day}
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  color: index === 0 ? "#ef4444" : index === 6 ? "#3b82f6" : "#6b7280",
                  padding: 4,
                }}
              >
                {day}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 4,
              width: "100%",
              maxWidth: "calc(100% - 16px)",
              marginLeft: "auto",
              marginRight: "auto",
              boxSizing: "border-box",
            }}
          >
            {Array.from({ length: firstDayOfWeek }).map((_, index) => (
              <div key={`empty-${index}`} />
            ))}

            {days.map(({ day, dateStr }) => {
              const daySchedules = getDaySchedules(dateStr)
              // 有効な運行予定（isOperating: true）だけをフィルタリング
              const operatingSchedules = daySchedules.filter((s) => s.isOperating)
              const isOperating = operatingSchedules.length > 0
              const isSelected = selectedDate === dateStr
              const scheduleCount = operatingSchedules.length

              return (
                <button
                  key={dateStr}
                  onClick={() => handleDayClick(dateStr)}
                  style={{
                    aspectRatio: "1",
                    borderRadius: 8,
                    border: isSelected ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                    backgroundColor: isOperating ? "#dbeafe" : "white",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 2,
                    position: "relative",
                    transition: "all 0.2s",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      lineHeight: 1.1,
                      color: isOperating ? "#1e40af" : "#1f2937",
                    }}
                  >
                    {day}
                  </div>
                  {scheduleCount > 1 && (
                    <div
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        backgroundColor: "#3b82f6",
                        color: "white",
                        borderRadius: "50%",
                        width: 18,
                        height: 18,
                        fontSize: 10,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {scheduleCount}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {selectedDate && (
          <div
            style={{
              backgroundColor: "white",
              borderRadius: 16,
              padding: 24,
              boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
              marginBottom: 80,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#1f2937" }}>{selectedDate}の設定</h3>
              {selectedDaySchedules.length > 0 && (
                <button
                  onClick={() => addNewSchedule(selectedDate)}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#3b82f6",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span>+</span>
                  新しい運行を追加
                </button>
              )}
            </div>

            {selectedDaySchedules.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#6b7280" }}>
                <p style={{ fontSize: 16, marginBottom: 12 }}>この日は運行スケジュールが設定されていません</p>
                <button
                  onClick={() => addNewSchedule(selectedDate)}
                  style={{
                    padding: "12px 24px",
                    backgroundColor: "#3b82f6",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  運行予定を追加
                </button>
              </div>
            ) : (
              selectedDaySchedules.map((schedule, index) => (
                <div
                  key={index}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 20,
                    marginBottom: 16,
                    backgroundColor: "#f9fafb",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <h4 style={{ fontSize: 16, fontWeight: 700, color: "#1f2937" }}>
                      運行 {index + 1} {schedule.isOperating ? "" : "(無効)"}
                    </h4>
                    {selectedDaySchedules.length > 1 && (
                      <button
                        onClick={() => removeSchedule(selectedDate, index)}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#ef4444",
                          color: "white",
                          border: "none",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        削除
                      </button>
                    )}
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={schedule.isOperating}
                        onChange={(e) => updateSchedule(selectedDate, index, { isOperating: e.target.checked })}
                        style={{ width: 20, height: 20, marginRight: 12, cursor: "pointer" }}
                      />
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#1f2937" }}>この運行を有効にする</span>
                    </label>
                  </div>

                  {schedule.isOperating && (
                    <>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                          <Clock size={16} style={{ display: "inline", marginRight: 8 }} />
                          運行時間
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <input
                            type="time"
                            value={schedule.startTime}
                            onChange={(e) => updateSchedule(selectedDate, index, { startTime: e.target.value })}
                            style={{
                              flex: 1,
                              padding: "12px 16px",
                              border: "1px solid #d1d5db",
                              borderRadius: 8,
                              fontSize: 16,
                            }}
                          />
                          <span style={{ color: "#6b7280" }}>〜</span>
                          <input
                            type="time"
                            value={schedule.endTime}
                            onChange={(e) => updateSchedule(selectedDate, index, { endTime: e.target.value })}
                            style={{
                              flex: 1,
                              padding: "12px 16px",
                              border: "1px solid #d1d5db",
                              borderRadius: 8,
                              fontSize: 16,
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                          <Route size={16} style={{ display: "inline", marginRight: 8 }} />
                          ルートタイプ
                        </label>
                        <div style={{ display: "flex", gap: 12 }}>
                          <button
                            onClick={() => updateSchedule(selectedDate, index, { routeType: "循環ルート" })}
                            style={{
                              flex: 1,
                              padding: "12px 16px",
                              border: schedule.routeType === "循環ルート" ? "2px solid #3b82f6" : "1px solid #d1d5db",
                              borderRadius: 8,
                              backgroundColor: schedule.routeType === "循環ルート" ? "#dbeafe" : "white",
                              cursor: "pointer",
                              fontSize: 16,
                              fontWeight: 600,
                              color: schedule.routeType === "循環ルート" ? "#1e40af" : "#6b7280",
                              transition: "all 0.2s",
                            }}
                          >
                            循環ルート
                          </button>
                          <button
                            onClick={() => updateSchedule(selectedDate, index, { routeType: "フリー運行" })}
                            style={{
                              flex: 1,
                              padding: "12px 16px",
                              border: schedule.routeType === "フリー運行" ? "2px solid #3b82f6" : "1px solid #d1d5db",
                              borderRadius: 8,
                              backgroundColor: schedule.routeType === "フリー運行" ? "#dbeafe" : "white",
                              cursor: "pointer",
                              fontSize: 16,
                              fontWeight: 600,
                              color: schedule.routeType === "フリー運行" ? "#1e40af" : "#6b7280",
                              transition: "all 0.2s",
                            }}
                          >
                            フリー運行
                          </button>
                        </div>
                      </div>

                      {schedule.routeType === "循環ルート" && (
                        <div style={{ marginBottom: 16 }}>
                          <label
                            style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}
                          >
                            <Route size={16} style={{ display: "inline", marginRight: 8 }} />
                            使用するルート
                          </label>

                          <div style={{ display: "flex", gap: 12 }}>
                            <button
                              onClick={() => handleSelectRouteFromMap(index)}
                              style={{
                                flex: 1,
                                padding: "16px 20px",
                                border: "2px dashed #3b82f6",
                                borderRadius: 12,
                                backgroundColor: "white",
                                cursor: "pointer",
                                fontSize: 16,
                                fontWeight: 600,
                                color: "#3b82f6",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                                transition: "all 0.2s",
                              }}
                            >
                              <MapPin size={20} />
                              地図でルートを選択
                            </button>
                          </div>

                          {schedule.routeId && (
                            <div
                              style={{
                                marginTop: 12,
                                padding: "12px 16px",
                                backgroundColor: "#dbeafe",
                                borderRadius: 8,
                                border: "1px solid #3b82f6",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>選択中のルート</div>
                                <div style={{ fontSize: 16, fontWeight: 700, color: "#1e40af" }}>{schedule.routeId}</div>
                              </div>
                              <button
                                onClick={() => updateSchedule(selectedDate, index, { routeId: undefined })}
                                style={{
                                  padding: "6px 12px",
                                  backgroundColor: "white",
                                  border: "1px solid #d1d5db",
                                  borderRadius: 6,
                                  fontSize: 12,
                                  color: "#6b7280",
                                  cursor: "pointer",
                                }}
                              >
                                解除
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ marginBottom: 0 }}>
                        <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
                          <MapPin size={16} style={{ display: "inline", marginRight: 8 }} />
                          スタート地点
                        </label>
                        {(() => {
                          const rawValue = schedule.startLocation

                          // セレクトボックスの表示値と、その他入力欄の値を決定
                          let selectValue: "ヤンマー前" | "コア前" | "その他"
                          let otherInputValue = ""

                          if (rawValue === "ヤンマー前" || rawValue === "コア前") {
                            // プリセット値そのまま
                            selectValue = rawValue
                          } else if (!rawValue) {
                            // まだ何も設定されていない場合はデフォルトで「ヤンマー前」
                            selectValue = "ヤンマー前"
                          } else if (rawValue === "その他") {
                            // 「その他」モードに入った直後（まだ自由記述なし）
                            selectValue = "その他"
                          } else {
                            // 自由記述が入っている場合
                            selectValue = "その他"
                            otherInputValue = rawValue
                          }

                          const isOther = selectValue === "その他"

                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              <select
                                value={selectValue}
                                onChange={(e) => {
                                  const v = e.target.value as "ヤンマー前" | "コア前" | "その他"
                                  if (v === "ヤンマー前" || v === "コア前") {
                                    // プリセット値をそのまま保存
                                    updateSchedule(selectedDate, index, { startLocation: v })
                                  } else {
                                    // 「その他」を選択したタイミングでは、
                                    // すでに自由記述がある場合はそれを維持、なければ「その他」という印だけ残す
                                    if (
                                      !rawValue ||
                                      rawValue === "ヤンマー前" ||
                                      rawValue === "コア前" ||
                                      rawValue === "その他"
                                    ) {
                                      updateSchedule(selectedDate, index, { startLocation: "その他" })
                                    } else {
                                      updateSchedule(selectedDate, index, { startLocation: rawValue })
                                    }
                                  }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "10px 14px",
                                  borderRadius: 8,
                                  border: "1px solid #d1d5db",
                                  fontSize: 16,
                                  backgroundColor: "white",
                                }}
                              >
                                <option value="ヤンマー前">ヤンマー前</option>
                                <option value="コア前">コア前</option>
                                <option value="その他">その他</option>
                              </select>

                              {isOther && (
                                <input
                                  type="text"
                                  value={otherInputValue}
                                  onChange={(e) =>
                                    updateSchedule(selectedDate, index, { startLocation: e.target.value })
                                  }
                                  placeholder="その他のスタート地点を入力"
                                  style={{
                                    width: "100%",
                                    padding: "12px 16px",
                                    border: "1px solid #d1d5db",
                                    borderRadius: 8,
                                    fontSize: 16,
                                    boxSizing: "border-box",
                                  }}
                                />
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <div
          style={{
            backgroundColor: "white",
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            marginBottom: 16,
          }}
        >
          <button
            onClick={handleSaveSchedule}
            disabled={saving}
            style={{
              width: "100%",
              padding: "16px 24px",
              backgroundColor: saving ? "#9ca3af" : "#10b981",
              color: "white",
              border: "none",
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "all 0.2s",
            }}
          >
            <Save size={20} />
            {saving ? "保存中..." : "スケジュールを保存"}
          </button>
        </div>
      </div>
    </div>
  )
}
