"use client"

import { useEffect, useRef, useState } from "react"
import type { LocationData, OperationEvent, } from "@/lib/types"

interface MapProps {
  locations: LocationData[]

  plannedRoute?: [
    number,
    number,
  ][]

  onMapReady?: (
    map: any,
  ) => void

  userLocation?: {
    lat: number
    lng: number
  } | null

  activeEvent?: OperationEvent | null
}

export default function Map({ locations, plannedRoute, onMapReady, userLocation, activeEvent }: MapProps) {
  const mapRef = useRef<any | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const vehicleMarkerRef = useRef<any | null>(null)
  const routeLayerRef = useRef<any | null>(null)
  const leafletRef = useRef<any>(null)
  const userMarkerRef = useRef<any | null>(null)
  const lastValidHeadingRef = useRef<number>(0) // 最後の有効なheadingの値を保持（初期値は0）
  const [leafletReady, setLeafletReady] = useState(false)

  useEffect(() => {
    const loadLeaflet = async () => {
      if (leafletRef.current) return

      const L = await import("leaflet")

      delete (L.default.Icon.Default.prototype as any)._getIconUrl
      L.default.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      })

      leafletRef.current = L.default
      setLeafletReady(true)
    }

    loadLeaflet()
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !leafletRef.current) {
      return
    }

    const L = leafletRef.current

    const map = L.map(containerRef.current, {
      zoomControl: false,
      dragging: true,
      touchZoom: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      tap: true,
    }).setView([35.6428991, 140.0467733], 15)

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    if (onMapReady) {
      onMapReady(map)
    }

    const timeoutId = setTimeout(() => {
      if (mapRef.current && mapRef.current.invalidateSize) {
        mapRef.current.invalidateSize()
      }
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [onMapReady, leafletReady])

  useEffect(() => {
    if (!mapRef.current || !leafletRef.current) return

    // 既存のルートレイヤーを削除
    if (routeLayerRef.current) {
      routeLayerRef.current.remove()
      routeLayerRef.current = null
    }

    // ルートが空の場合はここで終了
    if (!plannedRoute || plannedRoute.length === 0) {
      return
    }

    const updateRouteStyle = () => {
      if (!mapRef.current || !routeLayerRef.current) return
      const zoom = mapRef.current.getZoom()
      const weight = Math.max(4, Math.min(14, 4 + (zoom - 15) * 2))
      routeLayerRef.current.setStyle({ weight })
    }

    const routeLayer = leafletRef.current
      .polyline(plannedRoute, {
        color: "#2B7FFF",
        weight: 4,
        opacity: 0.8,
      })
      .addTo(mapRef.current)

    routeLayerRef.current = routeLayer

    mapRef.current.on("zoomend", updateRouteStyle)
    updateRouteStyle()

    return () => {
      if (mapRef.current) {
        mapRef.current.off("zoomend", updateRouteStyle)
      }
    }
  }, [plannedRoute])

  useEffect(() => {
    if (!mapRef.current || locations.length === 0 || !leafletRef.current) return

    const latestLocation = locations[locations.length - 1]

    // 2点間の方位角（bearing）を計算する関数
    const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const dLon = ((lon2 - lon1) * Math.PI) / 180
      const lat1Rad = (lat1 * Math.PI) / 180
      const lat2Rad = (lat2 * Math.PI) / 180

      const y = Math.sin(dLon) * Math.cos(lat2Rad)
      const x =
        Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

      // 標準的な方位角計算式（atan2(y, x)を使用）
      let bearing = (Math.atan2(y, x) * 180) / Math.PI
      bearing = (bearing + 360) % 360 // 0-360度に正規化

      return bearing
    }

    // 2点間の距離を計算する関数（メートル単位）
    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371000 // 地球の半径（メートル）
      const dLat = ((lat2 - lat1) * Math.PI) / 180
      const dLon = ((lon2 - lon1) * Math.PI) / 180
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return R * c
    }

    // headingの値を10度刻みに丸める関数（360度を36分割）
    const roundHeadingTo10Degrees = (heading: number): number => {
      // 0度付近の特別処理（355以上360以下 or 0以上5未満 → 0度）
      if ((heading >= 355 && heading <= 360) || (heading >= 0 && heading < 5)) {
        return 0
      }
      // その他の範囲を10度刻みに丸める
      // 5以上15未満 → 10度、15以上25未満 → 20度、25以上35未満 → 30度、35以上45未満 → 40度...
      return Math.round(heading / 10) * 10
    }

    // 進行方向を計算
    let bearing: number | null = null
    const speed = latestLocation.speed ?? 0

    // 速度が低い場合は、前回の有効なheadingを保持
    if (speed <= 1) {
      bearing = lastValidHeadingRef.current !== 0 ? lastValidHeadingRef.current : null
    } else {
      // 過去の位置情報から進行方向を計算
      // 連続する点同士を結んでheadingを計算し、加重平均を取ることで、カーブ走行時も正確に反映
      const minPoints = 2
      const maxPoints = 4 // 最新4点を使用（約20秒間のデータ）
      const availablePoints = Math.min(locations.length, maxPoints)

      if (availablePoints >= minPoints) {
        const bearings: { bearing: number; weight: number }[] = []

        // 速度に応じて使用する点の数を調整
        // 高速（40km/h以上）の場合は最新3点のみ、それ以外は4点を使用
        const usePoints = speed >= 11.1 ? Math.min(3, availablePoints) : availablePoints // 40km/h = 11.1 m/s
        const startOffset = locations.length - usePoints

        // 連続する点同士を結んでheadingを計算（カーブ走行時も正確に反映）
        // 直近のポイントをより重視する重み付け
        // 例: 4点ある場合（低速時）
        // - 点3と点4（最新2点、重み10）
        // - 点2と点3（2点前と3点前、重み3）
        // - 点1と点2（3点前と2点前、重み1）
        // 例: 3点ある場合（高速時）
        // - 点2と点3（最新2点、重み10）
        // - 点1と点2（2点前と3点前、重み3）
        for (let i = usePoints - 1; i >= 1; i--) {
          const startIndex = startOffset + (usePoints - 1 - i)
          const endIndex = startOffset + (usePoints - 1 - i) + 1

          if (startIndex >= 0 && endIndex < locations.length && endIndex > startIndex) {
            const startLocation = locations[startIndex]
            const endLocation = locations[endIndex]

            // 2点間の距離を計算
            const distance = calculateDistance(
              startLocation.latitude,
              startLocation.longitude,
              endLocation.latitude,
              endLocation.longitude,
            )

            // 距離が3メートル以上の場合は有効なheadingとして使用
            // より新しい点ほど重みを大きく（最新2点は重み10、その次は重み3、さらに古い点は1）
            if (distance >= 3) {
              const calculatedBearing = calculateBearing(
                startLocation.latitude,
                startLocation.longitude,
                endLocation.latitude,
                endLocation.longitude,
              )

              // 重み: 最新の2点間は10（直近を重視）、その次は3、さらに古い点は1
              const weight = i === usePoints - 1 ? 10 : i === usePoints - 2 ? 3 : 1
              bearings.push({ bearing: calculatedBearing, weight })
            }
          }
        }

        // 加重平均を計算（角度の循環性を考慮）
        if (bearings.length > 0) {
          let sinSum = 0
          let cosSum = 0
          let totalWeight = 0

          for (const { bearing, weight } of bearings) {
            const rad = (bearing * Math.PI) / 180
            sinSum += Math.sin(rad) * weight
            cosSum += Math.cos(rad) * weight
            totalWeight += weight
          }

          // 加重平均の角度を計算
          const avgBearing = (Math.atan2(sinSum / totalWeight, cosSum / totalWeight) * 180) / Math.PI
          const normalizedBearing = (avgBearing + 360) % 360

          // 計算したheadingを10度刻みに丸める
          const roundedHeading = roundHeadingTo10Degrees(normalizedBearing)
          lastValidHeadingRef.current = roundedHeading
          bearing = roundedHeading
        } else {
          // 有効なheadingが計算できなかった場合は、前回の有効なheadingを保持
          bearing = lastValidHeadingRef.current !== 0 ? lastValidHeadingRef.current : null
        }
      } else {
        // 位置情報が2点未満（1点のみ）の場合は、進行方向を非表示
        bearing = null
      }
    }

    // バスアイコンを作成（SVGを使用）
    // 一意なIDを生成してシャドウフィルターの競合を避ける
    const shadowId = `shadow-${Math.random().toString(36).substr(2, 9)}`
    
    // 進行方向の表示有無を判定（bearingがnullまたは0の場合は非表示）
    const showDirection = bearing !== null && bearing !== 0
    
    // bearingをSVG座標系に変換（bearing: 0度=北、SVG: 0度=右）
    // bearing 0度（北）→ SVG 270度（上）
    // bearing 90度（東）→ SVG 0度（右）
    // bearing 180度（南）→ SVG 90度（下）
    // bearing 270度（西）→ SVG 180度（左）
    // ※ (bearing - 90) でSVGの0度（右）基準に揃える
    const svgAngle = bearing !== null ? (bearing - 90 + 360) % 360 : 0
    const svgAngleRad = (svgAngle * Math.PI) / 180
    
    // 円の半径
    const circleRadius = 20
    // 三角形の長さ（ストローク幅も考慮）
    const triangleLength = 14
    const strokeWidth = 1.5
    // 余白（三角形が切れないように十分な余白を確保、表示しない場合は最小限）
    const padding = showDirection ? triangleLength + strokeWidth + 2 : 0
    
    // 円の中心（余白を考慮して配置）
    const circleCenterX = 32 + padding
    const circleCenterY = 32 + padding
    
    // 進行方向に応じた円の接点の座標を計算
    const triangleX = circleCenterX + circleRadius * Math.cos(svgAngleRad)
    const triangleY = circleCenterY + circleRadius * Math.sin(svgAngleRad)
    
    // 三角形が切れないようにSVGのサイズを拡大（余白を両側に追加）
    const svgSize = 64 + padding * 2
    
    const vehicleIcon = leafletRef.current.divIcon({
      className: "vehicle-marker",
      html: `
        <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
          <defs>
            <filter id="${shadowId}" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
            </filter>
          </defs>
          <!-- 円形の緑色背景 -->
          <circle cx="${circleCenterX}" cy="${circleCenterY}" r="${circleRadius}" fill="#00C950" stroke="white" stroke-width="1.5" filter="url(#${shadowId})"/>
          <!-- 白いバスアイコン（シンプルなデザイン） -->
          <g transform="translate(${circleCenterX}, ${circleCenterY})">
            <!-- バスの本体（長方形） -->
            <rect x="-9" y="-5" width="18" height="10" rx="1" fill="white"/>
            <!-- バスの窓（2つの小さな長方形） -->
            <rect x="-6" y="-3.5" width="3.5" height="2.5" rx="0.3" fill="#00C950"/>
            <rect x="2.5" y="-3.5" width="3.5" height="2.5" rx="0.3" fill="#00C950"/>
            <!-- バスの車輪（2つの小さな円） -->
            <circle cx="-5.5" cy="6" r="2" fill="white"/>
            <circle cx="5.5" cy="6" r="2" fill="white"/>
          </g>
          ${showDirection ? `<!-- 三角形のポインター（進行方向に応じて円の周囲の適切な位置に配置） -->
          <g transform="translate(${triangleX}, ${triangleY}) rotate(${svgAngle})">
            <!-- 緑色の三角形（底辺が円の接線に沿う、鋭角が進行方向を指す） -->
            <path
              d="M -0.5 -8.5 L -0.5 8.5 L 14 -0.5 Z"
              fill="#00C950"
              stroke="white"
              stroke-width="1.5"
              filter="url(#${shadowId})"
            />
          </g>` : ''}
        </svg>
      `,
      iconSize: [svgSize, svgSize],
      iconAnchor: [circleCenterX, circleCenterY], // 円の中心を位置に合わせる
    })

    if (vehicleMarkerRef.current) {
      vehicleMarkerRef.current.setLatLng([latestLocation.latitude, latestLocation.longitude])
      // アイコンを更新（角度が変わった場合）
      vehicleMarkerRef.current.setIcon(vehicleIcon)
    } else {
      vehicleMarkerRef.current = leafletRef.current
        .marker([latestLocation.latitude, latestLocation.longitude], {
          icon: vehicleIcon,
        })
        .addTo(mapRef.current)
    }
  }, [locations])

    /**
   * 遅延・停止・お知らせ情報を
   * グリスロの車両マーカー上に表示
   */
  useEffect(() => {
    const vehicleMarker =
      vehicleMarkerRef.current

    /**
     * グリスロの位置情報が無く、
     * 車両マーカーがまだ存在しない場合は
     * 吹き出しを表示できない
     */
    if (!vehicleMarker) {
      return
    }

    /**
     * 以前の吹き出しが残っていた場合は
     * 一度削除する
     */
    vehicleMarker.unbindTooltip()

    /**
     * 表示中の運行情報が無ければ終了
     */
    if (
      !activeEvent ||
      activeEvent.status !== "active" ||
      !activeEvent.message
    ) {
      return
    }

    /**
     * 吹き出し全体
     *
     * innerHTMLを使用せず、
     * textContentを使うことで
     * 自由記述欄の文字列を安全に表示する
     */
    const container =
      document.createElement("div")

    container.style.minWidth =
      "180px"

    container.style.maxWidth =
      "280px"

    container.style.padding =
      "6px 8px"

    container.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

    /**
     * 「遅延情報」などのラベル
     */
    const label =
      document.createElement("div")

    label.style.fontSize =
      "12px"

    label.style.fontWeight =
      "800"

    label.style.marginBottom =
      "5px"

    /**
     * 種類によって色と文章を変更
     */
    if (
      activeEvent.type ===
      "stopped"
    ) {
      label.textContent =
        "一時停止中"

      label.style.color =
        "#dc2626"
    } else if (
      activeEvent.type ===
      "delay"
    ) {
      label.textContent =
        "遅延情報"

      label.style.color =
        "#d97706"
    } else {
      label.textContent =
        "運行情報"

      label.style.color =
        "#2563eb"
    }

    /**
     * 運行情報本文
     */
    const message =
      document.createElement("div")

    message.style.fontSize =
      "14px"

    message.style.fontWeight =
      "700"

    message.style.lineHeight =
      "1.45"

    message.style.color =
      "#111827"

    message.style.whiteSpace =
      "pre-wrap"

    message.textContent =
      activeEvent.message

    /**
     * 更新時刻
     */
    const time =
      document.createElement("div")

    time.style.fontSize =
      "11px"

    time.style.marginTop =
      "6px"

    time.style.color =
      "#6b7280"

    const publishedAt =
      new Date(
        activeEvent.publishedAt,
      )

    /**
     * FirestoreにはUTCで保存しているが、
     * 表示するときは日本時間に変換する
     */
    if (
      !Number.isNaN(
        publishedAt.getTime(),
      )
    ) {
      const japanTime =
        publishedAt.toLocaleTimeString(
          "ja-JP",
          {
            timeZone:
              "Asia/Tokyo",

            hour:
              "2-digit",

            minute:
              "2-digit",
          },
        )

      time.textContent =
        `${japanTime} 更新`
    }

    /**
     * 吹き出しを組み立てる
     */
    container.appendChild(label)

    container.appendChild(
      message,
    )

    if (time.textContent) {
      container.appendChild(
        time,
      )
    }

    /**
     * Leaflet Tooltipとして
     * グリスロのマーカーに取り付ける
     */
    vehicleMarker
      .bindTooltip(
        container,
        {
          /**
           * 常に表示
           */
          permanent: true,

          /**
           * 車両アイコンの上側へ表示
           */
          direction: "top",

          /**
           * 車両アイコンから少し離す
           */
          offset: [0, -28],

          opacity: 1,

          /**
           * 吹き出し自体は
           * タップ操作の対象にしない
           */
          interactive: false,
        },
      )
      .openTooltip()

    /**
     * activeEventが変更された場合は
     * 古い吹き出しを削除
     */
    return () => {
      vehicleMarker.unbindTooltip()
    }
  }, [
    activeEvent,

    /**
     * 0件 → 1件以上になったときに
     * 吹き出し処理を再実行する
     */
    locations.length > 0,
  ])

  useEffect(() => {
    if (!mapRef.current || !userLocation || !leafletRef.current) {
      return
    }

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng])
    } else {
      const userIcon = leafletRef.current.divIcon({
        className: "user-marker",
        html: `
          <div style="
            width: 25px;
            height: 25px;
            background: #2B7FFF;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          "></div>
        `,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      })

      userMarkerRef.current = leafletRef.current
        .marker([userLocation.lat, userLocation.lng], {
          icon: userIcon,
        })
        .addTo(mapRef.current)
    }
  }, [userLocation])

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 1,
        isolation: "isolate",
      }}
    />
  )
}
