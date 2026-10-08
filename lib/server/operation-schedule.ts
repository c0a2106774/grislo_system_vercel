import { adminDb } from "@/lib/firebase-admin"

type DaySchedule = {
  isOperating: boolean
  startTime: string
  endTime: string
  routeType: "循環ルート" | "フリー運行"
  routeId?: string
  startLocation?: string
}

type ActiveScheduleResult = {
  date: string
  currentTime: string
  schedule: DaySchedule
}

/**
 * "9:00" と "09:00" を
 * "09:00" に統一する
 */
function normalizeTime(
  value: string,
): string {
  const match =
    String(value)
      .trim()
      .match(/^(\d{1,2}):(\d{1,2})$/)

  if (!match) {
    return String(value).trim()
  }

  const hour =
    Number.parseInt(match[1], 10)

  const minute =
    Number.parseInt(match[2], 10)

  return (
    `${String(hour).padStart(2, "0")}:` +
    `${String(minute).padStart(2, "0")}`
  )
}

/**
 * Vercelのサーバー時刻ではなく、
 * 必ずAsia/Tokyoで現在日時を取得する
 */
function getJapanDateTime() {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Tokyo",

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        hour: "2-digit",
        minute: "2-digit",

        hourCycle: "h23",
      },
    )

  const parts =
    formatter.formatToParts(
      new Date(),
    )

  const values =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    )

  const year = values.year
  const month = values.month
  const day = values.day

  const hour = values.hour
  const minute = values.minute

  return {
    yearMonth:
      `${year}-${month}`,

    date:
      `${year}-${month}-${day}`,

    currentTime:
      `${hour}:${minute}`,
  }
}

/**
 * 現在、日本時間で
 * グリスロが運行時間中か確認する
 */
export async function
getCurrentOperatingSchedule():
Promise<ActiveScheduleResult | null> {
  const japanTime =
    getJapanDateTime()

  /**
   * Firestore:
   * schedules/2026-10
   */
  const scheduleSnapshot =
    await adminDb
      .collection("schedules")
      .doc(japanTime.yearMonth)
      .get()

  if (!scheduleSnapshot.exists) {
    return null
  }

  const data =
    scheduleSnapshot.data()

  const days =
    data?.days as
      | Record<string, DaySchedule | DaySchedule[]>
      | undefined

  if (!days) {
    return null
  }

  const today =
    days[japanTime.date]

  if (!today) {
    return null
  }

  const schedules =
    Array.isArray(today)
      ? today
      : [today]

  const currentTime =
    normalizeTime(
      japanTime.currentTime,
    )

  const activeSchedule =
    schedules.find(
      (schedule) =>
        schedule.isOperating === true &&
        currentTime >=
          normalizeTime(
            schedule.startTime,
          ) &&
        currentTime <=
          normalizeTime(
            schedule.endTime,
          ),
    )

  if (!activeSchedule) {
    return null
  }

  return {
    date: japanTime.date,
    currentTime,
    schedule: activeSchedule,
  }
}
