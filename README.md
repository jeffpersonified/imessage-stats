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
git clone https://github.com/YOUR_USERNAME/imessage-stats.git
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

### 3. Export your data

```bash
./scripts/build
```

### 4. Start the web server

```bash
./scripts/serve
```

### 5. View your stats

Open [http://localhost:8080](http://localhost:8080)

## Options

```bash
./scripts/build --limit 50      # Export top 50 contacts
./scripts/build --help          # Show all options
./scripts/serve 3000            # Use a different port
```

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

### Timestamp Format

Apple stores timestamps as nanoseconds since January 1, 2001. The script converts these to standard dates.

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

### Permission denied when copying

Grant **Full Disk Access** to Finder or Terminal:

1. System Settings → Privacy & Security → Full Disk Access
2. Add Finder (or Terminal)
3. Try copying again
