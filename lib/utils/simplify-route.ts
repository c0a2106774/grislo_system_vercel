// Douglas-Peucker アルゴリズムを使用してルートを簡略化
export function simplifyRoute(
  points: { lat: number; lng: number }[],
  tolerance = 0.0001,
): { lat: number; lng: number }[] {
  if (points.length <= 2) {
    return points
  }

  // 最初と最後のポイントを結ぶ線からの最大距離を持つポイントを見つける
  let maxDistance = 0
  let maxIndex = 0
  const start = points[0]
  const end = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], start, end)
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = i
    }
  }

  // 最大距離がtoleranceより大きい場合、再帰的に分割
  if (maxDistance > tolerance) {
    const left = simplifyRoute(points.slice(0, maxIndex + 1), tolerance)
    const right = simplifyRoute(points.slice(maxIndex), tolerance)

    // 結合（中間のポイントを重複させないため、leftの最後を除く）
    return [...left.slice(0, -1), ...right]
  } else {
    // toleranceより小さい場合、最初と最後のポイントだけを返す
    return [start, end]
  }
}

// ポイントから線分への垂直距離を計算
function perpendicularDistance(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number },
): number {
  const x = point.lng
  const y = point.lat
  const x1 = lineStart.lng
  const y1 = lineStart.lat
  const x2 = lineEnd.lng
  const y2 = lineEnd.lat

  const A = x - x1
  const B = y - y1
  const C = x2 - x1
  const D = y2 - y1

  const dot = A * C + B * D
  const lenSq = C * C + D * D

  let param = -1
  if (lenSq !== 0) {
    param = dot / lenSq
  }

  let xx, yy

  if (param < 0) {
    xx = x1
    yy = y1
  } else if (param > 1) {
    xx = x2
    yy = y2
  } else {
    xx = x1 + param * C
    yy = y1 + param * D
  }

  const dx = x - xx
  const dy = y - yy

  return Math.sqrt(dx * dx + dy * dy)
}

// 重複ポイントを削除（GPSの精度による微小な揺れを除去）
export function removeDuplicatePoints(
  points: { lat: number; lng: number }[],
  minDistance = 0.00001, // 約1メートル
): { lat: number; lng: number }[] {
  if (points.length <= 1) {
    return points
  }

  const result: { lat: number; lng: number }[] = [points[0]]

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]

    const distance = Math.sqrt(Math.pow(curr.lat - prev.lat, 2) + Math.pow(curr.lng - prev.lng, 2))

    if (distance >= minDistance) {
      result.push(curr)
    }
  }

  return result
}

export async function snapToRoads(
  points: { lat: number; lng: number }[],
): Promise<{ lat: number; lng: number }[] | null> {
  try {
    // OSRM has a limit of 100 points per request
    // First simplify to reduce points if necessary
    let processedPoints = points
    if (points.length > 100) {
      processedPoints = simplifyRoute(points, 0.0002) // More aggressive simplification
      console.log(`[v0] Reduced points for OSRM: ${points.length} → ${processedPoints.length}`)
    }

    // Format coordinates for OSRM: "lng,lat;lng,lat;..."
    const coordinates = processedPoints.map((p) => `${p.lng},${p.lat}`).join(";")

    // Call OSRM Map Matching API
    const url = `https://router.project-osrm.org/match/v1/driving/${coordinates}?overview=full&geometries=geojson`

    console.log(`[v0] Calling OSRM Map Matching API with ${processedPoints.length} points...`)

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`)
    }

    const data = await response.json()

    if (data.code !== "Ok" || !data.matchings || data.matchings.length === 0) {
      console.error("[v0] OSRM matching failed:", data.message)
      return null
    }

    // Extract matched coordinates
    const matchedCoordinates = data.matchings[0].geometry.coordinates.map((coord: [number, number]) => ({
      lng: coord[0],
      lat: coord[1],
    }))

    console.log(`[v0] OSRM Map Matching successful: ${processedPoints.length} → ${matchedCoordinates.length} points`)

    return matchedCoordinates
  } catch (error) {
    console.error("[v0] Error in road snapping:", error)
    return null
  }
}
