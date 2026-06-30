/**
 * Elewana Sales Dashboard — Business Logic Constants
 *
 * Single source of truth for all confirmed business rules, derived from
 * verification work done with Faith Njoki (Revenue & Reservations) and
 * Emiliano. Every query touching revenue, ADR, occupancy, or trade partner
 * classification should import from this file rather than hardcoding
 * values inline.
 *
 * Last verified: 26 June 2026
 */

// ─────────────────────────────────────────────────────────────────
// EXCHANGE RATE
// ─────────────────────────────────────────────────────────────────
// Confirmed via Faith's official Finance-signed monthly memos (D. Gitau).
// Flat 129 for every month of 2025 and 2026, no exceptions.
// 2024 was volatile (128–160) but is NOT currently used anywhere in this
// dashboard — only relevant if a 2024 comparison year is ever added.
export const KES_USD_RATE = 129;

// ─────────────────────────────────────────────────────────────────
// DATE LOGIC
// ─────────────────────────────────────────────────────────────────
// Confirmed by Emiliano: use travel/stay date (date_in), not the date
// the booking was confirmed. This matches Qliksense's own agent-level
// reporting convention.
export const DATE_FIELD = 'date_in'; // NOT confirmation_date

// ─────────────────────────────────────────────────────────────────
// BOOKING STATUS CODES
// ─────────────────────────────────────────────────────────────────
export const BOOKING_STATUS = {
  NEW_INQUIRY: '0',
  QUOTE: '10',
  PROVISIONAL: '20',
  CONFIRMED: '30',
  CANCELLED_ARCHIVED: '90', // CONFIRMED via Faith/Clint — NOT "Completed".
  // A schema-discovery tool may report this as "90=Completed" — that is
  // WRONG and must not be relied upon. If status=90 bookings were ever
  // mistakenly treated as valid completed business, cancelled/archived
  // bookings would be silently included in revenue figures.
} as const;

export const CONFIRMED_STATUS = BOOKING_STATUS.CONFIRMED; // '30' — the standard filter

// ─────────────────────────────────────────────────────────────────
// NON-REVENUE RATE TYPE EXCLUSIONS
// ─────────────────────────────────────────────────────────────────
// Confirmed via dim_rate_types.name export. These rate types represent
// FAM trips, complimentary stays, and staff rates — exclude from ALL
// revenue and ADR calculations regardless of total_amount (even if a
// discounted non-zero amount is present, it's still non-commercial).
//
// IMPORTANT: this is a separate filter from booking-COUNT exclusions
// below — do not conflate the two.
export const NON_REVENUE_RATE_TYPE_IDS = [
  // Complimentary
  'WB115', 'WB116', 'WB219', 'RS2',
  // FAM Stay (USD + KES variants)
  'WB798', 'WB799', 'WB800', 'WB803', 'WB804', 'WB806',
  'a18c2aa6-f84b-48ae-bbde-a85f1ebe56a3', // Fam Stay FB KES
  'a18c2add-ee73-44ee-bf43-c3cc0d91229a', // Fam Stay GP KES
  // Staff Rate (incl. EUR variants)
  'WB811', 'WB812', 'WB813', 'WB814', 'WB816', 'WB817', 'WB818', 'WB819', 'WB820', 'WB821', 'WB823',
  // TNC Staff Official / Personal — UUID-format, no WB codes
  // (full UUID list to be added once consolidated from dim_rate_types)
] as const;

// CONFIRMED NOT a non-revenue rate type, despite the generic-sounding name:
// WB117 = "Extra's Only" — a legitimate ancillary charge type. Frequently
// appears as a $0 companion booking for transit stays through Arusha
// Coffee Lodge. Do NOT add this to the exclusion list.
export const EXTRAS_ONLY_RATE_TYPE_ID = 'WB117';

// ─────────────────────────────────────────────────────────────────
// RESIDENT (EAR) RATE TYPE CLASSIFICATION
// ─────────────────────────────────────────────────────────────────
// Confirmed by Faith: residency is determined by rate TYPE, not guest
// nationality (no usable nationality field exists in ResRequest).
// "EAR" = East Africa Resident. Includes both KES and USD-priced variants
// — do NOT use currency='KES' as a proxy, it misses ~32 USD-priced EAR
// rate types and incorrectly includes some non-EAR KES bookings (e.g.
// Fam Stay KES).
export const EAR_RESIDENT_RATE_TYPE_IDS = [
  // KES-priced EAR rates
  'WB554', 'WB555', 'WB89', 'WB91',
  '11ed551df11c0ad58f16ac1f6b1b6a6e', // EAR 15% KES HB
  '11edff7c80472c578489ac1f6b1b6a6e', // EAR 20% KES FB
  '11edff7c867b757d8489ac1f6b1b6a6e', // EAR 20% KES GP
  '11edff7c8d3204668489ac1f6b1b6a6e', // EAR 20% KES HB
  '11eae3854f5ba1199ef90cc47a7ebf7a', // EAR Flying Package Weekends
  // USD-priced EAR rates (previously invisible to the currency proxy)
  'WB86', 'WB88', 'WB90', 'WB630', 'WB631', 'WB632', 'WB633', 'WB634',
  '11ec0645c650b00da4ac0cc47a7ebf7a', // EAR 15% USD AI
  '11e9d2e39fa5f9c7aabeac1f6b672056', // EAR 15% USD DS
  '11ed67024be103d48fc6ac1f6b1b6a6e', // EAR 15% USD FB
  '11ed67024ea0d6138fc6ac1f6b1b6a6e', // EAR 15% USD GP
  '11ed670251649a4b8fc6ac1f6b1b6a6e', // EAR 15% USD HB
  '11edff7c3f94d0418489ac1f6b1b6a6e', // EAR 20% USD AI
  '11edff7c455fd4b88489ac1f6b1b6a6e', // EAR 20% USD BB
  '11edff7c4caeab468489ac1f6b1b6a6e', // EAR 20% USD BB Upgrade
  '11edff7c539a04718489ac1f6b1b6a6e', // EAR 20% USD DR
  '11edff7c59ffec9b8489ac1f6b1b6a6e', // EAR 20% USD DS
  '11edff7c60796cf28489ac1f6b1b6a6e', // EAR 20% USD FB
  '11edff7c68697c8e8489ac1f6b1b6a6e', // EAR 20% USD GP
  '11edff7c6e863e108489ac1f6b1b6a6e', // EAR 20% USD HB
  '11ec06460662b060a4ac0cc47a7ebf7a', // EAR USD Published AI
  '11ed5437f396e4d38f16ac1f6b1b6a6e', // EAR USD Published HB
  // (remainder of the 41 confirmed EAR rate types to be added once
  // the full export is reconciled — see decisions doc)
] as const;

// ─────────────────────────────────────────────────────────────────
// AGENT EXCLUSIONS — NOT genuine third-party trade partners
// ─────────────────────────────────────────────────────────────────
export const EXCLUDED_AGENT_IDS = [
  '0',          // System placeholder — walk-ins/unassigned
  'WB51589',    // "Elewana Travel (Test)" — test account
] as const;

// Exact-match exclusion (NOT a wildcard — must not also exclude the
// real entity "Cheli & Peacock Safaris (T) Limited")
export const EXCLUDED_AGENT_NAMES_EXACT = [
  'Cheli & Peacock Safaris', // legacy/duplicate name, no "(T) Limited" suffix
] as const;

// Wildcard exclusion pattern
export const EXCLUDED_AGENT_NAME_PATTERN = '%direct%'; // case-insensitive

// CONFIRMED legitimate, do NOT exclude despite being Elewana-owned:
// "Elewana Travel Limited" and "Elewana Travel Ltd Kenya" — Elewana's own
// in-house booking arm, ~$18M combined revenue, 80%+ of bookings have real
// non-NULL amounts. Faith's own segment file classifies these under
// DMC (International Presence), same as third-party agents — follow her
// classification rather than creating a separate "internal" category
// (pending her confirmation on the reasoning).
export const ELEWANA_INTERNAL_AGENT_IDS = ['WB686', 'WB103417'] as const;

// ─────────────────────────────────────────────────────────────────
// BOOKING-COUNT FILTER (separate from revenue/ADR exclusion logic!)
// ─────────────────────────────────────────────────────────────────
// For KPIs counting "bookings" or "active trade partners" (NOT revenue
// or ADR), additionally filter total_amount > 0. This is intentional
// and necessary even on top of the named non-revenue exclusion list,
// because a class of bookings ("Extra's Only" / WB117 companion records
// at Arusha Coffee Lodge — transit-leg ancillary charges with no
// independent stay) would otherwise double-count guests whose primary
// reservation is already counted elsewhere.
//
// DO NOT apply this same total_amount > 0 filter to revenue/ADR
// calculations — those should sum ALL non-excluded revenue, including
// $0 records on legitimate revenue rate types (e.g. pricing not yet
// entered), since excluding them would understate real activity.
export const BOOKING_COUNT_REQUIRES_NONZERO_AMOUNT = true;

// ─────────────────────────────────────────────────────────────────
// JOIN / AGGREGATION SAFETY
// ─────────────────────────────────────────────────────────────────
// CRITICAL: a reservation can have multiple itinerary rows (avg 1.86,
// up to 6+ — one per property-stay leg in a multi-property circuit).
// Joining reservations → itineraries and then summing total_amount
// WITHOUT first deduplicating to one row per reservation_number will
// inflate revenue ~3x. This bug was found and fixed twice on the
// original dashboard before being eliminated at the source here.
//
// ALWAYS deduplicate to one row per reservation_number BEFORE joining
// for date-filtering or summing revenue. Room-night calculations
// (DATEDIFF per leg) are the one legitimate exception — summing across
// itinerary legs IS correct there, since each leg is a real, distinct
// stay component.
export const JOIN_SAFETY_NOTE =
  'Always dedupe to one row per reservation_number before summing total_amount. ' +
  'DATEDIFF-based room-night sums across itinerary legs are the one correct exception.';

// ─────────────────────────────────────────────────────────────────
// ROOM CAPACITY (for occupancy calculations)
// ─────────────────────────────────────────────────────────────────
// ResRequest has NO room/unit capacity field anywhere in the system
// (confirmed via exhaustive search, both MotherDuck and direct MySQL).
// This data is externally sourced from Faith and must be maintained
// manually — it does not come from any database query.
export const PROPERTY_ROOM_COUNTS: Record<string, number> = {
  'Arusha Coffee Lodge': 30,
  'Serengeti Explorer': 74, // confirmed via Faith's file + plausibility check against occupancy %
  'Tortilis Camp Amboseli': 20,
  'The Manor at Ngorongoro': 20,
  'Serengeti Migration Camp': 20,
  'Serengeti Pioneer Camp': 12,
  'Kilindi Zanzibar': 15, // closed May
  'Tarangire Treetops': 20,
  "Elsa's Kopje Meru": 12,
  'Loisaba Tented Camp': 12,
  'Loisaba Star Beds': 4, // closed Apr–May
  'Lodo Springs': 8, // ⚠ low confidence, conflicting sources (6/7/8) — verify with Faith
  'Sand River Mara': 16,
  'Elephant Pepper Camp': 10,
  'Little Elephant Pepper Camp': 4, // opens June 2026
  'Lewa Safari Camp': 13, // opens June 2026 (post-refurb)
  'Kifaru House Lewa': 5,
  // Ngorongoro Explorer (84 keys) — under construction, not operational
  // until May 2027. Exclude from occupancy denominators until then.
};

export const NGORONGORO_EXPLORER_OPENING = '2027-05-01';

// ─────────────────────────────────────────────────────────────────
// OCCUPANCY SCOPE
// ─────────────────────────────────────────────────────────────────
// Occupancy is conceptually retrospective ("how full were we"), unlike
// revenue/bookings elsewhere on the dashboard which use the full-year
// date_in standard (including future confirmed bookings). For occupancy
// specifically, scope to ACTUALIZED stays only (date_out <= today).
export const OCCUPANCY_USES_ACTUALIZED_STAYS_ONLY = true;

// Show ALL-CHANNEL occupancy (not agent-channel only) — matches how
// Qliksense presents it, and reflects that a meaningful share of 2026
// business has come through direct/local channels, not just trade
// partners.
export const OCCUPANCY_SCOPE = 'all-channel'; // NOT 'agent-channel-only'
