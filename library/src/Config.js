/**
 * Constants shared by every module. Header names in SCHEMA are the contract
 * with the sheet and with the Claude skill: add columns, never rename them.
 */
const Config = Object.freeze({
  LIBRARY_VERSION: '0.3.1',
  SCHEMA_VERSION: 3,  // bump with a step in admin/Migrations.js

  LANGUAGES: ['pt', 'en'],
  DEFAULT_LANGUAGE: 'pt',
  TIME_ZONE: 'Europe/Lisbon',

  MAX_FILE_BYTES: 100 * 1024 * 1024,
  CHUNK_BYTES: 8 * 1024 * 1024,  // Drive wants multiples of 256 KiB; 8 MiB was fastest in the Phase 0 spike
  UPLOAD: {
    PENDING_TTL_SECONDS: 6 * 3600,  // a started upload must finish within this
    PER_CLIENT_PER_HOUR: 200,       // files started
    NOTE_MAX: 500,
    DIGEST_IDLE_MINUTES: 10,        // a batch nobody finished is mailed after this
  },
  MAIL: {
    DEFAULT_LIMIT: 95,              // free Gmail: 100 recipients a day, minus a margin
    MAX_LIMIT: 1500,                // Workspace
    RESERVED_FOR_CODES: 30,         // digests and invites stop this far short of the limit
  },
  ALLOWED_MIME: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'],

  OTP: {
    LENGTH: 6, TTL_SECONDS: 600, MAX_ATTEMPTS: 5,
    RESPONSE_MS: 2500,          // every code request takes this long, so timing reveals nothing
    MIN_GAP_SECONDS: 60,        // per email
    PER_EMAIL_PER_HOUR: 5,
    GLOBAL_PER_HOUR: 300,       // beyond this, requests are dropped silently (flood)
    WRONG_PER_6H: 20,           // wrong codes per email per 6 hours (the cache's longest life), across all codes
  },
  CRON_MIN_GAP_SECONDS: 60,
  // Published catalog (main branch of our repo): only ever offered, never applied by itself.
  CATALOG_FEED_URL: 'https://raw.githubusercontent.com/dgomex/document-portal/main/dist/catalog.json',     // the page can call any shell function, crons included: throttle them
  SESSION_TTL_SECONDS: 45 * 60, // sliding: renewed on every request
  SESSION_MAX_SECONDS: 8 * 3600,
  EVENTS_RETENTION_DAYS: 90,

  ID_PREFIX: { CLIENT: 'CL', CASE: 'CS', UPLOAD: 'UP', PERSON: 'PE', ITEM: 'IT' },
  PROVISION: { PENDING: 'PENDING', ACTIVE: 'ACTIVE', ERROR: 'ERROR' },
  CASE_STATUS: { OPEN: 'open', CLOSED: 'closed' },
  INVITE: { NONE: '', REQUESTED: 'REQUESTED', SENT: 'SENT', ERROR: 'ERROR' },

  TABS: { SETTINGS: 'Settings', CLIENTS: 'Clients', CASES: 'Cases', PEOPLE: 'People', CHECKLIST: 'Checklist',
    ADJUSTMENTS: 'Adjustments', UPLOADS: 'Uploads', EVENTS: 'Events' },

  // People in a case, and what each checklist item is (docs/VISA-CHECKLISTS.md).
  ROLES: ['main_applicant', 'spouse', 'child', 'dependant'],
  APPLIES_TO: ['main_applicant', 'spouse', 'each_child', 'each_adult', 'each_person', 'case'],
  ITEM_LEVEL: { REQUIRED: 'required', OPTIONAL: 'optional', REQUESTED: 'requested', WAIVED: 'waived' },
  ITEM_STATUS: { MISSING: 'missing', RECEIVED: 'received', ACCEPTED: 'accepted', REJECTED: 'rejected' },

  SETTINGS_HEADERS: ['key', 'value', 'description'],
  SETTINGS_DEFAULTS: [
    ['firm_name', ''],
    ['logo_file_id', ''],
    ['notification_email', ''],
    ['send_as_alias', ''],
    ['root_folder_id', ''],
    ['default_language', 'pt'],
    ['portal_url', ''],
    ['privacy_contact', ''],
    ['privacy_policy_url', ''],
    ['max_file_mb', '100'],
    ['daily_email_limit', '95'],
    ['logo_url', ''],
    ['countries', 'PT'],
    ['catalog_version', ''],
    ['catalog_check', 'on'],
    ['catalog_pending', ''],
    ['reminder_days', '7'],
    ['schema_version', ''],
    ['library_version', ''],
  ],

  SCHEMA: {
    Clients: ['client_id', 'name', 'email', 'additional_emails', 'language', 'active', 'invite_status',
      'provision_status', 'provision_error', 'folder_id', 'created_at', 'created_by', 'notes',
      'invited_at'],  // added in schema 2: columns are only ever appended
    Cases: ['case_id', 'client_id', 'case_name', 'firm_reference', 'status', 'responsible_email',
      'provision_status', 'provision_error', 'folder_id', 'created_at', 'created_by',
      'visa_type', 'facts', 'checklist_version'],  // schema 3
    // schema 3: the people in each case (the main applicant is added automatically)
    People: ['person_id', 'case_id', 'name', 'role', 'birth_date', 'notes', 'folder_id', 'created_at', 'created_by'],
    // schema 3: one row per document per person, frozen when the case's list is built
    Checklist: ['item_id', 'case_id', 'person_id', 'person_name', 'title', 'instructions', 'level', 'status', 'reason',
      'due_date', 'upload_ids', 'doc_type', 'key', 'source', 'updated_at', 'text_json'],
    // schema 3: the firm's changes to the catalog (differences, not a copy)
    Adjustments: ['visa_type', 'applies_to', 'doc_type', 'action', 'level', 'title', 'note'],
    Uploads: ['upload_id', 'timestamp', 'client_id', 'client_name', 'case_id', 'case_name', 'stored_name',
      'original_name', 'mime_type', 'size_bytes', 'md5', 'drive_link', 'uploader_email', 'note', 'status',
      'item_id', 'person_id'],  // schema 3
    Events: ['timestamp', 'type', 'email_hash', 'detail'],
  },

  // Columns only the script writes. Protected warning-only: the lawyer owns
  // the sheet, so hard protection would not bind them anyway.
  SCRIPT_OWNED: {
    Clients: ['provision_error', 'folder_id', 'invited_at'],
    Cases: ['provision_error', 'folder_id', 'checklist_version'],
    People: ['person_id', 'folder_id'],
    // The lawyer edits level, status, reason, due date and wording; adds rows for ad-hoc requests.
    Checklist: ['item_id', 'person_id', 'upload_ids', 'doc_type', 'key', 'source', 'updated_at', 'text_json'],
    Uploads: '*',
    Events: '*',
  },

  VALIDATIONS: {
    Clients: {
      active: 'checkbox',
      language: ['pt', 'en'],
      invite_status: ['REQUESTED', 'SENT', 'ERROR'],
      provision_status: ['PENDING', 'ACTIVE', 'ERROR'],
    },
    Cases: {
      status: ['open', 'closed'],
      provision_status: ['PENDING', 'ACTIVE', 'ERROR'],
      visa_type: 'visa_types',  // filled from the catalog for the firm's countries
    },
    People: {
      role: ['main_applicant', 'spouse', 'child', 'dependant'],
    },
    Checklist: {
      level: ['required', 'optional', 'requested', 'waived'],
      status: ['missing', 'received', 'accepted', 'rejected'],
    },
    Adjustments: {
      action: ['add', 'change', 'hide'],
      applies_to: ['main_applicant', 'spouse', 'each_child', 'each_adult', 'each_person', 'case'],
      level: ['required', 'optional'],
    },
  },
});
