/**
 * Constants shared by every module. Header names in SCHEMA are the contract
 * with the sheet and with the Claude skill: add columns, never rename them.
 */
const Config = Object.freeze({
  LIBRARY_VERSION: '0.2.0',
  SCHEMA_VERSION: 2,  // bump with a step in admin/Migrations.js

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
  },
  SESSION_TTL_SECONDS: 45 * 60, // sliding: renewed on every request
  SESSION_MAX_SECONDS: 8 * 3600,
  EVENTS_RETENTION_DAYS: 90,

  ID_PREFIX: { CLIENT: 'CL', CASE: 'CS', UPLOAD: 'UP' },
  PROVISION: { PENDING: 'PENDING', ACTIVE: 'ACTIVE', ERROR: 'ERROR' },
  CASE_STATUS: { OPEN: 'open', CLOSED: 'closed' },
  INVITE: { NONE: '', REQUESTED: 'REQUESTED', SENT: 'SENT', ERROR: 'ERROR' },

  TABS: { SETTINGS: 'Settings', CLIENTS: 'Clients', CASES: 'Cases', UPLOADS: 'Uploads', EVENTS: 'Events' },

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
    ['schema_version', ''],
    ['library_version', ''],
  ],

  SCHEMA: {
    Clients: ['client_id', 'name', 'email', 'additional_emails', 'language', 'active', 'invite_status',
      'provision_status', 'provision_error', 'folder_id', 'created_at', 'created_by', 'notes',
      'invited_at'],  // added in schema 2: columns are only ever appended
    Cases: ['case_id', 'client_id', 'case_name', 'firm_reference', 'status', 'responsible_email',
      'provision_status', 'provision_error', 'folder_id', 'created_at', 'created_by'],
    Uploads: ['upload_id', 'timestamp', 'client_id', 'client_name', 'case_id', 'case_name', 'stored_name',
      'original_name', 'mime_type', 'size_bytes', 'md5', 'drive_link', 'uploader_email', 'note', 'status'],
    Events: ['timestamp', 'type', 'email_hash', 'detail'],
  },

  // Columns only the script writes. Protected warning-only: the lawyer owns
  // the sheet, so hard protection would not bind them anyway.
  SCRIPT_OWNED: {
    Clients: ['provision_error', 'folder_id', 'invited_at'],
    Cases: ['provision_error', 'folder_id'],
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
    },
  },
});
