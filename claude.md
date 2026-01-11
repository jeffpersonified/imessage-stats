# iMessage Stats

A local-only tool that analyzes your iMessage history and visualizes messaging patterns with contacts.

## Project Structure

```
├── scripts/
│   ├── build          # Export data only (shell wrapper)
│   ├── export.py      # Python script to extract stats from chat.db
│   ├── notion_sync.py # Optional sync to Notion database
│   ├── serve          # Start local web server
│   └── start          # Build + serve (main entry point)
├── web/
│   ├── app.js         # Chart.js visualization, contact list, heatmaps
│   ├── index.html     # Single page app
│   ├── style.css      # Dark theme styling
│   └── data/          # Generated JSON files (gitignored)
├── chat.db            # User's iMessage database (gitignored, copied manually)
└── Sources/           # User's Contacts database (gitignored, copied manually)
```

## Tech Stack

- **Python 3.8+**: Data extraction from SQLite databases (iMessage + Contacts)
- **Vanilla JS**: Web frontend with Chart.js for visualizations
- **No build step**: Plain HTML/CSS/JS served directly

## Key Concepts

### iMessage Database
- macOS stores messages at `~/Library/Messages/chat.db`
- Key tables: `message`, `handle`, `chat`, `chat_message_join`, `chat_handle_join`
- Timestamps use Apple epoch (2001-01-01) in nanoseconds
- `c.style = 45` filters for 1-on-1 chats (excludes group messages)

### Data Flow
1. User copies `chat.db` and `Sources/` to project root
2. `export.py` queries the local copies, matches contacts, generates JSON
3. Web app loads `contacts.json` and per-contact `messages/*.json` files
4. All data stays local - scripts never access ~/Library directly

### Privacy
- User data files are gitignored: `chat.db`, `Sources/`, `web/data/`
- Never commit personal message data
- The `--fake` flag randomizes names for screenshots

## Development

```bash
./scripts/start              # Full run: export + serve
./scripts/start --limit 50   # Export top 50 contacts only
./scripts/build              # Export only
./scripts/serve              # Serve only
./scripts/serve 3000         # Custom port
```

## Code Conventions

- Python uses argparse for CLI options
- JS uses vanilla DOM manipulation, no framework
- Chart.js with custom plugins for tooltip positioning and hover highlights
- Consistent color scheme: sent=#FFCC00 (yellow), received=#BF5AF2 (purple)
