import { initializeApp, getApps } from "firebase/app"
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore"
import type { LocationData, SavedRoute, ActiveRouteSettings, DaySchedule, MonthSchedule } from "./types"
import { simplifyRoute, removeDuplicatePoints, snapToRoads } from "./utils/simplify-route"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

// Initialize Firebase (singleton pattern)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
const db = getFirestore(app)

export { app, db }

export function getRealtimeLocations(
  collectionName: string,
  callback: (locations: LocationData[]) => void,
): () => void {
  const locationsRef = collection(db, collectionName)
  const q = query(locationsRef, orderBy("timestamp", "asc"))

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const locations: LocationData[] = []
      snapshot.forEach((doc) => {
        const data = doc.data()
        locations.push({
          id: doc.id,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toDate() : new Date(data.timestamp),
          speed: data.speed,
          accuracy: data.accuracy,
          heading: data.heading,
        })
      })
      callback(locations)
    },
    (error) => {
      console.error("[v0] Firestore error:", error)
    },
  )

  return unsubscribe
}

export async function getActiveRoute(): Promise<string | null> {
  try {
    const docRef = doc(db, "settings", "active-route")
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      const data = docSnap.data() as ActiveRouteSettings
      return data.routeId
    }
    return null
  } catch (error) {
    console.error("[v0] Error getting active route:", error)
    return null
  }
}

export async function getSavedRoute(routeId: string): Promise<SavedRoute | null> {
  try {
    const docRef = doc(db, "saved-routes", routeId)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      return docSnap.data() as SavedRoute
    }
    return null
  } catch (error) {
    console.error("[v0] Error getting saved route:", error)
    return null
  }
}

export async function getSavedRoutes(): Promise<{ id: string; name: string; pointCount: number }[]> {
  try {
    const routesRef = collection(db, "saved-routes")
    const snapshot = await getDocs(routesRef)
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as SavedRoute
      return {
        id: docSnap.id,
        name: data.name || docSnap.id,
        pointCount: data.points?.length || 0,
      }
    })
  } catch (error) {
    console.error("[v0] Error listing saved routes:", error)
    return []
  }
}

export async function getDateCollections(): Promise<string[]> {
  try {
    const docRef = doc(db, "date-index", "dates")
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      const data = docSnap.data()
      const dateList = data.dateList as string[]

      // Sort by date descending (newest first)
      return dateList.sort((a, b) => {
        const dateA = a.split("_")[0]
        const dateB = b.split("_")[0]
        return dateB.localeCompare(dateA)
      })
    }

    return []
  } catch (error) {
    console.error("[v0] Error getting date index:", error)
    return []
  }
}

export async function getAllLocationsFromCollection(collectionName: string): Promise<LocationData[]> {
  try {
    const locationsRef = collection(db, collectionName)
    const q = query(locationsRef, orderBy("timestamp", "asc"))
    const snapshot = await getDocs(q)

    const locations: LocationData[] = []
    snapshot.forEach((doc) => {
      const data = doc.data()
      locations.push({
        id: doc.id,
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toDate() : new Date(data.timestamp),
        speed: data.speed,
        accuracy: data.accuracy,
        heading: data.heading,
      })
    })

    return locations
  } catch (error) {
    console.error("[v0] Error getting locations from collection:", error)
    return []
  }
}

export async function saveRouteAsActive(routeId: string, locations: LocationData[]): Promise<boolean> {
  try {
    const points = locations.map((loc) => ({
      lat: loc.latitude,
      lng: loc.longitude,
      timestamp: loc.timestamp instanceof Date ? loc.timestamp.toISOString() : loc.timestamp,
    }))

    const deduplicated = removeDuplicatePoints(points)
    console.log(`[v0] Step 1 - Deduplication: ${points.length} → ${deduplicated.length} points`)

    const snapped = await snapToRoads(deduplicated)

    let finalPoints: { lat: number; lng: number }[]

    if (snapped) {
      console.log(`[v0] Step 2 - Road snapping successful: ${snapped.length} points`)
      finalPoints = snapped
    } else {
      console.log("[v0] Step 2 - Road snapping failed, using Douglas-Peucker instead")
      const simplified = simplifyRoute(deduplicated, 0.0001)
      console.log(`[v0] Step 2 - Simplification: ${deduplicated.length} → ${simplified.length} points`)
      finalPoints = simplified
    }

    // Save route data to /saved-routes/{routeId}
    const routeDocRef = doc(db, "saved-routes", routeId)
    const savedRoute: SavedRoute = {
      name: `${routeId}のルート`,
      createdAt: new Date().toISOString(),
      points: finalPoints,
    }
    await setDoc(routeDocRef, savedRoute)

    // Update /settings/active-route to point to this route
    const settingsDocRef = doc(db, "settings", "active-route")
    const activeSettings: ActiveRouteSettings = {
      routeId: routeId,
      updatedAt: new Date().toISOString(),
    }
    await setDoc(settingsDocRef, activeSettings)

    return true
  } catch (error) {
    console.error("[v0] Error saving route:", error)
    return false
  }
}

export async function saveCustomRoute(
  routeId: string,
  points: [number, number][],
  options?: { name?: string },
): Promise<boolean> {
  try {
    const routeDocRef = doc(db, "saved-routes", routeId)
    const savedRoute: SavedRoute = {
      name: options?.name || `${routeId}のルート`,
      createdAt: new Date().toISOString(),
      points: points.map(([lat, lng]) => ({ lat, lng })),
    }
    await setDoc(routeDocRef, savedRoute)
    return true
  } catch (error) {
    console.error("[v0] Error saving custom route:", error)
    return false
  }
}

export async function saveMonthSchedule(yearMonth: string, schedule: MonthSchedule): Promise<boolean> {
  try {
    const docRef = doc(db, "schedules", yearMonth)
    await setDoc(docRef, {
      yearMonth,
      days: schedule,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (error) {
    console.error("[v0] Error saving schedule:", error)
    return false
  }
}

export async function getMonthSchedule(yearMonth: string): Promise<MonthSchedule | null> {
  try {
    const docRef = doc(db, "schedules", yearMonth)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      const data = docSnap.data()
      const schedule = data.days as MonthSchedule
      // 後方互換性: 単一のDayScheduleを配列に変換
      const normalized: MonthSchedule = {}
      for (const [dateStr, daySchedule] of Object.entries(schedule)) {
        if (Array.isArray(daySchedule)) {
          normalized[dateStr] = daySchedule
        } else {
          normalized[dateStr] = [daySchedule]
        }
      }
      return normalized
    }
    return null
  } catch (error) {
    console.error("[v0] Error getting schedule:", error)
    return null
  }
}

/** "9:00" と "09:00" が混在しても比較が正しくなるよう HH:mm に揃える（文字列比較バグ対策） */
function normalizeTimeForCompare(timeStr: string): string {
  const trimmed = String(timeStr).trim()
  const match = trimmed.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!match) return trimmed
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (Number.isNaN(h) || Number.isNaN(m)) return trimmed
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export async function getCurrentScheduleStatus(): Promise<{
  isOperating: boolean
  schedule: DaySchedule | null
  nextOperation?: {
    date: string
    dayOfWeek: string
    startTime: string
    endTime: string
    startLocation: string
    routeType: "循環ルート" | "フリー運行"
  }
} | null> {
  try {
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

    const schedule = await getMonthSchedule(yearMonth)
    if (!schedule || !schedule[dateStr]) {
      const nextOp = await findNextOperation(now)
      return { isOperating: false, schedule: null, nextOperation: nextOp }
    }

    const daySchedules = Array.isArray(schedule[dateStr]) ? schedule[dateStr] : [schedule[dateStr]]
    const currentTime = normalizeTimeForCompare(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    )

    // 現在の時間に該当するスケジュールを探す
    const activeSchedule = daySchedules.find(
      (s) =>
        s.isOperating &&
        currentTime >= normalizeTimeForCompare(s.startTime) &&
        currentTime <= normalizeTimeForCompare(s.endTime),
    )

    if (activeSchedule) {
      return { isOperating: true, schedule: activeSchedule }
    }

    // 運行中ではない場合、次回の運行を探す
    const nextOp = await findNextOperation(now)
    return { isOperating: false, schedule: daySchedules[0] || null, nextOperation: nextOp }
  } catch (error) {
    console.error("[v0] Error getting current schedule status:", error)
    return null
  }
}

async function findNextOperation(fromDate: Date): Promise<
  | {
      date: string
      dayOfWeek: string
      startTime: string
      endTime: string
      startLocation: string
      routeType: "循環ルート" | "フリー運行"
    }
  | undefined
> {
  try {
    const dayNames = ["日", "月", "火", "水", "木", "金", "土"]

    // 今日から30日後まで検索
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(fromDate)
      checkDate.setDate(checkDate.getDate() + i)

      const yearMonth = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}`
      const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}-${String(checkDate.getDate()).padStart(2, "0")}`

      const schedule = await getMonthSchedule(yearMonth)
      if (!schedule || !schedule[dateStr]) continue

      const daySchedules = Array.isArray(schedule[dateStr]) ? schedule[dateStr] : [schedule[dateStr]]
      const operatingSchedules = daySchedules.filter((s) => s.isOperating)

      if (operatingSchedules.length === 0) continue

      const currentTime = normalizeTimeForCompare(
        `${String(fromDate.getHours()).padStart(2, "0")}:${String(fromDate.getMinutes()).padStart(2, "0")}`,
      )

      // 同日の場合は、運行開始時刻が現在時刻より後のスケジュールを探す
      if (i === 0) {
        const futureSchedules = operatingSchedules.filter(
          (s) => normalizeTimeForCompare(s.startTime) > currentTime,
        )
        if (futureSchedules.length > 0) {
          // 最も近い未来のスケジュールを選択
          const nextSchedule = futureSchedules.sort((a, b) =>
            normalizeTimeForCompare(a.startTime).localeCompare(normalizeTimeForCompare(b.startTime)),
          )[0]
          return {
            date: `${checkDate.getMonth() + 1}/${checkDate.getDate()}`,
            dayOfWeek: dayNames[checkDate.getDay()],
            startTime: nextSchedule.startTime,
            endTime: nextSchedule.endTime,
            startLocation: nextSchedule.startLocation || "ヤンマー前",
            routeType: nextSchedule.routeType,
          }
        }
        // 今日の運行時間は過ぎているので次の日を探す
        continue
      }

      // 他の日の場合は、最初のスケジュールを返す
      const firstSchedule = operatingSchedules.sort((a, b) =>
        normalizeTimeForCompare(a.startTime).localeCompare(normalizeTimeForCompare(b.startTime)),
      )[0]
      return {
        date: `${checkDate.getMonth() + 1}/${checkDate.getDate()}`,
        dayOfWeek: dayNames[checkDate.getDay()],
        startTime: firstSchedule.startTime,
        endTime: firstSchedule.endTime,
        startLocation: firstSchedule.startLocation || "ヤンマー前",
        routeType: firstSchedule.routeType,
      }
    }

    return undefined
  } catch (error) {
    console.error("[v0] Error finding next operation:", error)
    return undefined
  }
}
