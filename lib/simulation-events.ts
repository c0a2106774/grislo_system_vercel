
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "firebase/firestore"

import { db } from "@/lib/firebase"

import type {
  OperationEvent,
  OperationEventInput,
  OperationEventType,
} from "@/lib/types"

// テスト用の保存先
// 本番の operation-status/current は使用しない
const simulationEventRef = doc(
  db,
  "simulation-events",
  "current",
)

function isOperationEventType(
  value: unknown,
): value is OperationEventType {
  return (
    value === "delay" ||
    value === "stopped" ||
    value === "notice"
  )
}

// シミュレーション用の運行情報を送信
export async function publishSimulationEvent(
  input: OperationEventInput,
): Promise<void> {

  const message = input.message.trim()

  if (!message || message.length > 500) {
    throw new Error(
      "運行情報は1〜500文字で入力してください",
    )
  }

  const event: OperationEvent = {
    type: input.type,
    message,
    source: input.source,
    status: "active",
    publishedAt: new Date().toISOString(),

    ...(typeof input.vehicleLatitude === "number"
      ? { vehicleLatitude: input.vehicleLatitude }
      : {}),

    ...(typeof input.vehicleLongitude === "number"
      ? { vehicleLongitude: input.vehicleLongitude }
      : {}),
  }

  await setDoc(simulationEventRef, event)
}

// シミュレーション用の運行情報を解除
export async function resolveSimulationEvent():
  Promise<void> {

  await updateDoc(simulationEventRef, {
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  })
}

// テスト用の運行情報をリアルタイム監視
export function subscribeSimulationEvent(
  callback: (event: OperationEvent | null) => void,
): () => void {

  return onSnapshot(
    simulationEventRef,

    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null)
        return
      }

      const data = snapshot.data()

      if (
        data.status !== "active" ||
        typeof data.message !== "string" ||
        !data.message.trim() ||
        !isOperationEventType(data.type)
      ) {
        callback(null)
        return
      }

      const event: OperationEvent = {
        type: data.type,
        message: data.message,
        source: data.source === "custom"
          ? "custom"
          : "preset",
        status: "active",
        publishedAt: typeof data.publishedAt === "string"
          ? data.publishedAt
          : new Date().toISOString(),

        ...(typeof data.vehicleLatitude === "number"
          ? { vehicleLatitude: data.vehicleLatitude }
          : {}),

        ...(typeof data.vehicleLongitude === "number"
          ? { vehicleLongitude: data.vehicleLongitude }
          : {}),
      }

      callback(event)
    },

    (error) => {
      console.error(
        "[simulation-events] 監視エラー:",
        error,
      )
      callback(null)
    },
  )
}
