# GMGUI Quick Start

Get up and running with GMGUI in 5 minutes.

## Installation

```bash
git clone https://github.com/lanmower/gmgui.git
cd gmgui
npm install
```

## Start the Server

```bash
npm start
```

Open your browser to **http://localhost:3000**

## Connect Your First Agent

### Via Web UI

1. In the sidebar, enter:
   - **Agent ID**: Any identifier (e.g., `my-agent`)
   - **WebSocket Endpoint**: Your agent's endpoint (e.g., `ws://localhost:8000`)
2. Click **Connect Agent**
3. Agent appears in the sidebar
4. Click to select it
5. Type a message and press Enter

### Verify Connection

Once connected, you should see:
- Agent name in sidebar with status
- Message console ready for input
- File upload and screenshot buttons available

## Using Features

### Send Messages
1. Select agent from sidebar
2. Type in the input field
3. Press **Enter** or click **Send**
4. Messages appear in the chat console

### Upload Files
1. Click **📤 Upload** button
2. Select one or more files
3. Files appear in the **Files** tab
4. Agent can access uploaded files

### Capture Screenshots
1. Click **📸 Screenshot** button
2. Preview appears in a modal
3. Click **Send to Agent** to share
4. Or **Download** to save locally

### View Settings
1. Click **Settings** tab
2. Configure preferences
3. Changes save automatically

## Development Mode

Enable hot reload for development:

```bash
npm run dev
```

Now edit any file in `static/` and browser auto-refreshes.

## Troubleshooting

### Port Already in Use
```bash
PORT=3001 npm start
```

### Agent Won't Connect
- Verify agent is running and accessible
- Check browser console (F12) for WebSocket errors
- Ensure endpoint URL is correct

### Screenshot Not Working
Install scrot (or other screenshot tool):
```bash
# Ubuntu/Debian
sudo apt-get install scrot

# macOS
brew install scrot

# Or use your system's built-in tool
```

## What's Next?

- Read [README.md](README.md) for full documentation
- Check [FEATURES.md](FEATURES.md) for all capabilities
- Review [TESTING.md](TESTING.md) for testing guide

## Mobile Access

Access GMGUI from mobile/tablet:

1. Note your computer's IP: `hostname -I`
2. On mobile, open: `http://YOUR_IP:3000`
3. Interface adapts to mobile layout

## Next Steps

Ready to integrate your agents? The interface will auto-discover and connect agents as you add them. Files are stored in `/tmp/gmgui-conversations/` for agent access.
