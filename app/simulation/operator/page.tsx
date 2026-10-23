"use client"

import { useEffect, useRef, useState } from "react"
import { getAuth, onAuthStateChanged } from "firebase/auth"
import { doc, onSnapshot } from "firebase/firestore"
import type { Map as LeafletMap } from "leaflet"

import { MapWrapper } from "@/components/map-wrapper"
import { app, db } from "@/lib/firebase"
import {
  publishSimulationEvent,
  resolveSimulationEvent,
  subscribeSimulationEvent,
} from "@/lib/simulation-events"
import type {
  LocationData,
  OperationEvent,
  OperationEventType,
} from "@/lib/types"

type Preset = {
  id: string
  message: string
  type: OperationEventType
}

const PRESETS: Preset[] = [
  { id: "wind", message: "風が気持ちいいです。", type: "notice" },
  { id: "traffic", message: "道路が渋滞しています。", type: "notice" },
  { id: "boarding", message: "乗り降りしています。", type: "notice" },
  { id: "stopped", message: "一時停止しています。", type: "stopped" },
]

export default function SimulationOperatorPage() {
  const [authChecked, setAuthChecked] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [locations, setLocations] = useState<LocationData[]>([])
  const [gpsStatus, setGpsStatus] = useState("未取得")
  const [sourceCollection, setSourceCollection] = useState("")
  const [gpsError, setGpsError] = useState("")
  const [activeEvent, setActiveEvent] = useState<OperationEvent | null>(null)
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [selected, setSelected] = useState("wind")
  const [customText, setCustomText] = useState("")
  const [customType, setCustomType] = useState<OperationEventType>("notice")
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState("")
  const centeredRef = useRef(false)
  const sourceRef = useRef("")
  const initialGpsSignatureRef = useRef<string | null>(null)

  // ログイン状態を確認。管理者権限はFirestoreルールで最終判定する。
  useEffect(() => {
    return onAuthStateChanged(getAuth(app), (user) => {
      setSignedIn(Boolean(user))
      setAuthChecked(true)
    })
  }, [])

  // GPS再生データのみ監視。本番のGPSコレクションは使用しない。
  useEffect(() => {
    return onSnapshot(
      doc(db, "simulation", "current"),
      (snapshot) => {
        setGpsError("")
        if (!snapshot.exists()) {
          setGpsStatus("GPS未作成")
          setLocations([])
          initialGpsSignatureRef.current ??= "（GPS未作成）"
          return
        }

        const data = snapshot.data()
        const status = typeof data.status === "string" ? data.status : "不明"
        setGpsStatus(status)
        setSourceCollection(
          typeof data.sourceCollection === "string" ? data.sourceCollection : "",
        )

        // 再読み込み時に以前のGPS位置を表示しない。
        const signature = `${String(data.sourceCollection ?? "")}::${String(data.pointIndex ?? "")}::${String(data.timestamp ?? "")}`
        if (initialGpsSignatureRef.current === null) {
          initialGpsSignatureRef.current = signature
          setLocations([])
          return
        }
        if (status === "stopped" || data.gpsVisible === false || initialGpsSignatureRef.current === signature) {
          setLocations([])
          sourceRef.current = ""
          centeredRef.current = false
          return
        }

        if (
          typeof data.latitude !== "number" ||
          typeof data.longitude !== "number" ||
          !Number.isFinite(data.latitude) ||
          !Number.isFinite(data.longitude)
        ) {
          setLocations([])
          return
        }

        const source = String(data.sourceCollection ?? "")
        const point: LocationData = {
          id: `${source}:${String(data.pointIndex ?? "?")}`,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp:
            typeof data.timestamp === "string"
              ? data.timestamp
              : new Date(),
          ...(typeof data.speed === "number" ? { speed: data.speed } : {}),
          ...(typeof data.heading === "number" ? { heading: data.heading } : {}),
          ...(typeof data.accuracy === "number" ? { accuracy: data.accuracy } : {}),
        }

        if (sourceRef.current !== source) {
          sourceRef.current = source
          centeredRef.current = false
          setLocations([point])
          return
        }

        setLocations((old) => {
          if (old.length && old[old.length - 1].id === point.id) return old
          const previousIndex = Number(old[old.length - 1]?.id?.split(":").pop())
          const nextIndex = Number(data.pointIndex)
          if (old.length && Number.isFinite(nextIndex) && nextIndex <= previousIndex) {
            centeredRef.current = false
            return [point]
          }
          return [...old.slice(-4), point]
        })
      },
      (error) => setGpsError(`GPS受信エラー：${error.message}`),
    )
  }, [])

  // テスト用の運行情報だけを監視する。
  useEffect(() => {
    return subscribeSimulationEvent(setActiveEvent)
  }, [])

  // 最初のGPS受信時にグリスロの位置へ移動する。
  useEffect(() => {
    if (!map || !locations.length || centeredRef.current) return
    const latest = locations[locations.length - 1]
    map.setView([latest.latitude, latest.longitude], 16)
    centeredRef.current = true
  }, [map, locations])

  const latest = locations[locations.length - 1]
  const preset = PRESETS.find((item) => item.id === selected)
  const isCustom = selected === "custom"
  const outgoingMessage = isCustom ? customText.trim() : preset?.message ?? ""
  const outgoingType: OperationEventType = isCustom
    ? customType
    : preset?.type ?? "notice"

  async function handleSend() {
    if (!signedIn || sending) return
    setFeedback("")
    if (!latest) {
      setFeedback("GPSがありません。先に /simulation で再生してください。")
      return
    }
    if (!outgoingMessage || outgoingMessage.length > 500) {
      setFeedback("運行情報は1〜500文字で入力してください。")
      return
    }

    setSending(true)
    try {
      await publishSimulationEvent({
        type: outgoingType,
        message: outgoingMessage,
        source: isCustom ? "custom" : "preset",
        vehicleLatitude: latest.latitude,
        vehicleLongitude: latest.longitude,
      })
      setFeedback("テスト用Firestoreに送信しました。公式LINEには送信していません。")
      if (isCustom) setCustomText("")
    } catch (error) {
      console.error("[simulation-operator] 送信エラー:", error)
      setFeedback("送信に失敗しました。管理者UIDとFirestoreルールを確認してください。")
    } finally {
      setSending(false)
    }
  }

  async function handleResolve() {
    if (!signedIn || sending || !activeEvent) return
    setFeedback("")
    setSending(true)
    try {
      await resolveSimulationEvent()
      setFeedback("テスト用運行情報を解除しました。")
    } catch (error) {
      console.error("[simulation-operator] 解除エラー:", error)
      setFeedback("解除に失敗しました。Firestoreの書き込み権限を確認してください。")
    } finally {
      setSending(false)
    }
  }

  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-slate-100 text-slate-900"
      style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden" }}
    >
      <div className="absolute inset-0" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
        <MapWrapper
          locations={locations}
          activeEvent={activeEvent}
          onMapReady={setMap}
        />
      </div>

      <aside
        className="absolute bottom-3 right-3 top-3 z-[1000] w-[min(390px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xl"
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          bottom: 12,
          width: "min(390px, calc(100vw - 24px))",
          maxHeight: "calc(100vh - 24px)",
          overflowY: "auto",
          zIndex: 20000,
          backgroundColor: "rgba(255, 255, 255, 0.97)",
          padding: 16,
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
          color: "#0f172a",
          boxSizing: "border-box",
        }}
      >
        <p className="text-sm font-bold text-orange-600">テスト環境・LINE送信なし</p>
        <h1 className="mt-1 text-xl font-bold">運行情報の送信</h1>
        <nav className="mt-2 flex flex-wrap gap-3 text-sm">
          <a href="/simulation" className="text-blue-700 underline">GPS再生画面</a>
          <a href="/simulation/view" className="text-blue-700 underline">GPS閲覧画面</a>
        </nav>

        <section className="mt-4 rounded-lg bg-slate-100 p-3 text-sm">
          <p>GPS状態：<strong>{gpsStatus}</strong></p>
          <p>元の運行記録：{sourceCollection || "未選択"}</p>
          <p>位置情報：{latest ? "受信済み" : "未受信"}</p>
          {gpsError && <p role="alert" className="text-red-700">{gpsError}</p>}
        </section>

        {authChecked && !signedIn && (
          <p role="alert" className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
            管理者画面からFirebaseにログインしてください。
          </p>
        )}

        <label className="mt-4 block text-sm font-semibold" htmlFor="event-preset">
          送信する定型文
        </label>
        <select
          id="event-preset"
          className="mt-2 w-full rounded border border-slate-300 bg-white p-3"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {PRESETS.map((item) => (
            <option key={item.id} value={item.id}>{item.message}</option>
          ))}
          <option value="custom">自由入力</option>
        </select>

        {isCustom && (
          <div className="mt-3 space-y-3">
            <label className="block text-sm font-semibold" htmlFor="event-type">
              運行情報の種類
            </label>
            <select
              id="event-type"
              className="w-full rounded border border-slate-300 bg-white p-3"
              value={customType}
              onChange={(event) => setCustomType(event.target.value as OperationEventType)}
            >
              <option value="notice">お知らせ</option>
              <option value="delay">遅延</option>
              <option value="stopped">一時停止</option>
            </select>
            <label className="block text-sm font-semibold" htmlFor="custom-message">
              自由入力（500文字以内）
            </label>
            <textarea
              id="custom-message"
              rows={4}
              maxLength={500}
              className="w-full rounded border border-slate-300 p-3"
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              placeholder="運行情報を入力してください"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!signedIn || !latest || !outgoingMessage || sending}
          className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "処理中..." : "運行情報をテスト送信"}
        </button>

        <section className="mt-5 rounded-lg border border-slate-200 p-3 text-sm">
          <h2 className="font-bold">現在表示中の運行情報</h2>
          {activeEvent ? (
            <>
              <p className="mt-2 whitespace-pre-wrap">{activeEvent.message}</p>
              <button
                type="button"
                onClick={() => void handleResolve()}
                disabled={!signedIn || sending}
                className="mt-3 rounded bg-slate-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
              >
                運行情報を解除
              </button>
            </>
          ) : (
            <p className="mt-2 text-slate-500">運行情報はありません。</p>
          )}
        </section>

        {feedback && (
          <p role="status" className="mt-3 rounded bg-slate-100 p-3 text-sm">
            {feedback}
          </p>
        )}
        <p className="mt-4 text-xs text-slate-500">
          この画面は simulation/current と simulation-events/current のみを使用します。
          本番の運行情報やLINEには送信しません。
        </p>
      </aside>
    </main>
  )
}
