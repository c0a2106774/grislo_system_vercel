"use client"

import { useEffect, useState, useCallback } from "react"
import { MapWrapper } from "@/components/map-wrapper"
import { ZoomControls } from "@/components/zoom-controls"
import { PassengerCount } from "@/components/passenger-count"
import { RouteInfo } from "@/components/route-info"
import { getRealtimeLocations, getSavedRoute, getCurrentScheduleStatus, getDateCollections, getAllLocationsFromCollection } from "@/lib/firebase"
import type { LocationData, DaySchedule } from "@/lib/types"
import type { Map as LeafletMap } from "leaflet"

export default function Home() {
  const [locations, setLocations] = useState<LocationData[]>([])
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [collectionName, setCollectionName] = useState<string>("")
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [plannedRoute, setPlannedRoute] = useState<[number, number][]>([])
  const [currentSchedule, setCurrentSchedule] = useState<DaySchedule | null>(null)
  const [isOperating, setIsOperating] = useState<boolean>(false)
  const [nextOperation, setNextOperation] = useState<{
    date: string
    dayOfWeek: string
    startTime: string
    endTime: string
    startLocation: string
    routeType: "循環ルート" | "フリー運行"
  } | null>(null)

  // 今日の日付から最新のコレクション名を自動選択
  useEffect(() => {
    const selectLatestCollection = async () => {
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, "0")
      const day = String(today.getDate()).padStart(2, "0")
      const todayDatePrefix = `${year}${month}${day}`
      
      try {
        // 利用可能なコレクションのリストを取得
        const availableCollections = await getDateCollections()
        
        // 今日の日付で始まるコレクションをフィルタリング
        const todayCollections = availableCollections.filter((name) => name.startsWith(todayDatePrefix))
        
        if (todayCollections.length > 0) {
          // 最新のコレクションを選択
          // コレクション名が "YYYYMMDD" または "YYYYMMDD_N" の形式の場合、
          // "_" の後の数字が大きいものを最新とする
          const sortedCollections = [...todayCollections].sort((a, b) => {
            // "_" で分割して比較
            const partsA = a.split("_")
            const partsB = b.split("_")
            
            // 数字部分を取得（存在しない場合は0とする）
            const numA = partsA.length > 1 ? parseInt(partsA[1], 10) || 0 : 0
            const numB = partsB.length > 1 ? parseInt(partsB[1], 10) || 0 : 0
            
            // 数字が大きいものを最新とする
            return numB - numA
          })
          
          const latestCollection = sortedCollections[0]
          setCollectionName(latestCollection)
        } else {
          // date-indexに登録されていない場合、最大10個まで試行
          // 20251212, 20251212_2, 20251212_3... の順に試して、データが存在する最初のコレクションを使用
          let foundCollection: string | null = null
          
          // まず基本のコレクション名を試す
          const baseCollection = todayDatePrefix
          try {
            const testLocations = await getAllLocationsFromCollection(baseCollection)
            if (testLocations.length > 0) {
              foundCollection = baseCollection
            }
          } catch (error) {
            // コレクションが存在しない場合は次のを試す
          }
          
          // データが見つからない場合、_2, _3... を順に試す
          // 最新のコレクションを選択するため、大きい番号から試す
          if (!foundCollection) {
            for (let i = 10; i >= 2; i--) {
              const testCollection = `${todayDatePrefix}_${i}`
              try {
                const testLocations = await getAllLocationsFromCollection(testCollection)
                if (testLocations.length > 0) {
                  foundCollection = testCollection
                  break
                }
              } catch (error) {
                // コレクションが存在しない場合は次のを試す
                continue
              }
            }
          }
          
          if (foundCollection) {
            setCollectionName(foundCollection)
          } else {
            // どのコレクションにもデータがない場合、基本のコレクション名を使用
            setCollectionName(todayDatePrefix)
          }
        }
      } catch (error) {
        // エラー時は、今日の日付のコレクション名を使用（フォールバック）
        setCollectionName(todayDatePrefix)
      }
    }
    
    selectLatestCollection()
  }, [])

  // Firestoreからリアルタイムでデータを取得
  useEffect(() => {
    if (!collectionName) return

    const unsubscribe = getRealtimeLocations(collectionName, (newLocations) => {
      setLocations(newLocations)
    })

    return () => {
      unsubscribe()
    }
  }, [collectionName])

  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }
          setUserLocation(location)
        },
        (error) => {
          // エラーは無視（位置情報が取得できない場合でもアプリは動作する）
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        },
      )

      return () => {
        navigator.geolocation.clearWatch(watchId)
      }
    }
  }, [])

  useEffect(() => {
    let startTimer: NodeJS.Timeout | null = null
    let endTimer: NodeJS.Timeout | null = null
    let scheduleCheckInterval: NodeJS.Timeout | null = null

    // 運行開始・終了時刻を計算してタイマーを設定する関数
    const setupTimers = async () => {
      const status = await getCurrentScheduleStatus()
      if (!status) return

      // 既存のタイマーをクリア
      if (startTimer) clearTimeout(startTimer)
      if (endTimer) clearTimeout(endTimer)

      setIsOperating(status.isOperating)
      setCurrentSchedule(status.schedule)
      setNextOperation(status.nextOperation || null)

      const now = new Date()
      const currentTime = now.getTime()

      if (status.isOperating && status.schedule) {
        // 現在運行中の場合：運行終了時刻にタイマーを設定
        const [endHour, endMinute] = status.schedule.endTime.split(":").map(Number)
        const endDate = new Date(now)
        endDate.setHours(endHour, endMinute, 0, 0)

        // 終了時刻が今日の場合はそのまま、過去の場合は明日に設定
        if (endDate.getTime() <= currentTime) {
          endDate.setDate(endDate.getDate() + 1)
        }

          const timeUntilEnd = endDate.getTime() - currentTime
          if (timeUntilEnd > 0) {
            endTimer = setTimeout(async () => {
              setIsOperating(false)
              // 終了後に次の運行を取得
              await setupTimers()
            }, timeUntilEnd)
          }
      } else if (status.nextOperation) {
        // 現在運行時間外の場合：次の運行開始時刻にタイマーを設定
        // nextOperation.dateは "12/2(火)" のような形式なので、日付部分を抽出
        const dateMatch = status.nextOperation.date.match(/^(\d+)\/(\d+)/)
        if (dateMatch) {
          const [, monthStr, dayStr] = dateMatch
          const month = parseInt(monthStr, 10)
          const day = parseInt(dayStr, 10)
          const [startHour, startMinute] = status.nextOperation.startTime.split(":").map(Number)

          // 現在の年を基準に日付を作成
          let startDate = new Date(now.getFullYear(), month - 1, day, startHour, startMinute, 0, 0)

          // 開始時刻が過去の場合は、次の年を試す
          if (startDate.getTime() <= currentTime) {
            startDate = new Date(now.getFullYear() + 1, month - 1, day, startHour, startMinute, 0, 0)
          }

          // それでも過去の場合は、今月の該当日を探す（月をまたぐ場合）
          if (startDate.getTime() <= currentTime) {
            const currentMonth = now.getMonth()
            const currentYear = now.getFullYear()
            // 今月の該当日を試す
            startDate = new Date(currentYear, currentMonth, day, startHour, startMinute, 0, 0)
            // それでも過去の場合は来月
            if (startDate.getTime() <= currentTime) {
              startDate = new Date(currentYear, currentMonth + 1, day, startHour, startMinute, 0, 0)
            }
          }

          const timeUntilStart = startDate.getTime() - currentTime
          if (timeUntilStart > 0 && timeUntilStart < 30 * 24 * 60 * 60 * 1000) {
            // 30日以内の場合のみタイマーを設定
            startTimer = setTimeout(async () => {
              // 開始時にスケジュールを再読み込み
              await setupTimers()
            }, timeUntilStart)
          }
        }
      }
    }

    // 初回読み込み
    setupTimers()

    // スケジュール変更対応のため、1時間ごとに再チェック
    // （スケジュール変更はめったにないため、1時間ごとで十分）
    scheduleCheckInterval = setInterval(setupTimers, 60 * 60 * 1000) // 1時間

    return () => {
      if (startTimer) clearTimeout(startTimer)
      if (endTimer) clearTimeout(endTimer)
      if (scheduleCheckInterval) clearInterval(scheduleCheckInterval)
    }
  }, [])

  useEffect(() => {
    const loadActiveRoute = async () => {
      if (!isOperating || !currentSchedule || currentSchedule.routeType !== "循環ルート") {
        setPlannedRoute([])
        return
      }

      const routeId = currentSchedule.routeId

      if (routeId) {
        const savedRoute = await getSavedRoute(routeId)

        if (savedRoute) {
          const routeCoords: [number, number][] = savedRoute.points.map((p) => [p.lat, p.lng])
          setPlannedRoute(routeCoords)
        } else {
          setPlannedRoute([])
        }
      } else {
        setPlannedRoute([])
      }
    }

    loadActiveRoute()
  }, [isOperating, currentSchedule])

  // ユーザーの現在位置を中心に
  const handleUserLocation = useCallback(() => {
    if (!map) return

    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 16)
    } else {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const newLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }
            setUserLocation(newLocation)
            map.setView([newLocation.lat, newLocation.lng], 16)
          },
          (error) => {
            console.error("[v0] Geolocation error:", error.code, error.message)
            if (error.code === 1) {
              console.error("[v0] Location permission denied by user")
            } else if (error.code === 2) {
              console.error("[v0] Location unavailable")
            } else if (error.code === 3) {
              console.error("[v0] Location request timeout")
            }
            alert("位置情報の取得に失敗しました")
          },
        )
      } else {
        alert("このブラウザは位置情報に対応していません")
      }
    }
  }, [map, userLocation])

  // 車両の現在位置を中心に
  const handleVehicleLocation = useCallback(() => {
    if (!map || locations.length === 0) {
      return
    }

    const latestLocation = locations[locations.length - 1]
    map.setView([latestLocation.latitude, latestLocation.longitude], 16)
  }, [map, locations])

  return (
    <main className="w-full h-screen relative overflow-hidden">
      <div className="absolute inset-0" style={{ zIndex: 1 }}>
        <MapWrapper
          locations={isOperating ? locations : []}
          onMapReady={setMap}
          userLocation={userLocation}
          plannedRoute={plannedRoute} // Simplified - route already controlled by useEffect
        />
      </div>

      {!isOperating && nextOperation && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(255, 255, 255, 0.85)",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              textAlign: "center",
              padding: "32px",
              color: "#000",
              // PC と同じサンセリフ系フォントスタックを明示的に指定
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            }}
          >
            <div style={{ fontSize: "25px", fontWeight: "500", lineHeight: "1.6" }}>次回の運行は</div>
            <div style={{ fontSize: "29px", fontWeight: "700", marginTop: "8px", lineHeight: "1.4" }}>
              {nextOperation.date}({nextOperation.dayOfWeek}){nextOperation.startTime}~{nextOperation.endTime}
            </div>
            <div style={{ fontSize: "23px", fontWeight: "600", marginTop: "8px", color: "#1f2937" }}>
              {nextOperation.routeType}
            </div>
            <div style={{ fontSize: "23px", marginTop: "16px", color: "#000" }}>
              スタート地点は{nextOperation.startLocation}です
            </div>
          </div>
        </div>
      )}

      {isOperating && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "16px",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <PassengerCount />
        </div>
      )}

      <div
        style={{
          position: "fixed",
          top: "16px",
          right: "16px",
          zIndex: 9999,
          pointerEvents: "auto",
        }}
      >
        <ZoomControls map={map} onUserLocation={handleUserLocation} onVehicleLocation={handleVehicleLocation} />
      </div>

      {isOperating && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <RouteInfo schedule={currentSchedule} isOperating={isOperating} />
        </div>
      )}
    </main>
  )
}
