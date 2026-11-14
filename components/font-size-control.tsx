"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { usePathname } from "next/navigation"

type FontSizeChoice = "normal" | "large"
const STORAGE_KEY = "grislo-font-size"

/**
 * 文字サイズ設定はこの端末のブラウザだけに保存します。
 * Firestoreへ保存しないので、GPS再生や本番の運行情報には影響しません。
 */
export function FontSizeControl() {
  const [choice, setChoice] = useState<FontSizeChoice>("normal")
  const pathname = usePathname()

  useEffect(() => {
    let saved: FontSizeChoice = "normal"
    try {
      saved = window.localStorage.getItem(STORAGE_KEY) === "large" ? "large" : "normal"
    } catch {
      // プライベートブラウジング等でlocalStorageが使えない場合は通常サイズ
    }
    document.documentElement.dataset.grisloFontSize = saved
    setChoice(saved)
  }, [])

  const updateChoice = (next: FontSizeChoice) => {
    document.documentElement.dataset.grisloFontSize = next
    setChoice(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 保存できなくてもこの画面での切り替えは有効
    }
  }

  // 地図の拡大ボタンや管理パネルと重なりにくい位置へ画面別に表示。
  const isMapWithZoomControls = pathname === "/" || pathname.startsWith("/operator/live")
  const isSimulationViewer = pathname.startsWith("/simulation/view")
  const isSimulationOperator = pathname.startsWith("/simulation/operator")

  const position: CSSProperties = isSimulationOperator
    ? { top: 16, left: 16 }
    : isSimulationViewer
      ? { top: 66, right: 16 }
      : isMapWithZoomControls
        ? { top: 16, right: 82 }
        : { top: 16, right: 16 }

  const buttonStyle = (active: boolean): CSSProperties => ({
    minHeight: 44,
    minWidth: 56,
    padding: "7px 10px",
    borderRadius: 8,
    border: active ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
    backgroundColor: active ? "#dbeafe" : "#ffffff",
    color: "#0f172a",
    fontSize: "calc(14px * var(--grislo-font-scale, 1))",
    fontWeight: active ? 800 : 600,
    lineHeight: 1.3,
    cursor: "pointer",
    whiteSpace: "nowrap",
  })

  return (
    <div
      role="group"
      aria-label="文字サイズの切り替え"
      style={{
        position: "fixed",
        ...position,
        zIndex: 30000,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        maxWidth: "calc(100vw - 32px)",
        padding: "5px 7px",
        backgroundColor: "rgba(255,255,255,0.97)",
        border: "1px solid #cbd5e1",
        boxShadow: "0 3px 12px rgba(15,23,42,0.18)",
        borderRadius: 12,
        boxSizing: "border-box",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <span
        style={{
          color: "#334155",
          fontSize: "calc(12px * var(--grislo-font-scale, 1))",
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        文字
      </span>
      <button
        type="button"
        aria-label="文字サイズを普通にする"
        aria-pressed={choice === "normal"}
        onClick={() => updateChoice("normal")}
        style={buttonStyle(choice === "normal")}
      >
        普通
      </button>
      <button
        type="button"
        aria-label="文字サイズを1.25倍にする"
        aria-pressed={choice === "large"}
        onClick={() => updateChoice("large")}
        style={buttonStyle(choice === "large")}
      >
        大きい
      </button>
    </div>
  )
}
