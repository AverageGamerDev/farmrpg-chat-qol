# FarmRPG Chat Enhancer

A Tampermonkey userscript that adds quality-of-life improvements to FarmRPG's chat system.

## Features

### Message Pins
Mark important messages for later reference. Click the pin icon on any message to highlight it with a gold border. Perfect for trade offers, questions you want to answer, or event reminders. Pins clear on page reload to prevent clutter.

### Keyword Alerts
Set custom keywords to watch for in chat. Get desktop notifications when anyone mentions your tracked words or items. Automatically detects game items in the `((item))` format.

Examples:
- Track items you're buying or selling
- Get notified about events or announcements
- Monitor specific topics

### Mention Notifications
Receive browser notifications when someone mentions your username in chat. Never miss a direct message or callout again.

### Message Highlighting
Your own messages appear with an orange border, making it easy to follow your conversations in a busy chat.

### Session Markers
When you reload the page, a visual separator shows where new messages begin. Helps you pick up conversations where you left off.

## Installation

1. Install the [Tampermonkey browser extension](https://www.tampermonkey.net/)
2. Click the [install link](https://raw.githubusercontent.com/AverageGamerDev/farmrpg-chat-qol/main/farmrpg-chat-enhancer.user.js)
3. Click "Install" when Tampermonkey prompts you
4. Visit FarmRPG and look for the control buttons in the left sidebar

## Usage

All features are controlled through buttons in the game's sidebar:

**Start Mention Watcher** - Enable username notifications (requires entering your username once)

**Highlight My Messages** - Turn on orange borders for your messages

**Enable Message Pins** - Add pin buttons to all messages
- Click the pin icon to mark a message
- Click again to unmark
- Use "Clear All Pins" to remove all markers at once

**Enable Keyword Alerts** - Track custom words and items
- Enter keywords separated by commas when prompted
- Click "Manage Keywords" to edit your list anytime
- Matching messages get a purple border and notification

**Enable Session Markers** - Show visual separators for new messages (auto-enabled by default)

**Reset Username** - Clear saved username and disable all features

## Privacy

This script runs entirely in your browser. No data is sent to external servers. Your username and keywords are stored locally using browser localStorage.

## Compatibility

Tested on:
- Chrome/Edge with Tampermonkey
- Firefox with Tampermonkey
- Safari with Userscripts

Works on both desktop and mobile layouts of FarmRPG.

## Development

The script is written in vanilla JavaScript with no external dependencies. It uses MutationObserver to watch for new chat messages and localStorage for persistence.

Key technical details:
- Single shared observer for performance
- Fingerprint-based message deduplication
- Session-based pins (intentionally non-persistent)
- Item detection via regex for `((item))` format

## Contributing

Bug reports and feature suggestions are welcome. Open an issue or submit a pull request.

## License

MIT License - do whatever you want with it.

## Disclaimer

This is a third-party tool not affiliated with or endorsed by FarmRPG. Use at your own discretion. If this violates any game rules or terms of service, please let me know and I'll remove it immediately.
