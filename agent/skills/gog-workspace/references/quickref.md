# GOG Workspace — Auto-Generated Command Reference

> **Generated:** 2026-07-19 | **gog:** v0.34.0 (83637875 2026-07-11T05:44:38Z)
> **Source of truth:** the live CLI. Run `scripts/generate-ref.sh` after any `gog` update.
> **At runtime:** always prefer `gog <service> --help` over this cached file.

## gog drive

  ls [flags]
    List files in a folder (default: root)
  search <query> ... [flags]
    Full-text search across Drive
  tree [flags]
    Print a read-only folder tree
  du [flags]
    Summarize Drive folder sizes
  inventory [flags]
    Export a read-only Drive inventory
  get <fileId> [flags]
    Get file metadata
  download <fileId> [flags]
    Download a file (exports Google Docs formats)
  copy <fileId> <name> [flags]
    Copy a file
  upload <localPath> [flags]
    Upload a file
  mkdir <name> [flags]
    Create a folder
  delete (rm,del) <fileId> [flags]
    Move a file to trash (use --permanent to delete forever)
  move <fileId> [flags]
    Move a file to a different folder
  rename <fileId> <newName>
    Rename a file or folder
  shortcut (shortcuts) <command>
    Manage shortcuts to Drive files and folders
  share <fileId> [flags]
    Share a file or folder
  unshare <fileId> <permissionId>
    Remove a permission from a file
  permissions <fileId> [flags]
    List permissions on a file
  audit <command>
    Audit Drive sharing without mutation
  bulk <command>
    Bulk Drive permission operations
  labels (label) <command>
    Read and modify Drive labels
  url <fileId> ...
    Print web URLs for files
  comments <command>
    Manage comments on files
  drives [flags]
    List shared drives (Team Drives)
  revisions (revision) <command>
    List and inspect file revisions
  changes <command>
    Track Drive changes for sync and automation
  activity <command>
    Query Drive Activity audit events
  raw <fileId> [flags]
    Dump raw Google Drive API response as JSON (Files.Get; lossless; for

## gog gmail

  search (find,query,ls,list) <query> ... [flags]
    Search threads using Gmail query syntax
  messages (message,msg,msgs) <command>
    Message operations
  get (info,show) <messageId> [flags]
    Get a message (full|metadata|raw)
  raw <messageId> [flags]
    Dump raw Gmail API response as JSON (Users.Messages.Get; lossless; for
    scripting and LLM consumption)
  attachment <messageId> <attachmentId> [flags]
    Download a single attachment
  url <threadId> ...
    Print Gmail web URLs for threads
  history [flags]
    Gmail history
  thread (threads,read) <command>
    Thread operations (get, modify)
  labels (label) <command>
    Label operations
  batch <command>
    Batch operations (permanent delete requires broader Gmail scope; use gmail
    trash for normal trashing)
  archive [<messageId> ...] [flags]
    Archive messages or explicit threads (remove from inbox)
  mark-read (read-messages) [<messageId> ...] [flags]
    Mark messages as read
  unread (mark-unread) [<messageId> ...] [flags]
    Mark messages as unread
  trash [<messageId> ...] [flags]
    Move messages to trash
  send [flags]
    Send an email
  reply <messageId> [flags]
    Reply to a message
  reply-all (replyall) <messageId> [flags]
    Reply to all message participants
  forward (fwd) --to=STRING <messageId> [flags]
    Forward a message to new recipients
  autoreply <query> ... [flags]
    Reply once to matching messages
  track <command>
    Email open tracking
  drafts (draft) <command>
    Draft operations
  settings <command>

## gog calendar

  calendars [flags]
    List calendars
  subscribe (sub,add-calendar) <calendarId> [flags]
    Add a calendar to your calendar list
  unsubscribe (unsub) <calendarId>
    Remove a calendar from your calendar list
  create-calendar (new-calendar) <summary> [flags]
    Create a new secondary calendar
  delete-calendar <calendarId>
    Delete an owned secondary calendar
  acl (permissions,perms) <calendarId> [flags]
    List calendar ACL
  alias <command>
    Manage calendar aliases
  events (list,ls) [<calendarId> ...] [flags]
    List events from a calendar or all calendars
  event (get,info,show) <calendarId> <eventId> [flags]
    Get event
  raw <calendarId> <eventId> [flags]
    Dump raw Google Calendar API response as JSON (Events.Get; lossless;
    for scripting and LLM consumption)
  create (add,new) <calendarId> [flags]
    Create an event
  update (edit,set) <calendarId> <eventId> [flags]
    Update an event
  move (transfer) <calendarId> <eventId> <destinationCalendarId> [flags]
    Move an event to another calendar
  delete (rm,del,remove) <calendarId> <eventId> [flags]
    Delete an event
  freebusy [<calendarIds>] [flags]
    Get free/busy
  respond (rsvp,reply) <calendarId> <eventId> [flags]
    Respond to an event invitation
  propose-time <calendarId> <eventId> [flags]
    Generate URL to propose a new meeting time (browser-only feature)
  colors
    Show calendar colors
  conflicts [flags]
    Find busy-time overlaps across calendars
  changed [<calendarId>] [flags]
    List most recently changed events (including deletions)
  search (find,query) <query> [flags]
    Search events
  time [flags]
    Show server time
  users [flags]
    List workspace users (use their email as calendar ID)
  team <group-email> [flags]
    Show events for Workspace group members (service account, direct token,
    or ADC)
  focus-time (focus) --from=STRING --to=STRING [<calendarId>] [flags]
    Create a Focus Time block
  out-of-office (ooo) --from=STRING --to=STRING [<calendarId>] [flags]
    Create an Out of Office event
  working-location (wl) --from=STRING --to=STRING --type=STRING [<calendarId>] [flags]

## gog contacts

  search <query> ... [flags]
    Search contacts by name/email/phone
  list (ls) [flags]
    List contacts
  get (info,show) <resourceName>
    Get a contact
  export [<selector>] [flags]
    Export contacts as vCard (.vcf)
  dedupe [flags]
    Find likely duplicate contacts and optionally merge them
  create (add,new) [flags]
    Create a contact
  update (edit,set) <resourceName> [flags]
    Update a contact
  delete (rm,del,remove) <resourceName>
    Delete a contact
  directory <command>
    Directory contacts
  other <command>
    Other contacts
  raw <identifier> [flags]
    Dump raw People API response as JSON (People.Get; lossless; for scripting

## gog sheets

  get (read,show) <spreadsheetId> <range> [flags]
    Get values from a range
  update (edit,set) <spreadsheetId> <range> [<values> ...] [flags]
    Update values in a range
  batch-update (batch) --data-json=STRING <spreadsheetId> [flags]
    Update values in multiple ranges with one API request
  append (add) <spreadsheetId> <range> [<values> ...] [flags]
    Append values to a range
  insert <spreadsheetId> <sheet> <dimension> <start> [flags]
    Insert empty rows or columns into a sheet
  delete-dimension (delete-dim) --dimension=STRING <spreadsheetId> <rangeOrSheet> [flags]
    Delete rows or columns while preserving intersecting tables
  clear <spreadsheetId> <range>
    Clear values in a range
  format <spreadsheetId> <range> [flags]
    Apply cell formatting to a range
  conditional-format (cf,conditional-formats) <command>
    Manage conditional formatting rules
  validation (data-validation,validations) <command>
    Manage cell data validation rules
  banding (banded-ranges) <command>
    Manage alternating color banding
  filter (filters,basic-filter,basic-filters) <command>
    Manage basic filters
  merge <spreadsheetId> <range> [flags]
    Merge cells in a range
  unmerge <spreadsheetId> <range>
    Unmerge cells in a range
  copy-paste (fill,copy-range) <spreadsheetId> <source> <dest> [flags]
    Copy a range's values/formulas/format to another range (tiles to fill
    down/across)
  number-format <spreadsheetId> <range> [flags]
    Apply number format to a range
  freeze <spreadsheetId> [flags]
    Freeze rows and columns on a sheet
  resize-columns <spreadsheetId> <columns> [flags]
    Resize sheet columns
  resize-rows <spreadsheetId> <rows> [flags]
    Resize sheet rows
  read-format (get-format,format-read) <spreadsheetId> <range> [flags]
    Read cell formatting from a range
  notes <spreadsheetId> <range>
    Get cell notes from a range
  update-note (set-note) <spreadsheetId> <range> [flags]
    Set or clear a cell note
  find-replace <spreadsheetId> <find> <replace> [flags]
    Find and replace text across a spreadsheet
  links (hyperlinks) <command>
    Get or set cell hyperlinks
  named-ranges (namedranges,nr) <command>
    Manage named ranges
  table (tables) <command>
    Manage Google Sheets tables
  metadata (info) <spreadsheetId>
    Get spreadsheet metadata
  raw <spreadsheetId> [flags]
    Dump raw Google Sheets API response as JSON (Spreadsheets.Get; lossless;
    for scripting and LLM consumption)
  create (new) <title> [flags]
    Create a new spreadsheet
  copy (cp,duplicate) <spreadsheetId> <title> [flags]
    Copy a Google Sheet
  export (download,dl) <spreadsheetId> [flags]
    Export a Google Sheet (pdf|xlsx|csv) via Drive
  chart (charts) <command>
    Manage spreadsheet charts
  add-tab (add-sheet) <spreadsheetId> <tabName> [flags]
    Add a new tab/sheet to a spreadsheet
  rename-tab (rename-sheet) <spreadsheetId> <oldName> <newName>
    Rename a tab/sheet in a spreadsheet
  delete-tab (delete-sheet) <spreadsheetId> <tabName>
    Delete a tab/sheet from a spreadsheet (use --force to skip confirmation)
  reorder-tab (move-tab,reorder-sheet,move-sheet) --tab=STRING --to=TO <spreadsheetId>

## gog docs

  export (download,dl) <docId> [flags]
    Export a Google Doc (pdf|docx|txt|md|html)
  info (get,show) <docId>
    Get Google Doc metadata
  create (add,new) <title> [flags]
    Create a Google Doc
  copy (cp,duplicate) <docId> <title> [flags]
    Copy a Google Doc
  cat (text,read) <docId> [flags]
    Print a Google Doc as plain text
  comments <command>
    Manage comments on files
  tabs <command>
    Manage Google Doc tabs
  header (headers) <command>
    List, create, or delete document headers
  footer (footers) <command>
    List, create, or delete document footers
  add-tab <docId> [flags]
    Add a tab to a Google Doc
  rename-tab <docId> [flags]
    Rename a tab in a Google Doc
  delete-tab <docId> [flags]
    Delete a tab from a Google Doc
  list-tabs <docId>
    List all tabs in a Google Doc
  write <docId> [flags]
    Write content to a Google Doc
  insert <docId> [<content>] [flags]
    Insert text at a specific position
  insert-table --rows=INT --cols=INT <docId> [flags]
    Insert a native table at a specific position (or end-of-doc with --at-end),
    optionally populated via --values-json
  cell-update (update-cell) --row=INT --col=INT <docId> [flags]
    Replace or append content inside a specific table cell
  cell-style --row=INT --col=INT <docId> [flags]
    Apply table cell, border, padding, alignment, and text styling
  table-row <command>
    Insert, delete, style, or pin native table rows
  table-column <command>
    Insert or delete native table columns
  table-merge --range=STRING <docId> [flags]
    Merge a native table cell range
  table-unmerge (table-split) --cell=STRING <docId> [flags]
    Unmerge the region containing a native table cell
  table-column-width (table-width,column-width) <docId> [flags]
    Set or reset native table column widths
  insert-image <docId> [flags]
    Insert a public image URL or upload a local image into a Google Doc
  replace-image <docId> [flags]
    Replace an existing image without changing its position or bounds
  insert-person --email=STRING <docId> [flags]
    Insert a native person smart chip
  insert-file-chip (insert-rich-link) --file-id=STRING <docId> [flags]
    Insert a native Drive file smart chip
  insert-date-chip --date=STRING <docId> [flags]
    Insert a native date smart chip
  insert-page-break (page-break,pb) <docId> [flags]
    Insert a page break at a specific position (or end-of-doc with --at-end)
  insert-footnote <docId> [flags]
    Insert and populate a footnote
  insert-section-break <docId> [flags]
    Insert a continuous or next-page section break
  insert-horizontal-rule (insert-hr,hr) <docId> [flags]
    Insert a paragraph-border horizontal rule
  section-columns --count=INT <docId> [flags]
    Set the column count for a document section
  delete <docId> [flags]
    Delete text range from document
  find-range <docId> <text> [flags]
    Find text and print Docs API UTF-16 index ranges
  find-replace <docId> <find> [<replace>] [flags]
    Find and replace text. Supports plain text or markdown with images;
    use --first for a single occurrence.
  update <docId> [flags]
    Insert or replace text at a specific index or range in a Google Doc
  edit <docId> <find> <replace> [flags]
    Find and replace text in a Google Doc
  format <docId> [flags]
    Apply text or paragraph formatting to a Google Doc
  sed <docId> [<expression>] [flags]
    Regex find/replace (sed-style: s/pattern/replacement/g)
  clear <docId>
    Clear all content from a Google Doc
  structure (struct) <docId> [flags]
    Show document structure with numbered paragraphs
  tables <command>
    List native tables
  images <command>
    List document images
  headings <command>
    List document headings
  paragraphs <command>
    List document paragraphs
  suggestions <command>
    List pending text suggestions
  named-range (named-ranges,namedranges,nr) <command>
    Manage named ranges
  raw <docId> [flags]
    Dump raw Google Docs API response as JSON (Documents.Get; lossless;
    for scripting and LLM consumption)
  page-layout (set-page-layout,page-setup) <docId> [flags]

## Troubleshooting

- **`gog: command not found`**: `brew install steipete/tap/gogcli`
- **`authentication required`**: `gog auth list` then `gog auth login <email>`
- **keyring prompts**: set `GOG_KEYRING_PASSWORD` in `~/.pi/agent/.env`
