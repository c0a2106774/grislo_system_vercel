import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app"

import {
  getAuth,
} from "firebase-admin/auth"

import {
  getFirestore,
} from "firebase-admin/firestore"

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(
      `[firebase-admin] Missing environment variable: ${name}`,
    )
  }

  return value
}

const projectId =
  getRequiredEnv("FIREBASE_ADMIN_PROJECT_ID")

const clientEmail =
  getRequiredEnv("FIREBASE_ADMIN_CLIENT_EMAIL")

const privateKey =
  getRequiredEnv("FIREBASE_ADMIN_PRIVATE_KEY")
    .replace(/\\n/g, "\n")

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      })

export const adminAuth =
  getAuth(adminApp)

export const adminDb =
  getFirestore(adminApp)
