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

// 運行情報の種類
export type OperationEventType = "delay" | "stopped" | "notice"

// 運行情報がプリセットか自由入力か
export type OperationEventSource = "preset" | "custom"

// 保存されている定型文
export interface OperationEventTemplate {
  id: string
  type: OperationEventType
  message: string
}

// 現在Web地図に表示する運行情報
export interface OperationEvent {
  // 遅延・一時停止・お知らせ
  type: OperationEventType

  // 実際に表示する文章
  message: string

  // プリセットから選択したか、自由入力したか
  source: OperationEventSource

  // 現在表示中か、解除済みか
  status: "active" | "resolved"

  // 情報を送信した日時
  publishedAt: string

  // 情報を解除した日時
  resolvedAt?: string

  // 情報送信時点のグリスロ位置
  vehicleLatitude?: number
  vehicleLongitude?: number
}

// 運行情報を送信するときに使用するデータ
export interface OperationEventInput {
  type: OperationEventType
  message: string
  source: OperationEventSource
  vehicleLatitude?: number
  vehicleLongitude?: number
}
