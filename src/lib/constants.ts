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
  // Additional Complimentary / FAM Stay / SE-Staff Rate / Staff Rate variants — UUID-format,
  // no WB codes. Consolidated from rate_types (confirmed 2 July 2026 via full-schema search
  // matching '%fam%' / '%staff%' / '%complimentary%' — 50 total non-revenue rate types exist,
  // only 23 were captured above before this addition).
  '11ec064461b1c4f4a4ac0cc47a7ebf7a', // Complimentary Rate AI
  '11e8c80786243bfea320ac1f6b672056', // Complimentary Rate DS
  '11ec3ae8b354b199ac240cc47a7ebf7a', // Complimentary Rate HB
  '11ec06469ffb7d89a4ac0cc47a7ebf7a', // FAM Stay AI
  '11e8cab64a48886ca320ac1f6b672056', // FAM Stay DS
  '11eea4ce56c7f6c781f8ac1f6be20cd0', // SE-Fam Stay FB
  '11eea4ce59de7f2781f8ac1f6be20cd0', // SE-Fam Stay GP
  '11eea4ce5d14238681f8ac1f6be20cd0', // SE-Fam Stay HB
  '11eea4ce6b7e4a4481f8ac1f6be20cd0', // SE-Staff Rate FB
  '11eea4ce6ebb3be381f8ac1f6be20cd0', // SE-Staff Rate GP
  '11eea4ce7127367981f8ac1f6be20cd0', // SE-Staff Rate HB
  '11ec064e4c0f12e4a4ac0cc47a7ebf7a', // Staff Rate AI
  '11ee9593a7628e7781f8ac1f6be20cd0', // Staff Rate DS
  // TNC Staff Official / Personal — UUID-format, no WB codes
  'a0e3836a-6a1e-41ed-b28b-fc0da3b5163d', // TNC Staff Official AI
  '11efdf9c0b3c3b69a35a3cecef956aee', // TNC Staff Official BB
  'a0e38397-6552-40e4-b8b9-dedbdb4ca4dd', // TNC Staff Official BB Upgrade
  '11eff8cdd5b859dba35a3cecef956aee', // TNC Staff Official DR
  'a0e3853d-13fd-4a22-aa45-790aa76ada93', // TNC Staff Official DS
  '11ea5fbbebf2d3278b530cc47a7eb372', // TNC Staff Official FB
  '11ea5fbbf74917538b530cc47a7eb372', // TNC Staff Official GP
  'a0e2033c-b873-4fe3-a742-1dde243723be', // TNC Staff Personal AI
  '11eff8cf185a85f5a35a3cecef956aee', // TNC Staff Personal BB
  'a0e20351-5c9b-4d65-b909-11c4101d4b68', // TNC Staff Personal BB Upgrade
  '11eff8cecbef68aca35a3cecef956aee', // TNC Staff Personal DR
  'a0e20369-9c07-4cc7-a0a5-341f22f1cb79', // TNC Staff Personal DS
  '11ea5fbc033e09558b530cc47a7eb372', // TNC Staff Personal FB
  '11ea5fbc0c17cdba8b530cc47a7eb372', // TNC Staff Personal GP
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
  // FIX (9 July 2026, Low-Season Occupancy Lift build): "Elewana Staff*" (WB19) surfaced at the
  // top of a %-sorted agent table (100% low-season, but only $210/57 nights total — tiny volume
  // inflating a meaningless percentage). This is an internal staff comp-stay account, NOT a real
  // trade partner — a different thing entirely from the CONFIRMED-legitimate "Elewana Travel
  // Limited"/"Elewana Travel Ltd Kenya" in-house BOOKING arm (ELEWANA_INTERNAL_AGENT_IDS below),
  // which genuinely sells third-party business and stays included. Excluded here (the shared
  // list) rather than in one query, since any agent-ranking view — Top Trade Partners, Active
  // Trade Partners, Agent Pace, Cancellation Drivers — could equally surface it.
  'WB19',       // "Elewana Staff*" — internal staff comp stays, not a trade partner
] as const;

// Exact-match exclusion (NOT a wildcard).
// FIX (9 July 2026): "Cheli & Peacock Safaris" (agent_id RS23) was previously excluded here
// as an assumed "legacy/duplicate" of "Cheli & Peacock Safaris (T) Limited" (WB133564) — that
// assumption was backwards. RS23 is the Kenya office, WB133564 is the separate Tanzania entity
// ("(T) Limited" = Tanzania Limited) — sister entities, not duplicates. Confirmed with Faith/
// Felix: RS23 is a real, active B2B DMC agent (continuously booking since 2021-05-12, 13,000+
// all-time bookings, $5.39M confirmed Room Revenue in 2026 alone) that was wrongly dropped from
// every Trade Partners metric (Agent Room Revenue, Active Trade Partners count, Top Trade
// Partners table, Portfolio ADR). Removed from this list. WB133564 (Tanzania) and WB144361
// ("Cheli & Peacock Management Ltd") were never on this list and are unaffected.
// This array must stay non-empty — mysql2 renders `NOT IN (?)` as `NOT IN ()` for an empty
// array, which is invalid SQL. '' is a safe placeholder: the only two agent_id rows with an
// empty agent_name ('' and '0') are already-excluded junk/placeholder records (see
// EXCLUDED_AGENT_IDS above), so it never touches a real agent.
export const EXCLUDED_AGENT_NAMES_EXACT = [
  '',
] as const;

// Wildcard exclusion pattern
export const EXCLUDED_AGENT_NAME_PATTERN = '%direct%'; // case-insensitive

// CARVE-OUTS from EXCLUDED_AGENT_NAME_PATTERN — real trade partners whose name happens to
// contain "direct" by coincidence, confirmed via the segment mapping CSV, that must NOT be
// swept up by the wildcard. Found during the 9 July 2026 exclusion-list audit (the same audit
// that found RS23 — see EXCLUDED_AGENT_NAMES_EXACT above).
// WB102776 "Africa Direct Tours & Travel* / East of Eden" — segment CSV (`Market Segment and
// Source Codes - EC AGENT SOURCE CODE.csv`) classifies this as B2B INTERNATIONAL AGENTS, a real
// trade partner, not a direct/B2C channel. Currently dormant (3 all-time bookings, all in 2025;
// $0 in 2026) — carved out so it counts normally the moment it books again, rather than silently
// disappearing from Trade Partners metrics the way RS23 did.
export const AGENT_NAME_PATTERN_CARVEOUT_IDS = ['WB102776'] as const;

// Pre-built literal SQL IN-list for the carve-out above. Internal constant, never user input —
// safe to inline directly (same reasoning as roomRevenue.ts's sqlList() helper). Usage:
// `(LOWER(a.agent_name) NOT LIKE ? OR a.agent_id IN (${AGENT_NAME_PATTERN_CARVEOUT_SQL}))`.
export const AGENT_NAME_PATTERN_CARVEOUT_SQL = AGENT_NAME_PATTERN_CARVEOUT_IDS.map((id) => `'${id}'`).join(',');

// CONFIRMED legitimate, do NOT exclude despite being Elewana-owned:
// "Elewana Travel Limited" and "Elewana Travel Ltd Kenya" — Elewana's own
// in-house booking arm, ~$18M combined revenue, 80%+ of bookings have real
// non-NULL amounts. Faith's own segment file classifies these under
// DMC (International Presence), same as third-party agents — follow her
// classification rather than creating a separate "internal" category
// (pending her confirmation on the reasoning).
export const ELEWANA_INTERNAL_AGENT_IDS = ['WB686', 'WB103417'] as const;

// ─────────────────────────────────────────────────────────────────
// RESERVATION EXCLUSIONS — system-generated placeholder records
// ─────────────────────────────────────────────────────────────────
// Confirmed via data pattern inspection (2 July 2026): all 33 current
// reservation_numbers matching 'PA%' have $0.00 total_amount, are 100%
// tied to Arusha Coffee Lodge (WB2909), and are 32/33 on rate_type
// WB117 ("Extra's Only"). They are created in same-day batches with
// sequential ~30-day stay windows stacked back-to-back (e.g. PA51–PA62
// all date_created on the same day, one row per month) — a
// system-generated monthly placeholder/block pattern, not real guest
// bookings. Exclude from all reservation-level queries (revenue,
// counts, and displays) alongside the agent and rate-type exclusions.
export const EXCLUDED_RESERVATION_PREFIX = 'PA%'; // reservation_number NOT LIKE

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
// This data is externally sourced and must be maintained manually — it
// does not come from any database query.
//
// REPLACED 13 July 2026: the old low-confidence PROPERTY_ROOM_COUNTS (plain
// key-count map, one entry — Lodo Springs — explicitly flagged low-confidence
// with conflicting 6/7/8 sources) is replaced with Dennis's confirmed data
// from the "Property Abbreviations & Locations" file, Rooms Available sheet.
// `roomnightsAvailable` is Dennis's own pre-computed annual capacity figure
// (keys × days actually open, NOT a naive keys × 365) — prefer it over
// recomputing from `keys` wherever a capacity denominator is needed.
//
// CRITICAL CAVEAT — typical-year vs. 2026 actual, do not resolve silently:
// the source file's own header states these figures represent "a typical
// year of operation," but separately notes that AS OF 2026, LSC, LEPC, and
// NXR are closed: LSC is closed for refurbishment (reopens 1 June 2026),
// LEPC and NXR are under construction (open 1 June 2026 and 1 May 2027
// respectively). This creates a real inconsistency in the source data
// itself: LEPC's own "Days Open" already shows 215 (not 365), suggesting
// its roomnightsAvailable figure may already partially reflect 2026 reality
// — but LSC shows 365 days / NIL closed despite the same file's text saying
// it's closed until June 2026, meaning LSC's 4,745 figure is almost
// certainly still the untouched typical-year number. Do NOT use LSC's
// figure as-is for a 2026 capacity calc; treat LEPC's with lighter caution
// (it may already be closer to correct, but hasn't been independently
// confirmed). NXR is excluded entirely from any 2026 capacity calc — see
// NGORONGORO_EXPLORER_OPENING below, unchanged from before this update.
//
// Also unexplained: KLZ, SXR, and KHL each have a second, much larger
// (~4x) figure in an extra column of the source file (KLZ: 42,240 vs
// 5,010; SXR: 69,250 vs 27,010; KHL: 37,116 vs 1,825). NOT used anywhere
// here — possibly bed-nights rather than room-nights, but unconfirmed.
// Do not use these until confirmed with Dennis.
export interface PropertyCapacity {
  propertyId: string | null // ResRequest properties.property_id; null if the property has no row yet (pre-opening)
  keys: number
  roomnightsAvailable: number // Dennis's confirmed annual capacity — see caveats above before using for 2026
}

// Shared between dashboard/route.ts's RevPAR-by-property table and property/[propertyId]/route.ts's
// Property Profile Panel (2026-07-15) — same two capacity caveats, single source of text so the
// two surfaces can't drift apart.
export const PROPERTY_REVPAR_CAVEATS: Record<string, string> = {
  WB146935: 'Pre-opening — not operational until 1 May 2027. $0 is correct, not a data gap.',
  WB37957: 'Closed for refurbishment part of 2026 (reopens 1 June) — Available Room Nights is the untouched typical-year figure, not adjusted for the closure. Treat as directional only.',
}

export const PROPERTY_ROOM_COUNTS: Record<string, PropertyCapacity> = {
  // ── Tanzania ──
  'Arusha Coffee Lodge': { propertyId: 'WB2909', keys: 30, roomnightsAvailable: 10950 }, // ACL, 365 days open
  'Tarangire Treetops': { propertyId: 'WB2910', keys: 20, roomnightsAvailable: 7300 }, // TTT, 365 days open
  'The Manor at Ngorongoro': { propertyId: 'WB2911', keys: 20, roomnightsAvailable: 7300 }, // TMN, 365 days open
  'Serengeti Migration Camp': { propertyId: 'WB2912', keys: 20, roomnightsAvailable: 7300 }, // SMC, 365 days open
  'Serengeti Pioneer Camp': { propertyId: 'WB2914', keys: 12, roomnightsAvailable: 4380 }, // SPC, 365 days open
  'Kilindi': { propertyId: 'RS8', keys: 15, roomnightsAvailable: 5010 }, // KLZ, 334 days open (closed 1–31 May); ignore the file's unexplained 42,240 figure — see caveat above
  'Serengeti Explorer': { propertyId: 'WB129620', keys: 74, roomnightsAvailable: 27010 }, // SXR, 365 days open; ignore the file's unexplained 69,250 figure — see caveat above
  'Ngorongoro Explorer': { propertyId: 'WB146935', keys: 84, roomnightsAvailable: 30660 }, // NXR, typical-year figure — NOT operational until 1 May 2027, exclude from any 2026 capacity calc

  // ── Kenya ──
  'Tortilis Camp': { propertyId: 'WB37856', keys: 20, roomnightsAvailable: 7300 }, // TCA
  'Elsas Kopje': { propertyId: 'WB37953', keys: 12, roomnightsAvailable: 4380 }, // EKM
  'Loisaba Tented Camp': { propertyId: 'WB35421', keys: 12, roomnightsAvailable: 4380 }, // LTC
  'Loisaba Star Beds': { propertyId: 'WB35420', keys: 4, roomnightsAvailable: 1216 }, // LSB, 304 days open (closed 1 Apr–31 May)
  'Lodo Springs': { propertyId: 'WB91759', keys: 8, roomnightsAvailable: 2920 }, // LLS — supersedes the old low-confidence 6/7/8 conflicting figure
  'Sand River': { propertyId: 'WB640', keys: 16, roomnightsAvailable: 5840 }, // SRM
  'Elephant Pepper Camp': { propertyId: 'WB37960', keys: 10, roomnightsAvailable: 3650 }, // EPC
  // LEPC: mid-construction, reopens 1 June 2026 — no properties.property_id row exists yet (confirmed
  // live). 215 days open (not 365) suggests this figure may already partially reflect 2026 — lighter
  // caveat than LSC below, but not independently confirmed. Do not treat as a fully-typical-year figure.
  'Little Elephant Pepper Camp': { propertyId: null, keys: 4, roomnightsAvailable: 860 }, // LEPC
  // LSC: mid-refurbishment, reopens 1 June 2026. This figure is the untouched TYPICAL-YEAR number
  // (365 days / NIL closed in the source file) despite LSC being closed for part of 2026 — do NOT use
  // as-is for a 2026 capacity calc. Actual 2026 capacity is lower; exact adjusted figure not yet confirmed.
  'Lewa Safari Camp': { propertyId: 'WB37957', keys: 13, roomnightsAvailable: 4745 }, // LSC
  'Kifaru House': { propertyId: 'WB73234', keys: 5, roomnightsAvailable: 1825 }, // KHL — ignore the file's unexplained 37,116 figure — see caveat above
}

export const NGORONGORO_EXPLORER_OPENING = '2027-05-01'
export const LEWA_SAFARI_CAMP_REOPENING = '2026-06-01' // LSC, post-refurbishment
export const LITTLE_ELEPHANT_PEPPER_CAMP_OPENING = '2026-06-01' // LEPC, post-construction

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

// ─────────────────────────────────────────────────────────────────
// ROOM REVENUE / EXTRAS COMPONENT CLASSIFICATION
// ─────────────────────────────────────────────────────────────────
// Confirmed via Faith's room_revenue_components.csv (8 July 2026) + live
// verification: rate_components.component_description matches the CSV's
// labels by exact string (e.g. "AC - Bar (KE)" is a real, live value — not
// a pattern to fuzzy-match). Classification is per-property, joined via
// itineraries.property. Room Revenue + Extras = Total Revenue, as two
// separately-tracked figures (matches Qlik's Trade Partner Scorecard
// convention) — Extras is not "dropped," everything not Room Revenue and
// not an excluded pass-through fee is Extras.
export const KENYA_PROPERTY_IDS = [
  'WB37856', 'WB37953', 'WB35421', 'WB35420', 'WB91759', 'WB640', 'WB37960', 'WB37957', 'WB73234',
] as const; // Tortilis Camp, Elsa's Kopje, Loisaba Tented Camp, Loisaba Star Beds, Lodo Springs, Sand River, Elephant Pepper Camp, Lewa Safari Camp, Kifaru House

export const TANZANIA_MAINLAND_PROPERTY_IDS = [
  'WB2909', 'WB2912', 'WB2910', 'WB2911', 'WB2914', 'RS8',
] as const; // Arusha Coffee Lodge, Serengeti Migration Camp, Tarangire Treetops, The Manor at Ngorongoro, Serengeti Pioneer Camp, Kilindi

export const SERENGETI_EXPLORER_STYLE_PROPERTY_IDS = ['WB129620', 'WB146935'] as const; // Serengeti Explorer, Ngorongoro Explorer

export const KENYA_ROOM_REVENUE_COMPONENTS = [
  'AC - Accommodation', 'AC - Airstrip Transfer (KE)', 'AC - Bar (KE)', 'AC - Food (KE)', 'AC - Laundry (KE)', 'AC - Game Drive (KE)',
] as const;

export const TANZANIA_MAINLAND_ROOM_REVENUE_COMPONENTS = [
  'AC - Accommodation', 'TDL (TZ)', 'AC - Meal & Amenities', 'AC - Game Drive (TZ)',
] as const;

export const SERENGETI_EXPLORER_STYLE_ROOM_REVENUE_COMPONENTS = [
  'AC - Accommodation', 'AC - Game Drive (TZ)', 'AC - Breakfast (TZ SE)', 'AC - Dinner (TZ SE)',
  'AC - Drinks (TZ SE)', 'AC - Laundry (TZ SE)', 'AC - Lunch (TZ SE)', 'AC - Tea (TZ SE)',
] as const;

// Fallback for any property_id not covered by the three groups above (e.g.
// Afrochic, Dummy Prop 1/2/3, Internal Accounts, or any property added later
// before this list is updated). Approved 8 July 2026: Room Revenue =
// Accommodation only for these; everything else on that property is Extras.
export const DEFAULT_ROOM_REVENUE_COMPONENTS = ['AC - Accommodation'] as const;

// Pass-through charges — confirmed 8 July 2026 to be excluded entirely (not
// Room Revenue, not Extras, not counted anywhere). $35.6M live total, all of
// it park/conservation/concession fees or tax, none of it discretionary
// revenue. "Waitlist" is a $0 single-reservation flag (component_id WB2), not
// a fee, but is excluded here too since it carries no revenue either way.
export const EXCLUDED_FEE_COMPONENTS = [
  'Conservation Fee (KE)', 'Conservation fee (KE) 2025', 'Conservation fee (KE) 2026', 'Conservation Fee (KE) 2024',
  'Park Fees High', 'Park Fees Low', 'Park Fees (KE)', 'Park Fees (KE) High', 'Park Fees (KE) Low',
  'Park Fees - Africa Resident High', 'Park Fees - Africa Resident Low', 'Park Fee EA Resident',
  'Park Fees EAC Citizen/Resident - Low', 'Park fees KE Citizens -Low(Jan-Jun)', 'Park fees KE Citizens -High(Jul-Dec)',
  'Infrastructure Tax', 'Concession Fee (KE)', 'Concession Fee (TZ)', 'Waitlist',
] as const;

// Day Use — confirmed live 8 July 2026: there is no single shared "Day Use"
// code, each property uses its own accommodation_type value (WB17 is
// ACL-exclusive, WB22 is Kilindi-exclusive — same code space coincidentally
// overlaps rate_components.component_id values elsewhere in the schema, but
// these are itineraries.accommodation_type values, a different field).
// These itinerary legs carry $0 in both total_gross_amount and
// rate_components (confirmed live) — their real charge lives in the extras
// table instead (e.g. "Garden Lunch"), matched by reservation_number +
// extras.internal_property. $4.37M live total across both properties.
export const DAY_USE_ACCOMMODATION_TYPE_BY_PROPERTY: Record<string, string> = {
  WB2909: 'WB17', // Arusha Coffee Lodge
  RS8: 'WB22', // Kilindi
};

// ─────────────────────────────────────────────────────────────────
// EXTRAS TABLE REVENUE — genuine ancillary charges beyond Day Use
// ─────────────────────────────────────────────────────────────────
// Confirmed 13 July 2026: the `extras` table holds $47.7M (full-year 2026,
// confirmed) across every property and booking type, but until now only the
// Day Use slice (~$968K, ACL/Kilindi, matched by property+accommodation_type
// via DAY_USE_ACCOMMODATION_TYPE_BY_PROPERTY) was ever pulled into Extras
// Revenue. Confirmed via per-booking trace AND a portfolio-wide aggregate
// check (SUM(itineraries.total_gross_amount) == SUM(rate_components.amount_gross)
// to the cent, $150,941,287.27 both sides, full-year 2026 non-Day-Use legs)
// that `extras` money is NOT embedded in total_gross_amount anywhere — it is
// structurally separate, additively-invoiced revenue. No shared key exists
// between `rate_components` and `extras` (only generic id/created_at/updated_at).
//
// `extras.category` groups the table into ~20 codes. These are the ones
// confirmed CLEAN — genuine guest-facing ancillary revenue, safe to add to
// Extras Revenue:
export const EXTRAS_TABLE_REVENUE_CATEGORY_IDS = [
  '11ed65a5003b7e5d8fc6ac1f6b1b6a6e', // Activities (game drives, cultural visits, balloon safaris, vehicle hire)
  '11ed65a4eb7a45c38fc6ac1f6b1b6a6e', // F&B / dining (dinner, lunch, breakfast, cakes)
  '11ed65a4e40b22658fc6ac1f6b1b6a6e', // Beverage
  '11e96b0a965c5b2eaabeac1f6b672056', // Transfers / misc guest services
  'WB4', // Spa treatments
  '11e96b1462cf9b59aabeac1f6b672056', // Spa treatments (second code)
  'RS5', // Spa / massage treatments (third code)
  '11ed65a507ac55518fc6ac1f6b1b6a6e', // Road transfers
  '11e95d0fe81585baaabeac1f6b672056', // F&B, secondary code (breakfast/lunch/dinner vouchers)
  '11ecac0e8f18cede8f6bac1f6b1b6a6e', // Small AC-prefixed tail — low dollar, matches rate_components-style component names but recorded in extras
  '11ed65a4dd0c13528fc6ac1f6b1b6a6e', // Airport transfers
  '11e9e02c6d3cfd509017ac1f6b672056', // Accommodation Supplement — trivial dollar amount
  '11eb74db737b1baebd4e0cc47a7ebf7a', // Beverage / dinner, secondary code
  '11e95d185b2cf44aaabeac1f6b672056', // Exclusive Safari Vehicle, secondary code — trivial dollar amount
] as const;

// NOT included yet — pending decisions, do not add without explicit confirmation:
// - Category '11e96a8796aa9cddaabeac1f6b672056' ("Cost of flight", Heli Safaris, charter) — $12.5M,
//   reads as a cost pass-through, not margin revenue. Needs Faith/Finance to confirm whether
//   Elewana keeps any markup before any of it can be counted as revenue.
// - Category '11e96b1eb2d024f3aabeac1f6b672056' (mixed ops/logistics — Curio Shop, Wedding Fees,
//   Camera Rental mixed with Drivers' meals/accommodation and a single $850K "Payroll Chargeout"
//   row) — $1.54M, needs a line-by-line split before any of it can be counted.
// - Category 'RS9' (Cancellation Charges) — $1.52M, real money kept by the business but
//   conceptually different from F&B/activities Extras; needs a decision on whether Qlik's
//   "Extra Revenue" convention includes cancellation revenue.
// - Category 'WB1' (Park Fees / Conservancy Fees / Concession Fees / Camping Fees / Crater Fees /
//   Gratuities) — $25.83M, pass-through, same treatment as EXCLUDED_FEE_COMPONENTS. Confirmed
//   live (13 July 2026) this does NOT overlap with EXCLUDED_FEE_COMPONENTS' rate_components-based
//   $2.79M pass-through fee total — they are two separate, non-identical, additive pools of real
//   pass-through money (e.g. one reservation can carry both a $720 rate_components "Conservation
//   Fee (KE)" AND a separate $77.52 extras "Conservancy Fees KSH" — different charges, not a
//   duplicate). Both are correctly excluded from Extras Revenue; if a complete pass-through-fees
//   audit total is ever needed, it must sum BOTH pools, not just one.
// - Categories 'WB7' and 'WB9' (arrival-method / arrival-airline flags) — $0 always, metadata not
//   revenue, never relevant here.
// - Category 'WB8' (Credit Note reversals) — always negative, an adjustment against other
//   categories, not a distinct revenue pool.

// Day Use legs (see DAY_USE_ACCOMMODATION_TYPE_BY_PROPERTY) keep their pre-existing behavior of
// counting EVERY extras category at those specific legs, unchanged — a Day Use guest's fee-tagged
// charge (e.g. a Park Fee) was always included before this addition and still is. The categories
// above are ADDITIONAL revenue for every OTHER booking (any property, not Day Use), explicitly
// excluding Day Use legs in the query (`NOT (property+accommodation_type match)`) so the two
// pulls can never double-count the same extras row.

// ─────────────────────────────────────────────────────────────────
// NON-REVENUE BREAKDOWN GROUPINGS (for /api/non-revenue)
// ─────────────────────────────────────────────────────────────────
// Confirmed and computed, but deliberately kept OUT of Room Revenue, Extras,
// and any Total shown on the main leadership-facing views (approved 8 July
// 2026). These groupings partition EXCLUDED_FEE_COMPONENTS and
// NON_REVENUE_RATE_TYPE_IDS exactly — every id appears in exactly one group.

// Pass-through fees, grouped by fee type. Confirmed live 8 July 2026: ALL
// "Park Fees*" and "Conservation Fee*" variants (including the unsuffixed
// "Park Fees High"/"Park Fees Low") are 100% Kenya-property-linked in live
// data — zero Tanzania rows for either. There is no live "Park Fees TZ" or
// "Conservation Fee TZ" component despite the generic-sounding names;
// Infrastructure Tax and Concession Fee (TZ) are the Tanzania-side
// pass-through equivalents instead.
export const CONSERVATION_FEE_COMPONENTS = [
  'Conservation Fee (KE)', 'Conservation fee (KE) 2025', 'Conservation fee (KE) 2026', 'Conservation Fee (KE) 2024',
] as const; // all Kenya-only, live-verified

export const PARK_FEES_COMPONENTS = [
  'Park Fees High', 'Park Fees Low', 'Park Fees (KE)', 'Park Fees (KE) High', 'Park Fees (KE) Low',
  'Park Fees - Africa Resident High', 'Park Fees - Africa Resident Low', 'Park Fee EA Resident',
  'Park Fees EAC Citizen/Resident - Low', 'Park fees KE Citizens -Low(Jan-Jun)', 'Park fees KE Citizens -High(Jul-Dec)',
] as const; // all Kenya-only, live-verified

export const INFRASTRUCTURE_TAX_COMPONENTS = ['Infrastructure Tax'] as const; // Tanzania-only, live-verified
export const CONCESSION_FEE_COMPONENTS = ['Concession Fee (KE)', 'Concession Fee (TZ)'] as const;
export const WAITLIST_COMPONENTS = ['Waitlist'] as const; // $0 always — see project_room_revenue_extras_rebuild memory

// FAM/Complimentary/Staff business, grouped by category. Partitions
// NON_REVENUE_RATE_TYPE_IDS exactly (7 + 13 + 16 + 14 = 50) — confirmed by
// count match against constants.ts's own documented total.
export const COMPLIMENTARY_RATE_TYPE_IDS = [
  'WB115', 'WB116', 'WB219', 'RS2',
  '11ec064461b1c4f4a4ac0cc47a7ebf7a', '11e8c80786243bfea320ac1f6b672056', '11ec3ae8b354b199ac240cc47a7ebf7a',
] as const;

export const FAM_STAY_RATE_TYPE_IDS = [
  'WB798', 'WB799', 'WB800', 'WB803', 'WB804', 'WB806',
  'a18c2aa6-f84b-48ae-bbde-a85f1ebe56a3', 'a18c2add-ee73-44ee-bf43-c3cc0d91229a',
  '11ec06469ffb7d89a4ac0cc47a7ebf7a', '11e8cab64a48886ca320ac1f6b672056',
  '11eea4ce56c7f6c781f8ac1f6be20cd0', '11eea4ce59de7f2781f8ac1f6be20cd0', '11eea4ce5d14238681f8ac1f6be20cd0',
] as const;

export const STAFF_RATE_RATE_TYPE_IDS = [
  'WB811', 'WB812', 'WB813', 'WB814', 'WB816', 'WB817', 'WB818', 'WB819', 'WB820', 'WB821', 'WB823',
  '11eea4ce6b7e4a4481f8ac1f6be20cd0', '11eea4ce6ebb3be381f8ac1f6be20cd0', '11eea4ce7127367981f8ac1f6be20cd0',
  '11ec064e4c0f12e4a4ac0cc47a7ebf7a', '11ee9593a7628e7781f8ac1f6be20cd0',
] as const;

export const TNC_STAFF_RATE_TYPE_IDS = [
  'a0e3836a-6a1e-41ed-b28b-fc0da3b5163d', '11efdf9c0b3c3b69a35a3cecef956aee', 'a0e38397-6552-40e4-b8b9-dedbdb4ca4dd',
  '11eff8cdd5b859dba35a3cecef956aee', 'a0e3853d-13fd-4a22-aa45-790aa76ada93', '11ea5fbbebf2d3278b530cc47a7eb372',
  '11ea5fbbf74917538b530cc47a7eb372', 'a0e2033c-b873-4fe3-a742-1dde243723be', '11eff8cf185a85f5a35a3cecef956aee',
  'a0e20351-5c9b-4d65-b909-11c4101d4b68', '11eff8cecbef68aca35a3cecef956aee', 'a0e20369-9c07-4cc7-a0a5-341f22f1cb79',
  '11ea5fbc033e09558b530cc47a7eb372', '11ea5fbc0c17cdba8b530cc47a7eb372',
] as const;
