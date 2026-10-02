import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore"
import { db } from "./firebase"

import type {
  OperationEvent,
  OperationEventInput,
  OperationEventTemplate,
  OperationEventType,
} from "./types"

// 現在Web地図に表示している運行情報
const CURRENT_EVENT_COLLECTION = "operation-status"
const CURRENT_EVENT_DOCUMENT = "current"

// 遅延・停止情報の定型文を保存する場所
const TEMPLATE_COLLECTION = "settings"
const TEMPLATE_DOCUMENT = "operation-event-templates"

// Firestoreにまだ定型文が登録されていない場合に使用する初期データ
export const DEFAULT_OPERATION_EVENT_TEMPLATES: OperationEventTemplate[] = [
  {
    id: "delay-10",
    type: "delay",
    message: "道路混雑のため、約10分遅れています。",
  },
  {
    id: "delay-20",
    type: "delay",
    message: "道路混雑のため、約20分遅れています。",
  },
  {
    id: "delay-boarding",
    type: "delay",
    message: "乗降対応のため、遅れが発生しています。",
  },
  {
    id: "stopped-safety",
    type: "stopped",
    message: "安全確認のため、一時停止しています。",
  },
  {
    id: "stopped-vehicle",
    type: "stopped",
    message: "車両確認のため、一時停止しています。",
  },
  {
    id: "notice-resume",
    type: "notice",
    message: "まもなく運行を再開します。",
  },
]

// Firestoreから取得した文字列が
// OperationEventTypeとして正しいか確認する
function isOperationEventType(
  value: unknown,
): value is OperationEventType {
  return (
    value === "delay" ||
    value === "stopped" ||
    value === "notice"
  )
}

/**
 * 現在表示中の運行情報をリアルタイム監視する
 *
 * Firestore:
 * operation-status/current
 */
export function subscribeOperationEvent(
  callback: (event: OperationEvent | null) => void,
): () => void {
  const eventRef = doc(
    db,
    CURRENT_EVENT_COLLECTION,
    CURRENT_EVENT_DOCUMENT,
  )

  const unsubscribe = onSnapshot(
    eventRef,

    (snapshot) => {
      // currentドキュメントが存在しない場合
      if (!snapshot.exists()) {
        callback(null)
        return
      }

      const data = snapshot.data()

      // activeでなければWeb地図には表示しない
      if (data.status !== "active") {
        callback(null)
        return
      }

      // メッセージが正しくない場合
      if (typeof data.message !== "string") {
        callback(null)
        return
      }

      // typeが想定外の場合
      if (!isOperationEventType(data.type)) {
        callback(null)
        return
      }

      const event: OperationEvent = {
        type: data.type,

        message: data.message,

        source:
          data.source === "custom"
            ? "custom"
            : "preset",

        status: "active",

        publishedAt:
          typeof data.publishedAt === "string"
            ? data.publishedAt
            : new Date().toISOString(),

        vehicleLatitude:
          typeof data.vehicleLatitude === "number"
            ? data.vehicleLatitude
            : undefined,

        vehicleLongitude:
          typeof data.vehicleLongitude === "number"
            ? data.vehicleLongitude
            : undefined,
      }

      callback(event)
    },

    (error) => {
      console.error(
        "[operation-event] Firestore監視エラー:",
        error,
      )

      callback(null)
    },
  )

  return unsubscribe
}

/**
 * 遅延・停止・お知らせ情報を送信する
 *
 * Firestore:
 * operation-status/current
 */
export async function publishOperationEvent(
  input: OperationEventInput,
): Promise<boolean> {
  try {
    const message = input.message.trim()

    // 空文字は送信しない
    if (!message) {
      return false
    }

    const eventRef = doc(
      db,
      CURRENT_EVENT_COLLECTION,
      CURRENT_EVENT_DOCUMENT,
    )

    const event: OperationEvent = {
      type: input.type,

      message,

      source: input.source,

      status: "active",

      publishedAt: new Date().toISOString(),

      ...(typeof input.vehicleLatitude === "number"
        ? {
            vehicleLatitude:
              input.vehicleLatitude,
          }
        : {}),

      ...(typeof input.vehicleLongitude === "number"
        ? {
            vehicleLongitude:
              input.vehicleLongitude,
          }
        : {}),
    }

    await setDoc(eventRef, event)

    return true
  } catch (error) {
    console.error(
      "[operation-event] 運行情報送信エラー:",
      error,
    )

    return false
  }
}

/**
 * 現在表示している運行情報を解除する
 */
export async function resolveOperationEvent(): Promise<boolean> {
  try {
    const eventRef = doc(
      db,
      CURRENT_EVENT_COLLECTION,
      CURRENT_EVENT_DOCUMENT,
    )

    await setDoc(
      eventRef,

      {
        status: "resolved",
        resolvedAt: new Date().toISOString(),
      },

      {
        merge: true,
      },
    )

    return true
  } catch (error) {
    console.error(
      "[operation-event] 運行情報解除エラー:",
      error,
    )

    return false
  }
}

/**
 * iPad / スマホの左側パネルに表示する
 * 保存済み定型文を取得する
 *
 * Firestore:
 * settings/operation-event-templates
 */
export async function getOperationEventTemplates(): Promise<
  OperationEventTemplate[]
> {
  try {
    const templateRef = doc(
      db,
      TEMPLATE_COLLECTION,
      TEMPLATE_DOCUMENT,
    )

    const snapshot = await getDoc(templateRef)

    // すでにFirestoreに登録されている場合
    if (snapshot.exists()) {
      const data = snapshot.data()

      if (Array.isArray(data.templates)) {
        const templates =
          data.templates.filter(
            (
              item: unknown,
            ): item is OperationEventTemplate => {
              if (
                !item ||
                typeof item !== "object"
              ) {
                return false
              }

              const value =
                item as Record<string, unknown>

              return (
                typeof value.id === "string" &&
                typeof value.message === "string" &&
                isOperationEventType(value.type)
              )
            },
          )

        // 正常な定型文が1件以上あれば使用
        if (templates.length > 0) {
          return templates
        }
      }
    }

    // Firestoreにまだ無い場合は初期データを書き込む
    await setDoc(
      templateRef,

      {
        templates:
          DEFAULT_OPERATION_EVENT_TEMPLATES,

        updatedAt:
          new Date().toISOString(),
      },

      {
        merge: true,
      },
    )

    return DEFAULT_OPERATION_EVENT_TEMPLATES
  } catch (error) {
    console.error(
      "[operation-event] 定型文取得エラー:",
      error,
    )

    // Firestoreでエラーになっても
    // 最低限アプリが使えるよう初期データを返す
    return DEFAULT_OPERATION_EVENT_TEMPLATES
  }
}
