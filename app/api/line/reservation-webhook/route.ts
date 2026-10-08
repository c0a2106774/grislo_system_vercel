import {
  createHmac,
  timingSafeEqual,
} from "node:crypto"

import {
  NextRequest,
  NextResponse,
} from "next/server"

export const runtime = "nodejs"

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
 * LINE Webhookの署名を検証する
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
    Buffer.from(expectedSignature)

  const receivedBuffer =
    Buffer.from(signature)

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
 *   ↓
 * POST /api/line/reservation-webhook
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
     * 重要：
     * JSONへ変換する前の本文を取得する。
     *
     * LINEの署名検証では
     * 元の本文をそのまま使用する必要がある。
     */
    const rawBody =
      await request.text()

    const signature =
      request.headers.get(
        "x-line-signature",
      )

    if (!signature) {
      console.warn(
        "[line-reservation] Missing LINE signature",
      )

      return NextResponse.json(
        {
          ok: false,
          error: "Invalid signature.",
        },
        {
          status: 401,
        },
      )
    }

    /**
     * LINEからの正規Webhookか確認
     */
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
          error: "Invalid signature.",
        },
        {
          status: 401,
        },
      )
    }

    /**
     * 署名検証成功後にJSONへ変換
     */
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
          error: "Invalid JSON.",
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
     * LINE DevelopersのWebhook検証では
     * events: [] が送られることがある。
     *
     * その場合も200を返す。
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
     * 今回はまだ積層灯を動かさない。
     *
     * LINEの「message」イベントを
     * 正常に受信できたことだけ確認する。
     */
    for (const event of events) {
      if (event.type !== "message") {
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
