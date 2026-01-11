# iMessage Stats

Analyze your iMessage history to see who you text the most. Visualize messaging patterns over time with a local web app.

<img width="1200" height="630" alt="open graph" src="https://github.com/user-attachments/assets/953a8f4d-3a40-436c-8fc3-e755394132a5" />

## Features

- **Top contacts** ranked by a mix of messages exchanged and words sent
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
├── scripts/
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

## LLM Analysis (Optional)

Use AI to extract conversation themes and relationship insights for each contact. This feature analyzes message samples to identify what you talk about, how relationships have evolved, and generates personalized summaries.

### How it works

When enabled, the script samples messages from each contact (up to 1000 by default), sends them to Claude Haiku for analysis, and generates:

- **Conversation themes** - Specific topics you discuss (e.g., "weekend plans", "work projects")
- **Relationship summary** - A personalized description of your conversations
- **Yearly analysis** - How themes changed over time
- **Relationship evolution** - How your relationship has deepened or shifted

### Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com/)

2. Add it to your `.env` file:

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

3. Run the start script - it will prompt you to enable LLM analysis if an API key is detected.

### Cost considerations

LLM analysis uses the Claude Haiku model and incurs API costs based on the number of contacts and their message history. We recommend declining the LLM analysis prompt on your first run to see how many contacts and messages you have before deciding to enable it.

**Rough cost estimate:** Processing 50 contacts with several years of history each (totaling ~100,000 messages) costs approximately **$3-5**. Costs scale with the number of contacts analyzed and years of message history per contact (each year gets its own analysis).

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
cp .env.example .env
```

Edit `.env` with your API key and database ID.

### 7. Sync

```bash
uv run --with requests --with python-dotenv python scripts/notion_sync.py
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
