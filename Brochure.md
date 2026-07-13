# Reaction Roles Plugin for ADB

Manage reaction roles via slash commands with buttons, select menus, and emoji reactions.

## Features

- **Slash Commands**: Easily create, configure, update, list, and delete reaction role panels.
- **Multiple UI Formats**:
  - **Dropdown select menus**: Sleek, modern menus allowing single, multiple, or exclusive role choice.
  - **Buttons**: Neat buttons grouped together for instant toggling.
  - **Emoji reactions**: Traditional reaction-based role assignment.
- **Role Selection Modes**:
  - `multiple`: Toggles roles. No limit on the number of roles from the group.
  - `single`: Allows toggling at most one role from the group.
  - `exclusive`: Mutually exclusive. User must have exactly one role from the group (cannot have none).
- **Groupings**: Group roles together inside a panel with custom labels and descriptions (e.g. "Colors", "Pronouns").
- **Auto-healing / Refresh**: Recreate or sync the panel message instantly with `/reactionrole refresh`.

## Project Structure

```
adb-plugin-reaction-roles/
├── plugin.json                 # Manifest: name, version, permissions
├── index.js                    # Entry point: registers commands and event listeners
├── package.json                # npm metadata
├── Brochure.md                 # Plugin description shown in the dashboard
├── commands/
│   └── reactionrole.js         # Command logic (/reactionrole)
├── models/
│   └── reactionPanel.js        # MongoDB Mongoose Schema
└── test/
    ├── local-harness.js        # Test file with mock environments
    └── mock-ctx.js             # Faithful mock of PluginContext
```

## Slash Commands

- `/reactionrole create channel:#channel title:text [description:text] [color:hex] [group_name:text] [group_label:text] [type:dropdown/button/emoji] [selection_mode:single/multiple/exclusive]`
- `/reactionrole add message_id:text role:@role [emoji:text] [label:text] [description:text] [group_name:text]`
- `/reactionrole remove message_id:text role:@role`
- `/reactionrole delete message_id:text`
- `/reactionrole list`
- `/reactionrole refresh message_id:text`
