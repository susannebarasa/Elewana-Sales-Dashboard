# Database Schema Documentation

## Overview

This document provides comprehensive documentation for the ResRequest Sync Tool database schema. The database is designed to store synchronized data from the ResRequest Bridge API, including agents, reservations, itineraries, rate information, extras, properties, and sync operation logs.

**Database Technology**: MySQL (via SQLAlchemy ORM)  
**ORM Framework**: SQLAlchemy  
**Character Encoding**: UTF-8 (utf8mb4)

---

## Entity Relationship Diagram

```
┌─────────────┐
│   Agents   │
│────────────│
│ agent_id*  │
│ agent_name │
│ ...        │
└─────┬──────┘
      │
      │ 1:N
      │
┌─────▼──────────────┐
│  Reservations      │
│────────────────────│
│ reservation_number*│
│ agent_id (FK)      │
│ reservation_name   │
│ total_amount       │
│ status             │
│ ...                │
└─────┬──────────────┘
      │
      ├─── 1:N ───┐
      │           │
      │           │
┌─────▼──────┐  ┌─▼──────┐
│ Itineraries│  │ Extras │
│────────────│  │────────│
│ itinerary_│  │ id*     │
│   id*      │  │ reserva│
│ reserva-   │  │   tion │
│   tion_    │  │   _num │
│   number   │  │   (FK) │
│   (FK)     │  │ ...    │
│ date_in    │  └────────┘
│ date_out   │
│ property   │
│ ...        │
└─────┬──────┘
      │
      ├─── 1:N ───────────┐
      │                    │
┌─────▼──────────┐  ┌─────▼─────────────┐
│  Rate Groups   │  │ Rate Components   │
│────────────────│  │───────────────────│
│ id*            │  │ id*               │
│ itinerary_id   │  │ itinerary_id (FK) │
│   (FK)         │  │ component_id      │
│ group_id       │  │ amount_gross     │
│ qty            │  │ amount_nett       │
│ ...            │  │ ...               │
└────────────────┘  └───────────────────┘

┌─────────────┐  ┌──────────────┐
│ Rate Types  │  │  Properties  │
│─────────────│  │──────────────│
│ rate_type_  │  │ property_id* │
│   id*       │  │ name         │
│ abbrevia-   │  │ gps_latitude │
│   tion      │  │ ...          │
│ currency    │  └──────────────┘
│ ...         │
└─────────────┘

┌──────────────┐  ┌─────────────────┐
│  Sync Logs   │  │ Sync Checkpoints│
│──────────────│  │─────────────────│
│ id*          │  │ id*             │
│ sync_type    │  │ sync_log_id (FK)│
│ sync_status  │  │ checkpoint_type │
│ start_time   │  │ checkpoint_key  │
│ ...          │  │ ...             │
└──────┬───────┘  └─────────────────┘
       │
       │ 1:N
       │
```

---

## Tables

### 1. `agents`

Stores agent/contact information from the `as_agents_contact_list` API endpoint.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `agent_id` | VARCHAR(50) | PRIMARY KEY | Unique agent identifier |
| `agent_name` | VARCHAR(255) | NOT NULL | Full name of the agent |
| `agent_physical_country` | VARCHAR(100) | NULL | Physical location country |
| `agent_postal_country` | VARCHAR(100) | NULL | Postal address country (can be null) |
| `inactive` | BOOLEAN | DEFAULT FALSE | Agent status (false = active, true = inactive) |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_agent_name` on `agent_name`
- `idx_agent_inactive` on `inactive`
- `idx_agent_physical_country` on `agent_physical_country`

**Relationships:**
- One-to-Many with `reservations` (via `agent_id`)

**Notes:**
- The `inactive` field is converted from API string values ("0"/"1") to boolean
- `agent_postal_country` can be NULL if not provided
- Used as a reference table for reservation agent assignments

---

### 2. `reservations`

Stores reservation data from the `as_reservations_list` API endpoint. This is the central entity in the reservation system.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `reservation_number` | VARCHAR(50) | PRIMARY KEY | Unique reservation identifier |
| `item_number` | INTEGER | NULL | Sequential item number from API |
| `reservation_name` | VARCHAR(255) | NULL | Guest name and party size |
| `total_amount` | DECIMAL(10,2) | NULL | Total reservation amount |
| `agent_id` | VARCHAR(50) | FOREIGN KEY → `agents.agent_id` | Reference to agent |
| `consultant` | VARCHAR(100) | NULL | Consultant identifier |
| `originator` | VARCHAR(100) | NULL | Originator identifier |
| `status` | VARCHAR(10) | NULL | Reservation status code (e.g., "20", "30", "90") |
| `rate_type` | VARCHAR(50) | NULL | Rate type identifier |
| `source` | VARCHAR(50) | NULL | Source identifier |
| `nationality_country` | VARCHAR(100) | NULL | Guest nationality country |
| `rv_commission_perc` | DECIMAL(5,2) | NULL | Commission percentage |
| `confirmation_date` | DATE | NULL | Confirmation date (can be "0000-00-00" from API) |
| `prov_date` | DATE | NULL | Provision date (can be "0000-00-00" from API) |
| `provision_expiry_date` | DATE | NULL | Provision expiry date (can be "0000-00-00" from API) |
| `date_created` | DATE | NULL | Reservation creation date |
| `last_change_date` | DATE | NULL | Last modification date |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_reservation_agent_id` on `agent_id`
- `idx_reservation_status` on `status`
- `idx_reservation_date_created` on `date_created`
- `idx_reservation_last_change_date` on `last_change_date`
- `idx_reservation_confirmation_date` on `confirmation_date`
- `idx_reservation_consultant` on `consultant`
- `idx_reservation_created_at` on `created_at`
- `idx_reservation_agent_status` on `agent_id`, `status` (composite)
- `idx_reservation_date_range` on `date_created`, `last_change_date` (composite)

**Relationships:**
- Many-to-One with `agents` (via `agent_id`)
- One-to-Many with `itineraries` (cascade delete)
- One-to-Many with `extras` (cascade delete)

**Notes:**
- Primary entity for reservation management
- Date fields from API may contain "0000-00-00" which are stored as NULL
- Status codes are string values (e.g., "20" = Provisional, "30" = Confirmed)
- Supports efficient querying by agent, status, and date ranges

---

### 3. `itineraries`

Stores accommodation details for each reservation. Each reservation can have multiple itineraries (accommodation stays).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `itinerary_id` | VARCHAR(50) | PRIMARY KEY | Unique itinerary identifier |
| `reservation_number` | VARCHAR(50) | FOREIGN KEY → `reservations.reservation_number` | Reference to reservation |
| `date_in` | DATE | NULL | Check-in date |
| `date_out` | DATE | NULL | Check-out date |
| `property` | VARCHAR(100) | NULL | Property identifier |
| `total_gross_amount` | DECIMAL(10,2) | NULL | Total gross amount for itinerary |
| `accommodation_type` | VARCHAR(100) | NULL | Accommodation type identifier |
| `rate_type` | VARCHAR(50) | NULL | Rate type identifier |
| `commission` | DECIMAL(10,2) | NULL | Commission amount |
| `currency_name` | VARCHAR(50) | NULL | Currency name (e.g., "US Dollars") |
| `currency_symbol` | VARCHAR(10) | NULL | Currency symbol (e.g., "USD") |
| `invoice_id` | VARCHAR(50) | NULL | Invoice identifier |
| `invoice_date` | DATE | NULL | Invoice date |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_itinerary_reservation_number` on `reservation_number`
- `idx_itinerary_dates` on `date_in`, `date_out` (composite)
- `idx_itinerary_property` on `property`
- `idx_itinerary_rate_type` on `rate_type`
- `idx_itinerary_date_in` on `date_in`
- `idx_itinerary_date_out` on `date_out`

**Relationships:**
- Many-to-One with `reservations` (via `reservation_number`)
- One-to-Many with `rate_groups` (cascade delete)
- One-to-Many with `rate_components` (cascade delete)

**Notes:**
- Represents individual accommodation stays within a reservation
- A reservation can have multiple itineraries for multi-property stays
- Date range queries are optimized with composite index on `date_in` and `date_out`

---

### 4. `rate_groups`

Stores rate group information for itineraries. Represents pricing groups with quantities.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTO_INCREMENT | Auto-incrementing primary key |
| `itinerary_id` | VARCHAR(50) | FOREIGN KEY → `itineraries.itinerary_id` | Reference to itinerary |
| `group_id` | VARCHAR(50) | NULL | Rate group identifier from API |
| `qty` | INTEGER | NULL | Quantity for this rate group |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_rate_group_itinerary_id` on `itinerary_id`
- `idx_rate_group_group_id` on `group_id`

**Relationships:**
- Many-to-One with `itineraries` (via `itinerary_id`)

**Notes:**
- The `group_id` corresponds to the "id" field from the API
- Used for grouping pricing information by quantity

---

### 5. `rate_components`

Stores detailed pricing breakdown for itineraries, including gross, net, payable amounts, and tax information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTO_INCREMENT | Auto-incrementing primary key |
| `itinerary_id` | VARCHAR(50) | FOREIGN KEY → `itineraries.itinerary_id` | Reference to itinerary |
| `amount_gross` | DECIMAL(10,2) | NULL | Gross amount |
| `amount_nett` | DECIMAL(10,2) | NULL | Net amount |
| `amount_payable` | DECIMAL(10,2) | NULL | Payable amount |
| `amount_tax` | DECIMAL(10,2) | NULL | Tax amount |
| `tax_type` | VARCHAR(50) | NULL | Tax type identifier |
| `tax_id` | VARCHAR(50) | NULL | Tax identifier |
| `tax_description` | VARCHAR(255) | NULL | Tax description |
| `component_id` | VARCHAR(50) | NULL | Component identifier |
| `component_description` | VARCHAR(255) | NULL | Component description |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_rate_component_itinerary_id` on `itinerary_id`
- `idx_rate_component_component_id` on `component_id`
- `idx_rate_component_tax_type` on `tax_type`

**Relationships:**
- Many-to-One with `itineraries` (via `itinerary_id`)

**Notes:**
- Provides detailed financial breakdown for each itinerary
- Supports tax analysis and component-level reporting
- All monetary amounts use DECIMAL(10,2) for precision

---

### 6. `extras`

Stores additional services and charges associated with reservations (e.g., transfers, activities, meals).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTO_INCREMENT | Auto-incrementing primary key |
| `reservation_number` | VARCHAR(50) | FOREIGN KEY → `reservations.reservation_number` | Reference to reservation |
| `service_date` | DATE | NULL | Date of service |
| `internal_property` | VARCHAR(100) | NULL | Property identifier |
| `type` | VARCHAR(50) | NULL | Extra type code |
| `category` | VARCHAR(50) | NULL | Category identifier |
| `extra_description` | TEXT | NULL | Description of the extra service |
| `quantity` | DECIMAL(10,3) | NULL | Quantity of the service |
| `unit_price` | DECIMAL(10,2) | NULL | Price per unit |
| `tax_rate` | VARCHAR(50) | NULL | Tax rate description |
| `amount` | DECIMAL(10,2) | NULL | Total amount for the extra |
| `currency` | VARCHAR(50) | NULL | Currency name |
| `exchange_rate` | DECIMAL(10,6) | NULL | Exchange rate |
| `discount` | DECIMAL(10,2) | NULL | Discount amount |
| `invoice_id` | VARCHAR(50) | NULL | Invoice identifier |
| `invoice_date` | DATE | NULL | Invoice date |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_extra_reservation_number` on `reservation_number`
- `idx_extra_service_date` on `service_date`
- `idx_extra_type` on `type`
- `idx_extra_category` on `category`

**Relationships:**
- Many-to-One with `reservations` (via `reservation_number`)

**Notes:**
- Stores additional charges beyond accommodation
- Quantity uses DECIMAL(10,3) to support fractional quantities
- Exchange rate uses DECIMAL(10,6) for precision
- Supports filtering by service date, type, and category

---

### 7. `rate_types`

Stores rate type definitions from the `rt_get_rate` API endpoint.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `rate_type_id` | VARCHAR(50) | PRIMARY KEY | Unique rate type identifier |
| `abbreviation` | VARCHAR(100) | NULL | Rate type abbreviation |
| `colour` | VARCHAR(20) | NULL | Display color code |
| `currency` | VARCHAR(10) | NULL | Currency code |
| `default` | BOOLEAN | DEFAULT FALSE | Whether this is the default rate type |
| `note` | TEXT | NULL | Additional notes |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_rate_type_abbreviation` on `abbreviation`
- `idx_rate_type_currency` on `currency`
- `idx_rate_type_default` on `default`

**Relationships:**
- None (reference table)

**Notes:**
- Reference/lookup table for rate type information
- Used to enrich reservation and itinerary data with rate type details

---

### 8. `properties`

Stores property information from the `ac_get_property` API endpoint.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `property_id` | VARCHAR(50) | PRIMARY KEY | Unique property identifier |
| `name` | VARCHAR(255) | NULL | Property name |
| `gps_latitude` | VARCHAR(50) | NULL | GPS latitude coordinate |
| `gps_longitude` | VARCHAR(50) | NULL | GPS longitude coordinate |
| `property_url` | VARCHAR(255) | NULL | Property website URL |
| `calendar_note` | TEXT | NULL | Calendar-related notes |
| `document_note` | TEXT | NULL | Document-related notes |
| `images_json` | TEXT | NULL | JSON string containing array of image URLs |
| `social_links_json` | TEXT | NULL | JSON string containing array of social media links |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |
| `updated_at` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Record last update timestamp |

**Indexes:**
- `idx_property_name` on `name`

**Relationships:**
- None (reference table, referenced by `itineraries.property` field)

**Notes:**
- Reference table for property information
- JSON fields store structured data as text (parse when reading)
- GPS coordinates stored as strings to preserve precision
- Used to enrich itinerary data with property details

---

### 9. `sync_logs`

Tracks sync operations for monitoring, debugging, and audit purposes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTO_INCREMENT | Auto-incrementing primary key |
| `sync_type` | VARCHAR(50) | NULL | Type of sync operation (e.g., 'agents', 'reservations') |
| `sync_status` | VARCHAR(20) | NULL | Status: 'started', 'completed', 'failed' |
| `start_time` | DATETIME | NULL | Sync operation start timestamp |
| `end_time` | DATETIME | NULL | Sync operation end timestamp |
| `records_processed` | INTEGER | DEFAULT 0 | Total records processed |
| `records_updated` | INTEGER | DEFAULT 0 | Number of records updated |
| `records_inserted` | INTEGER | DEFAULT 0 | Number of records inserted |
| `error_message` | TEXT | NULL | Error message if sync failed |
| `sync_parameters` | TEXT | NULL | JSON string of parameters used for sync |
| `created_at` | DATETIME | DEFAULT UTC_NOW | Record creation timestamp |

**Indexes:**
- `idx_sync_log_type_status` on `sync_type`, `sync_status` (composite)
- `idx_sync_log_start_time` on `start_time`
- `idx_sync_log_end_time` on `end_time`
- `idx_sync_log_type_start_time` on `sync_type`, `start_time` (composite)

**Relationships:**
- One-to-Many with `sync_checkpoints` (via `sync_log_id`)

**Notes:**
- Used for monitoring sync operations
- Supports querying by type, status, and time range
- `sync_parameters` stores JSON for flexible parameter tracking
- Duration can be calculated as `end_time - start_time`

---

### 10. `sync_checkpoints`

Tracks sync progress at various checkpoints to enable resume capability for interrupted syncs.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, AUTO_INCREMENT | Auto-incrementing primary key |
| `sync_log_id` | INTEGER | FOREIGN KEY → `sync_logs.id` | Reference to sync log |
| `checkpoint_type` | VARCHAR(50) | NULL | Type of checkpoint: 'reservation', 'chunk', 'page' |
| `checkpoint_key` | VARCHAR(255) | NULL | Checkpoint identifier (reservation_number, chunk_id, page_number) |
| `processed_count` | INTEGER | DEFAULT 0 | Number of items processed at this checkpoint |
| `total_count` | INTEGER | DEFAULT 0 | Total number of items expected |
| `last_updated` | DATETIME | DEFAULT UTC_NOW, ON UPDATE UTC_NOW | Last update timestamp |
| `checkpoint_metadata` | TEXT | NULL | JSON string for additional checkpoint data |

**Indexes:**
- `idx_checkpoint_sync_log_id` on `sync_log_id`
- `idx_checkpoint_type_key` on `checkpoint_type`, `checkpoint_key` (composite)
- `idx_checkpoint_last_updated` on `last_updated`

**Relationships:**
- Many-to-One with `sync_logs` (via `sync_log_id`)

**Notes:**
- Enables resuming interrupted sync operations
- Supports multiple checkpoint types for different granularities
- `checkpoint_metadata` allows storing flexible additional information
- Used for progress tracking and recovery

---

## Data Types Reference

### String Types
- **VARCHAR(n)**: Variable-length string with maximum length `n`
- **TEXT**: Variable-length text for longer content

### Numeric Types
- **INTEGER**: 32-bit signed integer
- **DECIMAL(p,s)**: Fixed-point decimal with precision `p` and scale `s`
  - `DECIMAL(10,2)`: Monetary amounts (e.g., 99999999.99)
  - `DECIMAL(5,2)`: Percentages (e.g., 999.99)
  - `DECIMAL(10,3)`: Quantities with decimals (e.g., 9999999.999)
  - `DECIMAL(10,6)`: Exchange rates (e.g., 9999.999999)

### Date/Time Types
- **DATE**: Date only (YYYY-MM-DD)
- **DATETIME**: Date and time (YYYY-MM-DD HH:MM:SS)

### Boolean Type
- **BOOLEAN**: True/false values (stored as TINYINT in MySQL)

---

## Relationships Summary

### Primary Relationships

1. **Agents → Reservations** (1:N)
   - One agent can have many reservations
   - Foreign key: `reservations.agent_id` → `agents.agent_id`

2. **Reservations → Itineraries** (1:N)
   - One reservation can have many itineraries
   - Foreign key: `itineraries.reservation_number` → `reservations.reservation_number`
   - Cascade delete: Deleting a reservation deletes its itineraries

3. **Reservations → Extras** (1:N)
   - One reservation can have many extras
   - Foreign key: `extras.reservation_number` → `reservations.reservation_number`
   - Cascade delete: Deleting a reservation deletes its extras

4. **Itineraries → Rate Groups** (1:N)
   - One itinerary can have many rate groups
   - Foreign key: `rate_groups.itinerary_id` → `itineraries.itinerary_id`
   - Cascade delete: Deleting an itinerary deletes its rate groups

5. **Itineraries → Rate Components** (1:N)
   - One itinerary can have many rate components
   - Foreign key: `rate_components.itinerary_id` → `itineraries.itinerary_id`
   - Cascade delete: Deleting an itinerary deletes its rate components

6. **Sync Logs → Sync Checkpoints** (1:N)
   - One sync log can have many checkpoints
   - Foreign key: `sync_checkpoints.sync_log_id` → `sync_logs.id`

### Reference Relationships (No Foreign Keys)

- **Itineraries → Properties**: `itineraries.property` references `properties.property_id` (string match)
- **Reservations/Itineraries → Rate Types**: `rate_type` fields reference `rate_types.rate_type_id` (string match)

---

## Indexes Summary

### Performance Optimization

Indexes are strategically placed to optimize common query patterns:

1. **Lookup Indexes**: Single-column indexes on frequently queried fields
   - Agent lookups: `agent_name`, `inactive`
   - Reservation filtering: `status`, `date_created`, `last_change_date`
   - Date range queries: `date_in`, `date_out`, `service_date`

2. **Composite Indexes**: Multi-column indexes for complex queries
   - `idx_reservation_agent_status`: Filter reservations by agent and status
   - `idx_reservation_date_range`: Date range queries on reservations
   - `idx_itinerary_dates`: Date range queries on itineraries
   - `idx_sync_log_type_status`: Filter sync logs by type and status

3. **Foreign Key Indexes**: Automatically created for foreign key relationships

### Index Usage Guidelines

- Use indexes on `agent_id`, `reservation_number`, `itinerary_id` for joins
- Use date indexes for time-based filtering and reporting
- Composite indexes support multi-column WHERE clauses efficiently
- Monitor index usage and adjust based on query patterns

---

## Data Integrity

### Constraints

1. **Primary Keys**: All tables have primary keys ensuring uniqueness
2. **Foreign Keys**: Enforced relationships maintain referential integrity
3. **NOT NULL Constraints**: Critical fields are marked as NOT NULL
4. **Cascade Deletes**: Related records are automatically deleted when parent is deleted

### Data Validation

- Date fields handle "0000-00-00" from API as NULL
- Boolean fields convert API string values ("0"/"1") to proper booleans
- Decimal fields ensure precision for financial calculations
- String fields have appropriate length limits

---

## Common Query Patterns

### 1. Get Reservations by Agent
```sql
SELECT r.* 
FROM reservations r
WHERE r.agent_id = 'AGENT123'
ORDER BY r.date_created DESC;
```

### 2. Get Itineraries with Rate Details
```sql
SELECT i.*, 
       COUNT(rg.id) as rate_group_count,
       COUNT(rc.id) as rate_component_count
FROM itineraries i
LEFT JOIN rate_groups rg ON i.itinerary_id = rg.itinerary_id
LEFT JOIN rate_components rc ON i.itinerary_id = rc.itinerary_id
WHERE i.reservation_number = 'RES123'
GROUP BY i.itinerary_id;
```

### 3. Get Reservations with Date Range
```sql
SELECT r.*, a.agent_name
FROM reservations r
JOIN agents a ON r.agent_id = a.agent_id
WHERE r.date_created BETWEEN '2025-01-01' AND '2025-12-31'
ORDER BY r.date_created;
```

### 4. Get Sync Statistics
```sql
SELECT sync_type, 
       sync_status,
       COUNT(*) as count,
       SUM(records_processed) as total_processed,
       SUM(records_inserted) as total_inserted,
       SUM(records_updated) as total_updated
FROM sync_logs
WHERE start_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY sync_type, sync_status;
```

### 5. Get Reservation Financial Summary
```sql
SELECT r.reservation_number,
       r.reservation_name,
       r.total_amount,
       SUM(i.total_gross_amount) as itinerary_total,
       SUM(e.amount) as extras_total
FROM reservations r
LEFT JOIN itineraries i ON r.reservation_number = i.reservation_number
LEFT JOIN extras e ON r.reservation_number = e.reservation_number
WHERE r.reservation_number = 'RES123'
GROUP BY r.reservation_number, r.reservation_name, r.total_amount;
```

---

## Maintenance Considerations

### Regular Maintenance Tasks

1. **Cleanup Old Sync Logs**: Use `cleanup_old_logs()` method to remove logs older than 30 days
2. **Index Maintenance**: Monitor index usage and rebuild if necessary
3. **Data Archiving**: Consider archiving old reservations based on business rules
4. **Connection Pooling**: Database uses connection pooling (pool_size=5, max_overflow=10)

### Performance Tips

1. Use batch operations for bulk inserts/updates
2. Leverage composite indexes for multi-column queries
3. Use date range filters to limit result sets
4. Monitor query execution times and optimize slow queries

---

## Migration Notes

### Table Creation

Tables are created using SQLAlchemy's `Base.metadata.create_all(engine)`. The schema is defined in `src/database/models.py`.

### Schema Changes

When modifying the schema:
1. Update the model class in `models.py`
2. Create a migration script if needed
3. Test schema changes in development first
4. Update this documentation

---

## API Data Mapping

### Agents
- Source: `as_agents_contact_list` API
- Mapping: Direct field mapping with type conversions

### Reservations
- Source: `as_reservations_list` API
- Mapping: Main reservation fields + nested itineraries and extras

### Rate Types
- Source: `rt_get_rate` API
- Mapping: Rate type definitions

### Properties
- Source: `ac_get_property` API
- Mapping: Property information with JSON fields for images and social links

---

## Version History

- **Initial Schema**: Designed for ResRequest Bridge API synchronization
- **Sync Logging**: Added `sync_logs` and `sync_checkpoints` for operation tracking
- **Performance**: Multiple indexes added for query optimization
- **Cascade Deletes**: Implemented for data consistency

---

## Additional Resources

- **Models File**: `src/database/models.py`
- **Database Manager**: `src/database/manager.py`
- **API Documentation**: 
  - `docs/as_agents_contact_list.md`
  - `docs/as_reservation_list.md`
- **Main README**: `README.md`

---

*Last Updated: Generated from codebase analysis*  
*Database Version: As defined in `src/database/models.py`*

