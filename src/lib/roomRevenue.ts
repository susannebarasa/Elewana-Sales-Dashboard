// Room Revenue / Extras SQL fragments — shared by dashboard/route.ts and
// agent/[agentId]/route.ts. See constants.ts for the underlying property +
// component classification (Faith's room_revenue_components.csv, 8 July
// 2026 audit). All inputs here are internal, hardcoded constants (never
// user input), so inlining them as string literals in the SQL is safe.
import {
  KENYA_PROPERTY_IDS,
  TANZANIA_MAINLAND_PROPERTY_IDS,
  SERENGETI_EXPLORER_STYLE_PROPERTY_IDS,
  KENYA_ROOM_REVENUE_COMPONENTS,
  TANZANIA_MAINLAND_ROOM_REVENUE_COMPONENTS,
  SERENGETI_EXPLORER_STYLE_ROOM_REVENUE_COMPONENTS,
  DEFAULT_ROOM_REVENUE_COMPONENTS,
  EXCLUDED_FEE_COMPONENTS,
  EXTRAS_TABLE_REVENUE_CATEGORY_IDS,
  DAY_USE_ACCOMMODATION_TYPE_BY_PROPERTY,
} from './constants'

const sqlList = (vals: readonly string[]): string =>
  vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')

// Boolean SQL expression, TRUE when `rc`.component_description counts as
// Room Revenue for `i`.property. Requires `rc` (rate_components, aliased)
// and `i` (itineraries, aliased) to be in scope in the enclosing query.
export const ROOM_REVENUE_CASE = `(CASE
    WHEN i.property IN (${sqlList(KENYA_PROPERTY_IDS)}) THEN rc.component_description IN (${sqlList(KENYA_ROOM_REVENUE_COMPONENTS)})
    WHEN i.property IN (${sqlList(TANZANIA_MAINLAND_PROPERTY_IDS)}) THEN rc.component_description IN (${sqlList(TANZANIA_MAINLAND_ROOM_REVENUE_COMPONENTS)})
    WHEN i.property IN (${sqlList(SERENGETI_EXPLORER_STYLE_PROPERTY_IDS)}) THEN rc.component_description IN (${sqlList(SERENGETI_EXPLORER_STYLE_ROOM_REVENUE_COMPONENTS)})
    ELSE rc.component_description IN (${sqlList(DEFAULT_ROOM_REVENUE_COMPONENTS)})
  END)`

// Boolean SQL expression, TRUE when `rc`.component_description is an
// excluded pass-through fee (never Room Revenue, never Extras).
export const EXCLUDED_FEE_CASE = `rc.component_description IN (${sqlList(EXCLUDED_FEE_COMPONENTS)})`

// Currency-converted room/extras split, as a pair of SUM expressions.
// Usage: add `JOIN rate_components rc ON rc.itinerary_id = i.itinerary_id`
// to the query, then select ROOM_REVENUE_SUM_SQL and EXTRAS_SUM_SQL (each
// takes one `?` placeholder for the KES conversion rate).
export const ROOM_REVENUE_SUM_SQL = `SUM(CASE WHEN ${ROOM_REVENUE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)`
export const EXTRAS_SUM_SQL = `SUM(CASE WHEN NOT ${ROOM_REVENUE_CASE} AND NOT ${EXCLUDED_FEE_CASE} THEN (CASE WHEN dt.currency='KES' THEN rc.amount_gross/? ELSE rc.amount_gross END) ELSE 0 END)`

// Boolean SQL expression, TRUE when `itinAlias` is a Day Use leg (built from
// DAY_USE_ACCOMMODATION_TYPE_BY_PROPERTY, so this and constants.ts never drift apart). Requires
// `itinAlias` (itineraries, caller-supplied alias) in scope.
export const dayUseLegCase = (itinAlias: string): string =>
  `(${Object.entries(DAY_USE_ACCOMMODATION_TYPE_BY_PROPERTY)
    .map(([propertyId, accommodationType]) => `(${itinAlias}.property='${propertyId}' AND ${itinAlias}.accommodation_type='${accommodationType}')`)
    .join(' OR ')})`

// FIX (2026-07-13, extras-table revenue): the `extras` table holds genuine ancillary revenue
// (Activities, F&B, Beverage, Spa, Transfers) for every property, not just Day Use — see
// constants.ts EXTRAS_TABLE_REVENUE_CATEGORY_IDS for what's confirmed clean and what's still
// pending a classification decision. Day Use legs keep counting EVERY extras category,
// unchanged from their pre-existing behavior; every other booking now also counts extras rows
// tagged with one of the confirmed-clean categories. The OR here guarantees each extras row is
// counted at most once (a row can't be both a Day Use leg AND land in the "everywhere else"
// branch), so there's no double-count between the two conditions.
// Requires `i` (itineraries) and `e` (extras) — caller-supplied aliases, since call sites use
// both `i`/`e` and `i2`/`e` depending on the surrounding query.
export const extrasTableRevenueCase = (itinAlias: string, extrasAlias: string): string =>
  `(${dayUseLegCase(itinAlias)} OR ${extrasAlias}.category IN (${sqlList(EXTRAS_TABLE_REVENUE_CATEGORY_IDS)}))`

// Currency-converted sum built from extrasTableRevenueCase above. Takes one `?` placeholder for
// the KES conversion rate.
// IMPORTANT: `extras.currency` stores long text labels ("Kenya Shilling", "US Dollars", "Tanzania
// Shilling", or '') — NOT the short 'KES'/'USD' codes — confirmed live 13 July 2026. A `='KES'`
// check against `extras.currency` directly would never match, silently skipping conversion for
// every KES/TZS-denominated extras row. The pre-existing Day Use code never had this bug because
// it already checked the joined `rate_types.currency` (short codes) instead of `extras.currency`
// — this follows that same, correct precedent. Requires `dtAlias` (rate_types, joined via
// `r.rate_type = dt.rate_type_id` on the reservation) in scope, matching ROOM_REVENUE_SUM_SQL's
// convention.
export const extrasTableRevenueSumSql = (itinAlias: string, extrasAlias: string, dtAlias: string): string =>
  `SUM(CASE WHEN ${extrasTableRevenueCase(itinAlias, extrasAlias)} THEN (CASE WHEN ${dtAlias}.currency='KES' THEN ${extrasAlias}.amount/? ELSE ${extrasAlias}.amount END) ELSE 0 END)`
