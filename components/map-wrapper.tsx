"use client"

import dynamic from "next/dynamic"
import type { LocationData } from "@/lib/types"
import type { Map as LeafletMap } from "leaflet"

interface MapProps {
  locations: LocationData[]
  plannedRoute?: [number, number][]
  onMapReady?: (map: LeafletMap) => void
  userLocation?: { lat: number; lng: number } | null
}

const Map = dynamic(() => import("@/components/map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">地図を読み込んでいます...</div>
    </div>
  ),
})

export function MapWrapper(props: MapProps) {
  return <Map {...props} />
}
