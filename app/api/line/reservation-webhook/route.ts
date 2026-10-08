import {
  createHmac,
  timingSafeEqual,
} from "node:crypto"

import {
  NextRequest,
  NextResponse,
} from "next/server"

import {
  adminDb,
} from "@/lib/firebase-admin"

import {
  getCurrentOperatingSchedule,
} from "@/lib/server/operation-schedule"

export const runtime = "nodejs"

const ALERT_DURATION_MS =
  30 * 1000

type LineMessage = {
  id?: string
  type?: string
  text?: string
}

type LineWebhookEvent = {
  type?: string
  webhookEventId?: string
  timestamp?: number
  message?: LineMessage
}

type LineWebhookBody = {
  destination?: string
  events?: LineWebhookEvent[]
}

/**
 * LINE Webhook署名検証
 */
function verifyLineSignature(
  rawBody: string,
  signature: string,
  channelSecret: string,
): boolean {
  const expectedSignature =
    createHmac(
      "sha256",
      channelSecret,
    )
      .update(rawBody)
      .digest("base64")

  const expectedBuffer =
    Buffer.from(
      expectedSignature,
    )

  const receivedBuffer =
    Buffer.from(
      signature,
    )

  if (
    expectedBuffer.length !==
    receivedBuffer.length
  ) {
    return false
  }

  return timingSafeEqual(
    expectedBuffer,
    receivedBuffer,
  )
}

/**
 * ② グリスロ予約・乗車連絡LINE
 *
 * LINE
 * ↓
 * Webhook
 * ↓
 * 運行時間判定
 * ↓
 * Firestore通知
 */
export async function POST(
  request: NextRequest,
) {
  try {
    const channelSecret =
      process.env
        .LINE_RESERVATION_CHANNEL_SECRET
        ?.trim()

    if (!channelSecret) {
      console.error(
        "[line-reservation] Channel secret is not configured",
      )

      return NextResponse.json(
        {
          ok: false,
          error:
            "Server configuration error.",
        },
        {
          status: 500,
        },
      )
    }

    /**
     * LINE署名検証のため
     * JSON化前の本文を取得
     */
    const rawBody =
      await request.text()

    const signature =
      request.headers.get(
        "x-line-signature",
      )

    if (!signature) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid signature.",
        },
        {
          status: 401,
        },
      )
    }

    const validSignature =
      verifyLineSignature(
        rawBody,
        signature,
        channelSecret,
      )

    if (!validSignature) {
      console.warn(
        "[line-reservation] Invalid LINE signature",
      )

      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid signature.",
        },
        {
          status: 401,
        },
      )
    }

    let body: LineWebhookBody

    try {
      body =
        JSON.parse(
          rawBody,
        ) as LineWebhookBody
    } catch (error) {
      console.error(
        "[line-reservation] Invalid JSON:",
        error,
      )

      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid JSON.",
        },
        {
          status: 400,
        },
      )
    }

    const events =
      Array.isArray(body.events)
        ? body.events
        : []

    /**
     * LINE Developersの
     * Webhook URL検証
     */
    if (events.length === 0) {
      console.log(
        "[line-reservation] Webhook verification received",
      )

      return NextResponse.json({
        ok: true,
      })
    }

    /**
     * 1回のWebhookに
     * 複数イベントが含まれる可能性がある
     */
    for (const event of events) {
      /**
       * messageイベント以外は無視
       */
      if (
        event.type !== "message"
      ) {
        continue
      }

      console.log(
        "[line-reservation] Message received",
        {
          webhookEventId:
            event.webhookEventId ??
            "unknown",

          messageId:
            event.message?.id ??
            "unknown",

          messageType:
            event.message?.type ??
            "unknown",
        },
      )

      /**
       * 現在が運行時間中か確認
       */
      const operating =
        await getCurrentOperatingSchedule()

      /**
       * 運行時間外なら
       * 積層灯通知には使用しない
       */
      if (!operating) {
        console.log(
          "[line-reservation] Message ignored because service is not operating",
        )

        continue
      }

      const receivedAt =
        new Date()

      const activeUntil =
        new Date(
          receivedAt.getTime() +
            ALERT_DURATION_MS,
        )

      /**
       * 積層灯制御用Firestoreドキュメント
       *
       * 新しいメッセージが来るたび
       * activeUntilが30秒後へ更新される。
       *
       * そのため赤点灯中に
       * 新しいLINEが来た場合も
       * 30秒タイマーをリセットできる。
       */
      await adminDb
        .collection(
          "ride-contact-alert",
        )
        .doc("current")
        .set(
          {
            status: "active",

            source: "line",

            receivedAt:
              receivedAt.toISOString(),

            activeUntil:
              activeUntil.toISOString(),

            webhookEventId:
              event.webhookEventId ??
              null,

            messageId:
              event.message?.id ??
              null,

            messageType:
              event.message?.type ??
              "unknown",

            operatingDate:
              operating.date,

            operatingTime:
              operating.currentTime,

            scheduleStartTime:
              operating.schedule
                .startTime,

            scheduleEndTime:
              operating.schedule
                .endTime,

            routeType:
              operating.schedule
                .routeType,

            startLocation:
              operating.schedule
                .startLocation ??
              "",
          },
          {
            merge: true,
          },
        )

      console.log(
        "[line-reservation] Ride contact alert activated",
        {
          activeUntil:
            activeUntil.toISOString(),
        },
      )
    }

    return NextResponse.json({
      ok: true,
    })
  } catch (error) {
    console.error(
      "[line-reservation] Unexpected error:",
      error,
    )

    return NextResponse.json(
      {
        ok: false,
        error:
          "Unexpected server error.",
      },
      {
        status: 500,
      },
    )
  }
}
