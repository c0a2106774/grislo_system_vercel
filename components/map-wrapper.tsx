"use client"

import dynamic from "next/dynamic"

import type {
  LocationData,
  OperationEvent,
} from "@/lib/types"

import type {
  Map as LeafletMap,
} from "leaflet"

interface MapProps {
  // グリスロのGPS情報
  locations: LocationData[]

  // 設定済みルート
  plannedRoute?: [
    number,
    number,
  ][]

  // Leaflet Map取得用
  onMapReady?: (
    map: LeafletMap,
  ) => void

  // 利用者の現在地
  userLocation?: {
    lat: number
    lng: number
  } | null

  // 遅延・停止・お知らせ情報
  activeEvent?: OperationEvent | null
}

/**
 * Leafletはブラウザ側でのみ読み込む
 */
const Map = dynamic(
  () =>
    import(
      "@/components/map"
    ),
  {
    ssr: false,

    loading: () => (
      <div
        className="
          w-full
          h-full
          flex
          items-center
          justify-center
          bg-gray-100
        "
      >
        <div className="text-gray-600">
          地図を読み込んでいます...
        </div>
      </div>
    ),
  },
)

export function MapWrapper(
  props: MapProps,
) {
  return <Map {...props} />
}
