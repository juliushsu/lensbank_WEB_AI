# LensBank Frontend English Data Model Audit (Read-Only)

Date: 2026-04-22  
Scope: products, locations/stores, company/about/cms/milestones, service-related content  
Method: read-only scan of current repo artifacts (`supabase/functions/*`, `supabase/migrations/*`, `docs/*`) and provided spec docs.

## 1) Products

### Checked fields
- name / title / description / summary / notes / requirements / notices
- display tags

### Findings
- Confirmed in current artifacts:
  - `products.name_zh`
  - `products.name_ja` (seen in Edge Function queries)
  - `products.daily_price`, `products.deposit`, `products.category`, `products.brand`
- Not found as existing schema contract in this repo/spec set:
  - `name_en`, `title_en`, `description_en`, `summary_en`
  - `notes_en`, `requirements_en`, `notices_en`

### display_tags status
- Product spec defines tags as machine IDs:
  - `hot`, `new`, `incoming`, `staff_required`, `crew_only`
- This is suitable for UI i18n mapping (machine keys -> locale labels).

## 2) Locations / Stores

### Checked fields
- store name, address, business hours, contact notes, service description

### Findings
- Confirmed:
  - `locations.name_zh`
  - `locations.name_ja`
  - attendance/geolocation fields (`latitude`, `longitude`, `checkin_radius_m`, etc.)
- Not confirmed in current schema artifacts:
  - `name_en`
  - `address_*`
  - `business_hours_*`
  - `contact_notes_*`
  - `service_description_*`

## 3) Company / About / CMS / Milestones

### Checked entities
- company intro
- about sections
- timeline/milestones
- announcements/CMS content

### Findings
- No confirmed table/view/RPC/Edge Function for:
  - about sections
  - milestones/timeline
  - public CMS announcements
  - company profile content for multilingual frontend
- Therefore bilingual (including English) support for these entities is currently **future schema work**.

## 4) Service-related Content

### Checked fields
- service item title/description
- workflow/booking notes
- pricing notes

### Findings
- Pricing numeric fields exist in products (`daily_price`, `deposit`).
- Textual service content bilingual schema is not confirmed:
  - no clear `*_zh/*_ja/*_en` content tables for workflow/booking/pricing notes.
- Any English support here should be marked as **future schema work**.

## 5) Summary Output

### A. Fields already usable for multilingual baseline
- `products.name_zh`
- `products.name_ja`
- `locations.name_zh`
- `locations.name_ja`
- `products.brand` / `products.category` (machine codes)
- product tag IDs (`hot/new/incoming/staff_required/crew_only`) as machine keys

### B. Entities missing English fields (future schema work)
- Products content text fields (`*_en` family): title/description/summary/notes/requirements/notices
- Locations content text fields (`name_en`, address/hours/contact/service text in English)
- Company/About/CMS/Milestones content models and English columns
- Service workflow/booking/pricing explanatory text in English

### C. Content suitable for UI i18n (no DB translation required)
- Navigation/menu/static labels
- Filter labels (brand/category UI captions)
- Product tag label mapping from machine keys
- Status labels and validation messages

### D. Content not suitable for auto-translation; prefer human-maintained copy
- Legal/customer-facing notices and requirements
- Service descriptions and booking policy text
- About/company brand story copy
- Timeline/milestone narratives
- Store-specific contact and operational notes

## Notes
- This is a read-only audit. No migration or DB write was executed.
- API contract should follow actual deployed Supabase Edge Functions.
