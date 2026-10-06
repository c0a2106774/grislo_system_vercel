import { NextRequest, NextResponse } from "next/server"

const LINE_BROADCAST_URL =
  "https://api.line.me/v2/bot/message/broadcast"

/**
 * グリスロ運行情報LINE
 * テスト送信用API
 *
 * POST /api/line/operation-test
 */
export async function POST(request: NextRequest) {
  try {
    const channelAccessToken =
      process.env.LINE_OPERATION_CHANNEL_ACCESS_TOKEN

    const testKey =
      process.env.LINE_OPERATION_TEST_KEY

    /**
     * Vercelの環境変数チェック
     */
    if (!channelAccessToken) {
      console.error(
        "[line-operation] LINE_OPERATION_CHANNEL_ACCESS_TOKEN is not configured",
      )

      return NextResponse.json(
        {
          ok: false,
          error:
            "LINE channel access token is not configured.",
        },
        {
          status: 500,
        },
      )
    }

    if (!testKey) {
      console.error(
        "[line-operation] LINE_OPERATION_TEST_KEY is not configured",
      )

      return NextResponse.json(
        {
          ok: false,
          error:
            "LINE test key is not configured.",
        },
        {
          status: 500,
        },
      )
    }

    /**
     * テストAPIを第三者から勝手に
     * 使用されないようにする
     */
    const receivedTestKey =
      request.headers.get("x-grislo-test-key")

    if (
      !receivedTestKey ||
      receivedTestKey !== testKey
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

    /**
     * リクエスト本文
     */
    const body = await request.json()

    const message =
      typeof body.message === "string"
        ? body.message.trim()
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

    /**
     * LINE Messaging API
     * Broadcast Message
     */
    const lineResponse = await fetch(
      LINE_BROADCAST_URL,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization:
            `Bearer ${channelAccessToken}`,
        },

        body: JSON.stringify({
          messages: [
            {
              type: "text",
              text: message,
            },
          ],
        }),
      },
    )

    /**
     * LINE側でエラーになった場合
     */
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
          error: "LINE API request failed.",
        },
        {
          status: 502,
        },
      )
    }

    console.log(
      "[line-operation] Test message sent successfully",
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
