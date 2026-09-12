import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications, type Notification } from '../lib/api'

/** 站內通知——見 server/notifications.ts。SSE 的 `notifications` topic 會
 *  invalidate 這個 key，收到就自動重抓（見 hooks/useLiveSync.ts）。 */
export const NOTIFICATIONS_KEY = ['notifications'] as const

export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: notifications.list,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => notifications.markRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_KEY })
      const prev = qc.getQueryData<Notification[]>(NOTIFICATIONS_KEY)
      qc.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (old) =>
        old?.map((n) => (n.id === id ? { ...n, read: true } : n)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(NOTIFICATIONS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => notifications.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })
}
