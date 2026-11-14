/**
 * GPS再生中のグリスロが、利用者の指定位置に最も近い循環ルートを
 * 次に通過するまでの概算時間を計算する（読み取り専用・Firebase操作なし）。
 *
 * - ルートは saved-routes の記録順に走るものとする。
 * - 速度は Android Location.getSpeed の m/s を使用する。
 * - 速度情報が得られないときは仮に時速10kmで計算する。
 * - 1.25倍表示は共通ルートのremベースの文字サイズ設定に従う。
 */

export type GeoPoint = { lat: number; lng: number }
export type VehiclePoint = {
  latitude: number
  longitude: number
  speed?: number
}

export type RouteEtaResult =
  | {
      kind: "ok"
      minutes: number
      seconds: number
      distanceMeters: number
      offsetMeters: number
      speedKmh: number
      speedIsFallback: boolean
      direction: "forward" | "reverse"
      directionAssumed: boolean
      nextLap: boolean
    }
  | { kind: "unavailable"; message: string }

const METERS_PER_DEGREE = 111_195
const MAX_VEHICLE_ROUTE_OFFSET_METERS = 100
const DEFAULT_SPEED_MPS = 10 / 3.6 // 仮に時速10km
const MIN_SPEED_MPS = 0.7
const MAX_SPEED_MPS = 5.7 // グリスロの速度上限20km/hに近い値
const MAX_ROUTE_POINTS = 20000

function usableCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

function metersBetween(a: GeoPoint, b: GeoPoint): number {
  const referenceLatitude = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const dx = (b.lng - a.lng) * METERS_PER_DEGREE * Math.cos(referenceLatitude)
  const dy = (b.lat - a.lat) * METERS_PER_DEGREE
  return Math.hypot(dx, dy)
}

type Segment = { start: GeoPoint; end: GeoPoint; length: number; from: number }
type Projection = { along: number; offset: number }

function project(point: GeoPoint, segment: Segment): Projection {
  const ref = ((point.lat + segment.start.lat + segment.end.lat) / 3) * Math.PI / 180
  const sx = segment.start.lng * METERS_PER_DEGREE * Math.cos(ref)
  const sy = segment.start.lat * METERS_PER_DEGREE
  const ax = segment.end.lng * METERS_PER_DEGREE * Math.cos(ref) - sx
  const ay = segment.end.lat * METERS_PER_DEGREE - sy
  const px = point.lng * METERS_PER_DEGREE * Math.cos(ref) - sx
  const py = point.lat * METERS_PER_DEGREE - sy
  const denominator = ax * ax + ay * ay
  const fraction = denominator > 0 ? Math.max(0, Math.min(1, (px * ax + py * ay) / denominator)) : 0
  return {
    along: segment.from + fraction * segment.length,
    offset: Math.hypot(px - ax * fraction, py - ay * fraction),
  }
}

function normalizedDelta(a: number, b: number, length: number, loop: boolean): number {
  let delta = b - a
  if (loop && length > 0) {
    if (delta > length / 2) delta -= length
    if (delta < -length / 2) delta += length
  }
  return delta
}

function typicalSpeed(points: VehiclePoint[]): { mps: number; fallback: boolean } {
  const speeds = points
    .slice(-5)
    .map((p) => p.speed)
    .filter((speed): speed is number => typeof speed === "number" && Number.isFinite(speed) && speed >= MIN_SPEED_MPS && speed <= MAX_SPEED_MPS)
    .sort((a, b) => a - b)
  if (speeds.length === 0) return { mps: DEFAULT_SPEED_MPS, fallback: true }
  const middle = Math.floor(speeds.length / 2)
  return {
    mps: speeds.length % 2 ? speeds[middle] : (speeds[middle - 1] + speeds[middle]) / 2,
    fallback: false,
  }
}

/**
 * 循環ルートに沿って計算する。指定地点にルートが複数回近づくときは、
 * 走行方向に沿って次に通る最短の地点を採用する。
 */
export function estimateRouteEta(
  route: [number, number][],
  vehicleHistory: VehiclePoint[],
  userLocation: GeoPoint | null,
): RouteEtaResult {
  if (!userLocation) return { kind: "unavailable", message: "青い現在地のピンを設定してください。" }
  if (!usableCoordinate(userLocation.lat, userLocation.lng)) {
    return { kind: "unavailable", message: "利用者の位置情報が正しくありません。" }
  }
  if (route.length < 2) return { kind: "unavailable", message: "循環ルートを選択してください。" }
  if (route.length > MAX_ROUTE_POINTS) return { kind: "unavailable", message: "ルートの地点数が多すぎます。" }
  if (!vehicleHistory.length) return { kind: "unavailable", message: "グリスロのGPS再生を開始してください。" }

  const cleanRoute: GeoPoint[] = route
    .filter(([lat, lng]) => usableCoordinate(lat, lng))
    .map(([lat, lng]) => ({ lat, lng }))
  if (cleanRoute.length < 2) return { kind: "unavailable", message: "有効なルート座標がありません。" }

  const start = cleanRoute[0]
  const end = cleanRoute[cleanRoute.length - 1]
  // GPSの開始地点と終了地点に微小な誤差がある循環ルートのみ閉じる。
  // 遠い端点を直線で接続して架空の通行区間を作らない。
  const closingGap = metersBetween(start, end)
  const isLoop = closingGap <= 80
  const segments: Segment[] = []
  let totalLength = 0
  for (let i = 0; i < cleanRoute.length - 1; i++) {
    const length = metersBetween(cleanRoute[i], cleanRoute[i + 1])
    if (length < 0.1) continue
    segments.push({ start: cleanRoute[i], end: cleanRoute[i + 1], length, from: totalLength })
    totalLength += length
  }
  if (isLoop && closingGap >= 0.1) {
    segments.push({ start: end, end: start, length: closingGap, from: totalLength })
    totalLength += closingGap
  }
  if (!segments.length || totalLength < 20) return { kind: "unavailable", message: "ルートの距離が短すぎます。" }

  const recent = vehicleHistory[vehicleHistory.length - 1]
  if (!usableCoordinate(recent.latitude, recent.longitude)) {
    return { kind: "unavailable", message: "グリスロのGPS座標が正しくありません。" }
  }
  const busLocation = { lat: recent.latitude, lng: recent.longitude }
  const busProjections = segments.map((segment) => project(busLocation, segment))
  const busMinOffset = Math.min(...busProjections.map((x) => x.offset))
  if (busMinOffset > MAX_VEHICLE_ROUTE_OFFSET_METERS) {
    return { kind: "unavailable", message: `グリスロが循環ルートに入ると自動計算します（現在ルートから約${Math.round(busMinOffset)}m）。` }
  }
  const busCandidates = busProjections.filter((x) => x.offset <= busMinOffset + 5)
  let busProjection = busCandidates[0]

  let direction: "forward" | "reverse" = "forward"
  let directionAssumed = true
  if (vehicleHistory.length >= 2) {
    const previous = vehicleHistory[vehicleHistory.length - 2]
    if (usableCoordinate(previous.latitude, previous.longitude)) {
      const before = { lat: previous.latitude, lng: previous.longitude }
      if (metersBetween(before, busLocation) >= 10) {
        const previousProjections = segments.map((segment) => project(before, segment))
        const previousClosest = previousProjections.reduce((best, x) => x.offset < best.offset ? x : best)
        const candidate = busCandidates
          .map((x) => ({ x, delta: normalizedDelta(previousClosest.along, x.along, totalLength, isLoop) }))
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
          .find((x) => Math.abs(x.delta) >= 8)
        if (candidate) {
          direction = candidate.delta < 0 ? "reverse" : "forward"
          directionAssumed = false
          busProjection = candidate.x
        }
      }
    }
  }

  const userProjections = segments.map((segment) => project(userLocation, segment))
  const userMinOffset = Math.min(...userProjections.map((x) => x.offset))
  const nearbyUserProjections = userProjections.filter((x) => x.offset <= userMinOffset + 15)
  const futureDistances = nearbyUserProjections.map((p) => {
    let distance = direction === "forward"
      ? p.along - busProjection.along
      : busProjection.along - p.along
    let nextLap = false
    if (distance < -0.01) {
      if (!isLoop) return { distance: Infinity, nextLap: false }
      distance += totalLength
      nextLap = true
    }
    return { distance: Math.max(0, distance), nextLap }
  }).sort((a, b) => a.distance - b.distance)

  const nearestPassing = futureDistances[0]
  if (!nearestPassing || !Number.isFinite(nearestPassing.distance)) {
    return { kind: "unavailable", message: "現在地への進行方向がルート上で確認できません。循環ルートを確認してください。" }
  }
  const { mps, fallback } = typicalSpeed(vehicleHistory)
  const seconds = Math.round(nearestPassing.distance / mps)
  if (!Number.isFinite(seconds) || seconds > 3 * 3600) {
    return { kind: "unavailable", message: "到着予想時間を計算できません。" }
  }
  return {
    kind: "ok",
    seconds,
    minutes: Math.ceil(seconds / 60),
    distanceMeters: Math.round(nearestPassing.distance),
    offsetMeters: Math.round(userMinOffset),
    speedKmh: Math.round(mps * 3.6 * 10) / 10,
    speedIsFallback: fallback,
    direction,
    directionAssumed,
    nextLap: nearestPassing.nextLap,
  }
}

/** Android GPSのJST時刻（空白区切り）またはISO8601を受け付ける。 */
export function formatSimulationArrivalTime(sourceTimestamp: string | null, seconds: number): string | null {
  if (!sourceTimestamp || !Number.isFinite(seconds) || seconds < 0) return null
  const s = sourceTimestamp.trim()
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)
    ? `${s.replace(" ", "T")}+09:00`
    : s
  const start = Date.parse(normalized)
  if (!Number.isFinite(start)) return null
  const predicted = new Date(start + seconds * 1000)
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(predicted)
}
