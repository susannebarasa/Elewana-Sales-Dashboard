import type { ChartOptions } from 'chart.js'
import type { EntityClickContext } from '@/types'

// Bar-chart property click-through (2026-07-09) — maps a clicked bar's index back to its
// property_id via the SAME array that built the chart's `labels`/`data`, then opens the existing
// PropertyProfilePanel via the standing {type,id,sourceView} EntityClickContext mechanism (no new
// click mechanism). One shared pattern, reused verbatim across every "by Property" bar chart
// (Sales Executive Summary, Pace, Occupancy, Trade Partners) rather than reimplemented per chart.
// Bars with a null id (e.g. Little Elephant Pepper Camp — no property record) are inert: no
// onClick fire, default cursor, same "don't fabricate a link that goes nowhere" convention as the
// table click-throughs.
export function propertyBarClickOptions<T extends { id: string | null }>(
  items: T[],
  onSelectProperty: (context: EntityClickContext) => void,
  sourceView: string
): Pick<ChartOptions<'bar'>, 'onClick' | 'onHover'> {
  return {
    onClick: (_event, elements) => {
      const idx = elements[0]?.index
      if (idx === undefined) return
      const id = items[idx]?.id
      if (id) onSelectProperty({ type: 'property', id, sourceView })
    },
    onHover: (event, elements) => {
      const target = event.native?.target as HTMLElement | null | undefined
      if (target) target.style.cursor = elements.length > 0 ? 'pointer' : 'default'
    },
  }
}
