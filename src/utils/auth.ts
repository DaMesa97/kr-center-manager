import * as Sentry from '@sentry/electron/renderer'
import type { CurrentUser } from '../types'

export function setSentryUserFromProfile(profile: CurrentUser): void {
  Sentry.setUser({
    id: profile.id,
    email: profile.email || undefined,
    username: profile.full_name,
  })
  Sentry.setContext('profile', {
    role: profile.role,
    department: profile.department,
    initials: profile.initials,
  })
}

export function clearSentryUserContext(): void {
  Sentry.setUser(null)
  Sentry.setContext('profile', null)
}
