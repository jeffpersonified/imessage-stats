# iMessage Stats

Analyze your iMessage history to see who you text the most. Visualize messaging patterns over time with a local web app.

## Features

- **Top contacts** ranked by total message count
- **Sent vs received** breakdown for each contact
- **Timeline visualization** with monthly and yearly views
- **Search** to quickly find specific contacts
- **100% local** - your data never leaves your computer

## Requirements

- macOS (uses iMessage and Contacts databases)
- Python 3.8+

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/brianlovin/imessage-stats.git
cd imessage-stats
```

### 2. Copy your iMessage + Contacts data

Open **Finder**, press `Cmd+Shift+G`, and copy these to the project folder:

| Copy from                                           | To                       |
| --------------------------------------------------- | ------------------------ |
| `~/Library/Messages/chat.db`                        | `imessage-stats/chat.db` |
| `~/Library/Application Support/AddressBook/Sources` | `imessage-stats/Sources` |

Your project folder should now contain:

```
imessage-stats/
├── chat.db          ← your iMessage database
├── Sources/         ← your contacts
├── export.py
├── web/
└── ...
```

### 3. Run it

```bash
./scripts/start
```

This exports your data, starts a local server, and opens your browser.

## Options

```bash
./scripts/start --limit 50      # Only export top 50 contacts
./scripts/build                 # Just export data (no server)
./scripts/serve                 # Just start server
./scripts/serve 3000            # Use a different port
```

## Notion Sync (Optional)

Sync your stats to a Notion database for easy sharing or further analysis.

### 1. Install uv

```bash
brew install uv
```

### 2. Create a Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it (e.g., "iMessage Stats")
4. Click "Submit"
5. Copy the "Internal Integration Secret" (starts with `secret_`)

### 3. Create an empty database in Notion

Create a new database anywhere in your workspace. The script will automatically add the required columns.

### 4. Share the database with your integration

Open your database in Notion → "..." menu → "Connections" → add your integration.

### 5. Get the database ID

The database ID is in the URL when viewing your database:

```
https://notion.so/workspace/DATABASE_ID?v=...
                         ^^^^^^^^^^^
```

Copy the 32-character ID (the part before `?v=`).

### 6. Configure your credentials

```bash
cp notion/.env.example notion/.env
```

Edit `notion/.env` with your API key and database ID.

### 7. Sync

```bash
./scripts/notion
```

The script will add the required columns and sync your contacts. Run it again anytime to update.

## Privacy

**Your data stays on your computer.** This tool:

- Reads your local iMessage and Contacts databases
- Generates JSON files in `web/data/`
- Runs a local web server for visualization
- Never sends data anywhere

The `chat.db`, `Sources/`, and `web/data/` directories are all gitignored to prevent accidentally committing personal information.

## How It Works

### iMessage Database

macOS stores iMessage history in a SQLite database at `~/Library/Messages/chat.db`. The key tables are:

- `message` - Individual messages with timestamps and `is_from_me` flag
- `handle` - Contact identifiers (phone numbers, emails)
- `chat` - Conversations (1-on-1 or group)
- `chat_message_join` - Links messages to chats
- `chat_handle_join` - Links handles to chats

### Contacts Database

Contact names are stored in `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb`. The script matches phone numbers and emails to names.

## Troubleshooting

### "Database not found" error

Make sure you copied `chat.db` and `Sources/` into the project folder. Check:

```bash
ls -la chat.db Sources/
```

### No contacts showing names

The Contacts sources folder might be empty or in a different location. Try:

```bash
# Find your Contacts databases
find ~/Library -name "AddressBook-v22.abcddb" 2>/dev/null
```
