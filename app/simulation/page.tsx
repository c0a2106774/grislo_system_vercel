"use client"

import { onAuthStateChanged, getAuth } from "firebase/auth"
import { deleteField, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LeafletMouseEvent, Map as LeafletMap } from "leaflet"
import { MapWrapper } from "@/components/map-wrapper"
import { parseTimetableStops, useSimulationTimetableMarkers } from "@/components/simulation-timetable-markers"
import type { TimetableStop } from "@/components/simulation-timetable-markers"
import { app, db, getAllLocationsFromCollection, getDateCollections, getSavedRoutes, getSavedRoute } from "@/lib/firebase"
import type { LocationData } from "@/lib/types"

const simulationRef = doc(db, "simulation", "current")

type PlaybackStatus = "playing" | "paused" | "stopped" | "completed"

// Android端末の日本時間文字列「2026-09-29 14:18:00」も正しく扱う。
function timestampMs(value: string | Date): number {
  if (value instanceof Date) return value.getTime()
  const raw = String(value).trim()
  const jst = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}+09:00`
    : raw
  return new Date(jst).getTime()
}

function originalTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

export default function SimulationControlPage() {
  const [signedIn, setSignedIn] = useState(false)
  const [collections, setCollections] = useState<string[]>([])
  const [selected, setSelected] = useState("")
  const [routes, setRoutes] = useState<{ id: string; name: string; pointCount: number }[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState("")
  const [savingRoute, setSavingRoute] = useState(false)
  const [routeError, setRouteError] = useState("")
  const [points, setPoints] = useState<LocationData[]>([])
  const [speed, setSpeed] = useState(1)
  const [jumpInput, setJumpInput] = useState(1)
  const [seeking, setSeeking] = useState(false)
  const [map, setMap] = useState<LeafletMap | null>(null)
  const [routePreview, setRoutePreview] = useState<[number, number][]>([])
  const [timetableStops, setTimetableStops] = useState<TimetableStop[]>([])
  const [pinMode, setPinMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<{ latitude: number; longitude: number } | null>(null)
  const [pinName, setPinName] = useState("")
  const [pinTime, setPinTime] = useState("10:00")
  const [savingStops, setSavingStops] = useState(false)
  const [pinError, setPinError] = useState("")
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [resettingGps, setResettingGps] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const previewPath = useMemo<[number, number][]>(() => routePreview.length
    ? routePreview
    : points.map((p) => [p.latitude, p.longitude]), [routePreview, points])
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenRef = useRef(0)

  function cancelTimer() {
    tokenRef.current += 1
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setPlaying(false)
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuth(app), (user) => {
      setSignedIn(Boolean(user))
    })
    return unsubscribe
  }, [])

  // 管理画面を開き直したら、以前配信した「現在位置」だけを消す。
  // ルート設定・時刻表・過去のGPS履歴は残す。
  useEffect(() => {
    if (!signedIn) return
    let alive = true
    const resetOnOpen = async () => {
      // 前回の再生タイマーを停止する。
      tokenRef.current += 1
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
      timeoutRef.current = null
      setPlaying(false)
      setIndex(-1)
      setJumpInput(1)
      setResettingGps(true)
      try {
        await clearCurrentGps()
      } catch (e) {
        if (alive) setError(`リロード時の現在位置クリアに失敗しました：${String(e)}`)
      } finally {
        if (alive) setResettingGps(false)
      }
    }
    void resetOnOpen()
    return () => { alive = false }
  }, [signedIn])

  useEffect(() => {
    let alive = true
    getDateCollections()
      .then((items) => {
        if (alive) setCollections(items)
      })
      .catch(() => {
        if (alive) setError("運行一覧を取得できませんでした。")
      })
    return () => {
      alive = false
      tokenRef.current += 1
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    }
  }, [])

  // 既存の saved-routes 一覧は管理者のみ取得可能。
  useEffect(() => {
    if (!signedIn) {
      setRoutes([])
      return
    }
    let alive = true
    void getSavedRoutes()
      .then((items) => {
        if (alive) setRoutes(items)
      })
      .catch((e) => {
        if (alive) setRouteError(`ルート一覧取得エラー：${String(e)}`)
      })
    return () => { alive = false }
  }, [signedIn])

  // 他のタブから変更されたルート選択も反映する。
  useEffect(() => {
    return onSnapshot(simulationRef, (snapshot) => {
      const value = snapshot.data()?.selectedRouteId
      setSelectedRouteId(typeof value === "string" ? value : "")
      const receivedStops = parseTimetableStops(snapshot.data()?.timetableStops)
      setTimetableStops((prev) => JSON.stringify(prev) === JSON.stringify(receivedStops) ? prev : receivedStops)
    }, (e) => setRouteError(`ルート設定の受信に失敗しました：${e.message}`))
  }, [])

  // 地図用のルート形状（ルート変更時は青線と表示範囲を更新）。
  useEffect(() => {
    let alive = true
    setRoutePreview([])
    if (!selectedRouteId) return
    void getSavedRoute(selectedRouteId).then((route) => {
      if (!alive || !route) return
      const coords: [number, number][] = (route.points ?? [])
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => [p.lat, p.lng])
      setRoutePreview(coords)
      if (map && coords.length) map.fitBounds(coords, { padding: [20, 20], maxZoom: 16 })
    }).catch((e) => { if (alive) setRouteError(`地図の読み込みエラー：${String(e)}`) })
    return () => { alive = false }
  }, [selectedRouteId, map])

  // 時刻表ピンの追加先を地図上で選択。
  useEffect(() => {
    if (!map || !pinMode) return
    const node = map.getContainer()
    const oldCursor = node.style.cursor
    node.style.cursor = "crosshair"
    const onClick = (e: LeafletMouseEvent) => {
      setPendingPin({ latitude: e.latlng.lat, longitude: e.latlng.lng })
      setPinMode(false)
      setPinError("")
    }
    map.on("click", onClick)
    return () => { map.off("click", onClick); node.style.cursor = oldCursor }
  }, [map, pinMode])

  useSimulationTimetableMarkers(map, timetableStops)

  async function saveTimetable(next: TimetableStop[]) {
    if (!signedIn || savingStops) return
    setSavingStops(true)
    setPinError("")
    try {
      // 再生処理も merge:true なので、GPS更新時に時刻表が消えることはない。
      await setDoc(simulationRef, { timetableStops: next }, { merge: true })
      setTimetableStops(next)
      setPendingPin(null)
      setPinName("")
    } catch (e) {
      setPinError(`時刻表の保存に失敗しました：${String(e)}`)
    } finally {
      setSavingStops(false)
    }
  }

  async function addStop() {
    if (!pendingPin) return
    const name = pinName.trim()
    if (!name || name.length > 80 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(pinTime)) {
      setPinError("地点名（1〜80文字）と時刻（HH:mm）を設定してください。")
      return
    }
    if (timetableStops.length >= 50) {
      setPinError("時刻表は最大50地点まで登録できます。")
      return
    }
    const next: TimetableStop[] = [...timetableStops, {
      id: crypto.randomUUID(), name, time: pinTime, ...pendingPin,
    }].sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name))
    await saveTimetable(next)
  }

  async function removeStop(id: string) {
    await saveTimetable(timetableStops.filter((s) => s.id !== id))
  }

  async function chooseRoute(routeId: string) {
    if (!signedIn || savingRoute) return
    setSavingRoute(true)
    setRouteError("")
    try {
      // GPSと同じシミュレーション専用ドキュメントへ設定を書き込む。
      await setDoc(simulationRef, { selectedRouteId: routeId }, { merge: true })
      setSelectedRouteId(routeId)
    } catch (e) {
      setRouteError(`ルートの選択に失敗しました：${String(e)}`)
    } finally {
      setSavingRoute(false)
    }
  }

  async function chooseCollection(name: string) {
    cancelTimer()
    setSelected(name)
    setIndex(-1)
    setJumpInput(1)
    setPoints([])
    setError("")
    if (!name) return
    setLoading(true)
    try {
      const result = await getAllLocationsFromCollection(name)
      const valid = result
        .filter((p) =>
          Number.isFinite(p.latitude) &&
          Number.isFinite(p.longitude) &&
          Number.isFinite(timestampMs(p.timestamp)),
        )
        .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))
      setPoints(valid)
      if (map && valid.length && !selectedRouteId) {
        const bounds: [number, number][] = valid.map((p) => [p.latitude, p.longitude])
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 })
      }
      if (valid.length === 0) {
        setError("GPS記録がありません。Firestoreの読み取り権限も確認してください。")
      }
    } catch (e) {
      setError(`GPS履歴の取得に失敗しました：${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function clearCurrentGps() {
    // 古い緯度・経度を削除し、明示的に非表示状態にする。
    // merge:true により selectedRouteId/timetableStops は保持される。
    await setDoc(simulationRef, {
      status: "stopped",
      gpsVisible: false,
      latitude: deleteField(),
      longitude: deleteField(),
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }

  async function updateStatus(status: PlaybackStatus) {
    try {
      if (status === "stopped") {
        await clearCurrentGps()
      } else {
        await setDoc(simulationRef, {
          status,
          updatedAt: serverTimestamp(),
        }, { merge: true })
      }
    } catch (e) {
      setError(`状態の更新に失敗しました：${String(e)}`)
    }
  }

  // 任意位置の1点をFirestoreに配信する（再生・位置指定で共用）。
  async function writePoint(position: number, status: PlaybackStatus): Promise<void> {
    const point = points[position]
    if (!point) throw new Error("指定したGPS記録がありません")
    await setDoc(simulationRef, {
      sourceCollection: selected,
      sourceTimestamp: originalTimestamp(point.timestamp),
      pointIndex: position,
      totalPoints: points.length,
      latitude: point.latitude,
      longitude: point.longitude,
      gpsVisible: true,
      speed: point.speed ?? null,
      accuracy: point.accuracy ?? null,
      heading: point.heading ?? null,
      timestamp: new Date().toISOString(),
      speedMultiplier: speed,
      status,
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }

  async function jumpTo(position: number, startPlaying: boolean) {
    if (!signedIn || resettingGps || points.length === 0 || seeking) return
    if (!Number.isInteger(position) || position < 0 || position >= points.length) {
      setError(`配信位置は1〜${points.length}で指定してください。`)
      return
    }
    cancelTimer()
    setError("")
    setJumpInput(position + 1)
    if (startPlaying) {
      setPlaying(true)
      const token = ++tokenRef.current
      void publishPoint(position, token)
    } else {
      setSeeking(true)
      try {
        await writePoint(position, "paused")
        setIndex(position)
      } catch (e) {
        setError(`指定位置への移動に失敗しました：${String(e)}`)
      } finally {
        setSeeking(false)
      }
    }
  }

  async function publishPoint(position: number, token: number) {
    if (token !== tokenRef.current) return
    const point = points[position]
    if (!point) {
      setPlaying(false)
      return
    }

    const isLast = position === points.length - 1
    try {
      await writePoint(position, isLast ? "completed" : "playing")
    } catch (e) {
      if (token === tokenRef.current) {
        cancelTimer()
        setError(`GPS配信に失敗しました：${String(e)}`)
      }
      return
    }
    if (token !== tokenRef.current) return
    setIndex(position)
    setJumpInput(position + 1)
    if (isLast) {
      setPlaying(false)
      return
    }

    const originalGap =
      timestampMs(points[position + 1].timestamp) - timestampMs(point.timestamp)
    // 同じドキュメントへの過剰な連続書き込みを防ぐため最短1秒に制限。
    const delay = Math.max(1000, Math.min(60000, originalGap / speed))
    timeoutRef.current = setTimeout(() => {
      void publishPoint(position + 1, token)
    }, delay)
  }

  function start() {
    if (!signedIn) {
      setError("管理者としてログインした状態で開いてください。")
      return
    }
    if (playing || seeking || resettingGps || points.length === 0) return
    setError("")
    setPlaying(true)
    const token = ++tokenRef.current
    const nextIndex = index + 1 >= points.length ? 0 : index + 1
    void publishPoint(nextIndex, token)
  }

  function pause() {
    cancelTimer()
    void updateStatus("paused")
  }

  function stop() {
    cancelTimer()
    setIndex(-1)
    void updateStatus("stopped")
  }

  return (
    <main
      className="min-h-screen bg-slate-50 p-6 text-slate-900"
      style={{ position: "relative", minHeight: "100vh", overflowX: "hidden" }}
    >
      <section
        className="mx-auto max-w-2xl space-y-5 rounded-xl bg-white p-6 shadow"
        style={{ position: "relative", zIndex: 1 }}
      >
        <div>
          <p className="mb-1 text-sm font-bold text-orange-600">テスト環境・本番には配信しません</p>
          <h1 className="text-2xl font-bold">グリスロGPSシミュレーター</h1>
          <p className="mt-2 text-sm text-slate-600">
            過去の運行記録を、現在受信中のGPSとしてsimulation/currentへ配信します。
          </p>
        </div>

        {resettingGps && signedIn && (
          <p role="status" className="rounded bg-blue-50 p-3 text-blue-800">前回の現在位置をクリアしています...</p>
        )}

        {!signedIn && (
          <p role="alert" className="rounded bg-amber-50 p-3 text-amber-800">
            Firebaseの管理者ログインが必要です。
          </p>
        )}

        <label className="block space-y-2">
          <span className="font-semibold">再生する過去の運行</span>
          <select
            className="w-full rounded border border-slate-300 bg-white p-3"
            value={selected}
            disabled={playing || loading}
            onChange={(e) => void chooseCollection(e.target.value)}
          >
            <option value="">運行記録を選択</option>
            {collections.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="font-semibold">地図に表示する循環ルート</span>
          <select
            className="w-full rounded border border-slate-300 bg-white p-3"
            value={selectedRouteId}
            disabled={!signedIn || savingRoute}
            onChange={(e) => void chooseRoute(e.target.value)}
          >
            <option value="">ルートを表示しない</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name}（{route.pointCount}地点）
              </option>
            ))}
            {selectedRouteId && !routes.some((route) => route.id === selectedRouteId) && (
              <option value={selectedRouteId}>{selectedRouteId}（保存済み選択）</option>
            )}
          </select>
          <span className="block text-xs text-slate-600">
            Firebaseの saved-routes に登録されたルートから選べます。
            選択後は利用者画面へ自動反映され、GPS再生を停止しても選択は残ります。
          </span>
          {signedIn && routes.length === 0 && (
            <span className="block text-xs text-amber-700">
              ルートがありません。saved-routes の登録内容と管理者の list 権限を確認してください。
            </span>
          )}
          {routeError && <span role="alert" className="block text-xs text-red-700">{routeError}</span>}
        </label>

        <section className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="text-lg font-bold">配信位置を指定する</h2>
          <p className="text-sm text-slate-700">例：30 / 100 の「30」を指定できます。まず運行記録を読み込んでください。</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" min={1} max={Math.max(1, points.length)} step={1}
              value={jumpInput}
              onChange={(e) => setJumpInput(Number(e.target.value))}
              disabled={!points.length || seeking}
              aria-label="配信位置（何件目）"
              className="w-24 rounded border border-slate-300 bg-white p-2 text-slate-900" />
            <span className="font-bold">/ {points.length}</span>
          </div>
          {points.length > 1 && (
            <input type="range" min={1} max={points.length} step={1}
              value={Math.min(points.length, Math.max(1, jumpInput || 1))}
              onChange={(e) => setJumpInput(Number(e.target.value))}
              disabled={seeking}
              aria-label="GPS履歴の再生位置"
              className="w-full" />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void jumpTo(jumpInput - 1, false)}
              disabled={!signedIn || resettingGps || !points.length || seeking}
              className="rounded bg-white px-4 py-2 font-semibold text-blue-800 border border-blue-700 disabled:opacity-40">
              指定位置に移動（停止）
            </button>
            <button type="button" onClick={() => void jumpTo(jumpInput - 1, true)}
              disabled={!signedIn || resettingGps || !points.length || seeking}
              className="rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-40">
              指定位置から再生
            </button>
          </div>
          <p className="text-xs text-slate-600">位置に移動するとその地点のGPSを即時配信し一時停止します。通常の「再開」は次の地点から進みます。</p>
        </section>

        <section className="space-y-3 rounded-lg border border-rose-200 bg-white p-4">
          <h2 className="text-lg font-bold">時刻表・地図上の乗車地点</h2>
          <p className="text-sm text-slate-700">地図をクリックして場所を決め、地点名と予定時刻を入力します。複数地点を登録・削除でき、利用者画面にも表示されます。</p>
          {/* 地図をこのボックス内に限定する。Leaflet内部は position:absolute。 */}
          <div
            className="relative h-[340px] overflow-hidden rounded-lg border border-slate-300 bg-slate-100"
            style={{
              position: "relative",
              width: "100%",
              height: 340,
              minHeight: 340,
              overflow: "hidden",
              isolation: "isolate",
              zIndex: 0,
              boxSizing: "border-box",
              backgroundColor: "#f1f5f9",
            }}
          >
            <MapWrapper
              locations={[]}
              plannedRoute={previewPath}
              onMapReady={setMap}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!signedIn || !map || savingStops}
              onClick={() => { setPinMode((old) => !old); setPendingPin(null); setPinError("") }}
              className="rounded bg-rose-700 px-4 py-2 font-semibold text-white disabled:opacity-40">
              {pinMode ? "位置選択をキャンセル" : "＋ 地図でピンの位置を選ぶ"}
            </button>
            {pinMode && <span className="self-center text-sm font-semibold text-rose-800">地図上の場所をクリックしてください</span>}
          </div>
          {pendingPin && (
            <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm font-bold">選択した地点（{pendingPin.latitude.toFixed(6)}, {pendingPin.longitude.toFixed(6)}）</p>
              <label className="block space-y-1"><span className="block text-sm font-semibold">地点名</span>
                <input type="text" maxLength={80} value={pinName} placeholder="例：ヤンマー前"
                  onChange={(e) => setPinName(e.target.value)} className="w-full rounded border border-slate-300 bg-white p-2" /></label>
              <label className="block space-y-1"><span className="block text-sm font-semibold">到着予定時刻</span>
                <input type="time" value={pinTime} onChange={(e) => setPinTime(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white p-2" /></label>
              <div className="flex gap-2">
                <button type="button" onClick={() => void addStop()} disabled={savingStops}
                  className="rounded bg-rose-700 px-4 py-2 font-semibold text-white disabled:opacity-40">地点を登録</button>
                <button type="button" onClick={() => setPendingPin(null)}
                  className="rounded border border-slate-400 bg-white px-4 py-2">取り消す</button>
              </div>
            </div>
          )}
          <h3 className="font-bold">登録済み時刻表（{timetableStops.length}地点）</h3>
          {timetableStops.length ? (
            <ol className="space-y-2">
              {timetableStops.map((stop) => (
                <li key={stop.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3">
                  <strong className="whitespace-nowrap tabular-nums">{stop.time}</strong>
                  <span className="min-w-0 flex-1 break-words">{stop.name}</span>
                  <button type="button" disabled={!signedIn || savingStops}
                    onClick={() => void removeStop(stop.id)}
                    className="rounded border border-red-400 bg-white px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-40">
                    削除
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-slate-500">まだピンが登録されていません。</p>}
          {pinError && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{pinError}</p>}
          <p className="text-xs text-slate-600">この時刻表はシミュレーション表示専用です。設定時刻に合わせてGPS再生速度や車両位置を自動変更するものではありません。</p>
        </section>

        <label className="block space-y-2">
          <span className="font-semibold">再生速度</span>
          <select
            className="w-full rounded border border-slate-300 bg-white p-3"
            value={speed}
            disabled={playing}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[1, 2, 5, 10].map((rate) => (
              <option key={rate} value={rate}>{rate}倍速</option>
            ))}
          </select>
        </label>

        <div className="rounded-lg bg-slate-100 p-4">
          <p>読み込み済みGPS記録：<strong>{points.length}件</strong></p>
          <p>配信位置：<strong>{Math.max(index + 1, 0)} / {points.length}</strong></p>
          <p>現在の状態：<strong>{playing ? "再生中" : "停止中・一時停止中"}</strong></p>
          {loading && <p>GPS履歴を読み込み中...</p>}
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={start} disabled={!signedIn || resettingGps || playing || seeking || !points.length}
            className="rounded bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-40">
            {index < 0 || index >= points.length - 1 ? "▶ 再生" : "▶ 再開"}
          </button>
          <button type="button" onClick={pause} disabled={!playing}
            className="rounded bg-amber-500 px-5 py-3 font-semibold text-white disabled:opacity-40">
            一時停止
          </button>
          <button type="button" onClick={stop} disabled={!signedIn}
            className="rounded bg-slate-700 px-5 py-3 font-semibold text-white disabled:opacity-40">
            停止・リセット
          </button>
        </div>
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
        <a className="inline-block font-semibold text-blue-700 underline" href="/simulation/view" target="_blank" rel="noopener noreferrer">
          GPS閲覧画面を別タブで開く →
        </a>
        <p className="text-xs text-slate-500">
          再生中はこの画面を開いたままにしてください。バックグラウンドタブでは再生間隔が遅れる場合があります。
          Firestoreへの配信は最短1秒間隔に制限しています。
        </p>
      </section>
    </main>
  )
}
