
"use client"

import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth"

import { LogIn, LogOut, ShieldCheck } from "lucide-react"

import { app } from "@/lib/firebase"

/**
 * .env.local で設定した管理者UID
 */
const ADMIN_UID =
  process.env.NEXT_PUBLIC_GRISLO_ADMIN_UID?.trim() ?? ""

interface OperatorLayoutProps {
  children: ReactNode
}

/**
 * /operator 以下のすべての画面に
 * 管理者ログインを適用する
 */
export default function OperatorLayout({
  children,
}: OperatorLayoutProps) {
  // 現在ログインしているユーザー
  const [user, setUser] = useState<User | null>(null)

  // 初回のログイン状態確認
  const [checking, setChecking] = useState(true)

  // ログイン・ログアウト処理中
  const [loading, setLoading] = useState(false)

  // ログインフォーム
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  // エラーメッセージ
  const [errorMessage, setErrorMessage] = useState("")

  /**
   * Firebaseのログイン状態を監視
   */
  useEffect(() => {
    const auth = getAuth(app)

    const unsubscribe = onAuthStateChanged(
      auth,

      (currentUser) => {
        setUser(currentUser)
        setChecking(false)
      },

      (error) => {
        console.error(
          "[operator-auth] 認証状態の取得エラー:",
          error,
        )

        setErrorMessage(
          "認証状態を確認できませんでした。",
        )

        setChecking(false)
      },
    )

    return () => {
      unsubscribe()
    }
  }, [])

  /**
   * 指定された管理者かどうかを確認
   */
  const isAdmin =
    ADMIN_UID !== "" &&
    user?.uid === ADMIN_UID

  /**
   * ログイン処理
   */
  async function handleLogin(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (loading || !ADMIN_UID) {
      return
    }

    setLoading(true)
    setErrorMessage("")

    try {
      const auth = getAuth(app)

      const result = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      )

      // 指定された管理者以外はログインさせない
      if (result.user.uid !== ADMIN_UID) {
        await signOut(auth)

        setErrorMessage(
          "このアカウントには管理権限がありません。",
        )

        return
      }

      // ログインに成功したらパスワード欄を空にする
      setPassword("")
    } catch (error) {
      const code =
        (error as { code?: string }).code ?? ""

      console.error(
        "[operator-auth] ログインエラー:",
        code,
      )

      if (
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found"
      ) {
        setErrorMessage(
          "メールアドレスまたはパスワードが正しくありません。",
        )
      } else if (
        code === "auth/operation-not-allowed"
      ) {
        setErrorMessage(
          "Firebaseでメール／パスワード認証が有効になっていません。",
        )
      } else if (
        code === "auth/too-many-requests"
      ) {
        setErrorMessage(
          "ログイン試行が多すぎます。しばらくしてから再試行してください。",
        )
      } else if (
        code === "auth/network-request-failed"
      ) {
        setErrorMessage(
          "ネットワークに接続できませんでした。",
        )
      } else {
        setErrorMessage(
          "ログインに失敗しました。設定を確認してください。",
        )
      }
    } finally {
      setLoading(false)
    }
  }

  /**
   * ログアウト処理
   */
  async function handleLogout() {
    if (loading) {
      return
    }

    setLoading(true)
    setErrorMessage("")

    try {
      await signOut(getAuth(app))

      setEmail("")
      setPassword("")
    } catch (error) {
      console.error(
        "[operator-auth] ログアウトエラー:",
        error,
      )

      setErrorMessage(
        "ログアウトに失敗しました。",
      )
    } finally {
      setLoading(false)
    }
  }

  /**
   * ログイン状態を確認している間は
   * 管理画面を表示しない
   */
  if (checking) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          backgroundColor: "#f3f4f6",
          color: "#374151",
        }}
      >
        ログイン状態を確認しています...
      </main>
    )
  }

  /**
   * .env.local にUIDがない場合
   */
  if (!ADMIN_UID) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          backgroundColor: "#f3f4f6",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            padding: 24,
            backgroundColor: "white",
            borderRadius: 12,
            color: "#b91c1c",
            lineHeight: 1.7,
          }}
        >
          管理者UIDが設定されていません。
          .env.local の
          NEXT_PUBLIC_GRISLO_ADMIN_UID
          を確認して、開発サーバーを再起動してください。
        </div>
      </main>
    )
  }

  /**
   * 管理者としてログイン済みなら
   * 既存の管理画面を表示
   */
  if (isAdmin) {
    return (
      <>
        {children}

        <button
          type="button"
          aria-label="ログアウト"
          onClick={handleLogout}
          disabled={loading}
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 12000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "12px 16px",
            border: "1px solid #d1d5db",
            borderRadius: 10,
            backgroundColor: "white",
            color: "#374151",
            fontSize: 14,
            fontWeight: 700,
            boxShadow:
              "0 4px 14px rgba(0, 0, 0, 0.18)",
            cursor: loading ? "default" : "pointer",
          }}
        >
          <LogOut size={18} />

          {loading ? "処理中..." : "ログアウト"}
        </button>
      </>
    )
  }

  /**
   * 未ログインの場合はログイン画面
   */
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: 20,
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
        backgroundColor: "#f3f4f6",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 28,
          boxSizing: "border-box",
          borderRadius: 16,
          backgroundColor: "white",
          boxShadow:
            "0 6px 24px rgba(0, 0, 0, 0.1)",
        }}
      >
        {/* ログイン画面のアイコン */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 14,
            color: "#2563eb",
          }}
        >
          <ShieldCheck size={44} />
        </div>

        {/* タイトル */}
        <h1
          style={{
            margin: "0 0 8px",
            textAlign: "center",
            fontSize: 24,
            fontWeight: 800,
            color: "#111827",
          }}
        >
          グリスロ運行管理
        </h1>

        <p
          style={{
            margin: "0 0 24px",
            textAlign: "center",
            fontSize: 14,
            color: "#6b7280",
          }}
        >
          管理者アカウントでログインしてください
        </p>

        {/* 管理者ではないアカウントの場合 */}
        {user && !isAdmin && (
          <p
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: "#fffbeb",
              color: "#92400e",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            現在のアカウントには管理権限がありません。
            管理者アカウントでログインしてください。
          </p>
        )}

        {/* ログインフォーム */}
        <form onSubmit={handleLogin}>
          <label
            htmlFor="admin-email"
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: 14,
              fontWeight: 700,
              color: "#374151",
            }}
          >
            メールアドレス
          </label>

          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
            placeholder="admin@example.com"
            style={{
              width: "100%",
              padding: "12px 14px",
              marginBottom: 18,
              boxSizing: "border-box",
              border: "1px solid #d1d5db",
              borderRadius: 9,
              fontSize: 16,
            }}
          />

          <label
            htmlFor="admin-password"
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: 14,
              fontWeight: 700,
              color: "#374151",
            }}
          >
            パスワード
          </label>

          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
            style={{
              width: "100%",
              padding: "12px 14px",
              marginBottom: 20,
              boxSizing: "border-box",
              border: "1px solid #d1d5db",
              borderRadius: 9,
              fontSize: 16,
            }}
          />

          {/* エラーメッセージ */}
          {errorMessage && (
            <p
              role="alert"
              style={{
                padding: 12,
                borderRadius: 8,
                backgroundColor: "#fef2f2",
                color: "#b91c1c",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {errorMessage}
            </p>
          )}

          {/* ログインボタン */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px 16px",
              border: "none",
              borderRadius: 10,
              backgroundColor: loading
                ? "#9ca3af"
                : "#2563eb",
              color: "white",
              fontSize: 16,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
              cursor: loading ? "default" : "pointer",
            }}
          >
            <LogIn size={19} />

            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>
      </section>
    </main>
  )
}

