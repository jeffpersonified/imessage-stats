# Notion Sync (Optional)

Sync your iMessage stats to a Notion database.

## Setup

### 1. Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it (e.g., "iMessage Stats")
4. Select your workspace
5. Click "Submit"
6. Copy the "Internal Integration Secret" (starts with `secret_`)

### 2. Create a Notion Database

Create an empty database in Notion. The script will automatically add the required columns (Phone/Email, Sent, Received, First Message, Last Message).

**Tip:** After syncing, you can add formula properties for things like "Total" or "Ratio"

### 3. Share Database with Integration

1. Open your database in Notion
2. Click "..." menu → "Connections"
3. Find and add your integration

### 4. Get Database ID

The database ID is in the URL when viewing your database:

```
https://notion.so/workspace/DATABASE_ID?v=...
                         ^^^^^^^^^^^
```

Copy the ID (the part before `?v=`).

### 5. Configure Environment

Copy the example file and fill in your values:

```bash
cp notion/.env.example notion/.env
```

Edit `notion/.env` with your API key and database ID.

### 6. Run Sync

```bash
# Make sure you've exported data first
./scripts/build

# Then sync to Notion
./scripts/notion
```

## Notes

- The sync clears all existing pages and re-creates them
- Run `./scripts/build` first to generate the data
- Install dependencies first: `pip install -r requirements.txt`
