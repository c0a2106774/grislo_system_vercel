import {
  NextRequest,
  NextResponse,
} from "next/server"

import { adminAuth } from "@/lib/firebase-admin"

export const runtime = "nodejs"

const LINE_BROADCAST_URL =
  "https://api.line.me/v2/bot/message/broadcast"

const TYPE_LABELS: Record<string, string> = {
  delay: "遅延",
  stopped: "一時停止",
  notice: "お知らせ",
}

export async function POST(
  request: NextRequest,
) {
  try {
    const channelAccessToken =
      process.env
        .LINE_OPERATION_CHANNEL_ACCESS_TOKEN
        ?.trim()

    const adminUid =
      process.env
        .NEXT_PUBLIC_GRISLO_ADMIN_UID
        ?.trim()

    if (!channelAccessToken) {
      console.error(
        "[line-operation] Channel access token is missing",
      )

      return NextResponse.json(
        {
          ok: false,
          error: "Server configuration error.",
        },
        {
          status: 500,
        },
      )
    }

    if (!adminUid) {
      console.error(
        "[line-operation] Admin UID is missing",
      )

      return NextResponse.json(
        {
          ok: false,
          error: "Server configuration error.",
        },
        {
          status: 500,
        },
      )
    }

    /**
     * Firebase ID Tokenを取得
     */
    const authorization =
      request.headers.get("authorization")

    if (
      !authorization ||
      !authorization.startsWith("Bearer ")
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      )
    }

    const idToken =
      authorization.slice("Bearer ".length)

    /**
     * Firebase側でトークンを検証
     */
    let decodedToken

    try {
      decodedToken =
        await adminAuth.verifyIdToken(idToken)
    } catch (error) {
      console.error(
        "[line-operation] Invalid Firebase ID token:",
        error,
      )

      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      )
    }

    /**
     * グリスロ管理者UIDだけ許可
     */
    if (decodedToken.uid !== adminUid) {
      return NextResponse.json(
        {
          ok: false,
          error: "Forbidden",
        },
        {
          status: 403,
        },
      )
    }

    /**
     * 送信内容
     */
    const body = await request.json()

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : ""

    const type =
      typeof body.type === "string"
        ? body.type
        : ""

    if (!message) {
      return NextResponse.json(
        {
          ok: false,
          error: "Message is required.",
        },
        {
          status: 400,
        },
      )
    }

    if (!(type in TYPE_LABELS)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid operation event type.",
        },
        {
          status: 400,
        },
      )
    }

    /**
     * LINEへ送信する文章
     */
    const lineMessage =
      `【グリスロ運行情報｜${TYPE_LABELS[type]}】\n${message}`

    /**
     * LINE Messaging API
     */
    const lineResponse =
      await fetch(
        LINE_BROADCAST_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${channelAccessToken}`,
          },

          body: JSON.stringify({
            messages: [
              {
                type: "text",
                text: lineMessage,
              },
            ],
          }),
        },
      )

    if (!lineResponse.ok) {
      const errorText =
        await lineResponse.text()

      console.error(
        "[line-operation] LINE API error:",
        lineResponse.status,
        errorText,
      )

      return NextResponse.json(
        {
          ok: false,
          error:
            "LINE message send failed.",
        },
        {
          status: 502,
        },
      )
    }

    console.log(
      "[line-operation] Broadcast sent successfully",
    )

    return NextResponse.json({
      ok: true,
    })
  } catch (error) {
    console.error(
      "[line-operation] Unexpected error:",
      error,
    )

    return NextResponse.json(
      {
        ok: false,
        error: "Unexpected server error.",
      },
      {
        status: 500,
      },
    )
  }
}
