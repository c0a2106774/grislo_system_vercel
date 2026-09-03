export interface LocationData {
  latitude: number
  longitude: number
  timestamp: string | Date
  speed?: number
  accuracy?: number
  heading?: number
  id?: string
}

export interface RouteData {
  collectionName: string
  locations: LocationData[]
  startTime?: string
  endTime?: string
}

export interface SavedRoute {
  name: string
  createdAt: string
  points: { lat: number; lng: number; timestamp?: string }[]
}

export interface ActiveRouteSettings {
  routeId: string
  updatedAt: string
}

export interface DaySchedule {
  isOperating: boolean
  startTime: string
  endTime: string
  routeType: "循環ルート" | "フリー運行"
  routeId?: string
  startLocation: string
}

export interface MonthSchedule {
  [dateStr: string]: DaySchedule | DaySchedule[]
}
