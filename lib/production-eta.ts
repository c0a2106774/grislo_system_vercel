/**
 * 本番グリスロ用 ETA。Firestoreへの書き込みは一切しない。
 * 距離と進行方向は simulation-eta の循環ルート計算を再利用する。
 * Android Location.getSpeed() は m/s として扱う。
 */
import { estimateRouteEta } from "@/lib/simulation-eta"
import type { LocationData } from "@/lib/types"

export type GeoPoint = { lat: number; lng: number }
export type ProductionEta =
  | {
      kind: "ok"
      minutes: number
      seconds: number
      arrivalAtMs: number
      distanceMeters: number
      speedKmh: number
      avgAccelerationMps2: number
      usedDefaultSpeed: boolean
      nextLap: boolean
      directionAssumed: boolean
    }
  | { kind: "unavailable"; message: string }

// AndroidのGPS送信間隔・実地での精度に応じて調整してください。
export const ETA_MAX_GPS_AGE_MS = 90_000
export const ETA_MAX_USER_ROUTE_OFFSET_M = 80
export const ETA_MAX_VEHICLE_ROUTE_OFFSET_M = 60
const MAX_ROUTE_POINTS = 20_000
const METERS_PER_DEGREE = 111_195
const DEFAULT_SPEED_MPS = 10 / 3.6
const MAX_SPEED_MPS = 5.7 // ほぼ20km/h
const MIN_PREDICTION_SPEED_MPS = 0.8

type TimedPoint = LocationData & { atMs: number }

function finiteCoordinate(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/** Androidの「2026-09-29 14:18:00」は日本時間として扱う。 */
export function locationTimeMs(value: string | Date): number {
  if (value instanceof Date) return value.getTime()
  const raw = String(value ?? "").trim()
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(" ", "T")}+09:00`
    : raw
  return Date.parse(normalized)
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value))
}

/** 地図上の線分までの最短距離。ピンと車両がルート付近かどうかの判定専用。 */
export function distanceToRouteMeters(point: GeoPoint, route: [number, number][]): number {
  if (!finiteCoordinate(point.lat, point.lng) || route.length < 2 || route.length > MAX_ROUTE_POINTS) {
    return Infinity
  }
  const cos = Math.cos(point.lat * Math.PI / 180)
  let minimum = Infinity
  for (let i = 0; i < route.length - 1; i++) {
    const [latA, lngA] = route[i]
    const [latB, lngB] = route[i + 1]
    if (!finiteCoordinate(latA, lngA) || !finiteCoordinate(latB, lngB)) continue
    const ax = (lngA - point.lng) * METERS_PER_DEGREE * cos
    const ay = (latA - point.lat) * METERS_PER_DEGREE
    const dx = (lngB - lngA) * METERS_PER_DEGREE * cos
    const dy = (latB - latA) * METERS_PER_DEGREE
    const denom = dx * dx + dy * dy
    const f = denom > 0 ? clamp(-(ax * dx + ay * dy) / denom, 0, 1) : 0
    minimum = Math.min(minimum, Math.hypot(ax + f * dx, ay + f * dy))
  }
  return minimum
}

/**
 * 直近のGPS速度の平均。過去60秒・最大10点。
 * 速度の差 / 秒数 で平均加速度を求め、3秒先の速度変化だけを小さく補正する。
 * 停車・乗降・カーブがあるため、加速度を到着まで長時間外挿しない。
 */
export function estimateCruiseSpeed(points: TimedPoint[]):
  | { kind: "ok"; speedMps: number; avgAccelerationMps2: number; usedDefaultSpeed: boolean }
  | { kind: "stopped" } {
  const recent = points.slice(-10)
  const valid = recent.filter((p) => typeof p.speed === "number" && Number.isFinite(p.speed)
    && p.speed >= 0 && p.speed <= MAX_SPEED_MPS)

  if (!valid.length) {
    return { kind: "ok", speedMps: DEFAULT_SPEED_MPS, avgAccelerationMps2: 0, usedDefaultSpeed: true }
  }

  // 10秒以上、連続したGPSがほぼ停止を示す場合、無理に時刻を予測しない。
  const lastThree = valid.slice(-3)
  if (lastThree.length === 3 && lastThree.every((p) => (p.speed ?? 0) <= 0.4)
      && lastThree[2].atMs - lastThree[0].atMs >= 10_000) {
    return { kind: "stopped" }
  }

  const avgSpeed = valid.reduce((sum, p) => sum + (p.speed ?? 0), 0) / valid.length
  if (avgSpeed < 0.4) return { kind: "stopped" }

  const accelerations: number[] = []
  for (let i = 1; i < valid.length; i++) {
    const dt = (valid[i].atMs - valid[i - 1].atMs) / 1000
    if (dt < 1 || dt > 30) continue
    const a = ((valid[i].speed ?? 0) - (valid[i - 1].speed ?? 0)) / dt
    // 明らかに異常な速度変化は除外する。
    if (Math.abs(a) <= 1.2) accelerations.push(a)
  }
  const avgAcceleration = accelerations.length
    ? accelerations.reduce((sum, a) => sum + a, 0) / accelerations.length
    : 0
  // 補正幅を平均速度の±15%、かつ±0.35m/s以内に抑える。
  const maxAdjustment = Math.min(0.35, avgSpeed * 0.15)
  const adjustment = clamp(avgAcceleration * 3, -maxAdjustment, maxAdjustment)
  return {
    kind: "ok",
    speedMps: clamp(avgSpeed + adjustment, MIN_PREDICTION_SPEED_MPS, MAX_SPEED_MPS),
    avgAccelerationMps2: avgAcceleration,
    usedDefaultSpeed: false,
  }
}

export function estimateProductionEta(args: {
  route: [number, number][]
  locations: LocationData[]
  userLocation: GeoPoint | null
  nowMs: number
}): ProductionEta {
  const { route, locations, userLocation, nowMs } = args
  if (!userLocation || !finiteCoordinate(userLocation.lat, userLocation.lng)) {
    return { kind: "unavailable", message: "端末の現在地を取得してください。" }
  }
  if (route.length < 2 || route.length > MAX_ROUTE_POINTS) {
    return { kind: "unavailable", message: "循環ルートを確認中です。" }
  }

  const userOffset = distanceToRouteMeters(userLocation, route)
  if (userOffset > ETA_MAX_USER_ROUTE_OFFSET_M) {
    return { kind: "unavailable", message: `現在地が循環ルートから約${Math.round(userOffset)}m離れています。` }
  }

  // timestamp順で来る想定だが、同時刻のGPSなどを考えて小範囲のみ再ソート。
  const valid = locations.slice(-40)
    .filter((p) => finiteCoordinate(p.latitude, p.longitude))
    .map((p) => ({ ...p, atMs: locationTimeMs(p.timestamp) }))
    .filter((p) => Number.isFinite(p.atMs))
    .sort((a, b) => a.atMs - b.atMs)
  if (!valid.length) return { kind: "unavailable", message: "グリスロのGPSを取得中です。" }

  const latest = valid[valid.length - 1]
  const age = nowMs - latest.atMs
  if (age > ETA_MAX_GPS_AGE_MS || age < -30_000) {
    return { kind: "unavailable", message: "グリスロの位置情報の更新を待っています。" }
  }

  const vehicleOffset = distanceToRouteMeters(
    { lat: latest.latitude, lng: latest.longitude }, route,
  )
  if (vehicleOffset > ETA_MAX_VEHICLE_ROUTE_OFFSET_M) {
    return { kind: "unavailable", message: "グリスロが循環ルートに入ると自動計算します。" }
  }

  const recent = valid.filter((p) => p.atMs >= latest.atMs - 60_000).slice(-10)
  const geometry = estimateRouteEta(route, recent, userLocation)
  if (geometry.kind !== "ok") return geometry

  const cruise = estimateCruiseSpeed(recent)
  if (cruise.kind === "stopped") {
    return { kind: "unavailable", message: "グリスロが停車中のため、到着予想を更新待ちです。" }
  }

  const travelSeconds = geometry.distanceMeters / cruise.speedMps
  if (!Number.isFinite(travelSeconds) || travelSeconds > 3 * 3600) {
    return { kind: "unavailable", message: "到着予想時刻を計算できません。" }
  }
  // 最終GPSの受信時刻を起点に到着予想を作り、時計の進みで残り時間が減る。
  const arrivalAtMs = latest.atMs + travelSeconds * 1000
  const seconds = Math.max(0, Math.ceil((arrivalAtMs - nowMs) / 1000))
  return {
    kind: "ok",
    seconds,
    minutes: Math.ceil(seconds / 60),
    arrivalAtMs,
    distanceMeters: geometry.distanceMeters,
    speedKmh: Math.round(cruise.speedMps * 36) / 10,
    avgAccelerationMps2: cruise.avgAccelerationMps2,
    usedDefaultSpeed: cruise.usedDefaultSpeed,
    nextLap: geometry.nextLap,
    directionAssumed: geometry.directionAssumed,
  }
}
