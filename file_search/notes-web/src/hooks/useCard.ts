import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** 「看板」（固定網址 `/card`）目前指定哪一則——見 server/card.ts。SSE 的 `card`
 *  topic 一變就 invalidate 這個 key，所有開著 `/card` 的畫面立刻換內容。 */
export const CARD_KEY = ['card'] as const

export function useCard() {
  return useQuery({ queryKey: CARD_KEY, queryFn: api.getCard })
}

export function useSetCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string | null) => api.setCard(noteId),
    onSuccess: (state) => qc.setQueryData(CARD_KEY, state),
  })
}
