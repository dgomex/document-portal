/**
 * Constants shared by every module. Header names in SCHEMA are the contract
 * with the sheet and with the Claude skill: add columns, never rename them.
 */
const Config = Object.freeze({
  LIBRARY_VERSION: '0.6.1',
  SCHEMA_VERSION: 5,  // bump with a step in admin/Migrations.js

  LANGUAGES: ['pt', 'en', 'es'],
  DEFAULT_LANGUAGE: 'pt',
  TIME_ZONE: 'Europe/Lisbon',

  MAX_FILE_BYTES: 100 * 1024 * 1024,
  CHUNK_BYTES: 8 * 1024 * 1024,  // Drive wants multiples of 256 KiB; 8 MiB was fastest in the Phase 0 spike
  UPLOAD: {
    PENDING_TTL_SECONDS: 6 * 3600,  // a started upload must finish within this
    PER_CLIENT_PER_HOUR: 200,       // files started
    NOTE_MAX: 500,
    DIGEST_IDLE_MINUTES: 10,        // a batch is mailed once idle this long
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
  CRON_MIN_GAP_SECONDS: 60,  // the page can call any shell function, crons included: throttle them
  SESSION_TTL_SECONDS: 45 * 60, // sliding: renewed on every request
  SESSION_MAX_SECONDS: 8 * 3600,
  EVENTS_RETENTION_DAYS: 90,

  ID_PREFIX: { CLIENT: 'CL', CASE: 'CS', UPLOAD: 'UP', ITEM: 'IT' },
  PROVISION: { PENDING: 'PENDING', ACTIVE: 'ACTIVE', ERROR: 'ERROR' },
  CASE_STATUS: { OPEN: 'open', CLOSED: 'closed' },
  INVITE: { NONE: '', REQUESTED: 'REQUESTED', SENT: 'SENT', ERROR: 'ERROR' },

  TABS: { SETTINGS: 'Settings', CLIENTS: 'Clients', CASES: 'Cases', CHECKLIST: 'Checklist', UPLOADS: 'Uploads', EVENTS: 'Events' },

  // Each case's own list of requested documents (docs/PER-CASE-DOCUMENTS.md).
  // requested: a document the firm added by hand before 0.6.0; read as required.
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
    ['reminder_days', '7'],
    ['schema_version', ''],
    ['library_version', ''],
  ],

  SCHEMA: {
    Clients: ['client_id', 'name', 'email', 'additional_emails', 'language', 'active', 'invite_status',
      'provision_status', 'provision_error', 'folder_id', 'created_at', 'created_by', 'notes',
      'invited_at'],  // added in schema 2: columns are only ever appended
    // Sheets made before 0.6.0 also have visa_type, facts and checklist_version: no longer read.
    Cases: ['case_id', 'client_id', 'case_name', 'firm_reference', 'status', 'responsible_email',
      'provision_status', 'provision_error', 'folder_id', 'created_at', 'created_by'],
    // One row per document the firm requests in a case (schema 5). Sheets made before 0.6.0
    // also have person_id, person_name, doc_type, key, source and text_json: read for old
    // rows only (person_name as the section, text_json for the texts), never written.
    Checklist: ['item_id', 'case_id', 'section', 'title', 'instructions', 'level', 'status', 'reason',
      'due_date', 'upload_ids', 'updated_at'],
    Uploads: ['upload_id', 'timestamp', 'client_id', 'client_name', 'case_id', 'case_name', 'stored_name',
      'original_name', 'mime_type', 'size_bytes', 'md5', 'drive_link', 'uploader_email', 'note', 'status',
      'item_id', 'person_id'],  // person_id: uploads started before 0.6.0 only
    Events: ['timestamp', 'type', 'email_hash', 'detail'],
  },

  // Columns only the script writes. Protected warning-only: the lawyer owns
  // the sheet, so hard protection would not bind them anyway.
  SCRIPT_OWNED: {
    Clients: ['provision_error', 'folder_id', 'invited_at'],
    Cases: ['provision_error', 'folder_id'],
    // The firm writes the rest: one row per document it wants for the case.
    Checklist: ['item_id', 'upload_ids', 'updated_at'],
    Uploads: '*',
    Events: '*',
  },

  VALIDATIONS: {
    Clients: {
      active: 'checkbox',
      language: ['pt', 'en', 'es'],
      invite_status: ['REQUESTED', 'SENT', 'ERROR'],
      provision_status: ['PENDING', 'ACTIVE', 'ERROR'],
    },
    Cases: {
      status: ['open', 'closed'],
      provision_status: ['PENDING', 'ACTIVE', 'ERROR'],
    },
    Checklist: {
      level: ['required', 'optional', 'waived', 'requested'],  // requested: rows from before 0.6.0
      status: ['missing', 'received', 'accepted', 'rejected'],
    },
  },
});
