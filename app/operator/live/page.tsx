
"use client"

import { getAuth } from "firebase/auth"
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Send, X } from "lucide-react"
import type { Map as LeafletMap } from "leaflet"

import { MapWrapper } from "@/components/map-wrapper"
import { ZoomControls } from "@/components/zoom-controls"

import {
  app,
  getAllLocationsFromCollection,
  getCurrentScheduleStatus,
  getDateCollections,
  getRealtimeLocations,
  getSavedRoute,
} from "@/lib/firebase"

import {
  getOperationEventTemplates,
  publishOperationEvent,
  resolveOperationEvent,
  subscribeOperationEvent,
} from "@/lib/operation-events"

import type {
  LocationData,
  OperationEvent,
  OperationEventTemplate,
  OperationEventType,
} from "@/lib/types"

const EVENT_TYPE_LABELS: Record<OperationEventType, string> = {
  delay: "遅延",
  stopped: "一時停止",
  notice: "お知らせ",
}

function getCollectionNumber(
  collectionName: string,
  datePrefix: string,
): number {
  if (collectionName === datePrefix) return 1

  const suffix = collectionName.replace(`${datePrefix}_`, "")
  const number = Number.parseInt(suffix, 10)

  return Number.isNaN(number) ? 0 : number
}

function formatJapanTime(isoString: string): string {
  const date = new Date(isoString)

  if (Number.isNaN(date.getTime())) {
    return "時刻不明"
  }

  return date.toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  })
}

async function sendOperationEventToLine(
  type: OperationEventType,
  message: string,
): Promise<boolean> {
  try {
    const auth = getAuth(app)
    const user = auth.currentUser

    if (!user) {
      console.error(
        "[operator-live] 管理者がログインしていません",
      )

      return false
    }

    /**
     * 現在ログインしている管理者の
     * Firebase ID Tokenを取得
     */
    const idToken =
      await user.getIdToken()

    const response =
      await fetch(
        "/api/line/operation",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${idToken}`,
          },

          body: JSON.stringify({
            type,
            message,
          }),
        },
      )

    if (!response.ok) {
      const errorText =
        await response.text()

      console.error(
        "[operator-live] LINE送信エラー:",
        response.status,
        errorText,
      )

      return false
    }

    return true
  } catch (error) {
    console.error(
      "[operator-live] LINE送信エラー:",
      error,
    )

    return false
  }
}

export default function OperatorLivePage() {
  // グリスロのGPS
  const [locations, setLocations] = useState<LocationData[]>([])
  const [collectionName, setCollectionName] = useState("")

  // 地図本体と操作者自身の現在地
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [userLocation, setUserLocation] = useState<{
    lat: number
    lng: number
  } | null>(null)

  // Step 14：現在運行中のルート
  const [plannedRoute, setPlannedRoute] = useState<
    [number, number][]
  >([])

  // 運行情報パネル
  const [panelOpen, setPanelOpen] = useState(false)
  const [templates, setTemplates] = useState<
    OperationEventTemplate[]
  >([])

  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [customMessage, setCustomMessage] = useState("")

  // 現在表示されている運行情報
  const [activeEvent, setActiveEvent] =
    useState<OperationEvent | null>(null)

  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState("")

  /**
   * 今日の最新GPSコレクションを選択
   */
  useEffect(() => {
    let cancelled = false

    async function selectLatestCollection() {
      const today = new Date()

      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, "0")
      const day = String(today.getDate()).padStart(2, "0")
      const datePrefix = `${year}${month}${day}`

      try {
        const availableCollections = await getDateCollections()

        const todayCollections = availableCollections
          .filter(
            (name) =>
              name === datePrefix ||
              name.startsWith(`${datePrefix}_`),
          )
          .sort(
            (a, b) =>
              getCollectionNumber(b, datePrefix) -
              getCollectionNumber(a, datePrefix),
          )

        for (const collection of todayCollections) {
          const data = await getAllLocationsFromCollection(
            collection,
          )

          if (cancelled) return

          if (data.length > 0) {
            setCollectionName(collection)
            return
          }
        }

        // date-indexに未登録の場合も確認
        for (let i = 10; i >= 2; i -= 1) {
          const collection = `${datePrefix}_${i}`

          const data = await getAllLocationsFromCollection(
            collection,
          )

          if (cancelled) return

          if (data.length > 0) {
            setCollectionName(collection)
            return
          }
        }

        // 通常の日付コレクション
        const baseData = await getAllLocationsFromCollection(
          datePrefix,
        )

        if (cancelled) return

        if (baseData.length > 0) {
          setCollectionName(datePrefix)
          return
        }

        // GPSがまだない場合も今日のデータを監視
        setCollectionName(datePrefix)
      } catch (error) {
        console.error(
          "[operator-live] GPSコレクション取得エラー:",
          error,
        )

        if (!cancelled) {
          setCollectionName(datePrefix)
        }
      }
    }

    void selectLatestCollection()

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * グリスロのGPSをリアルタイム監視
   */
  useEffect(() => {
    if (!collectionName) return

    const unsubscribe = getRealtimeLocations(
      collectionName,
      setLocations,
    )

    return () => {
      unsubscribe()
    }
  }, [collectionName])

  /**
   * Step 14：
   * 現在運行中のスケジュールからルートを取得
   *
   * 循環ルートの場合のみ青い線を表示する。
   * 5分ごと、および画面に戻った際に更新する。
   */
  useEffect(() => {
    let cancelled = false
    let latestRequest = 0

    async function loadCurrentRoute() {
      const requestId = ++latestRequest

      try {
        const status = await getCurrentScheduleStatus()

        if (cancelled || requestId !== latestRequest) {
          return
        }

        // 運行時間外、またはフリー運行ならルートを消す
        if (
          !status?.isOperating ||
          status.schedule?.routeType !== "循環ルート" ||
          !status.schedule.routeId
        ) {
          setPlannedRoute([])
          return
        }

        const routeId = status.schedule.routeId
        const savedRoute = await getSavedRoute(routeId)

        if (cancelled || requestId !== latestRequest) {
          return
        }

        if (!savedRoute || !savedRoute.points?.length) {
          console.warn(
            "[operator-live] 保存済みルートが見つかりません:",
            routeId,
          )

          setPlannedRoute([])
          return
        }

        const coordinates: [number, number][] =
          savedRoute.points
            .filter(
              (point) =>
                Number.isFinite(point.lat) &&
                Number.isFinite(point.lng),
            )
            .map((point) => [point.lat, point.lng])

        setPlannedRoute(coordinates)
      } catch (error) {
        console.error(
          "[operator-live] 運行ルート取得エラー:",
          error,
        )

        if (!cancelled && requestId === latestRequest) {
          setPlannedRoute([])
        }
      }
    }

    void loadCurrentRoute()

    // 運行開始・終了、スケジュール変更への対応
    const intervalId = window.setInterval(
      () => void loadCurrentRoute(),
      5 * 60 * 1000,
    )

    // スマホで別のアプリから戻った際にも更新
    function handleVisibilityChange() {
      if (!document.hidden) {
        void loadCurrentRoute()
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    )

    return () => {
      cancelled = true
      window.clearInterval(intervalId)

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      )
    }
  }, [])

  /**
   * 操作者自身の現在地を監視
   */
  useEffect(() => {
    if (!("geolocation" in navigator)) return

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      (error) => {
        console.warn(
          "[operator-live] 現在地取得エラー:",
          error.code,
          error.message,
        )
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
  }, [])

  /**
   * 保存済み定型文を読み込む
   */
  useEffect(() => {
    let cancelled = false

    async function loadTemplates() {
      const loadedTemplates =
        await getOperationEventTemplates()

      if (!cancelled) {
        setTemplates(loadedTemplates)
      }
    }

    void loadTemplates()

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 現在表示中の運行情報をリアルタイム監視
   */
  useEffect(() => {
    return subscribeOperationEvent(setActiveEvent)
  }, [])

  const selectedTemplate = templates.find(
    (template) => template.id === selectedTemplateId,
  )

  const outgoingMessage =
    customMessage.trim() ||
    selectedTemplate?.message.trim() ||
    ""

  /**
   * 操作者の現在位置に移動
   */
  const handleUserLocation = useCallback(() => {
    if (!map) return

    if (userLocation) {
      map.setView(
        [userLocation.lat, userLocation.lng],
        16,
      )
      return
    }

    if (!("geolocation" in navigator)) {
      alert("このブラウザは位置情報に対応していません")
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }

        setUserLocation(location)

        map.setView(
          [location.lat, location.lng],
          16,
        )
      },
      (error) => {
        console.error(
          "[operator-live] 現在地取得エラー:",
          error,
        )

        alert("現在地を取得できませんでした")
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    )
  }, [map, userLocation])

  /**
   * グリスロの現在位置に移動
   */
  const handleVehicleLocation = useCallback(() => {
    if (!map || locations.length === 0) return

    const latestLocation = locations[locations.length - 1]

    map.setView(
      [
        latestLocation.latitude,
        latestLocation.longitude,
      ],
      16,
    )
  }, [map, locations])

  /**
   * 運行情報の送信
   */
async function handlePublish() {
  if (!outgoingMessage || sending) return

  setSending(true)
  setFeedback("")

  const latestLocation =
    locations.length > 0
      ? locations[locations.length - 1]
      : null

  /**
   * タブを廃止したため、
   * 保存済み文章はそのtypeを使用し、
   * 自由記述はnoticeとして扱う
   */
  const publishType: OperationEventType =
    selectedTemplate?.type ?? "notice"

  const source =
    customMessage.trim()
      ? "custom"
      : "preset"

  try {
    /**
     * ① Web地図 / Firestoreへ送信
     */
    const webSuccess =
      await publishOperationEvent({
        type: publishType,

        message: outgoingMessage,

        source,

        vehicleLatitude:
          latestLocation?.latitude,

        vehicleLongitude:
          latestLocation?.longitude,
      })

    if (!webSuccess) {
      setFeedback(
        "Web地図への送信に失敗しました",
      )

      return
    }

    /**
     * 管理者画面にも即座に反映する。
     *
     * Firestoreのリアルタイム監視でも
     * 更新されるが、送信直後から
     * 吹き出しを表示できるようにする。
     */
    setActiveEvent({
      type: publishType,

      message:
        outgoingMessage,

      source,

      status: "active",

      publishedAt:
        new Date().toISOString(),

      ...(typeof latestLocation?.latitude === "number"
        ? {
            vehicleLatitude:
              latestLocation.latitude,
          }
        : {}),

      ...(typeof latestLocation?.longitude === "number"
        ? {
            vehicleLongitude:
              latestLocation.longitude,
          }
        : {}),
    })

    /**
     * ② LINEへ送信
     */
    const lineSuccess =
      await sendOperationEventToLine(
        publishType,
        outgoingMessage,
      )

    if (!lineSuccess) {
      setFeedback(
        "Web地図へは送信しましたが、LINE送信に失敗しました",
      )

      return
    }

    /**
     * 両方成功
     */
    setFeedback(
      "Web地図とLINEへ送信しました",
    )

    setSelectedTemplateId("")
    setCustomMessage("")

    /**
     * 地図上の吹き出しを確認できるよう
     * 送信成功後に左パネルを閉じる
     */
    setPanelOpen(false)
  } finally {
    setSending(false)
  }
}
  /**
   * 運行情報の解除
   */
  async function handleResolve() {
    if (sending) return

    setSending(true)
    setFeedback("")

    try {
      const success = await resolveOperationEvent()

      setFeedback(
        success
          ? "表示中の運行情報を解除しました"
          : "運行情報の解除に失敗しました",
      )
    } finally {
      setSending(false)
    }
  }

  const hasVehicleLocation =
  locations.length > 0

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#f3f4f6",
      }}
    >
      {/* 地図：Step 14でplannedRouteを追加 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
        }}
      >
        <MapWrapper
          locations={locations}
          plannedRoute={plannedRoute}
          onMapReady={setMap}
          userLocation={userLocation}
          activeEvent={activeEvent}
        />
      {/* GPSが取得できない場合の運行情報表示 */}
{activeEvent &&
  !hasVehicleLocation && (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform:
          "translateX(-50%)",
        zIndex: 11000,
        width:
          "min(520px, calc(100vw - 140px))",
        boxSizing: "border-box",
        padding: "14px 18px",
        borderRadius: 12,
        backgroundColor: "#eff6ff",
        border:
          "1px solid #bfdbfe",
        boxShadow:
          "0 4px 16px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          marginBottom: 5,
          fontSize: 12,
          fontWeight: 800,
          color: "#1d4ed8",
        }}
      >
        運行情報
      </div>

      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1.5,
          color: "#111827",
          whiteSpace: "pre-wrap",
        }}
      >
        {activeEvent.message}
      </div>

      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "#6b7280",
        }}
      >
        {formatJapanTime(
          activeEvent.publishedAt,
        )}{" "}
        更新
      </div>

      <div
        style={{
          marginTop: 5,
          fontSize: 10,
          color: "#9ca3af",
        }}
      >
        車両位置情報を取得できないため、
        画面上部に表示しています
      </div>
    </div>
  )}  
      </div>

      {/* 地図操作 */}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 11000,
          pointerEvents: "auto",
        }}
      >
        <ZoomControls
          map={map}
          onUserLocation={handleUserLocation}
          onVehicleLocation={handleVehicleLocation}
        />
      </div>

      {/* 左上の運行情報ボタン */}
      
<button
  type="button"
  aria-label="運行情報を開く"
  onClick={() => setPanelOpen((current) => !current)}
  style={{
    position: "fixed",
    top: 16,
    left: 16,
    zIndex: 11002,

    height: 54,
    padding: "0 16px",

    borderRadius: 14,

    border: activeEvent
      ? "2px solid #dc2626"
      : "1px solid #f59e0b",

    backgroundColor: activeEvent
      ? "#fef2f2"
      : "#fffbeb",

    color: activeEvent
      ? "#b91c1c"
      : "#92400e",

    boxShadow:
      "0 4px 14px rgba(0,0,0,0.18)",

    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,

    cursor: "pointer",
  }}
>
  <AlertTriangle
    size={28}
    strokeWidth={2.4}
  />

  <span
    style={{
      fontSize: 22,
      fontWeight: 800,
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}
  >
    運行情報
  </span>

  {activeEvent && (
    <span
      style={{
        position: "absolute",
        top: -4,
        right: -4,
        width: 14,
        height: 14,
        borderRadius: "50%",
        backgroundColor: "#dc2626",
        border: "2px solid white",
      }}
    />
  )}
</button>

      {/* 左側パネル */}
      <aside
        aria-hidden={!panelOpen}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 11001,
          width: "min(390px, calc(100vw - 24px))",
          padding: "78px 20px 24px",
          boxSizing: "border-box",
          backgroundColor: "rgba(255,255,255,0.98)",
          boxShadow: "8px 0 24px rgba(0,0,0,0.18)",
          overflowY: "auto",
          transform: panelOpen
            ? "translateX(0)"
            : "translateX(-105%)",
          transition: "transform 180ms ease",
          pointerEvents: panelOpen ? "auto" : "none",
        }}
      >
        {/* 閉じる */}
        <button
          type="button"
          aria-label="閉じる"
          onClick={() => setPanelOpen(false)}
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            width: 40,
            height: 40,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            backgroundColor: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={22} />
        </button>

        {/*<h1
          style={{
            margin: 10, //init=8
            fontSize: 22,
            fontWeight: 800,
            color: "#111827",
          }}
        >
          遅延・運行情報
        </h1> */}


        {/* 現在表示中 */}
        {activeEvent && (
          <section
            style={{
              marginBottom: 22,
              padding: 14,
              borderRadius: 12,
              border: "1px solid #fecaca",
              backgroundColor: "#fef2f2",
            }}
          >
            <div
              style={{
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 800,
                color: "#b91c1c",
              }}
            >
              現在表示中
            </div>

            <div
              style={{
                marginBottom: 5,
                fontSize: 12,
                fontWeight: 700,
                color:
                  activeEvent.type === "stopped"
                    ? "#b91c1c"
                    : activeEvent.type === "delay"
                      ? "#b45309"
                      : "#1d4ed8",
              }}
            >
              {EVENT_TYPE_LABELS[activeEvent.type]}
            </div>

            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.5,
                color: "#111827",
                whiteSpace: "pre-wrap",
              }}
            >
              {activeEvent.message}
            </div>

            <div
              style={{
                marginTop: 7,
                fontSize: 11,
                color: "#6b7280",
              }}
            >
              {formatJapanTime(activeEvent.publishedAt)} 更新
            </div>

            <button
              type="button"
              onClick={handleResolve}
              disabled={sending}
              style={{
                width: "100%",
                marginTop: 13,
                padding: "11px 14px",
                borderRadius: 9,
                border: "1px solid #16a34a",
                backgroundColor: sending
                  ? "#e5e7eb"
                  : "#f0fdf4",
                color: sending
                  ? "#6b7280"
                  : "#166534",
                fontSize: 14,
                fontWeight: 800,
                cursor: sending ? "default" : "pointer",
              }}
            >
              <CheckCircle2
                size={17}
                style={{
                  verticalAlign: "middle",
                  marginRight: 7,
                }}
              />
              {sending ? "処理中..." : "表示を解除"}
            </button>
          </section>
        )}

       
        {/* 定型文 */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              marginTop: 8,
              marginBottom: 8, //追加
              fontSize: 20,
              fontWeight: 800,
              color: "#374151",
            }}
          >
            保存されている情報
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {templates.map((template) => {
              const selected =
                selectedTemplateId === template.id &&
                !customMessage.trim()

              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId(template.id)
                    setCustomMessage("")
                    setFeedback("")
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 13px",
                    borderRadius: 9,
                    border: selected
                      ? "2px solid #f59e0b"
                      : "1px solid #e5e7eb",
                    backgroundColor: selected
                      ? "#fffbeb"
                      : "white",
                    color: "#1f2937",
                    fontSize: 14,
                    fontWeight: selected ? 800 : 600,
                    lineHeight: 1.45,
                    cursor: "pointer",
                  }}
                >
                  {template.message}
                </button>
              )
            })}
          </div>
        </section>

        {/* 自由記述 */}
        <section style={{ marginBottom: 18 }}>
          <label
            htmlFor="operation-custom-message"
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: 13,
              fontWeight: 800,
              color: "#374151",
            }}
          >
            自由記述
          </label>

          <textarea
            id="operation-custom-message"
            value={customMessage}
            onChange={(event) => {
              const value = event.target.value

              setCustomMessage(value)

              if (value) {
                setSelectedTemplateId("")
              }

              setFeedback("")
            }}
            placeholder="保存されていない内容はこちらに入力"
            rows={5}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 13px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              resize: "vertical",
              fontSize: 16,
              lineHeight: 1.5,
              fontFamily: "inherit",
            }}
          />
        </section>

        {/* 送信内容 */}
        {outgoingMessage && (
          <div
            style={{
              padding: 12,
              marginBottom: 14,
              borderRadius: 10,
              backgroundColor: "#f3f4f6",
              color: "#374151",
              fontSize: 13,
              lineHeight: 1.5,
              overflowWrap: "anywhere",
            }}
          >
            <strong>送信内容</strong>
            <div
              style={{
                marginTop: 5,
                whiteSpace: "pre-wrap",
                fontSize: 13, //追加
              }}
            >
              {outgoingMessage}
            </div>
          </div>
        )}

        {/* 送信ボタン */}
        <button
          type="button"
          onClick={handlePublish}
          disabled={!outgoingMessage || sending}
          style={{
            width: "100%",
            padding: "14px 16px",
            border: "none",
            borderRadius: 11,
            backgroundColor:
              !outgoingMessage || sending
                ? "#9ca3af"
                : "#f59e0b",
            color: "white",
            fontSize: 16,
            fontWeight: 800,
            cursor:
              !outgoingMessage || sending
                ? "default"
                : "pointer",
            boxShadow:
              !outgoingMessage || sending
                ? "none"
                : "0 4px 12px rgba(245,158,11,0.30)",
          }}
        >
          <Send
            size={18}
            style={{
              verticalAlign: "middle",
              marginRight: 8,
            }}
          />
          {sending ? "処理中..." : "Web地図・LINEへ送信"}
        </button>

        {/* 処理結果 */}
        {feedback && (
          <div
            role="status"
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 8,
              backgroundColor: feedback.includes("失敗")
                ? "#fef2f2"
                : "#f0fdf4",
              color: feedback.includes("失敗")
                ? "#b91c1c"
                : "#166534",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            {feedback}
          </div>
        )}
      </aside>
    </main>
  )
}
